// Lists and task items (mvp-rendering task 4.4; spec tui-rendering "Lists with bullets by level",
// "Task items"): bullets by depth from the glyph set, ordered markers right-aligned from their start
// number (digits, and letters at even depths: review C2), task boxes in their own tokens,
// continuation rows and nested blocks under the item's text.
import { describe, expect, test } from "bun:test";
import { ASCII_GLYPHS, DEFAULT_GLYPHS } from "../../../src/conversation/glyphs.ts";
import { alphaLabel, orderedLabels } from "../../../src/conversation/markdown/blocks.ts";
import { MessageLayout } from "../../../src/conversation/markdown/layout.ts";
import { markdownPlain } from "../../../src/selection/markdown-text.ts";
import { rowText, type Row } from "../../../src/conversation/markdown/types.ts";

const rows = (source: string, width = 40, glyphs = DEFAULT_GLYPHS): Row[] =>
  new MessageLayout(source, width, glyphs).blocks().flatMap((b) => [...Array<Row>(b.marginTop).fill({ spans: [] }), ...b.rows]);
const text = (source: string, width = 40, glyphs = DEFAULT_GLYPHS) => rows(source, width, glyphs).map(rowText);

describe("Lists with bullets by level", () => {
  test("Three levels: the markers read ●, ○ and • from the outermost level in, then ◦, then repeat (review C1)", () => {
    expect(text("- one\n  - two\n    - three\n      - four\n        - five")).toEqual(["● one", "  ○ two", "    • three", "      ◦ four", "        ● five"]);
    const markers = rows("- one\n  - two\n    - three\n      - four").map((r) => r.spans.find((s) => s.text.trim() !== "")!);
    expect(markers.map((s) => [s.text.trim(), s.token])).toEqual([
      ["●", "markdown.list"],
      ["○", "markdown.list"],
      ["•", "markdown.list"],
      ["◦", "markdown.list"],
    ]);
  });

  test("`*` and `+` lists draw the same bullets", () => {
    expect(text("* star\n\n+ plus")).toEqual(["● star", "", "● plus"]);
  });

  test("the ascii glyph set's bullets: four distinct forms, repeating", () => {
    expect(text("- one\n  - two\n    - three\n      - four\n        - five", 40, ASCII_GLYPHS)).toEqual(["* one", "  o two", "    + three", "      - four", "        * five"]);
  });

  test("Ordered from seven: the markers read ` 7.` to `10.`, right-aligned", () => {
    expect(text("7. seven\n8. eight\n9. nine\n10. ten")).toEqual([" 7. seven", " 8. eight", " 9. nine", "10. ten"]);
  });

  test("Parenthesis delimiter: `1)` and `2)` keep their parentheses (review C4)", () => {
    expect(text("1) paren\n2) second")).toEqual(["1) paren", "2) second"]);
    expect(text("9) nine\n10) ten")).toEqual([" 9) nine", "10) ten"]);
    // A change of delimiter starts a new list, which keeps its own.
    expect(text("1. dot\n2) paren")).toEqual(["1. dot", "", "2) paren"]);
    // At the second level the label is a letter, and the parenthesis stays.
    expect(text("- a\n  1) nested")).toEqual(["● a", "  a) nested"]);
    expect(text("1) one\n   1) inner\n   2) next")).toEqual(["1) one", "   a) inner", "   b) next"]);
  });

  test("Letters at the second level: digits, then a. b. c., then digits again (review C2)", () => {
    expect(text("1. one\n2. two\n   1. inner a\n   2. inner b\n   3. inner c\n      1. deep\n      2. deeper\n         1. fourth")).toEqual([
      "1. one",
      "2. two",
      "   a. inner a",
      "   b. inner b",
      "   c. inner c",
      "      1. deep",
      "      2. deeper",
      "         a. fourth",
    ]);
    // The token and the projection follow the drawn label.
    const inner = rows("1. one\n   1. inner")[1]!;
    expect(inner.spans.find((s) => s.text.trim() !== "")).toMatchObject({ text: "a. ", token: "markdown.list" });
    expect(markdownPlain("1. one\n   1. inner\n   2. next")).toBe("1. one\n   a. inner\n   b. next");
  });

  test("letters by nesting depth, whatever encloses the list: an ordered list in a bullet list is at the second level", () => {
    expect(text("- one\n  1. inner\n     - three\n       1. fourth")).toEqual(["● one", "  a. inner", "     • three", "       a. fourth"]);
  });

  test("letters honour the start number: 7 reads g., past z they go on as aa., ab., right-aligned", () => {
    expect(text("1. one\n   7. seven\n   8. eight")).toEqual(["1. one", "   g. seven", "   h. eight"]);
    expect(text("1. one\n   25. y\n   26. z\n   27. aa\n   28. ab")).toEqual(["1. one", "    y. y", "    z. z", "   aa. aa", "   ab. ab"]);
    expect(["1", "26", "27", "52", "53", "702", "703"].map((n) => alphaLabel(Number(n)))).toEqual(["a", "z", "aa", "az", "ba", "zz", "aaa"]);
  });

  test("a list starting at 0 at a letter depth keeps digits for every item (no letter for 0)", () => {
    expect(text("1. one\n   0. zero\n   1. one")).toEqual(["1. one", "   0. zero", "   1. one"]);
    expect(orderedLabels(0, 3, 1)).toEqual(["0", "1", "2"]);
    expect(orderedLabels(1, 3, 1)).toEqual(["a", "b", "c"]);
    expect(orderedLabels(1, 2, 2)).toEqual(["1", "2"]);
    expect(alphaLabel(0)).toBeNull();
  });

  test("continuation rows and nested blocks align under the item's text", () => {
    expect(text("- a long item that wraps onto a second row here\n  - nested", 24)).toEqual(["● a long item that wraps", "  onto a second row here", "  ○ nested"]);
    expect(text("10. a long item that wraps onto a second row", 24)).toEqual(["10. a long item that", "    wraps onto a second", "    row"]);
  });

  test("a loose list: a blank row between items and between an item's blocks, code aligned", () => {
    // The code block's padding rows and two columns of padding (day-one-feedback task group 13).
    expect(text("1. one\n\n   second paragraph\n\n   ```\n   code\n   ```\n2. two")).toEqual(["1. one", "", "   second paragraph", "", "     ", "     code", "     ", "", "2. two"]);
  });

  test("a wrapped item's indent is decoration; a nested item's indent is copied", () => {
    const [first, second] = rows("- one two three four", 10);
    expect(first!.joined).toBeUndefined();
    expect(second!.joined).toBe(" ");
    expect(second!.spans[0]!.projection).toBe("");
    const nested = rows("- a\n  - b")[1]!;
    expect(nested.spans[0]!.projection).toBeUndefined();
  });
});

describe("Task items", () => {
  test("Done and open: `[x] Done task` and `[ ] Open task`, the boxes in different tokens", () => {
    const [done, open, capital] = rows("- [x] Done task\n- [ ] Open task\n- [X] Capital");
    expect([done, open, capital].map((r) => rowText(r!))).toEqual(["[x] Done task", "[ ] Open task", "[x] Capital"]);
    expect(done!.spans[0]).toMatchObject({ text: "[x] ", token: "markdown.task.done" });
    expect(open!.spans[0]).toMatchObject({ text: "[ ] ", token: "markdown.task.open" });
    // Done items keep their text style.
    expect(done!.spans[1]).toMatchObject({ text: "Done task", token: "text" });
  });

  test("in an ordered list the box follows the number", () => {
    expect(text("1. [x] done\n2. [ ] open")).toEqual(["1. [x] done", "2. [ ] open"]);
  });

  test("a task item's continuation rows align under its text, after the box", () => {
    expect(text("- [ ] a task long enough to wrap here", 20)).toEqual(["[ ] a task long", "    enough to wrap", "    here"]);
  });
});
