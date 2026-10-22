// The palette and picker list model (src/overlay/list.ts) and entries
// (src/overlay/palette.ts), the sanitised config list (acp-model's
// `config_options_replaced`), and the key map's Ctrl+P.
import { describe, expect, test } from "bun:test";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { createSession, reduce } from "acp-model";
import { DEFAULT_KEY_MAP, keysFor, loadKeyMap } from "../../src/keys/keymap.ts";
import type { CatalogueEntry } from "../../src/keys/register.ts";
import { displayWidth } from "../../src/layout/segments.ts";
import { filterItems, firstActive, listRows, moveSelection, overlayLayout, pageSelection, scrollOffset, type ListItem, type OverlayView } from "../../src/overlay/list.ts";
import { itemUnder } from "../../src/overlay/pointer.ts";
import { problemDetail, problemItems, problemsRoute } from "../../src/overlay/problems.ts";
import { agentItems, configFor, LEGACY_MODE_ID, LEGACY_MODEL_ID, nextChoice, paletteItems, paletteRoutes, pickerItems, pickerOptions } from "../../src/overlay/palette.ts";

const item = (id: string, group: string | null, extra: Partial<ListItem> = {}): ListItem => ({ id, group, title: id, ...extra });
const text = (row: { text: string }[]) => row.map((s) => s.text).join("");

describe("list model", () => {
  const items = [item("alpha one", "A"), item("alpha two", "A"), item("beta", "B", { keys: ["ctrl+b"] }), item("gamma", "C", { value: "Fake Aurora" })];

  test("the filter matches every word in the title, value or keys, case-insensitively", () => {
    expect(filterItems(items, "").map((i) => i.id)).toEqual(["alpha one", "alpha two", "beta", "gamma"]);
    expect(filterItems(items, "ALPHA two").map((i) => i.id)).toEqual(["alpha two"]);
    expect(filterItems(items, "ctrl+b").map((i) => i.id)).toEqual(["beta"]);
    expect(filterItems(items, "aurora").map((i) => i.id)).toEqual(["gamma"]);
    expect(filterItems(items, "zzz")).toEqual([]);
  });

  test("heading not matched (task 12.8): the filter applies to items only, never to their group; a group's header is kept above its matching items", () => {
    const grouped = [
      item("Open the session list", "Session"),
      item("Find in the conversation", "Session"),
      item("Detach", "Session"),
      item("Copy the item", "Conversation"),
      item("Export the session", "Conversation"),
    ];
    // `session` is the first group's name: only the entries whose own text holds it are shown.
    const shown = filterItems(grouped, "session");
    expect(shown.map((i) => i.id)).toEqual(["Open the session list", "Export the session"]);
    // A group's name alone matches nothing.
    expect(filterItems(grouped, "conversation").map((i) => i.id)).toEqual(["Find in the conversation"]);
    // Each matching item keeps its header, and a group with no match has none.
    expect(listRows(shown, true)).toEqual([
      { kind: "header", label: "Session" },
      { kind: "item", index: 0 },
      { kind: "gap" },
      { kind: "header", label: "Conversation" },
      { kind: "item", index: 1 },
    ]);
    expect(listRows(filterItems(grouped, "detach"), true)).toEqual([
      { kind: "header", label: "Session" },
      { kind: "item", index: 0 },
    ]);
  });

  test("rows: a header before each group while grouped, a blank row before every header but the first (task 12.7)", () => {
    expect(listRows(items, true)).toEqual([
      { kind: "header", label: "A" },
      { kind: "item", index: 0 },
      { kind: "item", index: 1 },
      { kind: "gap" },
      { kind: "header", label: "B" },
      { kind: "item", index: 2 },
      { kind: "gap" },
      { kind: "header", label: "C" },
      { kind: "item", index: 3 },
    ]);
    expect(listRows(items, false).every((r) => r.kind === "item")).toBe(true);
  });

  test("a subheading above an item (slash-command-completion 7.4): a row of its own, not an item, between the tiers; the window and paging count it", () => {
    const tiered = [
      item("one", "A"),
      item("two", "A", { subheadingAbove: "matched in the description" }),
      item("three", "A"),
      item("four", "B", { subheadingAbove: "matched in the description" }),
    ];
    const rows = listRows(tiered, true);
    expect(rows).toEqual([
      { kind: "header", label: "A" },
      { kind: "item", index: 0 },
      { kind: "subheading", label: "matched in the description" },
      { kind: "item", index: 1 },
      { kind: "item", index: 2 },
      { kind: "gap" },
      { kind: "header", label: "B" },
      { kind: "subheading", label: "matched in the description" },
      { kind: "item", index: 3 },
    ]);
    // Items are indexed without the subheading: Down from `one` is `two`, and the keys skip nothing.
    expect(moveSelection(4, 0, 1)).toBe(1);
    expect(moveSelection(4, 0, "last")).toBe(3);
    // The window keeps the subheading (and the header above it) in view with the item under it.
    expect(scrollOffset(rows, 1, 3, 4)).toBe(2);
    expect(scrollOffset(rows, 3, 3, 0)).toBe(6);
    // A page counts the subheading as a row: from `one` (row 1) a page of 4 rows reaches row 4,
    // `three`; from `two` (row 3) it reaches row 6, so the page ends at `three` (row 4), and from
    // `three` the next item beyond the page is `four`.
    expect(pageSelection(rows, 0, 4, 1)).toBe(2);
    expect(pageSelection(rows, 1, 4, 1)).toBe(2);
    expect(pageSelection(rows, 2, 4, 1)).toBe(3);
    expect(pageSelection(rows, 3, 4, -1)).toBe(2);
    // The filter never matches it.
    expect(filterItems(tiered, "matched").map((i) => i.id)).toEqual([]);
    // Drawn muted, on a line that shows no item.
    const layout = overlayLayout({
      title: "Slash commands",
      filter: "x",
      placeholder: "",
      items: tiered,
      grouped: true,
      selected: 0,
      offset: 0,
      width: 63,
      rows: 21,
      closeLabel: "esc",
      hints: [],
      marks: false,
    });
    const line = layout.lines.findIndex((l) => text(l).includes("matched in the description"));
    expect(line).toBeGreaterThan(0);
    expect(layout.lines[line]!.find((seg) => seg.text.includes("matched in the description"))).toMatchObject({ token: "muted" });
    expect(layout.itemAt[line]).toBeNull();
    expect(layout.itemAt[line + 1]).toBe(1);
  });

  test("the window keeps the selection in view, with its group's header when it is the group's first item", () => {
    const rows = listRows(items, true);
    expect(scrollOffset(rows, 0, 3, 0)).toBe(0);
    expect(scrollOffset(rows, 3, 3, 0)).toBe(6);
    // Back up to the first item of group B: its header shows too (the blank row above it need not).
    expect(scrollOffset(rows, 2, 3, 6)).toBe(4);
    // PgDn and PgUp count rows, headers and blank rows included (task 12.7), so the window never
    // moves by more than its height: from `alpha one` (row 1) a page of 4 rows reaches row 4 (B's
    // header), so the last item at or above it, `alpha two`; from there row 5, `beta`.
    expect(pageSelection(rows, 0, 4, 1)).toBe(1);
    expect(pageSelection(rows, 1, 4, 1)).toBe(2);
    expect(pageSelection(rows, 2, 4, 1)).toBe(3);
    expect(pageSelection(rows, 3, 4, 1)).toBe(3);
    expect(pageSelection(rows, 3, 4, -1)).toBe(2);
    expect(pageSelection(rows, 0, 4, -1)).toBe(0);
    // A page with no item in it goes on to the next item.
    expect(pageSelection(rows, 1, 2, 1)).toBe(2);
    // Without headers a page is `height - 1` items, as before.
    expect(pageSelection(listRows(items, false), 0, 3, 1)).toBe(2);
    expect(moveSelection(4, 0, -1)).toBe(0);
    expect(moveSelection(4, 1, 10)).toBe(3);
    expect(moveSelection(4, 2, "first")).toBe(0);
    expect(moveSelection(4, 0, "last")).toBe(3);
    expect(moveSelection(0, 0, 1)).toBe(0);
  });

  test("layout: every row is the screen's width; at most rows - 4 tall; title, count, close key and hints in the borders", () => {
    const many = Array.from({ length: 30 }, (_, i) => item(`item ${i}`, i < 10 ? "First" : "Second", { keys: ["f9"] }));
    const view: OverlayView = {
      title: "Commands",
      filter: "",
      placeholder: "type to filter",
      items: many,
      grouped: true,
      selected: 0,
      offset: 0,
      width: 63,
      rows: 21,
      closeLabel: "esc",
      hints: [{ text: "↑↓ select", token: "muted" }],
      marks: false,
    };
    const layout = overlayLayout(view);
    expect(layout.lines).toHaveLength(17);
    expect(layout.listHeight).toBe(14);
    for (const row of layout.lines) expect(displayWidth(text(row))).toBe(63);
    expect(text(layout.lines[0]!)).toMatch(/^╭─ Commands 30 ─+ esc ─╮$/);
    expect(text(layout.lines[1]!)).toMatch(/^│ › {2}type to filter +│$/);
    expect(text(layout.lines[2]!)).toMatch(/^│ First +│$/);
    expect(text(layout.lines[3]!)).toMatch(/^│ item 0 +f9 │$/);
    expect(text(layout.lines.at(-1)!)).toMatch(/^╰─ ↑↓ select ─+╯$/);
    // The selected row is marked across the inner width.
    expect(layout.lines[3]!.filter((s) => s.selected).map((s) => s.text).join("")).toHaveLength(59);
    // A short list is only as tall as it needs; no filter field without one.
    const short = overlayLayout({ ...view, items: many.slice(0, 3), filter: null, marks: true });
    expect(short.lines).toHaveLength(2 + 1 + 3);
    expect(text(short.lines[2]!)).toMatch(/^│ {3}item 0/);
  });

  test("layout (task 12.7): a blank framed row before every group header but the first; `minRows` pads a short list with blank framed rows, within the most", () => {
    const view: OverlayView = {
      title: "Commands",
      filter: "",
      placeholder: "",
      items,
      grouped: true,
      selected: 0,
      offset: 0,
      width: 30,
      rows: 21,
      closeLabel: "esc",
      hints: [{ text: "↑↓ select", token: "muted" }],
      marks: false,
    };
    const rows = (v: OverlayView) => overlayLayout(v).lines.map(text);
    expect(rows(view).slice(2, -1)).toEqual([
      `│ A${" ".repeat(25)} │`,
      `│ alpha one${" ".repeat(17)} │`,
      `│ alpha two${" ".repeat(17)} │`,
      `│${" ".repeat(28)}│`,
      `│ B${" ".repeat(25)} │`,
      `│ beta${" ".repeat(16)}ctrl+b │`,
      `│${" ".repeat(28)}│`,
      `│ C${" ".repeat(25)} │`,
      `│ gamma${" ".repeat(10)}Fake Aurora │`,
    ]);
    // Filtered (task 12.8): the headers of the groups with a match stay, with the blank row between.
    expect(rows({ ...view, filter: "a", items: filterItems(items, "a") }).slice(2, -1)).toEqual(rows(view).slice(2, -1));
    expect(rows({ ...view, filter: "beta", items: filterItems(items, "beta") }).slice(2, -1)).toEqual([`│ B${" ".repeat(25)} │`, `│ beta${" ".repeat(16)}ctrl+b │`]);
    // Two choices in a picker as tall as a five-row prompt box: two blank rows below the list.
    const picker = rows({ ...view, items: items.slice(0, 2), grouped: false, filter: null, minRows: 6 });
    expect(picker).toHaveLength(6);
    expect(picker.slice(3, 5)).toEqual([`│${" ".repeat(28)}│`, `│${" ".repeat(28)}│`]);
    expect(picker.at(-1)).toMatch(/^╰─ ↑↓ select ─+╯$/);
    // Never beyond the most rows.
    expect(rows({ ...view, minRows: 40, maxRows: 8 })).toHaveLength(8);
  });

  test("an entry without keys shows its route in the key column, muted; the filter matches it (task 12.7)", () => {
    const routed = [item("Interrupt the turn", "Session", { route: "esc esc" }), item("Find", "Session", { keys: ["ctrl+f"], route: "ignored" })];
    const lines = overlayLayout({
      title: "Commands",
      filter: null,
      placeholder: "",
      items: routed,
      grouped: false,
      selected: 1,
      offset: 0,
      width: 40,
      rows: 21,
      closeLabel: null,
      hints: [],
      marks: false,
    }).lines;
    expect(text(lines[1]!)).toBe(`│ Interrupt the turn${" ".repeat(11)}esc esc │`);
    expect(lines[1]!.find((s) => s.text === "esc esc")).toMatchObject({ token: "muted" });
    expect(text(lines[2]!)).toBe(`│ Find${" ".repeat(26)}ctrl+f │`);
    expect(filterItems(routed, "esc esc").map((i) => i.title)).toEqual(["Interrupt the turn"]);
  });

  test("the message the selected row cuts, under the list (IDE check 12.5): a blank row, then the message alone wrapped in muted text; the list keeps one row per entry", () => {
    const message = "PhpStorm keeps ctrl+f, so it may never reach acp-tui there; the routes to find there are f3 and the palette";
    const problems = [item("4:38 keys.global.ctrl+f", "config.jsonc", { description: message, value: "warning" })];
    const view: OverlayView = {
      title: "Configuration problems",
      filter: "",
      placeholder: "",
      items: problems,
      grouped: true,
      selected: 0,
      offset: 0,
      width: 60,
      rows: 21,
      closeLabel: "esc",
      hints: [],
      marks: false,
      detail: message,
    };
    const layout = overlayLayout(view);
    const rows = layout.lines.map(text);
    for (const row of rows) expect(displayWidth(row)).toBe(60);
    expect(rows[2]).toMatch(/^│ config\.jsonc +│$/);
    expect(rows[3]).toMatch(/^│ 4:38 keys\.global\.ctrl\+f {2}PhpStorm.*… +warning │$/);
    expect(rows[4]).toBe(`│${" ".repeat(58)}│`);
    const detail = rows.slice(5, -1).map((r) => r.slice(2, -2).trimEnd());
    // The message alone: no place and no setting, which the selected row has once.
    expect(detail.join(" ")).toBe(message);
    expect(detail.length).toBeGreaterThan(1);
    expect(rows.filter((r) => r.includes("4:38 keys.global.ctrl+f"))).toHaveLength(1);
    expect(layout.lines[5]!.find((s) => s.text.includes("PhpStorm"))).toMatchObject({ token: "muted" });
    // Under the prompt box's minimum height, blank rows come between the list and the detail.
    const tall = overlayLayout({ ...view, minRows: 14 }).lines.map(text);
    expect(tall).toHaveLength(14);
    expect(tall.slice(-1 - detail.length, -1)).toEqual(rows.slice(5, -1));
    // Too few rows: the detail is cut with `…`, the list keeps its rows (header and entry).
    const short = overlayLayout({ ...view, maxRows: 7 }).lines.map(text);
    expect(short).toHaveLength(7);
    expect(short[3]).toContain("4:38 keys.global.ctrl+f");
    expect(short.at(-2)).toMatch(/…\s*│$/);
    // No room beside the list's rows: no detail at all.
    expect(overlayLayout({ ...view, maxRows: 6 }).lines.map(text).join("\n")).not.toContain("the palette");
  });

  test("a problem that fits in its row shows no detail, and the list takes the rows", () => {
    const description = "not a known setting";
    const problems = [item("2:3 wheel_line", "config.jsonc", { description, value: "warning" }), item("5:1 density", "config.jsonc", { description: "takes compact, normal or relaxed", value: "error" })];
    const view: OverlayView = {
      title: "Configuration problems",
      filter: "",
      placeholder: "",
      items: problems,
      grouped: true,
      selected: 0,
      offset: 0,
      width: 60,
      rows: 21,
      closeLabel: "esc",
      hints: [],
      marks: false,
      detail: description,
    };
    // Border, filter, header, two rows, border: no blank row and no second copy of the message.
    const fits = overlayLayout(view).lines.map(text);
    expect(fits).toHaveLength(6);
    expect(fits.filter((r) => r.includes(description))).toHaveLength(1);
    // The same problem in a narrower overlay is cut, and the detail returns.
    const narrow = overlayLayout({ ...view, width: 30 }).lines.map(text);
    expect(narrow.length).toBeGreaterThan(6);
    expect(narrow.join(" ")).toContain(description);
    // The detail follows the selected row: a cut row has it, a row that fits has none.
    const long = "x".repeat(80);
    const mixed = { ...view, width: 50, items: [item("4:38 keys.global.ctrl+f", "c", { description: long, value: "warning" }), item("2:3 a", "c", { description: "short", value: "warning" })] };
    expect(overlayLayout({ ...mixed, selected: 0, detail: long }).lines.length).toBeGreaterThan(6);
    expect(overlayLayout({ ...mixed, selected: 1, detail: "short" }).lines).toHaveLength(6);
  });
});

describe("palette and picker entries", () => {
  const catalogue: CatalogueEntry[] = [
    ["global", "escape", "Interrupt"],
    ["global", "toggleMouse", "Turn mouse reporting off or on", ["f2"]],
    ["global", "pickModel", "Choose the model"],
    ["global", "pickMode", "Choose the mode"],
    ["global", "palette", "Open the command palette", ["ctrl+p"]],
    ["prompt", "newline", "Insert a newline"],
    ["prompt", "submit", "Send the prompt", ["enter"]],
    ["conversation", "first", "First item", ["home"]],
    ["card", "choose1", "Select option 1", ["1"]],
    ["card", "choose2", "Select option 2", ["2"]],
    ["card", "choose3", "Select option 3", ["3"]],
    ["card", "confirm", "Answer with the selected option", ["enter"]],
  ].map(([context, action, title, keys]) => ({ name: `${context}.${action}`, context, action, title, keys: keys ?? [] }) as CatalogueEntry);
  const model: SessionConfigOption = {
    id: "model",
    type: "select",
    name: "Model",
    category: "model",
    currentValue: "b",
    options: [
      { group: "p", name: "Plain", options: [{ value: "a", name: "Alpha" }] },
      { group: "g", name: "Group", options: [{ value: "b", name: "Beta", description: "fast" }] },
    ],
  };
  const fast: SessionConfigOption = { id: "fast", type: "boolean", name: "Fast", currentValue: false };

  test("grouped by context in the palette's order; keystroke-only commands left out; current values", () => {
    const items = paletteItems(catalogue, { configOptions: [model, fast], mouse: "wheel", permissionOptions: [] });
    expect(items.map((i) => [i.group, i.title, i.value ?? null, (i.keys ?? []).join(" ")])).toEqual([
      ["Session", "Choose the model", "Beta", ""],
      ["Session", "Turn mouse reporting off or on", "wheel", "f2"],
      // Every catalogue action outside the keystroke-only list (mvp-chrome-and-keys task 6.2), which
      // holds the palette's own opener since task 12.1.
      ["Session", "Switch Fast on", "off", ""],
      ["Conversation", "First item", null, "home"],
      ["Prompt", "Send the prompt", null, "enter"],
    ]);
    // `Choose the mode` is left out: the agent reports no mode option.
  });

  test("routes for the keyless entries (task 12.7): from the key map in use, so a rebinding stays truthful; none for the session list", () => {
    const routes = paletteRoutes(DEFAULT_KEY_MAP, { interrupt: "double", mouse: "full" });
    // Only what performs exactly that entry (day-two-feedback task 13.7): the cycle keys step to the
    // next value and stay on their own entries, and the three pickers open by a click on their pill.
    expect(routes).toEqual({
      "global.interrupt": "esc esc",
      "global.pickMode": "click the pill",
      "global.pickThoughtLevel": "click the pill",
      "global.pickModel": "click the pill",
    });
    expect(routes["global.sessions"]).toBeUndefined();
    expect(routes["global.configProblems"]).toBeUndefined();
    // One Esc under `single`; no click route while the mouse reports no clicks.
    expect(paletteRoutes(DEFAULT_KEY_MAP, { interrupt: "single", mouse: "off" })).toMatchObject({ "global.interrupt": "esc" });
    expect(paletteRoutes(DEFAULT_KEY_MAP, { interrupt: "double", mouse: "wheel" })["global.pickModel"]).toBeUndefined();
    // Rebound: the interrupt's route follows the escape key; the cycle keys never become a route.
    const rebound = loadKeyMap({ global: { "ctrl+t": null, "meta+e": "cycleThoughtLevel", "shift+tab": null, escape: null, "ctrl+g": "escape" } });
    const moved = paletteRoutes(rebound, { interrupt: "double", mouse: "full" });
    expect(moved["global.interrupt"]).toBe("ctrl+g ctrl+g");
    expect(moved["global.pickThoughtLevel"]).toBe("click the pill");
    // In the palette: the route in the key column of an entry with no keys, never over its keys.
    const mode: SessionConfigOption = { id: "mode", type: "select", name: "Mode", category: "mode", currentValue: "a", options: [{ value: "a", name: "Auto" }] };
    const entries = [
      ...catalogue,
      { name: "global.interrupt", context: "global", action: "interrupt", title: "Interrupt the turn", keys: [] },
      { name: "global.sessions", context: "global", action: "sessions", title: "Open the session list", keys: [] },
    ] as CatalogueEntry[];
    const items = paletteItems(entries, { configOptions: [model, mode], mouse: "full", permissionOptions: [], routes });
    const route = (title: string) => items.find((i) => i.title === title)?.route ?? null;
    expect(route("Interrupt the turn")).toBe("esc esc");
    expect(route("Choose the mode")).toBe("click the pill");
    expect(route("Choose the model")).toBe("click the pill");
    expect(route("Open the session list")).toBeNull();
    expect(route("Turn mouse reporting off or on")).toBeNull();
  });

  test("the agent's commands: `/<name>` with the description, a list of their own (`/`) that the palette never holds (task 12.1); sanitised", () => {
    const commands = [
      { name: "review", description: "Review a pull request", inputHint: "PR number" },
      { name: "co‮mpact", description: "Compact\nthe conversation", inputHint: null },
    ];
    const first = agentItems(commands);
    expect(first.map((i) => [i.group, i.title, i.description])).toEqual([
      ["Agent commands", "/compact", "Compact the conversation"],
      ["Agent commands", "/review", "Review a pull request"],
    ]);
    expect(first[1]).toMatchObject({ action: { kind: "agent", name: "review", inputHint: "PR number" } });
    expect(first[0]).toMatchObject({ action: { kind: "agent", name: "compact", inputHint: null } });
    // The palette (`?`, Ctrl+P) lists none of them.
    expect(paletteItems(catalogue, { configOptions: [], mouse: "full", permissionOptions: [] }).some((i) => i.action.kind === "agent")).toBe(false);
    // The description is drawn muted after the title, and the filter matches it.
    const view: OverlayView = {
      title: "Commands",
      filter: "",
      placeholder: "",
      items: [first[1]!],
      grouped: true,
      selected: 0,
      offset: 0,
      width: 63,
      rows: 21,
      closeLabel: "esc",
      hints: [],
      marks: false,
    };
    const lines = overlayLayout(view).lines;
    // The group header: bold in the default foreground ((d) 4), not muted.
    expect(lines[2]!.find((s) => s.text === "Agent commands")).toMatchObject({ token: "text", bold: true });
    expect(lines[3]!.map((s) => [s.text.trim(), s.token]).filter(([t]) => t !== "")).toContainEqual(["Review a pull request", "muted"]);
    expect(filterItems(first, "pull").map((i) => i.title)).toEqual(["/review"]);
  });

  test("an empty list shows its own line instead of `no matches` (the slash menu of an agent with no commands, task 12.1)", () => {
    const view: OverlayView = {
      title: "Agent commands",
      filter: "",
      placeholder: "",
      items: [],
      grouped: false,
      selected: 0,
      offset: 0,
      width: 63,
      rows: 21,
      closeLabel: "esc",
      hints: [],
      marks: false,
    };
    const text = (v: OverlayView) => overlayLayout(v).lines.map((l) => l.map((s) => s.text).join(""));
    expect(text(view)[2]).toContain("no matches");
    const hinted = text({ ...view, empty: "the agent offers no commands; ? opens acp-tui's commands" });
    expect(hinted[2]).toBe(`│ the agent offers no commands; ? opens acp-tui's commands${" ".repeat(59 - 56)} │`);
    expect(hinted.join("\n")).not.toContain("no matches");
    // Cut, never wrapped, at a narrow width.
    expect(displayWidth(text({ ...view, width: 40, empty: "the agent offers no commands; ? opens acp-tui's commands" })[2]!)).toBe(40);
  });

  test("a note is a muted line under the filter, not an entry, and the entries keep their rows (day-one-feedback task 10.1)", () => {
    const items = [
      { id: "slash:find", group: "acp-tui", title: "/find" },
      { id: "slash:exit", group: "acp-tui", title: "/exit" },
    ];
    const view: OverlayView = {
      title: "Slash commands",
      filter: "",
      placeholder: "",
      items,
      grouped: true,
      selected: 0,
      offset: 0,
      width: 63,
      rows: 21,
      closeLabel: "esc",
      hints: [],
      marks: false,
    };
    const text = (v: OverlayView) => overlayLayout(v).lines.map((l) => l.map((s) => s.text).join(""));
    const note = "the agent offers no commands; ? opens acp-tui's commands";
    const plain = text(view);
    const noted = text({ ...view, note });
    expect(noted).toHaveLength(plain.length + 1);
    expect(noted[2]).toBe(`│ ${note}${" ".repeat(59 - note.length)} │`);
    expect(noted[3]).toContain("acp-tui");
    expect(overlayLayout({ ...view, note }).lines[2]!.find((s) => s.text === note)?.token).toBe("muted");
    // The count is the entries', and the note is cut to the width.
    expect(noted[0]).toContain("Slash commands 2");
    expect(displayWidth(text({ ...view, width: 40, note })[2]!)).toBe(40);
  });

  describe("legacy models (session-models)", () => {
    const models = {
      currentModelId: "fake-small",
      availableModels: [
        { modelId: "fake-small", name: "Fake Small", description: "The small one" },
        { modelId: "fake-large", name: "Fake Large", description: null },
        { modelId: "fake-hostile", name: "Hos\x1b]52;c;AAAA\x07tile", description: "bad\x1b[31m red" },
      ],
    };

    test("added for a models-only session, with names and descriptions as choices", () => {
      const options = pickerOptions({ configOptions: [], modes: null, models });
      expect(options.map((o) => o.id)).toEqual([LEGACY_MODEL_ID]);
      const legacy = configFor(options, "model") as Extract<SessionConfigOption, { type: "select" }>;
      expect(legacy).toMatchObject({ name: "Model", category: "model", currentValue: "fake-small" });
      expect(pickerItems(legacy).map((i) => [i.title, i.current])).toEqual([
        ["Fake Small", true],
        ["Fake Large", false],
        ["Hostile", false],
      ]);
      expect(pickerItems(legacy).map((i) => i.value)).toEqual(["The small one", null, "bad red"]);
    });

    test("it sits after the config options and the legacy mode", () => {
      const modes = { currentModeId: "plan", availableModes: [{ id: "default", name: "Default" }, { id: "plan", name: "Plan" }] };
      expect(pickerOptions({ configOptions: [], modes, models }).map((o) => o.id)).toEqual([LEGACY_MODE_ID, LEGACY_MODEL_ID]);
    });

    test("a `model` option wins: no legacy option (precedence)", () => {
      expect(pickerOptions({ configOptions: [model], modes: null, models }).map((o) => o.id)).toEqual(["model"]);
    });

    test("an empty list adds nothing", () => {
      expect(pickerOptions({ configOptions: [], modes: null, models: { currentModelId: "x", availableModels: [] } })).toEqual([]);
    });

    test("no legacy model state adds nothing", () => {
      expect(pickerOptions({ configOptions: [model], modes: null, models: null })).toEqual([model]);
    });
  });

  test("legacy modes become a `mode` picker option when the agent offers no mode config option", () => {
    const modes = { currentModeId: "plan", availableModes: [{ id: "default", name: "Default" }, { id: "plan", name: "Plan" }] };
    const options = pickerOptions({ configOptions: [model], modes, models: null });
    expect(options.map((o) => o.id)).toEqual(["model", LEGACY_MODE_ID]);
    const legacy = configFor(options, "mode") as Extract<SessionConfigOption, { type: "select" }>;
    expect(pickerItems(legacy).map((i) => [i.title, i.current])).toEqual([
      ["Default", false],
      ["Plan", true],
    ]);
    expect(nextChoice(legacy)).toEqual({ value: "default", name: "Default" });
    // A `mode` config option wins over legacy modes.
    const mode = { ...model, id: "mode", category: "mode" } as SessionConfigOption;
    expect(pickerOptions({ configOptions: [mode], modes, models: null }).map((o) => o.id)).toEqual(["mode"]);
  });

  test("the permission card's commands only while a request is open, one per option, labelled by kind", () => {
    const items = paletteItems(catalogue, { configOptions: [], mouse: "full", permissionOptions: ["allow once", "reject once"] });
    expect(items.filter((i) => i.group === "Permission").map((i) => i.title)).toEqual(["Select allow once", "Select reject once", "Answer with the selected option"]);
  });

  test("a picker lists the choices with groups, the current one marked", () => {
    expect(pickerItems(model as Extract<SessionConfigOption, { type: "select" }>)).toEqual([
      { id: "a", group: "Plain", title: "Alpha", value: null, current: false, search: "a" },
      { id: "b", group: "Group", title: "Beta", value: "fast", current: true, search: "b" },
    ]);
  });

  test("the list from session/set_config_option is sanitised like the model's (config_options_replaced, design D10)", () => {
    const hostile = { ...model, name: "Mo\x1b]52;c;ZXZpbA==\x07del", options: [{ value: "a", name: "Al\x1b[31mpha" }] } as SessionConfigOption;
    const [option] = reduce(createSession(), { type: "config_options_replaced", configOptions: [hostile], at: 1 }).configOptions;
    expect(option).toMatchObject({ name: "Model", options: [{ value: "a", name: "Alpha" }] });
    expect(pickerItems(option as Extract<SessionConfigOption, { type: "select" }>).map((i) => i.title)).toEqual(["Alpha"]);
  });

  test("Ctrl+P is bound once, in the global context, and the prompt box keeps Up and Down for its line moves", () => {
    expect(keysFor(DEFAULT_KEY_MAP, "global", "palette")).toEqual(["ctrl+p"]);
    for (const context of ["prompt", "conversation", "card", "overlay", "elicitation"] as const) expect(DEFAULT_KEY_MAP[context]["ctrl+p"]).toBeUndefined();
    expect(keysFor(DEFAULT_KEY_MAP, "prompt", "lineUp")).toEqual(["up"]);
    expect(keysFor(DEFAULT_KEY_MAP, "prompt", "lineDown")).toEqual(["down"]);
  });
});

describe("the Configuration problems list (IDE check 12.5)", () => {
  const problem = { file: "/home/u/.config/acp-tui/config.jsonc", line: 4, column: 17, path: "keys.global.ctrl+p", severity: "warning" as const, message: "Zed keeps ctrl+p, so it may never reach acp-tui there; the route to palette there is ?" };

  test("the detail is the problem's whole message alone: the row has its place and setting", () => {
    const [entry] = problemItems([problem], "/home/u");
    expect(entry).toMatchObject({ group: "~/.config/acp-tui/config.jsonc", title: "4:17 keys.global.ctrl+p", value: "warning" });
    expect(problemDetail(entry!)).toBe("Zed keeps ctrl+p, so it may never reach acp-tui there; the route to palette there is ?");
  });

  test("the notice's route: a key bound to configProblems, else the palette's key and the word to type, else config --check", () => {
    expect(problemsRoute(DEFAULT_KEY_MAP)).toBe("? configuration");
    expect(problemsRoute(loadKeyMap({ global: { f12: "configProblems" } }))).toBe("f12");
    expect(problemsRoute(loadKeyMap({ prompt: { "?": null } }))).toBe("ctrl+p configuration");
    expect(problemsRoute(loadKeyMap({ prompt: { "?": null }, global: { "ctrl+p": null } }))).toBe("acp-tui config --check");
  });
});

describe("the pointer in a list (day-two-feedback task 13.6)", () => {
  const view = (items: ListItem[], extra: Partial<OverlayView> = {}): OverlayView => ({
    title: "Commands",
    filter: "",
    placeholder: "type",
    items,
    grouped: true,
    selected: 0,
    offset: 0,
    width: 40,
    rows: 20,
    closeLabel: "esc",
    hints: [],
    marks: false,
    ...extra,
  });

  test("itemAt says which item each line shows: null for the borders, the filter, headers and the blank rows between groups", () => {
    const layout = overlayLayout(view([item("a1", "A"), item("a2", "A"), item("b1", "B"), item("c1", "C")]));
    const shown = layout.lines.map((line, y) => `${y}:${text(line).trim()}`);
    // top border, filter, A, a1, a2, blank, B, b1, blank, C, c1, bottom border
    expect(layout.itemAt).toEqual([null, null, null, 0, 1, null, null, 2, null, null, 3, null]);
    expect(layout.itemAt).toHaveLength(layout.lines.length);
    for (const [y, index] of layout.itemAt.entries()) if (index !== null) expect(shown[y]).toContain(["a1", "a2", "b1", "c1"][index]!);
  });

  test("itemAt follows the scrolled window: only the items in view are mapped, by their index in the list", () => {
    const items = Array.from({ length: 30 }, (_, i) => item(`entry ${i}`, null));
    const layout = overlayLayout(view(items, { grouped: false, selected: 20, rows: 12 }));
    const mapped = layout.itemAt.filter((i): i is number => i !== null);
    expect(mapped).toHaveLength(layout.listHeight);
    expect(mapped.at(-1)).toBe(20);
    expect(mapped).toEqual(mapped.map((_, k) => mapped[0]! + k));
  });

  test("itemUnder maps a screen row through the panel's top; a row outside the panel or on a frame line is no item", () => {
    const layout = overlayLayout(view([item("a1", "A"), item("a2", "A")]));
    const target = { box: () => ({ y: 10 }), itemAt: () => layout.itemAt, select: () => {}, choose: () => {} };
    // top border, filter, header A, a1, a2, bottom border
    expect(itemUnder(target, { y: 13 })).toBe(0);
    expect(itemUnder(target, { y: 14 })).toBe(1);
    expect(itemUnder(target, { y: 10 })).toBeNull();
    expect(itemUnder(target, { y: 12 })).toBeNull();
    expect(itemUnder(target, { y: 2 })).toBeNull();
    expect(itemUnder(target, { y: 99 })).toBeNull();
    expect(itemUnder({ ...target, box: () => undefined }, { y: 13 })).toBeNull();
  });
});

describe("muted entries (day-two-feedback task 13.12)", () => {
  const muted = new Set([0, 2, 3, 6]);
  const skip = (i: number) => muted.has(i);
  test("the keyboard selection skips them: a step lands on the next active entry, and stays where there is none", () => {
    expect(moveSelection(7, 1, 1, skip)).toBe(4);
    expect(moveSelection(7, 4, -1, skip)).toBe(1);
    expect(moveSelection(7, 4, 1, skip)).toBe(5);
    expect(moveSelection(7, 5, 1, skip)).toBe(5);
    expect(moveSelection(7, 1, -1, skip)).toBe(1);
    expect(moveSelection(7, 4, "first", skip)).toBe(1);
    expect(moveSelection(7, 1, "last", skip)).toBe(5);
    expect(moveSelection(3, 0, "first", () => true)).toBe(0);
    expect(moveSelection(3, 0, 1, () => true)).toBe(0);
  });
  test("a list starts at its first active entry, and at the first entry when none is", () => {
    expect(firstActive(7, skip)).toBe(1);
    expect(firstActive(3, () => true)).toBe(0);
    expect(firstActive(0, skip)).toBe(0);
  });
  test("a page lands on an active entry", () => {
    const items: ListItem[] = Array.from({ length: 8 }, (_, i) => ({ id: `i${i}`, group: null, title: `item ${i}`, ...(i === 4 ? { muted: true } : {}) }));
    const rows = listRows(items, false);
    const page = pageSelection(rows, 0, 5, 1, (i) => items[i]!.muted === true);
    expect(page).not.toBe(4);
    expect(page).toBe(3);
  });
});
