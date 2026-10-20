// Scrolling, following and anchoring for the conversation (design D9; spec
// tui-conversation "Scrolling and following", "Reading position kept").
//
// OpenTUI's own sticky scroll is not used: it cannot keep a scrolled-up
// reader's item in place when heights above the viewport change, and it
// re-engages one row short of the bottom. Instead `ScrollController` owns the
// scroll offset:
//
// - After every layout (`layout()`, called from the scroll box's update step,
//   once Yoga has computed the frame's layout and before the content is
//   positioned, so the correction lands in the same frame): while following,
//   the bottom is kept; otherwise the recorded anchor (the top visible item
//   and the row of it at the top) is put back; a toggled item keeps its first
//   row on the same screen row; a requested item is revealed. Then the anchor
//   is recorded again from the result.
// - Key scrolling (`page`, `toBottom`, `reveal`) acts on the last layout at
//   once and records the anchor, so the next layout keeps it.
// - Any other scroll (the wheel) arrives as `scrolled()`. The wheel itself is
//   handled by `ConversationScrollBox`: each report scrolls the rows of the
//   terminal's wheel step (renderer/wheel.ts), fractions carried.
//
// Following means "at the bottom": it holds while the last row is visible and
// resumes whenever a scroll or a layout lands there. The controller is pure
// over `ScrollGeometry`, so it is unit tested without a renderer.
import { ScrollBoxRenderable, type MouseEvent, type RenderContext, type ScrollBoxOptions } from "@opentui/core";
import { DEFAULT_WHEEL, WheelAccumulator } from "../renderer/wheel.ts";
import type { Anchor } from "./view-model.ts";

/** What the controller reads and writes; positions are content rows. */
export interface ScrollGeometry {
  contentHeight(): number;
  viewportHeight(): number;
  /** Mounted item ids in order. */
  ids(): readonly string[];
  /** An item's top (after its margin) and height in the content, or null if not mounted. */
  box(id: string): { top: number; height: number } | null;
  scrollTop(): number;
  /** Sets the scroll offset (the geometry clamps it to the content). */
  setScrollTop(top: number): void;
}

export interface ScrollState {
  anchor: Anchor | null;
  following: boolean;
}

export interface ScrollPositionReport {
  following: boolean;
  /** Share of the content above the bottom of the viewport, 0 to 100. */
  percent: number;
  /** Rows below the viewport. */
  below: number;
}

/** The item containing content row `row`, or the first one below it (rows between items are
 *  margins); null when there is none. */
export function itemAtRow(geometry: ScrollGeometry, row: number): { id: string; top: number; height: number } | null {
  const ids = geometry.ids();
  let lo = 0;
  let hi = ids.length - 1;
  let found: { id: string; top: number; height: number } | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const box = geometry.box(ids[mid]!);
    if (!box) return null;
    if (box.top + box.height > row) {
      found = { id: ids[mid]!, ...box };
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return found;
}

export class ScrollController {
  private pendingToggle: { id: string; row: number } | null = null;
  private pendingReveal: string | null = null;

  constructor(
    private readonly geometry: ScrollGeometry,
    /** Where the anchor and the following flag live (the view model, so a remount keeps them). */
    private readonly state: ScrollState,
    /** Called with the new position after every change. */
    private readonly onPosition: (position: ScrollPositionReport) => void = () => {},
  ) {}

  get following(): boolean {
    return this.state.following;
  }

  get anchor(): Anchor | null {
    return this.state.anchor;
  }

  /**
   * False until the scroll box has been laid out: Yoga's computed sizes are NaN for a box mounted
   * since the last frame (the conversation is mounted afresh by a switch, and a short load can end
   * before its first frame). Nothing is read or written then, since a NaN offset would stick in
   * OpenTUI's scroll bar and every later layout would keep it (IDE check 10.2); the request is
   * left for the first layout instead.
   */
  private laidOut(): boolean {
    return Number.isFinite(this.geometry.contentHeight()) && Number.isFinite(this.geometry.viewportHeight());
  }

  private max(): number {
    return Math.max(0, this.geometry.contentHeight() - this.geometry.viewportHeight());
  }

  private clamp(top: number): number {
    return Math.max(0, Math.min(this.max(), Math.round(top)));
  }

  /** Records the anchor and the following flag from the current offset. */
  private record(): void {
    const top = this.geometry.scrollTop();
    this.state.following = top >= this.max();
    const item = itemAtRow(this.geometry, top);
    this.state.anchor = item ? { id: item.id, offset: top - item.top } : null;
    this.report();
  }

  private report(): void {
    const top = this.geometry.scrollTop();
    const content = this.geometry.contentHeight();
    const viewport = this.geometry.viewportHeight();
    const below = Math.max(0, this.max() - top);
    const percent = content <= 0 ? 100 : Math.min(100, ((top + viewport) / content) * 100);
    this.onPosition({ following: this.state.following, percent, below });
  }

  private set(top: number): void {
    this.geometry.setScrollTop(this.clamp(top));
  }

  /** The offset that brings `id` into view from `top`: its first row, and as much of it as fits. */
  private revealFrom(top: number, id: string): number {
    const box = this.geometry.box(id);
    if (!box) return top;
    const viewport = this.geometry.viewportHeight();
    const shown = Math.min(box.height, viewport);
    if (box.top < top) return box.top;
    if (box.top + shown > top + viewport) return box.top + shown - viewport;
    return top;
  }

  /** After a layout: keep the bottom, the toggled item's row or the anchor; reveal; record. */
  layout(): void {
    if (!this.laidOut()) return;
    let top = this.geometry.scrollTop();
    const toggle = this.pendingToggle;
    const box = toggle ? this.geometry.box(toggle.id) : null;
    if (toggle && box) {
      top = box.top - toggle.row;
    } else if (this.state.following) {
      top = this.max();
    } else if (this.state.anchor) {
      const anchored = this.geometry.box(this.state.anchor.id);
      if (anchored) top = anchored.top + Math.min(this.state.anchor.offset, Math.max(0, anchored.height - 1));
    }
    if (this.pendingReveal) top = this.revealFrom(this.clamp(top), this.pendingReveal);
    this.pendingToggle = null;
    this.pendingReveal = null;
    this.set(top);
    this.record();
  }

  /** PgUp and PgDn: by the viewport height less two rows. */
  page(direction: -1 | 1): void {
    if (!this.laidOut()) return;
    const step = Math.max(1, this.geometry.viewportHeight() - 2);
    this.set(this.geometry.scrollTop() + direction * step);
    this.record();
  }

  /** End: to the bottom, following again (before the first layout: that layout keeps it). */
  toBottom(): void {
    if (!this.laidOut()) {
      this.restore(null, true);
      return;
    }
    this.set(this.max());
    this.record();
  }

  /** Scrolls the least needed to show `id`'s first row (and as much of it as fits); before the
   *  first layout, that layout does. */
  reveal(id: string): void {
    if (!this.laidOut()) {
      this.requestReveal(id);
      return;
    }
    this.set(this.revealFrom(this.geometry.scrollTop(), id));
    this.record();
  }

  /** Puts a recorded reading position back, dropping any pending toggle or reveal; the next
   *  layout applies it (Esc in the find bar). */
  restore(anchor: Anchor | null, following: boolean): void {
    this.pendingToggle = null;
    this.pendingReveal = null;
    this.state.anchor = anchor;
    this.state.following = following;
  }

  /** The next layout scrolls the least needed to show `id` (as `reveal`, but on that layout's
   *  heights: for an item whose height is about to change, as find's). */
  requestReveal(id: string): void {
    this.pendingToggle = null;
    this.pendingReveal = id;
  }

  /**
   * Call before toggling `id`. When its first row is on screen, the next layout keeps that row on
   * the same screen row (spec tui-conversation "Reading position kept"); with `reveal` it then
   * scrolls, if it must, to show as much of the item as fits with that row still in view (Ctrl+O:
   * "expands and is scrolled into view"). An item off screen is brought into view.
   */
  beforeToggle(id: string, reveal = false): void {
    const box = this.geometry.box(id);
    const row = box ? box.top - this.geometry.scrollTop() : -1;
    const onScreen = box !== null && row >= 0 && row < this.geometry.viewportHeight();
    if (onScreen) this.keep(id, row, reveal);
    else {
      this.pendingToggle = null;
      this.pendingReveal = id;
    }
  }

  /** The next layout puts `id`'s first row on screen row `row` (which may be above the viewport),
   *  then, with `reveal`, scrolls if it must to show as much of it as fits. */
  keep(id: string, row: number, reveal = false): void {
    this.pendingToggle = { id, row };
    this.pendingReveal = reveal ? id : null;
  }

  /** The offset changed by other means (the wheel): record it. */
  scrolled(): void {
    if (this.laidOut()) this.record();
  }

  /** Whether any row of `id` is visible. */
  visible(id: string): boolean {
    if (!this.laidOut()) return false;
    const box = this.geometry.box(id);
    if (!box) return false;
    const top = this.geometry.scrollTop();
    return box.top + box.height > top && box.top < top + this.geometry.viewportHeight();
  }

  /** The first and last items with a row in the viewport, or null when none has. */
  visibleRange(): { first: string; last: string } | null {
    if (!this.laidOut()) return null;
    const top = this.geometry.scrollTop();
    const bottom = top + this.geometry.viewportHeight();
    const first = itemAtRow(this.geometry, top);
    if (!first || first.top >= bottom) return null;
    const ids = this.geometry.ids();
    let last = first.id;
    for (let i = ids.indexOf(first.id) + 1; i < ids.length; i++) {
      const box = this.geometry.box(ids[i]!);
      if (!box || box.top >= bottom) break;
      last = ids[i]!;
    }
    return { first: first.id, last };
  }
}

/**
 * A ScrollBox that calls `onLayout` once per frame, after Yoga has computed the frame's layout
 * and the viewport has taken its new size, and before the content takes its position and lays
 * out its children, so a scroll correction made there is drawn in the same frame.
 *
 * Why the content's update step: when the viewport changes size (a docked card, a growing
 * prompt box), the ScrollBox recalculates its scroll bar in the viewport's update, while the
 * content still has the previous frame's height, and clamps the offset to the stale range. The
 * content's update step comes after that and before the content's own recalculation, so the
 * offset set there survives. `layingOut` is true from the ScrollBox's update step until then;
 * offset changes in between are that clamp, not a reader's scroll.
 */
export class ConversationScrollBox extends ScrollBoxRenderable {
  onLayout: (() => void) | null = null;
  layingOut = false;
  /** Rows per wheel report; the conversation sets it from the terminal's wheel step. */
  wheel = new WheelAccumulator(DEFAULT_WHEEL.rows);

  constructor(ctx: RenderContext, options: ScrollBoxOptions) {
    super(ctx, options);
    // The content renderable is the ScrollBox's own; its update step is wrapped on the instance.
    const content = this.content as unknown as { onUpdate(deltaTime: number): void };
    const update = content.onUpdate.bind(content);
    content.onUpdate = (deltaTime: number) => {
      update(deltaTime);
      if (!this.layingOut) return;
      this.layingOut = false;
      this.onLayout?.();
    };
  }

  protected override onUpdate(deltaTime: number): void {
    super.onUpdate(deltaTime);
    this.layingOut = true;
  }

  /**
   * The wheel (spec tui-screen "Wheel step per terminal", "JetBrains mouse input is harmless"):
   * vertical only, by the wheel step, without OpenTUI's speed-based acceleration. JediTerm's codes
   * 68 and 69 are 64 and 65 with the shift bit, which OpenTUI's ScrollBox would turn into a
   * horizontal scroll; here they scroll up and down like any wheel report.
   */
  protected override onMouseEvent(event: MouseEvent): void {
    if (event.type !== "scroll") {
      super.onMouseEvent(event);
      return;
    }
    const direction = event.scroll?.direction;
    if (direction !== "up" && direction !== "down") return;
    const rows = this.wheel.add(direction === "up" ? -1 : 1);
    if (rows !== 0) this.scrollTop += rows;
  }
}
