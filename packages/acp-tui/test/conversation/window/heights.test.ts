// Spike S3 (task 12.2). The per-item, per-width height cache
// of the windowed list: estimated until measured, measurements per width and
// per version of the item, invalidated by a width change.
import { describe, expect, test } from "bun:test";
import type { AgentMessageItem, ThoughtItem, ToolCallItem, UserMessageItem } from "acp-model";
import { estimateHeight, HeightCache, markdownRows, wrappedRows } from "../../../src/conversation/window/heights.ts";

const tool = (over: Partial<ToolCallItem> = {}): ToolCallItem => ({
  id: "tool:t1",
  kind: "tool_call",
  status: "final",
  origin: "self",
  toolCallId: "t1",
  index: 1,
  title: "Run tests",
  toolName: null,
  toolKind: "execute",
  toolStatus: "completed",
  content: [{ type: "text", text: ["```", ...Array.from({ length: 12 }, (_, i) => `line ${i + 1}`), "```"].join("\n") }],
  locations: [],
  rawOutputText: null,
  startedAt: 0,
  endedAt: 500,
  ...over,
});

describe("estimate", () => {
  test("a collapsed tool call, thought or plan is one row; expanded adds the card's rows", () => {
    expect(estimateHeight(tool(), 100, false)).toBe(1);
    // mvp-rendering (tasks 9.1 to 9.3): the title, a blank row, then the fenced output's 12 rows
    // cut to a snippet of 10 behind a marker row; shown in full, all 12.
    expect(estimateHeight(tool(), 100, true)).toBe(1 + 1 + 1 + 1 + 10);
    expect(estimateHeight(tool(), 100, true, { fullOutput: true })).toBe(1 + 1 + 1 + 12);
    const thought: ThoughtItem = { id: "t", kind: "thought", status: "final", origin: "self", text: "**Title**\n\nbody" };
    expect(estimateHeight(thought, 100, false)).toBe(1);
    // The header, the padding row, the title, a blank row, the body and the padding row.
    expect(estimateHeight(thought, 100, true)).toBe(6);
  });

  test("card lines wrap at the card's inner width (gutter, padding, right column; the flat rule)", () => {
    const long = tool({ content: [{ type: "text", text: "x".repeat(200) }] });
    // 100 columns: 100 - 2 gutter - 2 padding - 2 right = 94 inside; flat: 93. The header, the
    // title row and the blank row, then the word broken at the width.
    expect(estimateHeight(long, 100, true)).toBe(1 + 2 + Math.ceil(200 / 94));
    expect(estimateHeight(long, 100, true, { flat: true })).toBe(1 + 2 + Math.ceil(200 / 93));
    const wide = tool({ content: [{ type: "text", text: "x".repeat(188) }] });
    expect(estimateHeight(wide, 100, true)).toBe(1 + 2 + 2);
    expect(estimateHeight(wide, 100, true, { flat: true })).toBe(1 + 2 + 3);
  });

  test("user messages wrap beside the accent; agent Markdown by blocks", () => {
    const user: UserMessageItem = { id: "u", kind: "user_message", status: "final", origin: "self", text: "y".repeat(150) };
    // Wrapped at the width less the bar and two columns on each side (95 and 55), between a padding
    // row above and below (day-one-feedback, "Card padding").
    expect(estimateHeight(user, 100, false)).toBe(2 + 2);
    expect(estimateHeight(user, 60, false)).toBe(3 + 2);
    const agent: AgentMessageItem = { id: "a", kind: "agent_message", status: "final", origin: "self", text: "One.\n\nTwo.\n\n```php\n$a = 1;\n$b = 2;\n```\n" };
    expect(estimateHeight(agent, 100, false)).toBe(markdownRows(agent.text, 98));
    // Two paragraphs, two blank rows, and the code block's two lines between its padding rows.
    expect(markdownRows("One.\n\nTwo.\n\n```php\n$a = 1;\n$b = 2;\n```\n", 98)).toBe(8);
    // mvp-rendering: a bordered table: its top border, header, header rule, rows and bottom border.
    expect(markdownRows("| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n", 98)).toBe(6);
  });

  test("wrappedRows counts blank lines and wraps long ones", () => {
    expect(wrappedRows("a\n\nb", 10)).toBe(3);
    expect(wrappedRows("x".repeat(25), 10)).toBe(3);
  });
});

describe("HeightCache", () => {
  const item = { name: "v1" };
  const v1 = { ref: item, variant: "c" };

  test("estimated until measured, then the measurement", () => {
    const cache = new HeightCache();
    let estimates = 0;
    const estimate = () => (estimates++, 3);
    expect(cache.get("a", 100, v1, estimate)).toBe(3);
    expect(cache.measured("a", 100, v1)).toBeNull();
    expect(cache.measure("a", 100, v1, 5)).toBe(true);
    expect(cache.get("a", 100, v1, estimate)).toBe(5);
    expect(estimates).toBe(1);
    // The same measurement again is no change.
    expect(cache.measure("a", 100, v1, 5)).toBe(false);
    expect(cache.measure("a", 100, v1, 6)).toBe(true);
    expect(cache.get("a", 100, v1, estimate)).toBe(6);
  });

  test("another version of the item (a new object, or expanded) misses", () => {
    const cache = new HeightCache();
    cache.measure("a", 100, v1, 5);
    expect(cache.get("a", 100, { ref: { name: "v2" }, variant: "c" }, () => 1)).toBe(1);
    expect(cache.get("a", 100, { ref: item, variant: "e" }, () => 9)).toBe(9);
    expect(cache.get("a", 100, v1, () => 1)).toBe(5);
  });

  test("a width change invalidates: other widths miss, and the oldest width is dropped", () => {
    const cache = new HeightCache(2);
    cache.measure("a", 100, v1, 5);
    // Resized to 63 columns: the measurement at 100 does not apply.
    expect(cache.get("a", 63, v1, () => 8)).toBe(8);
    cache.measure("a", 63, v1, 7);
    expect(cache.get("a", 63, v1, () => 8)).toBe(7);
    // Back to 100: still held (two widths are kept).
    expect(cache.get("a", 100, v1, () => 8)).toBe(5);
    expect(cache.heldWidths()).toEqual([63, 100]);
    // A third width drops the least recently used one (63).
    cache.measure("a", 80, v1, 6);
    expect(cache.heldWidths()).toEqual([100, 80]);
    expect(cache.get("a", 63, v1, () => 8)).toBe(8);
    expect(cache.size(63)).toBe(0);
  });
});
