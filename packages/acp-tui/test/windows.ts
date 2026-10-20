// windows-support D10 (task 11.1): tests that need POSIX behaviour skip on Windows with
// `test.skipIf(WINDOWS)` and a one-line reason above them (signals sent with `process.kill`,
// `#!/bin/sh` stubs and mode bits, raw bytes or main-screen snapshots of a PTY stream that ConPTY
// rewrites, truecolour expected from a bare PTY). The skips are counted in the Windows run's note.
export const WINDOWS = process.platform === "win32";

/** The environment that makes `home` the user's home for acp-tui (src/platform/paths.ts `userHome`):
 *  `HOME`, or the profile (`USERPROFILE`) on Windows, which ignores `HOME`. */
export function homeEnv(home: string): Record<string, string> {
  return WINDOWS ? { USERPROFILE: home } : { HOME: home };
}

/**
 * The main screen's rows after the PTY test's prefilled command line (`$ acp-tui`), where acp-tui's
 * own lines start. ConPTY clears the screen when the child starts, so on Windows the prefill is gone
 * and acp-tui's lines start at the top.
 */
export function rowsAfterPrefill(rows: readonly string[], prefill = "$ acp-tui"): string[] {
  const at = rows.indexOf(prefill);
  return at >= 0 ? rows.slice(at + 1) : [...rows];
}
