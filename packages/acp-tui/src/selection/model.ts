// The selection as model positions; design of record 6.3 "Selecting". Pure.
//
// A selection is two ends, each a character under the pointer in an item's
// projection (`SelectionEnd`: the item and the character's `from` and `to`
// offsets, equal between characters). Dragging from one character to another
// selects both and everything between, whichever way the drag goes, as a
// terminal does. Double click selects a word, triple click a line (a logical
// line of the projection: a paragraph as the agent sent it, a code line, a
// table row). The range is a `TextRange` of projection.ts, so `rangeText`
// gives the copy and it survives scrolling, resizing and unmounting.
import type { TextPosition, TextRange } from "./projection.ts";

export interface SelectionEnd {
  readonly itemId: string;
  readonly from: number;
  readonly to: number;
}

/** Order of items in the conversation: an index per item id. */
export type ItemIndex = (itemId: string) => number;

/** Compares two positions in conversation order. */
export function comparePositions(index: ItemIndex, a: TextPosition, b: TextPosition): number {
  const d = index(a.itemId) - index(b.itemId);
  return d !== 0 ? d : a.offset - b.offset;
}

/** The range from `anchor` to `focus`, including the characters at both ends. */
export function dragRange(index: ItemIndex, anchor: SelectionEnd, focus: SelectionEnd): TextRange {
  const forward = comparePositions(index, { itemId: focus.itemId, offset: focus.from }, { itemId: anchor.itemId, offset: anchor.from }) >= 0;
  return forward
    ? { anchor: { itemId: anchor.itemId, offset: anchor.from }, focus: { itemId: focus.itemId, offset: focus.to } }
    : { anchor: { itemId: anchor.itemId, offset: anchor.to }, focus: { itemId: focus.itemId, offset: focus.from } };
}

/** The range's start and end in conversation order. */
export function rangeEnds(index: ItemIndex, range: TextRange): { start: TextPosition; end: TextPosition } {
  return comparePositions(index, range.anchor, range.focus) <= 0 ? { start: range.anchor, end: range.focus } : { start: range.focus, end: range.anchor };
}

/** Whether the range selects nothing. */
export function isEmptyRange(range: TextRange): boolean {
  return range.anchor.itemId === range.focus.itemId && range.anchor.offset === range.focus.offset;
}

const WORD = /[\p{L}\p{N}_]/u;

/** The word around the character at `from` (letters, digits and `_`); a single character when
 *  it is not part of a word; empty past the end. */
export function wordAt(text: string, from: number): { start: number; end: number } {
  if (from >= text.length) return { start: text.length, end: text.length };
  const chars = Array.from(text);
  // Code point index of `from`.
  let unit = 0;
  let at = 0;
  while (at < chars.length && unit + chars[at]!.length <= from) unit += chars[at++]!.length;
  if (!WORD.test(chars[at]!)) return { start: unit, end: unit + chars[at]!.length };
  let s = at;
  while (s > 0 && WORD.test(chars[s - 1]!)) s -= 1;
  let e = at;
  while (e < chars.length && WORD.test(chars[e]!)) e += 1;
  const offset = (k: number) => chars.slice(0, k).join("").length;
  return { start: offset(s), end: offset(e) };
}

/** The logical line around `from` (without its newline). */
export function lineAround(text: string, from: number): { start: number; end: number } {
  const at = Math.max(0, Math.min(text.length, from));
  const start = text.lastIndexOf("\n", at - 1) + 1;
  const newline = text.indexOf("\n", at);
  return { start, end: newline < 0 ? text.length : newline };
}

/** Clicks within this time and one cell of the previous one count as a double or triple click. */
export const MULTI_CLICK_MS = 400;

export interface Click {
  readonly x: number;
  readonly y: number;
  readonly at: number;
  readonly count: number;
}

/** The click count of a press at (`x`, `y`) at time `at`, after `previous`. */
export function nextClick(previous: Click | null, x: number, y: number, at: number): Click {
  const continued = previous !== null && at - previous.at <= MULTI_CLICK_MS && Math.abs(x - previous.x) <= 1 && y === previous.y;
  return { x, y, at, count: continued ? Math.min(3, previous.count + 1) : 1 };
}
