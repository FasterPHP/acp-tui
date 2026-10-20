// Unit tests for conversation formatting (phase-1a task 7.1, spec
// tui-conversation "Item presentation"): tool lines, summaries, the
// terminal-content notice, the activity region's `+N more`, thought, plan,
// permission and turn-end lines.
import { describe, expect, test } from "bun:test";
import type { PermissionRecordItem, ToolCallItem } from "acp-model";
import { displayWidth, type Segment } from "../../src/layout/segments.ts";
import {
  activityRows,
  diffCounts,
  formatDuration,
  kindGlyph,
  permissionLine,
  planLine,
  TERMINAL_UNAVAILABLE_SHORT,
  thoughtLine,
  thoughtTitle,
  toolLine,
  toolSummary,
  turnEndLine,
} from "../../src/conversation/format.ts";

const text = (segments: Segment[]) => segments.map((s) => s.text).join("");

function tool(overrides: Partial<ToolCallItem> = {}): ToolCallItem {
  return {
    id: "tool:t",
    status: "final",
    origin: "self",
    kind: "tool_call",
    toolCallId: "t",
    index: 15,
    title: "src/Db/Connection.php",
    toolName: null,
    toolKind: "edit",
    toolStatus: "completed",
    content: [],
    locations: [],
    rawOutputText: null,
    startedAt: 1000,
    endedAt: 1050,
    ...overrides,
  };
}

const lines = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix} ${i}`).join("\n") + "\n";

describe("tool lines", () => {
  test("completed edit: edit glyph, ✓, kind, path, then right-aligned `+12 -3`, duration and index (spec scenario)", () => {
    const oldText = lines(10, "keep") + lines(3, "old");
    const newText = lines(10, "keep") + lines(12, "new");
    const item = tool({ content: [{ type: "diff", path: "src/Db/Connection.php", oldText, newText }], endedAt: 2500 });
    const row = text(toolLine(item, 61));
    expect(row).toBe(`← ✓ edit     src/Db/Connection.php${" ".repeat(10)}+12 -3  1.5s  #15`);
    expect(displayWidth(row)).toBe(61);
    const summary = toolSummary(item);
    expect(summary.map((s) => s.token)).toEqual(["diff.add", "muted", "diff.remove"]);
    // The index is in its own token (dim by default), at the right edge.
    expect(toolLine(item, 61).at(-1)).toEqual({ text: "#15", token: "tool.index" });
  });

  test("status: ✓, ✗, a spinner frame while live, and `stop` for a tool the turn ended on", () => {
    const status = (item: ToolCallItem, frame = 0) => toolLine(item, 80, undefined, frame)[2];
    expect(status(tool())).toEqual({ text: "✓ ", token: "tool.ok" });
    expect(status(tool({ toolStatus: "failed" }))).toEqual({ text: "✗ ", token: "tool.fail" });
    expect(status(tool({ toolStatus: "in_progress" }))).toEqual({ text: "stop ", token: "muted" });
    const running = tool({ toolStatus: "in_progress", status: "live" });
    expect([0, 1, 2, 3, 4].map((f) => status(running, f)!.text)).toEqual(["▖ ", "▘ ", "▝ ", "▗ ", "▖ "]);
    expect(status(running)!.token).toBe("tool.running");
    expect(status(tool({ toolStatus: "pending", status: "live" }))!.token).toBe("tool.running");
    expect(status(tool({ toolStatus: "completed", status: "live" }))).toEqual({ text: "✓ ", token: "tool.ok" });
  });

  // mvp-rendering task 3.5, spec tui-theme "Tool-line segment tokens" and tui-conversation
  // "Segments in their own tokens": the visible segments (whitespace left out) and their tokens.
  const tokens = (segments: Segment[]) => segments.filter((s) => s.text.trim() !== "").map((s) => [s.text.trim(), s.token]);

  test("read line: kind glyph and kind in tool.kind.read, title, `52 lines`, `0.3s` and `#1` each in its token", () => {
    const item = tool({ toolKind: "read", index: 1, title: "src/index.ts", content: [{ type: "text", text: lines(52, "line") }], startedAt: 0, endedAt: 300 });
    expect(tokens(toolLine(item, 63))).toEqual([
      ["→", "tool.kind.read"],
      ["✓", "tool.ok"],
      ["read", "tool.kind.read"],
      ["src/index.ts", "tool.title"],
      ["52 lines", "tool.count"],
      ["0.3s", "tool.duration"],
      ["#1", "tool.index"],
    ]);
  });

  test("Segments in their own tokens: a completed execute call with 5 output lines and 0.9 s", () => {
    const item = tool({ toolKind: "execute", index: 4, title: "bun test", content: [{ type: "text", text: lines(5, "out") }], startedAt: 0, endedAt: 900 });
    expect(tokens(toolLine(item, 63))).toEqual([
      ["$", "tool.kind.execute"],
      ["✓", "tool.ok"],
      ["execute", "tool.kind.execute"],
      ["bun test", "tool.title"],
      ["5 lines", "tool.count"],
      ["0.9s", "tool.duration"],
      ["#4", "tool.index"],
    ]);
  });

  test("a text that is one fence counts the lines inside it, not its marker lines", () => {
    const count = (text: string) => toolSummary(tool({ toolKind: "execute", content: [{ type: "text", text }] })).map((s) => s.text).join("");
    // Five output lines in a `console` fence, as claude-agent-acp sends them: `5 lines`, not 7.
    const five = "```console\n" + lines(5, "out") + "```";
    expect(count(five)).toBe("5 lines");
    expect(count(five + "\n")).toBe("5 lines");
    expect(count("~~~\n" + lines(5, "out") + "~~~\n")).toBe("5 lines");
    // A fence with one line inside counts as one line, which the summary leaves out.
    expect(count("```console\nonly\n```")).toBe("");
    // Text that is not exactly one fence counts every line, fences included.
    expect(count("before\n```\n" + lines(3, "x") + "```")).toBe("6 lines");
    expect(count("```\na\n```\n```\nb\n```")).toBe("6 lines");
    expect(count(lines(5, "plain"))).toBe("5 lines");
    // Several text blocks add up, each counted its own way.
    const two = tool({ toolKind: "read", content: [{ type: "text", text: five }, { type: "text", text: "a\nb" }] });
    expect(toolSummary(two).map((s) => s.text).join("")).toBe("7 lines");
  });

  test("edit line: diff counts in diff.add and diff.remove, a failed status in tool.fail", () => {
    const item = tool({ toolStatus: "failed", content: [{ type: "diff", path: "a.php", oldText: "a\n", newText: "b\nc\n" }], endedAt: 2500 });
    expect(tokens(toolLine(item, 63))).toEqual([
      ["←", "tool.kind.edit"],
      ["✗", "tool.fail"],
      ["edit", "tool.kind.edit"],
      ["src/Db/Connection.php", "tool.title"],
      ["+2", "diff.add"],
      ["-1", "diff.remove"],
      ["1.5s", "tool.duration"],
      ["#15", "tool.index"],
    ]);
  });

  test("a missing or unknown kind takes tool.kind.other", () => {
    expect(toolLine(tool({ toolKind: null }), 63)[0]!.token).toBe("tool.kind.other");
    expect(toolLine(tool({ toolKind: "telepathy" as never }), 63)[0]!.token).toBe("tool.kind.other");
  });

  test("kind glyphs, and `•` for other kinds", () => {
    expect(["read", "edit", "execute", "search", "fetch", "other"].map((k) => kindGlyph(tool({ toolKind: k as never })))).toEqual(["→", "←", "$", "*", "%", "•"]);
    expect(kindGlyph(tool({ toolKind: null }))).toBe("•");
  });

  test("duration from 100 ms, and the title gives way first when narrow; never wider than the width", () => {
    const item = tool({ title: "npm test -- --filter api --reporter verbose", toolKind: "execute", endedAt: 4200, content: [{ type: "text", text: "a\nb\nc\n" }] });
    expect(text(toolLine(item, 80))).toBe(`$ ✓ execute  npm test -- --filter api --reporter verbose${" ".repeat(6)}3 lines  3.2s  #15`);
    const narrow = text(toolLine(item, 50));
    expect(narrow).toBe("$ ✓ execute  npm test -- --fi…  3 lines  3.2s  #15");
    expect(displayWidth(narrow)).toBe(50);
    expect(text(toolLine(tool({ endedAt: 1099 }), 40))).not.toContain("s  #15");
    for (const width of [30, 20, 12, 5]) expect(displayWidth(text(toolLine(item, width)))).toBeLessThanOrEqual(width);
  });

  test("terminal content shows the unavailable notice in the summary", () => {
    const item = tool({ toolKind: "execute", content: [{ type: "terminal_unavailable" }] });
    expect(text(toolLine(item, 100))).toMatch(new RegExp(`^\\$ ✓ execute  src/Db/Connection.php +${TERMINAL_UNAVAILABLE_SHORT}  #15$`));
  });

  test("newlines in a title are flattened", () => {
    expect(text(toolLine(tool({ title: "line one\nline two" }), 60))).toMatch(/^← ✓ edit {5}line one line two +#15$/);
  });
});

describe("thought and plan lines", () => {
  const thought = (text: string, status: "live" | "final" = "final") => ({ id: "x", status, origin: "self" as const, kind: "thought" as const, text });

  test("a leading bold line is the title; `Thinking` while it streams", () => {
    expect(thoughtTitle("**Checking the pool tests**\nThe pool...")).toBe("Checking the pool tests");
    expect(thoughtTitle("  __Plan__\n")).toBe("Plan");
    expect(thoughtTitle("No title **here**")).toBeNull();
    expect(text(thoughtLine(thought("**Checking the pool tests**\nThe pool is...")))).toBe("○ Thought: Checking the pool tests");
    expect(text(thoughtLine(thought("**Checking**\nmore", "live")))).toBe("○ Thinking: Checking");
    expect(thoughtLine(thought("**A**"))[0]!.token).toBe("thought");
  });

  test("without a title: the word count", () => {
    expect(text(thoughtLine(thought(" one two\nthree ")))).toBe("○ Thought · 3 words");
    expect(text(thoughtLine(thought("one")))).toBe("○ Thought · 1 word");
    expect(displayWidth(text(thoughtLine(thought("**A very long title that will not fit**"), 20)))).toBeLessThanOrEqual(20);
  });

  test("plan progress: `plan 3/5`", () => {
    const entries = ["completed", "completed", "completed", "in_progress", "pending"].map((status, i) => ({ content: `step ${i}`, priority: "medium" as const, status: status as never }));
    expect(planLine(entries)).toEqual([{ text: "plan 3/5", token: "muted" }]);
  });
});

describe("summaries and lines", () => {
  test("diff counts treat lines as a multiset; a new file counts every line", () => {
    expect(diffCounts("a\nb\nc\n", "a\nx\nc\ny\n")).toEqual({ added: 2, removed: 1 });
    expect(diffCounts(null, "a\nb\n")).toEqual({ added: 2, removed: 0 });
    expect(diffCounts("a\na\n", "a\n")).toEqual({ added: 0, removed: 1 });
  });

  test("durations", () => {
    expect(formatDuration(3200)).toBe("3.2s");
    expect(formatDuration(65_000)).toBe("1m 05s");
    expect(formatDuration(3_720_000)).toBe("1h 02m");
  });

  test("activity region: three tools then `+N more` (spec scenario)", () => {
    const tools = [1, 2, 3, 4, 5].map((i) => tool({ index: i, title: `Run check ${i}`, toolKind: "execute", toolStatus: "in_progress", status: "live" }));
    const rows = activityRows(tools, 80).map(text);
    expect(rows).toEqual(["… #1 execute  Run check 1", "… #2 execute  Run check 2", "… #3 execute  Run check 3", "+2 more"]);
    expect(activityRows(tools.slice(0, 3), 80)).toHaveLength(3);
  });

  test("permission outcomes", () => {
    const record: PermissionRecordItem = {
      id: "permission:t",
      status: "final",
      origin: "self",
      kind: "permission_record",
      toolCallId: "t",
      title: "Edit src/index.ts",
      options: [],
      outcome: { type: "answered", optionId: "allow-once", optionKind: "allow_once" },
    };
    expect(text(permissionLine(record, tool({ index: 2 }), 80))).toBe("#2 permission  allow once  Edit src/index.ts");
    expect(permissionLine(record, null, 80)[2]!.token).toBe("tool.ok");
    const rejected = permissionLine({ ...record, outcome: { type: "answered", optionId: "r", optionKind: "reject_always" } }, null, 80);
    expect(rejected[2]).toEqual({ text: "reject always", token: "tool.fail" });
    expect(text(permissionLine({ ...record, outcome: { type: "cancelled" } }, tool({ index: 2 }), 80))).toBe("#2 permission  cancelled  Edit src/index.ts");
  });

  test("turn-end marker: stop reason, duration, context when known", () => {
    const marker = { id: "m", status: "final" as const, origin: "self" as const, kind: "marker" as const, markerKind: "turn_end" as const, stopReason: "max_tokens" as const, durationMs: 1234, usage: { used: 38000, size: 200000 } };
    expect(text(turnEndLine(marker))).toBe("max tokens · 1.2s · ctx 38k/200k");
    expect(text(turnEndLine({ ...marker, usage: null }))).toBe("max tokens · 1.2s");
  });
});
