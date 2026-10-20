// Expanded tool cards and thoughts as rows (mvp-rendering design decision 9,
// tasks 9.1 to 9.4; spec tui-rendering "Expanded tool card", "Output
// snippets", "Thoughts"). Pure: no OpenTUI, no Solid.
//
// A card is laid out at its inner width (the width less the gutter, the card's
// left padding or flat rule, and one column on the right) as rows of styled
// spans (markdown/types.ts), in parts that say what they stand for in the
// item's plain-text projection (selection/projection.ts), so the drawing
// (items.tsx), the height estimate (window/heights.ts) and the selection's row
// maps (selection/rows.ts) read one layout:
//
// - A tool call, between the padding rows at the top and the bottom
//   (`cards.padding.rows`, one by default; review C14): its full title (`toolTitle`, the command of an `execute` call,
//   S7 rendering issue 4), wrapped at spaces in `tool.title`, only when the
//   collapsed line truncated it (`toolTitleShown`, review C13); then each content
//   block, after a blank row when something comes before it: text rendered as Markdown by the agent message's
//   renderers (`MessageLayout`), so a text that is exactly one fence is that
//   code block with its label (S7 rendering issue 2); a diff as numbered
//   unified diff rows broken at the column (content.ts `diffCardLines`); the
//   `terminal` notice. Code blocks in a card take the card's fill
//   (`surface.card`) instead of `surface.code` (spec "Code blocks"); the
//   drawing highlights them as it does outside cards (markdown/highlight.ts).
// - A command result (command-result.ts, spec tui-rendering "Command results drawn"): a text
//   block that is Auggie's `launch-process` envelope or `claude-agent-acp`'s `Exit code <n>`
//   failure is drawn as `Output: <output>` (or `Output:` and each line indented two cells), then
//   `Return code: <code>`, labels in `tool.result.label`, values in `text`: a `result` part
//   (the output rows, cut to a snippet like a text block) and a `code` part (the return code
//   row, never cut). A call with no content shows its `rawOutputText` as its one text block
//   (`toolContent`).
// - Output snippets: a text block over `tool_output.snippet_rows` rows
//   (`snippetRows()`, 10 by default) shows its last rows
//   for an `execute` call (where errors and results are) and its first rows
//   otherwise, with one marker row in their place; `full` (the view model's
//   `outputShown`, toggled by `expandOutput` or a click on the marker) shows it
//   whole. Diffs are never cut.
// - A thought: its body as Markdown with plain text in the `thought` token,
//   every row dim (the thought's style), between the same padding rows.
// - The columns of padding (`cards.padding.columns`) are the drawing's: items.tsx puts them left
//   of every row and leaves them free on the right, and a card is laid out at the width inside
//   them. A code block in a card draws no pad of its own (`CodeOptions.inCard`).
//
// Layouts are cached per item object (items are immutable) and per inner width
// and snippet state, so a 5000-line output is laid out once per width.
import type { Token, Tokens } from "marked";
import type { ThoughtItem, ToolCallItem, ToolCallItemContent } from "acp-model";
import { displayWidth, truncateEnd } from "../layout/segments.ts";
import type { TokenName } from "../theme/index.ts";
import { commandResult, OUTPUT_INDENT, OUTPUT_LABEL, resultOutputLines, RETURN_CODE_LABEL, toolContent, type CommandResult } from "./command-result.ts";
import { diffCardLines, VIEWER_TEXT, wrapLine, type CardLine } from "./content.ts";
import { TERMINAL_UNAVAILABLE_NOTICE } from "./format.ts";
import type { ConversationGlyphs } from "./glyphs.ts";
import { glyphsKey, LIVE_GLYPHS } from "./live-glyphs.ts";
import { codeBreaking, planWordBreaks, renderCode } from "./markdown/code.ts";
import { cardPadding, renderSettingsKey, SNIPPET_ROWS, snippetRows, terminalFlags } from "./markdown/context.ts";
import { emojiSpans } from "./markdown/emoji.ts";
import { MessageLayout } from "./markdown/layout.ts";
import { singleFence } from "./markdown/project.ts";
import type { Row, Span } from "./markdown/types.ts";
import { BLANK_ROW, prefixRows, wrapLines, wrapSpans } from "./markdown/wrap.ts";

/** The fill behind a card, and behind the code blocks in it. */
export const CARD_FILL: TokenName = "surface.card";

/** Rows of a tool's text block shown before it is cut to a snippet, by default; the setting
 *  `tool_output.snippet_rows` (`snippetRows()`, markdown/context.ts) is what the cards use. */
export { SNIPPET_ROWS };

/** A top-level Markdown block of a part, with the rows it takes (its top margin as blank rows
 *  before them). */
export interface CardBlock {
  /** The token's index in the text's lex (the projection's `token`). */
  readonly index: number;
  readonly token: Token;
  readonly marginTop: number;
  readonly rows: readonly Row[];
}

/** One part of a card and what its rows stand for in the item's projection. */
export type CardPart =
  /** A padding row inside the card's top or bottom (review C14): decoration, never projected. */
  | { readonly kind: "pad"; readonly rows: readonly Row[] }
  /** The title line (the projection's first line), wrapped. */
  | { readonly kind: "title"; readonly text: string; readonly rows: readonly Row[] }
  /** The blank line before content block `content`: one row. */
  | { readonly kind: "blank"; readonly content: number; readonly rows: readonly Row[] }
  /** A text block rendered as Markdown (`content` null: a thought's body). */
  | { readonly kind: "markdown"; readonly content: number | null; readonly blocks: readonly CardBlock[]; readonly rows: readonly Row[] }
  /** A text block whose Markdown draws nothing: one empty row, the projection's empty line. */
  | { readonly kind: "empty"; readonly content: number | null; readonly rows: readonly Row[] }
  /** A command result's output rows (`Output:` and the output lines, command-result.ts), cuttable
   *  like a text block; there is none when the output is empty. */
  | { readonly kind: "result"; readonly content: number; readonly rows: readonly Row[] }
  /** A command result's `Return code: <code>` row: never cut. */
  | { readonly kind: "code"; readonly content: number; readonly rows: readonly Row[] }
  /** A diff block: logical lines broken at the column. */
  | {
      readonly kind: "diff";
      readonly content: number;
      readonly block: Extract<ToolCallItemContent, { type: "diff" }>;
      readonly lines: readonly CardLine[];
      /** Per logical line, its display rows' first index in `rows` and their count. */
      readonly pieces: readonly { readonly first: number; readonly count: number }[];
      readonly rows: readonly Row[];
    }
  /** The `terminal` notice, broken at the column. */
  | { readonly kind: "notice"; readonly content: number; readonly text: string; readonly rows: readonly Row[] }
  /** `(no content)`: decoration. */
  | { readonly kind: "none"; readonly rows: readonly Row[] };

/** Where a drawn row comes from: a row of a part, or the snippet's marker row. */
export type RowSource = { readonly part: number; readonly row: number } | { readonly marker: true };

export interface CardLayout {
  /** Every row drawn, in order; the marker row (`marker`) is a placeholder the drawing fills in. */
  readonly rows: readonly Row[];
  readonly parts: readonly CardPart[];
  /** Per drawn row, the part row it shows. */
  readonly sources: readonly RowSource[];
  /** The marker row's index in `rows`, or -1. */
  readonly marker: number;
  /** Rows the snippet hides (0 when shown in full or never cut). */
  readonly hidden: number;
  /** Whether some text block is longer than a snippet (so showing it in full changes the card). */
  readonly cuttable: boolean;
}

/** The word of the marker row a click is aimed at, underlined (review C18: "click here", so a
 *  click is not read as aimed anywhere in the card). */
export const MARKER_CLICK_WORD = "here";

/** The marker row's text: how many rows are hidden and how to show them (the key of
 *  `expandOutput` when one is bound, and a click). */
export function markerText(hidden: number, key: string | null): string {
  const rows = `${hidden} ${hidden === 1 ? "row" : "rows"} hidden`;
  const click = `click ${MARKER_CLICK_WORD} to show all`;
  return key ? `${rows} · ${key} or ${click}` : `${rows} · ${click}`;
}

/** The marker row's spans at `width` columns, muted decoration, with only the word `here`
 *  underlined (what is left of it when the row is cut). */
export function markerSpans(hidden: number, key: string | null, width: number): Span[] {
  const full = markerText(hidden, key);
  const shown = truncateEnd(full, width);
  const kept = shown === full ? shown : shown.slice(0, -1);
  const from = full.lastIndexOf(MARKER_CLICK_WORD);
  const to = Math.min(kept.length, from + MARKER_CLICK_WORD.length);
  if (to <= from) return [{ text: shown, token: "muted", projection: "" }];
  const spans: Span[] = [
    { text: shown.slice(0, from), token: "muted", projection: "" },
    { text: shown.slice(from, to), token: "muted", underline: true, projection: "" },
    { text: shown.slice(to), token: "muted", projection: "" },
  ];
  return spans.filter((span) => span.text !== "");
}

/** Rows dimmed (a thought's style). */
function dimmed(rows: readonly Row[]): Row[] {
  return rows.map((row) => ({ ...row, spans: row.spans.map((s) => ({ ...s, dim: true })) }));
}

/** A text laid out as Markdown at `width`: its blocks and all their rows, margins included. */
function markdownPart(text: string, width: number, glyphs: ConversationGlyphs, content: number | null, textToken: TokenName, dim: boolean): CardPart {
  const layout = new MessageLayout(text, width, glyphs, terminalFlags(), true, textToken);
  const blocks: CardBlock[] = [];
  const rows: Row[] = [];
  for (const block of layout.blocks()) {
    if (block.rows.length === 0) continue;
    // A code block takes the card's fill (spec "Code blocks": inside an expanded card, the card's
    // fill serves); the rows are otherwise the same as outside a card.
    let own = block.token.type === "code" ? renderCode(block.token as Tokens.Code, layout.ctx, { fill: CARD_FILL, inCard: true }) : [...block.rows];
    if (dim) own = dimmed(own);
    const marginTop = rows.length === 0 ? 0 : block.marginTop;
    for (let k = 0; k < marginTop; k++) rows.push(BLANK_ROW);
    rows.push(...own);
    blocks.push({ index: block.index, token: block.token, marginTop, rows: own });
  }
  if (rows.length === 0) return { kind: "empty", content, rows: [BLANK_ROW] };
  return { kind: "markdown", content, blocks, rows };
}

/** Logical card lines broken at the column (tool output, diffs: never at spaces). */
function columnRows(lines: readonly CardLine[], width: number): { rows: Row[]; pieces: { first: number; count: number }[] } {
  const rows: Row[] = [];
  const pieces: { first: number; count: number }[] = [];
  for (const line of lines) {
    const first = rows.length;
    const wrapped = line.segments.length === 0 ? [[]] : wrapLine(line.segments, width);
    for (const piece of wrapped) {
      const spans: Span[] = piece.map((s) => (line.fill ? { text: s.text, token: s.token, fill: line.fill } : { text: s.text, token: s.token }));
      rows.push(line.fill ? { spans, fill: line.fill } : { spans });
    }
    pieces.push({ first, count: rows.length - first });
  }
  return { rows, pieces };
}

/** A tool call's title line as the projection holds it: the title on one line, else its kind,
 *  else `tool` (selection/projection.ts `toolTitle`). */
export function cardTitle(item: ToolCallItem): string {
  const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
  return oneLine(item.title) || oneLine(item.toolKind ?? item.toolName ?? "") || "tool";
}

/** The full title wrapped at `width` in `tool.title`, emoji the terminal mis-measures drawn as
 *  their names (markdown/emoji.ts). */
function titleRows(text: string, width: number): Row[] {
  return wrapLines([emojiSpans(text, { token: "tool.title" }, terminalFlags().emoji)], width);
}

const RESULT_LABEL: TokenName = "tool.result.label";

/** `label value` word-wrapped at `width`, the label in `tool.result.label` and the value in
 *  `text`, continuation rows under the value's first column (decoration). */
function labelledRows(label: string, value: string, width: number): Row[] {
  const head = `${label} `;
  const room = Math.max(1, width - displayWidth(head));
  return prefixRows(
    wrapSpans([{ text: value, token: "text" }], room),
    [{ text: head, token: RESULT_LABEL }],
    [{ text: " ".repeat(displayWidth(head)), token: "text" }],
  );
}

/** A command result's rows at `width`: the output's (none when it is empty) and the return code's.
 *  Read in order they give `resultProjectionLines` (command-result.ts), which the projection
 *  holds. */
function resultRows(result: CommandResult, width: number): { output: Row[]; code: Row[] } {
  const lines = resultOutputLines(result.output);
  const output: Row[] = [];
  if (lines.length === 1) output.push(...labelledRows(OUTPUT_LABEL, lines[0]!, width));
  else if (lines.length > 1) {
    output.push({ spans: [{ text: OUTPUT_LABEL, token: RESULT_LABEL }] });
    const indent: Span = { text: " ".repeat(OUTPUT_INDENT), token: "text" };
    for (const line of lines) {
      if (line === "") output.push(BLANK_ROW);
      else output.push(...prefixRows(wrapSpans([{ text: line, token: "text" }], Math.max(1, width - OUTPUT_INDENT)), [indent], [indent]));
    }
  }
  return { output, code: labelledRows(RETURN_CODE_LABEL, String(result.code), width) };
}

/** The parts of a recognised command result in content block `content`. */
function resultParts(result: CommandResult, content: number, width: number): CardPart[] {
  const { output, code } = resultRows(result, width);
  const parts: CardPart[] = [];
  if (output.length > 0) parts.push({ kind: "result", content, rows: output });
  parts.push({ kind: "code", content, rows: code });
  return parts;
}

/** A padding row inside an expanded card's top and bottom (spec tui-rendering "Card padding";
 *  review C14): decoration, never projected. */
const PAD_ROW: Row = { spans: [], decorative: true };

/** The padding part at the top or the bottom of a card: `cards.padding.rows` blank rows, none when
 *  the setting is 0. */
function padParts(): CardPart[] {
  const rows = cardPadding().rows;
  return rows > 0 ? [{ kind: "pad", rows: Array.from({ length: rows }, () => PAD_ROW) }] : [];
}

/** The parts of a tool card at `width` (not yet cut to snippets): a padding row, the title when
 *  `title` (the collapsed line cut it), the content, a padding row. */
function toolParts(item: ToolCallItem, width: number, glyphs: ConversationGlyphs, title: boolean): CardPart[] {
  const parts: CardPart[] = [...padParts()];
  if (title) {
    const text = cardTitle(item);
    parts.push({ kind: "title", text, rows: titleRows(text, width) });
  }
  const blocks = toolContent(item);
  blocks.forEach((block, content) => {
    // The blank row between the title and the content, and between content blocks.
    if (title || content > 0) parts.push({ kind: "blank", content, rows: [BLANK_ROW] });
    switch (block.type) {
      case "text": {
        const result = commandResult(block.text, item.toolKind, item.toolStatus);
        if (result) parts.push(...resultParts(result, content, width));
        else parts.push(markdownPart(block.text, width, glyphs, content, "text", false));
        break;
      }
      case "diff": {
        const lines = diffCardLines(block.path, block.oldText, block.newText);
        const { rows, pieces } = columnRows(lines, width);
        parts.push({ kind: "diff", content, block, lines, pieces, rows });
        break;
      }
      case "terminal_unavailable": {
        const { rows } = columnRows([{ segments: [{ text: TERMINAL_UNAVAILABLE_NOTICE, token: "muted" }] }], width);
        parts.push({ kind: "notice", content, text: TERMINAL_UNAVAILABLE_NOTICE, rows });
        break;
      }
    }
  });
  if (blocks.length === 0) parts.push({ kind: "none", rows: [{ spans: [{ text: VIEWER_TEXT.noContent, token: "muted", projection: "" }] }] });
  parts.push(...padParts());
  return parts;
}

/** The marker row's placeholder (the drawing writes its text). */
const MARKER_ROW: Row = { spans: [], decorative: true };

/** Parts into drawn rows, cutting text blocks to snippets unless `full`. */
function assemble(parts: readonly CardPart[], full: boolean, tail: boolean): CardLayout {
  const rows: Row[] = [];
  const sources: RowSource[] = [];
  let marker = -1;
  let hidden = 0;
  let cuttable = false;
  const snippet = snippetRows();
  parts.forEach((part, p) => {
    const n = part.rows.length;
    const cut = ((part.kind === "markdown" && part.content !== null) || part.kind === "result") && n > snippet;
    if (cut) cuttable = true;
    if (!cut || full) {
      part.rows.forEach((row, r) => {
        rows.push(row);
        sources.push({ part: p, row: r });
      });
      return;
    }
    const from = tail ? n - snippet : 0;
    if (tail) {
      marker = rows.length;
      rows.push(MARKER_ROW);
      sources.push({ marker: true });
    }
    for (let r = from; r < from + snippet; r++) {
      rows.push(part.rows[r]!);
      sources.push({ part: p, row: r });
    }
    if (!tail) {
      marker = rows.length;
      rows.push(MARKER_ROW);
      sources.push({ marker: true });
    }
    hidden += n - snippet;
  });
  return { rows, parts, sources, marker, hidden, cuttable };
}

const toolLayouts = new WeakMap<ToolCallItem, Map<string, CardLayout>>();
const thoughtLayouts = new WeakMap<ThoughtItem, Map<string, CardLayout>>();
/** Layouts kept per item (widths and snippet states). */
const PER_ITEM = 4;

function cached<K extends object>(map: WeakMap<K, Map<string, CardLayout>>, item: K, key: string, build: () => CardLayout): CardLayout {
  let byKey = map.get(item);
  if (!byKey) map.set(item, (byKey = new Map()));
  let layout = byKey.get(key);
  if (!layout) {
    layout = build();
    if (byKey.size >= PER_ITEM) byKey.delete(byKey.keys().next().value!);
    byKey.set(key, layout);
  }
  return layout;
}

function layoutKey(width: number, full: boolean, glyphs: ConversationGlyphs, title: boolean): string {
  return `${width}|${full ? 1 : 0}|${glyphsKey(glyphs)}|${title ? "t" : ""}|${terminalFlags().emoji.join("+")}|${renderSettingsKey()}`;
}

/**
 * An expanded tool card's rows at `width` (its inner width): a padding row, the title when `title`
 * (the collapsed line truncated it: `toolTitleShown` at the line's width), then the content, with
 * text cut to a snippet (the tail for `execute`, the head otherwise) unless `full`, and a padding
 * row.
 */
export function toolCardLayout(item: ToolCallItem, width: number, full = false, glyphs: ConversationGlyphs = LIVE_GLYPHS, title = true): CardLayout {
  const w = Math.max(1, width);
  return cached(toolLayouts, item, layoutKey(w, full, glyphs, title), () =>
    assemble(toolParts(item, w, glyphs, title), full, item.toolKind === "execute"),
  );
}

/** An expanded thought's rows at `width` (its inner width): the body as Markdown, dim, plain text
 *  in `thought`. */
export function thoughtCardLayout(item: ThoughtItem, width: number, glyphs: ConversationGlyphs = LIVE_GLYPHS): CardLayout {
  const w = Math.max(1, width);
  return cached(thoughtLayouts, item, `${w}|${glyphsKey(glyphs)}|${terminalFlags().emoji.join("+")}|${renderSettingsKey()}`, () =>
    assemble([...padParts(), markdownPart(item.text, w, glyphs, null, "thought", true), ...padParts()], true, false),
  );
}

const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

/**
 * The rows a code block of `code` in `lang` takes at `width` (markdown/code.ts `codeRows`),
 * counted without building them, or null when a line is not printable ASCII (then only the rows
 * tell: wide characters and tabs move the breaks). A block in a card has no pad of its own (the
 * card's serves), so each line breaks in rows of `width - 1` columns, at spaces or at the column as
 * `markdown.code_wrap` says (`codeBreaking`, `planWordBreaks`: the drawing's plan; the continuation mark's
 * column); the label takes a row of its own when the first row would reach it.
 */
function codeRowCount(code: string, lang: string, width: number, glyphs: ConversationGlyphs): number | null {
  const room = Math.max(1, width - 1);
  const { words, mark } = codeBreaking(lang, terminalFlags().codeWrap);
  const markWidth = mark ? displayWidth(glyphs.markdown.codeContinuation) : 0;
  let rows = 0;
  let first = -1;
  for (const line of code.split("\n")) {
    if (!PRINTABLE_ASCII.test(line)) return null;
    // The row after which the first one ends: its cells, by the same plan the drawing follows.
    const plan = words && line.length > room ? planWordBreaks(Array.from(line, (ch) => ({ width: 1, space: ch === " ", tail: ch })), room) : null;
    const pieces = plan ? plan.length : Math.max(1, Math.ceil(line.length / room));
    if (first < 0) first = (plan ? plan[0]!.to - plan[0]!.from : Math.min(line.length, room)) + (pieces > 1 ? markWidth : 0);
    rows += pieces;
  }
  if (lang === "") return rows;
  if (!PRINTABLE_ASCII.test(lang)) return null;
  const label = Math.min(lang.length, Math.max(0, width - 2));
  return label > 0 && first + 1 + label > width ? rows + 1 : rows;
}

/** The rows a tool's text block takes at `width`, before any snippet: counted for a text that is
 *  exactly one fence of printable ASCII, else laid out. */
function textRowCount(text: string, width: number, glyphs: ConversationGlyphs): number {
  const fence = singleFence(text);
  const counted = fence ? codeRowCount(fence.code, fence.lang, width, glyphs) : null;
  return counted ?? markdownPart(text, width, glyphs, 0, "text", false).rows.length;
}

/**
 * The rows of `toolCardLayout(item, width, full, glyphs, title)`, without laying the card out when its text
 * blocks are single fences (the height estimate of every expanded card at a density switch:
 * window/heights.ts). A test holds it equal to the layout's row count.
 */
export function toolCardHeight(item: ToolCallItem, width: number, full = false, glyphs: ConversationGlyphs = LIVE_GLYPHS, title = true): number {
  const w = Math.max(1, width);
  const laidOut = toolLayouts.get(item)?.get(layoutKey(w, full, glyphs, title));
  if (laidOut) return laidOut.rows.length;
  let rows = 2 * cardPadding().rows + (title ? titleRows(cardTitle(item), w).length : 0);
  const blocks = toolContent(item);
  for (const [content, block] of blocks.entries()) {
    if (title || content > 0) rows += 1;
    switch (block.type) {
      case "text": {
        const result = commandResult(block.text, item.toolKind, item.toolStatus);
        if (result) {
          const { output, code } = resultRows(result, w);
          rows += (output.length > snippetRows() && !full ? snippetRows() + 1 : output.length) + code.length;
          break;
        }
        const n = textRowCount(block.text, w, glyphs);
        rows += n > snippetRows() && !full ? snippetRows() + 1 : n;
        break;
      }
      case "diff":
        rows += columnRows(diffCardLines(block.path, block.oldText, block.newText), w).rows.length;
        break;
      case "terminal_unavailable":
        rows += columnRows([{ segments: [{ text: TERMINAL_UNAVAILABLE_NOTICE, token: "muted" }] }], w).rows.length;
        break;
    }
  }
  return blocks.length === 0 ? rows + 1 : rows;
}

/** The layout a mounted card's text renderable draws (the selection's row maps read it,
 *  selection/rows.ts), set by items.tsx. */
const drawnCards = new WeakMap<object, CardLayout>();

export function setDrawnCard(renderable: object, layout: CardLayout): void {
  drawnCards.set(renderable, layout);
}

export function drawnCard(renderable: object): CardLayout | undefined {
  return drawnCards.get(renderable);
}

/** Where the marker row's `here` is drawn in a card's text renderable: its row and columns
 *  `[from, to)` (the hover mark, src/conversation/hover.tsx). */
export interface MarkerCells {
  readonly row: number;
  readonly from: number;
  readonly to: number;
}

/** The columns of the underlined `here` in a marker row's spans (what `markerSpans` underlines),
 *  or null when the row was cut before it. */
export function markerHere(spans: readonly Span[], row: number): MarkerCells | null {
  let col = 0;
  for (const span of spans) {
    const w = displayWidth(span.text);
    if (span.underline) return { row, from: col, to: col + w };
    col += w;
  }
  return null;
}

const drawnMarkers = new WeakMap<object, MarkerCells>();

export function setDrawnMarker(renderable: object, cells: MarkerCells | null): void {
  if (cells) drawnMarkers.set(renderable, cells);
  else drawnMarkers.delete(renderable);
}

export function drawnMarker(renderable: object): MarkerCells | undefined {
  return drawnMarkers.get(renderable);
}
