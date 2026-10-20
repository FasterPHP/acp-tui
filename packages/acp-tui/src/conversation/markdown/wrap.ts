// Word wrapping of styled spans into rows, and the row helpers the block
// renderers share. Widths are display columns (`displayWidth`, the measure
// OpenTUI uses), so wide characters count two and a grapheme is never split.
import { displayWidth } from "../../layout/segments.ts";
import { elideUrl, isBareUrl, urlElision } from "./elide.ts";
import type { Row, Span, SpanStyle } from "./types.ts";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** One line of inline content: the spans between hard breaks. */
export type Line = readonly Span[];

/** Display width of spans. */
export function spansWidth(spans: readonly Span[]): number {
  let w = 0;
  for (const s of spans) w += displayWidth(s.text);
  return w;
}

/** A span with `text` in `style` (its projection is the text). */
export function span(text: string, style: SpanStyle): Span {
  return { ...style, text };
}

/** A decoration span: drawn, never projected. */
export function decoration(text: string, style: SpanStyle): Span {
  return { ...style, text, projection: "" };
}

function sameStyle(a: Span, b: Span): boolean {
  return (
    a.token === b.token &&
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.underline === !!b.underline &&
    !!a.dim === !!b.dim &&
    !!a.strike === !!b.strike &&
    a.link?.href === b.link?.href &&
    !!a.hint === !!b.hint &&
    a.fill === b.fill &&
    // Placed spans (table cells) join only where their places run on.
    (a.at === undefined) === (b.at === undefined) &&
    (a.at === undefined || b.at === a.at + (a.projection ?? a.text).length) &&
    (a.projection === undefined) === (b.projection === undefined) &&
    (a.projection === undefined || a.projection === "") &&
    (b.projection === undefined || b.projection === "")
  );
}

/** Adjacent spans in the same style joined, empty ones dropped. */
export function mergeSpans(spans: readonly Span[]): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    if (s.text === "" && (s.projection === undefined || s.projection === "")) continue;
    const last = out[out.length - 1];
    if (last && sameStyle(last, s)) out[out.length - 1] = { ...last, text: last.text + s.text };
    else out.push(s);
  }
  return out;
}

/** A no-break space keeps its words on one row, and is then drawn (and copied) as a space. */
const nbsp = (text: string) => text.replace(/\u00a0/g, " ");

/** A line that fits as one row: no-break spaces drawn as spaces, trailing spaces dropped (as the
 *  word wrap below does). */
function oneRow(line: Line): Span[] {
  const spans = line.map((s) => (s.projection !== undefined ? s : { ...s, text: nbsp(s.text) }));
  while (spans.length > 0) {
    const tail = spans[spans.length - 1]!;
    if (tail.projection !== undefined) break;
    const trimmed = tail.text.replace(/ +$/, "");
    if (trimmed !== "") {
      spans[spans.length - 1] = { ...tail, text: trimmed };
      break;
    }
    spans.pop();
  }
  return mergeSpans(spans);
}

/** Whether a span is wrapped whole: it has a projection of its own other than decoration's. */
const whole = (s: Span) => s.projection !== undefined && s.projection !== "";

interface Piece {
  readonly span: Span;
  readonly text: string;
}

/**
 * A word holding a bare URL drawn within `room` columns (elide.ts, review A1): the pieces before and
 * after the URL as they are, and the URL as one span of its shortened text that projects the full
 * URL (so it is never split). Null when the word holds no bare URL, or it would not fit.
 */
function elidedWord(pieces: readonly Piece[], room: number): Span[] | null {
  const first = pieces.findIndex((p) => p.span.link !== undefined && !p.span.hint);
  if (first < 0) return null;
  const head = pieces[first]!.span;
  const link = head.link!;
  let last = first;
  while (last + 1 < pieces.length && pieces[last + 1]!.span.link === link && !pieces[last + 1]!.span.hint) last++;
  const label = pieces
    .slice(first, last + 1)
    .map((p) => p.text)
    .join("");
  if (!isBareUrl(label, link.href)) return null;
  const others = [...pieces.slice(0, first), ...pieces.slice(last + 1)];
  if (others.some((p) => p.span.link === link)) return null;
  const text = elideUrl(label, room - others.reduce((n, p) => n + displayWidth(p.text), 0));
  if (text === null) return null;
  const plain = (p: Piece): Span => (whole(p.span) ? p.span : { ...p.span, text: nbsp(p.text) });
  return [...pieces.slice(0, first).map(plain), { ...head, text, projection: label }, ...pieces.slice(last + 1).map(plain)];
}

/**
 * Whether `text` ends with a wide grapheme. OpenTUI 0.5.12 loses the screen row below one that
 * ends with a wide character in the terminal's last column (its buffer, not only the test
 * capture), and the conversation's text ends there; so no row is let end with a wide character
 * at its full width (`wrapSpans`, code.ts `breakAt`). OpenTUI 0.6.1 draws that row in-process
 * (test/conversation/markdown/ends-wide.test.tsx); the rule stays until the IDE terminals are
 * seen to agree.
 */
export function endsWide(text: string): boolean {
  let last = "";
  for (const { segment } of graphemes.segment(text.slice(-16))) last = segment;
  return displayWidth(last) > 1;
}

/** Whether something `width` columns wide, ending with `tail`, fits after `used` columns of a
 *  row `limit` wide (see `endsWide`). */
export function fitsRow(used: number, width: number, tail: string, limit: number): boolean {
  return used + width < limit || (used + width === limit && !endsWide(tail));
}

/** The longest prefix of `text` (by graphemes) that fits `width` columns at the end of a row
 *  (`fitsRow` when the row may reach the screen's edge), at least one grapheme. */
export function cut(text: string, width: number, edge = true): [string, string] {
  let used = 0;
  let at = 0;
  for (const { segment, index } of graphemes.segment(text)) {
    const w = displayWidth(segment);
    if (at > 0 && (edge ? !fitsRow(used, w, segment, width) : used + w > width)) break;
    used += w;
    at = index + segment.length;
    if (used >= width) break;
  }
  return [text.slice(0, at), text.slice(at)];
}

/**
 * Wraps one line of spans at `width` columns, breaking at spaces; a word longer than the width
 * breaks at the width (as M30's long word and URL do), except a bare URL where the terminal
 * detects URLs itself (`urlElision`, elide.ts), which is shortened onto the row. The spaces a break consumes are dropped
 * from the rows, and each row records them (`joined`), so the projection rejoins the line as it
 * was. Leading spaces of the line are kept; trailing spaces are dropped. An empty line is one
 * empty row. With `edge` false (a table cell, which never reaches the screen's edge), a row may
 * end with a wide character at its full width (`endsWide`).
 */
export function wrapSpans(line: Line, width: number, edge = true): Row[] {
  const w = Math.max(1, width);
  const fits = (used: number, wide: number, tail: string) => (edge ? fitsRow(used, wide, tail, w) : used + wide <= w);
  // Most lines fit (and every line of the projection, laid out at a huge width): one row.
  const total = spansWidth(line);
  const last = line[line.length - 1];
  if (total < w || (last && fits(0, total, last.text))) return [{ spans: oneRow(line) }];
  // Words (runs of non-space across spans) and the space runs between them.
  const words: { pieces: Piece[]; width: number; space: boolean }[] = [];
  for (const s of line) {
    if (whole(s)) {
      // A span with a projection of its own (a tab, a substituted placeholder) is never split;
      // decoration (no projection) splits like text.
      const last = words[words.length - 1];
      const piece = { span: s, text: s.text };
      if (last && !last.space) {
        last.pieces.push(piece);
        last.width += displayWidth(s.text);
      } else words.push({ pieces: [piece], width: displayWidth(s.text), space: false });
      continue;
    }
    for (const part of s.text.split(/( +)/)) {
      if (part === "") continue;
      const space = part[0] === " ";
      const last = words[words.length - 1];
      const piece = { span: s, text: part };
      if (last && last.space === space) {
        last.pieces.push(piece);
        last.width += displayWidth(part);
      } else words.push({ pieces: [piece], width: displayWidth(part), space });
    }
  }

  const rows: Row[] = [];
  let current: Span[] = [];
  let used = 0;
  let joined: string | undefined;
  let pending: { pieces: Piece[]; width: number } | null = null;
  const push = (pieces: readonly Piece[]) => {
    for (const p of pieces) current.push(whole(p.span) ? p.span : { ...p.span, text: nbsp(p.text) });
  };
  const newRow = (next: string) => {
    rows.push(joined === undefined ? { spans: mergeSpans(current) } : { spans: mergeSpans(current), joined });
    current = [];
    used = 0;
    joined = next;
  };

  for (const word of words) {
    if (word.space) {
      // Leading spaces of the line are kept (an indented line stays indented).
      if (rows.length === 0 && current.length === 0) {
        push(word.pieces);
        used += word.width;
      } else pending = word;
      continue;
    }
    const gap = pending?.width ?? 0;
    const tail = word.pieces[word.pieces.length - 1]!.text;
    if (used > 0 && !fits(used + gap, word.width, tail)) newRow(pending ? pending.pieces.map((p) => (p.span.projection === "" ? "" : p.text)).join("") : "");
    else if (pending && used > 0) {
      push(pending.pieces);
      used += gap;
    }
    pending = null;
    if (fits(used, word.width, tail)) {
      push(word.pieces);
      used += word.width;
      continue;
    }
    // A bare URL longer than a row, where the terminal detects URLs itself: on this row, shortened
    // (elide.ts), so the terminal never detects a cut-off URL.
    const elided = urlElision() ? elidedWord(word.pieces, w - used) : null;
    if (elided) {
      current.push(...elided);
      used += spansWidth(elided);
      continue;
    }
    // Longer than a row: break it at the width, a grapheme at a time. An emoji's name (`named`)
    // breaks like text, its first piece projecting the emoji and the others nothing.
    for (const piece of word.pieces) {
      let rest = piece.text;
      let first = true;
      while (rest !== "") {
        if (used >= w) newRow("");
        const [head, after] = cut(rest, w - used, edge);
        if (used > 0 && !fits(used, displayWidth(head), head)) {
          newRow("");
          continue;
        }
        if (piece.span.named) {
          current.push(first ? { ...piece.span, text: head } : { ...piece.span, text: head, projection: "" });
          first = false;
          used += displayWidth(head);
          rest = after;
          continue;
        }
        current.push(whole(piece.span) ? piece.span : { ...piece.span, text: nbsp(head) });
        used += displayWidth(head);
        rest = whole(piece.span) ? "" : after;
      }
    }
  }
  rows.push(joined === undefined ? { spans: mergeSpans(current) } : { spans: mergeSpans(current), joined });
  return rows;
}

/** Wraps several lines (hard breaks between them) at `width`. */
export function wrapLines(lines: readonly Line[], width: number): Row[] {
  const rows: Row[] = [];
  for (const line of lines) rows.push(...wrapSpans(line, width));
  return rows;
}

/**
 * Rows with a prefix on each: `first` on the first row and `rest` on the others (a list marker
 * and its hanging indent, a quote bar on every row). On a row a wrap started, `rest` is
 * decoration (the projection rejoins the wrapped line without it); on a blank row (between
 * paragraphs) `blank` stands in, so no row ends in spaces.
 */
export function prefixRows(rows: readonly Row[], first: readonly Span[], rest: readonly Span[], blank: readonly Span[] = []): Row[] {
  const wrapped = rest.map((s) => ({ ...s, projection: "" }));
  return rows.map((row, i) => {
    const prefix = i === 0 ? first : row.spans.length === 0 ? blank : row.joined !== undefined ? wrapped : rest;
    return { ...row, spans: [...prefix, ...row.spans] };
  });
}

/** An empty row (a blank line between blocks). */
export const BLANK_ROW: Row = { spans: [] };
