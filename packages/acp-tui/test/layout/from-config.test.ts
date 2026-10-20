// mvp-configuration tasks 6.1 to 6.4 and 3.4 (spec tui-layout "Layouts from the
// configuration", "Module settings from the configuration", "Protected chrome
// in configured layouts", "Conversation row floor setting", "Declarative screen
// layout" and "Bar modules"): the layout built from a configuration file's
// `layout` section through the real loader and store, drawn with the screen's
// stand-in blocks, the prompt box's bottom border, and the configuration's
// problems.
import { describe, expect, test } from "bun:test";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { createSession, type Session } from "acp-model";
import { parseConfigText } from "../../src/config/load.ts";
import { createConfigStore } from "../../src/config/store.ts";
import type { FileRead } from "../../src/config/sources.ts";
import { defaultConfig, describeOf, SECTIONS } from "../../src/config/schema.ts";
import { bottomBorder } from "../../src/layout/border.ts";
import { layoutFromConfig } from "../../src/layout/from-config.ts";
import { barText, DEFAULT_LAYOUT, layoutBar, resolveLayout, type ResolvedBar } from "../../src/layout/layout.ts";
import { MODULE_IDS, MODULES } from "../../src/layout/modules.ts";
import { deriveSessionView } from "../../src/layout/view.ts";
import { FULL_VIEW, view } from "./fixtures.ts";
import { screenRows } from "./screen-rows.tsx";

const FILE = "/home/u/.config/acp-tui/config.jsonc";

/** A store over one in-memory user file, edited by `set`. */
function memoryStore(initial: string | null) {
  let text = initial;
  const env = { XDG_CONFIG_HOME: "/home/u/.config", HOME: "/home/u" };
  const read = (path: string): FileRead => ({ text: path === FILE ? text : null, unsafe: null, error: null });
  const store = createConfigStore({ env, sessionDirectory: null, read });
  return { store, set: (next: string | null) => (text = next) };
}

const layoutOf = (text: string | null) => layoutFromConfig(memoryStore(text).store.config().layout);
const statusBar = (layout: ReturnType<typeof layoutFromConfig>) => [...layout.regions].reverse().find((r) => r.kind === "bar") as ResolvedBar;

describe("Layouts from the configuration (task 6.1)", () => {
  test("Header bar from the file: below the top margin the first row shows the agent, model and cwd, and the margins are the default layout's", async () => {
    const layout = layoutOf(
      JSON.stringify({
        layout: { screen: [{ left: ["agent", "model", "cwd"], right: ["turn-state", "connection"] }, "conversation", "activity", "card", "prompt", "find"] },
      }),
    );
    expect(layout.margins).toEqual({ top: 1, bottom: 1 });
    const rows = await screenRows(layout, FULL_VIEW, 63, 21);
    expect(rows[0]).toBe("");
    expect(rows[1]).toMatch(/^ Claude Code {2}sonnet-4\.5 {2}~\/Projects\/acp-tui .*idle {2}connected$/);
    expect(rows[2]).toBe("C");
    expect(rows[20]).toBe("");
  });

  test("Pills reordered: the model pill, then the mode pill, and no effort pill", () => {
    const option = (id: string, name: string, category: string, value: string): SessionConfigOption => ({
      id,
      name,
      category,
      type: "select",
      currentValue: value,
      options: [{ value, name: value }],
    });
    const session: Session = {
      ...createSession(),
      configOptions: [option("mode", "Mode", "mode", "Auto"), option("model", "Model", "model", "Opus"), option("effort", "Effort", "thought_level", "high")],
    };
    const layout = layoutOf(`{ "layout": { "prompt": { "pills": ["model", "mode"] } } }`);
    const row = bottomBorder(deriveSessionView(session), 63, "muted", layout.prompt)
      .map((s) => s.text)
      .join("");
    expect(row.startsWith("╰─ Model Opus ─ Mode Auto ─")).toBe(true);
    expect(row).not.toContain("Effort");
    expect(row).not.toContain("high");
  });

  test("the prompt box's right list from the file, with the modules' settings", () => {
    const layout = layoutOf(`{ "layout": { "prompt": { "right": ["cost"] }, "modules": { "cost": { "format": "spent {cost}" } } } }`);
    const row = bottomBorder(view(), 63, "muted", layout.prompt)
      .map((s) => s.text)
      .join("");
    expect(row).toContain(" spent $0.41 ─╯");
    expect(row).not.toContain("38k");
  });

  test("the default layout's rows are unchanged apart from the hidden config module", async () => {
    const fromFile = layoutOf(null);
    const rows = await screenRows(fromFile, FULL_VIEW, 63, 21);
    expect(rows).toEqual(await screenRows(resolveLayout(DEFAULT_LAYOUT), FULL_VIEW, 63, 21));
    expect(rows[19]).toMatch(/^ ~\/Projects\/acp-tui {2}idle\b.*connected/);
    expect(rows[19]).not.toContain("config");
    expect(fromFile.conversationMinRows).toBe(12);
    expect(fromFile.scrollbar).toBe(true);
  });
});

describe("Module settings from the configuration (task 6.2)", () => {
  test("Format template: dir {basename} with the session directory /work/repo-b reads dir repo-b", () => {
    const layout = layoutOf(`{ "layout": { "modules": { "cwd": { "format": "dir {basename}" } } } }`);
    const status = statusBar(layout);
    expect(barText(layoutBar(status, view({ cwd: "/work/repo-b", home: "/home/u" }), 120))).toMatch(/^ dir repo-b {2}idle/);
  });

  test("priority and hide_when_empty apply wherever the module appears", () => {
    const layout = layoutOf(`{ "layout": { "modules": { "usage": { "priority": 99, "hide_when_empty": false } } } }`);
    const usage = statusBar(layout).right.find((m) => m.id === "usage")!;
    expect(usage.priority).toBe(99);
    expect(usage.hideWhenEmpty).toBe(false);
    expect(layout.prompt.right.right[0]).toMatchObject({ id: "usage", priority: 99, format: "{used}/{size}" });
  });

  test("Unknown field: a problem names {colour} and lists the fields of cost, and cost keeps its previous format", () => {
    const { store, set } = memoryStore(`{ "layout": { "modules": { "cost": { "format": "spent {cost}" } } } }`);
    expect(store.problems()).toEqual([]);
    set(['{ "layout": { "modules": {', '  "cost": { "format": "{cost} {currency} {colour}" }', "} } }"].join("\n"));
    const { problems } = store.reload();
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ file: FILE, line: 2, column: 23, path: "layout.modules.cost.format", severity: "error" });
    expect(problems[0]!.message).toContain("{colour}");
    expect(problems[0]!.message).toContain("{cost}, {amount}, {currency}");
    expect(store.config().layout.modules?.cost?.format).toBe("spent {cost}");
    expect(barText(layoutBar(statusBar(layoutFromConfig(store.config().layout)), view(), 120))).toContain("spent $0.41");
  });

  test("a format naming no field of a module absent from the layout is still reported", () => {
    const parsed = parseConfigText(`{ "layout": { "modules": { "agent": { "format": "{model}" } } } }`, FILE);
    expect(parsed.rejected).toEqual(["layout"]);
    expect(parsed.problems[0]).toMatchObject({ path: "layout.modules.agent.format" });
    expect(parsed.problems[0]!.message).toContain("the fields of agent are {agent}, {version}");
  });

  test("an unknown module name is an error with the closest name", () => {
    const parsed = parseConfigText(`{ "layout": { "modules": { "costs": { "priority": 1 } } } }`, FILE);
    expect(parsed.rejected).toEqual(["layout"]);
    expect(parsed.problems[0]).toMatchObject({ path: "layout.modules.costs", suggestion: "cost" });
  });

  test("every module's fields appear in its description, which the commented default prints", () => {
    const modules = (SECTIONS.layout as unknown as { def: { innerType: { def: { shape: Record<string, unknown> } } } }).def.innerType.def.shape["modules"];
    const shape = (modules as { def: { innerType: { def: { shape: Record<string, import("zod").ZodType> } } } }).def.innerType.def.shape;
    expect(Object.keys(shape).sort()).toEqual([...MODULE_IDS].sort());
    for (const id of MODULE_IDS) {
      const description = describeOf(shape[id]!)!;
      expect(description).toBeDefined();
      for (const field of MODULES[id].fields) expect(description).toContain(`{${field}}`);
      expect(description).toContain(JSON.stringify(MODULES[id].defaults.format));
    }
  });
});

describe("Protected chrome in configured layouts (task 6.3)", () => {
  test("Margin removed: a problem says the top margin takes 1 to 3 rows, and the layout in use is unchanged", () => {
    const { store, set } = memoryStore(`{ "layout": { "margins": { "top": 2 } } }`);
    expect(layoutFromConfig(store.config().layout).margins).toEqual({ top: 2, bottom: 1 });
    set(`{ "layout": { "margins": { "top": 0, "bottom": 1 } } }`);
    const { problems } = store.reload();
    expect(problems).toEqual([expect.objectContaining({ path: "layout.margins.top", severity: "error", message: "takes a whole number from 1 to 3, not 0" })]);
    expect(layoutFromConfig(store.config().layout).margins).toEqual({ top: 2, bottom: 1 });
  });

  test("Card left out: a problem names the missing card region, and the layout in use is unchanged", () => {
    const { store, set } = memoryStore(null);
    const before = layoutFromConfig(store.config().layout);
    set(JSON.stringify({ layout: { screen: ["conversation", "activity", "prompt", "find", { left: ["turn-state", "connection"] }] } }));
    const { problems } = store.reload();
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ path: "layout.screen", severity: "error" });
    expect(problems[0]!.message).toContain('missing the "card" region');
    const after = layoutFromConfig(store.config().layout);
    expect(after.regions).toEqual(before.regions);
    expect(after.regions.some((r) => r.kind === "block" && r.name === "card")).toBe(true);
  });

  test("every failure is named: no card, no connection and a turn-state that hides its state", () => {
    const parsed = parseConfigText(
      JSON.stringify({ layout: { screen: ["conversation", "prompt", "find", { left: ["turn-state"] }], modules: { "turn-state": { format: "{elapsed}" } } } }),
      FILE,
    );
    const messages = parsed.problems.map((p) => p.message).join("\n");
    expect(messages).toContain('missing the "card" region');
    expect(messages).toContain('missing the "connection" module');
    expect(messages).toContain('"turn-state" module\'s format must include "{state}"');
  });

  test("no styling options: a bar, a margin or a module entry takes nothing beyond its listed settings", () => {
    for (const layout of [{ margins: { top: 1, colour: "red" } }, { screen: ["conversation", { left: ["cwd"], fill: "red" }] }, { modules: { cwd: { token: "danger" } } }]) {
      expect(parseConfigText(JSON.stringify({ layout }), FILE).rejected).toEqual(["layout"]);
    }
  });
});

describe("Conversation row floor setting (task 6.4)", () => {
  test("Larger floor: at 13, the default layout at 63x23 rests the prompt box at one text row and the conversation has 13 rows", async () => {
    const rows = await screenRows(layoutOf(`{ "layout": { "conversation_min_rows": 13 } }`), FULL_VIEW, 63, 23);
    expect(rows.filter((r) => r === "C")).toHaveLength(13);
    expect(rows.filter((r) => r === "P")).toHaveLength(4);
  });

  test("the row budget table at the default floor: 63x23, 63x22, 63x21, 61x20, 63x19 and 63x16 (the activity line and its blank row count since day-two-feedback task 13.2)", async () => {
    const layout = layoutFromConfig(defaultConfig().layout);
    for (const [cols, height, prompt, conversation] of [
      [63, 23, 2, 12],
      [63, 22, 1, 12],
      // Below the floor the prompt box rests at one text row, the activity bar's blank row gives
      // way and the conversation takes what is left.
      [63, 21, 1, 12],
      [61, 20, 1, 11],
      [63, 19, 1, 10],
      [63, 16, 1, 7],
    ] as const) {
      const rows = await screenRows(layout, FULL_VIEW, cols, height);
      expect([rows.filter((r) => r === "P").length - 3, rows.filter((r) => r === "C").length]).toEqual([prompt, conversation]);
      expect([rows[0], rows[height - 1]]).toEqual(["", ""]);
    }
  });

  test("outside 4 to 30 is an error", () => {
    expect(parseConfigText(`{ "layout": { "conversation_min_rows": 3 } }`, FILE).problems[0]).toMatchObject({ path: "layout.conversation_min_rows", message: "takes a whole number from 4 to 30, not 3" });
  });
});

describe("the config module (task 3.4)", () => {
  test("Configuration mark in the default layout: one problem shows the config mark on the right of the status row, gone once fixed", async () => {
    const layout = layoutFromConfig(defaultConfig().layout);
    const one = await screenRows(layout, view({ configProblems: 1 }), 63, 21);
    expect(one[19]).toMatch(/config 1 .*connected/);
    const none = await screenRows(layout, view({ configProblems: 0 }), 63, 21);
    expect(none[19]).not.toContain("config");
  });

  test("priority: above every module but turn-state and connection", () => {
    const priority = MODULES.config.defaults.priority;
    for (const id of MODULE_IDS) {
      if (id === "config") continue;
      if (id === "turn-state" || id === "connection") expect(MODULES[id].defaults.priority).toBeGreaterThan(priority);
      else expect(MODULES[id].defaults.priority).toBeLessThan(priority);
    }
  });

  test("Configuration problems at IDE-pane width: config 2 and the cost stay at 63 columns with a long cwd; cwd or the hints give way first", () => {
    const status = statusBar(layoutFromConfig(defaultConfig().layout));
    const v = view({ cwd: "/tmp/acp-tui-test-8f3a2c/workspace/projects/repository", home: null, cost: { amount: 1.23, currency: "USD" }, configProblems: 2 });
    const row = layoutBar(status, v, 63);
    expect(barText(row)).toContain("config 2");
    expect(barText(row)).toContain("$1.23");
    expect(row.dropped.length).toBeGreaterThan(0);
    for (const id of row.dropped) expect(["usage", "hints", "cwd"]).toContain(id);
  });
});

