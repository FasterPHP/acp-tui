// The inline renderer (mvp-rendering task 4.2; spec tui-rendering "Inline text"): emphasis and
// its nesting, inline code, escapes, entities, soft and hard breaks.
import { describe, expect, test } from "bun:test";
import { DEFAULT_GLYPHS } from "../../../src/conversation/glyphs.ts";
import { MessageLayout } from "../../../src/conversation/markdown/layout.ts";
import { rowText, type Row, type Span } from "../../../src/conversation/markdown/types.ts";

const rows = (source: string, width = 98): Row[] => new MessageLayout(source, width, DEFAULT_GLYPHS).blocks().flatMap((b) => b.rows as Row[]);
const spans = (source: string, width = 98): Span[] => rows(source, width).flatMap((r) => r.spans as Span[]);
const spanOf = (source: string, text: string): Span | undefined => spans(source).find((s) => s.text.includes(text));

describe("Inline text", () => {
  test("Bold italic: `***both***` is drawn bold and italic", () => {
    for (const source of ["***both***", "___both___", "**_both_**", "*__both__*"]) {
      const s = spanOf(source, "both")!;
      expect(s.text).toBe("both");
      expect([s.bold, s.italic]).toEqual([true, true]);
    }
  });

  test("emphasis nests: bold with italic inside, italic with bold inside", () => {
    const source = "**bold *both* bold** and *italic **both** italic*";
    const parts = spans(source).map((s) => [s.text, !!s.bold, !!s.italic]);
    expect(parts).toEqual([
      ["bold ", true, false],
      ["both", true, true],
      [" bold", true, false],
      [" and ", false, false],
      ["italic ", false, true],
      ["both", true, true],
      [" italic", false, true],
    ]);
  });

  test("Entities and escapes: `A&nbsp;B &copy; \\*not italic\\*` reads `A B © *not italic*`, nothing italic", () => {
    const source = "A&nbsp;B &copy; \\*not italic\\*";
    expect(rows(source).map(rowText)).toEqual(["A B © *not italic*"]);
    expect(spans(source).some((s) => s.italic)).toBe(false);
  });

  test("entities: named, decimal and hexadecimal; unknown and control references kept as written", () => {
    expect(rows("&amp; &lt; &gt; &quot; &euro; &#169; &#x1F600; &bogus; &#27;").map(rowText)).toEqual(["& < > \" € © 😀 &bogus; &#27;"]);
  });

  test("a no-break space keeps its words on one row", () => {
    expect(rows("aaaa bbbb&nbsp;cccc", 10).map(rowText)).toEqual(["aaaa", "bbbb cccc"]);
  });

  test("inline code in markdown.code, one space of padding stripped each side, never decoded", () => {
    const s = spanOf("run `` `x` `` and ` &copy; ` now", "`x`")!;
    expect(s.text).toBe("`x`");
    expect(s.token).toBe("markdown.code");
    expect(spanOf("run `` `x` `` and ` &copy; ` now", "&copy;")!.text).toBe("&copy;");
  });

  test("Hard-wrapped source: a paragraph wrapped at 40 columns is re-wrapped to the pane", () => {
    const words = "The quick brown fox jumps over the lazy dog and keeps running across the field until the sun goes down behind the hills".split(" ");
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      if (line !== "" && line.length + 1 + word.length > 40) {
        lines.push(line);
        line = word;
      } else line = line === "" ? word : `${line} ${word}`;
    }
    lines.push(line);
    expect(lines.length).toBeGreaterThan(2);
    const drawn = rows(lines.join("\n"), 98).map(rowText);
    expect(drawn).toEqual([words.join(" ").slice(0, words.join(" ").lastIndexOf(" ", 98)), words.join(" ").slice(words.join(" ").lastIndexOf(" ", 98) + 1)]);
  });

  test("hard breaks: two trailing spaces, a backslash and `<br>` start a new row", () => {
    expect(rows("one  \ntwo\\\nthree<br>four").map(rowText)).toEqual(["one", "two", "three", "four"]);
  });

  test("`~~` strikes, a single tilde stays literal", () => {
    const struck = spanOf("~~gone~~ and H~2~O", "gone")!;
    expect([struck.text, struck.strike, struck.token]).toEqual(["gone", true, "markdown.strike"]);
    expect(rows("~~gone~~ and H~2~O").map(rowText)).toEqual(["gone and H~2~O"]);
    expect(spans("H~2~O").some((s) => s.strike)).toBe(false);
  });
});
