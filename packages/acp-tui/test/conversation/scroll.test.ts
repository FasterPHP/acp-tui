// Unit tests for the conversation's scroll controller (phase-1a tasks 7.5 and
// 7.6; spec tui-conversation "Scrolling and following", "Reading position
// kept") over a fake geometry: items with heights and margins stacked in a
// content column, a viewport, and an offset clamped like OpenTUI's scroll bar.
import { describe, expect, test } from "bun:test";
import { itemAtRow, ScrollController, type ScrollGeometry, type ScrollPositionReport, type ScrollState } from "../../src/conversation/scroll.ts";

class FakeGeometry implements ScrollGeometry {
  top = 0;
  constructor(
    public items: { id: string; height: number; margin?: number }[],
    public viewport: number,
  ) {}
  private layout() {
    let y = 0;
    const out = new Map<string, { top: number; height: number }>();
    for (const item of this.items) {
      y += item.margin ?? 0;
      out.set(item.id, { top: y, height: item.height });
      y += item.height;
    }
    return { boxes: out, height: Math.max(y, this.viewport) };
  }
  contentHeight = () => this.layout().height;
  viewportHeight = () => this.viewport;
  ids = () => this.items.map((i) => i.id);
  box = (id: string) => this.layout().boxes.get(id) ?? null;
  scrollTop = () => this.top;
  setScrollTop(top: number) {
    this.top = Math.max(0, Math.min(this.contentHeight() - this.viewport, Math.round(top)));
  }
  height(id: string, height: number) {
    this.items.find((i) => i.id === id)!.height = height;
  }
  /** The screen row of an item's first row. */
  row(id: string) {
    return this.box(id)!.top - this.top;
  }
}

/** 100 items of 3 rows each (one blank row above all but the first), a 20-row viewport. */
function setup(viewport = 20) {
  const geometry = new FakeGeometry(
    Array.from({ length: 100 }, (_, i) => ({ id: `i${i + 1}`, height: 3, margin: i === 0 ? 0 : 1 })),
    viewport,
  );
  const state: ScrollState = { anchor: null, following: true };
  const reports: ScrollPositionReport[] = [];
  const scroll = new ScrollController(geometry, state, (p) => reports.push(p));
  scroll.layout();
  return { geometry, state, scroll, reports };
}

describe("following", () => {
  test("starts at the bottom and keeps it as content grows", () => {
    const { geometry, scroll, reports } = setup();
    expect(geometry.top).toBe(geometry.contentHeight() - 20);
    expect(scroll.following).toBe(true);
    geometry.items.push({ id: "new", height: 10, margin: 1 });
    scroll.layout();
    expect(geometry.top).toBe(geometry.contentHeight() - 20);
    expect(reports.at(-1)).toEqual({ following: true, percent: 100, below: 0 });
  });

  test("PgUp stops following and new content does not move the view (Streaming while scrolled up)", () => {
    const { geometry, scroll, reports } = setup();
    const bottom = geometry.top;
    scroll.page(-1);
    expect(geometry.top).toBe(bottom - 18);
    expect(scroll.following).toBe(false);
    expect(reports.at(-1)!.below).toBe(18);
    const top = geometry.top;
    geometry.height("i100", 50);
    scroll.layout();
    expect(geometry.top).toBe(top);
    expect(scroll.following).toBe(false);
  });

  test("PgDn back to the bottom resumes following (Back to following)", () => {
    const { geometry, scroll } = setup();
    scroll.page(-1);
    scroll.page(-1);
    scroll.page(1);
    expect(scroll.following).toBe(false);
    scroll.page(1);
    expect(scroll.following).toBe(true);
    geometry.height("i100", 40);
    scroll.layout();
    expect(geometry.top).toBe(geometry.contentHeight() - 20);
  });

  test("End (toBottom) resumes following", () => {
    const { geometry, scroll } = setup();
    scroll.page(-1);
    scroll.toBottom();
    expect(scroll.following).toBe(true);
    expect(geometry.top).toBe(geometry.contentHeight() - 20);
  });

  test("content that fits the viewport: paging changes nothing and it keeps following", () => {
    const geometry = new FakeGeometry([{ id: "a", height: 3 }], 20);
    const scroll = new ScrollController(geometry, { anchor: null, following: true });
    scroll.layout();
    scroll.page(-1);
    expect([geometry.top, scroll.following]).toEqual([0, true]);
  });
});

describe("anchoring", () => {
  test("height changes above the viewport keep the top item and its row offset", () => {
    const { geometry, scroll } = setup();
    geometry.setScrollTop(geometry.box("i40")!.top + 1);
    scroll.scrolled();
    expect(scroll.anchor).toEqual({ id: "i40", offset: 1 });
    geometry.height("i10", 30);
    geometry.height("i39", 1);
    scroll.layout();
    expect(geometry.top).toBe(geometry.box("i40")!.top + 1);
  });

  test("a resize that reflows the top item keeps it at the top, the offset clamped to its rows", () => {
    const { geometry, scroll } = setup();
    geometry.setScrollTop(geometry.box("i40")!.top + 2);
    scroll.scrolled();
    // Narrower: everything wraps to more rows. Wider: the top item shrinks to one row.
    for (const item of geometry.items) item.height = 5;
    geometry.viewport = 12;
    scroll.layout();
    expect(geometry.top).toBe(geometry.box("i40")!.top + 2);
    geometry.height("i40", 1);
    scroll.layout();
    expect(geometry.top).toBe(geometry.box("i40")!.top);
    expect(itemAtRow(geometry, geometry.top)!.id).toBe("i40");
  });

  test("the offset can sit in the blank row above the top item", () => {
    const { geometry, scroll } = setup();
    geometry.setScrollTop(geometry.box("i40")!.top - 1);
    scroll.scrolled();
    expect(scroll.anchor).toEqual({ id: "i40", offset: -1 });
    geometry.height("i1", 10);
    scroll.layout();
    expect(geometry.top).toBe(geometry.box("i40")!.top - 1);
  });

  test("a resize while following keeps the bottom", () => {
    const { geometry, scroll } = setup();
    for (const item of geometry.items) item.height = 2;
    geometry.viewport = 38;
    scroll.layout();
    expect(geometry.top).toBe(geometry.contentHeight() - 38);
    expect(scroll.following).toBe(true);
  });
});

describe("toggles and reveal", () => {
  test("a toggled item on screen keeps its first row on the same screen row, expanding and collapsing", () => {
    const { geometry, scroll } = setup();
    geometry.setScrollTop(geometry.box("i30")!.top);
    scroll.scrolled();
    const row = geometry.row("i33");
    expect(row).toBe(12);
    scroll.beforeToggle("i33");
    geometry.height("i33", 40);
    scroll.layout();
    expect(geometry.row("i33")).toBe(row);
    scroll.beforeToggle("i33");
    geometry.height("i33", 3);
    scroll.layout();
    expect(geometry.row("i33")).toBe(row);
  });

  test("toggling while following keeps the item's row too (then follows only if at the bottom)", () => {
    const { geometry, scroll } = setup();
    const row = geometry.row("i98");
    scroll.beforeToggle("i98");
    geometry.height("i98", 30);
    scroll.layout();
    expect(geometry.row("i98")).toBe(row);
    expect(scroll.following).toBe(false);
  });

  test("with reveal (Ctrl+O), the item's row is kept unless the expansion does not fit below it", () => {
    const { geometry, scroll } = setup();
    // The last item, following: expanding it scrolls just enough to show all of it.
    scroll.beforeToggle("i100", true);
    geometry.height("i100", 10);
    scroll.layout();
    expect(geometry.row("i100")).toBe(10);
    expect(scroll.following).toBe(true);
    // Taller than the viewport: its first row goes to the top.
    scroll.beforeToggle("i100", true);
    geometry.height("i100", 30);
    scroll.layout();
    expect(geometry.row("i100")).toBe(0);
    // Room below it: the row stays.
    geometry.setScrollTop(geometry.box("i50")!.top);
    scroll.scrolled();
    scroll.beforeToggle("i51", true);
    geometry.height("i51", 6);
    scroll.layout();
    expect(geometry.row("i51")).toBe(4);
  });

  test("an item toggled off screen is brought into view (Ctrl+O on an earlier tool call)", () => {
    const { geometry, scroll } = setup();
    scroll.beforeToggle("i50");
    geometry.height("i50", 8);
    scroll.layout();
    expect(scroll.visible("i50")).toBe(true);
    expect(geometry.row("i50")).toBe(0);
  });

  test("reveal: the least scroll that shows the item's first row and as much of it as fits", () => {
    const { geometry, scroll } = setup();
    const bottom = geometry.top;
    scroll.reveal("i100");
    expect(geometry.top).toBe(bottom);
    scroll.reveal("i90");
    expect(geometry.row("i90")).toBe(0);
    geometry.setScrollTop(0);
    scroll.scrolled();
    scroll.reveal("i10");
    expect(geometry.row("i10")).toBe(20 - 3);
    geometry.height("i20", 50);
    scroll.reveal("i20");
    expect(geometry.row("i20")).toBe(0);
  });

  test("visibleRange lists the first and last items with a visible row", () => {
    const { geometry, scroll } = setup();
    geometry.setScrollTop(geometry.box("i10")!.top + 2);
    scroll.scrolled();
    expect(scroll.visibleRange()).toEqual({ first: "i10", last: "i15" });
  });
});

/** A scroll box mounted since the last frame (a switch remounts the conversation): Yoga's computed
 *  sizes are NaN until it is laid out, and the offset, like OpenTUI's scroll bar, keeps a NaN it is
 *  given. */
class UnlaidGeometry implements ScrollGeometry {
  laidOut = false;
  constructor(readonly inner: FakeGeometry) {}
  get top() {
    return this.inner.top;
  }
  contentHeight = () => (this.laidOut ? this.inner.contentHeight() : NaN);
  viewportHeight = () => (this.laidOut ? this.inner.viewportHeight() : NaN);
  ids = () => this.inner.ids();
  box = (id: string) => {
    const box = this.inner.box(id);
    return box && !this.laidOut ? { top: NaN, height: NaN } : box;
  };
  scrollTop = () => this.inner.top;
  setScrollTop(top: number) {
    this.inner.top = Math.max(0, Math.min(this.contentHeight() - this.viewportHeight(), Math.round(top)));
  }
}

describe("before the first layout (IDE check 10.2)", () => {
  /** A remounted conversation: the history loaded, nothing laid out yet. */
  function unlaid() {
    const inner = new FakeGeometry(
      Array.from({ length: 30 }, (_, i) => ({ id: `i${i + 1}`, height: 3, margin: i === 0 ? 0 : 1 })),
      20,
    );
    const geometry = new UnlaidGeometry(inner);
    const state: ScrollState = { anchor: null, following: true };
    const reports: ScrollPositionReport[] = [];
    const scroll = new ScrollController(geometry, state, (p) => reports.push(p));
    const sane = () => reports.every((r) => !Number.isNaN(r.percent) && !Number.isNaN(r.below));
    return { inner, geometry, state, scroll, reports, sane };
  }

  test("End (toBottom, as at the end of a load) writes no NaN and keeps following; the first layout shows the bottom", () => {
    const { inner, geometry, scroll, reports, sane } = unlaid();
    scroll.toBottom();
    expect(geometry.top).not.toBeNaN();
    expect(scroll.following).toBe(true);
    geometry.laidOut = true;
    scroll.layout();
    expect(geometry.top).toBe(inner.contentHeight() - 20);
    expect(reports.at(-1)).toEqual({ following: true, percent: 100, below: 0 });
    expect(sane()).toBe(true);
  });

  test("paging, a reveal and a reader's scroll write no NaN; the reveal is applied by the first layout", () => {
    const { inner, geometry, scroll, sane } = unlaid();
    scroll.page(-1);
    scroll.scrolled();
    scroll.reveal("i3");
    expect(geometry.top).not.toBeNaN();
    expect(scroll.visible("i3")).toBe(false);
    expect(scroll.visibleRange()).toBeNull();
    geometry.laidOut = true;
    scroll.layout();
    expect(inner.row("i3")).toBe(0);
    expect(sane()).toBe(true);
  });
});
