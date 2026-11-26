// The totals of a turn's end line (focus-groups tasks 3.1 and 3.2; spec tui-conversation "Turn
// totals in the turn-end line"): which items make a turn, how many gaps they form, and that the
// line still copies and exports as nothing.
import { describe, expect, test } from "bun:test";
import { turnEndLine } from "../../src/conversation/format.ts";
import { totalsOf, turnTotals } from "../../src/conversation/turn-totals.ts";
import { conversationMarkdown } from "../../src/selection/export.ts";
import { itemText } from "../../src/selection/projection.ts";
import { agent, conversation, thought, tool, turnEnd, user } from "../selection/items.ts";

const text = (segments: { text: string }[]) => segments.map((s) => s.text).join("");

describe("turnTotals", () => {
  test("a turn with nothing hidden has no gap and no totals", () => {
    const { order, lookup } = conversation(user("u", "hi"), agent("a", "hello"), turnEnd("m"));
    expect(turnTotals(order, lookup).size).toBe(0);
    expect(totalsOf(["a"], lookup).gaps).toBe(0);
  });

  test("one run: three tool calls, a thought and one answer give one gap, so no totals", () => {
    const { order, lookup } = conversation(user("u", "hi"), tool("tool:1"), tool("tool:2"), tool("tool:3"), thought("th", "hmm"), agent("a", "done"), turnEnd("m"));
    expect(totalsOf(order.slice(1, 6), lookup).gaps).toBe(1);
    expect(turnTotals(order, lookup).size).toBe(0);
  });

  test("two runs around one message: 2 tool calls", () => {
    const items = [user("u", "hi"), tool("tool:1"), agent("a", "middle"), tool("tool:2"), turnEnd("m")];
    const { order, lookup } = conversation(...items);
    const totals = turnTotals(order, lookup).get("m");
    expect(totals?.gaps).toBe(2);
    expect(totals?.counts.tools).toBe(2);
    expect(text(turnEndLine(items[4] as never, undefined, totals ?? null))).toBe("end turn · 2 tool calls · 1.2s");
  });

  test("each turn counts only its own items, from its user message to its marker", () => {
    const { order, lookup } = conversation(
      user("u1", "one"), tool("tool:1"), agent("a1", "x"), thought("t1", "hmm"), turnEnd("m1"),
      user("u2", "two"), tool("tool:2", { toolStatus: "failed" }), agent("a2", "y"), tool("tool:3"), tool("tool:4"), turnEnd("m2"),
    );
    const totals = turnTotals(order, lookup);
    expect(totals.get("m1")?.counts).toMatchObject({ tools: 1, thoughts: 1 });
    expect(totals.get("m2")?.counts).toMatchObject({ tools: 3, failed: 1, thoughts: 0 });
    expect(totals.get("m2")?.gaps).toBe(2);
  });

  test("a call the turn ended on counts as stopped; a wordless thought is not shown, so not counted", () => {
    const { order, lookup } = conversation(user("u", "hi"), tool("tool:1", { toolStatus: "in_progress" }), agent("a", "m"), thought("t", "  "), tool("tool:2"), turnEnd("m"));
    const totals = turnTotals(order, lookup).get("m");
    expect(totals?.counts).toMatchObject({ tools: 2, stopped: 1, thoughts: 0 });
  });

  test("items before the first user message belong to the first turn", () => {
    const { order, lookup } = conversation(tool("tool:1"), agent("a", "m"), tool("tool:2"), turnEnd("m"));
    expect(turnTotals(order, lookup).get("m")?.gaps).toBe(2);
  });

  test("the line is chrome: it copies and exports as nothing", () => {
    const items = [user("u", "hi"), tool("tool:1"), agent("a", "middle"), tool("tool:2"), turnEnd("m")];
    const { order, lookup } = conversation(...items);
    expect(turnTotals(order, lookup).get("m")?.gaps).toBe(2);
    expect(itemText(items[4]!)).toBe("");
    expect(conversationMarkdown(order, lookup)).not.toContain("tool calls");
  });
});
