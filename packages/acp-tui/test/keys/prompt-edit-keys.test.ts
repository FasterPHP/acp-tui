// day-two-feedback task groups 8 and 9 (spec tui-keymap "Prompt box selection keys" and "Undo and
// redo in the prompt box"): the new `prompt` keys are data like every other key: present in the
// default map, free of conflicts, rebindable, and palette entries where they should be.
import { describe, expect, test } from "bun:test";
import { DEFAULT_KEY_MAP, KEY_ACTIONS, keysFor, loadKeyMap, normaliseKey } from "../../src/keys/keymap.ts";
import { helpItems } from "../../src/overlay/help.ts";
import { isPaletteAction } from "../../src/overlay/palette-actions.ts";

const SELECTING = ["selectLeft", "selectRight", "selectUp", "selectDown", "selectHome", "selectEnd", "selectWordLeft", "selectWordRight"] as const;

describe("prompt box editing keys", () => {
  test("the selecting keys: Shift with the arrows, Home and End, Ctrl+Shift or Alt+Shift with Left and Right by word", () => {
    const keys = (action: (typeof SELECTING)[number]) => keysFor(DEFAULT_KEY_MAP, "prompt", action);
    expect(keys("selectLeft")).toEqual(["shift+left"]);
    expect(keys("selectRight")).toEqual(["shift+right"]);
    expect(keys("selectUp")).toEqual(["shift+up"]);
    expect(keys("selectDown")).toEqual(["shift+down"]);
    expect(keys("selectHome")).toEqual(["shift+home"]);
    expect(keys("selectEnd")).toEqual(["shift+end"]);
    expect(keys("selectWordLeft")).toEqual(["ctrl+shift+left", "meta+shift+left"]);
    expect(keys("selectWordRight")).toEqual(["ctrl+shift+right", "meta+shift+right"]);
  });

  test("cut, undo and redo: Ctrl+X, Ctrl+Z and Super+Z, Ctrl+Y and the Shift+Z forms", () => {
    expect(keysFor(DEFAULT_KEY_MAP, "prompt", "cut")).toEqual(["ctrl+x"]);
    expect(keysFor(DEFAULT_KEY_MAP, "prompt", "undo")).toEqual(["ctrl+z", "super+z"]);
    // Keys are normalised to `ctrl+meta+shift+super`, so Super+Shift+Z is `shift+super+z`.
    expect(keysFor(DEFAULT_KEY_MAP, "prompt", "redo")).toEqual(["ctrl+y", "ctrl+shift+z", "shift+super+z"]);
  });

  test("Select all (day-two-feedback task 13.3): Ctrl+A in the prompt context only, a palette entry, listed in key help; Home is still the line start", () => {
    expect(keysFor(DEFAULT_KEY_MAP, "prompt", "selectAll")).toEqual(["ctrl+a"]);
    expect(isPaletteAction("prompt", "selectAll")).toBe(true);
    expect(KEY_ACTIONS.prompt).toContain("selectAll");
    for (const context of ["global", "selection", "conversation"] as const) expect(DEFAULT_KEY_MAP[context][normaliseKey("ctrl+a")]).toBeUndefined();
    const entry = helpItems(DEFAULT_KEY_MAP, 60).filter((i) => i.id === "help:prompt.selectAll");
    expect(entry).toHaveLength(1);
    expect(entry[0]!.group).toBe("Prompt box");
    expect(entry[0]!.title).toBe("Select all");
    expect(entry[0]!.keys).toEqual(["ctrl+a"]);
    expect(loadKeyMap({ prompt: { "ctrl+a": null } }).prompt[normaliseKey("ctrl+a")]).toBeUndefined();
  });

  test("every new action has a key, and no new key is bound to another action in any context that could take it first", () => {
    for (const action of [...SELECTING, "cut", "undo", "redo"] as const) expect(keysFor(DEFAULT_KEY_MAP, "prompt", action).length).toBeGreaterThan(0);
    // The other contexts a key could reach while the prompt box has focus (global and selection):
    // none of the new keys is bound there.
    for (const key of ["ctrl+x", "ctrl+z", "ctrl+y", "ctrl+shift+z", "shift+left", "ctrl+shift+left"]) {
      expect(DEFAULT_KEY_MAP.global[normaliseKey(key)]).toBeUndefined();
      expect(DEFAULT_KEY_MAP.selection[normaliseKey(key)]).toBeUndefined();
    }
  });

  test("Cut, Undo and Redo are palette entries; the selecting keys are keystroke-only", () => {
    for (const action of ["cut", "undo", "redo"]) expect(isPaletteAction("prompt", action)).toBe(true);
    for (const action of SELECTING) expect(isPaletteAction("prompt", action)).toBe(false);
    expect(KEY_ACTIONS.prompt).toEqual(expect.arrayContaining(["cut", "undo", "redo", ...SELECTING]));
  });

  test("key help lists every new action once with its keys, in the prompt box's group", () => {
    const items = helpItems(DEFAULT_KEY_MAP, 60);
    const entry = (action: string) => items.filter((i) => i.id === `help:prompt.${action}`);
    for (const action of [...SELECTING, "cut", "undo", "redo"]) {
      expect(entry(action)).toHaveLength(1);
      expect(entry(action)[0]!.group).toBe("Prompt box");
    }
    expect(entry("cut")[0]!.keys).toEqual(["ctrl+x"]);
    expect(entry("undo")[0]!.keys).toEqual(["ctrl+z", "super+z"]);
    expect(entry("selectWordLeft")[0]!.keys).toEqual(["ctrl+shift+left", "alt+shift+left"]);
  });

  test("they are rebindable like any key: an override moves cut, and null frees a key", () => {
    const map = loadKeyMap({ prompt: { "ctrl+k": "cut", "ctrl+x": null, "ctrl+z": null } });
    expect(keysFor(map, "prompt", "cut")).toEqual(["ctrl+k"]);
    expect(keysFor(map, "prompt", "undo")).toEqual(["super+z"]);
  });
});
