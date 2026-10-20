// Shared by scrollbar.pty.test.ts and scrollbar.pty.timing.test.ts (split by the change parallel-tests, tasks 3.x). Not a test file.
import { expect } from "bun:test";
import { type OscColours, type PtySession } from "../pty/harness.ts";
import { conversationEnd, READY, statusRow } from "../pty/regions.ts";
import { deriveSurfaces } from "../../src/theme/derive.ts";
import { localEnv } from "../selection/pty.ts";
import { sendPrompt, settle, startCli, type CliRun } from "./cli.ts";

export const COLS = 100;
export const ROWS = 30;
export const BAR = COLS - 1;
export const DARK = { foreground: "#bcbec4", background: "#191a1c" } satisfies OscColours;
export const SURFACES = deriveSurfaces(DARK);
export const JEDITERM = { TERMINAL_EMULATOR: "JetBrains-JediTerm", TERM_PROGRAM: undefined };

export const bgHex = (s: PtySession, y: number, x: number): string => {
  const cell = s.cell(s.term.buffer.active.baseY + y, x)!;
  return cell.isBgDefault() ? "default" : `#${cell.getBgColor().toString(16).padStart(6, "0")}`;
};

/** The conversation's first screen row, below the top margin (mvp-chrome-and-keys task 4.1). */
export const TOP = 1;

/** The screen row of the prompt box's top border: the conversation's (and the track's) rows are TOP
 *  up to it. */
export function conversationRows(s: PtySession): number {
  // Above the prompt box, less the activity bar's line and its blank row (day-two-feedback task 13.2).
  return conversationEnd(s);
}

/** The bar column's fill per conversation row: `T` thumb, `-` track, `.` anything else. */
export function barColumn(s: PtySession): string {
  let out = "";
  for (let y = TOP; y < conversationRows(s); y++) {
    const bg = bgHex(s, y, BAR);
    out += bg === SURFACES["scrollbar.thumb"] ? "T" : bg === SURFACES["scrollbar.track"] ? "-" : ".";
  }
  return out;
}

/** The thumb's rows (first and last) in the bar column; null when none is drawn. */
export function thumbRows(s: PtySession): { first: number; last: number } | null {
  const col = barColumn(s);
  const first = col.indexOf("T");
  // Screen rows: the bar column starts at the conversation's first row.
  return first < 0 ? null : { first: TOP + first, last: TOP + col.lastIndexOf("T") };
}

export interface StartOpts {
  colours?: OscColours | null;
  mouse?: string;
  env?: Record<string, string | undefined>;
  scenario?: string;
  agentArgs?: string[];
  delayScale?: number;
}

export async function start(opts: StartOpts = {}): Promise<PtySession> {
  run = startCli({
    scenario: opts.scenario ?? "long-session",
    agentArgs: opts.agentArgs ?? ["--items", "5000"],
    cols: COLS,
    rows: ROWS,
    ...(opts.delayScale === undefined ? {} : { delayScale: opts.delayScale }),
    args: opts.mouse ? ["--mouse", opts.mouse] : [],
    ...(opts.colours === null ? {} : { colours: opts.colours ?? DARK }),
    env: localEnv(opts.env),
  });
  const s = run.session;
  if (opts.scenario !== undefined) return s;
  await sendPrompt(s, "history");
  await s.waitFor(/end turn/, 60000);
  await s.waitFor(READY, 10000);
  await settle(s);
  return s;
}

export const scrolledPercent = (s: PtySession): number | null => {
  const m = /scrolled (\d+)%/.exec(statusRow(s));
  return m ? Number(m[1]) : null;
};

/** The prompt box's top border row (the `↓ N new` indicator is at its right end). */
export const promptTopBorder = (s: PtySession): string => s.screenText()[conversationRows(s)] ?? "";

/** Frames between two times, from the debug log. */
export function framesBetween(r: CliRun, from: number, to: number): { work: number; gap: number }[] {
  return r
    .events("frame")
    .filter((e) => {
      const at = Date.parse(String(e["ts"]));
      return at >= from && at <= to;
    })
    .map((e) => ({ work: Number(e["work"]), gap: Number(e["gap"]) }));
}

export interface DragEvent {
  row: number;
  dy: number;
  d: number;
  from: number;
  offset: number;
  max: number;
  step: number;
}

/** The `drag` events logged after the first `skip` `scrollbar` events. */
export function dragEvents(r: CliRun, skip: number): DragEvent[] {
  return r
    .events("scrollbar")
    .slice(skip)
    .filter((e) => e["action"] === "drag")
    .map((e) => ({ row: Number(e["row"]), dy: Number(e["dy"]), d: Number(e["d"]), from: Number(e["from"]), offset: Number(e["offset"]), max: Number(e["max"]), step: Number(e["step"]) }));
}

/** Waits for the `release` event after the first `skip` `scrollbar` events, and the screen. */
export async function released(s: PtySession, skip: number): Promise<Record<string, unknown>> {
  await s.waitFor(() => run!.events("scrollbar").slice(skip).some((e) => e["action"] === "release"), 10000);
  await settle(s);
  return run!.events("scrollbar").slice(skip).find((e) => e["action"] === "release")!;
}

/** A press and release on the track's middle row: the conversation's middle. */
export async function toMiddle(s: PtySession): Promise<void> {
  const middle = Math.floor(conversationRows(s) / 2);
  const skip = run!.events("scrollbar").length;
  s.mousePress(BAR, middle);
  s.mouseRelease(BAR, middle);
  await released(s, skip);
  expect(scrolledPercent(s)).not.toBeNull();
}

/** The proportional step before a report: the rows ahead over the pointer's cells ahead. */
export function proportional(e: DragEvent, track: number): number {
  const before = Math.max(0, Math.min(track - 1, e.row - e.dy));
  return e.dy > 0 ? (e.max - e.from) / (track - 1 - before) : e.from / before;
}

export let run: CliRun | undefined;

/** For each test file's `afterEach`. */
export async function disposeRun(): Promise<void> {
  await run?.session.dispose();
  run = undefined;
}
