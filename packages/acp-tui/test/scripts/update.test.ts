// `bun run update` (scripts/update.ts) against two temporary repositories: an upstream and a clone.
// The install step is replaced by a recording runner, so no `bun install` runs.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnRunner, update, type Runner } from "../../scripts/update.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  const result = spawnRunner(["git", "-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], cwd);
  if (result.code !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

function repos(): { upstream: string; clone: string } {
  const root = mkdtempSync(join(tmpdir(), "acp-tui-update-"));
  dirs.push(root);
  const upstream = join(root, "upstream");
  const clone = join(root, "clone");
  spawnRunner(["git", "init", "-q", "-b", "main", upstream], root);
  writeFileSync(join(upstream, "README.md"), "one\n");
  writeFileSync(join(upstream, "bun.lock"), "lock one\n");
  git(upstream, "add", ".");
  git(upstream, "commit", "-q", "-m", "first");
  git(root, "clone", "-q", upstream, clone);
  return { upstream, clone };
}

function recording(): { run: Runner; installs: string[][] } {
  const installs: string[][] = [];
  const run: Runner = (cmd, cwd) => {
    if (cmd[0] === process.execPath) {
      installs.push(cmd);
      return { code: 0, stdout: "", stderr: "" };
    }
    return spawnRunner(cmd, cwd);
  };
  return { run, installs };
}

function commit(upstream: string, file: string, text: string): void {
  writeFileSync(join(upstream, file), text);
  git(upstream, "commit", "-q", "-am", `change ${file}`);
}

describe("bun run update", () => {
  test("already up to date", () => {
    const { clone } = repos();
    const { run, installs } = recording();
    const outcome = update(clone, run);
    expect(outcome.code).toBe(0);
    expect(outcome.lines[0]).toStartWith("already up to date at ");
    expect(installs).toEqual([]);
  });

  test("a pull that leaves bun.lock alone does not install", () => {
    const { upstream, clone } = repos();
    commit(upstream, "README.md", "two\n");
    const { run, installs } = recording();
    const outcome = update(clone, run);
    expect(outcome.code).toBe(0);
    expect(outcome.lines.join("\n")).toContain("no install needed");
    expect(installs).toEqual([]);
  });

  test("a pull that changes bun.lock installs", () => {
    const { upstream, clone } = repos();
    commit(upstream, "bun.lock", "lock two\n");
    const { run, installs } = recording();
    const outcome = update(clone, run);
    expect(outcome.code).toBe(0);
    expect(outcome.lines.join("\n")).toContain("ran bun install");
    expect(installs).toEqual([[process.execPath, "install"]]);
  });

  test("local changes are refused", () => {
    const { upstream, clone } = repos();
    commit(upstream, "bun.lock", "lock two\n");
    writeFileSync(join(clone, "README.md"), "edited\n");
    const { run, installs } = recording();
    const outcome = update(clone, run);
    expect(outcome.code).toBe(1);
    expect(outcome.lines[0]).toContain("local changes");
    expect(outcome.lines.join("\n")).toContain("README.md");
    expect(installs).toEqual([]);
  });

  test("a pull that cannot fast-forward is refused with git's message", () => {
    const { upstream, clone } = repos();
    commit(upstream, "README.md", "upstream\n");
    writeFileSync(join(clone, "other.txt"), "local\n");
    git(clone, "add", "other.txt");
    git(clone, "commit", "-q", "-m", "local");
    const { run, installs } = recording();
    const outcome = update(clone, run);
    expect(outcome.code).not.toBe(0);
    expect(outcome.lines[0]).toBe("update: git pull --ff-only failed:");
    expect(outcome.lines.length).toBeGreaterThan(1);
    expect(installs).toEqual([]);
  });
});
