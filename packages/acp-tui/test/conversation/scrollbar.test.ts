// The conversation scroll bar's pure parts (src/conversation/scrollbar.ts; mvp-chrome-and-keys
// design D17, spec tui-layout "Conversation scrollbar" and "Scrollbar drag"): the thumb and the
// offset, the track press, and the relative drag with its speed, precision, floor, carry and ends.
import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { CliRenderEvents, type CliRenderer } from "@opentui/core";
import {
  chainIntercepts,
  createScrollbar,
  DRAG,
  dragMove,
  DragSpeed,
  maxScroll,
  MIN_THUMB_ROWS,
  offsetForStart,
  precision,
  pressAt,
  proportionalStep,
  speedStep,
  thumbSize,
  thumbStart,
  type BarMetrics,
} from "../../src/conversation/scrollbar.ts";
import type { MouseReport } from "../../src/renderer/mouse.ts";
import type { DebugLogEntry, DebugLogger } from "../../src/log.ts";
import type { ConversationScrollBox } from "../../src/conversation/scroll.ts";

/** A 5000-item conversation in a 24-row viewport (about 60000 content rows). */
const LONG: BarMetrics = { track: 24, content: 60000, viewport: 24 };
const LAST = LONG.track - 1;
const MIDDLE = Math.round(maxScroll(LONG) / 2);

describe("thumb size", () => {
  test("nothing to scroll: no thumb", () => {
    expect(thumbSize({ track: 24, content: 10, viewport: 24 })).toBe(0);
    expect(thumbSize({ track: 24, content: 24, viewport: 24 })).toBe(0);
  });

  test("the viewport's share of the content, at least MIN_THUMB_ROWS, less than the track", () => {
    expect(thumbSize(LONG)).toBe(MIN_THUMB_ROWS);
    expect(thumbSize({ track: 20, content: 40, viewport: 20 })).toBe(10);
    expect(thumbSize({ track: 20, content: 21, viewport: 20 })).toBe(19);
    expect(thumbSize({ track: 2, content: 100, viewport: 2 })).toBe(1);
    expect(thumbSize({ track: 1, content: 100, viewport: 1 })).toBe(1);
  });
});

describe("thumb position and offset", () => {
  test("the ends: offset 0 is the first row, the bottom offset the last position, and back", () => {
    const last = LONG.track - thumbSize(LONG);
    expect(thumbStart(LONG, 0)).toBe(0);
    expect(thumbStart(LONG, maxScroll(LONG))).toBe(last);
    expect(offsetForStart(LONG, 0)).toBe(0);
    expect(offsetForStart(LONG, last)).toBe(maxScroll(LONG));
  });

  test("past either end of the track the offset is clamped", () => {
    expect(offsetForStart(LONG, -5)).toBe(0);
    expect(offsetForStart(LONG, 999)).toBe(maxScroll(LONG));
  });

  test("proportional over the whole content: the middle position is the middle offset", () => {
    const last = LONG.track - thumbSize(LONG);
    expect(last).toBe(22);
    expect(offsetForStart(LONG, 11)).toBe(MIDDLE);
    expect(thumbStart(LONG, MIDDLE)).toBe(11);
  });

  test("an offset short of the bottom never shows the thumb at the bottom, nor one past the top at the top", () => {
    const last = LONG.track - thumbSize(LONG);
    expect(thumbStart(LONG, maxScroll(LONG) - 1)).toBe(last - 1);
    expect(thumbStart(LONG, 1)).toBe(1);
  });

  test("every position maps to an offset that maps back to it", () => {
    const last = LONG.track - thumbSize(LONG);
    for (let start = 0; start <= last; start++) expect(thumbStart(LONG, offsetForStart(LONG, start))).toBe(start);
  });

  test("nothing to scroll: offset 0 wherever the thumb would go", () => {
    const short = { track: 24, content: 10, viewport: 24 };
    expect(offsetForStart(short, 5)).toBe(0);
    expect(thumbStart(short, 0)).toBe(0);
  });
});

describe("track press", () => {
  test("a press on the thumb grabs it and does not jump", () => {
    const start = thumbStart(LONG, MIDDLE);
    expect(pressAt(LONG, MIDDLE, start + 1)).toEqual({ jump: null });
  });

  test("a press on the track jumps the thumb's middle to the pressed row", () => {
    const press = pressAt(LONG, maxScroll(LONG), 5);
    expect(press.jump).toBe(offsetForStart(LONG, 4));
    expect(thumbStart(LONG, press.jump!)).toBe(4);
    // At the top row the thumb goes to the top.
    expect(pressAt(LONG, maxScroll(LONG), 0).jump).toBe(0);
  });

  test("nothing to scroll: a press jumps nowhere", () => {
    expect(pressAt({ track: 24, content: 10, viewport: 24 }, 0, 3)).toEqual({ jump: null });
  });
});

describe("the drag's tunables (design D17)", () => {
  test("one DRAG constant holds the starting values", () => {
    expect(DRAG).toEqual({ FINE: 3, SLOW: 6, FAST: 30, DEAD: 2, HALF: 4, FLOOR: 1, WINDOW_MS: 100 });
  });
});

describe("Scrollbar drag", () => {
  test("proportional step: the rows ahead over the pointer's cells ahead, before the move", () => {
    // From the middle offset with the pointer on row 11: 11 cells up, 12 down.
    expect(proportionalStep(LONG, MIDDLE, 11, false)).toBeCloseTo(MIDDLE / 11, 6);
    expect(proportionalStep(LONG, MIDDLE, 11, true)).toBeCloseTo((maxScroll(LONG) - MIDDLE) / 12, 6);
    // On a fresh press at the top this is the absolute mapping's step: the whole range over the track.
    expect(proportionalStep(LONG, 0, 0, true)).toBeCloseTo(maxScroll(LONG) / LAST, 6);
  });

  test("slow step: 3 rows per cell at 3 cells per second over 5000 items", () => {
    let t = 0;
    const speed = new DragSpeed(() => t);
    speed.start(11);
    let offset = MIDDLE;
    let row = 11;
    let carry = 0;
    for (let i = 0; i < 5; i++) {
      t += 1000 / 3;
      const v = speed.add(row + 1);
      expect(v).toBeCloseTo(3, 6);
      const move = dragMove(LONG, offset, row, row + 1, 0, v, carry);
      expect(move.step).toBe(3);
      expect(move.offset - offset).toBe(3);
      ({ offset, carry } = move);
      row++;
    }
    expect(offset - MIDDLE).toBe(15);
  });

  test("fast step: the proportional one, ending exactly at the bottom", () => {
    let offset = 0;
    let carry = 0;
    for (let row = 0; row < LAST; row++) {
      const move = dragMove(LONG, offset, row, row + 1, 0, 100, carry);
      if (row + 1 < LAST) expect(move.step).toBeCloseTo(proportionalStep(LONG, offset, row, true), 6);
      ({ offset, carry } = move);
    }
    expect(offset).toBe(maxScroll(LONG));
    // A fresh fast drag from the top lands where the absolute mapping put the pointer's row.
    const first = dragMove(LONG, 0, 0, 5, 0, 100, 0);
    expect(Math.abs(first.offset - (5 * maxScroll(LONG)) / LAST)).toBeLessThan(1);
  });

  test("interpolation midpoint: 18 cells per second gives the mean of the fine and proportional steps", () => {
    const proportional = proportionalStep(LONG, MIDDLE, 11, true);
    expect(speedStep(proportional, 18)).toBeCloseTo((DRAG.FINE + proportional) / 2, 6);
    expect(dragMove(LONG, MIDDLE, 11, 12, 0, 18, 0).step).toBeCloseTo((DRAG.FINE + proportional) / 2, 6);
    // At or below SLOW the fine step, at or above FAST the proportional one.
    expect(speedStep(proportional, DRAG.SLOW)).toBe(DRAG.FINE);
    expect(speedStep(proportional, DRAG.FAST)).toBe(proportional);
    // The fine step never exceeds the proportional one.
    expect(speedStep(1.5, 1)).toBe(1.5);
  });

  test("precision factor: 1 at d 0 to 2, 0.25 at d 10, 1/16 at d 18", () => {
    for (const d of [0, 1, 2]) expect(precision(d)).toBe(1);
    expect(precision(6)).toBe(0.5);
    expect(precision(10)).toBe(0.25);
    expect(precision(18)).toBe(1 / 16);
    const proportional = proportionalStep(LONG, MIDDLE, 11, true);
    expect(dragMove(LONG, MIDDLE, 11, 12, 10, 100, 0).step).toBeCloseTo(proportional / 4, 6);
    // Back over the bar the full step returns at once.
    expect(dragMove(LONG, MIDDLE, 11, 12, 0, 100, 0).step).toBeCloseTo(proportional, 6);
  });

  test("floor: never below 1 row per cell", () => {
    // A slow drag far left of the bar: 3 / 2^4 rows would be under a row per cell.
    const move = dragMove(LONG, MIDDLE, 11, 12, 18, 1, 0);
    expect(move.step).toBe(DRAG.FLOOR);
    expect(move.offset - MIDDLE).toBe(1);
    // A conversation barely taller than the viewport: the proportional step is under a row.
    const short = { track: 20, content: 25, viewport: 20 };
    expect(dragMove(short, 2, 5, 6, 0, 100, 0).step).toBe(1);
  });

  test("carried remainder: fractions add up over reports instead of stalling", () => {
    // A slow drag 6 columns left of the bar: FINE (3) halved, 1.5 rows per cell.
    const m: BarMetrics = { track: 20, content: 1000, viewport: 20 };
    const a = dragMove(m, 100, 5, 6, 6, 1, 0);
    expect(a.step).toBe(1.5);
    expect(a.offset).toBe(101);
    expect(a.carry).toBeCloseTo(0.5, 6);
    const b = dragMove(m, a.offset, 6, 7, 6, 1, a.carry);
    expect(b.offset).toBe(103);
    expect(b.carry).toBeCloseTo(0, 6);
    // Upwards the carry counts the same way (a negative fraction).
    const c = dragMove(m, 100, 7, 6, 6, 1, 0);
    expect(c.offset).toBe(99);
    expect(c.carry).toBeCloseTo(-0.5, 6);
    expect(dragMove(m, c.offset, 6, 5, 6, 1, c.carry).offset).toBe(97);
  });

  test("both ends: at or beyond the track's first row the top, at or beyond its last the bottom, whatever the speed and distance", () => {
    for (const [speed, d] of [
      [1, 0],
      [100, 0],
      [1, 18],
    ] as const) {
      expect(dragMove(LONG, MIDDLE, 3, 0, d, speed, 0.4).offset).toBe(0);
      expect(dragMove(LONG, MIDDLE, 3, -4, d, speed, 0).offset).toBe(0);
      expect(dragMove(LONG, MIDDLE, 20, LAST, d, speed, 0).offset).toBe(maxScroll(LONG));
      expect(dragMove(LONG, MIDDLE, 20, LAST + 5, d, speed, 0).offset).toBe(maxScroll(LONG));
      expect(dragMove(LONG, MIDDLE, 20, LAST, d, speed, 0.7).carry).toBe(0);
    }
  });

  test("movement outside the track does not count: back in from below, the step starts at the last row", () => {
    // The pointer went below the track (the bottom), then comes back up to row LAST - 2.
    const move = dragMove(LONG, maxScroll(LONG), LAST + 6, LAST - 2, 0, 1, 0);
    expect(move.offset).toBe(maxScroll(LONG) - 2 * DRAG.FINE);
  });

  test("no vertical movement moves nothing and keeps the carry", () => {
    expect(dragMove(LONG, MIDDLE, 11, 11, 4, 100, 0.3)).toEqual({ offset: MIDDLE, carry: 0.3, step: 0, proportional: 0 });
  });

  test("nothing to scroll: the offset stays 0", () => {
    expect(dragMove({ track: 24, content: 10, viewport: 24 }, 0, 3, 8, 0, 100, 0).offset).toBe(0);
  });
});

describe("drag speed", () => {
  test("cells per second over the reports of the last 100 ms, from the last report before them", () => {
    let t = 1000;
    const speed = new DragSpeed(() => t);
    speed.start(0);
    // One report every 10 ms, a cell each: 100 cells per second.
    for (let i = 1; i <= 20; i++) {
      t += 10;
      expect(speed.add(i)).toBeCloseTo(100, 6);
    }
    // Two reports in one read (the same millisecond): no division by zero, still fast.
    const same = speed.add(21);
    expect(Number.isFinite(same)).toBe(true);
    expect(same).toBeGreaterThan(DRAG.FAST);
    // A pause, then one cell: slow again, measured since the last report.
    t += 500;
    expect(speed.add(22)).toBeCloseTo(2, 6);
  });

  test("the first report is measured from the press", () => {
    let t = 0;
    const speed = new DragSpeed(() => t);
    speed.start(5);
    t += 300;
    expect(speed.add(6)).toBeCloseTo(1000 / 300, 6);
  });
});

describe("chainIntercepts", () => {
  test("the scroll bar's hook runs first and hands on to the selection's, which hands on to OpenTUI", () => {
    const calls: string[] = [];
    const report = { type: "down", button: 0, x: 1, y: 1, modifiers: { shift: false, alt: false, ctrl: false } } satisfies MouseReport;
    const chained = chainIntercepts(
      (r, next) => {
        calls.push("bar");
        return next(r);
      },
      (r, dispatch) => {
        calls.push("selection");
        return dispatch(r);
      },
    );
    expect(chained(report, () => (calls.push("opentui"), true))).toBe(true);
    expect(calls).toEqual(["bar", "selection", "opentui"]);
  });
});

/**
 * A stand-in for the conversation's scroll box: what `createScrollbar` reads and sets (the bar's
 * slider, the sizes, the clamped offset), with the content's height changed by hand as a frame's
 * layout of a streaming reply would change it. The bar is column `BAR_X`, rows 1 to 24.
 */
function fakeBox(content: number, scrollTop: number) {
  const viewport = { x: 2, y: 1, width: 95, height: 24 };
  let top = scrollTop;
  let sets = 0;
  const box = {
    content,
    isDestroyed: false,
    parent: null,
    getChildren: () => [],
    viewport,
    verticalScrollBar: { visible: false, showArrows: true, slider: { x: 99, y: 1, width: 1, height: 24, renderSelf: () => {} } },
    get scrollHeight() {
      return this.content;
    },
    get scrollTop() {
      return top;
    },
    set scrollTop(value: number) {
      sets++;
      top = Math.max(0, Math.min(this.content - viewport.height, value));
    },
    get sets() {
      return sets;
    },
  };
  return box;
}

const BAR_X = 99;
const mouse = (type: string, y: number): MouseReport => ({ type, button: 0, x: BAR_X, y, modifiers: { shift: false, alt: false, ctrl: false } });

describe("frame pacing", () => {
  // The follow-up of 11 October 2026 (docs/mvp-notes/chrome-and-keys.md, "Bench"): the drag reaches
  // the track's last row while the offset of the report before it still waits for its frame, the
  // release comes in the same read, and that frame lays out a taller conversation (a reply
  // streaming). The bottom must be the bottom of the content as that frame laid it out.
  test("a bottom that waits for a frame is the bottom after it, and the release is following", () => {
    const box = fakeBox(1000, 400);
    const frames = new EventEmitter();
    const events: DebugLogEntry[] = [];
    const logger: DebugLogger = { enabled: true, log: (e) => events.push(e) };
    const bar = createScrollbar();
    bar.attach(box as unknown as ConversationScrollBox, {} as never, {} as never, frames as unknown as CliRenderer, logger);
    const m = (): BarMetrics => ({ track: 24, content: box.content, viewport: 24 });
    const next = () => {
      throw new Error("handed on");
    };
    const thumb = 1 + thumbStart(m(), box.scrollTop);
    expect(bar.intercept(mouse("down", thumb), next)).toBe(true);
    // One row above the track's last: set on the box at once; the frame for it is now due.
    bar.intercept(mouse("drag", 23), next);
    expect(box.sets).toBe(1);
    const set = box.scrollTop;
    expect(set).toBeLessThan(maxScroll(m()));
    // The last row and the release, before that frame: nothing more is set on the box.
    bar.intercept(mouse("drag", 24), next);
    bar.intercept(mouse("up", 24), next);
    expect(box.sets).toBe(1);
    expect(box.scrollTop).toBe(set);
    expect(events.some((e) => e["action"] === "release")).toBe(false);
    // The frame lays out ten more rows of the reply, then draws: the bottom is applied now.
    box.content = 1010;
    frames.emit(CliRenderEvents.FRAME);
    expect(box.sets).toBe(2);
    expect(box.scrollTop).toBe(maxScroll(m()));
    // The frame that draws it settles the release: following.
    frames.emit(CliRenderEvents.FRAME);
    const release = events.find((e) => e["action"] === "release")!;
    expect(release["following"]).toBe(true);
    expect(release["moves"]).toBe(3);
  });

  test("an offset short of the bottom that waits for a frame is applied as it was asked for", () => {
    const box = fakeBox(1000, 400);
    const frames = new EventEmitter();
    const events: DebugLogEntry[] = [];
    const bar = createScrollbar();
    bar.attach(box as unknown as ConversationScrollBox, {} as never, {} as never, frames as unknown as CliRenderer, { enabled: true, log: (e) => events.push(e) });
    const next = () => true;
    const thumb = 1 + thumbStart({ track: 24, content: 1000, viewport: 24 }, 400);
    bar.intercept(mouse("down", thumb), next);
    bar.intercept(mouse("drag", thumb + 2), next);
    bar.intercept(mouse("drag", thumb + 4), next);
    bar.intercept(mouse("up", thumb + 4), next);
    const asked = events.filter((e) => e["action"] === "drag").at(-1)!["offset"];
    expect(box.sets).toBe(1);
    box.content = 1010;
    frames.emit(CliRenderEvents.FRAME);
    expect(box.scrollTop).toBe(asked as number);
    frames.emit(CliRenderEvents.FRAME);
    expect(events.find((e) => e["action"] === "release")!["following"]).toBe(false);
  });
});
