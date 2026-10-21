// Layout validation, priority dropping and bar placement (Phase 0 task 6.4;
// phase-1a task 6.1: the layout covers the whole screen, spec tui-layout;
// mvp-chrome-and-keys task 4.1: margins, spacers and the required find block).
import { describe, expect, test } from "bun:test";
import { createRoot } from "solid-js";
import { createLayoutState } from "../../src/layout/layout-state.ts";
import {
  COMPACT_LAYOUT,
  DEFAULT_LAYOUT,
  barText,
  layoutBar,
  resolveBar,
  resolveLayout,
  validateLayout,
  type BarRegion,
  type ResolvedBar,
} from "../../src/layout/layout.ts";
import { FULL_VIEW, view } from "./fixtures.ts";
import { screenRows } from "./screen-rows.tsx";

function errorsOf(layout: unknown): string[] {
  const result = validateLayout(layout);
  return result.ok ? [] : result.errors;
}

const bar = (region: BarRegion): ResolvedBar => resolveBar(region);
const BLOCKS = ["conversation", "card", "prompt", "find"] as const;
const STATE_BAR = { left: ["turn-state", "connection"] } as const;

/** The Phase 0 status bar, kept as a fixture for the composition rules. */
const STATUS = bar({ left: ["agent", "model", "mode", "cwd"], right: ["turn-state", "connection", "usage", "cost"] });

describe("validation", () => {
  test("the default and header-bar layouts are valid", () => {
    expect(errorsOf(DEFAULT_LAYOUT)).toEqual([]);
    expect(errorsOf(COMPACT_LAYOUT)).toEqual([]);
  });

  test("default layout (decision 15, mvp-chrome-and-keys D1): margins, conversation, activity, card, prompt, spacer, find, status row; no header", () => {
    const resolved = resolveLayout(DEFAULT_LAYOUT);
    expect(resolved.margins).toEqual({ top: 1, bottom: 1 });
    const regions = resolved.regions;
    expect(regions.map((r) => (r.kind === "block" ? r.name : r.kind))).toEqual(["conversation", "activity", "card", "prompt", "spacer", "find", "bar"]);
    expect(regions[4]).toEqual({ kind: "spacer", rows: 1 });
    const status = regions[6] as ResolvedBar;
    expect(status.left.map((m) => m.id)).toEqual(["cwd", "dirs", "turn-state", "hints"]);
    // mvp-configuration task 3.4: the `config` module, hidden while the configuration has no problem.
    expect(status.right.map((m) => m.id)).toEqual(["config", "mouse", "density", "position", "connection", "usage", "cost"]);
  });

  test("the find bar is its own block directly above the status row, in both built-in layouts (mvp-conversation D10), and required", () => {
    for (const layout of [DEFAULT_LAYOUT, COMPACT_LAYOUT]) {
      const regions = resolveLayout(layout).regions;
      expect(regions.at(-2)).toEqual({ kind: "block", name: "find" });
      expect(regions.at(-1)?.kind).toBe("bar");
    }
    expect(errorsOf({ screen: ["conversation", "card", "prompt", STATE_BAR] })).toEqual([
      'layout is missing the "find" region; it must appear exactly once',
    ]);
  });

  test("header-bar layout: agent and cwd on top, turn state and connection at the bottom", () => {
    const resolved = resolveLayout(COMPACT_LAYOUT);
    expect(resolved.margins).toEqual({ top: 1, bottom: 1 });
    const regions = resolved.regions;
    expect(regions.map((r) => (r.kind === "block" ? r.name : r.kind))).toEqual(["bar", "conversation", "activity", "card", "prompt", "find", "bar"]);
    expect((regions[0] as ResolvedBar).left.map((m) => m.id)).toEqual(["agent", "cwd"]);
    const last = regions[6] as ResolvedBar;
    expect([...last.left, ...last.right].map((m) => m.id)).toEqual(["turn-state", "connection"]);
  });

  test("missing prompt box: validation names the missing prompt region", () => {
    const errors = errorsOf({ screen: ["conversation", "card", "find", STATE_BAR] });
    expect(errors).toEqual(['layout is missing the "prompt" region; it must appear exactly once']);
  });

  test("conversation twice: validation names the duplicate region", () => {
    const errors = errorsOf({ screen: ["conversation", "card", "conversation", "prompt", "find", STATE_BAR] });
    expect(errors).toEqual(['the "conversation" region appears 2 times; it must appear exactly once']);
  });

  test("negative margin: validation names both the margin and the missing find region", () => {
    const errors = errorsOf({ margins: { top: -1, bottom: 1 }, screen: ["conversation", "card", "prompt", STATE_BAR] });
    expect(errors).toEqual([
      "the top margin takes 1 to 3 rows (got -1)",
      'layout is missing the "find" region; it must appear exactly once',
    ]);
  });

  test("no bottom margin: validation says the bottom margin takes 1 to 3 rows, and the layout in use is unchanged", () => {
    const layout = { margins: { top: 1, bottom: 0 }, screen: [...BLOCKS, STATE_BAR] };
    expect(errorsOf(layout)).toEqual(["the bottom margin takes 1 to 3 rows (got 0)"]);
    createRoot((dispose) => {
      const state = createLayoutState();
      const before = state.layout();
      expect(state.setLayout(layout).ok).toBe(false);
      expect(state.layout()).toBe(before);
      expect(state.layout().margins).toEqual({ top: 1, bottom: 1 });
      dispose();
    });
  });

  test("margins: whole rows from 1 to 3; absent ones take the default's; unknown keys named", () => {
    expect(resolveLayout({ margins: { top: 3, bottom: 2 }, screen: [...BLOCKS, STATE_BAR] }).margins).toEqual({ top: 3, bottom: 2 });
    expect(resolveLayout({ screen: [...BLOCKS, STATE_BAR] }).margins).toEqual({ top: 1, bottom: 1 });
    expect(resolveLayout({ margins: { bottom: 2 }, screen: [...BLOCKS, STATE_BAR] }).margins).toEqual({ top: 1, bottom: 2 });
    expect(errorsOf({ margins: { top: 4, bottom: 1.5, left: 1 }, screen: [...BLOCKS, STATE_BAR] })).toEqual([
      'margins: unknown key "left" (expected top, bottom)',
      "the top margin takes 1 to 3 rows (got 4)",
      "the bottom margin takes 1 to 3 rows (got 1.5)",
    ]);
    expect(errorsOf({ margins: 1, screen: [...BLOCKS, STATE_BAR] })).toEqual(['"margins" must be an object with "top" and "bottom" rows']);
  });

  test("spacers: whole rows from 0 to 3", () => {
    const regions = resolveLayout({ screen: ["conversation", { spacer: 0 }, "card", "prompt", { spacer: 3 }, "find", STATE_BAR] }).regions;
    expect(regions[1]).toEqual({ kind: "spacer", rows: 0 });
    expect(regions[4]).toEqual({ kind: "spacer", rows: 3 });
    expect(errorsOf({ screen: [...BLOCKS, { spacer: 4 }, { spacer: -1 }, { spacer: 1, colour: 2 }, STATE_BAR] })).toEqual([
      "screen[4]: a spacer takes 0 to 3 rows (got 4)",
      "screen[5]: a spacer takes 0 to 3 rows (got -1)",
      'screen[6]: unknown spacer key "colour"',
    ]);
  });

  test("every problem is named at once", () => {
    const errors = errorsOf({ screen: ["card", "card", { left: ["agent"] }] });
    expect(errors).toEqual([
      'layout is missing the "conversation" region; it must appear exactly once',
      'the "card" region appears 2 times; it must appear exactly once',
      'layout is missing the "prompt" region; it must appear exactly once',
      'layout is missing the "find" region; it must appear exactly once',
      'layout is missing the "turn-state" module; it must appear in a bar',
      'layout is missing the "connection" module; it must appear in a bar',
    ]);
  });

  test("the activity bar is optional", () => {
    expect(errorsOf({ screen: [...BLOCKS, STATE_BAR] })).toEqual([]);
  });

  test("turn-state and connection must each be in a bar", () => {
    const errors = errorsOf({ screen: [...BLOCKS, { left: ["agent"] }] });
    expect(errors).toEqual([
      'layout is missing the "turn-state" module; it must appear in a bar',
      'layout is missing the "connection" module; it must appear in a bar',
    ]);
  });

  test("a turn-state format that hides the state is rejected", () => {
    const errors = errorsOf({ screen: [...BLOCKS, { left: [{ id: "turn-state", format: "turn {elapsed}" }, "connection"] }] });
    expect(errors).toEqual(['the "turn-state" module\'s format must include "{state}" so the state stays visible']);
  });

  test("unknown regions, modules, settings and placeholders are named", () => {
    const errors = errorsOf({
      screen: [
        ...BLOCKS,
        "sidebar",
        { left: ["turn-state", "connection", "weather", { id: "usage", format: "{tokens}" }, { id: "cwd", colour: 3 }], top: [] },
      ],
    });
    expect(errors).toEqual([
      'screen[4]: unknown region "sidebar" (blocks: conversation, activity, card, prompt, find)',
      'screen[5]: unknown bar key "top" (expected left, center, right)',
      'screen[5].left[2]: unknown module "weather"',
      'screen[5].left[3] module "usage": unknown placeholder "{tokens}" (allowed: {used}, {size}, {percent})',
      'screen[5].left[4] module "cwd": unknown setting "colour"',
    ]);
  });

  test("the Phase 0 footer blocks are gone", () => {
    const errors = errorsOf({ screen: [...BLOCKS, "composer", "permission", "plan", "picker", STATE_BAR] });
    expect(errors).toHaveLength(4);
    expect(errors[0]).toBe('screen[4]: unknown region "composer" (blocks: conversation, activity, card, prompt, find)');
  });

  test("setting types are checked", () => {
    const errors = errorsOf({
      screen: [...BLOCKS, { left: ["turn-state", "connection", { id: "agent", priority: "high", token: "status.bg", format: "{agent" }] }],
    });
    expect(errors).toEqual([
      'screen[4].left[2] module "agent": unclosed "{" in format "{agent"',
      'screen[4].left[2] module "agent": "priority" must be a number',
      'screen[4].left[2] module "agent": "token" must be a foreground theme token',
    ]);
  });

  test("not a layout at all", () => {
    expect(errorsOf(null)).toEqual(['layout must have a "screen" list of regions']);
    expect(errorsOf({ footer: [] })).toEqual(['layout must have a "screen" list of regions']);
    expect(() => resolveLayout({ screen: [] })).toThrow(/missing the "conversation" region/);
  });

  test("a single bar resolves on its own and reports its problems", () => {
    expect(resolveBar({ left: ["agent"] }).left.map((m) => m.id)).toEqual(["agent"]);
    expect(() => resolveBar({ left: ["weather" as never] })).toThrow(/unknown module "weather"/);
  });

  test("a rejected layout never replaces the one in use", () => {
    createRoot((dispose) => {
      const state = createLayoutState();
      const before = state.layout();
      const rejected = state.setLayout({ screen: ["conversation", "card", STATE_BAR] });
      expect(rejected.ok).toBe(false);
      expect(state.layout()).toBe(before);
      const accepted = state.setLayout(COMPACT_LAYOUT);
      expect(accepted.ok).toBe(true);
      expect(state.layout()).not.toBe(before);
      expect(state.layout().regions[0]?.kind).toBe("bar");
      dispose();
    });
  });
});

describe("screen rows (mvp-chrome-and-keys task 4.1)", () => {
  test("default layout at rest in a 21-row pane: row 1 blank, conversation 2 to 13, the activity line (blank) on row 14, prompt box 15 to 18 with one text row and its padding row, row 19 blank, status row 20, row 21 blank", async () => {
    const rows = await screenRows(resolveLayout(DEFAULT_LAYOUT), FULL_VIEW, 63, 21);
    expect(rows).toHaveLength(21);
    expect(rows[0]).toBe("");
    expect(rows.slice(1, 13)).toEqual(Array(12).fill("C"));
    // The activity bar keeps its line for the whole session (day-two-feedback task 13.2, Marcus 17
    // October 2026), counted in the row budget; its blank row, which replaces the idle blank row,
    // is drawn only where the conversation keeps its floor of 12 with it (not at 63x21).
    expect(rows[13]).toBe("A");
    expect(rows.slice(14, 18)).toEqual(Array(4).fill("P"));
    expect(rows[18]).toBe("");
    expect(rows[19]).toMatch(/^ ~\/Projects\/acp-tui {2}idle\b.*connected/);
    expect(rows[20]).toBe("");
  });

  test("alternative layout with a header bar: row 1 blank, agent and cwd on row 2, conversation from row 3, turn state and connection on the second-last row, last row blank", async () => {
    const rows = await screenRows(resolveLayout(COMPACT_LAYOUT), FULL_VIEW, 63, 21);
    expect(rows[0]).toBe("");
    expect(rows[1]).toBe(" Claude Code  ~/Projects/acp-tui");
    expect(rows[2]).toBe("C");
    expect(rows[19]).toMatch(/^ idle\s+connected$/);
    expect(rows[20]).toBe("");
  });

  test("the find bar takes its row directly above the status row, from the conversation", async () => {
    const rows = await screenRows(resolveLayout(DEFAULT_LAYOUT), FULL_VIEW, 63, 21, { find: 1 });
    expect(rows.slice(1, 12)).toEqual(Array(11).fill("C"));
    expect(rows[12]).toBe("A");
    expect(rows.slice(13, 17)).toEqual(Array(4).fill("P"));
    expect(rows[17]).toBe("");
    expect(rows[18]).toBe("F");
    expect(rows[19]).toContain("idle");
    expect(rows[20]).toBe("");
  });
});

// Spec tui-layout "Spacing gives way before content" (day-one-feedback, Marcus 15 October 2026).
// The rows between the top margin and the spacer above the status row, as letters.
const middle = (rows: string[]) => rows.slice(1, rows.length - 3);

describe("spacing (day-one-feedback task group 13)", () => {
  test("a tall pane keeps every gap: a blank row above the activity bar, above and below the card, the card's padding rows and the prompt box's padding row", async () => {
    const rows = await screenRows(resolveLayout(DEFAULT_LAYOUT), FULL_VIEW, 63, 40, { activity: 1, card: 9 });
    const shown = middle(rows);
    const at = shown.indexOf("A");
    expect(shown.slice(at - 1)).toEqual(["", "A", "", "k", ...Array(9).fill("K"), "k", "", "P", "P", "P", "P"]);
    expect(shown.slice(0, at - 1).every((r) => r === "C")).toBe(true);
  });

  test("a running turn without a card, and at rest: the activity line directly on the prompt box, whether or not a call runs, and its blank row only where the conversation keeps its floor with it (day-two-feedback task 13.2)", async () => {
    const running = middle(await screenRows(resolveLayout(DEFAULT_LAYOUT), FULL_VIEW, 63, 21, { activity: 1 }));
    expect(running).toEqual([...Array(12).fill("C"), "A", "P", "P", "P", "P"]);
    const idle = middle(await screenRows(resolveLayout(DEFAULT_LAYOUT), FULL_VIEW, 63, 21));
    expect(idle).toEqual(running);
    // One row taller: the blank row above the line fits with the floor, and is there from the first frame.
    expect(middle(await screenRows(resolveLayout(DEFAULT_LAYOUT), FULL_VIEW, 63, 22))).toEqual([...Array(12).fill("C"), "", "A", "P", "P", "P", "P"]);
  });

  test("a layout without the activity block keeps the old idle blank row above the prompt box", async () => {
    const layout = resolveLayout({ ...DEFAULT_LAYOUT, screen: DEFAULT_LAYOUT.screen.filter((region) => region !== "activity") });
    expect(middle(await screenRows(layout, FULL_VIEW, 63, 21))).toEqual([...Array(12).fill("C"), "", "P", "P", "P", "P"]);
  });

  test("Four options in a 21-row pane: every decorative row gives way, so a 9-row card (title, two preview rows, four options) and the conversation's four rows fit", async () => {
    const shown = middle(await screenRows(resolveLayout(DEFAULT_LAYOUT), FULL_VIEW, 63, 21, { activity: 1, card: 9 }));
    expect(shown).toEqual([...Array(4).fill("C"), "A", ...Array(9).fill("K"), "P", "P", "P"]);
  });

  test("one row more, 63x22: the prompt box's padding row, the last to give way, comes back first", async () => {
    const shown = middle(await screenRows(resolveLayout(DEFAULT_LAYOUT), FULL_VIEW, 63, 22, { activity: 1, card: 9 }));
    expect(shown).toEqual([...Array(4).fill("C"), "A", ...Array(9).fill("K"), "P", "P", "P", "P"]);
  });

  test("the order: the row below the card goes first, then the row above it, the activity bar's blank row, the card's padding rows and the prompt box's padding row", async () => {
    // Content: the activity line, a 9-row card, a 3-row prompt box and the conversation's 4 rows
    // take 17 rows; 21 + n rows leave n for the 6 decorative rows.
    const at = async (rows: number) => middle(await screenRows(resolveLayout(DEFAULT_LAYOUT), FULL_VIEW, 63, rows, { activity: 1, card: 9 })).filter((r) => r !== "C");
    const K = Array(9).fill("K");
    expect(await at(27)).toEqual(["", "A", "", "k", ...K, "k", "", "P", "P", "P", "P"]);
    expect(await at(26)).toEqual(["", "A", "", "k", ...K, "k", "P", "P", "P", "P"]);
    expect(await at(25)).toEqual(["", "A", "k", ...K, "k", "P", "P", "P", "P"]);
    expect(await at(24)).toEqual(["A", "k", ...K, "k", "P", "P", "P", "P"]);
    expect(await at(23)).toEqual(["A", ...K, "P", "P", "P", "P"]);
  });

  test("a card that fits keeps its gaps where the rows allow: at 63x21 a 4-row card keeps all but the row below it", async () => {
    const shown = middle(await screenRows(resolveLayout(DEFAULT_LAYOUT), FULL_VIEW, 63, 21, { activity: 1, card: 4 }));
    expect(shown.filter((r) => r !== "C")).toEqual(["", "A", "", "k", "K", "K", "K", "K", "k", "P", "P", "P", "P"]);
    expect(shown.filter((r) => r === "C").length).toBe(4);
  });

  test("a card with no padding rows (`cards.padding.rows` 0) has none to give", async () => {
    const shown = middle(await screenRows(resolveLayout(DEFAULT_LAYOUT), FULL_VIEW, 63, 40, { activity: 1, card: 9, cardPadding: 0 }));
    expect(shown.filter((r) => r !== "C")).toEqual(["", "A", "", ...Array(9).fill("K"), "", "P", "P", "P", "P"]);
  });

  test("at rest the activity line and its blank row count in the row budget: the prompt box rests at one text row at 63x22, and at two from 63x23, the conversation keeping 12 rows; below the floor the blank row gives way and the line stays", async () => {
    expect(middle(await screenRows(resolveLayout(DEFAULT_LAYOUT), FULL_VIEW, 63, 22))).toEqual([...Array(12).fill("C"), "", "A", "P", "P", "P", "P"]);
    expect(middle(await screenRows(resolveLayout(DEFAULT_LAYOUT), FULL_VIEW, 63, 23))).toEqual([...Array(12).fill("C"), "", "A", "P", "P", "P", "P", "P"]);
    expect(middle(await screenRows(resolveLayout(DEFAULT_LAYOUT), FULL_VIEW, 61, 20))).toEqual([...Array(11).fill("C"), "A", "P", "P", "P", "P"]);
  });

  test("a very short pane: the prompt box's padding row gives way before the conversation goes below four rows, the activity line keeping its row", async () => {
    // 63x12: 8 rows between the margin and the spacer; the activity line takes 1, the prompt box 3, the conversation 4.
    expect(middle(await screenRows(resolveLayout(DEFAULT_LAYOUT), FULL_VIEW, 63, 12))).toEqual([...Array(4).fill("C"), "A", "P", "P", "P"]);
    expect(middle(await screenRows(resolveLayout(DEFAULT_LAYOUT), FULL_VIEW, 63, 13))).toEqual([...Array(4).fill("C"), "A", "P", "P", "P", "P"]);
  });
});

describe("bar composition", () => {
  test("everything fits at 120 columns: left and right groups, one column of padding", () => {
    const row = layoutBar(STATUS, FULL_VIEW, 120);
    const text = barText(row);
    expect(Bun.stringWidth(text)).toBe(120);
    expect(text).toBe(
      " Claude Code  sonnet-4.5  mode:Accept Edits  ~/Projects/acp-tui" +
        " ".repeat(120 - 63 - 37) +
        "idle  connected  ctx 38k/200k  $0.41 ",
    );
    expect(row.dropped).toEqual([]);
  });

  test("drops lowest priority first until it fits", () => {
    const row = layoutBar(STATUS, FULL_VIEW, 100);
    // `usage` (22) is the lowest since mvp-chrome-and-keys design D5 raised `cost` to 75.
    expect(row.dropped).toEqual(["usage"]);
    expect(Bun.stringWidth(barText(row))).toBeLessThanOrEqual(100);
    const narrow = layoutBar(STATUS, FULL_VIEW, 60);
    expect(narrow.dropped).toEqual(["usage", "cwd", "mode"]);
    expect(barText(narrow)).toBe(" Claude Code  sonnet-4.5" + " ".repeat(13) + "idle  connected  $0.41 ");
  });

  test("additional directories: +2 dirs sits after cwd, and in a 63-column status row is dropped before cwd (spec tui-layout \"Additional directories module\")", () => {
    const status = resolveLayout(DEFAULT_LAYOUT).regions.find((region): region is ResolvedBar => region.kind === "bar")!;
    const v = view({ cwd: "/home/user/Projects/a-rather-long-project-directory-name", additionalDirectories: ["/home/user/Projects/lib", "/home/user/Projects/docs"] });
    expect(barText(layoutBar(status, v, 140))).toContain("oject-directory-name  +2 dirs");
    const narrow = layoutBar(status, v, 63);
    expect(narrow.dropped).toContain("dirs");
    expect(narrow.dropped.indexOf("dirs")).toBeLessThan(narrow.dropped.indexOf("cwd") < 0 ? Infinity : narrow.dropped.indexOf("cwd"));
    expect(barText(narrow)).not.toContain("+2 dirs");
  });

  test("narrow pane with a permission open: turn state still reads requires_action", () => {
    const v = view({ turnState: "requires_action" }, { permissionOpen: true, focus: "card" });
    const row = layoutBar(STATUS, v, 60);
    expect(barText(row)).toContain("requires_action");
    expect(Bun.stringWidth(barText(row))).toBeLessThanOrEqual(60);
    // The default status row (priorities of mvp-chrome-and-keys design D5): `usage`, then the
    // hints (one at a time) give way before `cwd`, and `cost` outranks all three.
    const status = resolveLayout(DEFAULT_LAYOUT).regions[6] as ResolvedBar;
    const narrow = layoutBar(status, v, 60);
    expect(barText(narrow)).toBe(" ~/Projects/acp-tui  requires_action       connected  $0.41 ");
    expect(narrow.dropped).toEqual(["usage", "hints"]);
    // Narrower still: the cwd goes, then the cost; requires_action stays.
    expect(layoutBar(status, v, 30).shown).toEqual(["turn-state", "connection"]);
    expect(barText(layoutBar(status, v, 14))).toContain("requires_action".slice(0, 5));
  });

  test("never drops turn-state in requires_action or connection when disconnected, even below their priority", () => {
    const b = bar({
      left: [{ id: "turn-state", priority: 1 }, { id: "connection", priority: 1 }, { id: "agent", priority: 99 }],
    });
    const v = view({ turnState: "requires_action", connection: "disconnected" });
    const row = layoutBar(b, v, 32);
    expect(row.shown).toEqual(["turn-state", "connection"]);
    expect(barText(row)).toBe(" requires_action  disconnected ");
    // Idle and connected, the same modules are dropped like any other.
    expect(layoutBar(b, view(), 14).shown).toEqual(["agent"]);
  });

  test("cost at IDE-pane width (mvp-chrome-and-keys task 4.6): at 63 columns with a long cwd the cost stays, and cwd or the hints give way first", () => {
    const status = resolveLayout(DEFAULT_LAYOUT).regions[6] as ResolvedBar;
    const v = view({ cwd: "/tmp/acp-tui-test-8f3a2c/workspace/projects/repository", home: null, cost: { amount: 1.23, currency: "USD" } });
    const row = layoutBar(status, v, 63);
    expect(barText(row)).toContain("$1.23");
    expect(barText(row)).toContain("idle");
    expect(barText(row)).toContain("connected");
    expect(Bun.stringWidth(barText(row))).toBeLessThanOrEqual(63);
    expect(row.dropped.length).toBeGreaterThan(0);
    for (const id of row.dropped) expect(["usage", "hints", "cwd"]).toContain(id);
  });

  test("density mark (task 4.6): shown for compact and verbose, hidden at focus (the default setting), below cost and position", () => {
    const status = resolveLayout(DEFAULT_LAYOUT).regions[6] as ResolvedBar;
    expect(barText(layoutBar(status, view({ density: "compact" }), 120))).toContain("density: compact");
    expect(barText(layoutBar(status, view({ density: "focus" }), 120))).not.toContain("density");
    const priority = (id: string) => [...status.left, ...status.right].find((m) => m.id === id)!.priority;
    expect([priority("turn-state"), priority("connection"), priority("mouse"), priority("cost"), priority("position"), priority("density"), priority("cwd"), priority("hints"), priority("usage")]).toEqual([
      100, 90, 85, 75, 70, 65, 30, 25, 22,
    ]);
  });

  test("ties drop the later entry first", () => {
    const b = bar({ left: [{ id: "model", priority: 5 }, { id: "mode", priority: 5 }] });
    expect(layoutBar(b, FULL_VIEW, 14).shown).toEqual(["model"]);
  });

  test("hints lose their last hint before the module is dropped", () => {
    const b = bar({ left: ["turn-state", "hints"], right: ["connection"] });
    const row = layoutBar(b, FULL_VIEW, 50);
    expect(barText(row)).toBe(" idle  shift+tab mode  / commands       connected ");
    expect(barText(layoutBar(b, FULL_VIEW, 34))).toBe(" idle  shift+tab mode   connected ");
    const none = layoutBar(b, FULL_VIEW, 20);
    expect(none.shown).toEqual(["turn-state", "connection"]);
    expect(none.dropped).toEqual(["hints"]);
  });

  test("a module left on its own is truncated rather than dropped, at hint boundaries", () => {
    const hints = bar({ left: ["hints"] });
    const row = layoutBar(hints, FULL_VIEW, 40);
    expect(barText(row)).toBe(" shift+tab mode  / commands  ? help ");
    const tiny = layoutBar(hints, FULL_VIEW, 8);
    expect(barText(tiny)).toBe(" shift… ");
  });

  test("center group is centred when it does not collide", () => {
    const b = bar({ left: ["agent"], center: [{ id: "text", format: "MID" }], right: ["cost"] });
    const text = barText(layoutBar(b, FULL_VIEW, 41));
    expect(text).toBe(" Claude Code" + " ".repeat(7) + "MID" + " ".repeat(13) + "$0.41 ");
    expect(text.indexOf("MID")).toBe(1 + Math.floor((39 - 3) / 2));
  });

  test("hidden modules take no space; a bar with nothing to show is empty", () => {
    const b = bar({ left: ["model", "mode", "cwd"] });
    expect(layoutBar(b, view({ model: null, mode: null, cwd: null }), 80).segments).toEqual([]);
  });

  test("East Asian wide text is measured in columns", () => {
    const b = bar({ left: ["agent"], right: ["model"] });
    const v = view({ agent: "エージェント", model: "模型" });
    const text = barText(layoutBar(b, v, 20));
    expect(Bun.stringWidth(text)).toBe(20);
    expect(text).toBe(" エージェント  模型 ");
    // One column fewer: the lower-priority model goes.
    expect(barText(layoutBar(b, v, 19))).toBe(" エージェント ");
  });

  test("spacing uses the status token; module segments keep their tokens", () => {
    const row = layoutBar(STATUS, FULL_VIEW, 120);
    expect(row.segments.find((s) => s.text === "Claude Code")?.token).toBe("accent");
    expect(row.segments.find((s) => s.text === "idle")?.token).toBe("muted");
    expect(row.segments.filter((s) => s.text.trim() === "").every((s) => s.token === "status.fg")).toBe(true);
  });
});
