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

/** `left`, spaces, `right` ending at `width`. */
const aligned = (left: string, right: string, width: number) => left + " ".repeat(width - displayWidth(left) - displayWidth(right)) + right;
const RUN_TIME = "4m 35s";
const RIGHT = `running ${RUN_TIME}`;

describe("activity bar", () => {
  test("running turn with a plan: the latest title alone, and plan 2/5 ▸ the third entry", () => {
    expect(text({ running: RUNNING, plan: PLAN, permissionOpen: false })).toBe("  Search for Route::get · plan 2/5 ▸ Write the controller test");
  });

  test("tokens: titles in text, the plan in muted, awaiting in permission, the run time in muted", () => {
    const row = activityBar({ running: RUNNING, plan: PLAN, permissionOpen: true, runTime: RUN_TIME }, 140)!;
    expect(row.find((s) => s.text === "Search for Route::get")?.token).toBe("text");
    expect(row.find((s) => s.text === "plan 2/5")?.token).toBe("muted");
    expect(row.find((s) => s.text === "awaiting permission")?.token).toBe("permission");
    expect(row.find((s) => s.text === RUN_TIME)?.token).toBe("muted");
    expect(row.find((s) => s.text === "running ")?.token).toBe("tool.running");
  });

  test("the tool call's kind precedes its title, in its kind token", () => {
    const row = activityBar({ running: [{ title: "src/foo.ts", toolKind: "read" }], plan: [], permissionOpen: false }, 80)!;
    expect(row.map((s) => s.text).join("")).toBe("  read src/foo.ts");
    expect(row.find((s) => s.text === "read")?.token).toBe("tool.kind.read");
    expect(row.find((s) => s.text === "src/foo.ts")?.token).toBe("text");
  });

  test("a title that is only the kind shows it once; `other` and no kind show the title alone; a tool name stands in for a missing kind", () => {
    const t = (call: ActivityInput["running"][number]) => text({ running: [call], plan: [], permissionOpen: false }, 80);
    expect(t({ title: "execute", toolKind: "execute" })).toBe("  execute");
    expect(t({ title: "bun test", toolKind: "other" })).toBe("  bun test");
    expect(t({ title: "bun test" })).toBe("  bun test");
    expect(t({ title: "bun test", toolName: "Bash" })).toBe("  Bash bun test");
  });

  test("awaiting permission while a request is open", () => {
    expect(text({ running: [{ title: "Edit src/index.ts" }], plan: [], permissionOpen: true })).toBe("  Edit src/index.ts · awaiting permission");
    expect(text({ running: [], plan: [], permissionOpen: true })).toBe("  awaiting permission");
  });

  test("a plan with every entry done shows its progress without an entry", () => {
    expect(text({ running: [], plan: PLAN.map((e) => ({ ...e, status: "completed" as const })), permissionOpen: false })).toBe("  plan 5/5");
  });

  test("idle, nothing running, no plan, no request, no run time: no row at all", () => {
    expect(activityBar({ running: [], plan: [], permissionOpen: false }, 80)).toBeNull();
    expect(activityBar({ running: [], plan: [], permissionOpen: false, runTime: null }, 80)).toBeNull();
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

// run-time-and-cmd-keys: the turn's run time, right-aligned, in place of focus-groups' count.
describe("activity bar with the run time", () => {
  const input = (over: Partial<ActivityInput> = {}): ActivityInput => ({ running: RUNNING, plan: [], permissionOpen: false, runTime: RUN_TIME, ...over });
  const row = (i: ActivityInput, width: number) => {
    const out = text(i, width)!;
    expect(displayWidth(out)).toBeLessThanOrEqual(width);
    return out;
  };

  test("the run time ends at the last column, whatever the width, with the title at the left", () => {
    for (const width of [40, 63, 90, 120]) {
      const out = row(input(), width);
      expect(displayWidth(out)).toBe(width);
      expect(out.startsWith("  Search for Route::get")).toBe(true);
      expect(out.endsWith(` ${RIGHT}`)).toBe(true);
    }
  });

  test("no count and no running number: the title alone at the left, `running <time>` at the right", () => {
    expect(row(input(), 100)).not.toMatch(/tool call|thought/);
    expect(text(input(), 50)).toBe(aligned("  Search for Route::get", RIGHT, 50));
  });

  test("the drop order: titles truncated, then dropped, then the plan, then the word `running`; the time and awaiting permission stay", () => {
    const i = input({ plan: PLAN, permissionOpen: true });
    expect(row(i, 100)).toBe(aligned("  Search for Route::get · plan 2/5 ▸ Write the controller test · awaiting permission", RIGHT, 100));
    expect(row(i, 80)).toContain("▸ Write the con… · awaiting");
    expect(row(i, 70)).toBe("  Search for Route::g… · plan 2/5 · awaiting permission running 4m 35s");
    expect(row(i, 60)).toBe(aligned("  plan 2/5 · awaiting permission", RIGHT, 60));
    expect(row(i, 40)).toBe(aligned("  awaiting permission", RIGHT, 40));
    // Awaiting permission is kept whole before the word `running` goes, and cut before the time is.
    expect(row(i, 30)).toBe(aligned("  awaiting permission", RUN_TIME, 30));
    expect(row(i, 20)).toBe("  awaiting p… 4m 35s");
    for (const width of [9, 10, 14, 16, 20]) expect(row(i, width).endsWith(` ${RUN_TIME}`)).toBe(true);
  });

  test("the title is dropped, then the word `running`, before the time", () => {
    expect(row(input(), 40)).toBe(aligned("  Search for Route::get", RIGHT, 40));
    expect(row(input(), 34)).toBe("  Search for Route… running 4m 35s");
    expect(row(input(), 26)).toBe("  Search for Route… 4m 35s");
    expect(row(input(), 20)).toBe(aligned("", RIGHT, 20));
    expect(row(input(), 12)).toBe(aligned("", RUN_TIME, 12));
  });

  test("a kind stays when its title is dropped", () => {
    const i = input({ running: [{ title: "Search for Route::get", toolKind: "search" }] });
    expect(row(i, 50)).toBe(aligned("  search Search for Route::get", RIGHT, 50));
    expect(row(i, 30)).toBe(aligned("  search", RIGHT, 30));
    expect(row(i, 20)).toBe(aligned("  search", RUN_TIME, 20));
  });

  test("`running <time>` alone is a valid row, right-aligned; too narrow, the time alone", () => {
    expect(text({ running: [], plan: [], permissionOpen: false, runTime: "7s" }, 40)).toBe(aligned("", "running 7s", 40));
    expect(text({ running: [], plan: [], permissionOpen: false, runTime: "2h 03m" }, 63)).toBe(aligned("", "running 2h 03m", 63));
    expect(text({ running: [], plan: [], permissionOpen: false, runTime: "7s" }, 10)).toBe(aligned("", "7s", 10));
  });

  test("a plan alone keeps a space before the run time", () => {
    const out = text({ running: [], plan: PLAN, permissionOpen: false, runTime: "12s" }, 80)!;
    expect(out.startsWith("  plan 2/5 ▸ Write the controller test")).toBe(true);
    expect(out.endsWith(" running 12s")).toBe(true);
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

describe("lingerLine with the run time", () => {
  const lingered = (width: number, runTime: string | null) => lingerLine({ title: "Read src/Pool.php", failed: false }, width, 2, undefined, runTime).map((s) => s.text).join("");

  test("the call at the left and the run time at the right", () => {
    expect(lingered(60, "1m 05s")).toBe(aligned("  ✓ Read src/Pool.php", "running 1m 05s", 60));
    expect(lingered(60, null)).toBe("  ✓ Read src/Pool.php");
  });

  test("a narrow row truncates the title, keeps the run time, and never overflows", () => {
    expect(lingered(20, "1m 05s")).toBe("  ✓ Read src… 1m 05s");
    for (const width of [10, 14, 20, 30, 52]) expect(displayWidth(lingered(width, "1m 05s"))).toBeLessThanOrEqual(width);
  });
});
