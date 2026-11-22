// The permission record keeps the question's line breaks when expanded (spec tui-conversation
// "Permission record"; auggie-1x-support, Marcus 20 November 2026): collapsed it is one joined
// line, expanded the question is drawn with its lines, its indentation and one blank row for
// every run of blank lines, the emoji a terminal mis-measures as their names. A question of one
// line has no expanded form. Copy and export keep the breaks of a question that has them.
import { describe, expect, test } from "bun:test";
import type { PermissionRecordItem } from "acp-model";
import { collapsible } from "../../src/conversation/view-model.ts";
import { permissionLine, permissionQuestionRows } from "../../src/conversation/format.ts";
import { estimateHeight } from "../../src/conversation/window/heights.ts";
import { conversationMarkdown } from "../../src/selection/export.ts";
import { projectItem } from "../../src/selection/projection.ts";
import { TERMINAL_TABLE } from "../../src/renderer/capabilities.ts";

const WARNING = "⚠️";
const AUGGIE = `${WARNING} Tool "bash" requires approval:\n\n  echo hello\n\nAllow?`;

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
  outcome: { type: "answered", optionId: "1", optionKind: "allow_once" },
});

const text = (row: readonly { text: string }[]) => row.map((s) => s.text).join("");

describe("the permission record's rows", () => {
  test("collapsed: the question joined on one line, as before", () => {
    expect(text(permissionLine(record(AUGGIE), null, 200))).toBe(`permission  No  ${WARNING} Tool "bash" requires approval: echo hello Allow?`);
  });

  test("expanded: the header keeps the answer only, the question's lines follow with their indentation and one blank row", () => {
    const item = record(AUGGIE);
    expect(text(permissionLine(item, null, 200, true)).trimEnd()).toBe("permission  No");
    expect(permissionQuestionRows(item, []).map(text)).toEqual([`${WARNING} Tool "bash" requires approval:`, "", "  echo hello", "", "Allow?"]);
  });

  test("runs of blank lines collapse to one and bidi controls go", () => {
    const rows = permissionQuestionRows(record("a\n\n\n\n  b‮\n\t c\n"), []);
    expect(rows.map(text)).toEqual(["a", "", "  b", "         c"]);
  });

  test("emoji a terminal mis-measures are drawn as their names, muted", () => {
    const rows = permissionQuestionRows(record(AUGGIE), TERMINAL_TABLE.zed.capabilities.emoji);
    expect(text(rows[0]!)).toBe(`:warning: Tool "bash" requires approval:`);
    expect(rows[0]![0]).toMatchObject({ text: ":warning:", token: "muted" });
  });

  test("a one-line question has no expanded form: not collapsible, one row, no question rows", () => {
    const item = record("Edit src/index.ts");
    expect(collapsible(item)).toBe(false);
    expect(permissionQuestionRows(item, [])).toEqual([]);
    expect(text(permissionLine(item, null, 200, true))).toBe("permission  No  Edit src/index.ts");
    expect(estimateHeight(item, 80, true)).toBe(1);
    expect(collapsible(record(AUGGIE))).toBe(true);
  });

  test("the expanded height is the header, the padding rows and the question's rows (wrapped)", () => {
    const item = record(AUGGIE);
    expect(estimateHeight(item, 80, false)).toBe(1);
    expect(estimateHeight(item, 80, true)).toBe(1 + 5 + 2);
    expect(estimateHeight(record("x\n" + "y".repeat(100)), 40, true)).toBeGreaterThan(1 + 2 + 2);
  });
});

describe("copy and export of the record", () => {
  test("a one-line question copies as one line", () => {
    expect(projectItem(record("Edit src/index.ts")).text).toBe("Permission (No): Edit src/index.ts");
  });

  test("a question with line breaks copies with them, collapsed or expanded", () => {
    const projection = projectItem(record(AUGGIE));
    expect(projection.text).toBe(`Permission (No): ${WARNING} Tool "bash" requires approval:\n\n  echo hello\n\nAllow?`);
    // Find: only a hit past the first line needs the record expanded.
    expect(projection.summaryEnd).toBe(projection.text.indexOf("\n"));
  });

  test("the Markdown export fences the question's lines", () => {
    const item = record(AUGGIE);
    const md = conversationMarkdown([item.id], (id) => (id === item.id ? item : undefined));
    expect(md).toContain(`**Permission** (No):\n\n\`\`\`text\n${AUGGIE}\n\`\`\``);
  });
});
