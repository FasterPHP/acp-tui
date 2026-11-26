// Task 6.4: the activity bar's content and width policy (spec tui-layout
// "Activity bar"), without a renderer. The PTY tests in screen.pty.test.ts
// cover the bar on screen with fake-agent's basic, five-tools and plan-running
// scenarios (the last is "Running turn with a plan" end to end); the width
// policy is checked here.
import { describe, expect, test } from "bun:test";
import { activityBar, lingerLine, type ActivityInput } from "../../src/layout/activity.ts";
import { EMPTY_COUNTS, type ItemCounts } from "../../src/conversation/counts.ts";
import { displayWidth } from "../../src/layout/segments.ts";

const text = (input: ActivityInput, width = 100) => activityBar(input, width)?.map((s) => s.text).join("") ?? null;

const PLAN: ActivityInput["plan"] = [
  { content: "Read the router", status: "completed" },
  { content: "Add the route", status: "completed" },
  { content: "Write the controller test", status: "in_progress" },
  { content: "Run the suite", status: "pending" },
  { content: "Report", status: "pending" },
];
const RUNNING: ActivityInput["running"] = [{ title: "Read src/Http/Router.php" }, { title: "Search for Route::get" }];

const COUNT: ItemCounts = { ...EMPTY_COUNTS, tools: 12, failed: 1, running: 2, thoughts: 3 };
/** `left`, spaces, `right` ending at `width`. */
const aligned = (left: string, right: string, width: number) => left + " ".repeat(width - displayWidth(left) - displayWidth(right)) + right;
const COUNT_TEXT = "12 tool calls (1 failed, 2 running) · 3 thoughts";

describe("activity bar", () => {
  test("running turn with a plan: the latest title alone (the number is in the count), and plan 2/5 ▸ the third entry", () => {
    expect(text({ running: RUNNING, plan: PLAN, permissionOpen: false })).toBe("  Search for Route::get · plan 2/5 ▸ Write the controller test");
  });

  test("tokens: titles in text, the plan in muted, awaiting in permission, the count's states in tool.fail and tool.running", () => {
    const row = activityBar({ running: RUNNING, plan: PLAN, permissionOpen: true, count: COUNT }, 140)!;
    expect(row.find((s) => s.text === "Search for Route::get")?.token).toBe("text");
    expect(row.find((s) => s.text === "plan 2/5")?.token).toBe("muted");
    expect(row.find((s) => s.text === "awaiting permission")?.token).toBe("permission");
    expect(row.find((s) => s.text === "2 running")?.token).toBe("tool.running");
    expect(row.find((s) => s.text === "1 failed")?.token).toBe("tool.fail");
  });

  test("awaiting permission while a request is open", () => {
    expect(text({ running: [{ title: "Edit src/index.ts" }], plan: [], permissionOpen: true })).toBe("  Edit src/index.ts · awaiting permission");
    expect(text({ running: [], plan: [], permissionOpen: true })).toBe("  awaiting permission");
  });

  test("a plan with every entry done shows its progress without an entry", () => {
    expect(text({ running: [], plan: PLAN.map((e) => ({ ...e, status: "completed" as const })), permissionOpen: false })).toBe("  plan 5/5");
  });

  test("idle, nothing running, no plan, no request, no count: no row at all", () => {
    expect(activityBar({ running: [], plan: [], permissionOpen: false }, 80)).toBeNull();
    expect(activityBar({ running: [], plan: [], permissionOpen: false, count: EMPTY_COUNTS }, 80)).toBeNull();
  });

  test("width policy: titles are truncated first, then dropped, then the plan; awaiting permission stays", () => {
    const input: ActivityInput = { running: RUNNING, plan: PLAN, permissionOpen: true };
    const at = (width: number) => {
      const row = text(input, width)!;
      expect(displayWidth(row)).toBeLessThanOrEqual(width);
      return row;
    };
    expect(at(120)).toBe("  Search for Route::get · plan 2/5 ▸ Write the controller test · awaiting permission");
    expect(at(80)).toBe("  Search for Route::get · plan 2/5 ▸ Write the controller… · awaiting permission");
    // 63 columns: the two titles share what is left.
    expect(at(63)).toBe("  Search for … · plan 2/5 ▸ Write the co… · awaiting permission");
    // 50 columns: no room for two titles of 12 columns, so the plan entry goes first.
    expect(at(50)).toBe("  Search for Rou… · plan 2/5 · awaiting permission");
    expect(at(40)).toBe("  plan 2/5 · awaiting permission");
    expect(at(30)).toBe("  awaiting permission");
    expect(at(22)).toBe("  awaiting permission");
    expect(at(10)).toBe("  awaitin…");
  });
});

// focus-groups task 4.1 (design D6): the turn's count, right-aligned.
describe("activity bar with the count", () => {
  const input = (over: Partial<ActivityInput> = {}): ActivityInput => ({ running: RUNNING, plan: [], permissionOpen: false, count: COUNT, ...over });
  const row = (i: ActivityInput, width: number) => {
    const out = text(i, width)!;
    expect(displayWidth(out)).toBeLessThanOrEqual(width);
    return out;
  };

  test("the count ends at the last column, whatever the width, with the title at the left", () => {
    for (const width of [90, 100, 120]) {
      const out = row(input(), width);
      expect(displayWidth(out)).toBe(width);
      expect(out.startsWith("  Search for Route::get")).toBe(true);
      expect(out.endsWith(COUNT_TEXT)).toBe(true);
    }
  });

  test("the running number is in the brackets only, never at the left", () => {
    expect(row(input(), 100)).not.toContain("running:");
    expect(text(input({ count: { ...EMPTY_COUNTS, tools: 2, running: 2, thoughts: 1 } }), 60)).toBe("  Search for Route::get 2 tool calls (2 running) · 1 thought");
  });

  test("the drop order: titles truncated, then dropped, then the plan, then the thoughts; the call count and awaiting permission stay", () => {
    const i = input({ plan: PLAN, permissionOpen: true });
    const whole = COUNT_TEXT;
    const tools = "12 tool calls (1 failed, 2 running)";
    expect(row(i, 160)).toBe(aligned("  Search for Route::get · plan 2/5 ▸ Write the controller test · awaiting permission", whole, 160));
    expect(row(i, 130)).toContain("▸ Write the controller … · awaiting");
    // The plan entry goes first, then the titles.
    expect(row(i, 110)).toBe(aligned("  Search for Route::get · plan 2/5 · awaiting permission", whole, 110));
    expect(row(i, 100)).toContain("Search for Rout… · plan 2/5 · awaiting permission");
    expect(row(i, 90)).toBe(aligned("  plan 2/5 · awaiting permission", whole, 90));
    // The plan next, with the whole count.
    expect(row(i, 70)).toBe(aligned("  awaiting permission", whole, 70));
    // Then the thoughts.
    expect(row(i, 60)).toBe(aligned("  awaiting permission", tools, 60));
    expect(row(i, 57)).toBe(aligned("  awaiting permission", tools, 57));
  });

  test("the title is dropped before the thoughts, as the policy orders them", () => {
    const i = input({ count: { ...EMPTY_COUNTS, tools: 2, running: 1, thoughts: 1 } });
    expect(row(i, 90)).toBe(aligned("  Search for Route::get", "2 tool calls (1 running) · 1 thought", 90));
    // The title gone, the whole count stands alone while it fits; the thoughts go last.
    expect(row(i, 50)).toBe(aligned("", "2 tool calls (1 running) · 1 thought", 50));
    expect(row(i, 30)).toBe(aligned("", "2 tool calls (1 running)", 30));
  });

  test("the count alone is a valid row, right-aligned", () => {
    const out = text({ running: [], plan: [], permissionOpen: false, count: { ...EMPTY_COUNTS, tools: 6 } }, 40)!;
    expect(out).toBe(aligned("", "6 tool calls", 40));
    expect(text({ running: [], plan: [], permissionOpen: false, count: { ...EMPTY_COUNTS, thoughts: 1 } }, 30)).toBe(aligned("", "1 thought", 30));
  });

  test("a plan alone keeps a space before the count", () => {
    const out = text({ running: [], plan: PLAN, permissionOpen: false, count: { ...EMPTY_COUNTS, tools: 1 } }, 80)!;
    expect(out.startsWith("  plan 2/5 ▸ Write the controller test")).toBe(true);
    expect(out.endsWith("1 tool call")).toBe(true);
  });
});

// day-two-feedback task 6.2 (design D6): the line that lingers after the last running call ends.
describe("lingerLine", () => {
  const lingered = (title: string, failed: boolean, width = 100) => {
    const row = lingerLine({ title, failed }, width);
    return { text: row.map((s) => s.text).join(""), tokens: new Set(row.map((s) => s.token)) };
  };

  test("a finished call: its ✓ and title in muted, two columns in like the running line", () => {
    const { text, tokens } = lingered("Read src/Pool.php", false);
    expect(text).toBe("  ✓ Read src/Pool.php");
    expect([...tokens]).toEqual(["muted"]);
  });

  test("a failed call: ✗ and its title, still muted", () => {
    const { text, tokens } = lingered("Run vendor/bin/phpunit", true);
    expect(text).toBe("  ✗ Run vendor/bin/phpunit");
    expect([...tokens]).toEqual(["muted"]);
  });

  test("width policy: the title is truncated to the room beside the glyph, and never wider than the row", () => {
    expect(lingered("Read src/Http/Router.php", false, 18).text).toBe("  ✓ Read src/Http…");
    for (const width of [1, 2, 3, 4, 5, 8, 12, 30]) expect(displayWidth(lingered("Read src/Http/Router.php", false, width).text)).toBeLessThanOrEqual(width);
  });

  test("a multi-line title is one line, an empty one shows the glyph alone", () => {
    expect(lingered("Run\nthe  suite\t", false).text).toBe("  ✓ Run the  suite");
    expect(lingered("", true).text).toBe("  ✗");
  });

  test("the glyph set's status glyphs: the ascii set's v and x", () => {
    expect(lingerLine({ title: "Read a", failed: false }, 40, 2, { ok: "v", fail: "x" }).map((s) => s.text).join("")).toBe("  v Read a");
    expect(lingerLine({ title: "Read a", failed: true }, 40, 2, { ok: "v", fail: "x" }).map((s) => s.text).join("")).toBe("  x Read a");
  });
});

describe("lingerLine with the count", () => {
  const lingered = (width: number, count: ItemCounts) => lingerLine({ title: "Read src/Pool.php", failed: false }, width, 2, undefined, count).map((s) => s.text).join("");

  test("the call at the left and the count at the right", () => {
    const out = lingered(60, { ...EMPTY_COUNTS, tools: 2 });
    expect(out).toBe(aligned("  ✓ Read src/Pool.php", "2 tool calls", 60));
  });

  test("a narrow row drops the thoughts before the title is cut below 12 columns, and never overflows", () => {
    const count = { ...EMPTY_COUNTS, tools: 4, thoughts: 2, failed: 1 };
    expect(lingered(80, count)).toBe(aligned("  ✓ Read src/Pool.php", "4 tool calls (1 failed) · 2 thoughts", 80));
    expect(lingered(52, count)).toBe(aligned("  ✓ Read src/Pool.php", "4 tool calls (1 failed)", 52));
    for (const width of [10, 20, 30, 40, 52]) expect(displayWidth(lingered(width, count))).toBeLessThanOrEqual(width);
  });
});

describe("activity bar, count alone after the title is dropped", () => {
  test("the thoughts stay while the whole count fits with nothing at the left", () => {
    const count = { ...EMPTY_COUNTS, tools: 2, running: 1, thoughts: 1 };
    expect(text({ running: [{ title: "Run tm-final" }], plan: [], permissionOpen: false, count }, 45)).toBe(aligned("", "2 tool calls (1 running) · 1 thought", 45));
    expect(text({ running: [{ title: "Run tm-final" }], plan: [], permissionOpen: false, count }, 30)).toBe(aligned("", "2 tool calls (1 running)", 30));
  });
});
