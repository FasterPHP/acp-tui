// mvp-chrome-and-keys task 3.8 (spec tui-keymap "Alternatives for keys an IDE
// keeps"; decision 16, design D11): the keys each terminal keeps, recorded from
// report S1's task 10.5 key tables in ide-keys.json, and the check that every
// kept key bound by default has its alternative bound or in the palette. Data
// driven: the recorded table and the palette's keystroke-only list
// (`KEYSTROKE_ONLY` in src/overlay/palette.ts) are the only inputs, so the
// probe of task 8.1 extends it by editing data. A palette entry is a catalogue
// action outside tui-palette's keystroke-only list ("Every action of the
// command catalogue SHALL be a palette entry, except ..."); whether the palette
// lists each of them is the palette's own "Catalogue check"
// (test/overlay/palette.test.ts).
import { describe, expect, test } from "bun:test";
import { DEFAULT_KEY_MAP, KEY_ACTIONS, KEY_CONTEXTS, loadKeyMap, normaliseKey, type KeyContext, type KeyMap } from "../../src/keys/keymap.ts";
import { isPaletteAction } from "../../src/overlay/palette.ts";
import table from "../../src/keys/ide-keys.json";

type Alternative = { key: string; context: string; action: string } | { palette: string } | { outside: string };
interface KeptKey {
  key: string;
  how: string;
  noneNeeded?: string;
  alternatives: Alternative[];
}
const TERMINALS = table.terminals as Record<string, { label: string; kept: KeptKey[] }>;

/** A palette entry: a catalogue action outside the palette's keystroke-only list (src/overlay/palette.ts). */
function inPalette(name: string): boolean {
  const [context, action] = name.split(".") as [KeyContext, string];
  if (!(KEY_CONTEXTS as readonly string[]).includes(context)) return false;
  if (!(KEY_ACTIONS[context] as readonly string[]).includes(action)) return false;
  return isPaletteAction(context, action);
}

/** Every context's action for `key` in `map`. */
function boundTo(map: KeyMap, key: string): string[] {
  const norm = normaliseKey(key);
  return KEY_CONTEXTS.flatMap((c) => {
    const action = (map[c] as Record<string, string>)[norm];
    return action === undefined ? [] : [`${c}.${action}`];
  });
}

/** The problems with the recorded table against `map`: none when every alternative holds. */
function checkAlternatives(map: KeyMap): string[] {
  const problems: string[] = [];
  for (const [terminal, { kept }] of Object.entries(TERMINALS)) {
    for (const k of kept) {
      // A kept key acp-tui does not bind needs no alternative (Ctrl+Enter in Zed).
      if (boundTo(map, k.key).length === 0) continue;
      const checkable = k.alternatives.filter((a): a is Exclude<Alternative, { outside: string }> => !("outside" in a));
      if (checkable.length === 0) problems.push(`${terminal} ${k.key}: no checkable alternative`);
      for (const a of checkable) {
        if ("palette" in a) {
          if (!inPalette(a.palette)) problems.push(`${terminal} ${k.key}: ${a.palette} is not a palette entry`);
        } else if ((map[a.context as KeyContext] as Record<string, string> | undefined)?.[normaliseKey(a.key)] !== a.action) {
          problems.push(`${terminal} ${k.key}: ${a.key} is not bound to ${a.context}.${a.action}`);
        }
      }
    }
  }
  return problems;
}

describe("Alternatives for keys an IDE keeps (task 3.8)", () => {
  test("the recorded table: five terminals, each kept key recorded with how and its alternatives, in the key map's spelling", () => {
    expect(Object.keys(TERMINALS).sort()).toEqual(["intellij-windows", "phpstorm-classic", "phpstorm-reworked", "windows-terminal", "zed"]);
    for (const { kept } of Object.values(TERMINALS)) {
      expect(kept.length).toBeGreaterThan(0);
      for (const k of kept) {
        expect(normaliseKey(k.key)).toBe(k.key);
        expect(k.how.length).toBeGreaterThan(0);
        expect(k.alternatives.length).toBeGreaterThan(0);
      }
    }
    // Report S1 10.5 and design D11: what each terminal keeps.
    const keys = (t: string) => TERMINALS[t]!.kept.map((k) => k.key).sort();
    // Ctrl+Shift+V, `paste`'s second default, is kept by both IDEs (task 12.2); Ctrl+Shift+Z, `redo`'s
    // second default, by all three (day-two-feedback task 10.4).
    // The Mac's Cmd+Z, Cmd+Shift+Z and Cmd+X, kept by PhpStorm on macOS (day-two-feedback task 13.4).
    expect(keys("phpstorm-reworked")).toEqual(["ctrl+f", "ctrl+shift+c", "ctrl+shift+v", "ctrl+shift+z", "ctrl+v", "shift+f3", "shift+super+z", "super+x", "super+z"]);
    expect(keys("phpstorm-classic")).toEqual(["ctrl+c", "ctrl+f", "ctrl+shift+c", "ctrl+shift+v", "ctrl+shift+z", "ctrl+v", "shift+f3", "shift+super+z", "super+x", "super+z"]);
    expect(keys("zed")).toEqual(["ctrl+j", "ctrl+p", "ctrl+return", "ctrl+shift+c", "ctrl+shift+v", "ctrl+shift+z", "ctrl+t", "f1", "shift+f3"]);
    // windows-support task 9.4 (Windows VM, 20 October 2026): Windows Terminal keeps Alt+Enter, its
    // paste, its own commands and Ctrl+C with a selection; IntelliJ's terminal on Windows keeps what
    // PhpStorm's reworked terminal does, minus the Mac's Cmd keys and with Ctrl+Shift+C and
    // Ctrl+Shift+Z arriving unshifted.
    expect(keys("windows-terminal")).toEqual(["ctrl+,", "ctrl+c", "ctrl+shift+p", "ctrl+shift+t", "ctrl+shift+v", "ctrl+shift+w", "ctrl+shift+z", "ctrl+tab", "ctrl+v", "meta+return", "shift+f3"]);
    expect(keys("intellij-windows")).toEqual(["ctrl+f", "ctrl+shift+c", "ctrl+shift+v", "ctrl+shift+z", "ctrl+v", "shift+f3"]);
  });

  test("Recorded table checked: every kept key bound by default has its listed alternatives bound or in the palette", () => {
    expect(checkAlternatives(DEFAULT_KEY_MAP)).toEqual([]);
  });

  test("Windows Terminal (task 9.4): Alt+Enter is bound by default, so its alternatives are checked; its own commands are bound to nothing", () => {
    expect(boundTo(DEFAULT_KEY_MAP, "meta+return")).toEqual(["prompt.newline", "find.previous"]);
    for (const key of ["ctrl+shift+p", "ctrl+shift+t", "ctrl+shift+w", "ctrl+tab", "ctrl+,"]) expect(boundTo(DEFAULT_KEY_MAP, key), key).toEqual([]);
    // Taking away Ctrl+Enter, the newline's route there, is reported.
    expect(checkAlternatives(loadKeyMap({ prompt: { "ctrl+return": null } }))).toEqual(["windows-terminal meta+return: ctrl+return is not bound to prompt.newline"]);
  });

  test("The Mac's Cmd keys (task 13.4): Cmd+Z and Cmd+Shift+Z are bound by default, so their alternatives are checked; Cmd+X is bound to nothing", () => {
    expect(boundTo(DEFAULT_KEY_MAP, "super+z")).toEqual(["prompt.undo"]);
    expect(boundTo(DEFAULT_KEY_MAP, "shift+super+z")).toEqual(["prompt.redo"]);
    expect(boundTo(DEFAULT_KEY_MAP, "super+x")).toEqual([]);
    // Taking away the alternatives is reported for each PhpStorm terminal.
    expect(checkAlternatives(loadKeyMap({ prompt: { "ctrl+z": null } }))).toEqual([
      "phpstorm-reworked super+z: ctrl+z is not bound to prompt.undo",
      "phpstorm-classic super+z: ctrl+z is not bound to prompt.undo",
    ]);
  });

  test("Recorded table checked: an unbound alternative is reported", () => {
    // `?` in an empty prompt box is the palette's route in Zed, which keeps Ctrl+P (task 12.1).
    expect(checkAlternatives(loadKeyMap({ prompt: { "?": null } }))).toEqual(["zed ctrl+p: ? is not bound to prompt.palette"]);
    // Alt+V is the clipboard reader's route in PhpStorm, Zed, Windows Terminal and IntelliJ on Windows,
    // which keep Ctrl+Shift+V (and the others Ctrl+V) (task 12.2).
    expect(checkAlternatives(loadKeyMap({ prompt: { "meta+v": null } }))).toEqual([
      "phpstorm-reworked ctrl+v: meta+v is not bound to prompt.paste",
      "phpstorm-reworked ctrl+shift+v: meta+v is not bound to prompt.paste",
      "phpstorm-classic ctrl+v: meta+v is not bound to prompt.paste",
      "phpstorm-classic ctrl+shift+v: meta+v is not bound to prompt.paste",
      "zed ctrl+shift+v: meta+v is not bound to prompt.paste",
      "windows-terminal ctrl+v: meta+v is not bound to prompt.paste",
      "windows-terminal ctrl+shift+v: meta+v is not bound to prompt.paste",
      "intellij-windows ctrl+v: meta+v is not bound to prompt.paste",
      "intellij-windows ctrl+shift+v: meta+v is not bound to prompt.paste",
    ]);
    // F3 is find's route in PhpStorm, which keeps Ctrl+F.
    expect(checkAlternatives(loadKeyMap({ global: { f3: null } }))).toEqual([
      "phpstorm-reworked ctrl+f: f3 is not bound to global.findNext",
      "phpstorm-classic ctrl+f: f3 is not bound to global.findNext",
      "intellij-windows ctrl+f: f3 is not bound to global.findNext",
    ]);
  });

  test("a palette alternative outside the catalogue, or keystroke-only, is not a palette entry", () => {
    expect(inPalette("global.keyHelp")).toBe(true);
    expect(inPalette("prompt.paste")).toBe(true);
    expect(inPalette("prompt.newline")).toBe(false);
    // The palette's own openers are keystroke-only (task 12.1).
    expect(inPalette("global.palette")).toBe(false);
    expect(inPalette("prompt.palette")).toBe(false);
    expect(inPalette("find.previous")).toBe(false);
    expect(inPalette("global.noSuchAction")).toBe(false);
  });
});
