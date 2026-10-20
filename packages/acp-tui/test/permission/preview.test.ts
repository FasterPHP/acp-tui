// SPIKE (phase-1a): S6 task 13.1, the permission card's preview rows and
// window (src/app/permission.ts `previewRows`, `cardLayout`).
import { describe, expect, test } from "bun:test";
import { createSession, reduce, type PermissionRecordItem, type ToolCallItem } from "acp-model";
import { cardClaim, cardInner, cardLayout, cardModel, cardRows, optionAt, PREVIEW_CLAIM_ROWS, previewRows } from "../../src/app/permission.ts";
import { displayWidth } from "../../src/layout/segments.ts";

function fixture(content: ToolCallItem["content"] extends readonly (infer T)[] ? unknown[] : never, options = 4) {
  let s = reduce(createSession(), { type: "prompt_sent", text: "go", at: 0 });
  s = reduce(s, {
    type: "permission_opened",
    toolCallId: "t",
    at: 1,
    request: {
      sessionId: "s",
      toolCall: { toolCallId: "t", title: "Edit a.ts", kind: "edit", content: content as never },
      options: [
        { optionId: "ao", name: "a", kind: "allow_once" },
        { optionId: "aa", name: "b", kind: "allow_always" },
        { optionId: "ro", name: "c", kind: "reject_once" },
        { optionId: "ra", name: "d", kind: "reject_always" },
      ].slice(0, options) as never,
    },
  });
  const tool = s.items.get("tool:t") as ToolCallItem;
  const record = s.items.get("permission:t") as PermissionRecordItem;
  return { tool, model: cardModel(record, tool) };
}

const oldText = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
const newText = oldText.replace("line 10", "line ten");
const text = (row: { text: string }[]) => row.map((s) => s.text).join("");
const style = { focused: true, flash: false, selected: 0, maxRows: 13 };

describe("permission card preview", () => {
  test("a diff previews as the tool card shows it, numbered, with the diff fills; text is approval-sanitised and wrapped", () => {
    const { tool } = fixture([{ type: "diff", path: "/w/a.ts", oldText, newText }]);
    const rows = previewRows(tool, 59);
    expect(rows.map((r) => r.segments.map((s) => s.text).join(""))).toEqual([
      "/w/a.ts",
      expect.stringMatching(/^@@ /),
      " 7   line 7",
      " 8   line 8",
      " 9   line 9",
      "10 - line 10",
      "10 + line ten",
      "11   line 11",
      "12   line 12",
      "13   line 13",
    ]);
    expect(rows[5]!.fill).toBe("diff.removed.bg");
    const { tool: textTool } = fixture([{ type: "content", content: { type: "text", text: `rm -rf ‮/${"x".repeat(70)}​` } }]);
    const wrapped = previewRows(textTool, 59).map((r) => r.segments.map((s) => s.text).join(""));
    expect(wrapped).toHaveLength(2);
    expect(wrapped.join("")).toBe(`rm -rf /${"x".repeat(70)}`);
  });

  test("the window: the rows left under maxRows, clamped so the last row is reachable, and the position in the bottom border", () => {
    const { tool, model } = fixture([{ type: "diff", path: "/w/a.ts", oldText, newText }]);
    const rows = previewRows(tool, 59);
    const at = (offset: number) => cardLayout(model, 63, { ...style, preview: { rows, offset } });
    // 13 rows: borders, the title, four stacked options, six preview rows.
    expect(at(0).rows).toHaveLength(13);
    expect(at(0).preview).toEqual({ height: 6, offset: 0, total: 10 });
    expect(text(at(0).rows.at(-1)!)).toMatch(/^╰─+ 1-6 of 10 ─╯$/);
    expect(at(99).preview).toEqual({ height: 6, offset: 4, total: 10 });
    expect(text(at(99).rows[7]!)).toMatch(/^│ 13 {3}line 13 +│$/);
    for (const row of at(99).rows) expect(displayWidth(text(row))).toBe(63);
    // Room for everything: no position shown, as tall as needed.
    const tall = cardLayout(model, 63, { ...style, maxRows: 30, preview: { rows, offset: 0 } });
    expect(tall.rows).toHaveLength(2 + 1 + 10 + 4);
    expect(text(tall.rows.at(-1)!)).toMatch(/^╰─+╯$/);
  });

  test("no content, or no preview: the card is as before", () => {
    const { tool, model } = fixture([], 3);
    expect(previewRows(tool, 59)).toEqual([]);
    expect(cardLayout(model, 63, { ...style, preview: { rows: [], offset: 0 } }).rows).toEqual(cardRows(model, 63, style));
    expect(cardLayout(model, 63, { ...style, preview: { rows: [], offset: 0 } }).preview).toBeNull();
  });
});

// day-one-feedback task group 13 (spec tui-layout "Permission card", "Spacing gives way before
// content"): the cards' padding inside the frame, and what the card's content claims.
describe("permission card padding and claim (day-one-feedback 13)", () => {
  test("two columns between the frame and the content, and a padding row at the top and the bottom inside the frame, besides maxRows", () => {
    const { tool, model } = fixture([{ type: "diff", path: "/w/a.ts", oldText, newText }]);
    const rows = previewRows(tool, cardInner(63, 2));
    const layout = cardLayout(model, 63, { ...style, maxRows: 9, preview: { rows, offset: 0 }, padding: { rows: 1, columns: 2 } });
    const drawn = layout.rows.map(text);
    // The frame, its padding rows and the 7 rows of maxRows less the borders.
    expect(drawn).toHaveLength(9 + 2);
    expect(drawn[1]).toBe(`│${" ".repeat(61)}│`);
    expect(drawn.at(-2)).toBe(`│${" ".repeat(61)}│`);
    expect(drawn[2]).toBe(`│  Edit a.ts${" ".repeat(48)}  │`);
    const content = (r: string) => r.slice(3, -3).trimEnd();
    expect(drawn.slice(3, 5).map(content)).toEqual(["/w/a.ts", expect.stringMatching(/^@@ /)]);
    for (const row of drawn) expect(displayWidth(row)).toBe(63);
    // The options follow the preview; the answer row and its end skip the padding rows.
    expect(layout.paddingRows).toBe(1);
    expect(drawn.slice(layout.answerRow, layout.answerEnd).map(content)).toEqual(["1 allow once", "2 allow always", "3 reject once", "4 reject always"]);
    expect(layout.answerEnd).toBe(drawn.length - 2);
    expect(optionAt(layout, 3, layout.answerEnd)).toBeNull();
    expect(optionAt(layout, 3, layout.answerRow)).toBe(0);
  });

  test("the claim: the frame, the title, the options and the preview's first two rows (all of a shorter one), no padding rows", () => {
    const { tool, model } = fixture([{ type: "diff", path: "/w/a.ts", oldText, newText }]);
    const rows = previewRows(tool, cardInner(63, 2));
    expect(rows.length).toBeGreaterThan(PREVIEW_CLAIM_ROWS);
    // Four options stack at 63 columns: 2 + 1 + 2 + 4.
    expect(cardClaim(model, 63, rows, 2)).toBe(9);
    expect(cardClaim(model, 63, rows.slice(0, 1), 2)).toBe(8);
    expect(cardClaim(model, 63, [], 2)).toBe(7);
    // Three options fit one row.
    const three = fixture([{ type: "diff", path: "/w/a.ts", oldText, newText }], 3);
    expect(cardClaim(three.model, 63, rows, 2)).toBe(2 + 1 + 2 + 1);
  });
});
