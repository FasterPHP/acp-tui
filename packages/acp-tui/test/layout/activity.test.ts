// Task 6.4: the activity bar's content and width policy (spec tui-layout
// "Activity bar"), without a renderer. The PTY tests in screen.pty.test.ts
// cover the bar on screen with fake-agent's basic, five-tools and plan-running
// scenarios (the last is "Running turn with a plan" end to end); the width
// policy is checked here.
import { describe, expect, test } from "bun:test";
import { activityBar, lingerLine, type ActivityInput } from "../../src/layout/activity.ts";
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

describe("activity bar", () => {
  test("running turn with a plan: the running count with the latest title, and plan 2/5 ▸ the third entry", () => {
    expect(text({ running: RUNNING, plan: PLAN, permissionOpen: false })).toBe(
      "  2 running: Search for Route::get · plan 2/5 ▸ Write the controller test",
    );
  });

  test("tokens: the count in tool.running, titles in text, the plan in muted", () => {
    const row = activityBar({ running: RUNNING, plan: PLAN, permissionOpen: true }, 120)!;
    expect(row.find((s) => s.text === "2 running")?.token).toBe("tool.running");
    expect(row.find((s) => s.text === "Search for Route::get")?.token).toBe("text");
    expect(row.find((s) => s.text === "plan 2/5")?.token).toBe("muted");
    expect(row.find((s) => s.text === "awaiting permission")?.token).toBe("permission");
  });

  test("awaiting permission while a request is open", () => {
    expect(text({ running: [{ title: "Edit src/index.ts" }], plan: [], permissionOpen: true })).toBe(
      "  1 running: Edit src/index.ts · awaiting permission",
    );
    expect(text({ running: [], plan: [], permissionOpen: true })).toBe("  awaiting permission");
  });

  test("a plan with every entry done shows its progress without an entry", () => {
    expect(text({ running: [], plan: PLAN.map((e) => ({ ...e, status: "completed" as const })), permissionOpen: false })).toBe("  plan 5/5");
  });

  test("idle, nothing running, no plan, no request: no row at all", () => {
    expect(activityBar({ running: [], plan: [], permissionOpen: false }, 80)).toBeNull();
  });

  test("width policy: titles are truncated first, then dropped, then the plan; awaiting permission stays", () => {
    const input: ActivityInput = { running: RUNNING, plan: PLAN, permissionOpen: true };
    const at = (width: number) => {
      const row = text(input, width)!;
      expect(displayWidth(row)).toBeLessThanOrEqual(width);
      return row;
    };
    expect(at(120)).toBe("  2 running: Search for Route::get · plan 2/5 ▸ Write the controller test · awaiting permission");
    expect(at(80)).toBe("  2 running: Search for Rou… · plan 2/5 ▸ Write the contr… · awaiting permission");
    // 63 columns: no room for two titles of 12 columns, so the plan entry goes first.
    expect(at(63)).toBe("  2 running: Search for Route… · plan 2/5 · awaiting permission");
    expect(at(50)).toBe("  2 running · plan 2/5 · awaiting permission");
    expect(at(40)).toBe("  2 running · awaiting permission");
    expect(at(22)).toBe("  awaiting permission");
    expect(at(10)).toBe("  awaitin…");
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
