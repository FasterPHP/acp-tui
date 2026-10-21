// `acp-tui --version` and the head of a crash report (colleague-preview design D6 and D7): the
// version lines come from a pure function of plain data and an impure gatherer that asks git about
// the checkout, with a 1 s limit each and no shell.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "../package.json" with { type: "json" };
import { detectTerminal } from "./renderer/capabilities.ts";

export interface VersionInfo {
  readonly version: string;
  /** The checkout's short commit, or null without git or a work tree. */
  readonly commit: string | null;
  /** Whether tracked files have changes (only meaningful with a commit). */
  readonly modified: boolean;
  readonly bun: string;
  readonly platform: string;
  readonly arch: string;
  readonly terminal: string;
}

/** The lines `--version` prints and a crash report begins with. */
export function versionLines(info: VersionInfo): string[] {
  const commit = info.commit === null ? "" : ` (${info.commit}${info.modified ? ", modified" : ""})`;
  return [`acp-tui ${info.version}${commit}`, `bun ${info.bun}`, `${info.platform} ${info.arch}`, `terminal ${info.terminal}`];
}

/** Runs git in `cwd` with a 1 s limit and no shell; null when it cannot run or fails. */
function git(cwd: string, args: readonly string[]): string | null {
  try {
    const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "ignore", stdin: "ignore", timeout: 1000 });
    return result.exitCode === 0 ? result.stdout.toString().trim() : null;
  } catch {
    return null;
  }
}

/** Where the checkout's sources are (git finds the work tree from here). */
const SOURCE_DIRECTORY = dirname(fileURLToPath(import.meta.url));

export function gatherVersionInfo(env: Readonly<Record<string, string | undefined>> = process.env, cwd: string = SOURCE_DIRECTORY): VersionInfo {
  const commit = git(cwd, ["rev-parse", "--short", "HEAD"]);
  const status = commit === null ? null : git(cwd, ["status", "--porcelain", "--untracked-files=no"]);
  return {
    version: pkg.version,
    commit: commit === "" ? null : commit,
    modified: status !== null && status !== "",
    bun: Bun.version,
    platform: process.platform,
    arch: process.arch,
    terminal: detectTerminal(env),
  };
}
