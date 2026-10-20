// Task 6.5: the permission card's content (spec tui-layout "Permission card"):
// kind, index, approval-sanitised title, options numbered from 1 in agent
// order and labelled by kind, one row or stacked, within the rows the other
// regions leave (the conversation keeping 4, or 1 grown; mvp-chrome-and-keys
// design D6), and a frame and marker glyph that the conversation never uses.
import { describe, expect, test } from "bun:test";
import type { PermissionRecordItem, ToolCallItem } from "acp-model";
import { cardLayout, cardMaxRows, cardModel, cardRows, optionAt, PERMISSION_GLYPHS, wrapText, type CardStyle } from "../../src/app/permission.ts";
import { displayWidth } from "../../src/layout/segments.ts";
import { DEFAULT_GLYPHS } from "../../src/conversation/glyphs.ts";

const FOUR = [
  { optionId: "o1", name: "Yes", kind: "allow_once" as const },
  { optionId: "o2", name: "Always", kind: "allow_always" as const },
  { optionId: "o3", name: "No", kind: "reject_once" as const },
  { optionId: "o4", name: "Never", kind: "reject_always" as const },
];

const record = (title: string, options: PermissionRecordItem["options"] = FOUR): PermissionRecordItem => ({
  id: "permission:t2",
  status: "live",
  origin: "self",
  kind: "permission_record",
  toolCallId: "t2",
  title,
  options,
  outcome: { type: "pending" },
});

const tool: ToolCallItem = {
  id: "tool:t2",
  status: "live",
  origin: "self",
  kind: "tool_call",
  toolCallId: "t2",
  index: 14,
  title: "rm -rf build/",
  toolName: null,
  toolKind: "execute",
  toolStatus: "pending",
  content: [],
  locations: [],
  rawOutputText: null,
  startedAt: 0,
  endedAt: null,
};

const text = (rows: { text: string }[][]) => rows.map((r) => r.map((s) => s.text).join(""));
const STYLE: CardStyle = { focused: true, flash: false, selected: 0, maxRows: 13 };

describe("cardModel", () => {
  test("options keep agent order, are numbered from 1 and labelled by kind (not by the agent's name)", () => {
    const model = cardModel(record("rm -rf build/"), tool);
    expect(model.options).toEqual([
      { number: 1, label: "allow once", optionId: "o1" },
      { number: 2, label: "allow always", optionId: "o2" },
      { number: 3, label: "reject once", optionId: "o3" },
      { number: 4, label: "reject always", optionId: "o4" },
    ]);
    expect(model.toolKind).toBe("execute");
    expect(model.index).toBe(14);
  });

  test("an unknown kind is labelled by the agent's option name, sanitised", () => {
    const model = cardModel(record("x", [{ optionId: "o", name: "Run ‮twice​", kind: "maybe" as never }]), tool);
    expect(model.options[0]!.label).toBe("Run twice");
  });

  test("the title is sanitised in approval context: bidi overrides and zero-width characters removed", () => {
    const model = cardModel(record("cat ‮txt.exe‬ ​notes⁦x⁩"), tool);
    expect(model.title).toBe("cat txt.exe notesx");
    for (const ch of ["‮", "‬", "​", "⁦", "⁩"]) expect(model.title).not.toContain(ch);
  });

  test("past nine options there are no number keys", () => {
    const options = Array.from({ length: 10 }, (_, i) => ({ optionId: `o${i}`, name: `n${i}`, kind: "allow_once" as const }));
    const model = cardModel(record("x", options), tool);
    expect(model.options.map((o) => o.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, null]);
  });
});

describe("cardRows", () => {
  const four = cardModel(record("rm -rf build/"), tool);
  const three = cardModel(record("rm -rf build/", FOUR.slice(0, 3)), tool);

  test("three options on one row at 63 columns: header with marker, kind and index; title; options; bottom border", () => {
    const rows = text(cardRows(three, 63, STYLE));
    expect(rows).toEqual([
      `╭─ ◊ Permission  execute  #14 ${"─".repeat(32)}╮`,
      `│ rm -rf build/${" ".repeat(47)}│`,
      `│ 1 allow once   2 allow always   3 reject once${" ".repeat(15)}│`,
      `╰${"─".repeat(61)}╯`,
    ]);
    for (const row of rows) expect(displayWidth(row)).toBe(63);
  });

  test("four options stack when they do not fit the inner width", () => {
    expect(text(cardRows(four, 63, STYLE)).slice(2, 6).map((r) => r.slice(2).trimEnd().replace(/ *│$/, ""))).toEqual([
      "1 allow once",
      "2 allow always",
      "3 reject once",
      "4 reject always",
    ]);
    // Wide enough, they share one row.
    expect(text(cardRows(four, 80, STYLE))[2]).toStartWith("│ 1 allow once   2 allow always   3 reject once   4 reject always");
  });

  test("a long title wraps; the card never exceeds maxRows, the title giving way first with an ellipsis", () => {
    const long = cardModel(record(Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ")), tool);
    const tall = text(cardRows(long, 40, { ...STYLE, maxRows: 30 }));
    expect(tall.length).toBe(2 + 8 + 4);
    const capped = text(cardRows(long, 40, { ...STYLE, maxRows: 13 }));
    expect(capped.length).toBe(13);
    expect(capped[7]!.trimEnd()).toMatch(/…\s*│$/);
    expect(capped.slice(8, 12).map((r) => r.slice(2, 17).trimEnd())).toEqual(["1 allow once", "2 allow always", "3 reject once", "4 reject always"]);
    for (const row of capped) expect(displayWidth(row)).toBe(40);
  });

  test("the selected option is marked only while the card has focus", () => {
    const selectedText = (style: CardStyle) =>
      cardRows(three, 63, style)
        .flat()
        .filter((s) => s.selected)
        .map((s) => s.text)
        .join("");
    expect(selectedText({ ...STYLE, selected: 2 })).toBe("3 reject once");
    expect(selectedText({ ...STYLE, focused: false })).toBe("");
    // Focused at the preview (mvp-chrome-and-keys task 5.2): nothing selected until the answer row.
    expect(selectedText({ ...STYLE, selected: 2, answer: false })).toBe("");
    expect(selectedText({ ...STYLE, selected: 2, answer: true })).toBe("3 reject once");
  });

  test("frame and marker use the permission token, or accent while flashing; options dim without focus", () => {
    const calm = cardRows(three, 63, { ...STYLE, focused: false });
    expect(calm[0]![0]!.token).toBe("permission");
    expect(calm[0]![1]).toEqual({ text: "◊ ", token: "permission" });
    // The option pieces: between the frame and its padding column, and the fill, the padding column
    // and the frame (the padding plain since day-one-feedback task group 13).
    expect(calm[2]![1]).toEqual({ text: " ", token: "text" });
    expect(calm[2]!.slice(2, -3).every((s) => s.token === "muted")).toBe(true);
    const flashing = cardRows(three, 63, { ...STYLE, flash: true });
    expect(flashing.map((r) => r[0]!.token)).toEqual(["accent", "accent", "accent", "accent"]);
    const focused = cardRows(three, 63, STYLE);
    expect(focused[2]!.find((s) => s.text === "1")?.token).toBe("accent");
  });

  test("narrow: the header is cut, every row still fits", () => {
    for (const row of text(cardRows(four, 20, STYLE))) expect(displayWidth(row)).toBeLessThanOrEqual(20);
  });
});

test("cardMaxRows: the conversation keeps 4 of the rows left at rest and 1 grown; never under 3", () => {
  expect(cardMaxRows(16, false)).toBe(12);
  expect(cardMaxRows(16, true)).toBe(15);
  expect(cardMaxRows(5, false)).toBe(3);
  expect(cardMaxRows(0, true)).toBe(3);
});

test("wrapText breaks at spaces and inside words longer than the width", () => {
  expect(wrapText("one two three", 7)).toEqual(["one two", "three"]);
  expect(wrapText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  expect(wrapText("", 4)).toEqual([""]);
});

test("the conversation never uses the card's frame or marker glyph", () => {
  // mvp-rendering: rendered Markdown draws tables in a rounded border, quotes with a thin bar and
  // rules (spec tui-rendering), in Markdown tokens with no fill and no marker: never the card's
  // combination of fill, warning frame and marker (spec tui-layout). Outside Markdown the glyph set
  // uses none of the card's glyphs, and the marker appears nowhere. The flat scroll bar's track is
  // the card's `│` (spec tui-layout "Conversation scrollbar" names it), but only in the bar's own
  // column, past the right margin and outside the conversation's text, never with the card's fill
  // or marker.
  const { markdown, scrollbar, ...rest } = DEFAULT_GLYPHS;
  const conversation = JSON.stringify(rest);
  for (const glyph of Object.values(PERMISSION_GLYPHS)) expect(conversation).not.toContain(glyph);
  expect(JSON.stringify(markdown)).not.toContain(PERMISSION_GLYPHS.marker);
  expect(JSON.stringify(scrollbar)).not.toContain(PERMISSION_GLYPHS.marker);
});

describe("optionAt (mvp-chrome-and-keys task 12.5)", () => {
  const three = cardModel(record("rm -rf build/", FOUR.slice(0, 3)), tool);
  const four = cardModel(record("rm -rf build/"), tool);

  test("on one row: each option's number and label are its own, the gaps and the frame no option's", () => {
    const layout = cardLayout(three, 63, STYLE);
    // `│ 1 allow once   2 allow always   3 reject once ...│` on row 2.
    const row = text(layout.rows)[2]!;
    expect(layout.answerRow).toBe(2);
    expect(optionAt(layout, row.indexOf("1 allow once"), 2)).toBe(0);
    expect(optionAt(layout, row.indexOf("once"), 2)).toBe(0);
    expect(optionAt(layout, row.indexOf("2 allow always") + 13, 2)).toBe(1);
    expect(optionAt(layout, row.indexOf("3 reject once") + 4, 2)).toBe(2);
    expect(optionAt(layout, row.indexOf("2 allow always") - 1, 2)).toBeNull();
    expect(optionAt(layout, 0, 2)).toBeNull();
    expect(optionAt(layout, 60, 2)).toBeNull();
    // Not the options' rows: the header, the title, the bottom border.
    for (const y of [0, 1, 3]) expect(optionAt(layout, 4, y)).toBeNull();
  });

  test("stacked: one option per row", () => {
    const layout = cardLayout(four, 63, STYLE);
    expect([2, 3, 4, 5].map((y) => optionAt(layout, 4, y))).toEqual([0, 1, 2, 3]);
    expect(optionAt(layout, 40, 3)).toBeNull();
  });

  test("no card", () => {
    expect(optionAt(null, 4, 2)).toBeNull();
  });
});
