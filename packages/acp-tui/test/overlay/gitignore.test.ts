// The built-in `.gitignore` matcher (mvp-chrome-and-keys task 6.6, design D9):
// the file picker's walk outside a git work tree. Cases follow gitignore(5);
// where they could differ, `git check-ignore` agrees (the last test).
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { globToRegex, isIgnored, parseGitignore } from "../../src/overlay/gitignore.ts";

const ignored = (text: string, path: string, dir = false, base = "") => isIgnored(parseGitignore(text, base), path, dir);

describe("parseGitignore", () => {
  test("skips blank lines and comments; `\\#` is a literal `#`", () => {
    expect(parseGitignore("\n# a comment\n   \n")).toHaveLength(0);
    expect(ignored("\\#notes", "#notes")).toBe(true);
  });

  test("drops trailing spaces unless escaped", () => {
    expect(ignored("build   ", "build")).toBe(true);
    expect(ignored("a\\ ", "a ")).toBe(true);
    expect(ignored("a\\ ", "a")).toBe(false);
  });
});

describe("isIgnored", () => {
  test("a name without a slash matches at any depth, files and directories", () => {
    expect(ignored("*.log", "debug.log")).toBe(true);
    expect(ignored("*.log", "a/b/debug.log")).toBe(true);
    expect(ignored("node_modules", "packages/x/node_modules", true)).toBe(true);
    expect(ignored("*.log", "debug.log.txt")).toBe(false);
  });

  test("a trailing slash matches directories only", () => {
    expect(ignored("vendor/", "vendor", true)).toBe(true);
    expect(ignored("vendor/", "lib/vendor", true)).toBe(true);
    expect(ignored("vendor/", "vendor", false)).toBe(false);
  });

  test("a slash at the start or in the middle anchors the pattern to the .gitignore's directory", () => {
    expect(ignored("/build", "build", true)).toBe(true);
    expect(ignored("/build", "src/build", true)).toBe(false);
    expect(ignored("doc/frotz", "doc/frotz", true)).toBe(true);
    expect(ignored("doc/frotz", "a/doc/frotz", true)).toBe(false);
  });

  test("`*` and `?` never match a slash", () => {
    expect(ignored("src/*.php", "src/a.php")).toBe(true);
    expect(ignored("src/*.php", "src/Db/a.php")).toBe(false);
    expect(ignored("a?c", "abc")).toBe(true);
    expect(ignored("a?c", "a/c")).toBe(false);
  });

  test("`**/` leads, `/**` trails, `/**/` matches zero or more directories", () => {
    expect(ignored("**/foo", "foo")).toBe(true);
    expect(ignored("**/foo", "a/b/foo")).toBe(true);
    expect(ignored("**/foo/bar", "x/foo/bar")).toBe(true);
    expect(ignored("abc/**", "abc/x/y")).toBe(true);
    expect(ignored("abc/**", "abc", true)).toBe(false);
    expect(ignored("a/**/b", "a/b")).toBe(true);
    expect(ignored("a/**/b", "a/x/y/b")).toBe(true);
    expect(ignored("a/**/b", "x/a/b")).toBe(false);
  });

  test("bracket classes, negated with `!` or `^`, never matching a slash", () => {
    expect(ignored("file[0-9].txt", "file7.txt")).toBe(true);
    expect(ignored("file[0-9].txt", "filex.txt")).toBe(false);
    expect(ignored("file[!0-9].txt", "filex.txt")).toBe(true);
    expect(ignored("file[^0-9].txt", "file7.txt")).toBe(false);
    expect(ignored("a[!x]b", "a/b")).toBe(false);
  });

  test("regular expression characters in a pattern are literal", () => {
    expect(ignored("a+b(c).txt", "a+b(c).txt")).toBe(true);
    expect(ignored("a.b", "axb")).toBe(false);
  });

  test("`!` re-includes; the last matching rule wins", () => {
    const rules = "*.log\n!keep.log\n";
    expect(ignored(rules, "x.log")).toBe(true);
    expect(ignored(rules, "keep.log")).toBe(false);
    expect(ignored("!keep.log\n*.log\n", "keep.log")).toBe(true);
  });

  test("a nested .gitignore applies below its directory, after the outer rules", () => {
    const rules = [...parseGitignore("*.tmp\n", ""), ...parseGitignore("!local.tmp\n/out\n", "pkg/")];
    expect(isIgnored(rules, "a.tmp", false)).toBe(true);
    expect(isIgnored(rules, "pkg/local.tmp", false)).toBe(false);
    expect(isIgnored(rules, "local.tmp", false)).toBe(true);
    expect(isIgnored(rules, "pkg/out", true)).toBe(true);
    expect(isIgnored(rules, "out", true)).toBe(false);
    expect(isIgnored(rules, "pkg/sub/out", true)).toBe(false);
  });

  test("a pattern ending in an unpaired backslash matches nothing", () => {
    expect(globToRegex("abc\\")).toBeNull();
    expect(parseGitignore("abc\\\n")).toHaveLength(0);
  });

  test("agrees with `git check-ignore` on a sample tree", () => {
    const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-gitignore-"));
    const text = "*.log\n!keep.log\n/build\ndocs/**/draft*\nvendor/\n[Tt]emp?\n";
    const paths: [string, boolean][] = [
      ["a.log", false],
      ["keep.log", false],
      ["src/b.log", false],
      ["build", true],
      ["src/build", true],
      ["docs/x/draft1.md", false],
      ["docs/draft2.md", false],
      ["vendor", true],
      ["lib/vendor", true],
      ["Temp1", false],
      ["temp22", false],
      ["src/main.ts", false],
    ];
    writeFileSync(join(dir, ".gitignore"), text);
    for (const [path, isDir] of paths) {
      if (isDir) mkdirSync(join(dir, path), { recursive: true });
      else {
        mkdirSync(join(dir, path, ".."), { recursive: true });
        writeFileSync(join(dir, path), "");
      }
    }
    const init = Bun.spawnSync(["git", "init", "-q"], { cwd: dir });
    if (init.exitCode !== 0) return; // no git here: the cases above stand alone
    const rules = parseGitignore(text);
    for (const [path, isDir] of paths) {
      const check = Bun.spawnSync(["git", "check-ignore", "-q", "--no-index", isDir ? `${path}/` : path], { cwd: dir });
      expect({ path, ignored: isIgnored(rules, path, isDir) }).toEqual({ path, ignored: check.exitCode === 0 });
    }
  });
});
