// mvp-configuration tasks 8.1 to 8.4 (spec tui-keymap "Key overrides from the
// configuration", "Key override validation", "Essential actions keep a key"
// and "Kept keys per terminal"; tui-config "Configuration schema"): the `keys`
// section merged over the built-in map, each entry checked on its own, the
// problems placed in the file, the kept-key warnings for the terminal in use
// and for `config --check`, and the schema's action names.
import { describe, expect, test } from "bun:test";
import { createRoot } from "solid-js";
import { parseConfigText } from "../../src/config/load.ts";
import { ConfigSchema, SECTIONS } from "../../src/config/schema.ts";
import { jsonSchemaText } from "../../src/config/json-schema.ts";
import { keyCheckProblems, keysFromConfig } from "../../src/keys/from-config.ts";
import { keptKeyCheckWarnings, keptKeyWarnings, keptKeysTerminal } from "../../src/keys/kept.ts";
import { actionLabel, DEFAULT_KEY_MAP, KEY_ACTIONS, KEY_CONTEXTS, keysFor } from "../../src/keys/keymap.ts";
import { createLiveKeyMap, liveControl } from "../../src/keys/live.ts";
import { resolveKeyOverrides, type KeysSection } from "../../src/keys/overrides.ts";
import { hintsForKeyMap } from "../../src/keys/hints.ts";

const FILE = "/home/u/.config/acp-tui/config.jsonc";
const FILES = { user: FILE, project: null };

/** The effective `keys` section of a file's text, as the loader gives it. */
function keysOf(text: string): KeysSection {
  const parsed = parseConfigText(text, FILE);
  expect(parsed.rejected).toEqual([]);
  return SECTIONS.keys.parse(parsed.sections.keys ?? {}) as KeysSection;
}

describe("Key overrides from the configuration (task 8.1)", () => {
  test("Extra key for an action: y and c both copy the item under the cursor", () => {
    const { map, problems } = resolveKeyOverrides(keysOf(`{ "keys": { "conversation": { "c": "copyItem" } } }`));
    expect(problems).toEqual([]);
    expect(keysFor(map, "conversation", "copyItem")).toEqual(["y", "c"]);
  });

  test("Key taken from another action: v exports the conversation, and the density is cycled only from the palette", () => {
    const { map, problems } = resolveKeyOverrides(keysOf(`{ "keys": { "conversation": { "v": "export" } } }`));
    expect(problems).toEqual([]);
    expect(map.conversation["v"]).toBe("export");
    expect(keysFor(map, "conversation", "export")).toEqual(["e", "v"]);
    expect(keysFor(map, "conversation", "cycleDensity")).toEqual([]);
  });

  test("Default removed and rebound: ctrl+d unbound, ctrl+q detaches, and the armed label is ctrl+q", () => {
    const { map, problems } = resolveKeyOverrides(keysOf(`{ "keys": { "global": { "ctrl+d": null, "ctrl+q": "detach" } } }`));
    expect(problems).toEqual([]);
    expect(map.global["ctrl+d"]).toBeUndefined();
    expect(actionLabel(map, "global", "detach")).toBe("ctrl+q");
    // The idle hint for detach follows.
    expect(hintsForKeyMap(map).find((h) => h.label === "detach")?.key).toBe("ctrl+q");
  });

  test("a live key map swaps whole: readers see the new map, subscribers are told in order, and tracked readers re-run", () => {
    createRoot((dispose) => {
      const live = createLiveKeyMap(DEFAULT_KEY_MAP);
      const seen: string[] = [];
      const control = liveControl(live)!;
      expect(liveControl(DEFAULT_KEY_MAP)).toBeNull();
      control.subscribe(() => seen.push("first"));
      control.subscribe(() => seen.push("second"));
      expect(actionLabel(live, "global", "detach")).toBe("ctrl+d");
      control.set(resolveKeyOverrides({ global: { "ctrl+d": null, "ctrl+q": "detach" } }).map);
      expect(actionLabel(live, "global", "detach")).toBe("ctrl+q");
      expect(seen).toEqual(["first", "second"]);
      expect(Object.keys(live).sort()).toEqual([...KEY_CONTEXTS].sort());
      dispose();
    });
  });
});

describe("Key override validation (task 8.2)", () => {
  test("Two spellings of one key: a problem names ctrl+o, repaint and toggleTool in the global context, and ctrl+o keeps its default action", () => {
    const text = ['{ "keys": { "global": {', '  "Ctrl+O": "repaint",', '  "ctrl+o": "toggleTool"', "} } }"].join("\n");
    const { map, problems } = keysFromConfig(keysOf(text), FILES, { terminal: null, read: () => text });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ file: FILE, line: 2, column: 3, path: "keys.global.Ctrl+O", severity: "error" });
    for (const word of ["ctrl+o", "repaint", "toggleTool", "global"]) expect(problems[0]!.message).toContain(word);
    expect(map.global["ctrl+o"]).toBe("toggleTool");
    expect(map).toEqual(DEFAULT_KEY_MAP);
  });

  test("Untypeable letter: a problem says q would no longer type in the prompt box, and q is not bound", () => {
    const { map, problems } = resolveKeyOverrides({ prompt: { q: "paste" } });
    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain("q would no longer type in the prompt box");
    expect(map.prompt["q"]).toBeUndefined();
    // Shift and a letter types its capital; Space a space; in the find bar and the lists' filter too.
    expect(resolveKeyOverrides({ find: { "shift+q": "next" } }).problems[0]!.message).toContain("Q would no longer type in the find bar");
    expect(resolveKeyOverrides({ overlay: { space: "choose" } }).problems[0]!.message).toContain("space would no longer type in a list's filter");
    // With Ctrl or Alt it is fine, and so is a printable key outside the text-input contexts.
    expect(resolveKeyOverrides({ prompt: { "ctrl+q": "paste", "alt+q": "paste" }, conversation: { c: "copyItem" } }).problems).toEqual([]);
  });

  test("Opener on another character: ? unbound and ; opening the palette is no problem", () => {
    const { map, problems } = resolveKeyOverrides({ prompt: { "?": null, ";": "palette" } });
    expect(problems).toEqual([]);
    expect(keysFor(map, "prompt", "palette")).toEqual([";"]);
    expect(map.prompt["?"]).toBeUndefined();
    // The slash menu's opener may move too.
    expect(resolveKeyOverrides({ prompt: { "/": null, "!": "agentCommands" } }).problems).toEqual([]);
  });

  test("Unknown action: copyItm is unknown in the conversation context, with copyItem suggested", () => {
    const text = `{ "keys": { "conversation": { "x": "copyItm" } } }`;
    const { map, problems } = keysFromConfig(keysOf(text), FILES, { terminal: null, read: () => text });
    expect(problems).toEqual([expect.objectContaining({ path: "keys.conversation.x", severity: "error", suggestion: "copyItem", line: 1, column: 31 })]);
    expect(problems[0]!.message).toContain('"copyItm" is not an action of the conversation context');
    expect(map.conversation["x"]).toBeUndefined();
  });

  test("the single-density actions are gone (day-two-feedback task 13.7): an override naming one is an unknown action, as any other, and nothing crashes", () => {
    const text = `{ "keys": { "conversation": { "d": "densityCompact", "c": "copyItem" } } }`;
    const { map, problems } = keysFromConfig(keysOf(text), FILES, { terminal: null, read: () => text });
    expect(problems).toEqual([expect.objectContaining({ path: "keys.conversation.d", severity: "error" })]);
    expect(problems[0]!.message).toContain('"densityCompact" is not an action of the conversation context');
    expect(map.conversation["d"]).toBeUndefined();
    expect(map.conversation["c"]).toBe("copyItem");
  });

  test("an unparseable key and an unknown context are reported, and the other entries apply", () => {
    const { map, problems } = resolveKeyOverrides({ conversation: { "hyper+x": "copyItem", c: "copyItem" } });
    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain("'hyper' is not a modifier");
    expect(map.conversation["c"]).toBe("copyItem");
    const parsed = parseConfigText(`{ "keys": { "conversatoin": { "c": "copyItem" } } }`, FILE);
    expect(parsed.problems).toEqual([expect.objectContaining({ path: "keys.conversatoin", severity: "warning", suggestion: "conversation" })]);
  });

  test("Last send key removed: a problem says submit would have no key, and Enter still sends", () => {
    const { map, problems } = resolveKeyOverrides({ prompt: { return: null } });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ path: ["keys", "prompt", "return"], severity: "error" });
    expect(problems[0]!.message).toContain("submit with no key");
    expect(map.prompt["return"]).toBe("submit");
    // Taking the key for another action is refused the same way, and so are the other essentials.
    expect(resolveKeyOverrides({ prompt: { return: "newline" } }).map.prompt["return"]).toBe("submit");
    expect(resolveKeyOverrides({ global: { "ctrl+d": null } }).problems[0]!.message).toContain("detach with no key");
    expect(resolveKeyOverrides({ card: { return: null } }).problems[0]!.message).toContain("confirm with no key");
    const newline = resolveKeyOverrides({ prompt: { "shift+return": null, "meta+return": null, "ctrl+return": null, linefeed: null, "ctrl+j": null } });
    expect(newline.problems).toHaveLength(5);
    expect(keysFor(newline.map, "prompt", "newline")).toHaveLength(5);
    // Moving submit to another key first is fine.
    expect(resolveKeyOverrides({ prompt: { return: null, "ctrl+s": "submit" } }).problems).toEqual([]);
  });

  test("Palette keeps one route: ctrl+p unbound is no problem while ? opens the palette; both unbound is refused", () => {
    expect(resolveKeyOverrides({ global: { "ctrl+p": null } }).problems).toEqual([]);
    const both = resolveKeyOverrides({ global: { "ctrl+p": null }, prompt: { "?": null } });
    expect(both.problems.map((p) => p.path.join("."))).toEqual(["keys.global.ctrl+p", "keys.prompt.?"]);
    expect(both.map.global["ctrl+p"]).toBe("palette");
  });

  test("a project file's entries are placed in it: it wins over the user's file", () => {
    const user = `{ "keys": { "conversation": { "x": "copyItm" } } }`;
    const project = `{\n  "keys": { "conversation": { "x": "copyItm" } } }`;
    const problems = keysFromConfig({ conversation: { x: "copyItm" } }, { user: FILE, project: "/work/.acp-tui.jsonc" }, {
      terminal: null,
      read: (f) => (f === FILE ? user : project),
    }).problems;
    expect(problems[0]).toMatchObject({ file: "/work/.acp-tui.jsonc", line: 2 });
  });
});

describe("Kept keys per terminal (task 8.3)", () => {
  test("the terminal from the environment: both PhpStorm engines are jetbrains, Zed is zed, others none", () => {
    expect(keptKeysTerminal({ TERMINAL_EMULATOR: "JetBrains-JediTerm" })).toBe("jetbrains");
    expect(keptKeysTerminal({ TERM_PROGRAM: "zed" })).toBe("zed");
    expect(keptKeysTerminal({ TERM_PROGRAM: "ghostty" })).toBeNull();
    // The per-terminal table's detection decides (renderer/capabilities.ts `detectTerminal`): the
    // same variables in the same order, the values compared without case.
    expect(keptKeysTerminal({ TERM_PROGRAM: "Zed" })).toBe("zed");
    expect(keptKeysTerminal({ TERM: "xterm-kitty" })).toBeNull();
    expect(keptKeysTerminal({ TERMINAL_EMULATOR: "JetBrains-JediTerm", TERM_PROGRAM: "zed" })).toBe("jetbrains");
    expect(keptKeysTerminal({})).toBeNull();
    // Windows Terminal (windows-support task 9.4): WT_SESSION, tried last, so IntelliJ started from it
    // (which inherits WT_SESSION) is still jetbrains.
    expect(keptKeysTerminal({ WT_SESSION: "5f2c3a1e-8d9b-4c6a-9e0f-7b1d2a3c4e5f" })).toBe("windows-terminal");
    expect(keptKeysTerminal({ TERMINAL_EMULATOR: "JetBrains-JediTerm", WT_SESSION: "x" })).toBe("jetbrains");
    expect(keptKeysTerminal({ TERM_PROGRAM: "zed", WT_SESSION: "x" })).toBe("zed");
  });

  test("Override on a kept key: Alt+Enter bound to an action warns that Windows Terminal keeps it and names the action's other routes", () => {
    const section: KeysSection = { conversation: { "alt+return": "export" } };
    const { map, problems } = keysFromConfig(section, FILES, { terminal: keptKeysTerminal({ WT_SESSION: "x" }), read: () => `{ "keys": { "conversation": { "alt+return": "export" } } }` });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ severity: "warning", path: "keys.conversation.alt+return" });
    expect(problems[0]!.message).toBe("Windows Terminal keeps alt+enter, so it may never reach acp-tui there; the routes to export there are e and the palette");
    expect(map.conversation["meta+return"]).toBe("export");
    // The same key is no warning in a terminal that does not keep it, and none of Windows Terminal's
    // own commands is bound by default.
    expect(keptKeyWarnings(section, map, "jetbrains")).toEqual([]);
    expect(keptKeyWarnings({ conversation: { "ctrl+shift+p": "export" } }, resolveKeyOverrides({ conversation: { "ctrl+shift+p": "export" } }).map, "windows-terminal")).toHaveLength(1);
    // config --check reports it whatever the terminal running the check.
    const checked = keptKeyCheckWarnings(section, map);
    expect(checked.map((w) => w.message)).toEqual([expect.stringContaining("Windows Terminal keeps alt+enter")]);
  });

  test("Ctrl+P in Zed: a warning says Zed keeps ctrl+p and names f3, ctrl+f and the palette as the routes to find; ? still opens the palette", () => {
    const section: KeysSection = { global: { "ctrl+p": "find" } };
    const { map, problems } = keysFromConfig(section, FILES, { terminal: keptKeysTerminal({ TERM_PROGRAM: "zed" }), read: () => `{ "keys": { "global": { "ctrl+p": "find" } } }` });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ severity: "warning", path: "keys.global.ctrl+p", line: 1, column: 25 });
    expect(problems[0]!.message).toBe("Zed keeps ctrl+p, so it may never reach acp-tui there; the routes to find there are f3, ctrl+f and the palette");
    expect(map.global["ctrl+p"]).toBe("find");
    expect(keysFor(map, "prompt", "palette")).toEqual(["?"]);
  });

  test("PhpStorm takes the keys either engine keeps; a terminal that keeps nothing gives no warning", () => {
    const section: KeysSection = { selection: { "ctrl+c": "copy" }, global: { "ctrl+f": "find" } };
    const map = resolveKeyOverrides(section).map;
    const warnings = keptKeyWarnings(section, map, "jetbrains");
    // Ctrl+C is kept by the classic engine only, Ctrl+F by both.
    expect(warnings.map((w) => w.path.join("."))).toEqual(["keys.global.ctrl+f", "keys.selection.ctrl+c"]);
    expect(warnings[0]!.message).toBe("PhpStorm keeps ctrl+f, so it may never reach acp-tui there; the routes to find there are f3 and the palette");
    expect(keptKeyWarnings(section, map, null)).toEqual([]);
    expect(keptKeyWarnings(section, map, "zed")).toEqual([]);
  });

  test("Only kept keys: with e unbound and ctrl+t for export, config --check says that in Zed, which keeps ctrl+t, export is reachable only through the palette", () => {
    const section: KeysSection = { conversation: { e: null, "ctrl+t": "export" } };
    const problems = keyCheckProblems(section, FILES, () => `{ "keys": { "conversation": { "e": null, "ctrl+t": "export" } } }`);
    expect(problems).toEqual([
      expect.objectContaining({
        severity: "warning",
        path: "keys.conversation.ctrl+t",
        message: "Zed keeps ctrl+t, so it may never reach acp-tui there; export is reachable there only through the palette",
      }),
    ]);
  });

  test("config --check names the three terminals alike, one warning for both PhpStorm engines", () => {
    const section: KeysSection = { global: { "ctrl+f": "find", "ctrl+p": "palette" } };
    const warnings = keptKeyCheckWarnings(section, resolveKeyOverrides(section).map);
    expect(warnings.map((w) => w.message)).toEqual([
      "PhpStorm keeps ctrl+f, so it may never reach acp-tui there; the routes to find there are f3 and the palette",
      "Zed keeps ctrl+p, so it may never reach acp-tui there; the route to palette there is ?",
    ]);
    // An action left with no key anywhere is named once.
    const lost = keptKeyCheckWarnings({ conversation: { e: null } }, resolveKeyOverrides({ conversation: { e: null } }).map);
    expect(lost).toEqual([{ path: ["keys", "conversation", "e"], severity: "warning", message: "export is reachable only through the palette, in every terminal" }]);
    // The defaults give no warning.
    expect(keptKeyCheckWarnings({}, DEFAULT_KEY_MAP)).toEqual([]);
  });

  test("Palette keeps one route: ctrl+p removed from global gives no warning for any terminal, because ? in the prompt context still opens the palette", () => {
    const section: KeysSection = { global: { "ctrl+p": null } };
    const { map, problems } = resolveKeyOverrides(section);
    expect(problems).toEqual([]);
    expect(keysFor(map, "global", "palette")).toEqual([]);
    expect(keysFor(map, "prompt", "palette")).toEqual(["?"]);
    expect(keptKeyCheckWarnings(section, map)).toEqual([]);
    for (const terminal of ["jetbrains", "zed"] as const) expect(keptKeyWarnings(section, map, terminal)).toEqual([]);
  });

  test("Palette keeps one route: ctrl+p rebound to find warns only that Zed keeps it (the routes to find), not that the palette lost its key", () => {
    const section: KeysSection = { global: { "ctrl+p": "find" } };
    const map = resolveKeyOverrides(section).map;
    expect(keptKeyCheckWarnings(section, map)).toEqual([
      {
        path: ["keys", "global", "ctrl+p"],
        severity: "warning",
        message: "Zed keeps ctrl+p, so it may never reach acp-tui there; the routes to find there are f3, ctrl+f and the palette",
      },
    ]);
  });

  test("Palette with no route at all: removing ctrl+p and ? is rejected as an essential-action error, and no kept-key warning follows", () => {
    const section: KeysSection = { global: { "ctrl+p": null }, prompt: { "?": null } };
    const { map, problems } = resolveKeyOverrides(section);
    expect(problems.filter((p) => p.severity === "error").length).toBeGreaterThan(0);
    expect(keptKeyCheckWarnings(section, map)).toEqual([]);
  });
});

describe("Action names in the schema (task 8.4)", () => {
  test("every catalogue action is accepted in its context, and null removes a binding", () => {
    for (const context of KEY_CONTEXTS) {
      const bindings = Object.fromEntries(KEY_ACTIONS[context].map((action, i) => [`f${i + 1}`, action]));
      expect(ConfigSchema.safeParse({ keys: { [context]: { ...bindings, f99: null } } }).success).toBe(true);
    }
  });

  test("the JSON Schema enumerates each context's actions from the catalogue, so an editor completes them", () => {
    const schema = JSON.parse(jsonSchemaText(ConfigSchema));
    for (const context of KEY_CONTEXTS) {
      const values = schema.properties.keys.properties[context].additionalProperties.anyOf;
      expect(values[0]).toMatchObject({ type: "string", enum: [...KEY_ACTIONS[context]] });
      expect(values[1]).toEqual({ type: "null" });
    }
  });

  test("an unknown action does not reject the keys section: the other entries still load", () => {
    const parsed = parseConfigText(`{ "keys": { "conversation": { "x": "copyItm", "c": "copyItem" } } }`, FILE);
    expect(parsed.rejected).toEqual([]);
    expect(resolveKeyOverrides(SECTIONS.keys.parse(parsed.sections.keys) as KeysSection).map.conversation["c"]).toBe("copyItem");
  });
});
