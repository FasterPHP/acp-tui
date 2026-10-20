// Spike S3 (task 12.3). The window arithmetic (tail, chunks,
// jumps, the size bound, remapping) and anchor compensation: the scroll
// controller over the window's virtual geometry, with a fake layout in which
// mounted entries take their real heights and the spacers are sized from the
// estimates, as the real list is.
import { describe, expect, test } from "bun:test";
import type { EntryList, ItemEntry } from "../../../src/conversation/window/entries.ts";
import { WindowGeometry } from "../../../src/conversation/window/geometry.ts";
import {
  indexAtRow,
  nextRange,
  prefixRows,
  remapRange,
  rowsAround,
  tailStart,
  virtualTops,
  WINDOW_SIZES,
  type Range,
} from "../../../src/conversation/window/range.ts";
import { ScrollController, type ScrollState } from "../../../src/conversation/scroll.ts";

function listOf(keys: string[], margin = (i: number) => (i === 0 ? 0 : 1)): EntryList {
  const entries: ItemEntry[] = keys.map((key, i) => ({ kind: "item", key, margin: margin(i), group: null }));
  return {
    entries,
    keys,
    index: new Map(keys.map((k, i) => [k, i])),
    holder: new Map(keys.map((k, i) => [k, i])),
  };
}

describe("nextRange", () => {
  const { tail, chunk, max } = WINDOW_SIZES;

  test("the sizes: tail 40, chunks of 60, at most 160", () => {
    expect({ tail, chunk, max }).toEqual({ tail: 40, chunk: 60, max: 160 });
  });

  test("following keeps the tail of 40, or more when the view needs it", () => {
    expect(nextRange({ start: 0, end: 0 }, 5000, { start: 4990, end: 5000 }, true)).toEqual({ start: 4960, end: 5000 });
    expect(nextRange({ start: 4960, end: 5000 }, 5000, { start: 4950, end: 5000 }, true)).toEqual({ start: 4950, end: 5000 });
    expect(nextRange({ start: 0, end: 0 }, 12, { start: 0, end: 12 }, true)).toEqual({ start: 0, end: 12 });
  });

  test("needed entries inside the window change nothing", () => {
    expect(nextRange({ start: 4960, end: 5000 }, 5000, { start: 4970, end: 4990 }, false)).toEqual({ start: 4960, end: 5000 });
  });

  test("nearing the top edge mounts a chunk of 60 above", () => {
    expect(nextRange({ start: 4960, end: 5000 }, 5000, { start: 4955, end: 4985 }, false)).toEqual({ start: 4900, end: 5000 });
    expect(nextRange({ start: 30, end: 100 }, 5000, { start: 20, end: 50 }, false)).toEqual({ start: 0, end: 100 });
  });

  test("past 160 entries, the chunk farthest from the view is dropped", () => {
    // 4840..5000 is 160; one more chunk above makes 220, so 60 go at the bottom.
    expect(nextRange({ start: 4840, end: 5000 }, 5000, { start: 4830, end: 4860 }, false)).toEqual({ start: 4780, end: 4940 });
    // Scrolling down again: a chunk below, one dropped above.
    expect(nextRange({ start: 4780, end: 4940 }, 5000, { start: 4920, end: 4950 }, false)).toEqual({ start: 4840, end: 5000 });
  });

  test("a jump far away (Home) mounts the needed entries and half a chunk either side", () => {
    expect(nextRange({ start: 4960, end: 5000 }, 5000, { start: 0, end: 20 }, false)).toEqual({ start: 0, end: 50 });
    expect(nextRange({ start: 4960, end: 5000 }, 5000, { start: 2000, end: 2001 }, false)).toEqual({ start: 1970, end: 2031 });
  });

  test("an empty list mounts nothing; ranges are clamped to the list", () => {
    expect(nextRange({ start: 3, end: 9 }, 0, { start: 0, end: 0 }, false)).toEqual({ start: 0, end: 0 });
    expect(nextRange({ start: 40, end: 80 }, 50, { start: 45, end: 50 }, false)).toEqual({ start: 40, end: 50 });
  });
});

describe("remapRange", () => {
  test("appended entries leave a scrolled window where it is", () => {
    const before = listOf(["a", "b", "c", "d"]);
    const after = listOf(["a", "b", "c", "d", "e", "f"]);
    expect(remapRange(before, after, { start: 1, end: 3 })).toEqual({ start: 1, end: 3 });
    // An edge at the end stays at the end.
    expect(remapRange(before, after, { start: 2, end: 4 })).toEqual({ start: 2, end: 6 });
  });

  test("a group opening inside the window keeps the same items at the edges", () => {
    const shut: EntryList = { ...listOf(["u", "group:run:r1", "m", "x"]), holder: new Map([["u", 0], ["r1", 1], ["r2", 1], ["m", 2], ["x", 3]]) };
    const open: EntryList = { ...listOf(["u", "group:run:r1", "r1", "r2", "m", "x"]), holder: new Map([["u", 0], ["r1", 2], ["r2", 3], ["m", 4], ["x", 5]]) };
    // The window was u..m (0..3); after opening, u..m is 0..5.
    expect(remapRange(shut, open, { start: 0, end: 3 })).toEqual({ start: 0, end: 5 });
  });
});

describe("prefix rows and the virtual layout", () => {
  test("prefixRows and tailStart", () => {
    const prefix = prefixRows(5, (i) => (i === 0 ? 0 : 1), () => 2);
    expect([...prefix]).toEqual([0, 2, 5, 8, 11, 14]);
    // The tail covering 6 rows starts at entry 3 (rows 8..14).
    expect(tailStart(prefix, 6)).toBe(3);
    expect(tailStart(prefix, 100)).toBe(0);
  });

  test("rowsAround: the entries covering rows above and below an entry, at most `max`, nearest first (a density switch's first frame)", () => {
    // Entries 0..9, 2 rows each with a blank row above all but the first: slots start at
    // 0, 2, 5, 8, 11, 14, 17, 20, 23, 26 (29 rows in all).
    const prefix = prefixRows(10, (i) => (i === 0 ? 0 : 1), () => 2);
    // Entry 5's slot starts at row 14: 6 rows above reach row 8 (entry 3), 7 rows from it reach
    // row 20 (entry 7).
    expect(rowsAround(prefix, 5, 6, 7)).toEqual({ start: 3, end: 8 });
    expect(rowsAround(prefix, 5, 0, 1)).toEqual({ start: 5, end: 6 });
    // Clamped at both ends of the list.
    expect(rowsAround(prefix, 0, 100, 3)).toEqual({ start: 0, end: 2 });
    // Row 22, 4 above entry 9, is in entry 7's slot (rows 20 to 22).
    expect(rowsAround(prefix, 9, 4, 100)).toEqual({ start: 7, end: 10 });
    // At most `max` entries, trimmed towards the entry from the longer side first.
    expect(rowsAround(prefix, 5, 100, 100, 3)).toEqual({ start: 4, end: 7 });
    expect(rowsAround(prefixRows(0, () => 0, () => 0), 0, 10, 10)).toEqual({ start: 0, end: 0 });
  });

  test("virtualTops stacks unmounted entries from the laid-out spacers, and indexAtRow finds them", () => {
    // Entries 0..9, 2 rows each with a blank row above all but the first; 4..6 mounted with real
    // heights of 3; the top spacer was sized from estimates (4 entries: 2+3+3+3 = 11 rows).
    const margin = (i: number) => (i === 0 ? 0 : 1);
    const { tops, heights } = virtualTops(10, { start: 4, end: 7, topSpacer: 11, tops: [12, 16, 20], heights: [3, 3, 3], bottomTop: 23 }, margin, () => 2);
    expect([...tops]).toEqual([0, 3, 6, 9, 12, 16, 20, 24, 27, 30]);
    expect([...heights]).toEqual([2, 2, 2, 2, 3, 3, 3, 2, 2, 2]);
    expect(indexAtRow(tops, heights, 0)).toBe(0);
    expect(indexAtRow(tops, heights, 2)).toBe(1); // the blank row above entry 1
    expect(indexAtRow(tops, heights, 18)).toBe(5);
    expect(indexAtRow(tops, heights, 31)).toBe(9);
    expect(indexAtRow(tops, heights, 40)).toBe(10);
  });
});

/**
 * A fake window: entries with estimated and real heights; the mounted ones take their real
 * heights, the spacers the estimates, as the real list lays out.
 */
class FakeWindow {
  top = 0;
  range: Range;
  readonly geometry: WindowGeometry;
  list: EntryList;
  constructor(
    public estimate: number[],
    public real: number[],
    readonly viewport: number,
  ) {
    this.list = listOf(estimate.map((_, i) => `e${i}`));
    this.range = { start: Math.max(0, estimate.length - 40), end: estimate.length };
    this.geometry = new WindowGeometry({
      scrollTop: () => this.top,
      setScrollTop: (top, content, viewport) => {
        this.top = Math.max(0, Math.min(Math.max(0, content - viewport), Math.round(top)));
      },
    });
  }
  /** New entries for the same model (a run joining a group line, a density switch): the window's
   *  edges follow the same model items, as the component's `remapRange` does. */
  replace(list: EntryList, estimate: number[], real: number[]): void {
    this.range = remapRange(this.list, list, this.range);
    this.list = list;
    this.estimate = estimate;
    this.real = real;
  }
  private margin = (i: number) => this.list.entries[i]!.margin;
  /** Yoga's layout of the current range, recorded into the geometry. */
  layout(): void {
    const { start, end } = this.range;
    const prefix = prefixRows(this.estimate.length, this.margin, (i) => this.estimate[i]!);
    const topSpacer = prefix[start]!;
    const tops: number[] = [];
    const heights: number[] = [];
    let cursor = topSpacer;
    for (let i = start; i < end; i++) {
      const top = cursor + this.margin(i);
      tops.push(top);
      heights.push(this.real[i]!);
      cursor = top + this.real[i]!;
    }
    const content = Math.max(this.viewport, cursor + prefix[this.estimate.length]! - prefix[end]!);
    this.geometry.update(this.list, { start, end, topSpacer, tops, heights, bottomTop: cursor }, content, this.viewport, (i) => this.estimate[i]!);
  }
  /** The window for the current view. */
  ensure(following: boolean): void {
    this.range = nextRange(this.range, this.list.entries.length, this.geometry.need(this.viewport), following);
  }
  /** The screen row of an entry's first row. */
  row(key: string): number {
    return this.geometry.box(key)!.top - this.top;
  }
}

describe("anchor compensation on mount", () => {
  function setup() {
    // 500 entries estimated at 2 rows, really 3 (every chunk that mounts is taller than its
    // spacer was); a 20-row viewport.
    const w = new FakeWindow(Array(500).fill(2), Array(500).fill(3), 20);
    const state: ScrollState = { anchor: null, following: true };
    const scroll = new ScrollController(w.geometry, state);
    w.layout();
    scroll.layout();
    return { w, state, scroll };
  }

  test("starts following at the bottom with the tail mounted", () => {
    const { w, scroll } = setup();
    expect(scroll.following).toBe(true);
    expect(w.range).toEqual({ start: 460, end: 500 });
    expect(w.row("e499")).toBe(17); // 3 rows, the last at row 19
  });

  test("PgUp into the spacer: the chunk mounts with other heights, and the entry at the top stays on its screen row", () => {
    const { w, state, scroll } = setup();
    let checked = 0;
    let compensated = 0;
    for (let page = 0; page < 60 && w.top > 0; page++) {
      scroll.page(-1);
      const anchor = state.anchor!;
      const row = w.row(anchor.id);
      const before = w.top;
      w.ensure(false);
      w.layout();
      scroll.layout();
      // The reader's entry (the anchor, the top entry) is where it was on screen.
      expect(w.row(anchor.id)).toBe(row);
      if (w.top !== before) compensated++;
      checked++;
      expect(w.range.end - w.range.start).toBeLessThanOrEqual(WINDOW_SIZES.max);
    }
    expect(checked).toBeGreaterThan(10);
    // Mounting chunks taller than their estimates moved the offset (the compensation ran).
    expect(compensated).toBeGreaterThan(0);
  });

  test("PgUp from the end reaches entry 0 at the top", () => {
    const { w, scroll } = setup();
    for (let page = 0; page < 200; page++) {
      scroll.page(-1);
      w.ensure(false);
      w.layout();
      scroll.layout();
      if (w.top === 0) break;
    }
    expect(w.top).toBe(0);
    expect(w.range.start).toBe(0);
    expect(w.row("e0")).toBe(0);
  });

  test("shorter real heights than estimated: the anchor holds too", () => {
    const w = new FakeWindow(Array(300).fill(4), Array(300).fill(1), 20);
    const state: ScrollState = { anchor: null, following: true };
    const scroll = new ScrollController(w.geometry, state);
    w.layout();
    scroll.layout();
    for (let page = 0; page < 30; page++) {
      scroll.page(-1);
      const anchor = state.anchor!;
      const row = w.row(anchor.id);
      w.ensure(false);
      w.layout();
      scroll.layout();
      if (w.top === 0) break;
      expect(w.row(anchor.id)).toBe(row);
    }
  });

  test("a jump (Home) onto unmounted entries: kept at row 0 through the mount", () => {
    const { w, scroll } = setup();
    scroll.reveal("e0");
    scroll.keep("e0", w.row("e0"));
    w.ensure(false);
    expect(w.range.start).toBe(0);
    w.layout();
    scroll.layout();
    expect(w.top).toBe(0);
    expect(w.row("e0")).toBe(0);
  });
});

// Scenario "A run grows above the reader" (tui-conversation "Reading position kept"): entries above
// the viewport change height as reads join a group line, a group opens, or a density hides the
// entry at the top.
describe("anchor compensation when the entries change (task 3.4)", () => {
  const keysOf = (n: number) => Array.from({ length: n }, (_, i) => `e${i}`);
  /** `e${from}` to `e${to - 1}` as one group line, holding those items; the rest unchanged. */
  function grouped(n: number, from: number, to: number): { list: EntryList; heights: number[] } {
    const run = `group:run:e${from}`;
    const keys = [...keysOf(from), run, ...keysOf(n).slice(to)];
    const holder = new Map<string, number>();
    keysOf(n).forEach((k, i) => holder.set(k, i < from ? i : i < to ? from : i - (to - from) + 1));
    const list = listOf(keys);
    return { list: { ...list, holder }, heights: keys.map((k) => (k === run ? 1 : 2)) };
  }

  function setup(top: string) {
    const n = 400;
    const w = new FakeWindow(Array(n).fill(2), Array(n).fill(2), 20);
    const state: ScrollState = { anchor: null, following: true };
    const scroll = new ScrollController(w.geometry, state);
    w.layout();
    scroll.layout();
    // The reader jumps to `top` and leaves it on the top row.
    scroll.reveal(top);
    scroll.keep(top, 0);
    w.ensure(false);
    w.layout();
    scroll.layout();
    expect(w.row(top)).toBe(0);
    expect(state.following).toBe(false);
    return { n, w, state, scroll };
  }

  test("a read above the viewport joins a run and a group opens again: the top entry stays on the top row", () => {
    const { n, w, state, scroll } = setup("e300");
    const before = w.top;
    // e290 to e294 (five reads, 2 rows each) become one line of 1 row.
    const shut = grouped(n, 290, 295);
    w.replace(shut.list, shut.heights, shut.heights);
    w.layout();
    scroll.layout();
    expect(w.row("e300")).toBe(0);
    expect(w.top).toBeLessThan(before);
    expect(state.following).toBe(false);
    // The group opens: its members come back above the reader, and e300 is still at the top.
    const open = listOf(keysOf(n));
    w.replace(open, Array(n).fill(2), Array(n).fill(2));
    w.layout();
    scroll.layout();
    expect(w.row("e300")).toBe(0);
    expect(w.top).toBe(before);
  });

  test("a density that hides the entry at the top: the line that now holds it takes its place", () => {
    const { n, w, state, scroll } = setup("e292");
    const shut = grouped(n, 290, 295);
    w.replace(shut.list, shut.heights, shut.heights);
    // The component moves the anchor of an entry that left the list to the entry holding it.
    state.anchor = { id: "group:run:e290", offset: 0 };
    w.layout();
    scroll.layout();
    expect(w.row("group:run:e290")).toBe(0);
    expect(state.following).toBe(false);
  });
});
