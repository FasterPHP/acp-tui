// Two ESC bytes in one read are two Esc presses (mvp-chrome-and-keys design
// D11; spec tui-keymap "Input in one read"). OpenTUI's parser reads `ESC ESC`
// as one key, Alt+Esc (the usual escape ambiguity), so "Esc twice" written in
// one go, by a script, a paste of keys or a fast double press that lands in
// one read, would arm interrupt at most once (S1 decision 5, S6 finding 2).
// The input handler runs ahead of the key dispatch, as the bare `CSI R`
// mapping does (bare-csi-r.ts): it takes exactly that sequence and hands the
// renderer two Esc key presses, each dispatched against the focus the one
// before it left. Alt+Esc is bound to nothing, so nothing is lost. It is a
// handler of its own, so other input handlers compose with it.
import { parseKeypress, type CliRenderer } from "@opentui/core";

const ESC = "\x1b";

/** Exactly two ESC bytes and nothing else. */
export function isDoubleEsc(sequence: string): boolean {
  return sequence === ESC + ESC;
}

/** Installs the split; `ESC ESC` becomes two Esc key presses and is not passed on. */
export function installDoubleEsc(renderer: CliRenderer): void {
  renderer.prependInputHandler((sequence) => {
    if (!isDoubleEsc(sequence)) return false;
    for (let press = 0; press < 2; press++) {
      const key = parseKeypress(ESC);
      if (key) renderer.keyInput.processParsedKey(key);
    }
    return true;
  });
}
