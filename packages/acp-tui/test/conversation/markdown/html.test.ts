// Thematic breaks, images, HTML and the extensions that stay text (mvp-rendering task 4.6; spec
// tui-rendering "Thematic breaks and images", "HTML in Markdown", "Other extensions stay text").
import { describe, expect, test } from "bun:test";
import { ASCII_GLYPHS, DEFAULT_GLYPHS } from "../../../src/conversation/glyphs.ts";
import { MessageLayout } from "../../../src/conversation/markdown/layout.ts";
import { projectMessage } from "../../../src/conversation/markdown/project.ts";
import { rowText, type Row, type Span } from "../../../src/conversation/markdown/types.ts";

const rows = (source: string, width = 40, glyphs = DEFAULT_GLYPHS): Row[] =>
  new MessageLayout(source, width, glyphs).blocks().flatMap((b) => [...Array<Row>(b.marginTop).fill({ spans: [] }), ...b.rows]);
const text = (source: string, width = 40, glyphs = DEFAULT_GLYPHS) => rows(source, width, glyphs).map(rowText);
const spans = (source: string): Span[] => rows(source).flatMap((r) => r.spans as Span[]);
const spanOf = (source: string, t: string) => spans(source).find((s) => s.text.includes(t));

describe("Thematic breaks and images", () => {
  test("a thematic break is a full-width rule in markdown.quote, in all three forms, not copied", () => {
    for (const source of ["---", "***", "___"]) {
      const [rule] = rows(`a\n\n${source}\n\nb`, 20).filter((r) => r.decorative);
      expect(rowText(rule!)).toBe("─".repeat(20));
      expect(rule!.spans[0]!.token).toBe("markdown.quote");
    }
    expect(text("---", 8, ASCII_GLYPHS)).toEqual(["--------"]);
    expect(projectMessage("a\n\n---\n\nb", DEFAULT_GLYPHS).text).toBe("a\n\nb");
  });

  test("Reference image: `[image: diagram]` as a link, neither the title nor `[ref]` shown", () => {
    const source = 'See ![diagram][ref] here.\n\n[ref]: https://example.com/d.png "The title"';
    expect(text(source)).toEqual(["See [image: diagram] here."]);
    expect(spanOf(source, "[image")).toMatchObject({ text: "[image: diagram]", token: "markdown.link", link: { href: "https://example.com/d.png" } });
  });

  test("an inline image, and one with no alt text", () => {
    expect(text('![Alt text](https://example.com/i.png "Title") and ![](x.png)')).toEqual(["[image: Alt text] and [image]"]);
  });
});

describe("HTML in Markdown", () => {
  test("Inline tags: `<kbd>` in the code token, `<br>` a new row, no tag or comment shown", () => {
    const source = "press <kbd>Ctrl</kbd> and a<br>b <!-- hidden -->";
    expect(text(source)).toEqual(["press Ctrl and a", "b"]);
    expect(spanOf(source, "Ctrl")).toMatchObject({ text: "Ctrl", token: "markdown.code" });
    expect(text(source).join("\n")).not.toContain("hidden");
  });

  test("the mapped styles; other tags dropped, their text kept; attributes never read", () => {
    const source = '<b>b</b> <strong>s</strong> <i>i</i> <em>e</em> <del>d</del> <s>x</s> <span style="color:red">span</span> <a href="https://evil.example">anchor</a> <img src="x.png" alt="pic">';
    expect(text(source, 80)).toEqual(["b s i e d x span anchor"]);
    expect(spanOf(source, "b")).toMatchObject({ bold: true });
    expect(spanOf(source, "s")).toMatchObject({ bold: true });
    expect(spanOf(source, "i")).toMatchObject({ italic: true });
    expect(spanOf(source, "e")).toMatchObject({ italic: true });
    expect(spanOf(source, "d")).toMatchObject({ strike: true });
    expect(spanOf(source, "x")).toMatchObject({ strike: true });
    expect(spans(source).some((s) => s.link)).toBe(false);
  });

  test("`<sup>` and `<sub>` as Unicode digits where every character has one", () => {
    expect(text("x<sup>2</sup> H<sub>2</sub>O e<sup>x</sup> a<sub>ij</sub>")).toEqual(["x² H₂O ex aij"]);
  });

  test("a comment between two spaces leaves one space", () => {
    expect(text("a <!-- c --> b")).toEqual(["a b"]);
  });

  test("Details block: the summary a bold line, then the paragraph; no tag shown", () => {
    const source = "Before.\n\n<details>\n<summary>Click to expand</summary>\n\nHidden **Markdown** inside.\n\n</details>\n\nAfter.";
    const drawn = rows(source);
    expect(drawn.map(rowText)).toEqual(["Before.", "", "Click to expand", "", "Hidden Markdown inside.", "", "After."]);
    expect(drawn[2]!.spans).toEqual([{ text: "Click to expand", token: "text", bold: true }]);
  });

  test("an HTML block's text kept, whitespace collapsed, block tags breaking lines", () => {
    expect(text('<div align="center">\n  <strong>A centred block</strong>\n</div>')).toEqual(["A centred block"]);
    expect(text("<p>one</p><p>two</p>")).toEqual(["one", "two"]);
    expect(text("<!-- only a comment -->\n\nAfter.")).toEqual(["After."]);
  });
});

describe("Other extensions stay text", () => {
  test("Highlight syntax: `==marked==` reads as written; `^sup^`, `++ins++` and shortcodes too", () => {
    expect(text("==marked== x^2^ ++ins++ :smile: H~2~O", 80)).toEqual(["==marked== x^2^ ++ins++ :smile: H~2~O"]);
  });

  test("a definition list keeps each definition on its own row", () => {
    expect(text("Term\n: First.\n: Second.")).toEqual(["Term", ": First.", ": Second."]);
  });

  test("an abbreviation definition stays literal", () => {
    expect(text("*[HTML]: Hyper Text Markup Language")).toEqual(["*[HTML]: Hyper Text Markup Language"]);
  });

  test("wide characters and emoji intact; a word or URL longer than the width breaks at the width", () => {
    expect(text("日本語 😀 👨‍👩‍👧 🇬🇧")).toEqual(["日本語 😀 👨‍👩‍👧 🇬🇧"]);
    expect(text("abcdefghijklmnopqrstuvwxyz", 10)).toEqual(["abcdefghij", "klmnopqrst", "uvwxyz"]);
  });

  test("no row ends with a wide character at the full width (OpenTUI would lose the row below)", () => {
    expect(text("aaaaaaaaa日 b", 10)).toEqual(["aaaaaaaaa", "日 b"]);
    expect(text("aaaaaaaa日 b", 10)).toEqual(["aaaaaaaa", "日 b"]);
    expect(text("aaaaaaa日 b", 10)).toEqual(["aaaaaaa日", "b"]);
  });
});
