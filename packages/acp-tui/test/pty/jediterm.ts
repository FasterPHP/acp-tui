// JediTerm emulation for the PTY harness (`startPty(..., { terminal: "jediterm" })`), from the
// S1 IDE run of phase-1a (docs/phase-1a-spike-report.md, S1 bugs 1 to 3). PhpStorm's terminals,
// classic and reworked, differ from xterm.js in the ways that broke acp-tui there:
//
// - the environment: `TERMINAL_EMULATOR=JetBrains-JediTerm`, `TERM=xterm-256color`, and no
//   `COLORTERM` (or `TERM_PROGRAM`);
// - `CSI s` and `CSI u` (SCOSC and SCORC) are ignored, so the cursor is neither saved nor
//   restored by them;
// - APC strings (`ESC _ ... ESC \`) are not parsed: the introducer and terminator are
//   swallowed and the payload is printed as text at the cursor.
//
// The filter rewrites the child's output before the headless xterm sees it. It keeps an
// incomplete sequence at the end of a chunk until the next chunk completes it.

/** The environment PhpStorm's terminals give a child process. */
export const JEDITERM_ENV: Readonly<Record<string, string | undefined>> = {
  TERM: "xterm-256color",
  TERMINAL_EMULATOR: "JetBrains-JediTerm",
  COLORTERM: undefined,
  TERM_PROGRAM: undefined,
  TERM_PROGRAM_VERSION: undefined,
};

// A bare `CSI s` or `CSI u` (with parameters they are other controls), or an APC string.
const REWRITE = /\x1b\[([su])|\x1b_([^\x1b]*)\x1b\\/g;
// An escape sequence that may still become one of the above: a lone ESC, `ESC [`, or an APC
// without its terminator.
const PARTIAL_TAIL = /\x1b(?:\[?|_[^\x1b]*\x1b?)$/;

export class JediTermFilter {
  private carry = "";

  /** The text to write to the emulator for this chunk of the child's output. */
  push(text: string): string {
    let input = this.carry + text;
    this.carry = "";
    const partial = PARTIAL_TAIL.exec(input);
    if (partial) {
      this.carry = input.slice(partial.index);
      input = input.slice(0, partial.index);
    }
    return input.replace(REWRITE, (_all, _scosc: string | undefined, apc: string | undefined) => apc ?? "");
  }

  /** Whatever is still held back (at the end of the output). */
  flush(): string {
    const rest = this.carry;
    this.carry = "";
    return rest;
  }
}
