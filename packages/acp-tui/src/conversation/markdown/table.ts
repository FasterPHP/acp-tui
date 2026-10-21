// Tables (mvp-rendering tasks 5.1 and 5.2; spec tui-rendering "Compact bordered tables", "Wide
// tables as records").
//
// A table is drawn in a rounded border (`markdown.table.border`) with one column of padding each
// side of a cell, no padding rows, a rule under the header and rules between body rows only as
// `markdown.table_row_rules` says (`auto`: when some body row takes more than one line at the drawn
// width; `always`; `never`; the rules are decoration, so projection, copy and find do not see
// them), the header in
// `markdown.table.header`, and each column aligned as its delimiter row says. Columns take their
// natural width (their widest cell) when the table fits; otherwise they shrink towards the
// smaller of their natural width and the minimum column width (`flags.tableMinColumnWidth`, the
// setting `markdown.table_min_column_width`), and cells wrap at word boundaries, keeping their
// inline formatting. When even that does not fit, the table is drawn as records: for each body
// row, one `Header: value` line per column, records separated by a rule. No cell text is ever cut.
//
// The projection of a table does not depend on the layout (`tableProjection`): its rows as
// aligned text, every cell padded to its column's natural width, two spaces between columns, as
// the projection has always given tables. Every drawn cell span carries its place in it
// (`Span.at`), so the selection maps the cells of a grid, a wrapped grid or records alike.
import type { Tokens } from "marked";
import { displayWidth } from "../../layout/segments.ts";
import type { MarkdownContext } from "./context.ts";
import { inlineLines } from "./inline.ts";
import type { Row, Span } from "./types.ts";
import { decoration, mergeSpans, spansWidth, wrapSpans, type Line } from "./wrap.ts";

type Align = "left" | "center" | "right";

/** One cell: its lines of spans (a `<br>` makes several) and its text as projected. */
interface Cell {
  readonly lines: Line[];
  /** Each line's projected text. */
  readonly texts: string[];
  /** The cell's projected text: its lines joined by spaces. */
  readonly text: string;
  /** The widest line, in columns. */
  readonly width: number;
}

const projected = (spans: readonly Span[]) => spans.map((s) => s.projection ?? s.text).join("");

function cellOf(cell: Tokens.TableCell | undefined, header: boolean, ctx: MarkdownContext): Cell {
  const lines = cell ? inlineLines(cell.tokens, { token: header ? "markdown.table.header" : ctx.textToken }, ctx) : [[]];
  const texts = lines.map(projected);
  return { lines, texts, text: texts.join(" "), width: Math.max(0, ...lines.map(spansWidth)) };
}

interface Grid {
  readonly columns: number;
  readonly align: Align[];
  /** The header row, then the body rows. */
  readonly rows: Cell[][];
  /** Each column's natural width. */
  readonly natural: number[];
  /** Where each cell's text starts in the table's projection. */
  readonly at: number[][];
  readonly projection: string;
}

function gridOf(table: Tokens.Table, ctx: MarkdownContext): Grid {
  const columns = table.header.length;
  const align = Array.from({ length: columns }, (_, c) => (table.align[c] ?? "left") as Align);
  const rows = [table.header, ...table.rows].map((row, r) => Array.from({ length: columns }, (_, c) => cellOf(row[c], r === 0, ctx)));
  const natural = Array.from({ length: columns }, (_, c) => Math.max(1, ...rows.map((row) => row[c]!.width)));
  // The projection pads to the widest projected cell (a cell's lines joined by spaces).
  const padTo = Array.from({ length: columns }, (_, c) => Math.max(0, ...rows.map((row) => displayWidth(row[c]!.text))));
  // The projection: each row's cells padded to their column's natural width, two spaces apart.
  const at: number[][] = [];
  let projection = "";
  rows.forEach((row, r) => {
    if (r > 0) projection += "\n";
    const offsets: number[] = [];
    let line = "";
    row.forEach((cell, c) => {
      if (c > 0) line += "  ";
      offsets.push(projection.length + line.length);
      line += cell.text;
      if (c < columns - 1) line += " ".repeat(Math.max(0, padTo[c]! - displayWidth(cell.text)));
    });
    projection += line.trimEnd();
    at.push(offsets);
  });
  return { columns, align, rows, natural, at, projection };
}

/** The table's projection (see the module header). */
export function tableProjection(table: Tokens.Table, ctx: MarkdownContext): string {
  return gridOf(table, ctx).projection;
}

/** A cell's lines wrapped at `width`, every span carrying its place in the projection. */
function cellRows(cell: Cell, at: number, width: number): Span[][] {
  const out: Span[][] = [];
  let offset = at;
  cell.lines.forEach((line, k) => {
    if (k > 0) offset += 1; // the space the projection joins the cell's lines with
    let first = true;
    for (const row of wrapSpans(line, width, false)) {
      if (!first) offset += row.joined?.length ?? 0;
      first = false;
      const spans: Span[] = [];
      for (const span of row.spans) {
        const length = (span.projection ?? span.text).length;
        spans.push(span.projection === "" ? span : { ...span, at: offset });
        offset += length;
      }
      out.push(spans);
    }
  });
  return out.length > 0 ? out : [[]];
}

/** Columns' widths for an inner width (`available` columns of cell text in total), or null when
 *  even the minimum widths do not fit. */
function fitColumns(natural: readonly number[], available: number, minimum: number): number[] | null {
  const total = natural.reduce((a, b) => a + b, 0);
  if (total <= available) return [...natural];
  const floor = natural.map((w) => Math.min(w, minimum));
  let rest = available - floor.reduce((a, b) => a + b, 0);
  if (rest < 0) return null;
  // Share the rest in proportion to what each column still lacks, the remainder to the widest
  // lack first.
  const lack = natural.map((w, c) => w - floor[c]!);
  const lacking = lack.reduce((a, b) => a + b, 0);
  const widths = floor.map((w, c) => w + Math.floor((rest * lack[c]!) / lacking));
  rest = available - widths.reduce((a, b) => a + b, 0);
  const order = lack.map((l, c) => [l - (widths[c]! - floor[c]!), c] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; rest > 0; k = (k + 1) % order.length) {
    const c = order[k]![1];
    if (widths[c]! < natural[c]!) {
      widths[c]! += 1;
      rest -= 1;
    }
  }
  return widths;
}

/** Pads a cell row to `width` as its column aligns. */
function aligned(spans: Span[], width: number, align: Align, token: Span["token"]): Span[] {
  const gap = Math.max(0, width - spansWidth(spans));
  const left = align === "right" ? gap : align === "center" ? Math.floor(gap / 2) : 0;
  const pad = (n: number): Span[] => (n > 0 ? [decoration(" ".repeat(n), { token })] : []);
  return [...pad(left), ...spans, ...pad(gap - left)];
}

function gridRows(grid: Grid, widths: readonly number[], ctx: MarkdownContext): Row[] {
  const g = ctx.glyphs.table;
  const border = { token: "markdown.table.border" } as const;
  const line = (left: string, join: string, right: string): Row => ({
    spans: [decoration(left + widths.map((w) => g.horizontal.repeat(w + 2)).join(join) + right, border)],
    decorative: true,
  });
  const rows: Row[] = [line(g.topLeft, g.topTee, g.topRight)];
  const laid = grid.rows.map((cells, r) => cells.map((cell, c) => cellRows(cell, grid.at[r]![c]!, widths[c]!)));
  const heights = laid.map((wrapped) => Math.max(...wrapped.map((w) => w.length)));
  const rule = ctx.flags.tableRowRules;
  const ruled = rule === "always" || (rule === "auto" && heights.slice(1).some((h) => h > 1));
  grid.rows.forEach((_, r) => {
    const wrapped = laid[r]!;
    const height = heights[r]!;
    for (let k = 0; k < height; k++) {
      const spans: Span[] = [decoration(`${g.vertical} `, border)];
      wrapped.forEach((cell, c) => {
        if (c > 0) spans.push(decoration(` ${g.vertical} `, border));
        spans.push(...aligned(cell[k] ?? [], widths[c]!, grid.align[c]!, ctx.textToken));
      });
      spans.push(decoration(` ${g.vertical}`, border));
      rows.push({ spans: mergeSpans(spans) });
    }
    if (r === 0 || (ruled && r < grid.rows.length - 1)) rows.push(line(g.leftTee, g.cross, g.rightTee));
  });
  rows.push(line(g.bottomLeft, g.bottomTee, g.bottomRight));
  return rows;
}

/** The record layout: each body row as `Header: value` lines, records separated by a rule. */
function recordRows(grid: Grid, ctx: MarkdownContext): Row[] {
  const rows: Row[] = [];
  const indent = 2;
  grid.rows.slice(1).forEach((cells, b) => {
    const r = b + 1;
    if (b > 0) rows.push({ spans: [decoration(ctx.glyphs.ruleLight.repeat(Math.min(ctx.width, 1000)), { token: "markdown.table.border" })], decorative: true });
    cells.forEach((cell, c) => {
      const header = grid.rows[0]![c]!;
      // The header's lines and the value's lines, each span placed in the projection.
      const head = cellRows(header, grid.at[0]![c]!, Number.MAX_SAFE_INTEGER).flat();
      const value = cellRows(cell, grid.at[r]![c]!, Number.MAX_SAFE_INTEGER);
      const first: Span[] = [...head.map((s) => (s.projection === "" ? s : { ...s, token: "markdown.table.header" as const })), decoration(": ", { token: "markdown.table.header" })];
      const lines = value.length > 0 ? value : [[]];
      lines.forEach((spans, k) => {
        const lead = k === 0 ? first : [decoration(" ".repeat(indent), { token: ctx.textToken })];
        const wrapped = wrapPlaced([...lead, ...spans], ctx.width, indent, ctx);
        rows.push(...wrapped);
      });
    });
  });
  return rows;
}

/**
 * Wraps a record line whose spans carry their places (`at`), keeping them: a wrapped row's spans
 * have their `at` moved past what the rows before took; continuation rows are indented.
 */
function wrapPlaced(spans: Span[], width: number, indent: number, ctx: MarkdownContext): Row[] {
  // Wrap without places, then put them back by walking the text in order.
  const plain = spans.map((s) => ({ ...s, at: undefined }));
  const rows = wrapSpans(plain, Math.max(1, width - indent));
  const out: Row[] = [];
  // The places of each character of the line, in order (decoration has none).
  const places: number[] = [];
  for (const s of spans) {
    const length = (s.projection ?? s.text).length;
    for (let k = 0; k < length; k++) places.push(s.projection === "" || s.at === undefined ? -1 : s.at + k);
  }
  let cursor = 0;
  rows.forEach((row, i) => {
    if (i > 0) cursor += row.joined?.length ?? 0;
    const placed: Span[] = [];
    for (const s of row.spans) {
      const length = (s.projection ?? s.text).length;
      const at = places[cursor];
      placed.push(s.projection === "" || at === undefined || at < 0 ? { ...s, at: undefined } : { ...s, at });
      cursor += length;
    }
    const clean = placed.map(({ at, ...rest }) => (at === undefined ? rest : { ...rest, at }));
    out.push({ spans: i === 0 ? clean : [decoration(" ".repeat(indent), { token: ctx.textToken }), ...clean] });
  });
  return out;
}

/** A table's rows (see the module header). */
export function renderTable(table: Tokens.Table, ctx: MarkdownContext): Row[] {
  const grid = gridOf(table, ctx);
  // Borders and padding: `│ ` before each cell, ` │` after the last, ` │ ` between.
  const chrome = 3 * grid.columns + 1;
  const widths = fitColumns(grid.natural, ctx.width - chrome, ctx.flags.tableMinColumnWidth);
  return widths ? gridRows(grid, widths, ctx) : recordRows(grid, ctx);
}
