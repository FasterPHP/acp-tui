// Headings (mvp-rendering task 4.3; spec tui-rendering "Headings distinct per level", "Markdown
// rendered from tokens"): a token per level, rules below levels 1 and 2 from the glyph set, setext
// and closed ATX headings, one blank row before a heading unless it opens the message.
import { describe, expect, test } from "bun:test";
import { ASCII_GLYPHS, DEFAULT_GLYPHS } from "../../../src/conversation/glyphs.ts";
import { MessageLayout } from "../../../src/conversation/markdown/layout.ts";
import { rowText, type Row } from "../../../src/conversation/markdown/types.ts";
import { DEFAULT_THEME, resolveTheme } from "../../../src/theme/index.ts";

const layout = (source: string, width = 40, glyphs = DEFAULT_GLYPHS) => new MessageLayout(source, width, glyphs);
const rows = (source: string, width = 40, glyphs = DEFAULT_GLYPHS): (Row | null)[] =>
  layout(source, width, glyphs)
    .blocks()
    .flatMap((b) => [...Array<null>(b.marginTop).fill(null), ...b.rows]);
const text = (r: Row | null) => (r ? rowText(r) : "");

describe("Headings distinct per level", () => {
  test("Six levels: no two levels share colour, attributes and rule", () => {
    const theme = resolveTheme(DEFAULT_THEME);
    const looks = new Set<string>();
    for (let level = 1; level <= 6; level++) {
      const [heading, rule] = rows(`${"#".repeat(level)} Title`) as Row[];
      const span = heading!.spans[0]!;
      expect(span.token as string).toBe(`markdown.heading.${level}`);
      const style = theme.text(span.token);
      const ruleLook = rule ? `${rowText(rule)[0]}/${rule.spans[0]!.token}` : "none";
      looks.add(`${style.fg.intent}:${style.fg.slot}:${style.fg.r},${style.fg.g},${style.fg.b}|${style.attributes}|${ruleLook}`);
    }
    expect(looks.size).toBe(6);
  });

  test("level 1 has a heavy rule across the width, level 2 a light muted one, the rest none", () => {
    expect(rows("# One", 20).map(text)).toEqual(["One", "━".repeat(20)]);
    expect(rows("## Two", 20).map(text)).toEqual(["Two", "─".repeat(20)]);
    expect(rows("## Two", 20)[1]!.spans[0]!.token).toBe("muted");
    expect(rows("### Three", 20).map(text)).toEqual(["Three"]);
    // Rules are decoration: never copied.
    expect(rows("# One", 20)[1]!.decorative).toBe(true);
  });

  test("Rules in the glyph set: the ascii set draws the rules in ASCII", () => {
    expect(rows("# One", 10, ASCII_GLYPHS).map(text)).toEqual(["One", "=".repeat(10)]);
    expect(rows("## Two", 10, ASCII_GLYPHS).map(text)).toEqual(["Two", "-".repeat(10)]);
  });

  test("Setext and closed headings: levels 1 and 2, no underline row, no trailing hashes", () => {
    const source = "Title\n=====\n\n## Closed ##\n\nSub\n---";
    const blocks = layout(source).blocks();
    expect(blocks.map((b) => [b.token.type, b.rows[0]!.spans[0]!.token])).toEqual([
      ["heading", "markdown.heading.1"],
      ["heading", "markdown.heading.2"],
      ["heading", "markdown.heading.2"],
    ]);
    const drawn = rows(source, 12).map(text);
    expect(drawn).toEqual(["Title", "━".repeat(12), "", "Closed", "─".repeat(12), "", "Sub", "─".repeat(12)]);
    expect(drawn.some((r) => r.includes("=") || r.includes("#"))).toBe(false);
  });

  test("one blank row before a heading, none when it opens the message; headings are never centred", () => {
    expect(rows("# Opening\n\ntext\n\n### Later\ntext", 20).map(text)).toEqual(["Opening", "━".repeat(20), "", "text", "", "Later", "", "text"]);
    for (const row of rows("### Short", 40)) expect(text(row).startsWith("Short")).toBe(true);
  });

  test("seven hashes is not a heading", () => {
    expect(rows("####### Seven").map(text)).toEqual(["####### Seven"]);
  });

  test("inline formatting inside a heading keeps the level's token", () => {
    const [heading] = rows("## A **bold** `code` title") as Row[];
    expect(heading!.spans.map((s) => [s.text, s.token, !!s.bold])).toEqual([
      ["A ", "markdown.heading.2", false],
      ["bold", "markdown.heading.2", true],
      [" ", "markdown.heading.2", false],
      ["code", "markdown.code", false],
      [" title", "markdown.heading.2", false],
    ]);
  });

  test("the heading_markers setting shows the hashes, muted and never copied", () => {
    const l = new MessageLayout("## Two", 20, DEFAULT_GLYPHS, { ...layout("").ctx.flags, headingMarkers: true });
    const [heading] = l.blocks()[0]!.rows;
    expect(rowText(heading!)).toBe("## Two");
    expect(heading!.spans[0]).toMatchObject({ text: "## ", token: "muted", projection: "" });
  });
});
