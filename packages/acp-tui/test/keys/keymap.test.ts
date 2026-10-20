// Tasks 8.1 (phase 1a) and 8.3 (Phase 0): the key map object, its contexts
// (`global`, `prompt`, `conversation`, `card`), normalisation, conflict
// detection at load (spec tui-keymap "Bindings are data", scenario "Conflict
// detected"), unbinding, the command catalogue's titles and hint labels taken
// from the key map.
import { describe, expect, test } from "bun:test";
import { DEFAULT_HINTS } from "../../src/layout/modules.ts";
import { hintsForKeyMap } from "../../src/keys/hints.ts";
import {
  COMMAND_TITLES,
  commandName,
  DEFAULT_KEY_MAP,
  KEY_ACTIONS,
  KEY_CONTEXTS,
  KeyMapError,
  actionLabel,
  keyLabel,
  keysFor,
  loadKeyMap,
  normaliseKey,
  validateKeyMap,
} from "../../src/keys/keymap.ts";

function loadError(input: Parameters<typeof validateKeyMap>[0]): KeyMapError {
  try {
    validateKeyMap(input);
  } catch (error) {
    expect(error).toBeInstanceOf(KeyMapError);
    return error as KeyMapError;
  }
  throw new Error("expected a KeyMapError");
}

describe("normaliseKey", () => {
  test.each([
    ["Ctrl+O", "ctrl+o"],
    ["ctrl+o", "ctrl+o"],
    ["control+O", "ctrl+o"],
    ["Shift+Enter", "shift+return"],
    ["enter", "return"],
    ["Esc", "escape"],
    ["alt+return", "meta+return"],
    ["option+Return", "meta+return"],
    ["shift+ctrl+j", "ctrl+shift+j"],
    ["linefeed", "linefeed"],
    ["1", "1"],
    ["ctrl++", "ctrl++"],
  ])("%s -> %s", (input, expected) => {
    expect(normaliseKey(input)).toBe(expected);
  });

  test("rejects an unknown modifier and an empty key", () => {
    expect(() => normaliseKey("hyperx+a")).toThrow("'hyperx' is not a modifier");
    expect(() => normaliseKey("")).toThrow("is not a key");
    expect(() => normaliseKey("ctrl+")).toThrow("is not a key");
  });
});

describe("conflict detection", () => {
  test("spec scenario: Ctrl+O bound to both toggle latest tool call and repaint in the global context", () => {
    const error = loadError({ global: { "ctrl+o": "toggleTool", "Ctrl+O": "repaint" } });
    expect(error.problems).toEqual(["global: conflict on ctrl+o: bound to both 'toggleTool' and 'repaint'"]);
    expect(error.message).toContain("conflict on ctrl+o: bound to both 'toggleTool' and 'repaint'");
    // Loading it over the defaults fails the same way.
    expect(() => loadKeyMap({ global: { "ctrl+o": "toggleTool", "control+o": "repaint" } })).toThrow(
      "global: conflict on ctrl+o: bound to both 'toggleTool' and 'repaint'",
    );
  });

  test("two spellings of one key for unknown actions are still a conflict", () => {
    const error = loadError({ prompt: { "ctrl+o": "expand", "Ctrl+O": "redraw" } });
    expect(error.problems).toContain("prompt: conflict on ctrl+o: bound to both 'expand' and 'redraw'");
  });

  test("the same key for the same action twice is not a conflict", () => {
    const map = validateKeyMap({ prompt: { "shift+return": "newline", "Shift+Enter": "newline" } });
    expect(map.prompt).toEqual({ "shift+return": "newline" });
  });

  test("the same key in different contexts is not a conflict", () => {
    const map = validateKeyMap({ global: { "1": "toggleFocus" }, card: { "1": "choose1" } });
    expect(map.global["1"]).toBe("toggleFocus");
    expect(map.card["1"]).toBe("choose1");
  });

  test("every problem is reported: unknown context, unknown action, bad key", () => {
    const error = loadError({
      picker: { x: "y" },
      prompt: { return: "explode", "bogus+x": "submit" },
    } as never);
    expect(error.problems).toEqual([
      "unknown context 'picker' (expected one of global, prompt, conversation, card, overlay, elicitation, selection, find)",
      `prompt: unknown action 'explode' for return (expected one of ${KEY_ACTIONS.prompt.join(", ")})`,
      "prompt: 'bogus+x': 'bogus' is not a modifier",
    ]);
  });
});

describe("loadKeyMap", () => {
  test("the defaults validate and match design 6.6", () => {
    expect(DEFAULT_KEY_MAP.global).toEqual({
      escape: "escape",
      // No Ctrl+C: it is the selection's `copy` only, and `interrupt` has no default key
      // (mvp-chrome-and-keys task 3.1).
      "ctrl+d": "detach",
      tab: "toggleFocus",
      "ctrl+o": "toggleTool",
      "ctrl+l": "repaint",
      f2: "toggleMouse",
      pageup: "pageUp",
      pagedown: "pageDown",
      // The palette (src/overlay/Overlay.tsx, mvp-chrome-and-keys task 6.1).
      "ctrl+p": "palette",
      // Find (decision 16; src/find/).
      "ctrl+f": "find",
      f3: "findNext",
      "shift+f3": "findPrevious",
      // mvp-chrome-and-keys (task 3.7, design D16): the mode and effort cycles and key help (src/overlay/Overlay.tsx).
      "shift+tab": "cycleMode",
      "ctrl+t": "cycleThoughtLevel",
      f1: "keyHelp",
    });
    expect(keysFor(DEFAULT_KEY_MAP, "prompt", "newline")).toEqual(["shift+return", "meta+return", "ctrl+return", "linefeed", "ctrl+j"]);
    expect(keysFor(DEFAULT_KEY_MAP, "prompt", "submit")).toEqual(["return"]);
    expect(keysFor(DEFAULT_KEY_MAP, "prompt", "lineUp")).toEqual(["up"]);
    expect(keysFor(DEFAULT_KEY_MAP, "prompt", "lineDown")).toEqual(["down"]);
    // `?` in an empty prompt box opens the command palette and `/` the agent's commands (Marcus,
    // 11 October 2026; mvp-chrome-and-keys task 12.1; `/` opened the one palette from 3 October).
    expect(keysFor(DEFAULT_KEY_MAP, "prompt", "palette")).toEqual(["?"]);
    expect(actionLabel(DEFAULT_KEY_MAP, "prompt", "palette")).toBe("?");
    expect(keysFor(DEFAULT_KEY_MAP, "prompt", "agentCommands")).toEqual(["/"]);
    expect(actionLabel(DEFAULT_KEY_MAP, "prompt", "agentCommands")).toBe("/");
    // The permission card: digits select, Left and Right move, Enter answers (decision 1 by
    // Marcus); Esc returns to the prompt box.
    expect(DEFAULT_KEY_MAP.card).toEqual({
      ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [String(i + 1), `choose${i + 1}`])),
      left: "previous",
      right: "next",
      return: "confirm",
      escape: "back",
      // The preview's keys (mvp-chrome-and-keys task 5.1).
      up: "scrollUp",
      down: "scrollDown",
      pageup: "pageUp",
      pagedown: "pageDown",
      home: "top",
      end: "bottom",
      "ctrl+o": "grow",
    });
    // The conversation (task 7.4, spec tui-keymap "Conversation keys"): shift+g is `G`.
    expect(DEFAULT_KEY_MAP.conversation).toEqual({
      up: "up",
      k: "up",
      down: "down",
      j: "down",
      home: "first",
      g: "first",
      end: "last",
      "shift+g": "last",
      return: "toggle",
      escape: "back",
      // SPIKE (phase-1a, S4): copy the item under the cursor (design 6.6), bound only under
      // `--spike select`.
      y: "copyItem",
      "shift+y": "copyItemMarkdown",
      // SPIKE (phase-1a, S5): export the conversation as Markdown, bound only under `--spike find`.
      e: "export",
      // mvp-conversation: the density key (task 4.4) and the jumps (task 3.3).
      v: "cycleDensity",
      "{": "previousPrompt",
      "}": "nextPrompt",
      "[": "previousTool",
      "]": "nextTool",
      o: "openLink",
      // mvp-rendering (task 9.3, design open question 6): `a` ("all") shows a tool's whole output.
      a: "expandOutput",
    });
    // The three single-density actions are gone (day-two-feedback task 13.7): only the cycle remains.
    for (const action of ["densityCompact", "densityVerbose", "densityFocus"]) {
      expect([action, (KEY_ACTIONS.conversation as readonly string[]).includes(action)]).toEqual([action, false]);
      expect(Object.keys(COMMAND_TITLES.conversation)).not.toContain(action);
    }
    expect(commandName("conversation", "cycleDensity")).toBe("conversation.cycleDensity");
    // The selection layer (always mounted): Ctrl+C and Ctrl+Shift+C copy, Esc clears.
    expect(DEFAULT_KEY_MAP.selection).toEqual({ "ctrl+c": "copy", "ctrl+shift+c": "copyRich", escape: "clear" });
    // SPIKE (phase-1a, S5): the find bar, bound only under `--spike find`.
    expect(DEFAULT_KEY_MAP.find).toEqual({
      return: "next",
      "shift+return": "previous",
      "meta+return": "previous",
      // Windows Terminal 1.25 sends Ctrl+Enter as CSI 13;5u.
      "ctrl+return": "previous",
      // Zed sends Shift+Enter as a bare `\n` (S5, "Reaching find in the IDEs").
      linefeed: "previous",
      escape: "close",
      tab: "conversation",
      "ctrl+u": "clear",
    });
  });

  test("an override replaces the default binding of the same key, spelt any way", () => {
    const map = loadKeyMap({ global: { "Ctrl+L": "toggleTool" } });
    expect(map.global["ctrl+l"]).toBe("toggleTool");
    expect(keysFor(map, "global", "toggleTool")).toEqual(["ctrl+o", "ctrl+l"]);
    expect(keysFor(map, "global", "repaint")).toEqual([]);
  });

  test("null unbinds a default key, so an action can move to another key", () => {
    const map = loadKeyMap({ global: { "ctrl+q": "detach", "Ctrl+D": null } });
    expect(keysFor(map, "global", "detach")).toEqual(["ctrl+q"]);
    expect(map.global["ctrl+d"]).toBeUndefined();
    expect(actionLabel(map, "global", "detach")).toBe("ctrl+q");
    expect(() => loadKeyMap({ global: { "ctrl+d": null, "Ctrl+D": "detach" } })).toThrow(
      "global: conflict on ctrl+d: bound to both nothing (null) and 'detach'",
    );
  });

  test("conflicts inside the overrides are reported", () => {
    expect(() => loadKeyMap({ global: { "ctrl+l": "repaint", "Ctrl+L": "toggleTool" } })).toThrow(
      "conflict on ctrl+l: bound to both 'repaint' and 'toggleTool'",
    );
  });
});

// mvp-chrome-and-keys task 3.7: the D16 action catalogue, reconciled across the five MVP changes,
// as data: each action's context and its default keys (none for palette-only actions).
const D16_CATALOGUE: readonly { context: (typeof KEY_CONTEXTS)[number]; action: string; keys: readonly string[] }[] = [
  { context: "global", action: "escape", keys: ["escape"] },
  { context: "global", action: "interrupt", keys: [] },
  { context: "global", action: "detach", keys: ["ctrl+d"] },
  { context: "global", action: "toggleTool", keys: ["ctrl+o"] },
  { context: "global", action: "repaint", keys: ["ctrl+l"] },
  { context: "global", action: "toggleMouse", keys: ["f2"] },
  { context: "global", action: "palette", keys: ["ctrl+p"] },
  { context: "prompt", action: "palette", keys: ["?"] },
  { context: "prompt", action: "agentCommands", keys: ["/"] },
  { context: "global", action: "pickMode", keys: [] },
  { context: "global", action: "pickModel", keys: [] },
  { context: "global", action: "pickThoughtLevel", keys: [] },
  { context: "global", action: "cycleMode", keys: ["shift+tab"] },
  { context: "global", action: "cycleThoughtLevel", keys: ["ctrl+t"] },
  { context: "global", action: "keyHelp", keys: ["f1"] },
  { context: "global", action: "sessions", keys: [] },
  { context: "global", action: "configProblems", keys: [] },
  { context: "global", action: "find", keys: ["ctrl+f"] },
  { context: "global", action: "findNext", keys: ["f3"] },
  { context: "global", action: "findPrevious", keys: ["shift+f3"] },
  { context: "prompt", action: "paste", keys: ["ctrl+v", "ctrl+shift+v", "meta+v"] },
  { context: "selection", action: "copy", keys: ["ctrl+c"] },
  { context: "selection", action: "copyRich", keys: ["ctrl+shift+c"] },
  { context: "selection", action: "clear", keys: ["escape"] },
  { context: "conversation", action: "copyItem", keys: ["y"] },
  { context: "conversation", action: "copyItemMarkdown", keys: ["shift+y"] },
  { context: "conversation", action: "export", keys: ["e"] },
  { context: "conversation", action: "cycleDensity", keys: ["v"] },
  { context: "conversation", action: "previousPrompt", keys: ["{"] },
  { context: "conversation", action: "nextPrompt", keys: ["}"] },
  { context: "conversation", action: "previousTool", keys: ["["] },
  { context: "conversation", action: "nextTool", keys: ["]"] },
  { context: "conversation", action: "openLink", keys: ["o"] },
  { context: "conversation", action: "expandOutput", keys: ["a"] },
  { context: "overlay", action: "toggleScope", keys: ["tab"] },
];

describe("the action catalogue (mvp-chrome-and-keys task 3.7, design D16)", () => {
  test("Defaults load without conflict, with the actions of every MVP change registered and bound", () => {
    // Loading validates every context: an unknown action or a key bound twice would throw.
    expect(() => loadKeyMap()).not.toThrow();
    for (const { context, action, keys } of D16_CATALOGUE) {
      expect([context, action, (KEY_ACTIONS[context] as readonly string[]).includes(action)]).toEqual([context, action, true]);
      expect([context, action, keysFor(DEFAULT_KEY_MAP, context, action as never)]).toEqual([context, action, [...keys]]);
    }
    // The scenario's own list.
    const c = DEFAULT_KEY_MAP.conversation;
    expect([c["v"], c["y"], c["shift+y"], c["e"], c["{"], c["}"], c["["], c["]"], c["o"], c["a"]]).toEqual([
      "cycleDensity",
      "copyItem",
      "copyItemMarkdown",
      "export",
      "previousPrompt",
      "nextPrompt",
      "previousTool",
      "nextTool",
      "openLink",
      "expandOutput",
    ]);
    expect([DEFAULT_KEY_MAP.selection["ctrl+c"], DEFAULT_KEY_MAP.selection["ctrl+shift+c"]]).toEqual(["copy", "copyRich"]);
    expect([DEFAULT_KEY_MAP.prompt["ctrl+v"], DEFAULT_KEY_MAP.prompt["ctrl+shift+v"], DEFAULT_KEY_MAP.prompt["meta+v"]]).toEqual(["paste", "paste", "paste"]);
    // Ctrl+V stays the label hints and notices use.
    expect(actionLabel(DEFAULT_KEY_MAP, "prompt", "paste")).toBe("ctrl+v");
    expect([DEFAULT_KEY_MAP.prompt["?"], DEFAULT_KEY_MAP.prompt["/"]]).toEqual(["palette", "agentCommands"]);
    expect([DEFAULT_KEY_MAP.global["shift+tab"], DEFAULT_KEY_MAP.global["ctrl+t"], DEFAULT_KEY_MAP.global["f1"]]).toEqual(["cycleMode", "cycleThoughtLevel", "keyHelp"]);
  });

  test("every action ID is camelCase and unique within its context, and has a title", () => {
    for (const context of KEY_CONTEXTS) {
      const actions = KEY_ACTIONS[context] as readonly string[];
      expect([context, new Set(actions).size]).toEqual([context, actions.length]);
      for (const action of actions) {
        expect([context, action, /^[a-z][a-zA-Z0-9]*$/.test(action)]).toEqual([context, action, true]);
        expect((COMMAND_TITLES[context] as Record<string, string>)[action]?.length ?? 0).toBeGreaterThan(0);
      }
      expect(Object.keys(COMMAND_TITLES[context]).sort()).toEqual([...actions].sort());
    }
  });
});

describe("labels and hints", () => {
  // Every label fully lower case (Marcus, 11 October 2026; mvp-chrome-and-keys task 12.8).
  test.each([
    ["ctrl+c", "ctrl+c"],
    ["Ctrl+F", "ctrl+f"],
    ["shift+return", "shift+enter"],
    ["meta+return", "alt+enter"],
    ["Alt+V", "alt+v"],
    ["ctrl+shift+v", "ctrl+shift+v"],
    ["escape", "esc"],
    ["linefeed", "ctrl+j"],
    ["tab", "tab"],
    ["shift+tab", "shift+tab"],
    ["up", "up"],
    ["pageup", "pgup"],
    ["pagedown", "pgdn"],
    ["f1", "f1"],
    ["shift+f3", "shift+f3"],
    ["y", "y"],
    ["shift+y", "shift+y"],
    ["1", "1"],
    ["?", "?"],
    ["{", "{"],
  ])("keyLabel(%s) = %s", (key, label) => {
    expect(keyLabel(key)).toBe(label);
  });

  test("lower-case keys (task 12.8): no label of the default key map holds an upper-case letter", () => {
    for (const context of KEY_CONTEXTS) {
      for (const key of Object.keys(DEFAULT_KEY_MAP[context])) expect([context, key, keyLabel(key)]).toEqual([context, key, keyLabel(key).toLowerCase()]);
    }
    expect(actionLabel(DEFAULT_KEY_MAP, "global", "find")).toBe("ctrl+f");
    expect(actionLabel(DEFAULT_KEY_MAP, "global", "cycleMode")).toBe("shift+tab");
    expect(actionLabel(DEFAULT_KEY_MAP, "global", "escape")).toBe("esc");
    expect(actionLabel(DEFAULT_KEY_MAP, "global", "pageUp")).toBe("pgup");
    expect(actionLabel(DEFAULT_KEY_MAP, "global", "keyHelp")).toBe("f1");
    expect(actionLabel(DEFAULT_KEY_MAP, "conversation", "copyItemMarkdown")).toBe("shift+y");
  });

  test("the default hints read their keys from the default key map", () => {
    expect(DEFAULT_HINTS.map((h) => `${h.key} ${h.label}`)).toEqual([
      "tab tab permission",
      "1-9 select",
      "enter answer",
      "tab prompt",
      "enter toggle",
      "esc prompt",
      "tab permission",
      "esc esc interrupt",
      "shift+tab mode",
      "/ commands",
      "? help",
      "ctrl+d detach",
    ]);
  });

  test("rebinding a key changes its hint; an unbound action has no hint", () => {
    const map = loadKeyMap({ global: { "ctrl+x": "interrupt", "ctrl+d": "repaint" } });
    const hints = hintsForKeyMap(map);
    expect(actionLabel(DEFAULT_KEY_MAP, "global", "interrupt")).toBeNull();
    expect(actionLabel(map, "global", "interrupt")).toBe("ctrl+x");
    expect(actionLabel(map, "global", "detach")).toBeNull();
    expect(hints.some((h) => h.label === "detach")).toBe(false);
    // No send or newline hints (mvp-chrome-and-keys design D5); the palette and mode keys follow
    // their bindings.
    const swapped = hintsForKeyMap(
      loadKeyMap({ prompt: { "/": null, "ctrl+s": "agentCommands", "?": null, "ctrl+k": "palette" }, global: { "shift+tab": null, f6: "cycleMode" } }),
    );
    expect(swapped.find((h) => h.label === "commands")?.key).toBe("ctrl+s");
    expect(swapped.find((h) => h.label === "help")?.key).toBe("ctrl+k");
    expect(swapped.find((h) => h.label === "mode")?.key).toBe("f6");
    expect(swapped.some((h) => h.label === "send" || h.label === "newline")).toBe(false);
  });

  test("the card and interrupt hints name the rebound keys, doubled where two presses are needed", () => {
    const map = loadKeyMap({ global: { "ctrl+k": "toggleFocus", "ctrl+g": "escape", tab: "findNext", escape: "findPrevious" } });
    const hints = hintsForKeyMap(map);
    const toCard = hints.filter((h) => h.label === "permission");
    expect(toCard.map((h) => [h.key, h.when?.focus])).toEqual([
      ["ctrl+k ctrl+k", "prompt"],
      ["ctrl+k", "conversation"],
    ]);
    expect(hints.find((h) => h.label === "interrupt")?.key).toBe("ctrl+g ctrl+g");
    // Under `interrupt: single` one press interrupts, and the hint says so (mvp-configuration D13).
    expect(hintsForKeyMap(map, "single").find((h) => h.label === "interrupt")?.key).toBe("ctrl+g");
    expect(hintsForKeyMap(DEFAULT_KEY_MAP, "single").find((h) => h.label === "interrupt")?.key).toBe("esc");
  });
});

describe("command catalogue", () => {
  test("every action of every context has a title and one command name", () => {
    const names = new Set<string>();
    for (const context of KEY_CONTEXTS) {
      for (const action of KEY_ACTIONS[context]) {
        const titles = COMMAND_TITLES[context] as Record<string, string>;
        expect(titles[action]?.length ?? 0).toBeGreaterThan(0);
        names.add(commandName(context, action as never));
      }
      // No title for an action the context does not offer.
      expect(Object.keys(COMMAND_TITLES[context]).sort()).toEqual([...KEY_ACTIONS[context]].sort());
    }
    expect(names.size).toBe(KEY_CONTEXTS.reduce((n, c) => n + KEY_ACTIONS[c].length, 0));
    expect(commandName("global", "toggleMouse")).toBe("global.toggleMouse");
  });

  test("F2 is labelled f2 (task 12.8)", () => {
    expect(actionLabel(DEFAULT_KEY_MAP, "global", "toggleMouse")).toBe("f2");
  });
});
