// The conversation's scroll bar (mvp-chrome-and-keys design D17; spec tui-layout
// "Conversation scrollbar", "Scrollbar pointer actions" and "Scrollbar drag"),
// promoted from the trial of 7 October 2026 (Marcus: "when there's a lot of
// text to move through, even paging one screen at a time can be slow, so a
// scrollbar is useful"). Created by app/run.tsx always, and shown while the
// layout's `layout.scrollbar` setting is on (the default; mvp-configuration
// task 6.5, switched live by a reload): the conversation's rightmost column,
// with the two-column right margin left of it (WindowedConversation.tsx
// reserves both). With the setting off the bar is hidden, its column goes to
// the text, and a press there is no longer the bar's.
//
// What OpenTUI 0.5.12 offers, and what is used of it. The conversation's
// ScrollBox has a vertical `ScrollBarRenderable`: a `SliderRenderable` track,
// optional arrows (▲ ▼, half a viewport a press, repeating while held; not
// used), a thumb drag, and a track press that jumps the thumb's top to the
// pressed point's share of the track and continues as a drag. Its scroll size
// is the content's height, which for the windowed list is the whole virtual
// conversation (the spacers stand in for the unmounted entries), so the bar
// already measures every entry, mounted or not. Used as it is: its place in the
// layout (the ScrollBox's row, so the viewport is one column narrower, and a
// press there is outside the viewport, where the selection never starts) and
// its `change` event (an offset set on the box reaches the scroll controller
// as the wheel's does). Replaced: the slider's drawing (its `renderSelf`, on
// the instance) and its pointer handling. OpenTUI draws the thumb with
// half-block glyphs and no minimum size, so at 5000 items it is half a cell
// (▀) and hard to see or to grab; its track press cannot reach the bottom
// exactly (a press on the last row lands a few per cent short), so it could not
// resume following; and it has no flat-theme form. Here the thumb is at least
// `MIN_THUMB_ROWS` rows, drawn as whole cells (a fill, so no font seams), and
// the mapping is the pure arithmetic below. While there is nothing to scroll
// the bar is blank (no empty track over the splash or a short session).
//
// The drag is relative (Marcus's verdict on the trial's absolute drag, in Zed
// over 5000 items: "it seems to scroll a whole screen at a time"; he chose a
// speed-sensitive drag combined with precision by moving the pointer away from
// the bar). Each drag report moves the offset by the pointer's vertical
// movement in cells times a step in rows per cell (`dragMove`): the
// proportional step (the rows ahead over the pointer's cells ahead to that end
// of the track), brought down towards `DRAG.FINE` for a slow pointer
// (`DragSpeed`, over the reports of the last `DRAG.WINDOW_MS`) and halved
// every `DRAG.HALF` columns left of the bar beyond `DRAG.DEAD`, never below
// `DRAG.FLOOR`, with the fractional part carried to the next report. The
// thumb is drawn where the offset is, so after a slow or precise drag it may
// sit away from the pointer, as a scrubber's does; the pointer at or beyond
// the track's first or last row is always the top or the bottom (following).
//
// Pointer handling is a mouse hook (`intercept`) ahead of the selection's, in
// renderer/mouse.ts's chain, so the policy check comes first: under `--mouse
// wheel` and `off` (and after F2) no press reaches it and the bar is only an
// indicator. A primary press on the bar (not under an overlay or card) is
// consumed, so it never starts a selection, never clears one, never moves
// keyboard focus and never reaches OpenTUI; the drag and release after it are
// consumed too, wherever the pointer goes (OpenTUI's capture is not relied
// on: it captures whatever is under the first drag report, which a quick
// diagonal move takes off the bar). A press on the thumb grabs it; a press on
// the track jumps the thumb so that its middle is on the pressed row (as
// OpenTUI jumps, not paging towards it); either goes on as a drag. Each new
// offset is set on the box; the conversation's `change` handler records it and
// mounts the window around the new view, as PgUp and the wheel do, at most one
// position per frame (the latest; see `apply`). The bottom offset is following
// again; leaving it shows `scrolled N%`. An offset that waits for a frame at the
// bottom waits as "the bottom", not as a number: it is applied as the bottom of
// the content that frame laid out, which a streaming reply may have made taller.
// Motion without a button never acts on the bar, and the wheel over it is not
// consumed: it reaches the ScrollBox and scrolls as everywhere else.
//
// Colours come from the theme only: `scrollbar.track` and `scrollbar.thumb`,
// surfaces derived from the terminal's colours (theme/derive.ts). Under the
// flat theme the surfaces are the terminal's background, so the bar is drawn
// with the glyph set's `scrollbar.track` and `scrollbar.thumb` glyphs
// (conversation/glyphs.ts) in `muted` instead.
//
// Debug log (`ACP_TUI_LOG`): `scrollbar` events, `action` `press` (`jump`: the
// press was on the track), `drag` per drag report (`row` and `dy` in track
// cells, `d` columns left of the bar, `speed` in cells per second, `step` in
// rows per cell, `proportional`, `from` and `offset`, `max`: the bottom
// offset), and `release` (`moves`, `ms`, `following`, and the drag's step
// range `stepMin` and `stepMax`, null when no report moved it).
import { CliRenderEvents, type CliRenderer, type OptimizedBuffer } from "@opentui/core";
import type { DebugLogger } from "../log.ts";
import type { MouseDispatch, MouseIntercept, MouseReport } from "../renderer/mouse.ts";
import type { ResolvedTheme } from "../theme/index.ts";
import { coveredAt } from "../selection/cells.ts";
import type { ConversationGlyphs } from "./glyphs.ts";
import type { ConversationScrollBox } from "./scroll.ts";

/** The thumb's least height in rows (whole cells), when the track has room for it. */
export const MIN_THUMB_ROWS = 2;

/** A pending offset that means the bottom (see `createScrollbar`'s `apply`). */
const BOTTOM = "bottom";

/**
 * The drag's tunables (design D17), in one place: Marcus judges them in PhpStorm reworked and
 * Zed (task 10.9) and they are tuned there; they are not user settings.
 */
export const DRAG = {
  /** Rows per cell for a slow drag (one wheel notch, a distance the eye can follow). */
  FINE: 3,
  /** Cells per second at or below which the step is `FINE` (a deliberate drag). */
  SLOW: 6,
  /** Cells per second at or above which the step is the proportional one (a flick). */
  FAST: 30,
  /** Columns left of the bar where the step is unchanged (the right margin). */
  DEAD: 2,
  /** Columns further left that halve the step. */
  HALF: 4,
  /** The least rows per cell (the finest a cell report can ask for). */
  FLOOR: 1,
  /** The speed is measured over the reports of this many milliseconds. */
  WINDOW_MS: 100,
} as const;

/** What the bar is drawn from; every value in rows. */
export interface BarMetrics {
  /** Rows of the track (the conversation's height). */
  readonly track: number;
  /** Content rows: the whole virtual conversation, mounted entries and spacers. */
  readonly content: number;
  /** Rows of the viewport. */
  readonly viewport: number;
}

/** The largest offset (the bottom). */
export function maxScroll(m: BarMetrics): number {
  return Math.max(0, m.content - m.viewport);
}

/** The thumb's height in rows: the viewport's share of the content, at least `MIN_THUMB_ROWS`
 *  and less than the track (so it can move); 0 when there is nothing to scroll. */
export function thumbSize(m: BarMetrics): number {
  if (m.track <= 0 || maxScroll(m) <= 0) return 0;
  if (m.track === 1) return 1;
  const proportional = Math.round((m.track * m.viewport) / m.content);
  return Math.max(Math.min(MIN_THUMB_ROWS, m.track - 1), Math.min(m.track - 1, proportional));
}

/** The rows the thumb's top can take: `[0, maxStart]`. */
function maxStart(m: BarMetrics): number {
  return Math.max(0, m.track - thumbSize(m));
}

/**
 * The thumb's top row for `scrollTop`. The last position means the bottom (following) and the
 * first the top, so with room for it (three positions or more) any other offset keeps off both.
 */
export function thumbStart(m: BarMetrics, scrollTop: number): number {
  const range = maxScroll(m);
  const last = maxStart(m);
  if (range <= 0 || last <= 0) return 0;
  if (scrollTop >= range) return last;
  if (scrollTop <= 0) return 0;
  const start = Math.round((scrollTop / range) * last);
  return last >= 2 ? Math.max(1, Math.min(last - 1, start)) : start;
}

/** The offset for the thumb's top on row `start` (clamped to the track): proportional over the
 *  whole content; the last position is exactly the bottom. */
export function offsetForStart(m: BarMetrics, start: number): number {
  const range = maxScroll(m);
  const last = maxStart(m);
  if (range <= 0 || last <= 0) return 0;
  const s = Math.max(0, Math.min(last, start));
  return s >= last ? range : Math.round((s / last) * range);
}

/** A press on track row `row`: for a press off the thumb, the offset to jump to (the thumb's
 *  middle on the row); null on the thumb, or with nothing to scroll. */
export function pressAt(m: BarMetrics, scrollTop: number, row: number): { jump: number | null } {
  const size = thumbSize(m);
  const start = thumbStart(m, scrollTop);
  if (size === 0) return { jump: null };
  if (row >= start && row < start + size) return { jump: null };
  return { jump: offsetForStart(m, row - Math.floor(size / 2)) };
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * The proportional step in rows per cell: the rows still ahead in the direction of travel over
 * the pointer's cells still ahead to that end of the track, from `row` (clamped to the track)
 * before the move. On a fresh press this is the absolute mapping's step; after slower travel it
 * catches up, so the pointer reaching an end of the track reaches that end of the conversation.
 */
export function proportionalStep(m: BarMetrics, offset: number, row: number, down: boolean): number {
  const range = maxScroll(m);
  const last = Math.max(0, m.track - 1);
  const r = clamp(row, 0, last);
  const cells = down ? last - r : r;
  const rows = down ? range - clamp(offset, 0, range) : clamp(offset, 0, range);
  return cells <= 0 ? range : rows / cells;
}

/** The step for the pointer's vertical speed (cells per second): at or below `SLOW` the fine
 *  step (or the proportional one if smaller), at or above `FAST` the proportional one, linear in
 *  speed between. */
export function speedStep(proportional: number, speed: number): number {
  const fine = Math.min(DRAG.FINE, proportional);
  if (speed <= DRAG.SLOW) return fine;
  if (speed >= DRAG.FAST) return proportional;
  return fine + ((proportional - fine) * (speed - DRAG.SLOW)) / (DRAG.FAST - DRAG.SLOW);
}

/** The precision factor for a pointer `d` columns left of the bar: 1 over the bar and the margin
 *  (`d` 0 to `DEAD`), then halved every `HALF` columns (0.25 at 10, 1/16 at 18). */
export function precision(d: number): number {
  return 0.5 ** (Math.max(0, d - DRAG.DEAD) / DRAG.HALF);
}

/** One drag report's effect. */
export interface DragMove {
  /** The new offset. */
  readonly offset: number;
  /** The fractional rows carried to the next report. */
  readonly carry: number;
  /** Rows per cell (0 when the pointer did not move vertically or reached an end). */
  readonly step: number;
  /** The proportional step at the start of the move (0 as for `step`). */
  readonly proportional: number;
}

/**
 * A drag report, as a pure function of the metrics, the offset, the pointer's rows on the track
 * before (`from`) and after (`to`) the report, its distance `d` in columns left of the bar, its
 * vertical speed in cells per second, and the fraction carried from the previous report. The
 * offset moves by `(to - from)` times the step, plus the carry; the whole rows are applied and
 * the fraction carried. Movement outside the track does not count (`from` is clamped to it), and
 * the pointer at or beyond the track's first row is the top, at or beyond its last the bottom.
 */
export function dragMove(m: BarMetrics, offset: number, from: number, to: number, d: number, speed: number, carry: number): DragMove {
  const range = maxScroll(m);
  const last = m.track - 1;
  if (range <= 0) return { offset: 0, carry: 0, step: 0, proportional: 0 };
  if (to <= 0) return { offset: 0, carry: 0, step: 0, proportional: 0 };
  if (to >= last) return { offset: range, carry: 0, step: 0, proportional: 0 };
  const start = clamp(from, 0, last);
  const dy = to - start;
  if (dy === 0) return { offset: clamp(offset, 0, range), carry, step: 0, proportional: 0 };
  const proportional = proportionalStep(m, offset, start, dy > 0);
  const step = Math.max(DRAG.FLOOR, speedStep(proportional, speed) * precision(d));
  const delta = dy * step + carry;
  const whole = Math.trunc(delta);
  return { offset: clamp(offset + whole, 0, range), carry: delta - whole, step, proportional };
}

/**
 * The pointer's vertical speed in cells per second, over the reports of the last
 * `DRAG.WINDOW_MS`: the cells moved since the last report before that window (or the press)
 * over the time since it. `now` is injectable for tests.
 */
export class DragSpeed {
  private samples: { t: number; row: number }[] = [];

  constructor(private readonly now: () => number = () => performance.now()) {}

  /** The press: the first sample. */
  start(row: number): void {
    this.samples = [{ t: this.now(), row }];
  }

  /** Records a report on `row` and returns the speed. */
  add(row: number): number {
    const t = this.now();
    this.samples.push({ t, row });
    let first = this.samples.findIndex((s) => s.t >= t - DRAG.WINDOW_MS);
    if (first < 0) first = this.samples.length - 1;
    this.samples = this.samples.slice(Math.max(0, first - 1));
    let cells = 0;
    for (let i = 1; i < this.samples.length; i++) cells += Math.abs(this.samples[i]!.row - this.samples[i - 1]!.row);
    const ms = Math.max(1, t - this.samples[0]!.t);
    return (cells * 1000) / ms;
  }
}

/** Draws the bar into `buffer` at column `x`, rows `y` to `y + m.track - 1`; nothing while
 *  there is nothing to scroll. */
export function drawBar(buffer: OptimizedBuffer, x: number, y: number, m: BarMetrics, scrollTop: number, theme: ResolvedTheme, glyphs: ConversationGlyphs): void {
  const size = thumbSize(m);
  if (size === 0) return;
  const start = thumbStart(m, scrollTop);
  const track = theme.color("scrollbar.track");
  if (theme.flat) {
    const muted = theme.text("muted");
    for (let r = 0; r < m.track; r++) {
      const thumb = r >= start && r < start + size;
      buffer.setCell(x, y + r, thumb ? glyphs.scrollbar.thumb : glyphs.scrollbar.track, muted.fg, track, muted.attributes);
    }
    return;
  }
  const thumb = theme.color("scrollbar.thumb");
  const fg = theme.color("text");
  for (let r = 0; r < m.track; r++) buffer.setCell(x, y + r, " ", fg, r >= start && r < start + size ? thumb : track, 0);
}

export interface ConversationScrollbar {
  /** The mouse hook for renderer/mouse.ts, ahead of the selection's (`next`). */
  intercept(report: MouseReport, next: MouseDispatch): boolean;
  /** Shows the conversation box's vertical bar and takes over its drawing; returns a function
   *  that lets the box go (the bar stays as it is: the box is being destroyed). */
  attach(box: ConversationScrollBox, theme: ResolvedTheme, glyphs: ConversationGlyphs, renderer: CliRenderer, logger?: DebugLogger): () => void;
}

/** Chains `first` ahead of `then`: `first` hands on to `then`, which hands on to OpenTUI. */
export function chainIntercepts(first: ConversationScrollbar["intercept"], then: MouseIntercept): MouseIntercept {
  return (report, dispatch) => first(report, (r) => then(r, dispatch));
}

interface Drag {
  /** The pointer's row on the track at the last report. */
  row: number;
  carry: number;
  readonly speed: DragSpeed;
  readonly t0: number;
  moves: number;
  stepMin: number;
  stepMax: number;
}

export function createScrollbar(options: { now?: () => number } = {}): ConversationScrollbar {
  const now = options.now ?? (() => performance.now());
  let box: ConversationScrollBox | null = null;
  let log: DebugLogger | undefined;
  let drag: Drag | null = null;
  // Frame pacing: the latest offset waits while a frame for the previous one is due; `BOTTOM` is
  // the bottom whatever the content's height when it is applied.
  let pending: number | typeof BOTTOM | null = null;
  let waiting = false;
  let safety: ReturnType<typeof setTimeout> | null = null;
  let released: { t0: number; moves: number; stepMin: number; stepMax: number } | null = null;

  const slider = () => box!.verticalScrollBar.slider;
  const metrics = (): BarMetrics | null => {
    if (!box || box.isDestroyed) return null;
    const m = { track: slider().height, content: box.scrollHeight, viewport: box.viewport.height };
    return Number.isFinite(m.track) && Number.isFinite(m.content) && Number.isFinite(m.viewport) ? m : null;
  };
  const onBar = (x: number, y: number): boolean => {
    if (!box || box.isDestroyed || !box.verticalScrollBar.visible) return false;
    const s = slider();
    if (x < s.x || x >= s.x + s.width || y < s.y || y >= s.y + s.height) return false;
    return !coveredAt(box, x, y);
  };
  const rounded = (n: number) => Math.round(n * 100) / 100;
  /** The offset the next report or press starts from: the latest unapplied one, else the box's. */
  const current = (m: BarMetrics): number => (pending === BOTTOM ? maxScroll(m) : (pending ?? box!.scrollTop));

  /** The `release` log event, once the release's offset is applied. */
  const settled = () => {
    if (!released || pending !== null || waiting) return;
    const m = metrics();
    const moved = released.stepMax > 0;
    log?.log({
      event: "scrollbar",
      action: "release",
      moves: released.moves,
      ms: Math.round(now() - released.t0),
      following: box !== null && m !== null && box.scrollTop >= maxScroll(m),
      stepMin: moved ? rounded(released.stepMin) : null,
      stepMax: moved ? rounded(released.stepMax) : null,
    });
    released = null;
  };

  /**
   * Applies the latest offset. Setting the offset fires the ScrollBar's change event, which
   * records it in the scroll controller and mounts the window around it (WindowedConversation's
   * `change` handler), synchronously, in this input handler. A fast drag lands far from the
   * mounted window at every report, so each would mount a new window: at a report every 10 ms
   * that stalled the frames for 0.8 s in the trial. So one offset is applied per frame: the next
   * waits for the frame that draws this one (`onFrame`; 100 ms at most). Every report still
   * counts, since each moves the offset the next one starts from (`pending`).
   *
   * The bottom is resolved here, not when it was asked for: the frame the offset waited for may
   * have laid out a taller conversation (a reply streaming), and the bottom as measured before it
   * would now be rows short of the end, so the conversation would stop following and the release
   * would report `following` false (the follow-up of 11 October 2026, in
   * docs/mvp-notes/chrome-and-keys.md "Bench").
   */
  const apply = () => {
    const target = pending;
    pending = null;
    const m = metrics();
    if (target === null || !box || !m) return settled();
    const offset = target === BOTTOM ? maxScroll(m) : target;
    if (offset === box.scrollTop) return settled();
    waiting = true;
    if (safety) clearTimeout(safety);
    safety = setTimeout(onFrame, 100);
    box.scrollTop = offset;
  };
  const onFrame = () => {
    if (!waiting) return;
    waiting = false;
    if (safety) clearTimeout(safety);
    safety = null;
    if (pending !== null) apply();
    else settled();
  };
  /** Asks for `offset` on the box: now, or once the frame now due has been drawn; at or past the
   *  bottom of `m` it is the bottom. */
  const request = (offset: number, m: BarMetrics) => {
    pending = offset >= maxScroll(m) ? BOTTOM : offset;
    if (!waiting) apply();
  };

  /** A drag or release report: the pointer's movement since the last one, applied relatively. */
  const move = (report: MouseReport, d: Drag) => {
    const m = metrics();
    if (!m || !box) return;
    const s = slider();
    const row = report.y - s.y;
    const speed = d.speed.add(row);
    const from = current(m);
    const result = dragMove(m, from, d.row, row, Math.max(0, s.x - report.x), speed, d.carry);
    const dy = row - Math.max(0, Math.min(m.track - 1, d.row));
    d.row = row;
    d.carry = result.carry;
    d.moves++;
    if (result.step > 0) {
      d.stepMin = Math.min(d.stepMin, result.step);
      d.stepMax = Math.max(d.stepMax, result.step);
    }
    log?.log({
      event: "scrollbar",
      action: "drag",
      row,
      dy,
      d: Math.max(0, s.x - report.x),
      speed: Math.round(speed),
      step: rounded(result.step),
      proportional: rounded(result.proportional),
      from,
      offset: result.offset,
      max: maxScroll(m),
    });
    if (result.offset !== from) request(result.offset, m);
  };

  return {
    intercept(report, next) {
      if (report.type === "down" && report.button === 0) {
        drag = null;
        if (!onBar(report.x, report.y)) return next(report);
        const m = metrics();
        if (!m) return true;
        const row = report.y - slider().y;
        const press = pressAt(m, current(m), row);
        drag = { row, carry: 0, speed: new DragSpeed(now), t0: now(), moves: 0, stepMin: Infinity, stepMax: 0 };
        drag.speed.start(row);
        // A press off the thumb jumps its middle there, then goes on as a drag from that row.
        if (press.jump !== null) request(press.jump, m);
        log?.log({ event: "scrollbar", action: "press", jump: press.jump !== null });
        return true;
      }
      if (!drag) return next(report);
      // Motion without a button (all-motion reporting, under `--mouse full`): the release was lost (outside the
      // terminal, say), so the drag is over.
      if (report.type === "move") {
        drag = null;
        return next(report);
      }
      if (report.type === "drag" || report.type === "up") {
        move(report, drag);
        if (report.type === "up") {
          released = { t0: drag.t0, moves: drag.moves, stepMin: drag.stepMin, stepMax: drag.stepMax };
          drag = null;
          settled();
        }
        return true;
      }
      return next(report);
    },
    attach(target, theme, glyphs, frames, logger) {
      box = target;
      log = logger?.enabled ? logger : undefined;
      const bar = target.verticalScrollBar;
      bar.showArrows = false;
      // Set by hand, so OpenTUI never hides it while the conversation fits: the column stays
      // reserved and the text never reflows when the conversation first overflows.
      bar.visible = true;
      const s = bar.slider as unknown as { renderSelf(buffer: OptimizedBuffer): void };
      s.renderSelf = (buffer) => {
        const m = metrics();
        if (m) drawBar(buffer, bar.slider.x, bar.slider.y, m, target.scrollTop, theme, glyphs);
      };
      frames.on(CliRenderEvents.FRAME, onFrame);
      return () => {
        frames.off(CliRenderEvents.FRAME, onFrame);
        if (box !== target) return;
        box = null;
        drag = null;
        pending = null;
        waiting = false;
        released = null;
        if (safety) clearTimeout(safety);
        safety = null;
      };
    },
  };
}
