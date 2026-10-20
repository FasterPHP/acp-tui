// windows-support task 9.3 (design D7; spec tui-keymap "Newline key in Windows Terminal"): Ctrl+Enter
// is a newline key in both encodings Windows Terminal uses, and the splash and key help name
// `ctrl+enter` only where the terminal is Windows Terminal and the kitty keyboard protocol was not
// detected, `shift+enter` everywhere else.
import { afterEach, describe, expect, test } from "bun:test";
import { parseKeypress } from "@opentui/core";
import { splashHints } from "../../src/app/splash.ts";
import { DEFAULT_KEY_MAP, loadKeyMap } from "../../src/keys/keymap.ts";
import { ctrlEnterIsNewline, newlineKeyLabels, newlineLabel, setNewlineHintState, type NewlineHintState } from "../../src/keys/newline-hint.ts";
import { TERMINAL_IDS } from "../../src/renderer/terminal-ids.ts";
import { helpItems } from "../../src/overlay/help.ts";

const WT_OLD: NewlineHintState = { terminal: "windows-terminal", kitty: false };
const WT_KITTY: NewlineHintState = { terminal: "windows-terminal", kitty: true };

afterEach(() => setNewlineHintState({ terminal: "default", kitty: false }));

const newlineHelp = (map = DEFAULT_KEY_MAP) => helpItems(map, 80).find((i) => i.id === "help:prompt.newline")!.keys;
const splashNewline = (map = DEFAULT_KEY_MAP) => splashHints(map).find((h) => h.label === "newline")?.key;

describe("the binding", () => {
  test("ctrl+return is bound to newline in the prompt box, beside shift+return, meta+return, linefeed and ctrl+j", () => {
    expect(DEFAULT_KEY_MAP.prompt["ctrl+return"]).toBe("newline");
    expect(DEFAULT_KEY_MAP.prompt["shift+return"]).toBe("newline");
    expect(DEFAULT_KEY_MAP.prompt["meta+return"]).toBe("newline");
    expect(DEFAULT_KEY_MAP.prompt["linefeed"]).toBe("newline");
    expect(DEFAULT_KEY_MAP.prompt["ctrl+j"]).toBe("newline");
    // Enter alone still sends, and no other context takes Ctrl+Enter.
    expect(DEFAULT_KEY_MAP.prompt["return"]).toBe("submit");
    for (const context of ["global", "conversation", "selection", "find", "overlay", "card", "elicitation"] as const) {
      expect((DEFAULT_KEY_MAP[context] as Record<string, string>)["ctrl+return"], context).toBeUndefined();
    }
  });

  test("both encodings Windows Terminal uses parse to keys bound to newline: a line feed (1.24) and CSI 13;5u (1.25)", () => {
    // Windows Terminal 1.24: Ctrl+Enter is `\n`; OpenTUI names it `linefeed`, as for Ctrl+J.
    const legacy = parseKeypress("\n", { useKittyKeyboard: true });
    expect(legacy?.name).toBe("linefeed");
    expect(DEFAULT_KEY_MAP.prompt[legacy!.name]).toBe("newline");
    // Windows Terminal 1.25 under the kitty protocol: `return` with ctrl.
    const kitty = parseKeypress("\x1b[13;5u", { useKittyKeyboard: true });
    expect(kitty).toMatchObject({ name: "return", ctrl: true, shift: false });
    expect(DEFAULT_KEY_MAP.prompt["ctrl+return"]).toBe("newline");
    // Shift+Enter (1.25, kitty) and Ctrl+J (kitty) are untouched.
    expect(parseKeypress("\x1b[13;2u", { useKittyKeyboard: true })).toMatchObject({ name: "return", shift: true, ctrl: false });
    expect(parseKeypress("\x1b[106;5u", { useKittyKeyboard: true })).toMatchObject({ name: "j", ctrl: true });
    // IntelliJ's Shift+Enter, ESC CR, is meta+return.
    expect(parseKeypress("\x1b\r", { useKittyKeyboard: true })).toMatchObject({ name: "return", meta: true });
  });

  test("a user's override of Ctrl+Enter takes the key from newline like any other", () => {
    expect(loadKeyMap({ prompt: { "ctrl+enter": "submit" } }).prompt["ctrl+return"]).toBe("submit");
    expect(loadKeyMap({ prompt: { "ctrl+enter": null } }).prompt["ctrl+return"]).toBeUndefined();
  });
});

describe("the hint", () => {
  test("ctrl+enter only in Windows Terminal without the kitty protocol", () => {
    expect(ctrlEnterIsNewline(WT_OLD)).toBe(true);
    expect(ctrlEnterIsNewline(WT_KITTY)).toBe(false);
    for (const terminal of TERMINAL_IDS) {
      for (const kitty of [false, true]) {
        expect(ctrlEnterIsNewline({ terminal, kitty }), `${terminal} kitty=${kitty}`).toBe(terminal === "windows-terminal" && !kitty);
      }
    }
  });

  test("newlineLabel: scenario 'Older Windows Terminal' names ctrl+enter; 1.25, IntelliJ, Zed, a plain terminal name shift+enter", () => {
    expect(newlineLabel(DEFAULT_KEY_MAP, WT_OLD)).toBe("ctrl+enter");
    expect(newlineLabel(DEFAULT_KEY_MAP, WT_KITTY)).toBe("shift+enter");
    for (const terminal of TERMINAL_IDS) {
      if (terminal === "windows-terminal") continue;
      for (const kitty of [false, true]) expect(newlineLabel(DEFAULT_KEY_MAP, { terminal, kitty }), `${terminal} kitty=${kitty}`).toBe("shift+enter");
    }
  });

  test("the hint follows the map: Ctrl+Enter freed gives the first other key; Shift+Enter freed gives the next; no newline key gives null", () => {
    const noCtrlEnter = loadKeyMap({ prompt: { "ctrl+return": null } });
    expect(newlineLabel(noCtrlEnter, WT_OLD)).toBe("shift+enter");
    const noShift = loadKeyMap({ prompt: { "shift+return": null } });
    expect(newlineLabel(noShift, WT_KITTY)).toBe("alt+enter");
    const onlyCtrlEnter = loadKeyMap({ prompt: { "shift+return": null, "meta+return": null, linefeed: null, "ctrl+j": null } });
    expect(newlineLabel(onlyCtrlEnter, WT_KITTY)).toBe("ctrl+enter");
    const none = loadKeyMap({ prompt: { "shift+return": null, "meta+return": null, "ctrl+return": null, linefeed: null, "ctrl+j": null } });
    expect(newlineLabel(none, WT_OLD)).toBeNull();
  });

  test("key help lists ctrl+enter first and drops shift+enter and alt+enter in Windows Terminal without kitty (alt+enter in all of it); elsewhere the list is what it was", () => {
    expect(newlineKeyLabels(DEFAULT_KEY_MAP, WT_OLD)).toEqual(["ctrl+enter", "ctrl+j"]);
    // Windows Terminal keeps Alt+Enter in every version; with kitty, Shift+Enter arrives.
    expect(newlineKeyLabels(DEFAULT_KEY_MAP, WT_KITTY)).toEqual(["shift+enter", "ctrl+j"]);
    expect(newlineKeyLabels(DEFAULT_KEY_MAP, { terminal: "jetbrains", kitty: false })).toEqual(["shift+enter", "alt+enter", "ctrl+j"]);
    expect(newlineKeyLabels(DEFAULT_KEY_MAP, { terminal: "zed", kitty: true })).toEqual(["shift+enter", "alt+enter", "ctrl+j"]);
  });

  test("the splash and key help read the state that start-up sets, and change when the kitty answer arrives", () => {
    // Nothing set: the default terminal, as on Linux and macOS.
    expect(splashNewline()).toBe("shift+enter");
    expect(newlineHelp()).toEqual(["shift+enter", "alt+enter", "ctrl+j"]);
    setNewlineHintState(WT_OLD);
    expect(splashNewline()).toBe("ctrl+enter");
    expect(newlineHelp()).toEqual(["ctrl+enter", "ctrl+j"]);
    setNewlineHintState(WT_KITTY);
    expect(splashNewline()).toBe("shift+enter");
    expect(newlineHelp()).toEqual(["shift+enter", "ctrl+j"]);
    setNewlineHintState({ terminal: "jetbrains", kitty: false });
    expect(splashNewline()).toBe("shift+enter");
  });
});
