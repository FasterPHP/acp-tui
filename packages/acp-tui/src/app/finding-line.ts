// The one line printed on the normal screen while `--resume <id>` and `--continue` launch the
// agent and look the session up, before the full-screen app starts (mvp-sessions task 12.11,
// design decision 13; Marcus, 5 October 2026). It is acp-tui's own escape output: printed without
// a newline, and removed (carriage return, then erase line) before the app takes the alternate
// screen and before any error line, so afterwards the screen shows only the error, or nothing of
// it. Nothing is written unless stdout is a terminal.

/** The line, with the Unicode ellipsis. */
export const FINDING_LINE = "acp-tui: finding session…";

/** What `showFinding` needs of stdout. */
export interface FindingOutput {
  readonly isTTY?: boolean | undefined;
  write(text: string): unknown;
}

/** Prints `FINDING_LINE` and returns the function that removes it (once; later calls do nothing). */
export function showFinding(out: FindingOutput): () => void {
  if (!out.isTTY) return () => {};
  out.write(FINDING_LINE);
  let shown = true;
  return () => {
    if (!shown) return;
    shown = false;
    out.write("\r\x1b[2K");
  };
}
