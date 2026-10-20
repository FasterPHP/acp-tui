// The prompt box's borders (design D7; spec tui-layout "Prompt box"): the
// bottom border carries the config option pills (mode, model, effort) on the
// left and the context used and size on the right (mvp-chrome-and-keys design
// D4); the top border carries the busy indicator, the newest notice and the
// `↓ N new` indicator (design D3). Pure, so the rows are unit-tested without
// a renderer.
import { DEFAULT_PROMPT_RIGHT, fitBar, resolveBar, type ResolvedPromptBorder } from "./layout.ts";
import { displayWidth, fitSegments, segmentsWidth, truncateEnd, type Segment } from "./segments.ts";
import { PILL_CATEGORIES, type PillCategory, type SessionView } from "./view.ts";
import type { TokenName } from "../theme/index.ts";
import { LIVE_CHROME_GLYPHS } from "../conversation/live-glyphs.ts";

export const PROMPT_FRAME = { topLeft: "╭", topRight: "╮", bottomLeft: "╰", bottomRight: "╯", horizontal: "─", vertical: "│" } as const;

/** The bottom border's default: every pill, and the context gauge on the right (the `usage`
 *  module; `DEFAULT_PROMPT_RIGHT`). */
const DEFAULT_BORDER: ResolvedPromptBorder = { pills: PILL_CATEGORIES, right: resolveBar({ right: DEFAULT_PROMPT_RIGHT }) };

/** A bottom-border segment; the pills' segments name their option's category, for a click. */
export type BorderSegment = Segment & { pill?: PillCategory };

/** Between two pills. */
const PILL_SEPARATOR = " ─ ";

/**
 * The bottom border (spec tui-layout "Config option pills"): on the left one pill per config
 * option of the categories `border.pills` names, in its order (by default `mode`, `model` and
 * `thought_level`: `Mode Auto ─ Model Opus 5.5 ─ Effort high`: the name muted, the value in
 * `accent` on `surface.card`), on the right the modules `border.right` names (by default the
 * context gauge from the latest usage update; `layout.prompt`, mvp-configuration design D11).
 * Where they do not fit, the names go first (from the last pill), then the values are truncated
 * (the longest first), and the right modules last.
 */
export function bottomBorder(view: SessionView, width: number, frameToken: TokenName, border: ResolvedPromptBorder = DEFAULT_BORDER): BorderSegment[] {
  const line = (n: number): BorderSegment[] => (n > 0 ? [{ text: PROMPT_FRAME.horizontal.repeat(n), token: frameToken }] : []);
  const space: BorderSegment = { text: " ", token: frameToken };
  const pills = border.pills.flatMap((category) => (view.pills ?? []).filter((p) => p.category === category));
  const gaugeOf = (): BorderSegment[] =>
    fitBar(border.right, view, Infinity, 0).right.flatMap((module, i) => (i > 0 ? [{ text: "  ", token: frameToken }, ...module] : module));
  let gauge = gaugeOf();
  const named = pills.map(() => true);
  const values = pills.map((p) => p.value);

  // The left group (the pills, a space each side) and the right one (the gauge, a space each side,
  // and the line stub before the corner).
  const groups = (): { l: BorderSegment[]; r: BorderSegment[] } => {
    const left: BorderSegment[] = [];
    pills.forEach((pill, i) => {
      if (i > 0) left.push({ text: PILL_SEPARATOR, token: frameToken });
      if (named[i]) left.push({ text: `${pill.name} `, token: "muted", pill: pill.category });
      left.push({ text: values[i]!, token: "accent", fill: "surface.card", pill: pill.category });
    });
    return { l: left.length > 0 ? [space, ...left, space] : [], r: gauge.length > 0 ? [space, ...gauge, space, ...line(1)] : [] };
  };
  // The corners and the left stub, and at least one cell of line between the two groups.
  const tooWide = (): boolean => {
    const { l, r } = groups();
    return 3 + segmentsWidth(l) + segmentsWidth(r) + (l.length > 0 && r.length > 0 ? 1 : 0) > width;
  };
  const build = (): BorderSegment[] => {
    const { l, r } = groups();
    return [
      { text: PROMPT_FRAME.bottomLeft, token: frameToken },
      ...line(1),
      ...l,
      ...line(Math.max(0, width - 3 - segmentsWidth(l) - segmentsWidth(r))),
      ...r,
      { text: PROMPT_FRAME.bottomRight, token: frameToken },
    ];
  };
  // The names go first, from the last pill.
  for (let i = pills.length - 1; i >= 0 && tooWide(); i--) named[i] = false;
  // Then the values are truncated, the longest first, to one column at least.
  while (tooWide()) {
    let widest = -1;
    values.forEach((v, i) => {
      if (displayWidth(v) > 1 && (widest < 0 || displayWidth(v) > displayWidth(values[widest]!))) widest = i;
    });
    if (widest < 0) break;
    values[widest] = truncateEnd(pills[widest]!.value, displayWidth(values[widest]!) - 1);
  }
  // The gauge last.
  if (tooWide()) gauge = [];
  return fitSegments(build(), width);
}

/** The pill (its option's category) drawn at `column` of a bottom border row, or null. */
export function pillAt(row: readonly BorderSegment[], column: number): PillCategory | null {
  let x = 0;
  for (const s of row) {
    const w = displayWidth(s.text);
    if (column >= x && column < x + w) return s.pill ?? null;
    x += w;
  }
  return null;
}

/** The `↓ N new` indicator's text. */
export const newBelowLabel = (n: number): string => `↓ ${n} new`;

/** The columns `[start, end)` of the indicator with its two spaces, for a click, in a top border
 *  of `width` columns: it ends at the right corner's line stub. */
export function newBelowSpan(n: number, width: number): { start: number; end: number } {
  const end = width - 2;
  return { start: end - displayWidth(newBelowLabel(n)) - 2, end };
}

// -- The busy indicator (mvp-chrome-and-keys design D3) ------------------------------------

/** The fewest cells of the indicator's track, after the left corner and its line stub. */
export const BUSY_TRACK_MIN = 10;
/** The default share of the top border the track takes, in per cent (`busy.track_percent`). */
export const BUSY_TRACK_PERCENT = 40;
/** The fewest cells of the segment that sweeps over the track. */
export const BUSY_SEGMENT_MIN = 3;
/** One pass of the segment from one end of the track to the other takes this long, at every width
 *  (day-one-feedback design D9): a wide track sweeps no slower than a narrow one. */
export const BUSY_PASS_MS = 1500;
/** The shortest interval between two frames of the sweep (25 a second): where a pass has more steps
 *  than fit, a frame moves several (day-two-feedback design D4). */
export const BUSY_INTERVAL_MIN_MS = 40;
/** The longest interval (8 frames a second, the indicator's floor): a pass of fewer steps than that
 *  fits is swept faster than `BUSY_PASS_MS`, each step still after the same interval. */
export const BUSY_INTERVAL_MAX_MS = 125;
/** Columns a busy track always leaves for a notice, besides the corners and line stubs. */
export const BUSY_NOTICE_ROOM = 12;

/** How the moving segment is drawn (`busy.style`; spec tui-layout "Busy indicator"). */
export type BusyStyle = "gap" | "colour" | "border";
/** The style a state without one has: the setting's default. */
export const BUSY_STYLE_DEFAULT: BusyStyle = "gap";

/** The busy indicator's state: the sweep's frame count, whether it stands still in the warning
 *  colour because the session waits for the user (`requires_action`), the share of the border
 *  its track takes (`busy.track_percent`; default `BUSY_TRACK_PERCENT`) and how the segment is drawn
 *  (`busy.style`; default `BUSY_STYLE_DEFAULT`). */
export interface BusyState {
  readonly frame: number;
  readonly waiting: boolean;
  readonly percent?: number;
  readonly style?: BusyStyle;
}

/** The cells of the track in a top border of `width` columns: `percent` of the border, at least
 *  `BUSY_TRACK_MIN`, and never more than leaves `BUSY_NOTICE_ROOM` columns for a notice between
 *  the corners and line stubs. */
export function busyTrackWidth(width: number, percent: number = BUSY_TRACK_PERCENT): number {
  const wanted = Math.floor((width * percent) / 100);
  const room = width - 4 - BUSY_NOTICE_ROOM;
  return Math.max(BUSY_TRACK_MIN, Math.min(wanted, room));
}

/** The segment's cells on a track of `track` cells: a fifth of it, at least `BUSY_SEGMENT_MIN`. */
export function busySegmentWidth(track: number): number {
  return Math.max(BUSY_SEGMENT_MIN, Math.floor(track / 5));
}

export interface BusyGlyphs {
  readonly track: string;
  readonly segment: string;
  /** The half cells: a segment's leading and trailing cell and a gap's. Empty: whole-cell steps. */
  readonly segmentLead: string;
  readonly segmentTrail: string;
  readonly gapLead: string;
  readonly gapTrail: string;
}

/** The sweep's pace: `steps` in one pass (half cells, or whole cells without half glyphs), the
 *  steps each frame moves, and the interval between frames in milliseconds. */
export interface BusySteps {
  readonly steps: number;
  readonly perFrame: number;
  readonly interval: number;
}

/**
 * The steps and the frame interval for a segment that travels `span` cells (day-two-feedback design
 * D4): every frame moves the same number of steps after the same interval. A pass of `n` steps takes
 * `BUSY_PASS_MS`, so a frame is `BUSY_PASS_MS / n` apart; where that is under
 * `BUSY_INTERVAL_MIN_MS` a frame moves `k = ceil(MIN * n / PASS)` steps, `BUSY_PASS_MS * k / n` apart;
 * and it is never above `BUSY_INTERVAL_MAX_MS`.
 */
export function busySteps(span: number, halves: boolean): BusySteps {
  const steps = Math.max(1, halves ? 2 * span : span);
  let perFrame = 1;
  let interval = BUSY_PASS_MS / steps;
  if (interval < BUSY_INTERVAL_MIN_MS) {
    perFrame = Math.ceil((BUSY_INTERVAL_MIN_MS * steps) / BUSY_PASS_MS);
    interval = (BUSY_PASS_MS * perFrame) / steps;
  }
  return { steps, perFrame, interval: Math.min(interval, BUSY_INTERVAL_MAX_MS) };
}

/** The half glyphs `style` draws its segment's ends with: a gap's, else the segment's. */
const halfGlyphs = (style: BusyStyle, glyphs: BusyGlyphs): readonly [string, string] =>
  style === "gap" ? [glyphs.gapLead, glyphs.gapTrail] : [glyphs.segmentLead, glyphs.segmentTrail];

/** Whether the segment moves in half cells: both half glyphs of `style` are set. */
export const busyHalves = (style: BusyStyle, glyphs: BusyGlyphs): boolean => halfGlyphs(style, glyphs).every((glyph) => glyph !== "");

/** The pace of the sweep in a top border of `width` columns: what the prompt box's timer runs at. */
export function busyTiming(
  width: number,
  percent: number = BUSY_TRACK_PERCENT,
  style: BusyStyle = BUSY_STYLE_DEFAULT,
  glyphs: BusyGlyphs = LIVE_CHROME_GLYPHS.busy,
): BusySteps {
  const track = busyTrackWidth(width, percent);
  return busySteps(track - busySegmentWidth(track), busyHalves(style, glyphs));
}

/** The segment's position at `frame`, in steps from the track's start: back and forth, `pace.steps`
 *  steps one way, `pace.perFrame` of them each frame. */
export function busyPosition(frame: number, pace: BusySteps): number {
  const cycle = 2 * pace.steps;
  const p = (((frame * pace.perFrame) % cycle) + cycle) % cycle;
  return p <= pace.steps ? p : cycle - p;
}

/**
 * The track's cells: the border's line, with the segment over it while busy. In a half-cell
 * position the segment's first cell is the half glyph (`lead`) and the cell after its last the other
 * (`trail`); the style says what the segment is: `gap`, blank cells with the line's remaining halves
 * (`╴` and `╶`); `colour`, the heavy line in the `busy` token (`╼` and `╾` at its ends); `border`,
 * the same in the frame's own token. Waiting for the user, every style stands where it was as the
 * heavy line in `warning`.
 */
export function busyTrack(
  busy: BusyState | null,
  frameToken: TokenName,
  glyphs: BusyGlyphs = LIVE_CHROME_GLYPHS.busy,
  track: number = BUSY_TRACK_MIN,
): Segment[] {
  if (!busy) return [{ text: glyphs.track.repeat(track), token: frameToken }];
  const style = busy.style ?? BUSY_STYLE_DEFAULT;
  const gap = style === "gap" && !busy.waiting;
  const segment = busySegmentWidth(track);
  const halves = busyHalves(style, glyphs);
  const position = busyPosition(busy.frame, busySteps(track - segment, halves));
  // The position in half cells; waiting draws the heavy line, so a half cell needs its glyphs.
  let half = halves ? position : 2 * position;
  const [lead, trail] = gap ? halfGlyphs("gap", glyphs) : ([glyphs.segmentLead, glyphs.segmentTrail] as const);
  if (half % 2 === 1 && (lead === "" || trail === "")) half -= 1;
  const at = Math.floor(half / 2);
  const over = half % 2 === 1;
  const token: TokenName = busy.waiting ? "warning" : style === "colour" ? "busy" : frameToken;
  const body = (gap ? " " : glyphs.segment).repeat(over ? segment - 1 : segment);
  const rest = track - at - segment - (over ? 1 : 0);
  const cells: Segment[] = [
    ...(at > 0 ? [{ text: glyphs.track.repeat(at), token: frameToken }] : []),
    { text: (over ? lead : "") + body + (over ? trail : ""), token },
    ...(rest > 0 ? [{ text: glyphs.track.repeat(rest), token: frameToken }] : []),
  ];
  // Neighbours in one token are one segment, as the row is drawn run by run.
  return cells.reduce<Segment[]>((merged, cell) => {
    const last = merged.at(-1);
    if (last && last.token === cell.token && last.fill === cell.fill) merged[merged.length - 1] = { ...last, text: last.text + cell.text };
    else merged.push(cell);
    return merged;
  }, []);
}

/** A notice for the top border: its text and colour, what to keep at the end when the text is cut,
 *  and the shorter text to cut instead (`Notice.more` and `Notice.short` in the session store). */
export type BorderNotice = Segment & { readonly more?: string; readonly short?: string };

/** A notice's `more` is kept only while this many columns of its text stay beside it. */
export const NOTICE_TEXT_MIN = 12;

/** The notice in `width` columns: whole when it fits; else its `short` text (or its text) cut with
 *  `…` and `more` after it, while the text keeps `NOTICE_TEXT_MIN` columns; else the text cut
 *  alone. */
export function fitNotice(notice: BorderNotice, width: number): Segment[] {
  const { more, short, ...segment } = notice;
  if (!more || displayWidth(segment.text) <= width) return fitSegments([segment], width);
  const tail = ` ${more}`;
  const room = width - displayWidth(tail);
  if (room < NOTICE_TEXT_MIN) return fitSegments([segment], width);
  return [...fitSegments([{ ...segment, text: short ?? segment.text }], room), { text: tail, token: segment.token }];
}

/**
 * The top border (spec tui-layout "Prompt box top border"), left to right: the busy indicator's
 * track (only while a turn runs), the newest notice in the middle of what is left, and the `↓ N new`
 * indicator at the right end while entries have been added below the reader (spec
 * tui-conversation "Scrolling and following"). While idle the notice may use the track's
 * columns, so a long notice (an export path, say) is cut less. A notice too long for its room
 * that has `more` keeps that whole at its end (where to read the rest), after its `short` text
 * (or its text) cut with `…`, while at least `NOTICE_TEXT_MIN` columns of the text are left
 * beside it (`fitNotice`).
 */
export function topBorder(
  notice: BorderNotice | null,
  width: number,
  frameToken: TokenName,
  newBelow = 0,
  busy: BusyState | null = null,
  glyphs: BusyGlyphs = LIVE_CHROME_GLYPHS.busy,
): Segment[] {
  const line = (n: number): Segment[] => (n > 0 ? [{ text: PROMPT_FRAME.horizontal.repeat(n), token: frameToken }] : []);
  const space: Segment = { text: " ", token: frameToken };
  // Left: the corner, a line stub and the track; right: the indicator with a space each side, a
  // line stub and the corner.
  const corner: Segment = { text: PROMPT_FRAME.topLeft, token: frameToken };
  // While idle the track is plain line, which a notice may use.
  const left: Segment[] = [corner, ...line(1), ...(busy ? busyTrack(busy, frameToken, glyphs, busyTrackWidth(width, busy.percent)) : [])];
  const indicator: Segment[] = newBelow > 0 ? [space, { text: newBelowLabel(newBelow), token: "accent" }, space] : [];
  const right: Segment[] = [...indicator, ...line(1), { text: PROMPT_FRAME.topRight, token: frameToken }];
  const middle = width - segmentsWidth(left) - segmentsWidth(right);
  // Too narrow for the track: the line, then the indicator.
  if (middle < 0) return fitSegments([corner, ...line(Math.max(0, width - 1 - segmentsWidth(right))), ...right], width);
  // The notice with a space each side, centred between the line stubs.
  let centre = line(middle);
  if (notice && middle >= 3) {
    const text = fitNotice(notice, middle - 2);
    const used = segmentsWidth(text) + 2;
    const before = Math.max(0, Math.floor((middle - used) / 2));
    centre = [...line(before), space, ...text, space, ...line(middle - used - before)];
  }
  return fitSegments([...left, ...centre, ...right], width);
}
