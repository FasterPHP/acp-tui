// Honest counts for tool output (spec tui-rendering "Output snippets", "Counts for a moving output
// window"): the collapsed count's label, the marker's lines, snippets of whole lines.
import { describe, expect, test } from "bun:test";
import type { ToolCallItem } from "acp-model";
import { markerText, snippetCut, toolCardHeight, toolCardLayout } from "../../src/conversation/card.ts";
import { toolSummary } from "../../src/conversation/format.ts";
import { DEFAULT_GLYPHS } from "../../src/conversation/glyphs.ts";
import { rowText } from "../../src/conversation/markdown/types.ts";

function tool(overrides: Partial<ToolCallItem> = {}): ToolCallItem {
  return {
    id: "tool:t", status: "live", origin: "self", kind: "tool_call", toolCallId: "t", index: 1, title: "run", toolName: null,
    toolKind: "execute", toolStatus: "in_progress", content: [], locations: [], rawOutputText: null, inputText: null, startedAt: 0, endedAt: null,
    ...overrides,
  };
}
const withText = (text: string, extra: Partial<ToolCallItem> = {}) => tool({ content: [{ type: "text", text }], ...extra });
const lines = (n: number, width = 0) => Array.from({ length: n }, (_, i) => `l${i + 1}` + "x".repeat(width)).join("\n");
const count = (item: ToolCallItem) => toolSummary(item).map((s) => s.text).join("");

describe("collapsed count", () => {
  test("growing output keeps the plain count; a window reads `last N lines`", () => {
    expect(count(withText(lines(500)))).toBe("500 lines");
    expect(count(withText(lines(347), { outputWindow: true }))).toBe("last 347 lines");
    expect(count(withText(lines(300), { outputWindow: true, toolStatus: "completed", status: "final" }))).toBe("last 300 lines");
  });
});

describe("marker text", () => {
  test("lines, singular and window forms", () => {
    expect(markerText(4990, "a")).toBe("4990 lines hidden · a or click here to show all");
    expect(markerText(1, null)).toBe("1 line hidden · click here to show all");
    expect(markerText(25, "a", 30)).toBe("25 of the last 30 lines hidden · a or click here to show all");
  });
});

describe("snippets of whole lines", () => {
  test("Wrapped long lines: 30 lines twice the card's width, snippet 10 rows: last 5 lines, 25 hidden", () => {
    const width = 20;
    const item = withText(Array.from({ length: 30 }, (_, i) => String(i + 1).padStart(2, "0") + "y".repeat(width * 2 - 2)).join("\n"));
    const layout = toolCardLayout(item, width, false, DEFAULT_GLYPHS, false);
    expect(layout.hidden).toBe(25);
    expect(layout.total).toBe(30);
    const shown = layout.rows.map(rowText).filter((t) => /^\d\d/.test(t));
    expect(shown.map((t) => t.slice(0, 2))).toEqual(["26", "27", "28", "29", "30"]);
    expect(layout.rows.length).toBe(1 + 1 + 10 + 1);
    expect(toolCardHeight(item, width, false, DEFAULT_GLYPHS, false)).toBe(layout.rows.length);
  });

  test("a non-execute call shows its first whole lines", () => {
    const item = withText(Array.from({ length: 30 }, (_, i) => String(i + 1).padStart(2, "0") + "y".repeat(38)).join("\n"), { toolKind: "read" });
    const layout = toolCardLayout(item, 20, false, DEFAULT_GLYPHS, false);
    expect(layout.hidden).toBe(25);
    expect(layout.rows.map(rowText).filter((t) => /^\d\d/.test(t)).map((t) => t.slice(0, 2))).toEqual(["01", "02", "03", "04", "05"]);
    expect(toolCardHeight(item, 20, false, DEFAULT_GLYPHS, false)).toBe(layout.rows.length);
  });

  test("one line longer than the snippet is shown whole, nothing hidden", () => {
    const item = withText("```\n" + "z".repeat(400) + "\n```");
    const layout = toolCardLayout(item, 20, false, DEFAULT_GLYPHS, false);
    expect(layout.hidden).toBe(0);
    expect(layout.marker).toBe(-1);
    expect(toolCardHeight(item, 20, false, DEFAULT_GLYPHS, false)).toBe(layout.rows.length);
  });

  test("a window's marker count is of the latest update's lines", () => {
    const item = withText(lines(300), { outputWindow: true });
    const layout = toolCardLayout(item, 40, false, DEFAULT_GLYPHS, false);
    expect(layout.windowed).toBe(true);
    expect(layout.hidden).toBe(290);
    expect(layout.total).toBe(300);
  });

  test("a command result's output rows are cut by lines too", () => {
    const output = Array.from({ length: 40 }, (_, i) => `r${i + 1}`).join("\n");
    const item = withText(`Here are the results from executing the command.\n<return-code>\n0\n</return-code>\n<output>\n${output}\n</output>\n`, { toolStatus: "completed", status: "final" });
    const layout = toolCardLayout(item, 40, false, DEFAULT_GLYPHS, false);
    expect(layout.hidden).toBe(30);
    const text = layout.rows.map(rowText);
    expect(text.some((t) => t.includes("r40"))).toBe(true);
    expect(text.some((t) => t.includes("Return code: 0"))).toBe(true);
    expect(toolCardHeight(item, 40, false, DEFAULT_GLYPHS, false)).toBe(layout.rows.length);
  });

  test("snippetCut: at least one line, never null when lines fit", () => {
    expect(snippetCut([0, 1, 2], 3, 10, true)).toBeNull();
    expect(snippetCut([0, 12, 24], 36, 10, true)).toEqual({ from: 24, to: 36, hidden: 2, lines: 3 });
  });
});
