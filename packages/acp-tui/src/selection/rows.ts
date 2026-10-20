// Screen rows to projection offsets; design of record 6.3 "Selecting".
//
// The selection's ends are positions in each item's plain-text projection
// (projection.ts), but the pointer lands on screen cells. `itemRows` maps the
// rows of one mounted item, as drawn, to the projection: one `RowSpan` per
// drawn row that shows projection text, with the projection offset of the
// character in each cell (or -1 for decoration: gutters, the card's padding
// or rule, diff line numbers, header glyphs and columns). The highlight
// (select.tsx) paints the cells whose character lies in the selected range;
// a hit on a decoration cell or beside the text resolves to the nearest line
// start or end.
//
// How each kind is drawn (conversation/items.tsx), and so how it is mapped:
//
// - User message, error and notice markers: one OpenTUI text wrapped by
//   OpenTUI; its public `lineInfo` (visual line to logical line and display
//   columns) gives the rows, and the logical lines are the projection's.
// - Agent message (mvp-rendering): the Markdown renderable
//   (`internalBlockMode="top-level"`) has one child per top-level block, each
//   drawn by acp-tui's renderers from rows of spans (conversation/markdown/).
//   The rows say what each cell shows, so a child's cells map exactly onto its
//   block's text in the projection (`mapBlockRows`): quote bars, indents of
//   wrapped rows, borders and rules are decoration, and a wrapped line maps
//   row by row. Blank rows between blocks map onto the blank projection lines
//   between them.
// - Blank lines inside a selection (spec tui-selection "Blank line in a
//   selection"): a blank row's first cell maps to the newline of its blank
//   projection line, so the highlight shows it.
// - Tabs in text OpenTUI draws are 2 columns wide (`OPENTUI_TAB_COLUMNS`);
//   in cards acp-tui expands them itself to tab stops (`VIEWER_TEXT`).
// - Tool call, thought, plan: the header row maps the part of the header that
//   shows projection text (a tool's title, a thought's first line). An
//   expanded tool card or thought draws a layout (conversation/card.ts) whose
//   parts say what each row stands for: the wrapped title onto the title line,
//   Markdown blocks onto their text (`mapBlockRows`, as for agent messages),
//   a diff's path row onto the `+++` line and its numbered rows onto the
//   signed lines (the number column is decoration), a snippet's marker row
//   onto nothing. A plan's card is pre-wrapped by acp-tui itself (items.tsx
//   `Card`), so its rows are rebuilt here with the same functions.
// - Permission record: the title within its one-liner.
// - Turn end: nothing (its projection is empty).
//
// Everything is relative to the item's box (its screen `x` and `y` after
// layout, which include the scroll offset). Row maps depend on the item
// version, the width, the collapse state and the flat theme; select.tsx caches
// them on those.
import type { Renderable } from "@opentui/core";
import { MarkdownRenderable } from "@opentui/core";
import type { Item, PlanItem } from "acp-model";
import { drawnCard, type CardLayout, type CardPart } from "../conversation/card.ts";
import { VIEWER_TEXT, wrapLine, wrapWordsAt, type WordRow } from "../conversation/content.ts";
import { numberedDiff } from "../conversation/diff.ts";
import { planRows } from "../conversation/format.ts";
import type { ConversationGlyphs } from "../conversation/glyphs.ts";
import { positionedBlock } from "../conversation/markdown/blocks.ts";
import { cardPadding } from "../conversation/markdown/context.ts";
import { drawnBlock } from "../conversation/markdown/draw.ts";
import { mapBlockRows, type RowCells } from "../conversation/markdown/project.ts";
import { rowText, type Row } from "../conversation/markdown/types.ts";
import { displayWidth, type Segment } from "../layout/segments.ts";
import { lineStarts, type Projection, type ProjectionBlock } from "./projection.ts";

/** One drawn row of an item that shows projection text. */
export interface RowSpan {
  /** Row from the item's top. */
  readonly y: number;
  /** First mapped cell from the item's left. */
  readonly x: number;
  /** Per cell: the projection offset of the character drawn there, or -1 (decoration). */
  readonly from: Int32Array;
  /** Per cell: the offset just after that character (-1 for decoration). */
  readonly to: Int32Array;
  /** The position a pointer left of the text (or on leading decoration) resolves to. */
  readonly start: number;
  /** The position a pointer right of the text resolves to. */
  readonly end: number;
}

export interface ItemRows {
  /** Spans in row order (at most one per row). */
  readonly spans: readonly RowSpan[];
}

/** A character position under the pointer: `from` and `to` bound the character (equal between
 *  characters). */
export interface CellHit {
  readonly from: number;
  readonly to: number;
}

// -- Cell maps -------------------------------------------------------------------------------

const segmenter = new Intl.Segmenter();

/** Columns a tab takes in text OpenTUI draws (0.5.12's text buffers: always 2, not a tab stop). */
export const OPENTUI_TAB_COLUMNS = 2;

/** Per display column of `text` as drawn: the offsets (from `base`) of the character there.
 *  With `tabWidth`, tabs advance to the next multiple of it (as `expandTabs` draws them);
 *  without, a tab takes `OPENTUI_TAB_COLUMNS`, as OpenTUI draws it. */
export function cellMap(text: string, base: number, tabWidth: number | null = null): { from: number[]; to: number[] } {
  const from: number[] = [];
  const to: number[] = [];
  let at = 0;
  for (const { segment } of segmenter.segment(text)) {
    let width: number;
    if (segment === "\t") width = tabWidth === null ? OPENTUI_TAB_COLUMNS : tabWidth - (from.length % tabWidth);
    else width = displayWidth(segment);
    for (let k = 0; k < width; k++) {
      from.push(base + at);
      to.push(base + at + segment.length);
    }
    at += segment.length;
  }
  return { from, to };
}

function span(y: number, x: number, from: readonly number[], to: readonly number[], start: number, end: number): RowSpan {
  return { y, x, from: Int32Array.from(from), to: Int32Array.from(to), start, end };
}

/** The projection's lines with their start offsets. */
export class Lines {
  readonly lines: string[];
  readonly starts: number[];
  constructor(readonly projection: Projection) {
    this.lines = projection.text.split("\n");
    this.starts = lineStarts(projection.text);
  }
  text(line: number): string {
    return this.lines[line] ?? "";
  }
  start(line: number): number {
    return this.starts[Math.max(0, Math.min(this.starts.length - 1, line))] ?? 0;
  }
  end(line: number): number {
    return this.start(line) + this.text(line).length;
  }
  get count(): number {
    return this.lines.length;
  }
}

// -- Renderables -----------------------------------------------------------------------------

interface LineInfoLike {
  readonly lineStartCols: readonly number[];
  readonly lineWidthCols: readonly number[];
  readonly lineSources: readonly number[];
  readonly lineWraps: readonly number[];
}

type TextNode = Renderable & { readonly lineInfo: LineInfoLike; readonly plainText: string };

function isText(node: Renderable): node is TextNode {
  return "lineInfo" in node && typeof (node as { plainText?: unknown }).plainText === "string";
}

/** Text renderables under `node`, in tree order. */
export function textNodes(node: Renderable): TextNode[] {
  const out: TextNode[] = [];
  const walk = (r: Renderable) => {
    if (isText(r)) out.push(r);
    for (const child of r.getChildren() as Renderable[]) walk(child);
  };
  walk(node);
  return out;
}

function findMarkdown(node: Renderable): MarkdownRenderable | null {
  if (node instanceof MarkdownRenderable) return node;
  for (const child of node.getChildren() as Renderable[]) {
    const found = findMarkdown(child);
    if (found) return found;
  }
  return null;
}

/**
 * Spans for a text renderable wrapped by OpenTUI whose logical line `s` draws projection line
 * `base + s` exactly (display columns). `lineInfo.lineStartCols` are display offsets into the
 * whole text, so a visual line's column in its logical line is its start less the start of the
 * logical line's first visual line.
 */
function wrappedSpans(out: RowSpan[], item: Renderable, text: TextNode, lines: Lines, base: number, maxLine = Infinity): void {
  const info = text.lineInfo;
  const firstCol = new Map<number, number>();
  for (let v = 0; v < info.lineSources.length; v++) {
    const s = info.lineSources[v]!;
    if (!firstCol.has(s)) firstCol.set(s, info.lineStartCols[v]!);
  }
  const maps = new Map<number, { from: number[]; to: number[] }>();
  for (let v = 0; v < info.lineSources.length; v++) {
    const line = base + info.lineSources[v]!;
    if (line >= lines.count || line > maxLine) break;
    let map = maps.get(line);
    if (!map) {
      map = cellMap(lines.text(line), lines.start(line));
      maps.set(line, map);
    }
    const c0 = info.lineStartCols[v]! - firstCol.get(info.lineSources[v]!)!;
    const width = info.lineWidthCols[v]!;
    if (width === 0 && blankLine(lines, line)) {
      out.push(blankSpan(text.y - item.y + v, text.x - item.x, lines.start(line)));
      continue;
    }
    const from = map.from.slice(c0, c0 + width);
    const to = map.to.slice(c0, c0 + width);
    const start = from[0] ?? (c0 === 0 ? lines.start(line) : lines.end(line));
    const end = to.at(-1) ?? lines.end(line);
    out.push(span(text.y - item.y + v, text.x - item.x, from, to, start, end));
  }
}

/** Whether projection line `line` is blank and has a newline after it (one between others). */
function blankLine(lines: Lines, line: number): boolean {
  return line >= 0 && line < lines.count - 1 && lines.text(line) === "";
}

/** A blank row: its first cell stands for the newline of the blank line at `offset`. */
function blankSpan(y: number, x: number, offset: number): RowSpan {
  return span(y, x, [offset], [offset + 1], offset, offset);
}

// -- Agent messages --------------------------------------------------------------------------

/**
 * The spans of an agent message's Markdown renderable (see the module header): each child the
 * renderers drew (`drawnBlock`) is mapped cell for cell onto its block's text in the
 * projection, and the blank rows between children onto the blank lines between the blocks.
 */
function markdownSpans(out: RowSpan[], item: Renderable, markdown: Renderable, projection: Projection): void {
  let previousBottom = -1;
  let previousEnd = -1;
  for (const child of markdown.getChildren() as Renderable[]) {
    const drawn = drawnBlock(child);
    if (!drawn) continue;
    const block = projection.blocks.find((b) => b.token === drawn.index);
    if (!block) continue;
    const cells = mapBlockRows(drawn.rows, projection.text.slice(block.start, block.end), block.start, positionedBlock(drawn.token));
    if (!cells) continue;
    const top = child.y - item.y;
    const x = child.x - item.x;
    // The blank rows above this child, onto the blank lines before its text.
    if (previousBottom >= 0) {
      let offset = previousEnd + 1;
      for (let y = previousBottom; y < top && offset < block.start; y++, offset++) out.push(blankSpan(y, x, offset));
    }
    cells.forEach((row, r) => {
      if (!row) return;
      const y = top + r;
      if (row.blank) out.push(blankSpan(y, x, row.start));
      else out.push(span(y, x, row.from, row.to, row.start, row.end));
    });
    previousBottom = top + child.height;
    previousEnd = block.end;
  }
}

/** Where the longest prefix (at least one character) of `wanted` appears in `drawn`, searching
 *  from display column `after`; null when not even its first character does. */
export function locate(drawn: string, wanted: string, after = 0): { col: number; length: number } | null {
  if (wanted === "") return null;
  const graphemes = Array.from(segmenter.segment(drawn), (g) => g.segment);
  let startIndex = 0;
  for (let col = 0; startIndex < graphemes.length && col < after; startIndex++) col += displayWidth(graphemes[startIndex]!);
  const tail = graphemes.slice(startIndex).join("");
  const offset = drawn.length - tail.length;
  for (let n = wanted.length; n >= 1; n--) {
    const at = tail.indexOf(wanted.slice(0, n));
    if (at >= 0) return { col: displayWidth(drawn.slice(0, offset + at)), length: n };
  }
  return null;
}

/** A header row: `wanted` (a projection substring at `wantedAt`) located in the drawn header;
 *  every other cell is decoration. */
function headerSpan(item: Renderable, header: TextNode | undefined, wanted: string, wantedAt: number, start: number, end: number): RowSpan | null {
  if (!header) return null;
  const drawn = header.plainText.split("\n")[0] ?? "";
  const width = displayWidth(drawn);
  const from = new Array<number>(width).fill(-1);
  const to = new Array<number>(width).fill(-1);
  const found = locate(drawn, wanted);
  if (found) {
    const map = cellMap(wanted.slice(0, found.length), wantedAt);
    for (let k = 0; k < map.from.length && found.col + k < width; k++) {
      from[found.col + k] = map.from[k]!;
      to[found.col + k] = map.to[k]!;
    }
  }
  return span(header.y - item.y, header.x - item.x, from, to, start, end);
}

// -- Cards -----------------------------------------------------------------------------------

/** One logical line of an expanded card: its drawn segments and, per drawn column, the
 *  projection offsets; `start` and `end` for a pointer beside it. */
interface CardRow {
  readonly segments: readonly Segment[];
  readonly from: number[];
  readonly to: number[];
  readonly start: number;
  readonly end: number;
}

function decoration(width: number): { from: number[]; to: number[] } {
  return { from: new Array<number>(width).fill(-1), to: new Array<number>(width).fill(-1) };
}

function segmentsText(segments: readonly Segment[]): string {
  return segments.map((s) => s.text).join("");
}

// -- Tool cards and thoughts (conversation/card.ts) -------------------------------------------

type Cells = RowCells | null;

/** Cells of display rows that break `line` (its per-column offsets) at the column: one per row,
 *  each from the column of the line where it starts (as card.ts breaks them). */
function brokenCells(line: { from: number[]; to: number[]; start: number; end: number }, rows: readonly Row[]): Cells[] {
  let col = 0;
  return rows.map((row) => {
    const width = displayWidth(rowText(row));
    const from = line.from.slice(col, col + width);
    const to = line.to.slice(col, col + width);
    const firstChar = from.find((f) => f >= 0);
    const lastChar = [...to].reverse().find((t) => t >= 0);
    const cells: RowCells = { from, to, start: col === 0 ? line.start : (firstChar ?? line.end), end: lastChar ?? line.end, blank: false };
    col += width;
    return cells;
  });
}

function blankCells(offset: number): RowCells {
  return { from: [], to: [], start: offset, end: offset, blank: true };
}

/** The projection block of a tool's content block `content` (the first, for Markdown). */
function contentBlock(projection: Projection, content: number): ProjectionBlock | undefined {
  return projection.blocks.find((b) => b.content === content);
}

/** A diff part's cells: the path row stands for the `---` and `+++` lines and maps onto the `+++`
 *  path; numbered rows map onto the signed lines (the number column is decoration). */
function diffCells(part: Extract<CardPart, { kind: "diff" }>, projection: Projection, lines: Lines): Cells[] {
  const block = contentBlock(projection, part.content);
  const p = block ? lines.starts.indexOf(block.start) : -1;
  if (p < 0) return part.rows.map(() => null);
  const logical: { from: number[]; to: number[]; start: number; end: number }[] = [];
  const pathText = segmentsText(part.lines[0]?.segments ?? []);
  const plus = p + 1;
  const path = decoration(displayWidth(pathText));
  const pathMap = cellMap(part.block.path, lines.start(plus) + 4);
  for (let k = 0; k < Math.min(path.from.length, pathMap.from.length); k++) {
    path.from[k] = pathMap.from[k]!;
    path.to[k] = pathMap.to[k]!;
  }
  logical.push({ ...path, start: lines.start(p), end: lines.end(plus) });
  const rows = numberedDiff(part.block.oldText, part.block.newText);
  const width = String(Math.max(1, ...rows.map((r) => r.number ?? 0))).length;
  rows.forEach((row, i) => {
    const line = p + 2 + i;
    if (row.number === null) {
      logical.push({ ...cellMap(lines.text(line), lines.start(line), VIEWER_TEXT.tabWidth), start: lines.start(line), end: lines.end(line) });
      return;
    }
    // `NN ` (decoration), the sign, a space, then the text. The space is a zero-width cell at the
    // text's start: it adds no character, so a pointer on it resolves to the text's start, and a
    // highlight covers it only when the range runs across it (sign to text), leaving no hole in a
    // selected line.
    const from = new Array<number>(width + 1).fill(-1);
    const to = new Array<number>(width + 1).fill(-1);
    from.push(lines.start(line));
    to.push(lines.start(line) + 1);
    from.push(lines.start(line) + 1);
    to.push(lines.start(line) + 1);
    const text = cellMap(row.text, lines.start(line) + 1, VIEWER_TEXT.tabWidth);
    from.push(...text.from);
    to.push(...text.to);
    logical.push({ from, to, start: lines.start(line), end: lines.end(line) });
  });
  const out: Cells[] = [];
  part.pieces.forEach((piece, i) => {
    const line = logical[i];
    const own = part.rows.slice(piece.first, piece.first + piece.count);
    if (line) out.push(...brokenCells(line, own));
    else out.push(...own.map(() => null));
  });
  return out;
}

/** A Markdown part's cells: each block's rows mapped onto its text in the projection
 *  (`mapBlockRows`), the blank rows between blocks onto the blank lines between them. */
function markdownCells(part: Extract<CardPart, { kind: "markdown" }>, projection: Projection): Cells[] {
  const content = part.content ?? undefined;
  const out: Cells[] = [];
  let previousEnd = -1;
  for (const block of part.blocks) {
    const own = projection.blocks.find((b) => b.token === block.index && b.content === content);
    let offset = previousEnd + 1;
    for (let k = 0; k < block.marginTop; k++) out.push(own && previousEnd >= 0 && offset < own.start ? blankCells(offset++) : null);
    if (!own) {
      out.push(...block.rows.map(() => null));
      continue;
    }
    const cells = mapBlockRows(block.rows, projection.text.slice(own.start, own.end), own.start, positionedBlock(block.token));
    out.push(...(cells ?? block.rows.map(() => null)));
    previousEnd = own.end;
  }
  return out;
}

function partCells(part: CardPart, projection: Projection, lines: Lines): Cells[] {
  switch (part.kind) {
    case "pad":
      return part.rows.map(() => null);
    case "title": {
      const block = projection.blocks.find((b) => b.kind === "title");
      if (!block) return part.rows.map(() => null);
      return mapBlockRows(part.rows, projection.text.slice(block.start, block.end), block.start) ?? part.rows.map(() => null);
    }
    case "blank": {
      const block = contentBlock(projection, part.content);
      return [block ? blankCells(block.start - 1) : null];
    }
    case "empty": {
      const block = part.content === null ? undefined : contentBlock(projection, part.content);
      return [block ? blankCells(block.start) : null];
    }
    case "markdown":
      return markdownCells(part, projection);
    case "result":
    case "code": {
      // A command result's rows read in order give its block's text (card.ts `resultRows`).
      const kind = part.kind === "result" ? "result" : "return_code";
      const block = projection.blocks.find((b) => b.kind === kind && b.content === part.content);
      if (!block) return part.rows.map(() => null);
      return mapBlockRows(part.rows, projection.text.slice(block.start, block.end), block.start) ?? part.rows.map(() => null);
    }
    case "diff":
      return diffCells(part, projection, lines);
    case "notice": {
      const block = contentBlock(projection, part.content);
      if (!block) return part.rows.map(() => null);
      return brokenCells({ ...cellMap(part.text, block.start), start: block.start, end: block.end }, part.rows);
    }
    case "none":
      return part.rows.map((row) => ({ ...decoration(displayWidth(rowText(row))), start: projection.summaryEnd, end: projection.summaryEnd, blank: false }));
  }
}

/** Per drawn row of an expanded tool card or thought, its cells in the item's projection (null
 *  for the snippet's marker row and rows with nothing to select). */
export function cardCells(layout: CardLayout, projection: Projection): Cells[] {
  const lines = new Lines(projection);
  const parts: (Cells[] | undefined)[] = [];
  return layout.sources.map((source) => {
    if ("marker" in source) return null;
    let cells = parts[source.part];
    if (!cells) parts[source.part] = cells = partCells(layout.parts[source.part]!, projection, lines);
    return cells[source.row] ?? null;
  });
}

/** The columns left of a card's content: the flat theme's rule (when the card text starts with
 *  it) and the padding (`cards.padding.columns`). */
function cardPrefixWidth(card: TextNode, glyphs: ConversationGlyphs): number {
  return (card.plainText.startsWith(glyphs.cardRule) ? displayWidth(glyphs.cardRule) : 0) + cardPadding().columns;
}

/** Spans of an expanded tool card or thought drawn from its layout (card.ts `drawnCard`). */
function layoutCardSpans(out: RowSpan[], item: Renderable, card: TextNode, layout: CardLayout, projection: Projection, glyphs: ConversationGlyphs): void {
  const prefix = cardPrefixWidth(card, glyphs);
  const x = card.x - item.x + prefix;
  const top = card.y - item.y;
  cardCells(layout, projection).forEach((cells, r) => {
    if (!cells) return;
    if (cells.blank) out.push(blankSpan(top + r, x, cells.start));
    else out.push(span(top + r, x, cells.from, cells.to, cells.start, cells.end));
  });
}

/** A plan's card rows: `<glyph> <entry>` drawn, `- <entry>` projected. */
function planCardRows(item: PlanItem, lines: Lines, glyphs: ConversationGlyphs): CardRow[] {
  return planRows(item.entries, glyphs).map((segments, i) => {
    const glyph = displayWidth(segments[0]?.text ?? "");
    const from: number[] = [];
    const to: number[] = [];
    for (let k = 0; k < glyph; k++) {
      // The glyph stands for `-`, the space after it for the space.
      const col = k === glyph - 1 ? 1 : 0;
      from.push(lines.start(i) + col);
      to.push(lines.start(i) + col + 1);
    }
    const text = cellMap(lines.text(i).slice(2), lines.start(i) + 2);
    from.push(...text.from);
    to.push(...text.to);
    return { segments, from, to, start: lines.start(i), end: lines.end(i) };
  });
}

/** A card row's display rows as `Card` in items.tsx wraps them: at spaces with `words` (a
 *  thought), else at the column; each with the column of the row where it starts. */
function wrapCardRow(segments: readonly Segment[], inner: number, words: boolean): WordRow[] {
  if (segments.length === 0) return [{ segments: [], col: 0 }];
  if (words) return wrapWordsAt(segments, inner);
  let col = 0;
  return wrapLine(segments, inner).map((piece) => {
    const row = { segments: piece, col };
    col += displayWidth(segmentsText(piece));
    return row;
  });
}

/** Spans of an expanded card: its rows wrapped as `Card` in items.tsx wraps them. */
function cardSpans(out: RowSpan[], item: Renderable, card: TextNode, rows: readonly CardRow[], glyphs: ConversationGlyphs, lines: Lines, words = false): void {
  const prefix = cardPrefixWidth(card, glyphs);
  const inner = Math.max(1, card.width - prefix - cardPadding().columns);
  // Below the padding rows at the top of the card (`cards.padding.rows`).
  let y = card.y - item.y + cardPadding().rows;
  for (const row of rows) {
    for (const { segments: piece, col } of wrapCardRow(row.segments, inner, words)) {
      const width = displayWidth(segmentsText(piece));
      if (width === 0 && row.from.length === 0 && lines.projection.text[row.start] === "\n") {
        // A blank line of the card (between blocks, or in a thought): its newline.
        out.push(blankSpan(y, card.x - item.x + prefix, row.start));
        y += 1;
        continue;
      }
      const from = row.from.slice(col, col + width);
      const to = row.to.slice(col, col + width);
      const firstChar = from.find((f) => f >= 0);
      const lastChar = [...to].reverse().find((t) => t >= 0);
      out.push(span(y, card.x - item.x + prefix, from, to, col === 0 ? row.start : (firstChar ?? row.end), lastChar ?? row.end));
      y += 1;
    }
  }
}

// -- Items -----------------------------------------------------------------------------------

export interface RowOptions {
  readonly glyphs: ConversationGlyphs;
  /** Whether the item is drawn expanded (its card shown). */
  readonly expanded: boolean;
}

/** The row map of one mounted item, drawn at `node` (its `item:<id>` box). */
export function itemRows(item: Item, projection: Projection, node: Renderable, options: RowOptions): ItemRows {
  const lines = new Lines(projection);
  const out: RowSpan[] = [];
  const gutter = options.glyphs.gutterWidth;
  const texts = textNodes(node);
  // The header's text: on the item's first row, right of the gutter.
  const header = texts.find((t) => t.y === node.y && t.x - node.x >= gutter);
  // An expanded card's text: below the header.
  const card = texts.find((t) => t.y > node.y);
  switch (item.kind) {
    case "user_message": {
      const text = texts.find((t) => t.x - node.x >= 2 && t.plainText !== " ");
      if (text) wrappedSpans(out, node, text, lines, 0);
      break;
    }
    case "agent_message": {
      const markdown = findMarkdown(node);
      if (markdown) markdownSpans(out, node, markdown, projection);
      break;
    }
    case "marker": {
      if (item.markerKind === "turn_end") break;
      const text = texts.find((t) => t.x - node.x >= gutter);
      if (text) wrappedSpans(out, node, text, lines, 0);
      break;
    }
    case "tool_call": {
      const title = lines.text(0);
      const h = headerSpan(node, header, title, 0, 0, projection.summaryEnd);
      if (h) out.push(h);
      const drawn = options.expanded && card ? drawnCard(card) : undefined;
      if (drawn && card) layoutCardSpans(out, node, card, drawn, projection, options.glyphs);
      break;
    }
    case "thought": {
      const h = headerSpan(node, header, lines.text(0), 0, 0, projection.summaryEnd);
      if (h) out.push(h);
      const drawn = options.expanded && card ? drawnCard(card) : undefined;
      if (drawn && card) layoutCardSpans(out, node, card, drawn, projection, options.glyphs);
      break;
    }
    case "plan": {
      const h = headerSpan(node, header, "", 0, 0, projection.summaryEnd);
      if (h) out.push(h);
      if (options.expanded && card) cardSpans(out, node, card, planCardRows(item, lines, options.glyphs), options.glyphs, lines);
      break;
    }
    case "permission_record": {
      const at = projection.text.indexOf("): ") + 3;
      const h = headerSpan(node, header, projection.text.slice(at), at, 0, projection.text.length);
      if (h) out.push(h);
      break;
    }
  }
  out.sort((a, b) => a.y - b.y || a.x - b.x);
  return { spans: mergeRows(out) };
}

/** One span per row: spans on the same row (a list marker and its item's text) become one, with
 *  decoration between them; the pointer beside it resolves to the left one's start and the
 *  right one's end. `spans` is sorted by row, then column. */
function mergeRows(spans: RowSpan[]): RowSpan[] {
  const out: RowSpan[] = [];
  for (const s of spans) {
    const prev = out.at(-1);
    if (!prev || prev.y !== s.y) {
      out.push(s);
      continue;
    }
    const x = Math.min(prev.x, s.x);
    const width = Math.max(prev.x + prev.from.length, s.x + s.from.length) - x;
    const from = new Int32Array(width).fill(-1);
    const to = new Int32Array(width).fill(-1);
    for (const part of [prev, s]) {
      for (let c = 0; c < part.from.length; c++) {
        if (part.from[c]! < 0) continue;
        from[part.x - x + c] = part.from[c]!;
        to[part.x - x + c] = part.to[c]!;
      }
    }
    out[out.length - 1] = { y: s.y, x, from, to, start: prev.start, end: s.end };
  }
  return out;
}

/**
 * The position at cell (`x`, `y`) of an item (both relative to its box). Beside the text, or on
 * a row without text (a blank line inside the item), the nearest line start or end; on
 * decoration inside a row, the next character's start.
 */
export function hitRows(rows: ItemRows, x: number, y: number, textLength: number): CellHit {
  const spans = rows.spans;
  let at = -1;
  for (let i = 0; i < spans.length; i++) {
    if (spans[i]!.y === y) {
      at = i;
      break;
    }
    if (spans[i]!.y > y) {
      // Between rows: the start of the next text.
      const s = spans[i]!.start;
      return { from: s, to: s };
    }
  }
  if (at < 0) {
    const last = spans.at(-1);
    const e = last ? last.end : y < 0 ? 0 : textLength;
    return { from: e, to: e };
  }
  const s = spans[at]!;
  const k = x - s.x;
  if (k < 0) return { from: s.start, to: s.start };
  if (k >= s.from.length) return { from: s.end, to: s.end };
  if (s.from[k]! >= 0) return { from: s.from[k]!, to: s.to[k]! };
  for (let j = k + 1; j < s.from.length; j++) if (s.from[j]! >= 0) return { from: s.from[j]!, to: s.from[j]! };
  return { from: s.end, to: s.end };
}

