// Agent Markdown as copied plain text (spec tui-rendering "Projection follows the rendered
// text"): what acp-tui's renderers draw, without decoration, wrapped lines rejoined.
import { describe, expect, test } from "bun:test";
import { DEFAULT_GLYPHS } from "../../src/conversation/glyphs.ts";
import { MessageLayout } from "../../src/conversation/markdown/layout.ts";
import { mapBlockRows, projectMessage } from "../../src/conversation/markdown/project.ts";
import { markdownPlain, markdownProjection } from "../../src/selection/markdown-text.ts";

describe("inline text as drawn", () => {
  test("emphasis and strong markers dropped, nesting kept as text", () => {
    expect(markdownPlain("a **bold** and *em* and __strong__ and _em_ and ***both***")).toBe("a bold and em and strong and em and both");
  });

  test("code spans keep their text verbatim, markers inside included", () => {
    expect(markdownPlain("run `a *b* c` now")).toBe("run a *b* c now");
    expect(markdownPlain("``has ` inside``")).toBe("has ` inside");
    expect(markdownPlain("an `unclosed span")).toBe("an `unclosed span");
  });

  test("delimiters that do not flank text stay", () => {
    expect(markdownPlain("snake_case_name and a_b")).toBe("snake_case_name and a_b");
    expect(markdownPlain("2 * 3 = 6 and a lone *")).toBe("2 * 3 = 6 and a lone *");
    expect(markdownPlain("H~2~O and ~~gone~~")).toBe("H~2~O and gone");
  });

  test("entities decoded, escapes without their backslash", () => {
    expect(markdownPlain("a &lt;b&gt; &amp; &quot;c&quot; A&nbsp;B &copy;")).toBe('a <b> & "c" A B ©');
    expect(markdownPlain("\\*not em\\* and \\# not a heading")).toBe("*not em* and # not a heading");
  });

  test("a soft break is a space; a hard break a new line", () => {
    expect(markdownPlain("one\ntwo  \nthree\\\nfour")).toBe("one two\nthree\nfour");
  });

  test("images as their label; link titles never shown", () => {
    expect(markdownPlain('![a diagram](img.png "t") and [docs](https://example.com "Title")')).toBe("[image: a diagram] and docs (https://example.com)");
  });

  test("inline HTML: tags and comments gone, text kept", () => {
    expect(markdownPlain("press <kbd>Ctrl</kbd> <!-- hidden --> now")).toBe("press Ctrl now");
  });
});

describe("blocks as drawn", () => {
  test("headings without markers; rules left out", () => {
    expect(markdownPlain("# One\n\n## Two ##\n\nSetext\n---\n\n***\n\nAfter")).toBe("One\n\nTwo\n\nSetext\n\nAfter");
  });

  test("lists with their drawn markers, nesting indented, task boxes", () => {
    expect(markdownPlain("- a\n  - b\n    - c\n- [x] done\n- [ ] open")).toBe("● a\n  ○ b\n    • c\n[x] done\n[ ] open");
    expect(markdownPlain("7. seven\n8. eight\n9. nine\n10. ten")).toBe(" 7. seven\n 8. eight\n 9. nine\n10. ten");
  });

  test("quotes without bars or markers; an alert's header word kept", () => {
    expect(markdownPlain("> one\n>\n> > two")).toBe("one\n\ntwo");
    expect(markdownPlain("> [!WARNING]\n> Be careful.")).toBe("Warning\nBe careful.");
  });

  test("fenced code: the body only", () => {
    expect(markdownPlain("```ts\nconst a = `x`;\n\n  **b**\n```\n")).toBe("const a = `x`;\n\n  **b**");
    // Unclosed (still streaming): the rest is code.
    expect(markdownPlain("```\nline 1\nline 2")).toBe("line 1\nline 2");
    const p = markdownProjection("```php\nx\n```");
    expect(p.blocks[0]).toMatchObject({ kind: "code", lang: "php" });
  });

  test("footnotes as drawn: the reference's number, the definitions numbered at the end (task 7.3)", () => {
    expect(markdownPlain("a[^1] b\n\n[^1]: The note.\n\nAfter.")).toBe("a¹ b\n\nAfter.\n\n¹ The note.");
  });

  test("a definition or comment between paragraphs does not join them", () => {
    expect(markdownPlain("one [x]\n\n[x]: https://example.com\n\ntwo\n\n<!-- c -->\n\nthree")).toBe("one x (https://example.com)\n\ntwo\n\nthree");
  });
});

describe("width independence and cell maps", () => {
  const source = [
    "A paragraph long enough to wrap at a narrow width, with **bold** words and `code`, and a very-long-hyphenated-word.",
    "",
    "- an item that wraps onto more than one row at a narrow width",
    "  - nested",
    "",
    "> quoted text that also wraps when the pane is narrow",
    "",
    "```",
    "a code line that is longer than the narrow width, broken at the column",
    "```",
  ].join("\n");

  test("the projection does not depend on the width the rows were drawn at", () => {
    const whole = projectMessage(source, DEFAULT_GLYPHS);
    for (const width of [12, 20, 40, 63, 100]) {
      const layout = new MessageLayout(source, width, DEFAULT_GLYPHS);
      for (const block of layout.blocks()) {
        const projected = whole.blocks.find((b) => b.index === block.index);
        if (!projected) continue;
        const text = whole.text.slice(projected.start, projected.end);
        const cells = mapBlockRows(block.rows, text, projected.start);
        expect(cells).not.toBeNull();
        // Every mapped cell holds the character drawn there.
        block.rows.forEach((row, r) => {
          const map = cells![r];
          if (!map) return;
          let col = 0;
          for (const span of row.spans) {
            for (const ch of span.text) {
              const at = map.from[col]!;
              if (at >= 0 && span.projection === undefined) expect(whole.text.slice(at, map.to[col]!)).toBe(ch);
              col += Bun.stringWidth(ch);
            }
          }
        });
      }
    }
  });
});
