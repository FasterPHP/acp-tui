// A bare `CSI R` is F3 (mvp-conversation design D8). In one PhpStorm terminal
// tab F3 arrived as `ESC [ R` instead of `ESC O R` (phase-1a S5, A2 finding 2);
// OpenTUI decodes it as a key with no name and logs console errors on each
// press. A cursor position report always carries `row;col` parameters, and
// OpenTUI's capability matcher only takes `CSI 1 ; n R`, so a bare `CSI R` is
// never a report. The input handler runs ahead of the key dispatch: it takes
// the sequence and hands the renderer the key `ESC O R` stands for.
// `CSI 1 ; 2 R` (Shift+F3 in the xterm form) stays swallowed by OpenTUI 0.5.12
// and is not touched here.
import { parseKeypress, type CliRenderer } from "@opentui/core";

/** F3 as the SS3 form every terminal here sends. */
const F3 = "\x1bOR";

/** Exactly a bare `CSI R`: no parameters. */
export function isBareCsiR(sequence: string): boolean {
  return sequence === "\x1b[R";
}

/** Installs the mapping; a bare `CSI R` becomes the F3 key press and is not passed on. */
export function installBareCsiR(renderer: CliRenderer): void {
  renderer.prependInputHandler((sequence) => {
    if (!isBareCsiR(sequence)) return false;
    const key = parseKeypress(F3);
    if (key) renderer.keyInput.processParsedKey(key);
    return true;
  });
}
