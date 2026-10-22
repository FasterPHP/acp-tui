// windows-support D10 (task 11.1): tests that need POSIX behaviour skip on Windows with
// `test.skipIf(WINDOWS)` and a one-line reason above them (signals sent with `process.kill`,
// `#!/bin/sh` stubs and mode bits, raw bytes or main-screen snapshots of a PTY stream that ConPTY
// rewrites, truecolour expected from a bare PTY). The skips are counted in the Windows run's note.
import { join } from "node:path";

export const WINDOWS = process.platform === "win32";

/** The environment that makes `home` the user's home for acp-tui (src/platform/paths.ts `userHome`):
 *  `HOME`, or the profile (`USERPROFILE`) on Windows, which ignores `HOME`. Bun keeps its runtime
 *  transpiler cache below that home too, so the child Bun processes (acp-tui and its harness) are
 *  pointed at this process's cache: with a new, empty home each start would compile every module
 *  again, which made these starts twice as slow even on a fast machine (and more than 15 s on a
 *  loaded CI runner). */
export function homeEnv(home: string): Record<string, string> {
  const cache = transpilerCache(process.env);
  return { ...(WINDOWS ? { USERPROFILE: home } : { HOME: home }), ...(cache === undefined ? {} : { BUN_RUNTIME_TRANSPILER_CACHE_PATH: cache }) };
}

/** Where Bun keeps the runtime transpiler cache for an environment, by Bun's own rule:
 *  `BUN_RUNTIME_TRANSPILER_CACHE_PATH`, else `$XDG_CACHE_HOME/bun/@t@`, else `.bun/install/cache/@t@`
 *  in the home (`USERPROFILE` on Windows, `HOME` elsewhere). */
export function transpilerCache(env: Record<string, string | undefined>): string | undefined {
  if (env["BUN_RUNTIME_TRANSPILER_CACHE_PATH"] !== undefined) return env["BUN_RUNTIME_TRANSPILER_CACHE_PATH"];
  if (env["XDG_CACHE_HOME"]) return join(env["XDG_CACHE_HOME"], "bun", "@t@");
  const home = WINDOWS ? env["USERPROFILE"] : env["HOME"];
  return home ? join(home, ".bun", "install", "cache", "@t@") : undefined;
}

/**
 * The main screen's rows after the PTY test's prefilled command line (`$ acp-tui`), where acp-tui's
 * own lines start. ConPTY clears the screen when the child first writes, so on Windows the prefill is gone
 * and acp-tui's lines start at the top.
 */
export function rowsAfterPrefill(rows: readonly string[], prefill = "$ acp-tui"): string[] {
  const at = rows.indexOf(prefill);
  return at >= 0 ? rows.slice(at + 1) : [...rows];
}
