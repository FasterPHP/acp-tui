// The `@` file picker's list source (mvp-chrome-and-keys task 6.6, design
// D9): the walk with the built-in matcher, `git ls-files` in a work tree, the
// cap, fuzzy ranking, the sanitised display name and the link's URI. Trees
// are generated under $TMPDIR.
//
// The ranking time budget for 50000 paths is in files.timing.test.ts (parallel-tests: it runs in
// the serial pass).
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { displayPath, fileUri, fuzzyScore, listFiles, rankFiles } from "../../src/overlay/files.ts";

function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-files-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

async function list(cwd: string, options: { walkOnly?: boolean; cap?: number } = {}) {
  const paths: string[] = [];
  let batches = 0;
  let result: { source: string; capped: boolean } | null = null;
  await listFiles(
    cwd,
    {
      add: (batch) => {
        batches++;
        paths.push(...batch);
      },
      done: (r) => (result = r),
    },
    options,
  );
  return { paths: paths.sort(), batches, result: result as { source: string; capped: boolean } | null };
}

const hasGit = Bun.spawnSync(["git", "--version"]).exitCode === 0;

describe("listFiles: the walk", () => {
  test("follows .gitignore files (nested ones below their directory), skips .git, lists symbolic links", async () => {
    const dir = tree({
      "src/Db/Connection.php": "<?php",
      "vendor/autoload.php": "<?php",
      ".gitignore": "vendor/\n*.log\n",
      "debug.log": "",
      "pkg/.gitignore": "!keep.log\ngenerated/\n",
      "pkg/keep.log": "",
      "pkg/generated/x.ts": "",
      "pkg/a.ts": "",
      ".git/config": "",
      "README.md": "",
    });
    symlinkSync(join(dir, "src"), join(dir, "src-link"));
    const { paths, result } = await list(dir, { walkOnly: true });
    expect(paths).toEqual([".gitignore", "README.md", "pkg/.gitignore", "pkg/a.ts", "pkg/keep.log", "src-link", "src/Db/Connection.php"]);
    expect(result).toEqual({ source: "walk", capped: false });
  });

  test("streams in batches, shallow paths first, and stops at the cap", async () => {
    const files: Record<string, string> = {};
    for (let d = 0; d < 6; d++) for (let f = 0; f < 300; f++) files[`d${d}/f${f}.txt`] = "";
    files["top.txt"] = "";
    const dir = tree(files);
    const seen: string[] = [];
    let batches = 0;
    await listFiles(dir, { add: (b) => (batches++, seen.push(...b)), done: () => {} }, { walkOnly: true });
    expect(seen[0]).toBe("top.txt");
    expect(seen).toHaveLength(1801);
    expect(batches).toBeGreaterThan(1);
    const capped = await list(dir, { walkOnly: true, cap: 1000 });
    expect(capped.paths).toHaveLength(1000);
    expect(capped.result).toEqual({ source: "walk", capped: true });
  });

  test("an aborted listing reports nothing more", async () => {
    const dir = tree({ "a.txt": "", "b/c.txt": "" });
    const abort = new AbortController();
    abort.abort();
    let done = false;
    const added: string[] = [];
    await listFiles(dir, { add: (b) => added.push(...b), done: () => (done = true) }, { walkOnly: true, signal: abort.signal });
    expect(done).toBe(false);
    expect(added).toEqual([]);
  });
});

describe.if(hasGit)("listFiles: git ls-files in a work tree", () => {
  test("lists tracked and untracked files under the cwd as git's own ignore rules do", async () => {
    const dir = tree({
      "src/Db/Connection.php": "<?php",
      "vendor/autoload.php": "<?php",
      ".gitignore": "vendor/\n",
      "src/.gitignore": "*.cache\n",
      "src/x.cache": "",
      "tracked.txt": "",
    });
    expect(Bun.spawnSync(["git", "init", "-q"], { cwd: dir }).exitCode).toBe(0);
    Bun.spawnSync(["git", "add", "tracked.txt"], { cwd: dir });
    const { paths, result } = await list(dir);
    expect(paths).toEqual([".gitignore", "src/.gitignore", "src/Db/Connection.php", "tracked.txt"]);
    expect(result).toEqual({ source: "git", capped: false });
    // From a subdirectory, the paths are relative to it.
    const sub = await list(join(dir, "src"));
    expect(sub.paths).toEqual([".gitignore", "Db/Connection.php"]);
  });

  test("outside a work tree it walks", async () => {
    const dir = tree({ "a.txt": "" });
    const { paths, result } = await list(dir);
    // Should $TMPDIR lie inside a work tree, git answers instead.
    const inside = Bun.spawnSync(["git", "rev-parse", "--is-inside-work-tree"], { cwd: dir }).exitCode === 0;
    expect(result?.source).toBe(inside ? "git" : "walk");
    expect(paths).toEqual(["a.txt"]);
  });
});

describe("fuzzy ranking", () => {
  const paths = ["src/Db/Connection.php", "src/Db/Query.php", "docs/conventions.md", "tests/Db/ConnectionTest.php", "README.md", "scripts/con-nect.sh"];
  const lower = paths.map((p) => p.toLowerCase());

  test("every query character in order, case-insensitive for a lower-case query", () => {
    expect(fuzzyScore("conn", "src/db/connection.php")).not.toBeNull();
    expect(fuzzyScore("cnn", "src/db/connection.php")).not.toBeNull();
    expect(fuzzyScore("nnoc", "src/db/connection.php")).toBeNull();
    expect(fuzzyScore("", "anything")).toBe(0);
  });

  test("segment starts and runs rank first; ties go to the shorter path", () => {
    const ranked = rankFiles("conn", paths, lower).map((i) => paths[i]);
    expect(ranked[0]).toBe("src/Db/Connection.php");
    expect(ranked[1]).toBe("tests/Db/ConnectionTest.php");
    expect(ranked).not.toContain("README.md");
    expect(rankFiles("dbq", paths, lower).map((i) => paths[i])[0]).toBe("src/Db/Query.php");
  });

  test("an upper-case letter makes the query case-sensitive (smart case)", () => {
    expect(rankFiles("Conn", paths, lower).map((i) => paths[i])).toEqual(["src/Db/Connection.php", "tests/Db/ConnectionTest.php"]);
  });

  test("an empty query keeps the listed order; `among` narrows the search", () => {
    expect(rankFiles("", paths, lower)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(rankFiles("php", paths, lower, [1, 4])).toEqual([1]);
  });
});

describe("names and links", () => {
  test("a name is sanitised for display: no escape sequence, no control character, no bidi override", () => {
    expect(displayPath("a\x1b[31mred\x1b[0m.txt")).toBe("ared.txt");
    expect(displayPath("line\nbreak\tand\x07bell")).toBe("line?break?andbell");
    expect(displayPath("evil‮txt.exe")).toBe("eviltxt.exe");
    expect(displayPath("src/Db/Connection.php")).toBe("src/Db/Connection.php");
  });

  test("the URI is percent-encoded from the real path", () => {
    expect(fileUri("/home/u/proj", "src/Db/Connection.php")).toBe("file:///home/u/proj/src/Db/Connection.php");
    expect(fileUri("/home/u/my proj", "a#b?c%d.txt")).toBe("file:///home/u/my%20proj/a%23b%3Fc%25d.txt");
    expect(fileUri("/p", "café/naïve.md")).toBe("file:///p/caf%C3%A9/na%C3%AFve.md");
    expect(fileUri("/p", "new\nline")).toBe("file:///p/new%0Aline");
  });
});
