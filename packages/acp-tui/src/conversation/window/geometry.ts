// The scroll controller's geometry (scroll.ts `ScrollGeometry`) over every
// entry of the windowed list, mounted or not (range.ts `virtualTops`). It is a
// snapshot taken after each layout: between frames (several PageUps in one
// input chunk, a key handler that changes the window) it keeps answering for
// the tree Yoga last laid out, never for nodes that were added or destroyed
// since, so the controller's arithmetic stays consistent until the next
// layout replaces the snapshot (design of record 6.2).
import type { ScrollGeometry } from "../scroll.ts";
import type { EntryList } from "./entries.ts";
import { indexAtRow, virtualTops, type MountedLayout, type Range } from "./range.ts";

/** Where the scroll offset lives (the scroll box, or a fake in tests). */
export interface ScrollPort {
  scrollTop(): number;
  /** Sets the offset; `content` and `viewport` are this snapshot's sizes, for the clamp. */
  setScrollTop(top: number, content: number, viewport: number): void;
}

export const EMPTY_LIST: EntryList = { entries: [], keys: [], index: new Map(), holder: new Map() };

export class WindowGeometry implements ScrollGeometry {
  /** The entries as last laid out. */
  list: EntryList = EMPTY_LIST;
  /** The mounted slice as last laid out. */
  mounted: Range = { start: 0, end: 0 };
  /** Whether a layout has been recorded. */
  ready = false;
  private tops: Float64Array = new Float64Array(0);
  private heights: Float64Array = new Float64Array(0);
  private content = 0;
  private viewport = 0;

  constructor(private readonly port: ScrollPort) {}

  /** Records a layout: the list laid out, Yoga's mounted slice and sizes, and the height of each
   *  unmounted entry (the cache or an estimate). */
  update(list: EntryList, mounted: MountedLayout, contentHeight: number, viewportHeight: number, height: (i: number) => number): void {
    const { tops, heights } = virtualTops(list.entries.length, mounted, (i) => list.entries[i]!.margin, height);
    this.list = list;
    this.mounted = { start: mounted.start, end: mounted.end };
    this.tops = tops;
    this.heights = heights;
    this.content = contentHeight;
    this.viewport = viewportHeight;
    this.ready = true;
  }

  contentHeight = (): number => this.content;
  viewportHeight = (): number => this.viewport;
  ids = (): readonly string[] => this.list.keys;

  box(id: string): { top: number; height: number } | null {
    const i = this.list.index.get(id);
    return i === undefined ? null : { top: this.tops[i]!, height: this.heights[i]! };
  }

  scrollTop = (): number => this.port.scrollTop();

  setScrollTop(top: number): void {
    this.port.setScrollTop(top, this.content, this.viewport);
  }

  /** The entry containing content row `row` (or the first below it); the entry count if none. */
  indexAt(row: number): number {
    return indexAtRow(this.tops, this.heights, row);
  }

  /** The entries overlapping the viewport widened by `margin` rows above and below. */
  need(margin: number): Range {
    const n = this.list.entries.length;
    if (n === 0) return { start: 0, end: 0 };
    const top = this.scrollTop();
    const first = Math.min(n - 1, this.indexAt(Math.max(0, top - margin)));
    const last = Math.min(n - 1, this.indexAt(top + this.viewport + margin - 1));
    return { start: first, end: Math.max(first, last) + 1 };
  }
}
