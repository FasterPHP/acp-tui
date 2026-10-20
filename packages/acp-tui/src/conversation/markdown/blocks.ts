// The block renderers (mvp-rendering design decision 1, task 4.1): one pure
// function per marked block token kind, from the token and a context (width,
// glyphs, the message's pre-pass, flags) to rows. `renderBlock` dispatches;
// `renderBlocks` lays out the blocks inside a container (a list item, a
// quote) with the blank rows between them.
//
// To add or replace a block kind, put its renderer in `BLOCK_RENDERERS`; the
// drawing (`draw.ts`, through OpenTUI's `renderNode`), the projection and the
// height estimate (`layout.ts`) all go through `renderBlock`.
import type { Token, Tokens } from "marked";
import type { TokenName } from "../../theme/index.ts";
import { renderCode } from "./code.ts";
import { nested, type MarkdownContext } from "./context.ts";
import { isFootnoteSection, renderFootnoteSection } from "./footnotes.ts";
import { applyTag, htmlParts, htmlState } from "./html.ts";
import { inlineLines, LineBuilder, STRIKE_TOKEN, textSpans } from "./inline.ts";
import { renderTable, tableProjection } from "./table.ts";
import { projectRows, type Row, type Span, type SpanStyle } from "./types.ts";
import { BLANK_ROW, decoration, prefixRows, wrapLines } from "./wrap.ts";
import { displayWidth } from "../../layout/segments.ts";

export type BlockRenderer = (token: Token, ctx: MarkdownContext) => Row[];

/** Rules are never wider than this (the projection lays a message out at a huge width). */
const MAX_RULE = 1000;

/** A rule of `glyph` across `width` columns. */
export function rule(glyph: string, width: number): string {
  return glyph.repeat(Math.max(0, Math.min(width, MAX_RULE)));
}

/** The token a heading of `level` is drawn in. */
export function headingToken(level: number): TokenName {
  return `markdown.heading.${Math.min(6, Math.max(1, level))}` as TokenName;
}

/** A paragraph (or a list item's bare text): its inline content wrapped to the width. */
function renderParagraph(token: Token, ctx: MarkdownContext): Row[] {
  const t = token as Tokens.Paragraph | Tokens.Text;
  if (isFootnoteSection(t, ctx)) return renderFootnoteSection(ctx);
  const tokens = t.tokens ?? [{ type: "text", raw: t.text, text: t.text } as Tokens.Text];
  return wrapLines(inlineLines(tokens, { token: ctx.textToken }, ctx), ctx.width);
}

/** A heading: its text in its level's token, with a rule below levels 1 and 2 (audit section 7). */
function renderHeading(token: Token, ctx: MarkdownContext): Row[] {
  const heading = token as Tokens.Heading;
  const style: SpanStyle = { token: headingToken(heading.depth) };
  const lines = inlineLines(heading.tokens, style, ctx);
  if (ctx.flags.headingMarkers && lines[0]) lines[0] = [decoration(`${"#".repeat(heading.depth)} `, { token: "muted" }), ...lines[0]];
  const rows = wrapLines(lines, ctx.width);
  if (heading.depth === 1) rows.push({ spans: [decoration(rule(ctx.glyphs.ruleHeavy, ctx.width), style)], decorative: true });
  if (heading.depth === 2) rows.push({ spans: [decoration(rule(ctx.glyphs.ruleLight, ctx.width), { token: "muted" })], decorative: true });
  return rows;
}

/** A thematic break: a rule across the width. */
function renderRule(_token: Token, ctx: MarkdownContext): Row[] {
  return [{ spans: [decoration(rule(ctx.glyphs.ruleLight, ctx.width), { token: "markdown.quote" })], decorative: true }];
}

/** GitHub alert kinds and their header words. */
const ALERTS: Readonly<Record<string, string>> = { note: "Note", tip: "Tip", important: "Important", warning: "Warning", caution: "Caution" };

/** The alert kind of a quote whose first line is `[!KIND]` alone, or null. */
export function alertKind(quote: Tokens.Blockquote): string | null {
  const first = quote.tokens[0];
  if (first?.type !== "paragraph") return null;
  const m = /^\[!([A-Za-z]+)\][ \t]*(?:\n|$)/.exec((first as Tokens.Paragraph).text);
  const kind = m?.[1]!.toLowerCase();
  return kind !== undefined && kind in ALERTS ? kind : null;
}

/** The token of an alert kind's bar and header word. */
export function alertToken(kind: string): TokenName {
  return `markdown.alert.${kind}` as TokenName;
}

/** A quote's tokens without an alert's marker line. */
function withoutAlertMarker(quote: Tokens.Blockquote): Token[] {
  const [first, ...rest] = quote.tokens as Token[];
  const para = first as Tokens.Paragraph;
  const text = para.text.replace(/^\[![A-Za-z]+\][ \t]*\n?/, "");
  if (text.trim() === "") return rest;
  // Drop the marker from the first text token, and the soft break after it.
  const tokens = [...para.tokens];
  const head = tokens[0];
  if (head?.type === "text") {
    const stripped = (head as Tokens.Text).text.replace(/^\[![A-Za-z]+\][ \t]*\n?/, "");
    if (stripped === "") tokens.shift();
    else tokens[0] = { ...(head as Tokens.Text), text: stripped, raw: stripped };
  }
  return [{ ...para, text, tokens }, ...rest];
}

/** A blockquote: one bar per level, the quoted text in `markdown.quote`; a GitHub alert has its
 *  bar and a header word in its kind's token, and no marker line. */
function renderQuote(token: Token, ctx: MarkdownContext): Row[] {
  const quote = token as Tokens.Blockquote;
  const kind = alertKind(quote);
  const barToken: TokenName = kind ? alertToken(kind) : "markdown.quote";
  const bar = decoration(`${ctx.glyphs.quoteBar} `, { token: barToken });
  const inner = nested(ctx, displayWidth(bar.text), { textToken: "markdown.quote" });
  const rows: Row[] = [];
  if (kind) rows.push({ spans: [{ token: barToken, bold: true, text: ALERTS[kind]! }] });
  rows.push(...renderBlocks(kind ? withoutAlertMarker(quote) : quote.tokens, inner));
  const blank = decoration(ctx.glyphs.quoteBar, { token: barToken });
  return prefixRows(rows.length > 0 ? rows : [BLANK_ROW], [bar], [bar], [blank]);
}

/** `n` in lower-case letters, bijective base 26 as CSS `lower-alpha`: 1 is `a`, 26 `z`, 27 `aa`,
 *  28 `ab`; null below 1, which has no letter. */
export function alphaLabel(n: number): string | null {
  if (!Number.isSafeInteger(n) || n < 1) return null;
  let out = "";
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) out = String.fromCharCode(97 + ((k - 1) % 26)) + out;
  return out;
}

/**
 * An ordered list's labels (review C2, Marcus, 9 October 2026): digits at odd nesting depths (the
 * outermost list is depth 1) and lower-case letters at even depths, every list counting from its
 * own start number, so a list starting at 7 reads `g.` at an even depth. A list starting at 0 or
 * below has no letter for its first item, so it keeps digits for every item at any depth: the
 * number written stays visible, and one list never mixes digits and letters.
 */
export function orderedLabels(start: number, count: number, listDepth: number): string[] {
  const letters = listDepth % 2 === 1 && start >= 1;
  return Array.from({ length: count }, (_, i) => (letters ? alphaLabel(start + i) : null) ?? String(start + i));
}

/** A list: markers by depth (unordered) or labels right-aligned (ordered: digits, or letters at
 *  even depths), task boxes, and the item's blocks aligned under its text. */
function renderList(token: Token, ctx: MarkdownContext): Row[] {
  const list = token as Tokens.List;
  const start = typeof list.start === "number" ? list.start : 1;
  // The delimiter as written (`1.` or `1)`): a list keeps one, since a change starts a new list.
  const delimiter = list.ordered && /^\s*\d+\)/.test(list.items[0]?.raw ?? "") ? ")" : ".";
  const markers = list.ordered
    ? orderedLabels(start, list.items.length, ctx.listDepth).map((label) => `${label}${delimiter}`)
    : list.items.map(() => ctx.glyphs.bullets[ctx.listDepth % ctx.glyphs.bullets.length]!);
  const markerWidth = Math.max(...markers.map(displayWidth));
  const rows: Row[] = [];
  list.items.forEach((item, i) => {
    if (i > 0 && list.loose) rows.push(BLANK_ROW);
    const marker = markers[i]!;
    const lead: Span[] = [{ token: "markdown.list", text: " ".repeat(markerWidth - displayWidth(marker)) + marker + " " }];
    if (item.task) lead.push({ token: item.checked ? "markdown.task.done" : "markdown.task.open", text: `${item.checked ? ctx.glyphs.taskDone : ctx.glyphs.taskOpen} ` });
    if (!list.ordered && item.task) lead.shift();
    const indent = lead.reduce((w, s) => w + displayWidth(s.text), 0);
    const inner = nested(ctx, indent, { listDepth: ctx.listDepth + 1 });
    const body = renderBlocks(item.tokens.filter((t) => t.type !== "checkbox"), inner);
    rows.push(...prefixRows(body.length > 0 ? body : [BLANK_ROW], lead, [{ token: ctx.textToken, text: " ".repeat(indent) }]));
  });
  return rows;
}

/** An HTML block: tags removed, text kept, the mapped styles (html.ts); nothing for a block
 *  that holds no text (a comment, a closing `</details>`). */
function renderHtml(token: Token, ctx: MarkdownContext): Row[] {
  const out = new LineBuilder();
  const state = htmlState();
  for (const part of htmlParts((token as Tokens.HTML).text)) {
    if (part.kind === "tag") {
      if (applyTag(state, part.tag, true) === "break" && !out.atLineStart) out.break();
      continue;
    }
    const text = state.pre > 0 ? part.text : part.text.replace(/\s+/g, " ");
    const style: SpanStyle = {
      token: state.code > 0 ? "markdown.code" : state.strike > 0 ? STRIKE_TOKEN : ctx.textToken,
      ...(state.bold > 0 ? { bold: true } : {}),
      ...(state.italic > 0 ? { italic: true } : {}),
      ...(state.strike > 0 ? { strike: true } : {}),
    };
    if (state.pre > 0) {
      text.split("\n").forEach((line, i) => {
        if (i > 0) out.break();
        textSpans(out, line, style, ctx, state);
      });
    } else {
      textSpans(out, out.atLineStart ? text.replace(/^ /, "") : text, style, ctx, state);
    }
  }
  const lines = out
    .done()
    .map((line) => trimLine(line))
    .filter((line) => line.length > 0);
  return wrapLines(lines, ctx.width);
}

/** A line without trailing spaces. */
function trimLine(line: readonly Span[]): Span[] {
  const out = [...line];
  while (out.length > 0) {
    const last = out[out.length - 1]!;
    const text = last.text.replace(/\s+$/, "");
    if (text === "" && last.projection === undefined) {
      out.pop();
      continue;
    }
    out[out.length - 1] = { ...last, text };
    break;
  }
  return out;
}

const nothing: BlockRenderer = () => [];

/** Renderers by marked token type; anything else is drawn as its source text. */
export const BLOCK_RENDERERS: Readonly<Record<string, BlockRenderer>> = {
  paragraph: renderParagraph,
  text: renderParagraph,
  heading: renderHeading,
  blockquote: renderQuote,
  list: renderList,
  table: (token, ctx) => renderTable(token as Tokens.Table, ctx),
  code: (token, ctx) => renderCode(token as Tokens.Code, ctx),
  html: renderHtml,
  hr: renderRule,
  // A link reference definition is used by its links and never drawn.
  def: nothing,
  space: nothing,
};

/** One block's rows. */
export function renderBlock(token: Token, ctx: MarkdownContext): Row[] {
  const renderer = BLOCK_RENDERERS[token.type];
  if (renderer) return renderer(token, ctx);
  return wrapLines(
    token.raw
      .replace(/\n+$/, "")
      .split("\n")
      .map((text) => [{ token: ctx.textToken, text }]),
    ctx.width,
  );
}

/** A block's projection (project.ts): its rows read in order; a table's own (table.ts). */
export function blockProjection(token: Token, rows: readonly Row[], ctx: MarkdownContext): string {
  return token.type === "table" ? tableProjection(token as Tokens.Table, ctx) : projectRows(rows);
}

/** Whether a block's spans carry their place in its projection (`Span.at`) instead of being read
 *  in order. */
export function positionedBlock(token: Token): boolean {
  return token.type === "table";
}

/** Blocks drawn apart from their neighbours by a blank row, even without a blank source line. */
const SET_APART = new Set(["code", "table", "hr", "heading"]);

/**
 * The blocks of a container (a list item, a quote) with the blank rows between them: one where
 * the source has a blank line, or next to a code block, table, rule or heading. Blocks that draw
 * nothing take no rows and no gap.
 */
export function renderBlocks(tokens: readonly Token[], ctx: MarkdownContext): Row[] {
  const rows: Row[] = [];
  let previous: Token | null = null;
  let blankLine = false;
  for (const token of tokens) {
    if (token.type === "space") {
      blankLine = true;
      continue;
    }
    const own = renderBlock(token, ctx);
    if (own.length === 0) {
      if (/\n[ \t]*\n\s*$/.test(token.raw)) blankLine = true;
      continue;
    }
    if (previous && (blankLine || SET_APART.has(previous.type) || SET_APART.has(token.type))) rows.push(BLANK_ROW);
    rows.push(...own);
    previous = token;
    blankLine = /\n[ \t]*\n\s*$/.test(token.raw);
  }
  return rows;
}
