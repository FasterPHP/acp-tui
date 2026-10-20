// The block renderer framework (mvp-rendering task 4.1, design decision 1): every token kind of
// the gallery rendered to rows by a pure function, without mounting anything; rows within the
// width, spans in theme tokens, no newline or control character in any span.
import { describe, expect, test } from "bun:test";
import type { Token } from "marked";
import { ASCII_GLYPHS, DEFAULT_GLYPHS } from "../../../src/conversation/glyphs.ts";
import { BLOCK_RENDERERS, renderBlock } from "../../../src/conversation/markdown/blocks.ts";
import { DEFAULT_FLAGS, type MarkdownContext } from "../../../src/conversation/markdown/context.ts";
import { lexMarkdown } from "../../../src/conversation/markdown/lex.ts";
import { MessageLayout, marginAt } from "../../../src/conversation/markdown/layout.ts";
import { prepass } from "../../../src/conversation/markdown/prepass.ts";
import { rowText, type Row } from "../../../src/conversation/markdown/types.ts";
import { displayWidth } from "../../../src/layout/segments.ts";
import { TOKENS } from "../../../src/theme/index.ts";
import { gallerySource } from "./golden.ts";

const KINDS = ["paragraph", "heading", "blockquote", "list", "table", "code", "html", "hr", "def"] as const;

function contextFor(source: string, width: number, glyphs = DEFAULT_GLYPHS): { ctx: MarkdownContext; tokens: Token[] } {
  const prepared = prepass(source);
  const ctx: MarkdownContext = { width, glyphs: glyphs.markdown, prepared, flags: DEFAULT_FLAGS, textToken: "text", listDepth: 0 };
  return { ctx, tokens: lexMarkdown(prepared.source) };
}

function checkRows(rows: readonly Row[], width: number): void {
  for (const row of rows) {
    // Rows are drawn unwrapped: none may be wider than the width (code blocks included).
    expect(displayWidth(rowText(row))).toBeLessThanOrEqual(width);
    for (const span of [...row.spans, ...(row.label ? [row.label] : [])]) {
      expect(span.token in TOKENS).toBe(true);
      if (span.fill) expect(span.fill in TOKENS).toBe(true);
      expect(span.text).not.toMatch(/[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/);
    }
  }
}

describe("block renderers (task 4.1)", () => {
  test("a renderer for every block kind the design names", () => {
    for (const kind of KINDS) expect(typeof BLOCK_RENDERERS[kind]).toBe("function");
  });

  test("every token kind of the gallery renders to rows without mounting, at 40, 63 and 100 columns", () => {
    const seen = new Set<string>();
    for (const width of [40, 63, 100]) {
      const { ctx, tokens } = contextFor(gallerySource(), width);
      for (const token of tokens) {
        seen.add(token.type);
        const rows = renderBlock(token, ctx);
        if (token.type === "def" || token.type === "space") expect(rows).toEqual([]);
        else if (token.type !== "html") expect(rows.length).toBeGreaterThan(0);
        checkRows(rows, width);
      }
    }
    for (const kind of KINDS) expect(seen.has(kind)).toBe(true);
  });

  test("the same function serves the height: a message's height is its blocks' rows and margins", () => {
    for (const width of [40, 63, 100]) {
      const layout = new MessageLayout(gallerySource(), width, DEFAULT_GLYPHS);
      const blocks = layout.blocks();
      expect(layout.height()).toBe(blocks.reduce((h, b) => h + b.marginTop + b.rows.length, 0));
      expect(blocks.map((b) => b.rows)).toEqual(blocks.map((b) => renderBlock(b.token, layout.ctx)));
    }
  });

  test("the ascii glyph set draws decoration in ASCII", () => {
    const { ctx, tokens } = contextFor("# Title\n\n- a\n  - b\n\n> q\n\n---\n", 20, ASCII_GLYPHS);
    const text = tokens.flatMap((t) => renderBlock(t, ctx)).map(rowText).join("\n");
    expect(text).toMatch(/^[\x20-\x7e\n]*$/);
    expect(text).toContain("====================");
    expect(text).toContain("* a");
    expect(text).toContain("o b");
  });

  test("narrow widths: every row within the width from 16 columns, and nothing throws below", () => {
    for (const width of [16, 20, 24]) {
      const { ctx, tokens } = contextFor(gallerySource(), width);
      for (const token of tokens) checkRows(renderBlock(token, ctx), width);
    }
    // Below that, list markers and quote bars alone may be wider than the pane.
    for (const width of [1, 2, 3, 5, 8]) {
      const { ctx, tokens } = contextFor(gallerySource(), width);
      for (const token of tokens) expect(() => renderBlock(token, ctx)).not.toThrow();
    }
  });
});

describe("blank rows between top-level blocks", () => {
  const margins = (source: string) => {
    const layout = new MessageLayout(source, 40, DEFAULT_GLYPHS);
    return layout.blocks().map((b) => [b.token.type, b.marginTop]);
  };

  test("OpenTUI's own: around headings, lists, code, tables, quotes and rules; between paragraphs with a blank line", () => {
    expect(margins("# H\npara\n- item\n\n```\nx\n```\n> q")).toEqual([
      ["heading", 0],
      ["paragraph", 1],
      ["list", 1],
      ["code", 1],
      ["blockquote", 1],
    ]);
    expect(margins("one\n\ntwo")).toEqual([
      ["paragraph", 0],
      ["paragraph", 1],
    ]);
  });

  test("a definition or comment between paragraphs keeps their blank row and adds none", () => {
    expect(margins("one [x]\n\n[x]: https://example.com\n\ntwo")).toEqual([
      ["paragraph", 0],
      ["def", 0],
      ["paragraph", 1],
    ]);
    expect(margins("one\n\n<!-- c -->\n\ntwo")).toEqual([
      ["paragraph", 0],
      ["html", 0],
      ["paragraph", 1],
    ]);
  });

  test("an HTML block with text after a paragraph is set apart like one", () => {
    expect(margins("para\n\n<details>\n<summary>S</summary>\n\nInner\n\n</details>")).toEqual([
      ["paragraph", 0],
      ["html", 1],
      ["paragraph", 1],
      ["html", 0],
    ]);
  });

  test("marginAt over any token list, as draw.ts computes it from OpenTUI's tokens", () => {
    const tokens = lexMarkdown("a\n\n[x]: u\n\nb");
    const nothing = (k: number) => tokens[k]!.type === "space" || tokens[k]!.type === "def";
    const last = tokens.length - 1;
    expect(marginAt(tokens, last, nothing)).toBe(1);
  });
});
