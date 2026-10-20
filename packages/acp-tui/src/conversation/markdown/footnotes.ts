// Footnotes (mvp-rendering task 7.3; spec tui-rendering "Footnotes"; audit
// section 8). The pre-pass (prepass.ts) has replaced each reference with a
// placeholder and moved each definition into a side table, ending the source
// with a `section` placeholder where the definitions are drawn.
//
// - A reference whose label has a definition is drawn as its number in
//   superscript digits (`¹`, `²`, `¹⁰`; `⁰` to `⁹` are in both fonts), in
//   `markdown.link` (inline.ts `footnoteRef`). A reference without one stays
//   literal (`[^x]`).
// - The number is the label's place among the labels in the order of their
//   first reference, named labels included, counting every referenced label,
//   defined or not. So a number is fixed when its reference first appears and
//   never changes while the message streams, whatever order the definitions
//   arrive in; the cost is a gap in the numbering where a reference never gets
//   a definition (`¹`, `[^x]`, `³`).
// - The definitions are drawn at the end under a short muted rule, by number,
//   each as its number (muted) then its text as inline Markdown; a definition
//   no reference names keeps its label as written (`[^label]:`, muted) and
//   follows the numbered ones, so its text is never lost.
//
// The numbers are text, so the projection (copy, find, export) holds them as
// drawn; the rule is decoration.
import type { Tokens } from "marked";
import type { MarkdownContext } from "./context.ts";
import { inlineLines } from "./inline.ts";
import { lexInline } from "./lex.ts";
import { splitPlaceholders, type FootnoteDefinition } from "./prepass.ts";
import type { MarkdownGlyphs, Row, Span } from "./types.ts";
import { decoration, prefixRows, wrapLines } from "./wrap.ts";
import { UNICODE_MARKDOWN_GLYPHS } from "../glyphs.ts";
import { displayWidth } from "../../layout/segments.ts";

/** The rule above the definitions, in columns. */
const RULE_WIDTH = 8;

/** `n` as the glyph set draws a footnote's number: superscript digits `⁰` to `⁹` in the `unicode`
 *  set (both in JetBrains Mono and Lilex, audit section 9), `[n]` in the `ascii` set. */
export function superscriptNumber(n: number, glyphs: MarkdownGlyphs = UNICODE_MARKDOWN_GLYPHS): string {
  let out = glyphs.footnoteOpen;
  for (const d of String(n)) out += glyphs.footnoteDigits[Number(d)]!;
  return out + glyphs.footnoteClose;
}

/** The number of the footnote with key `key`, or null when it has no definition or no reference. */
export function footnoteNumber(key: string, ctx: MarkdownContext): number | null {
  if (!ctx.prepared.definitions.has(key)) return null;
  const at = ctx.prepared.footnoteOrder.indexOf(key);
  return at < 0 ? null : at + 1;
}

/** Whether a paragraph is the pre-pass's footnote section placeholder alone. */
export function isFootnoteSection(token: Tokens.Paragraph | Tokens.Text, ctx: MarkdownContext): boolean {
  const parts = splitPlaceholders(token.text.trim(), ctx.prepared);
  return parts.length === 1 && typeof parts[0] !== "string" && parts[0]!.kind === "section";
}

/** The definitions in drawing order: by number (first reference), then the unreferenced ones as
 *  written. */
export function orderedDefinitions(ctx: MarkdownContext): FootnoteDefinition[] {
  const { definitions, footnoteOrder } = ctx.prepared;
  const out: FootnoteDefinition[] = [];
  for (const key of footnoteOrder) {
    const d = definitions.get(key);
    if (d) out.push(d);
  }
  for (const d of definitions.values()) if (!footnoteOrder.includes(d.key)) out.push(d);
  return out;
}

/** The footnote section's rows (see the module header). */
export function renderFootnoteSection(ctx: MarkdownContext): Row[] {
  const definitions = orderedDefinitions(ctx);
  if (definitions.length === 0) return [];
  const rows: Row[] = [{ spans: [decoration(ctx.glyphs.ruleLight.repeat(Math.min(RULE_WIDTH, ctx.width)), { token: "muted" })], decorative: true }];
  for (const d of definitions) {
    const n = footnoteNumber(d.key, ctx);
    const marker: Span = { token: "muted", text: n === null ? `[^${d.label}]: ` : `${superscriptNumber(n, ctx.glyphs)} ` };
    const indent = displayWidth(marker.text);
    const inner = { ...ctx, width: Math.max(1, ctx.width - indent) };
    const lines = inlineLines(lexInline(d.text), { token: ctx.textToken }, inner);
    rows.push(...prefixRows(wrapLines(lines, inner.width), [marker], [{ token: "muted", text: " ".repeat(indent) }]));
  }
  return rows;
}
