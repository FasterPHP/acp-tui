// Shared by glyphs.pty.test.ts and glyphs.pty.timing.test.ts (split by the change parallel-tests, tasks 3.x). Not a test file.
import { mkdirSync, mkdtempSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startCli, type CliRun } from "../conversation/cli.ts";
import { startPty, type PtySession } from "../pty/harness.ts";

export const ROOT = resolve(import.meta.dir, "../../../..");
export const CLI = join(ROOT, "packages/acp-tui/src/cli.ts");

/** A configuration home holding `config.jsonc` (saved by renaming a temporary file over it, as an
 *  editor does). */
export function configHome(text: string) {
  const home = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-glyphs-")));
  const dir = join(home, "acp-tui");
  mkdirSync(dir);
  const file = join(dir, "config.jsonc");
  writeFileSync(file, text);
  return {
    home,
    write(next: string) {
      const tmp = join(dir, `.config.jsonc.${Date.now()}.tmp`);
      writeFileSync(tmp, next);
      renameSync(tmp, file);
    },
  };
}

export function run(options: Parameters<typeof startCli>[0]): CliRun {
  const r = startCli(options);
  sessions.push(r.session);
  return r;
}

export const CONVERSATION_GLYPHS = /[●○•◦━▖▘▝▗]/;

/** `acp-tui glyphs ...` under a PTY; the output so far once it has exited. */
export async function runGlyphs(args: string[]): Promise<{ code: number; output: string }> {
  const s = startPty(["bun", CLI, "glyphs", ...args], { cols: 120, rows: 60, env: {} });
  sessions.push(s);
  const code = await s.wait(15000);
  return { code, output: s.rawOutput() };
}

let sessions: PtySession[] = [];

/** For each test file's `afterEach`. */
export async function disposeSessions(): Promise<void> {
  for (const s of sessions) {
    s.kill("SIGTERM");
    await s.dispose();
  }
  sessions = [];
}
