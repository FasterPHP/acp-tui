// How the PTY harness's emulator counts a narrow base followed by variation selector 16 (`⚠️`,
// `❤️`). xterm.js 6 as it is (its Unicode 6 tables) gives the base 1 cell and U+FE0F none, so the
// sequence takes 1 cell, as Zed does. acp-tui and OpenTUI lay it out in 2 (Bun.stringWidth), as
// ConPTY, Windows Terminal and the JetBrains terminals draw it.
//
// Off Windows that difference never moves a cell: OpenTUI places the cursor after a wide grapheme
// itself (`CSI row;col H`), so the emulator only leaves the second cell blank. On Windows the
// harness reads the screen through ConPTY, which keeps its own buffer (2 cells, measured in the
// Windows 11 VM on 20 October 2026, renderer/capabilities.ts `WINDOWS_TERMINAL`) and repaints it
// without that cursor placement, so an emulator counting 1 shifts the rest of the row by one
// column and skews every row below it (the permission card's right border drawn twice, its frame
// broken). No terminal behind ConPTY counts it that way, so `wide` (the default on Windows) makes
// the emulator count it as they do: 2 cells, the base and U+FE0F in one cell pair. Everything
// else is xterm.js 6's.
import type { Terminal as XTerm } from "@xterm/headless";

/** `narrow`: xterm.js 6 as it is (1 cell). `wide`: 2 cells, as ConPTY and the terminals behind it. */
export type Vs16Width = "narrow" | "wide";

const VS16 = 0xfe0f;
const VERSION = "6-vs16-wide";

/** xterm.js's packing of a character's properties (UnicodeService.createPropertyValue): a state,
 *  the width and whether the character joins the cell before it. */
const pack = (state: number, width: number, join: boolean) => ((state & 0xffffff) << 3) | ((width & 3) << 1) | (join ? 1 : 0);
const widthOf = (props: number) => (props >> 1) & 3;
const stateOf = (props: number) => props >> 3;
const joins = (props: number) => (props & 1) !== 0;

interface Provider {
  readonly version: string;
  wcwidth(codepoint: number): 0 | 1 | 2;
  charProperties(codepoint: number, preceding: number): number;
}

/** Makes `term` count a narrow base followed by U+FE0F as 2 cells where Bun.stringWidth does
 *  (`⚠️`, `❤️`; not `1️`), and everything else as xterm.js 6 does. */
export function widenVs16(term: XTerm): void {
  // xterm.js 6 does not expose its Unicode 6 provider, only `register` and `activeVersion`.
  const service = (term as unknown as { _core?: { unicodeService?: { _activeProvider?: Provider } } })._core?.unicodeService;
  const base = service?._activeProvider;
  if (!base || typeof base.charProperties !== "function") throw new Error("test/pty/vs16.ts: xterm.js's Unicode service has changed; update widenVs16");
  term.unicode.register({
    version: VERSION,
    wcwidth: (cp) => base.wcwidth(cp),
    charProperties(cp, preceding) {
      if (cp === VS16 && preceding !== 0 && widthOf(preceding) === 1) {
        const prev = stateOf(preceding);
        if (prev !== 0 && Bun.stringWidth(String.fromCodePoint(prev, VS16)) === 2) return pack(0, 2, true);
      }
      const props = base.charProperties(cp, preceding);
      // A character that starts a cell is kept as the state, for a U+FE0F after it.
      return joins(props) ? props : pack(cp, widthOf(props), false);
    },
  });
  term.unicode.activeVersion = VERSION;
}
