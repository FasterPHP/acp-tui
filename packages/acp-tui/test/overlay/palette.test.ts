// The palette's catalogue check and key help's entries (mvp-chrome-and-keys
// tasks 6.2 and 6.8; spec tui-palette "Every action in the palette" and "Key
// help"). Pure: the command catalogue is built from the key map's actions and
// titles, as `commandCatalogue` reports every registered command.
import { describe, expect, test } from "bun:test";
import { COMMAND_TITLES, DEFAULT_KEY_MAP, KEY_ACTIONS, KEY_CONTEXTS, keyLabel, keysFor, loadKeyMap, type KeyContext } from "../../src/keys/keymap.ts";
import type { NewlineHintState } from "../../src/keys/newline-hint.ts";
import type { CatalogueEntry } from "../../src/keys/register.ts";
import { SELECTION_HELP } from "../../src/selection/help.ts";
import { ALTERNATIVES_GROUP, helpItems, HELP_GROUPS, MOUSE_GROUP } from "../../src/overlay/help.ts";
import { filterItems, overlayLayout, type ListItem } from "../../src/overlay/list.ts";
import { isPaletteAction, KEYSTROKE_ONLY, PALETTE_COMMANDS, paletteItems, paletteRoutes, slashItems, type PaletteFacts } from "../../src/overlay/palette.ts";

/** The whole command catalogue: every action of every context, with its title and default keys. */
function fullCatalogue(): CatalogueEntry[] {
  return KEY_CONTEXTS.flatMap((context) =>
    (KEY_ACTIONS[context] as readonly string[]).map((action) => ({
      name: `${context}.${action}`,
      context,
      action,
      title: (COMMAND_TITLES[context] as Record<string, string>)[action]!,
      keys: keysFor(DEFAULT_KEY_MAP, context, action as never).map(keyLabel),
    })),
  );
}

describe("Every action in the palette (task 6.2)", () => {
  test("Catalogue check: every action outside the keystroke-only list appears as a palette entry with a title", () => {
    // A permission request open, so the card's commands are listed too.
    const items = paletteItems(fullCatalogue(), { configOptions: [], mouse: "full", permissionOptions: Array.from({ length: 9 }, (_, i) => `option ${i + 1}`) });
    const listed = new Map(items.flatMap((i) => (i.action.kind === "command" ? [[i.action.name, i.title] as const] : [])));
    const missing: string[] = [];
    for (const context of KEY_CONTEXTS) {
      for (const action of KEY_ACTIONS[context] as readonly string[]) {
        if (!isPaletteAction(context, action)) continue;
        // The pickers are listed only for options the agent offers (checked below).
        if (context === "global" && action.startsWith("pick")) continue;
        const title = listed.get(`${context}.${action}`);
        if (!title) missing.push(`${context}.${action}`);
      }
    }
    expect(missing).toEqual([]);
    for (const title of listed.values()) expect(title.length).toBeGreaterThan(0);
    // Nothing keystroke-only is listed.
    for (const name of listed.keys()) {
      const [context, action] = name.split(".") as [KeyContext, string];
      expect(isPaletteAction(context, action)).toBe(true);
    }
    // At least the entries tui-palette names.
    for (const name of [
      "global.interrupt",
      "global.detach",
      "global.sessions",
      "conversation.cycleDensity",
      "global.find",
      "conversation.export",
      "selection.copy",
      "selection.copyRich",
      "conversation.copyItem",
      "conversation.copyItemMarkdown",
      "prompt.paste",
      "global.toggleMouse",
      "global.repaint",
      "global.toggleTool",
      "conversation.openLink",
      "conversation.expandOutput",
      "global.keyHelp",
    ]) {
      expect(listed.has(name)).toBe(true);
    }
    expect(listed.get("global.interrupt")).toBe("Interrupt the turn");
    expect(listed.get("prompt.paste")).toBe("Paste from the clipboard");
    // The pickers, once the agent offers the options.
    const select = (id: string) => ({ type: "select" as const, id, name: id, category: id, currentValue: "a", options: [{ value: "a", name: "A" }] });
    const withOptions = paletteItems(fullCatalogue(), { configOptions: [select("mode"), select("model"), select("thought_level")], mouse: "full", permissionOptions: [] });
    for (const name of ["global.pickMode", "global.pickModel", "global.pickThoughtLevel"]) expect(withOptions.some((i) => i.id === name)).toBe(true);
  });

  test("Keystroke-only entries left out (task 12.1): no palette opener, no `Back to the prompt box`, none of the preview's scrolling, while a request's options are listed", () => {
    const items = paletteItems(fullCatalogue(), { configOptions: [], mouse: "full", permissionOptions: ["Allow once", "Reject"] });
    const titles = items.map((i) => i.title);
    for (const title of [
      "Open the command palette",
      "Open the command palette (in an empty prompt box)",
      "Open the agent's commands (in an empty prompt box)",
      "Back to the prompt box",
      "Scroll the preview up a line",
      "Scroll the preview down a line",
      "Scroll the preview up a page",
      "Scroll the preview down a page",
      "Preview: first line",
      "Preview: last line",
    ]) {
      expect([title, titles.includes(title)]).toEqual([title, false]);
    }
    expect(titles).toContain("Select Allow once");
    expect(titles).toContain("Answer with the selected option");
    expect(titles).toContain("Grow the permission card, or return it to its size");
    for (const [context, action] of [
      ["global", "palette"],
      ["prompt", "palette"],
      ["prompt", "agentCommands"],
      ["conversation", "back"],
      ["card", "back"],
      ["card", "scrollUp"],
      ["card", "bottom"],
    ] as const) {
      expect(isPaletteAction(context, action)).toBe(false);
    }
  });

  test("PALETTE_COMMANDS and KEYSTROKE_ONLY together cover the catalogue, once each", () => {
    for (const context of KEY_CONTEXTS) {
      const listed = PALETTE_COMMANDS[context] ?? [];
      const only = KEYSTROKE_ONLY[context];
      const keystroke = only === "all" ? (KEY_ACTIONS[context] as readonly string[]) : (only ?? []);
      expect([...listed, ...keystroke].sort()).toEqual([...(KEY_ACTIONS[context] as readonly string[])].sort());
      expect(new Set(listed).size).toBe(listed.length);
    }
  });
});

describe("Key help (task 6.8)", () => {
  test("every binding of the key map, grouped by context, keystroke-only ones included; each action once with its keys", () => {
    const items = helpItems(DEFAULT_KEY_MAP, 59);
    const groups = [...new Set(items.map((i) => i.group))];
    expect(groups).toEqual([...HELP_GROUPS.map((g) => g.label), ALTERNATIVES_GROUP, MOUSE_GROUP]);
    const prompt = items.filter((i) => i.group === "Prompt box");
    expect(prompt.find((i) => i.title === "Insert a newline")?.keys).toEqual(["shift+enter", "alt+enter", "ctrl+j"]);
    expect(prompt.find((i) => i.title === "Send the prompt")?.keys).toEqual(["enter"]);
    // Key help shows paste's three keys (task 12.2).
    expect(prompt.find((i) => i.title === "Paste from the clipboard")?.keys).toEqual(["ctrl+v", "ctrl+shift+v", "alt+v"]);
    const global = items.filter((i) => i.group === "Anywhere");
    expect(global.find((i) => i.title === "Move focus to the next region")?.keys).toEqual(["tab"]);
    expect(global.find((i) => i.title === "Interrupt the running turn (press twice)")?.keys).toEqual(["esc"]);
    // Every bound key of every context is in help, except Ctrl+Enter (newline, find's previous), which help names
    // only in Windows Terminal without the kitty protocol (windows-support design D7; newline-hint.test.ts).
    for (const context of KEY_CONTEXTS) {
      for (const [key, action] of Object.entries(DEFAULT_KEY_MAP[context])) {
        if ((context === "prompt" || context === "find") && key === "ctrl+return") continue;
        const title = (COMMAND_TITLES[context] as Record<string, string>)[action];
        expect(items.some((i) => i.title === title && (i.keys ?? []).includes(keyLabel(key)))).toBe(true);
      }
    }
    // The slash menu's completion key (slash-command-completion): its own group, after the lists'.
    const slash = items.filter((i) => i.group === "Slash menu");
    expect(slash.map((i) => [i.title, i.keys])).toEqual([["Complete the slash command in the prompt box", ["tab"]]]);
    expect(groups.indexOf("Slash menu")).toBe(groups.indexOf("Lists") + 1);
    // An action without a key (the pickers) is not.
    expect(items.some((i) => i.title === "Choose the model")).toBe(false);
  });

  test("the routes for keys an IDE keeps, named from the key map in use", () => {
    const items = helpItems(DEFAULT_KEY_MAP, 59).filter((i) => i.group === ALTERNATIVES_GROUP);
    expect(items.map((i) => [i.title, (i.keys ?? []).join(" ")])).toContainEqual(["Kept by Zed: the effort pill, the palette", "ctrl+t"]);
    expect(items.map((i) => [i.title, (i.keys ?? []).join(" ")])).toContainEqual(["Kept by PhpStorm: f3, the palette", "ctrl+f"]);
    expect(items.map((i) => [i.title, (i.keys ?? []).join(" ")])).toContainEqual(["Kept by Zed, or sent as ctrl+c: shift+y, the palette", "ctrl+shift+c"]);
    // Paste (task 12.2): Alt+V where PhpStorm keeps Ctrl+V, and where both IDEs keep Ctrl+Shift+V.
    expect(items.map((i) => [i.title, (i.keys ?? []).join(" ")])).toContainEqual(["Kept by PhpStorm: its own paste for text, alt+v, the palette", "ctrl+v"]);
    expect(items.map((i) => [i.title, (i.keys ?? []).join(" ")])).toContainEqual(["Kept by PhpStorm and Zed: alt+v, the palette", "ctrl+shift+v"]);
    // Redo (task 12.4): Ctrl+Shift+Z undoes in PhpStorm and never arrives in Zed; Ctrl+Y and the palette's Redo.
    expect(items.map((i) => [i.title, (i.keys ?? []).join(" ")])).toContainEqual(["Kept by PhpStorm and Zed: ctrl+y, the palette", "ctrl+shift+z"]);
    // The Mac's Cmd+Z and Cmd+Shift+Z, kept by PhpStorm on macOS (day-two-feedback task 13.4).
    expect(items.map((i) => [i.title, (i.keys ?? []).join(" ")])).toContainEqual(["Kept by PhpStorm on a Mac: ctrl+z, the palette", "super+z"]);
    expect(items.map((i) => [i.title, (i.keys ?? []).join(" ")])).toContainEqual(["Kept by PhpStorm on a Mac: ctrl+y, the palette", "shift+super+z"]);
    const noAltV = helpItems(loadKeyMap({ prompt: { "meta+v": null } }), 59).filter((i) => i.group === ALTERNATIVES_GROUP);
    expect(noAltV.map((i) => i.title)).toContain("Kept by PhpStorm and Zed: the palette");
    // The palette's route in Zed is `?` (task 12.1), named from the key map.
    expect(items.map((i) => [i.title, (i.keys ?? []).join(" ")])).toContainEqual(["Kept by Zed: ? in an empty prompt box", "ctrl+p"]);
    const question = helpItems(loadKeyMap({ prompt: { "?": null, "ctrl+k": "palette" } }), 59).filter((i) => i.group === ALTERNATIVES_GROUP);
    expect(question.map((i) => i.title)).toContain("Kept by Zed: ctrl+k in an empty prompt box");
    // Rebound: the alternative's label follows the key map; an unbound kept key needs no route.
    const rebound = helpItems(loadKeyMap({ global: { f3: null, f5: "findNext", "ctrl+t": null } }), 59).filter((i) => i.group === ALTERNATIVES_GROUP);
    expect(rebound.map((i) => i.title)).toContain("Kept by PhpStorm: f5, the palette");
    expect(rebound.some((i) => (i.keys ?? []).includes("ctrl+t"))).toBe(false);
  });

  test("in Windows Terminal the alternatives name it for Ctrl+V, Ctrl+Shift+V and Alt+Enter; elsewhere the text is what it was", () => {
    const kept = (hint: NewlineHintState) => helpItems(DEFAULT_KEY_MAP, 59, hint).filter((i) => i.group === ALTERNATIVES_GROUP).map((i) => [i.title, (i.keys ?? []).join(" ")]);
    const wt = kept({ terminal: "windows-terminal", kitty: false });
    expect(wt).toContainEqual(["Kept by Windows Terminal: its own paste for text, alt+v, the palette", "ctrl+v"]);
    expect(wt).toContainEqual(["Kept by Windows Terminal: alt+v, the palette", "ctrl+shift+v"]);
    expect(wt).toContainEqual(["Kept by Windows Terminal: ctrl+enter, ctrl+j", "alt+enter"]);
    // The find bar's previous key follows the newline rule: ctrl+enter without kitty, shift+enter with it.
    expect(wt).toContainEqual(["Lost in most terminals: ctrl+enter in the find bar", "shift+f3"]);
    expect(kept({ terminal: "windows-terminal", kitty: true })).toContainEqual(["Lost in most terminals: shift+enter in the find bar", "shift+f3"]);
    for (const terminal of ["default", "jetbrains", "zed"] as const) {
      const other = kept({ terminal, kitty: false });
      expect(other.some(([title]) => title!.includes("Windows Terminal")), terminal).toBe(false);
      expect(other).toContainEqual(["Kept by PhpStorm: its own paste for text, alt+v, the palette", "ctrl+v"]);
      expect(other).toContainEqual(["Kept by PhpStorm and Zed: alt+v, the palette", "ctrl+shift+v"]);
      expect(other).toContainEqual(["Lost in most terminals: shift+enter in the find bar", "shift+f3"]);
    }
  });

  test("the selection's wording (SELECTION_HELP), wrapped to the overlay's width", () => {
    const lines = helpItems(DEFAULT_KEY_MAP, 40).filter((i) => i.group === MOUSE_GROUP);
    expect(lines.map((i) => i.title).join(" ")).toBe(SELECTION_HELP.join(" "));
    for (const line of lines) expect(Bun.stringWidth(line.title)).toBeLessThanOrEqual(40);
  });
});

describe("Group headings say where keys work (day-two-feedback task 13.11)", () => {
  const select = (id: string) => ({ type: "select" as const, id, name: id, category: id, currentValue: "a", options: [{ value: "a", name: "A" }] });
  const state = { configOptions: [select("mode"), select("model"), select("thought_level")], mouse: "full", permissionOptions: ["Allow", "Reject"] };
  const palette = () => paletteItems(fullCatalogue(), { ...state, routes: paletteRoutes(DEFAULT_KEY_MAP, { interrupt: "double", mouse: "full" }) });
  /** Every row of the list drawn at `width`, a tall pane so nothing is scrolled out. */
  const rows = (items: readonly ListItem[], width: number) =>
    overlayLayout({ title: "Commands", filter: "", placeholder: "", items, grouped: true, selected: 0, offset: 0, width, rows: 200, closeLabel: "esc", hints: [], marks: false }).lines.map((l) =>
      l.map((s) => s.text).join(""),
    );
  const inner = (row: string) => row.slice(2, -2).trimEnd();

  test("the key column shows the key alone; a context scoped to one place says so in its group heading, and global and selection say nothing", () => {
    const items = palette();
    for (const item of items) expect(Object.keys(item)).not.toContain("where");
    const note = (group: string) => items.find((i) => i.group === group)?.groupNote ?? null;
    expect(note("Conversation")).toBe("shortcuts apply while selected");
    expect(note("Prompt")).toBe("shortcuts apply while selected");
    expect(note("Permission")).toBe("shortcuts apply while it is open");
    expect(note("Session")).toBeNull();
    expect(note("Selection")).toBeNull();
    const listed = rows(items, 100).map(inner);
    expect(listed).toContain("Conversation (shortcuts apply while selected)");
    expect(listed).toContain("Prompt (shortcuts apply while selected)");
    expect(listed).toContain("Permission (shortcuts apply while it is open)");
    expect(listed).toContain("Session");
    expect(listed).toContain("Selection");
    // The entries show the key and nothing after it.
    const row = (title: string) => rows(items, 100).find((l) => l.includes(title))!;
    expect(row("Cycle the density")).toMatch(/Cycle the density +v │$/);
    expect(row("Cut the selection")).toMatch(/Cut the selection +ctrl\+x │$/);
    expect(row("Find in the conversation")).toMatch(/Find in the conversation +ctrl\+f │$/);
    expect(row("Paste from the clipboard")).toMatch(/Paste from the clipboard +ctrl\+v ctrl\+shift\+v alt\+v │$/);
    // The heading is not matched by the filter, as the group is not.
    expect(filterItems(items, "conversation").map((i) => i.title)).not.toContain("Cycle the density");
    expect(filterItems(items, "shortcuts")).toEqual([]);
  });

  test("every heading fits whole in the 59 columns of a 63-column pane, and at 100", () => {
    const help = helpItems(DEFAULT_KEY_MAP, 59);
    for (const width of [63, 100]) {
      for (const items of [palette(), help]) {
        const headings = rows(items, width).map(inner).filter((r) => /\(shortcuts apply/.test(r));
        expect(headings.length).toBeGreaterThanOrEqual(3);
        for (const heading of headings) expect(heading.endsWith(")")).toBe(true);
      }
    }
  });

  test("key help puts the same hints in its group headings and none per key", () => {
    const items = helpItems(DEFAULT_KEY_MAP, 59);
    const listed = rows(items, 63).map(inner);
    for (const heading of [
      "Prompt box (shortcuts apply while selected)",
      "Conversation (shortcuts apply while selected)",
      "Permission card (shortcuts apply while it is open)",
      "Find bar (shortcuts apply while it is open)",
      "Question card (shortcuts apply while it is open)",
    ]) {
      expect(listed).toContain(heading);
    }
    expect(listed).toContain("Lists (shortcuts apply while one is open)");
    expect(listed).toContain("Anywhere");
    expect(listed).toContain("Selection");
    const row = (title: string) => rows(items, 63).find((l) => l.includes(title))!;
    expect(row("Cycle the density")).toMatch(/Cycle the density +v │$/);
    expect(row("Send the prompt")).toMatch(/Send the prompt +enter │$/);
    for (const item of items) expect(Object.keys(item)).not.toContain("where");
    expect(items.some((i) => i.id.includes("density") && i.id !== "help:conversation.cycleDensity")).toBe(false);
  });

  test("the slash menu has one group for several contexts: it shows only the keys that work from any focus", () => {
    const slash = slashItems(fullCatalogue(), { configOptions: [select("mode"), select("model"), select("thought_level")], agentCommands: [], routes: {} });
    const of = (name: string) => slash.find((i) => i.id === `slash:${name}`)!;
    expect(of("find").keys).toEqual(["ctrl+f"]);
    expect(of("export").keys).toEqual([]);
    expect(of("export").route ?? null).toBeNull();
    expect(slash.every((i) => i.groupNote === undefined)).toBe(true);
  });

  test("the Mode and Effort pickers lose the cycle keys, which stay on their own entries; the single densities are gone", () => {
    const items = palette();
    for (const title of ["Choose the mode", "Choose the thinking level", "Choose the model"]) {
      const item = items.find((i) => i.title === title)!;
      expect([title, item.keys, item.route]).toEqual([title, [], "click the pill"]);
    }
    const next = (title: string) => items.find((i) => i.title === title)!;
    expect(next("Next mode").keys).toEqual(["shift+tab"]);
    expect(next("Next thinking level").keys).toEqual(["ctrl+t"]);
    expect(items.map((i) => i.title).filter((t) => t.startsWith("Density"))).toEqual([]);
    expect(items.filter((i) => i.id.startsWith("conversation.density") && i.id !== "conversation.cycleDensity")).toEqual([]);
    // Without clicks (`mouse` wheel or off) there is nothing to say for the pickers.
    const quiet = paletteItems(fullCatalogue(), { ...state, mouse: "wheel", routes: paletteRoutes(DEFAULT_KEY_MAP, { interrupt: "double", mouse: "wheel" }) });
    expect(quiet.find((i) => i.title === "Choose the mode")?.route ?? null).toBeNull();
  });
});

describe("Only entries that can run now are active (day-two-feedback task 13.12)", () => {
  const facts = { idle: true, selection: false, promptSelection: false, fromConversation: false };
  const items = (over: Partial<PaletteFacts> = {}) => paletteItems(fullCatalogue(), { configOptions: [], mouse: "full", permissionOptions: [], facts: { ...facts, ...over } });
  const mutedIds = (over: Partial<PaletteFacts> = {}) => items(over).filter((i) => i.muted).map((i) => i.id);

  test("what cannot act: interrupt while idle, clear, copy and cut with nothing to act on; nothing else", () => {
    expect(mutedIds()).toEqual(["global.interrupt", "selection.copy", "selection.copyRich", "selection.clear", "prompt.cut"]);
    expect(mutedIds({ idle: false, selection: true, promptSelection: true })).toEqual([]);
  });

  test("each rule on its own", () => {
    const muted = (over: Partial<PaletteFacts>, name: string) => items(over).find((i) => i.id === name)?.muted === true;
    expect([muted({}, "global.interrupt"), muted({ idle: false }, "global.interrupt")]).toEqual([true, false]);
    expect([muted({}, "selection.clear"), muted({ selection: true }, "selection.clear")]).toEqual([true, false]);
    for (const copy of ["selection.copy", "selection.copyRich"]) {
      expect([muted({}, copy), muted({ selection: true }, copy), muted({ fromConversation: true }, copy)]).toEqual([true, false, false]);
    }
    expect([muted({}, "prompt.cut"), muted({ promptSelection: true }, "prompt.cut"), muted({ selection: true }, "prompt.cut")]).toEqual([true, false, true]);
  });

  test("a conversation, card or prompt command is never muted for want of focus: the palette gives it its region", () => {
    const all = items({});
    const withFocusOnly = all.filter((i) => i.action.kind === "command" && ["conversation", "card", "prompt"].includes(i.action.context) && i.muted);
    expect(withFocusOnly.map((i) => i.id)).toEqual(["prompt.cut"]);
    expect(all.filter((i) => i.action.kind === "command" && i.action.context === "conversation").some((i) => i.muted)).toBe(false);
  });

  test("without facts every entry is active, and key help (which runs nothing) mutes none", () => {
    expect(paletteItems(fullCatalogue(), { configOptions: [], mouse: "full", permissionOptions: [] }).some((i) => i.muted)).toBe(false);
    expect(helpItems(DEFAULT_KEY_MAP, 59).some((i) => i.muted)).toBe(false);
  });

  test("a muted entry is drawn whole in the muted colour and never highlighted", () => {
    const list = items({}).filter((i) => i.id === "global.interrupt" || i.id === "global.detach");
    const layout = overlayLayout({ title: "Commands", filter: null, placeholder: "", items: list, grouped: false, selected: 0, offset: 0, width: 80, rows: 20, closeLabel: null, hints: [], marks: false });
    const segments = (title: string) => layout.lines.find((l) => l.some((s) => s.text === title))!;
    const interrupt = segments("Interrupt the turn");
    expect(interrupt.find((s) => s.text === "Interrupt the turn")?.token).toBe("muted");
    expect(interrupt.some((s) => s.selected)).toBe(false);
    expect(segments("Detach and exit").find((s) => s.text === "Detach and exit")?.token).toBe("text");
  });
});
