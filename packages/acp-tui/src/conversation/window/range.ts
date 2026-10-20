// The window over the entries (design of record 6.2 "Virtualisation"), pure
// arithmetic. The list mounts the entries
// in `[start, end)` between two spacers; everything else is spacer rows.
//
// - Following (at the bottom): the tail, `TAIL` (40) entries, or more when
//   they do not cover the viewport and a margin.
// - Scrolled: the entries overlapping the viewport and a margin of one
//   viewport above and below must be mounted. When the viewport nears an edge
//   of the window, the window grows by a chunk of `CHUNK` (60) entries on
//   that side (OpenCode v2: 40 tail entries, chunks of 60); a jump far away
//   (Home, a cursor or reveal target off the window) mounts the needed
//   entries and half a chunk either side instead. The window never holds
//   more than `MAX` entries: chunks farthest from the viewport are dropped.
// - Remapping: when the entries change (items appended, a group opened, a
//   density switched without a reader's entry to keep), the window's edges
//   follow the model items at them.
// - A density switch that keeps a reader's entry on its row mounts only the
//   entries around it that cover the viewport and a margin (`rowsAround`), so
//   its first frame redraws as few entries as it can; the window grows from
//   there by chunks as the reader scrolls.
//
// Positions: the virtual layout (`virtualTops`) gives every entry a top and
// a height in content rows, mounted or not: mounted entries from Yoga, the
// rest stacked above and below them from the height cache. The scroll
// controller works over all entries this way (geometry.ts), so an anchor or a
// cursor may sit on an unmounted entry; when it mounts and its real heights
// differ from the estimates, the controller's anchor restore puts the
// anchored entry back on the same screen row (anchor compensation).
import { firstItem, type EntryList } from "./entries.ts";

export interface Range {
  readonly start: number;
  readonly end: number;
}

export interface WindowSizes {
  readonly tail: number;
  readonly chunk: number;
  readonly max: number;
}

export const TAIL = 40;
export const CHUNK = 60;
export const WINDOW_SIZES: WindowSizes = { tail: TAIL, chunk: CHUNK, max: TAIL + 2 * CHUNK };

const clampRange = (r: Range, n: number): Range => {
  const start = Math.max(0, Math.min(n, r.start));
  return { start, end: Math.max(start, Math.min(n, r.end)) };
};

export function sameRange(a: Range, b: Range): boolean {
  return a.start === b.start && a.end === b.end;
}

/**
 * The next window. `need` is the entries that must be mounted (those overlapping the viewport
 * and its margins, `[first, last + 1)`); `following` keeps the tail.
 */
export function nextRange(current: Range, n: number, need: Range, following: boolean, sizes: WindowSizes = WINDOW_SIZES): Range {
  if (n === 0) return { start: 0, end: 0 };
  const want = clampRange(need, n);
  if (following) return { start: Math.max(0, Math.min(n - sizes.tail, want.start)), end: n };
  let { start, end } = clampRange(current, n);
  if (want.start >= want.end) return { start, end };
  const far = end <= start || want.end + sizes.chunk < start || want.start > end + sizes.chunk;
  if (far) {
    // A jump: the needed entries and half a chunk either side.
    const pad = sizes.chunk >> 1;
    start = Math.max(0, want.start - pad);
    end = Math.min(n, want.end + pad);
  } else {
    while (start > want.start) start = Math.max(0, start - sizes.chunk);
    while (end < want.end) end = Math.min(n, end + sizes.chunk);
  }
  // Drop chunks farthest from the needed entries while the window is too large.
  while (end - start > sizes.max) {
    const below = end - want.end;
    const above = want.start - start;
    if (below >= above && below > 0) end = Math.max(want.end, end - sizes.chunk);
    else if (above > 0) start = Math.min(want.start, start + sizes.chunk);
    else break;
  }
  return { start, end };
}

/**
 * The window over `next` that holds the same model items at its edges as `range` over
 * `previous`: each edge follows the first item of the entry at it to the entry that now shows
 * it. An edge at the end stays at the end.
 */
export function remapRange(previous: EntryList, next: EntryList, range: Range): Range {
  const n = next.entries.length;
  const map = (at: number): number => {
    if (at >= previous.entries.length) return n;
    const holder = next.holder.get(firstItem(previous.entries[at]!));
    return holder ?? Math.min(at, n);
  };
  return clampRange({ start: map(range.start), end: map(range.end) }, n);
}

/**
 * Content rows before each entry's slot (its margin and body): `prefix[i]` is the rows above
 * entry `i`'s margin, `prefix[n]` the total. `height(i)` is the entry's body height.
 */
export function prefixRows(n: number, margin: (i: number) => number, height: (i: number) => number): Float64Array {
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i]! + margin(i) + height(i);
  return prefix;
}

/** The last entry whose slot starts at or above content row `row` (0 when none does). */
function slotAt(prefix: Float64Array, row: number): number {
  let lo = 0;
  let hi = prefix.length - 2;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (prefix[mid]! <= row) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** The first entry of the tail that covers `rows` content rows (at least one entry). */
export function tailStart(prefix: Float64Array, rows: number): number {
  const n = prefix.length - 1;
  if (n <= 0) return 0;
  return slotAt(prefix, prefix[n]! - rows);
}

/**
 * The entries that cover `above` content rows above entry `at`'s slot and `below` rows from its
 * top, by the prefix rows (the cache and estimates), `at` always included and at most `max`
 * entries, the rows nearest `at` kept. A density switch mounts only these before its first frame
 * (the reader's entry and the viewport around it); the window grows from them by chunks as the
 * reader scrolls.
 */
export function rowsAround(prefix: Float64Array, at: number, above: number, below: number, max: number = WINDOW_SIZES.max): Range {
  const n = prefix.length - 1;
  if (n <= 0) return { start: 0, end: 0 };
  const i = Math.max(0, Math.min(n - 1, at));
  let start = Math.min(i, slotAt(prefix, prefix[i]! - Math.max(0, above)));
  let end = Math.max(i + 1, slotAt(prefix, prefix[i]! + Math.max(1, below) - 1) + 1);
  // Too many entries: trim both sides towards `at`, the side that is longer first.
  while (end - start > max) {
    if (end - (i + 1) >= i - start) end--;
    else start++;
  }
  return { start, end };
}

/** The mounted slice as laid out: Yoga's tops and heights of the entries in `[start, end)`. */
export interface MountedLayout {
  readonly start: number;
  readonly end: number;
  /** Rows of the top spacer as laid out (its bottom is the first mounted entry's margin). */
  readonly topSpacer: number;
  readonly tops: readonly number[];
  readonly heights: readonly number[];
  /** The first row below the last mounted entry (the bottom spacer's top). */
  readonly bottomTop: number;
}

/**
 * Every entry's top and height in content rows. Mounted entries take Yoga's values; entries
 * above the window are stacked upwards from the bottom of the top spacer, and entries below it
 * downwards from the bottom spacer's top, with `height` (the cache or an estimate). Stacking
 * from the laid-out spacers keeps the virtual rows consistent with what is on screen even when
 * a spacer was sized from older estimates.
 */
export function virtualTops(
  n: number,
  mounted: MountedLayout,
  margin: (i: number) => number,
  height: (i: number) => number,
): { tops: Float64Array; heights: Float64Array } {
  const tops = new Float64Array(n);
  const heights = new Float64Array(n);
  const start = Math.min(mounted.start, n);
  const end = Math.max(start, Math.min(mounted.end, n));
  let cursor = mounted.topSpacer;
  for (let i = start - 1; i >= 0; i--) {
    const h = height(i);
    heights[i] = h;
    tops[i] = cursor - h;
    cursor = tops[i]! - margin(i);
  }
  for (let i = start; i < end; i++) {
    tops[i] = mounted.tops[i - start] ?? 0;
    heights[i] = mounted.heights[i - start] ?? 0;
  }
  cursor = mounted.bottomTop;
  for (let i = end; i < n; i++) {
    const h = height(i);
    tops[i] = cursor + margin(i);
    heights[i] = h;
    cursor = tops[i]! + h;
  }
  return { tops, heights };
}

/** The index of the entry containing content row `row`, or the first one below it; `n` when
 *  none is (binary search over the virtual tops). */
export function indexAtRow(tops: Float64Array, heights: Float64Array, row: number): number {
  let lo = 0;
  let hi = tops.length - 1;
  let found = tops.length;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (tops[mid]! + heights[mid]! > row) {
      found = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return found;
}
