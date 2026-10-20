// Code blocks (fenced and indented), drawn as rows (mvp-rendering design
// decision 8, task 8.4; spec tui-rendering "Code blocks", "Diff fences").
//
// A block is drawn on its fill (`surface.code`, or the card's fill inside an
// expanded card) across the width it is given:
//
//   [pad][code, at most width - 2 * pad - 1 columns][mark or fill]   [label][pad]
//
// - Outside a card the block takes the cards' padding (`cards.padding`,
//   day-one-feedback): `columns` of fill on the left and the right, and
//   `rows` blank rows of fill at the top and the bottom (decorative, never
//   projected). Under the flat theme, which draws no fills, the first pad
//   column is the muted left rule instead (`Span.flatText`), on the padding
//   rows too, so the rows are the same either way and the theme never changes
//   a height. Inside an expanded card the block has no pad (`inCard`): the
//   card's padding serves.
// - A line longer than the room breaks at the column, with the glyph set's
//   continuation mark in the last column; the rows record the break, so the
//   projection rejoins the line. Tabs expand to stops every 8 columns and are
//   copied as tabs. An emoji the terminal mis-measures is drawn as its name,
//   muted and never highlighted, and copied as the emoji (emoji.ts, task 14.5).
// - The fence's language is a muted label at the right of the first row (the
//   top padding row when there is one), inset by the right pad, or on a row
//   of its own above the code when the first row would reach it.
//
// Colour: code is drawn in `code.default`. A `diff` or `patch` fence is
// coloured here by line role (added, removed, hunk, file header). A block in a
// language with a bundled grammar gets `Span.code` on its code spans, and the
// highlighter (highlight.ts) recolours those spans with `code.*` tokens when
// the tree-sitter worker answers, without touching the rows: a highlight that
// arrives after the first frame never changes the height.
import type { Tokens } from "marked";
import { displayWidth } from "../../layout/segments.ts";
import { emojiSubstitute, mayHoldEmoji, type EmojiClass } from "../../render/emoji/emoji.ts";
import type { TokenName } from "../../theme/index.ts";
import { DEFAULT_FLAGS, type CodeWrap, type MarkdownContext, type MarkdownFlags } from "./context.ts";
import { EMOJI_NAME_TOKEN, nameSpan } from "./emoji.ts";
import { codeFiletype } from "./filetype.ts";
import { restoreSource } from "./prepass.ts";
import type { CodeSource, MarkdownGlyphs, Row, Span } from "./types.ts";
import { fitsRow } from "./wrap.ts";

/** Tab stops in code blocks (spec tui-rendering "Code blocks"). */
export const CODE_TAB_WIDTH = 8;

/** The fill behind a code block outside cards. */
export const CODE_FILL: TokenName = "surface.code";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** A grapheme of a code line as drawn: a tab is the spaces to the next stop, copied as a tab; an
 *  emoji the terminal mis-measures is its name (`source` the emoji; emoji.ts, task 14.5). */
interface Cell {
  readonly text: string;
  readonly tab: boolean;
  /** UTF-16 length in the source (a tab's is 1). */
  readonly length: number;
  /** The emoji a name stands for. */
  readonly source?: string;
}

/** `line` as drawn graphemes, tabs expanded to stops every `tabWidth` columns, the emoji in
 *  `named` classes as their names. */
function codeCells(line: string, tabWidth: number, named: readonly EmojiClass[] = []): Cell[] {
  const out: Cell[] = [];
  let col = 0;
  const check = named.length > 0 && mayHoldEmoji(line);
  for (const { segment } of graphemes.segment(line)) {
    if (segment === "\t") {
      const n = tabWidth - (col % tabWidth);
      out.push({ text: " ".repeat(n), tab: true, length: 1 });
      col += n;
      continue;
    }
    const name = check ? emojiSubstitute(segment, named) : null;
    if (name !== null) {
      out.push({ text: name, tab: false, length: segment.length, source: segment });
      col += displayWidth(name);
    } else {
      out.push({ text: segment, tab: false, length: segment.length });
      col += displayWidth(segment);
    }
  }
  return out;
}

/** `line` with tabs expanded to stops every `tabWidth` columns. */
export function expandCodeTabs(line: string, tabWidth = CODE_TAB_WIDTH): string {
  return codeCells(line, tabWidth)
    .map((c) => c.text)
    .join("");
}

/** One row piece of a broken line: its spans, whether the line goes on in the next row, and what
 *  the projection puts before it when it is not the line's first (the spaces a word break
 *  consumed; "" for a break at the column). */
interface Piece {
  readonly spans: Span[];
  readonly broken: boolean;
  readonly joined: string;
}

// -- Where a line breaks (day-one-feedback; spec tui-rendering "Code blocks") ---------------------

/** The languages of prose fences: text a reader reads, where a continuation mark would read as
 *  part of it and a break inside a word is wrong. */
const PROSE_LANGS = new Set(["text", "txt", "plaintext", "plain", "markdown", "md"]);

/** Whether a fence's language word names prose (any case). */
export function isProseLang(lang: string): boolean {
  return PROSE_LANGS.has(lang.toLowerCase());
}

/** What the planner needs of a drawn cell. */
export interface BreakCell {
  readonly width: number;
  /** A plain space: the only place a line breaks at a space (a tab is a cell like any other). */
  readonly space: boolean;
  /** The cell's text, for the rule that no row ends with a wide character at its full width. */
  readonly tail: string;
}

/** A row of a planned line: its cells `[from, to)`, and where the next row starts (`next - to`
 *  cells are spaces the break consumed; `next === to` for a break at the column). */
export interface RowPlan {
  readonly from: number;
  readonly to: number;
  readonly next: number;
}

/**
 * Rows for a line of `cells` in rows of `room` columns, breaking at the last space that fits
 * (the whole run of spaces is consumed and recorded by the next row's `joined`), and at the column
 * where a row has no space to break at: a word longer than a row, or only indentation before it.
 * A run of spaces that ends the line is no place to break. At least one row. One function serves
 * the drawing (`breakWords`) and the height estimate (card.ts `codeRowCount`), so they agree.
 */
export function planWordBreaks(cells: readonly BreakCell[], room: number): RowPlan[] {
  const n = cells.length;
  const plans: RowPlan[] = [];
  let start = 0;
  for (;;) {
    let used = 0;
    let k = start;
    for (; k < n; k++) {
      const cell = cells[k]!;
      if (used > 0 && !fitsRow(used, cell.width, cell.tail, room)) break;
      used += cell.width;
    }
    if (k >= n) {
      plans.push({ from: start, to: n, next: n });
      return plans;
    }
    // The row overflows at cell `k`: the last run of spaces that starts at or before it, after a
    // word of this row and before another word.
    let broke = false;
    for (let s = k; s > start; s--) {
      if (!cells[s]!.space || cells[s - 1]!.space) continue;
      let e = s;
      while (e < n && cells[e]!.space) e++;
      if (e >= n) continue;
      plans.push({ from: start, to: s, next: e });
      start = e;
      broke = true;
      break;
    }
    if (!broke) {
      plans.push({ from: start, to: k, next: k });
      start = k;
    }
  }
}

/** How a line's text spans are styled: the token, the fill, and the highlightable source with the
 *  line's offset in it. */
interface LineStyle {
  readonly token: TokenName;
  readonly fill: TokenName | undefined;
  readonly source: CodeSource | undefined;
  readonly at: number;
  /** The emoji classes drawn as names. */
  readonly named?: readonly EmojiClass[];
}

/** One source line as spans broken into pieces of at most `width` columns (at least one piece):
 *  a tab's spaces project as the tab. */
function breakLine(line: string, width: number, tabWidth: number, style: LineStyle, words = false): Piece[] {
  const cells = codeCells(line, tabWidth, style.named);
  return words ? breakWords(cells, width, style) : breakCells(cells, width, style);
}

/** `cells` broken at spaces (`planWordBreaks`): each planned row is laid out like a line that fits,
 *  and the spaces a break consumes are the next row's `joined`. An emoji name longer than a row
 *  cannot be placed by a plan: the line then breaks at the column throughout. */
function breakWords(cells: readonly Cell[], width: number, style: LineStyle): Piece[] {
  const w = Math.max(1, width);
  if (cells.some((c) => c.source !== undefined && displayWidth(c.text) > w)) return breakCells(cells, w, style);
  const plan = planWordBreaks(
    cells.map((c) => ({ width: displayWidth(c.text), space: c.text === " " && !c.tab && c.source === undefined, tail: c.text })),
    w,
  );
  const starts: number[] = [];
  let offset = style.at;
  for (const cell of cells) {
    starts.push(offset);
    offset += cell.length;
  }
  starts.push(offset);
  const pieces: Piece[] = [];
  plan.forEach((row, i) => {
    const before = plan[i - 1];
    const joined = before ? cells.slice(before.to, before.next).map((c) => c.text).join("") : "";
    const inner = breakCells(cells.slice(row.from, row.to), w, { ...style, at: starts[row.from]! });
    inner.forEach((piece, j) => {
      const last = i === plan.length - 1 && j === inner.length - 1;
      pieces.push({ spans: piece.spans, broken: !last, joined: j === 0 ? joined : "" });
    });
  });
  return pieces;
}

/** `cells` broken at the column into pieces of at most `width` columns (at least one piece). */
function breakCells(cells: readonly Cell[], width: number, style: LineStyle): Piece[] {
  const w = Math.max(1, width);
  const pieces: Piece[] = [];
  const fill = style.fill === undefined ? {} : { fill: style.fill };
  let spans: Span[] = [];
  let text = "";
  let textAt = style.at;
  let at = style.at;
  let used = 0;
  const flush = () => {
    if (text !== "") spans.push({ token: style.token, ...fill, text, ...(style.source ? { code: { source: style.source, at: textAt } } : {}) });
    text = "";
    textAt = at;
  };
  for (const cell of cells) {
    if (cell.source !== undefined) {
      // An emoji's name, muted on the line's fill: broken at the column like the code around it,
      // its first piece projecting the emoji and the others nothing.
      flush();
      let piece = null as Span | null;
      let first = true;
      for (const ch of cell.text) {
        if (used > 0 && !fitsRow(used, 1, ch, w)) {
          if (piece) spans.push(piece);
          piece = null;
          pieces.push({ spans, broken: true, joined: "" });
          spans = [];
          used = 0;
        }
        if (piece) piece = { ...piece, text: piece.text + ch };
        else piece = nameSpan(ch, first ? cell.source : "", { token: EMOJI_NAME_TOKEN, ...fill });
        first = false;
        used += 1;
      }
      if (piece) spans.push(piece);
      at += cell.length;
      textAt = at;
      continue;
    }
    const cw = displayWidth(cell.text);
    // No wide character at a row's full width (wrap.ts `endsWide`).
    if (used > 0 && !fitsRow(used, cw, cell.text, w)) {
      flush();
      pieces.push({ spans, broken: true, joined: "" });
      spans = [];
      used = 0;
    }
    if (cell.tab) {
      flush();
      spans.push({ token: style.token, ...fill, text: cell.text, projection: "\t" });
      at += cell.length;
      textAt = at;
    } else {
      if (text === "") textAt = at;
      text += cell.text;
      at += cell.length;
    }
    used += cw;
  }
  flush();
  pieces.push({ spans, broken: false, joined: "" });
  return pieces;
}

/** One source line broken into pieces of at most `width` columns (at least one piece). */
export function breakAt(line: string, width: number): string[] {
  return breakLine(line, width, CODE_TAB_WIDTH, { token: "code.default", fill: undefined, source: undefined, at: 0 }).map((p) => p.spans.map((s) => s.text).join(""));
}

/** The code's text as the agent wrote it (pre-pass placeholders restored), without the final
 *  newline. */
export function codeText(token: Tokens.Code, ctx: MarkdownContext): string {
  return restoreSource(token.text, ctx.prepared).replace(/\n$/, "");
}

/** A fence's language: the first word of its info string (pre-pass placeholders restored), or
 *  "" (an indented block, or a fence without one). */
export function codeLang(token: Tokens.Code, ctx: MarkdownContext): string {
  const info = token.lang ? restoreSource(token.lang, ctx.prepared) : "";
  return info.trim().split(/\s+/)[0] ?? "";
}

/** Whether a fence's language is coloured by line role (spec "Diff fences"). */
export function isDiffLang(lang: string): boolean {
  const l = lang.toLowerCase();
  return l === "diff" || l === "patch";
}

const DIFF_HEADER = /^(?:diff |index |new file mode|deleted file mode|old mode|new mode|similarity index|dissimilarity index|rename from|rename to|copy from|copy to|Binary files|\\ )/;

/** The token of each line of a diff, by its role: hunk headers `diff.hunk`, added and removed
 *  lines `diff.add` and `diff.remove`, file headers (`---` and `+++` pairs, git's header lines)
 *  and "\ No newline" muted, context and anything else `code.default`. */
export function diffLineTokens(lines: readonly string[]): TokenName[] {
  return lines.map((line, i) => {
    if (line.startsWith("@@")) return "diff.hunk";
    if (line.startsWith("--- ") && lines[i + 1]?.startsWith("+++ ")) return "muted";
    if (line.startsWith("+++ ") && lines[i - 1]?.startsWith("--- ")) return "muted";
    if (line.startsWith("+")) return "diff.add";
    if (line.startsWith("-")) return "diff.remove";
    if (DIFF_HEADER.test(line)) return "muted";
    return "code.default";
  });
}

/** How a code block is drawn besides its text. */
export interface CodeOptions {
  /**
   * The fill behind the block: `surface.code` (the default), or the card's own fill for a block
   * inside an expanded card (`surface.card`; spec "Code blocks": "Inside an expanded card, the
   * card's fill SHALL serve").
   */
  readonly fill?: TokenName;
  /**
   * The block is inside an expanded card (day-one-feedback, spec tui-rendering "Code blocks"): the
   * card's padding serves, so the block draws no pad on the left and no flat code rule (under the
   * flat theme the card's own rule serves), and its code starts in the column prose does. The
   * continuation mark and the label keep the block's last column.
   */
  readonly inCard?: boolean;
}

/** What a code block's rows need besides the code: the width, the glyphs, and the emoji classes
 *  drawn as names (none when absent). */
export interface CodeLayout {
  readonly width: number;
  readonly glyphs: MarkdownGlyphs;
  readonly flags?: Partial<Pick<MarkdownFlags, "emoji" | "codeWrap" | "codePadding">>;
}

/**
 * How a fence breaks its long lines (`markdown.code_wrap`): whether at spaces (`words`) and
 * whether a broken row ends with the continuation mark (`mark`). A prose fence broken at spaces
 * draws no mark: it would read as part of the text; under `column` every fence breaks at the
 * column and draws it, as before.
 */
export function codeBreaking(lang: string, wrap: CodeWrap = "word"): { readonly words: boolean; readonly mark: boolean } {
  const prose = isProseLang(lang);
  const words = wrap === "word" || (wrap === "prose" && prose);
  return { words, mark: !(prose && words) };
}

/** `label` cut to at most `max` columns. */
function fitLabel(label: string, max: number): string {
  if (displayWidth(label) <= max) return label;
  let out = "";
  for (const { segment } of graphemes.segment(label)) {
    if (displayWidth(out + segment) > max) break;
    out += segment;
  }
  return out;
}

/**
 * A code block's rows (see the module header): `text` is the code as written (no final newline),
 * `lang` the fence's language word ("" for none). Pure: the same rows serve the drawing, the
 * projection (the code, tabs and all) and the height estimate.
 */
export function codeRows(text: string, lang: string, layout: CodeLayout, options: CodeOptions = {}): Row[] {
  const width = Math.max(1, layout.width);
  const fill = options.fill ?? CODE_FILL;
  // Outside a card, the cards' padding (day-one-feedback, Marcus 15 October 2026): `columns` of
  // fill at the left (the first of them the flat theme's rule) and at the right, and `rows` blank
  // rows of fill at the top and the bottom. Inside a card none: the card pads the block.
  const padding = options.inCard ? { rows: 0, columns: 0 } : (layout.flags?.codePadding ?? DEFAULT_FLAGS.codePadding);
  const columns = Math.max(0, Math.min(padding.columns, Math.floor((width - 2) / 2)));
  // The padding takes its columns on both sides, and the continuation mark's column is kept free.
  const room = Math.max(1, width - 2 * columns - 1);
  const pad = (): Span[] =>
    columns === 0
      ? []
      : [
          { token: "muted", fill, text: " ", flatText: layout.glyphs.codeRule, projection: "" },
          ...(columns > 1 ? [{ token: "muted" as TokenName, fill, text: " ".repeat(columns - 1), projection: "" }] : []),
        ];
  const mark: Span = { token: "muted", fill, text: layout.glyphs.codeContinuation, projection: "" };
  const lines = text.split("\n");
  const filetype = isDiffLang(lang) ? null : codeFiletype(lang);
  const source: CodeSource | undefined = filetype ? { filetype, text } : undefined;
  const tokens = isDiffLang(lang) ? diffLineTokens(lines) : null;
  const breaking = codeBreaking(lang, layout.flags?.codeWrap);

  const rows: Row[] = [];
  let at = 0;
  lines.forEach((line, n) => {
    const style: LineStyle = { token: tokens?.[n] ?? "code.default", fill, source, at, named: layout.flags?.emoji ?? [] };
    breakLine(line, room, CODE_TAB_WIDTH, style, breaking.words).forEach((piece, i) => {
      const spans = [...pad(), ...piece.spans];
      if (piece.broken && breaking.mark) spans.push(mark);
      rows.push(i === 0 ? { spans, fill } : { spans, fill, joined: piece.joined });
    });
    at += line.length + 1;
  });

  // The padding rows: decorative, never projected, on the block's fill (and the flat rule).
  const padRow = (): Row => ({ spans: pad(), fill, decorative: true });
  const padRows = Math.max(0, padding.rows);
  for (let k = 0; k < padRows; k++) {
    rows.unshift(padRow());
    rows.push(padRow());
  }

  // The label at the right of the block's first row (the top padding row when there is one), as
  // far in from the right edge as the code is from the left; on a row of its own when that row's
  // text would reach it.
  const label = fitLabel(lang, Math.max(0, width - 2 - 2 * columns));
  if (label !== "") {
    const labelSpan: Span = { token: "muted", fill, text: label };
    const inset = columns > 0 ? { labelInset: columns } : {};
    const first = rows[0]!;
    let used = 0;
    for (const s of first.spans) used += displayWidth(s.text);
    if (used + 1 + displayWidth(label) + columns <= width) rows[0] = { ...first, label: labelSpan, ...inset };
    else rows.unshift({ spans: pad(), fill, label: labelSpan, ...inset, decorative: true });
  }
  return rows;
}

/** A code block token's rows (`renderNode`'s `code`; see `codeRows`). */
export function renderCode(token: Tokens.Code, ctx: MarkdownContext, options: CodeOptions = {}): Row[] {
  return codeRows(codeText(token, ctx), codeLang(token, ctx), ctx, options);
}
