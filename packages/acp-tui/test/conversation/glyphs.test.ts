// Rendering glyphs (mvp-rendering task 11.2; spec tui-rendering "Rendering glyphs in both fonts").
// The font half of the check, `tools/glyph-check.py`, needs the fonts (JetBrains Mono from
// PhpStorm, Lilex from Zed) and runs by hand; its output is recorded in
// docs/mvp-notes/rendering-glyphs.md. This is the half that needs no font: every glyph of the
// `unicode` set has an ASCII form in the `ascii` set, of the same width, and Markdown drawn with
// the `ascii` set holds nothing but ASCII.
import { describe, expect, test } from "bun:test";
import { ASCII_GLYPHS, ASCII_MARKDOWN_GLYPHS, DEFAULT_GLYPHS, UNICODE_MARKDOWN_GLYPHS } from "../../src/conversation/glyphs.ts";
import { MessageLayout } from "../../src/conversation/markdown/layout.ts";
import { superscriptNumber } from "../../src/conversation/markdown/footnotes.ts";
import { scriptDigits } from "../../src/conversation/markdown/html.ts";
import { rowText } from "../../src/conversation/markdown/types.ts";
import { displayWidth } from "../../src/layout/segments.ts";

/** `path -> string` for every string leaf of a glyph set, like tools/glyph-check.py. */
function leaves(value: unknown, path = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof value === "string") out.set(path, value);
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) for (const [p, v] of leaves(child, path ? `${path}.${key}` : key)) out.set(p, v);
  }
  return out;
}

const ASCII_ONLY = /^[\x20-\x7e]*$/;

describe("Rendering glyphs", () => {
  const unicode = leaves(UNICODE_MARKDOWN_GLYPHS);
  const ascii = leaves(ASCII_MARKDOWN_GLYPHS);

  test("the ascii set has a form for every glyph of the unicode set", () => {
    expect([...ascii.keys()].sort()).toEqual([...unicode.keys()].sort());
    // Rules, bars, borders, bullets, task boxes, footnote digits, the continuation mark: all of them.
    for (const name of ["bullets.0", "taskDone", "ruleHeavy", "ruleLight", "quoteBar", "codeRule", "codeContinuation", "table.cross", "footnoteDigits.9", "superscriptDigits.2"]) {
      expect(ascii.has(name)).toBe(true);
    }
  });

  test("the ascii forms are ASCII, and no wider than the unicode glyphs they stand for", () => {
    for (const glyph of ascii.values()) expect(ASCII_ONLY.test(glyph)).toBe(true);
    for (const [name, glyph] of unicode) {
      // The ascii set brackets a footnote's number (`[1]`) where the unicode set has superscripts.
      if (/^footnote(Open|Close)$/.test(name)) continue;
      expect(displayWidth(ascii.get(name)!)).toBe(displayWidth(glyph));
    }
  });

  test("bullets: four levels, each set's forms distinct (review C1); `◦` is the accepted Lilex exception", () => {
    expect(UNICODE_MARKDOWN_GLYPHS.bullets).toEqual(["●", "○", "•", "◦"]);
    expect(ASCII_MARKDOWN_GLYPHS.bullets).toEqual(["*", "o", "+", "-"]);
    for (const set of [UNICODE_MARKDOWN_GLYPHS, ASCII_MARKDOWN_GLYPHS]) expect(new Set(set.bullets).size).toBe(set.bullets.length);
  });

  test("the ascii conversation set is complete: every glyph of it is ASCII, in the same places as the unicode set's", () => {
    expect(ASCII_GLYPHS.markdown).toBe(ASCII_MARKDOWN_GLYPHS);
    const unicodeLeaves = leaves(DEFAULT_GLYPHS);
    const asciiLeaves = leaves(ASCII_GLYPHS);
    expect([...asciiLeaves.keys()].sort()).toEqual([...unicodeLeaves.keys()].sort());
    for (const [name, glyph] of asciiLeaves) expect([name, ASCII_ONLY.test(glyph)]).toEqual([name, true]);
  });

  // mvp-chrome-and-keys task 10.3 (spec tui-layout "Conversation scrollbar", flat form).
  test("scroll bar glyphs: both names exist in every set and are one cell wide", () => {
    for (const set of [DEFAULT_GLYPHS, ASCII_GLYPHS]) {
      for (const name of ["track", "thumb"] as const) {
        expect(typeof set.scrollbar[name]).toBe("string");
        expect(displayWidth(set.scrollbar[name])).toBe(1);
      }
    }
    expect(DEFAULT_GLYPHS.scrollbar).toEqual({ track: "│", thumb: "█" });
    expect(ASCII_GLYPHS.scrollbar).toEqual({ track: "|", thumb: "#" });
    expect(ASCII_ONLY.test(ASCII_GLYPHS.scrollbar.track + ASCII_GLYPHS.scrollbar.thumb)).toBe(true);
  });

  test("footnote numbers and script digits follow the glyph set", () => {
    expect(superscriptNumber(12)).toBe("¹²");
    expect(superscriptNumber(12, ASCII_MARKDOWN_GLYPHS)).toBe("[12]");
    expect(scriptDigits("2", "sup")).toBe("²");
    expect(scriptDigits("2", "sub", ASCII_MARKDOWN_GLYPHS)).toBe("2");
  });

  test("Markdown drawn with the ascii set holds only ASCII glyphs", () => {
    const source = [
      "# One",
      "",
      "## Two",
      "",
      "- a",
      "  - b",
      "    - c",
      "- [x] done",
      "- [ ] open",
      "",
      "> quoted",
      "",
      "---",
      "",
      "| a | b |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "```ts",
      "const aVeryLongLineOfCode = someFunction(argumentNumberOne, argumentNumberTwo, argumentNumberThree);",
      "```",
      "",
      "Text[^1] with x<sup>2</sup>.",
      "",
      "[^1]: The note.",
    ].join("\n");
    const rows = new MessageLayout(source, 30, ASCII_GLYPHS, undefined, false).blocks().flatMap((b) => [...b.rows]);
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) {
      const text = rowText(row);
      expect(ASCII_ONLY.test(text)).toBe(true);
    }
    const text = rows.map(rowText).join("\n");
    expect(text).toContain("[1]");
    expect(text).toContain("\\");
  });
});
