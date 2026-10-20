// Tables (mvp-rendering task 5.1; spec tui-rendering "Compact bordered tables"): a rounded border,
// one column of padding, no padding rows, a header-only rule, the header in its token, columns
// aligned as the delimiter row says, cells wrapped at word boundaries with their formatting.
import { describe, expect, test } from "bun:test";
import { ASCII_GLYPHS, DEFAULT_GLYPHS } from "../../../src/conversation/glyphs.ts";
import { MessageLayout } from "../../../src/conversation/markdown/layout.ts";
import { mapBlockRows, projectMessage } from "../../../src/conversation/markdown/project.ts";
import { rowText, type Row } from "../../../src/conversation/markdown/types.ts";
import { displayWidth } from "../../../src/layout/segments.ts";

const rows = (source: string, width = 60, glyphs = DEFAULT_GLYPHS): Row[] => new MessageLayout(source, width, glyphs).blocks().flatMap((b) => b.rows as Row[]);
const text = (source: string, width = 60, glyphs = DEFAULT_GLYPHS) => rows(source, width, glyphs).map(rowText);

describe("Compact bordered tables", () => {
  test("Compact: a header and three single-line rows take exactly seven rows, no rule between body rows", () => {
    expect(text("| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |")).toEqual([
      "╭───┬───╮",
      "│ a │ b │",
      "├───┼───┤",
      "│ 1 │ 2 │",
      "│ 3 │ 4 │",
      "│ 5 │ 6 │",
      "╰───┴───╯",
    ]);
  });

  test("Alignment: `| :-- | :-: | --: |` aligns left, centre and right", () => {
    expect(text("| left | centre | right |\n| :-- | :-: | --: |\n| a | b | c |")).toEqual([
      "╭──────┬────────┬───────╮",
      "│ left │ centre │ right │",
      "├──────┼────────┼───────┤",
      "│ a    │   b    │     c │",
      "╰──────┴────────┴───────╯",
    ]);
  });

  test("the border and rules in markdown.table.border, the header in markdown.table.header, not copied", () => {
    const [top, header, rule] = rows("| h |\n| - |\n| v |");
    expect(top).toMatchObject({ decorative: true });
    expect(top!.spans[0]!.token).toBe("markdown.table.border");
    expect(rule).toMatchObject({ decorative: true });
    expect(header!.spans.find((s) => s.text === "h")!.token).toBe("markdown.table.header");
    expect(header!.spans.filter((s) => s.text.includes("│")).every((s) => s.projection === "" && s.token === "markdown.table.border")).toBe(true);
  });

  test("inline formatting kept in cells; an escaped pipe is a pipe", () => {
    const drawn = rows("| a | b |\n| - | - |\n| **bold** `code` | x \\| y |");
    const body = drawn[3]!;
    expect(rowText(body)).toBe("│ bold code │ x | y │");
    expect(body.spans.find((s) => s.text === "bold")!.bold).toBe(true);
    expect(body.spans.find((s) => s.text === "code")!.token).toBe("markdown.code");
  });

  test("columns are sized to their content; a narrow pane wraps cells at word boundaries", () => {
    const source = "| key | description |\n| --- | --- |\n| a | a long description that has to wrap in a narrow pane |";
    const drawn = text(source, 34);
    expect(drawn.every((r) => displayWidth(r) <= 34)).toBe(true);
    expect(drawn).toEqual([
      "╭─────┬──────────────────────────╮",
      "│ key │ description              │",
      "├─────┼──────────────────────────┤",
      "│ a   │ a long description that  │",
      "│     │ has to wrap in a narrow  │",
      "│     │ pane                     │",
      "╰─────┴──────────────────────────╯",
    ]);
  });

  test("the ascii glyph set's border", () => {
    expect(text("| a |\n| - |\n| 1 |", 20, ASCII_GLYPHS)).toEqual(["+---+", "| a |", "+---+", "| 1 |", "+---+"]);
  });

  test("wide characters line up by display width", () => {
    expect(text("| k | v |\n| - | - |\n| 日本 | x |\n| a | y |")).toEqual(["╭──────┬───╮", "│ k    │ v │", "├──────┼───┤", "│ 日本 │ x │", "│ a    │ y │", "╰──────┴───╯"]);
  });
});

describe("a table's projection and cell maps", () => {
  const source = "| a | long header | c |\n|:--|:-:|--:|\n| 1 | x \\| y | `z` |\n| 22 | | three **3** |";

  test("aligned text, whatever the layout: cells padded to their column, two spaces apart", () => {
    expect(projectMessage(source, DEFAULT_GLYPHS).text).toBe("a   long header  c\n1   x | y        z\n22               three 3");
  });

  test("every drawn cell character maps to itself in the projection, in the grid and when wrapped", () => {
    const whole = projectMessage(source, DEFAULT_GLYPHS);
    const block = whole.blocks[0]!;
    for (const width of [60, 24, 16]) {
      const laid = new MessageLayout(source, width, DEFAULT_GLYPHS).blocks()[0]!;
      const cells = mapBlockRows(laid.rows, whole.text.slice(block.start, block.end), block.start, true)!;
      laid.rows.forEach((row, r) => {
        const map = cells[r];
        if (!map) return;
        let col = 0;
        for (const span of row.spans) {
          for (const ch of span.text) {
            const at = map.from[col]!;
            if (span.projection === "") expect(at).toBe(-1);
            else expect(whole.text.slice(at, map.to[col]!)).toBe(ch);
            col += displayWidth(ch);
          }
        }
      });
    }
  });
});
