#!/usr/bin/env bun
// S3 scale benchmark (phase-1a task 12.1 and 12.6, design D13 row S3). Runs the real acp-tui
// under a PTY (100x30 by default) against fake-agent and reads the frame and mounted events
// from the ACP_TUI_LOG debug log (src/renderer/frame-log.ts) and the session_update events
// (src/agent/client-handler.ts). Never touches a live Paseo daemon or a real agent.
//
//   bun run bench:scale                                  (from the repository root)
//   bun packages/acp-tui/bench/scale.ts [options]
//
// One run is six short-lived sessions (the shell's windowed list):
//   small   long-session --items 500:   open at end, mounted renderables, PgUp to top
//   large   long-session --items 5000:  the same
//   wheel   long-session --items 5000:  wheel-up reports at 60/s; frame times
//   stream  stream-long at ~30 chunks/s: frame times over a fixed window
//   budget  long-session --items 1000:  the cursor 150 entries back, a toggle, three density
//           switches; the maximum mounted count
//   drag    long-session --items 5000:  the scroll bar's thumb dragged up and down the track for
//           10 s, mixing slow and fast travel; frame times, the longest stall, the mounted count
//
// Definitions (the numbers are only comparable if these stay put):
// - open at end: from the last session_update received (its log timestamp) to the first moment
//   the screen shows the turn-end line (`end turn`, the last item), as seen through the PTY and
//   the emulator, polled every 2 ms. It includes the PTY and emulator latency (a few ms).
// - PgUp to top: from the first PageUp written to the first moment the screen shows the first
//   item (the prompt this bench sent, tagged with a marker). PageUp keys are written in
//   batches on a 16 ms tick (--pgup-rate keys per second, default 500), so the total cannot be
//   shorter than pages / rate; the row also gives the PageUps sent. Frames are the frame log
//   events in that period.
//   PgUp to top has no target since 16 October 2026 (Marcus, day-two-feedback): the keys are
//   sent until the top shows, so the time is always about the keys sent over the rate and grows
//   with the session's height, not with the renderer's speed. Keeping up with the keys is
//   judged by the longest stall while paging (no gap between frames over 100 ms) and the
//   worst frame's work (under 100 ms).
// - wheel: wheel-up reports (code 64, 0-based cell 50,10) at --wheel-rate per second for
//   --wheel-seconds, from the end. Sent only when the app has enabled a mouse mode (otherwise
//   the bytes would be typed into the prompt box) and only counted when the conversation moved.
// - frame time (every "frame" figure: p95, worst, over 100 ms): the `work` field of the `frame`
//   log events, the frame's own time from the start of the frame callbacks to the `frame`
//   event (layout, render and the native write). The events' `ms` field is NOT used: it is
//   OpenTUI's native `lastFrameTime`, which reads back as the interval since the previous
//   frame (it equals `gap` on every frame), so it measures idle time and the input rate, not
//   the cost of a frame.
// - longest stall: the longest time in a window without a frame while input is being sent or
//   updates are arriving. It is the longest interval between successive frame events,
//   counting from the start of the window and up to the first frame after its end, so a
//   frame that starts before the window and ends inside it, or one that has not ended yet
//   (a lower bound then), shows up. It catches what `work` cannot: a long block in the
//   event loop outside any frame (the reducer and mount work while updates arrive), during
//   which no frame is logged at all. Windows: the prompt to the last update (populate), the
//   PageUp period, the wheel period, the stream window. Idle intervals between frames when
//   nothing is being sent are not counted, because a frame is only drawn when something
//   changes.
// - stream: stream-long with --delay-scale --stream-scale (10 ms x scale between 20-character
//   chunks; 3.3 gives about 30 chunks per second), measured for --stream-seconds from the first
//   chunk; the achieved chunk rate is reported. The 3000-line answer takes minutes at that
//   rate, so only the start of it (the first few hundred lines) is in the window.
// - budget (mvp-conversation task 8.1, spec "Mounted budget"): a 1000-item session with the
//   conversation focused (Tab), Up --budget-up times (default 150) as fast as the PTY takes
//   them, then Enter (the toggle), then `v` three times (cycleDensity: verbose, focus,
//   compact), the app idle (1.5 s) and the mounted sampler (500 ms) given time to see the tree
//   after each step. The figure is the largest `mounted` count logged from the start of the
//   Up keys (the log has a count only when it changed, sampled every 500 ms, so a peak that
//   lasts under that can be missed) and must not exceed 1500. The mounted count of the
//   following state (before the Up keys) is reported for information.
// - drag (mvp-chrome-and-keys task 10.7, spec tui-layout "Scrollbar drag", scenario "Smooth to
//   draw"): a 5000-item session following the bottom, the scroll bar on (the default; the theme
//   is flat here, so the thumb is found by its glyph), a primary press on the thumb, then drag
//   reports on the bar's column for --drag-seconds (default 10), the pointer moving one cell a
//   report and turning at the track's ends, in alternating stretches: slow (8 cells, one every
//   150 ms, about 6.7 cells a second) and fast (16 cells, one every 10 ms); then the release.
//   The figures are over the drag: the worst frame work (target under 100 ms), the longest stall
//   (no frame gap over 250 ms while reports arrive) and the largest `mounted` count logged from
//   the press (at most 1500); the reports sent and the frames drawn are given for information.
//
// Options (all optional):
//   --runs <n>            runs of everything (default 5)
//   --runs-large <n>      runs of the 5000-item sessions if fewer (default: --runs)
//   --phases <list>       comma list of small,large,wheel,stream,budget (default all)
//   --items-small <n>     default 500;  --items-large <n>  default 5000
//   --cols <n> --rows <n> default 100x30
//   --app-arg <arg>       any other acp-tui argument (repeatable), e.g. --app-arg --mouse
//                         --app-arg full
//   --pgup-rate <n>       PageUp keys per second (default 500)
//   --wheel-rate <n>      wheel reports per second (default 60);  --wheel-seconds <n>  default 3
//   --stream-scale <n>    fake-agent --delay-scale for stream-long (default 3.3)
//   --stream-seconds <n>  default 10
//   --items-budget <n>    items of the budget phase, default 1000;  --budget-up <n>  Up keys, default 150
//   --drag-seconds <n>    the drag phase's length (default 10)
//   --shown-timeout <s>   the longest wait for the last item (default 300); a run also counts it
//                         as never shown once the app has been idle for 2 s without it
//   --json <path>         also write the raw per-run figures as JSON
//   --merge <path>        add the runs in a JSON file written by --json (repeatable) to this
//                         report; with --merge no phase runs unless --phases is given. Lets a
//                         long benchmark run in pieces (the 5000-item sessions take minutes).
import { closeSync, openSync, readFileSync, readSync, rmSync, statSync } from "node:fs";
import { cpus } from "node:os";
import { dirname } from "node:path";
import { sendPrompt, startCli, type CliRun } from "../test/conversation/cli.ts";
import type { PtySession } from "../test/pty/harness.ts";
import { DEFAULT_GLYPHS } from "../src/conversation/glyphs.ts";

// ---------------------------------------------------------------- options

interface Options {
  runs: number;
  runsLarge: number;
  phases: Set<string>;
  itemsSmall: number;
  itemsLarge: number;
  cols: number;
  rows: number;
  appArgs: string[];
  pgupRate: number;
  wheelRate: number;
  wheelSeconds: number;
  streamScale: number;
  streamSeconds: number;
  json: string | null;
  merge: string[];
  phasesGiven: boolean;
  shownTimeoutMs: number;
  itemsBudget: number;
  budgetUp: number;
  dragSeconds: number;
}

function parseOptions(argv: string[]): Options {
  const o: Options = {
    runs: 5,
    runsLarge: 0,
    phases: new Set(["small", "large", "wheel", "stream", "budget", "drag"]),
    itemsSmall: 500,
    itemsLarge: 5000,
    cols: 100,
    rows: 30,
    appArgs: [],
    pgupRate: 500,
    wheelRate: 60,
    wheelSeconds: 3,
    streamScale: 3.3,
    streamSeconds: 10,
    json: null,
    merge: [],
    phasesGiven: false,
    shownTimeoutMs: 300000,
    itemsBudget: 1000,
    budgetUp: 150,
    dragSeconds: 10,
  };
  let runsLarge: number | null = null;
  const num = (name: string, value: string | undefined): number => {
    const n = Number(value);
    if (value === undefined || !Number.isFinite(n) || n <= 0) throw new Error(`${name} needs a positive number, got ${value}`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i]!;
    const value = argv[i + 1];
    switch (name) {
      case "--runs": o.runs = Math.floor(num(name, value)); break;
      case "--runs-large": runsLarge = Math.floor(num(name, value)); break;
      case "--phases": o.phases = new Set(String(value).split(",").filter(Boolean)); o.phasesGiven = true; break;
      case "--items-small": o.itemsSmall = Math.floor(num(name, value)); break;
      case "--items-large": o.itemsLarge = Math.floor(num(name, value)); break;
      case "--cols": o.cols = Math.floor(num(name, value)); break;
      case "--rows": o.rows = Math.floor(num(name, value)); break;
      case "--app-arg": o.appArgs.push(String(value)); break;
      case "--pgup-rate": o.pgupRate = num(name, value); break;
      case "--wheel-rate": o.wheelRate = num(name, value); break;
      case "--wheel-seconds": o.wheelSeconds = num(name, value); break;
      case "--stream-scale": o.streamScale = num(name, value); break;
      case "--stream-seconds": o.streamSeconds = num(name, value); break;
      case "--json": o.json = String(value); break;
      case "--merge": o.merge.push(String(value)); break;
      case "--items-budget": o.itemsBudget = Math.floor(num(name, value)); break;
      case "--budget-up": o.budgetUp = Math.floor(num(name, value)); break;
      case "--drag-seconds": o.dragSeconds = num(name, value); break;
      case "--shown-timeout": o.shownTimeoutMs = num(name, value) * 1000; break;
      default: throw new Error(`unknown option ${name}`);
    }
    i++;
  }
  for (const p of o.phases) if (!["small", "large", "wheel", "stream", "budget", "drag"].includes(p)) throw new Error(`unknown phase ${p}`);
  o.runsLarge = runsLarge ?? o.runs;
  if (o.merge.length > 0 && !o.phasesGiven) o.phases = new Set();
  return o;
}

// ---------------------------------------------------------------- statistics

export function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]!;
}

// ---------------------------------------------------------------- log tail

export interface LogEvent {
  event: string;
  at: number; // epoch ms, from ts
  [key: string]: unknown;
}

/** Reads new complete lines of the debug log since the last call. */
export class LogTail {
  readonly events: LogEvent[] = [];
  private offset = 0;
  private rest = "";
  constructor(private readonly path: string) {}

  poll(): LogEvent[] {
    let size = 0;
    try {
      size = statSync(this.path).size;
    } catch {
      return [];
    }
    if (size <= this.offset) return [];
    const fd = openSync(this.path, "r");
    try {
      const buf = Buffer.alloc(size - this.offset);
      readSync(fd, buf, 0, buf.length, this.offset);
      this.offset = size;
      const text = this.rest + buf.toString("utf8");
      const lines = text.split("\n");
      this.rest = lines.pop() ?? "";
      const fresh: LogEvent[] = [];
      for (const line of lines) {
        if (!line) continue;
        try {
          const e = JSON.parse(line) as Record<string, unknown>;
          fresh.push({ ...e, event: String(e["event"]), at: Date.parse(String(e["ts"])) });
        } catch {
          // a torn line: skip it
        }
      }
      this.events.push(...fresh);
      return fresh;
    } finally {
      closeSync(fd);
    }
  }

  of(name: string, from = 0, to = Infinity): LogEvent[] {
    return this.events.filter((e) => e.event === name && e.at >= from && e.at <= to);
  }
}

// ---------------------------------------------------------------- helpers

const FIRST_ITEM = "scalebench-first-item";
const END_TURN = /\bend turn\b/;

export async function until(cond: () => boolean | Promise<boolean>, timeoutMs: number, what: string, stepMs = 2): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await cond()) return Date.now();
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await Bun.sleep(stepMs);
  }
}

export async function screenHas(s: PtySession, re: RegExp | string): Promise<boolean> {
  await s.flush();
  const text = s.screenText().join("\n");
  return typeof re === "string" ? text.includes(re) : re.test(text);
}

interface Session {
  run: CliRun;
  s: PtySession;
  tail: LogTail;
  close(): Promise<void>;
}

function open(o: Options, scenario: string, agentArgs: string[], delayScale = 0): Session {
  const args = [...o.appArgs];
  const run = startCli({ scenario, delayScale, cols: o.cols, rows: o.rows, args, agentArgs });
  const tail = new LogTail(run.logPath);
  return {
    run,
    s: run.session,
    tail,
    async close() {
      run.session.kill("SIGTERM");
      await run.session.wait(5000).catch(() => undefined);
      await run.session.dispose();
      rmSync(dirname(run.logPath), { recursive: true, force: true });
    },
  };
}

interface FrameStats {
  frames: number;
  /** p95 and worst of the frames' own time (`work`), ms. */
  p95: number;
  worst: number;
  over100: number;
  /** The longest interval without a frame in the window, ms (see the header). */
  stall: number;
}

/** The frames' own times (`work`, ms) in a window; frames without the field are skipped. */
export function workTimes(tail: LogTail, from: number, to: number): number[] {
  return tail
    .of("frame", from, to)
    .map((e) => Number(e["work"]))
    .filter((w) => Number.isFinite(w));
}

/**
 * The longest interval without a frame event in [from, to], counted from `from`, through each
 * frame, up to the first frame after `to` (or `to` itself if none has come yet, a lower bound).
 */
export function longestStall(tail: LogTail, from: number, to: number): number {
  let prev = from;
  let stall = 0;
  for (const e of tail.of("frame", from)) {
    stall = Math.max(stall, e.at - prev);
    prev = e.at;
    if (e.at > to) return stall;
  }
  return Math.max(stall, to - prev);
}

function frameStats(tail: LogTail, from: number, to: number): FrameStats {
  const work = workTimes(tail, from, to);
  return {
    frames: tail.of("frame", from, to).length,
    p95: percentile(work, 0.95),
    worst: work.length ? Math.max(...work) : NaN,
    over100: work.filter((m) => m > 100).length,
    stall: longestStall(tail, from, to),
  };
}

/** The acp-tui process behind a session (the one whose command line has `src/cli.ts`). */
function findAppPid(sess: Session): number | null {
  const dir = dirname(sess.run.logPath);
  const found = Bun.spawnSync(["pgrep", "-f", `${dir}/fake-agent.log`]).stdout.toString().split("\n").filter(Boolean);
  for (const pid of found) {
    try {
      if (readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("src/cli.ts")) return Number(pid);
    } catch {
      // gone
    }
  }
  return null;
}

/** CPU ticks (user plus system, 100 per second) the process has used. */
function cpuTicks(pid: number): number | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return Number(fields[11]) + Number(fields[12]); // utime, stime
  } catch {
    return null;
  }
}

/**
 * Whether the app has been idle for `idleMs`: no frame logged in that time and under 5% of a
 * core used over it. A frame in progress logs nothing until it ends (the unwindowed list can
 * spend tens of seconds in one), so the frame log alone cannot say the app has settled.
 */
class IdleWatch {
  private pid: number | null = null;
  private last: { at: number; ticks: number } | null = null;
  private idleSince = Date.now();
  constructor(private readonly sess: Session) {}

  /** Samples now; returns how long the app has been idle so far (0 when busy). */
  sample(): number {
    const now = Date.now();
    this.sess.tail.poll();
    const frames = this.sess.tail.of("frame");
    const lastFrame = frames[frames.length - 1];
    this.pid ??= findAppPid(this.sess);
    const ticks = this.pid === null ? null : cpuTicks(this.pid);
    let busy = lastFrame !== undefined && now - lastFrame.at < 400;
    if (ticks !== null && this.last && now - this.last.at >= 150) {
      const cpu = ((ticks - this.last.ticks) * 10) / (now - this.last.at); // fraction of a core
      if (cpu > 0.05) busy = true;
      this.last = { at: now, ticks };
    } else if (ticks !== null && !this.last) {
      this.last = { at: now, ticks };
    }
    if (busy) this.idleSince = now;
    return now - this.idleSince;
  }
}

/** Waits until the app has been idle for `idleMs`. */
async function appIdle(sess: Session, idleMs: number, timeoutMs = 600000): Promise<void> {
  const watch = new IdleWatch(sess);
  await until(() => watch.sample() >= idleMs, timeoutMs, "the app to go idle", 100);
}

// ---------------------------------------------------------------- phases

interface ListRun {
  /** Last update received to the turn-end line on screen; Infinity when it never appeared. */
  openMs: number;
  /** Whether the turn-end line (the last item) appeared. */
  shown: boolean;
  /** Notifications the SDK failed to handle (console errors in the log): items lost. */
  errors: number;
  populateMs: number;
  /** The longest frame's own time (`work`) between the prompt and the settled app. */
  populateWorst: number;
  /** The longest interval without a frame from the prompt to the last update (and the first frame after). */
  populateStall: number;
  updates: number;
  mounted: number;
  pgupMs: number;
  pgupKeys: number;
  pgupFrames: number;
  pgupWorst: number;
  pgupStall: number;
  pgupOver100: number;
}

/** Opens a session with `items` items, measures open-at-end, mounted; then PgUp to top if asked. */
async function openAndPgUp(o: Options, items: number, withPgUp: boolean): Promise<ListRun> {
  const sess = open(o, "long-session", ["--items", String(items)]);
  const { s, tail } = sess;
  try {
    await sendPrompt(s, FIRST_ITEM);
    const sent = Date.now();
    await until(() => (tail.poll(), tail.of("prompt_response").length > 0), 600000, "prompt_response", 20);
    // The turn-end line is the last item and is drawn after the response. If the app goes idle
    // (2 s, no frames, no CPU) without it, the last item is never shown at this size.
    const watch = new IdleWatch(sess);
    let seen = 0;
    try {
      seen = await until(() => (watch.sample() >= 2000 ? true : screenHas(s, END_TURN)), o.shownTimeoutMs, "the turn-end line on screen", 2);
    } catch {
      seen = 0;
    }
    const shown = seen > 0 && (await screenHas(s, END_TURN));
    tail.poll();
    const updates = tail.of("session_update");
    const lastUpdate = updates.at(-1)!.at;
    const openMs = shown ? seen - lastUpdate : Infinity;
    const populateMs = (shown ? seen : Date.now()) - sent;

    // Settle (the app idle for 1.5 s), then let the mounted sampler (500 ms) see the final tree.
    await appIdle(sess, 1500);
    await Bun.sleep(700);
    tail.poll();
    const errors = tail.of("console").filter((e) => e["level"] === "error").length;
    const work = workTimes(tail, sent, Infinity);
    const populateWorst = work.length ? Math.max(...work) : NaN;
    const populateStall = longestStall(tail, sent, lastUpdate);
    const mounted = Number(tail.of("mounted").at(-1)?.["count"] ?? NaN);

    let pgupMs = NaN, pgupKeys = 0, pgupFrames = 0, pgupWorst = NaN, pgupStall = NaN, pgupOver100 = 0;
    if (withPgUp) {
      // Start from a quiet screen, then write PageUp batches on a 16 ms tick.
      const tick = 16;
      const perTick = Math.max(1, Math.round((o.pgupRate * tick) / 1000));
      const t0 = Date.now();
      let next = performance.now();
      let found = 0;
      while (!found) {
        s.write("\x1b[5~".repeat(perTick));
        pgupKeys += perTick;
        next += tick;
        const wait = next - performance.now();
        if (wait > 0) await Bun.sleep(wait);
        if (await screenHas(s, FIRST_ITEM)) found = Date.now();
        if (Date.now() - t0 > 120000) throw new Error("PgUp did not reach the first item within 120 s");
      }
      pgupMs = found - t0;
      await Bun.sleep(100);
      tail.poll();
      const fs = frameStats(tail, t0, found);
      pgupFrames = fs.frames;
      pgupWorst = fs.worst;
      pgupStall = fs.stall;
      pgupOver100 = fs.over100;
    }
    return { openMs, shown, errors, populateMs, populateWorst, populateStall, updates: updates.length, mounted, pgupMs, pgupKeys, pgupFrames, pgupWorst, pgupStall, pgupOver100 };
  } finally {
    await sess.close();
  }
}

interface WheelRun {
  measurable: boolean;
  reason: string;
  events: number;
  frames: number;
  p95: number;
  worst: number;
  stall: number;
}

async function wheelPhase(o: Options): Promise<WheelRun> {
  const sess = open(o, "long-session", ["--items", String(o.itemsLarge)]);
  const { s, tail } = sess;
  try {
    await sendPrompt(s, FIRST_ITEM);
    await until(() => (tail.poll(), tail.of("prompt_response").length > 0), 600000, "prompt_response", 20);
    // The last item may never appear on the unwindowed list at this size; the wheel is measured
    // from wherever the list ends up.
    await appIdle(sess, 2000);
    if (s.mouseModesSet().length === 0) {
      return { measurable: false, reason: "mouse off", events: 0, frames: 0, p95: NaN, worst: NaN, stall: NaN };
    }
    const before = s.screenText().join("\n");
    const total = Math.round(o.wheelRate * o.wheelSeconds);
    const t0 = Date.now();
    const start = performance.now();
    for (let i = 0; i < total; i++) {
      s.mouseWheel(50, 10, 64);
      const wait = start + ((i + 1) * 1000) / o.wheelRate - performance.now();
      if (wait > 0) await Bun.sleep(wait);
    }
    const t1 = Date.now();
    await Bun.sleep(150);
    await s.flush();
    tail.poll();
    const moved = s.screenText().join("\n") !== before;
    if (!moved) return { measurable: false, reason: "wheel not handled", events: total, frames: 0, p95: NaN, worst: NaN, stall: NaN };
    const fs = frameStats(tail, t0, t1);
    return { measurable: true, reason: "", events: total, frames: fs.frames, p95: fs.p95, worst: fs.worst, stall: fs.stall };
  } finally {
    await sess.close();
  }
}

interface StreamRun {
  chunksPerSecond: number;
  frames: number;
  p95: number;
  worst: number;
  stall: number;
}

async function streamPhase(o: Options): Promise<StreamRun> {
  const sess = open(o, "stream-long", [], o.streamScale);
  const { s, tail } = sess;
  try {
    await sendPrompt(s, "stream please");
    await until(() => (tail.poll(), tail.of("session_update").length > 0), 30000, "the first chunk", 10);
    const t0 = tail.of("session_update")[0]!.at;
    const t1 = t0 + o.streamSeconds * 1000;
    await until(() => Date.now() >= t1 + 200, o.streamSeconds * 1000 + 5000, "the stream window", 100);
    tail.poll();
    const chunks = tail.of("session_update", t0, t1).length;
    const fs = frameStats(tail, t0, t1);
    return { chunksPerSecond: chunks / o.streamSeconds, frames: fs.frames, p95: fs.p95, worst: fs.worst, stall: fs.stall };
  } finally {
    await sess.close();
  }
}

interface BudgetRun {
  /** Mounted renderables while following, before the Up keys. */
  following: number;
  /** The largest count logged from the first Up key to the end (see the header). */
  max: number;
  /** The count after each step: the Up keys, the toggle, then the three density switches. */
  steps: number[];
  errors: number;
}

const BUDGET_LIMIT = 1500;

async function budgetPhase(o: Options): Promise<BudgetRun> {
  const sess = open(o, "long-session", ["--items", String(o.itemsBudget)]);
  const { s, tail } = sess;
  try {
    await sendPrompt(s, FIRST_ITEM);
    await until(() => (tail.poll(), tail.of("prompt_response").length > 0), 600000, "prompt_response", 20);
    await until(() => screenHas(s, END_TURN), o.shownTimeoutMs, "the turn-end line on screen", 5);
    const step = async (): Promise<number> => {
      await appIdle(sess, 1500);
      await Bun.sleep(700);
      tail.poll();
      return Number(tail.of("mounted").at(-1)?.["count"] ?? NaN);
    };
    const following = await step();
    const from = Date.now();
    s.sendKeys("Tab");
    for (let i = 0; i < o.budgetUp; i++) s.sendKeys("Up");
    const steps = [await step()];
    s.sendKeys("Enter");
    steps.push(await step());
    for (let i = 0; i < 3; i++) {
      s.sendKeys({ text: "v" });
      steps.push(await step());
    }
    const counts = tail.of("mounted", from).map((e) => Number(e["count"]));
    const max = Math.max(...counts, ...steps.filter(Number.isFinite));
    const errors = tail.of("console").filter((e) => e["level"] === "error").length;
    return { following, max, steps, errors };
  } finally {
    await sess.close();
  }
}

interface DragRun {
  measurable: boolean;
  reason: string;
  /** Drag reports sent (the press and release not counted). */
  reports: number;
  frames: number;
  p95: number;
  worst: number;
  /** The longest interval without a frame while the reports were sent, ms. */
  stall: number;
  /** The largest mounted count logged from the press to the settled app. */
  mounted: number;
}

/** The bar's column at the conversation's right edge and the thumb's first row, from the flat
 *  theme's glyph (`DEFAULT_GLYPHS.scrollbar.thumb`); null when no thumb is drawn. */
function thumbOnScreen(s: PtySession, cols: number): { first: number; last: number; rows: number } | null {
  const screen = s.screenText();
  const rows = screen.findIndex((l) => l.startsWith("\u256d"));
  let first = -1;
  let last = -1;
  for (let y = 0; y < rows; y++) {
    if ((s.cell(s.term.buffer.active.baseY + y, cols - 1)?.getChars() ?? "") !== DEFAULT_GLYPHS.scrollbar.thumb) continue;
    if (first < 0) first = y;
    last = y;
  }
  return first < 0 ? null : { first, last, rows };
}

async function dragPhase(o: Options): Promise<DragRun> {
  const sess = open(o, "long-session", ["--items", String(o.itemsLarge)]);
  const { s, tail } = sess;
  const none = (reason: string): DragRun => ({ measurable: false, reason, reports: 0, frames: 0, p95: NaN, worst: NaN, stall: NaN, mounted: NaN });
  try {
    await sendPrompt(s, FIRST_ITEM);
    await until(() => (tail.poll(), tail.of("prompt_response").length > 0), 600000, "prompt_response", 20);
    await until(() => screenHas(s, END_TURN), o.shownTimeoutMs, "the turn-end line on screen", 5);
    await appIdle(sess, 2000);
    if (s.mouseModesSet().length === 0) return none("mouse off");
    const thumb = thumbOnScreen(s, o.cols);
    if (!thumb) return none("no scroll bar");
    const bar = o.cols - 1;
    const last = thumb.rows - 1;
    const t0 = Date.now();
    s.mousePress(bar, thumb.first);
    let y = thumb.first;
    let direction = -1;
    let reports = 0;
    let slow = true;
    const deadline = performance.now() + o.dragSeconds * 1000;
    while (performance.now() < deadline) {
      const cells = slow ? 8 : 16;
      const interval = slow ? 150 : 10;
      for (let i = 0; i < cells && performance.now() < deadline; i++) {
        if (y + direction < 0 || y + direction > last) direction = -direction;
        y += direction;
        s.mouseMove(bar, y, "left");
        reports++;
        await Bun.sleep(interval);
      }
      slow = !slow;
    }
    s.mouseRelease(bar, y);
    const t1 = Date.now();
    await appIdle(sess, 1500);
    await Bun.sleep(700);
    tail.poll();
    const fs = frameStats(tail, t0, t1);
    const counts = tail.of("mounted", t0).map((e) => Number(e["count"]));
    const before = Number(tail.of("mounted", 0, t0).at(-1)?.["count"] ?? NaN);
    const mounted = Math.max(...counts, ...(Number.isFinite(before) ? [before] : []));
    return { measurable: true, reason: "", reports, frames: fs.frames, p95: fs.p95, worst: fs.worst, stall: fs.stall, mounted };
  } finally {
    await sess.close();
  }
}

// ---------------------------------------------------------------- report

// Infinity stands for "never happened" (the last item never shown); NaN for "not measured".
const f0 = (n: number): string => (n === Infinity ? "never" : Number.isFinite(n) ? String(Math.round(n)) : "n/a");
const f1 = (n: number): string => (n === Infinity ? "never" : Number.isFinite(n) ? n.toFixed(1) : "n/a");

function verdict(values: number[], target: number): string {
  const known = values.filter((v) => !Number.isNaN(v));
  if (known.length === 0) return "n/a";
  if (Math.max(...known) <= target) return "met";
  return median(known) <= target ? "median only" : "MISSED";
}

function agg(values: number[]): { median: string; worst: string; runs: string } {
  const known = values.filter((v) => !Number.isNaN(v));
  return {
    median: known.length ? f1(median(known)) : "n/a",
    worst: known.length ? f1(Math.max(...known)) : "n/a",
    runs: values.map(f1).join(" "),
  };
}

function git(...args: string[]): string {
  const r = Bun.spawnSync(["git", ...args], { cwd: import.meta.dir });
  return r.stdout.toString().trim();
}

async function main(): Promise<void> {
  const o = parseOptions(process.argv.slice(2));
  const small: ListRun[] = [];
  const large: ListRun[] = [];
  const wheel: WheelRun[] = [];
  const stream: StreamRun[] = [];
  const budget: BudgetRun[] = [];
  const drag: DragRun[] = [];
  // Raw results from earlier pieces. JSON turns NaN and Infinity into null.
  const num = (v: unknown): number => (typeof v === "number" ? v : NaN);
  for (const file of o.merge) {
    const raw = JSON.parse(await Bun.file(file).text()) as { small?: ListRun[]; large?: ListRun[]; wheel?: WheelRun[]; stream?: StreamRun[]; budget?: BudgetRun[]; drag?: DragRun[] };
    const list = (r: ListRun): ListRun => {
      const x = r as unknown as Record<string, unknown>;
      const out = Object.fromEntries(Object.entries(x).map(([k, v]) => [k, typeof v === "boolean" ? v : num(v)])) as unknown as ListRun;
      out.openMs = r.shown ? num(x["openMs"]) : Infinity;
      return out;
    };
    const plain = <T extends object>(r: T): T => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "number" || v === null ? num(v) : v])) as T;
    small.push(...(raw.small ?? []).map(list));
    large.push(...(raw.large ?? []).map(list));
    wheel.push(...(raw.wheel ?? []).map(plain));
    stream.push(...(raw.stream ?? []).map(plain));
    budget.push(...(raw.budget ?? []).map((r) => ({ ...r, following: num(r.following), max: num(r.max), steps: r.steps.map(num) })));
    drag.push(...(raw.drag ?? []).map(plain));
  }
  const started = performance.now();
  const say = (msg: string) => console.error(`[${((performance.now() - started) / 1000).toFixed(0).padStart(4)} s] ${msg}`);

  if (o.phases.has("small")) {
    for (let i = 1; i <= o.runs; i++) {
      const r = await openAndPgUp(o, o.itemsSmall, true);
      small.push(r);
      say(`small ${i}/${o.runs}: open ${f0(r.openMs)} ms${r.shown ? "" : " (last item not shown)"}, mounted ${r.mounted}, PgUp ${f0(r.pgupMs)} ms (${r.pgupKeys} keys, ${r.pgupFrames} frames, worst frame ${f1(r.pgupWorst)} ms, longest stall ${f0(r.pgupStall)} ms)`);
    }
  }
  if (o.phases.has("large")) {
    for (let i = 1; i <= o.runsLarge; i++) {
      const r = await openAndPgUp(o, o.itemsLarge, true);
      large.push(r);
      say(`large ${i}/${o.runsLarge}: populate ${f0(r.populateMs)} ms (worst frame ${f1(r.populateWorst)} ms, longest stall ${f0(r.populateStall)} ms), open ${f0(r.openMs)} ms${r.shown ? "" : ` (last item not shown; ${r.errors} notification errors)`}, mounted ${r.mounted}, PgUp ${f0(r.pgupMs)} ms (${r.pgupKeys} keys, ${r.pgupFrames} frames, worst frame ${f1(r.pgupWorst)} ms, longest stall ${f0(r.pgupStall)} ms)`);
    }
  }
  if (o.phases.has("wheel")) {
    for (let i = 1; i <= o.runsLarge; i++) {
      const r = await wheelPhase(o);
      wheel.push(r);
      say(`wheel ${i}/${o.runsLarge}: ${r.measurable ? `${r.frames} frames, p95 ${f1(r.p95)} ms, worst ${f1(r.worst)} ms, longest stall ${f0(r.stall)} ms` : `not measurable (${r.reason})`}`);
    }
  }
  if (o.phases.has("stream")) {
    for (let i = 1; i <= o.runs; i++) {
      const r = await streamPhase(o);
      stream.push(r);
      say(`stream ${i}/${o.runs}: ${f1(r.chunksPerSecond)} chunks/s, ${r.frames} frames, p95 ${f1(r.p95)} ms, worst ${f1(r.worst)} ms, longest stall ${f0(r.stall)} ms`);
    }
  }

  if (o.phases.has("budget")) {
    for (let i = 1; i <= o.runs; i++) {
      const r = await budgetPhase(o);
      budget.push(r);
      say(`budget ${i}/${o.runs}: following ${r.following}, steps ${r.steps.join(" ")}, maximum ${r.max}${r.errors ? ` (${r.errors} console errors)` : ""}`);
    }
  }

  if (o.phases.has("drag")) {
    for (let i = 1; i <= o.runsLarge; i++) {
      const r = await dragPhase(o);
      drag.push(r);
      say(`drag ${i}/${o.runsLarge}: ${r.measurable ? `${r.reports} reports, ${r.frames} frames, p95 ${f1(r.p95)} ms, worst ${f1(r.worst)} ms, longest stall ${f0(r.stall)} ms, mounted ${f0(r.mounted)}` : `not measurable (${r.reason})`}`);
    }
  }

  // ---- table
  const rows: string[][] = [];
  const add = (metric: string, target: string, values: number[], status?: string): void => {
    if (values.length === 0) return;
    const a = agg(values);
    rows.push([metric, target, a.median, a.worst, status ?? "", a.runs]);
  };
  const S = o.itemsSmall;
  const L = o.itemsLarge;
  add(`open at end, ${S} items (ms)`, "", small.map((r) => r.openMs));
  add(`open at end, ${L} items (ms)`, "< 500", large.map((r) => r.openMs), verdict(large.map((r) => r.openMs), 500));
  const shownRow = (label: string, list: ListRun[]): void => {
    if (list.length) rows.push([label, "all", `${list.filter((r) => r.shown).length} of ${list.length}`, "", "", list.map((r) => (r.shown ? "yes" : "no")).join(" ")]);
  };
  shownRow(`last item shown, ${S} items (runs)`, small);
  shownRow(`last item shown, ${L} items (runs)`, large);
  if (large.some((r) => !r.shown || r.errors > 0)) add(`notifications the SDK failed to handle, ${L} items`, "0", large.map((r) => r.errors));
  add(`populate: worst frame work, ${L} items (ms)`, "", large.map((r) => r.populateWorst));
  add(`populate: longest stall, ${L} items (ms)`, "", large.map((r) => r.populateStall));
  add(`PgUp to top, ${S} items (ms)`, "", small.map((r) => r.pgupMs));
  add(`PgUp to top, ${L} items (ms)`, "", large.map((r) => r.pgupMs));
  add(`PgUp keys sent, ${L} items`, "", large.map((r) => r.pgupKeys));
  add(`PgUp frames, ${L} items`, "", large.map((r) => r.pgupFrames));
  add(`PgUp worst frame work, ${S} items (ms)`, "", small.map((r) => r.pgupWorst));
  add(`PgUp longest stall, ${S} items (ms)`, "", small.map((r) => r.pgupStall));
  add(`PgUp worst frame work, ${L} items (ms)`, "< 100", large.map((r) => r.pgupWorst), verdict(large.map((r) => r.pgupWorst), 100));
  add(`PgUp longest stall, ${L} items (ms)`, "< 100", large.map((r) => r.pgupStall), verdict(large.map((r) => r.pgupStall), 100));
  const measurable = wheel.filter((w) => w.measurable);
  if (wheel.length > 0) {
    if (measurable.length === 0) {
      rows.push(["wheel-up 60/s, frame work p95 (ms)", "< 16", "not measurable", "", wheel[0]!.reason === "mouse off" ? "not measurable yet (mouse off until group 8)" : `not measurable (${wheel[0]!.reason})`, ""]);
      rows.push(["wheel-up 60/s, worst frame work (ms)", "", "not measurable", "", "", ""]);
      rows.push(["wheel-up 60/s, longest stall (ms)", "", "not measurable", "", "", ""]);
    } else {
      add("wheel-up 60/s, frame work p95 (ms)", "< 16", measurable.map((w) => w.p95), verdict(measurable.map((w) => w.p95), 16));
      add("wheel-up 60/s, worst frame work (ms)", "", measurable.map((w) => w.worst));
      add("wheel-up 60/s, longest stall (ms)", "", measurable.map((w) => w.stall));
    }
  }
  add("stream-long, chunks per second", "about 30", stream.map((r) => r.chunksPerSecond));
  add("stream-long, frame work p95 (ms)", "< 33", stream.map((r) => r.p95), verdict(stream.map((r) => r.p95), 33));
  add("stream-long, worst frame work (ms)", "", stream.map((r) => r.worst));
  add("stream-long, longest stall (ms)", "", stream.map((r) => r.stall));
  add(`mounted renderables, ${S} items`, "", small.map((r) => r.mounted));
  add(`mounted renderables, ${L} items`, "", large.map((r) => r.mounted));
  if (small.length && large.length) {
    const grow = large.map((r, i) => r.mounted - small[Math.min(i, small.length - 1)]!.mounted);
    add(`mounted, ${L} minus ${S} items`, "<= 400", grow, verdict(grow, 400));
  }

  if (budget.length) {
    add(`mounted, ${o.itemsBudget} items, following`, "", budget.map((r) => r.following));
    add(`mounted, ${o.itemsBudget} items, ${o.budgetUp} back, toggle, 3 density switches: maximum`, `<= ${BUDGET_LIMIT}`, budget.map((r) => r.max), verdict(budget.map((r) => r.max), BUDGET_LIMIT));
  }

  const dragged = drag.filter((d) => d.measurable);
  if (drag.length > 0 && dragged.length === 0) rows.push([`scroll bar drag, ${L} items`, "", "not measurable", "", drag[0]!.reason, ""]);
  if (dragged.length > 0) {
    add(`scroll bar drag ${o.dragSeconds} s, reports sent`, "", dragged.map((d) => d.reports));
    add(`scroll bar drag ${o.dragSeconds} s, frames`, "", dragged.map((d) => d.frames));
    add(`scroll bar drag, frame work p95 (ms)`, "", dragged.map((d) => d.p95));
    add(`scroll bar drag, worst frame work (ms)`, "< 100", dragged.map((d) => d.worst), verdict(dragged.map((d) => d.worst), 100));
    add(`scroll bar drag, longest stall (ms)`, "<= 250", dragged.map((d) => d.stall), verdict(dragged.map((d) => d.stall), 250));
    add(`scroll bar drag, mounted maximum, ${L} items`, `<= ${BUDGET_LIMIT}`, dragged.map((d) => d.mounted), verdict(dragged.map((d) => d.mounted), BUDGET_LIMIT));
  }

  const head = ["Metric", "Target", "Median", "Worst", "Result", "Per run"];
  const md = [
    `| ${head.join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ];
  const dirty = git("status", "--porcelain").length > 0;
  console.log(`S3 scale benchmark: ${o.cols}x${o.rows} PTY, fake-agent; runs: ${S} items ${small.length}, ${L} items ${large.length}, wheel ${wheel.length}, stream ${stream.length}, budget ${budget.length}, drag ${drag.length}`);
  console.log(`Extra acp-tui arguments: ${o.appArgs.join(" ") || "none"}`);
  console.log(`Environment: ${process.platform} ${process.arch}, ${cpus()[0]?.model ?? "unknown CPU"} (${cpus().length} logical CPUs), Bun ${Bun.version}, commit ${git("rev-parse", "--short", "HEAD")}${dirty ? " plus working-tree changes" : ""}`);
  console.log(`Stimuli: PageUp ${o.pgupRate} keys/s; wheel ${o.wheelRate}/s for ${o.wheelSeconds} s; stream-long --delay-scale ${o.streamScale} for ${o.streamSeconds} s; scroll bar drag for ${o.dragSeconds} s`);
  console.log("");
  console.log(md.join("\n"));
  if (large.length) {
    console.log("");
    console.log(`Populate time (prompt sent to end-turn line on screen), ${L} items: ${large.map((r) => f0(r.populateMs)).join(" ")} ms; session updates: ${large[0]!.updates}`);
  }

  const over = budget.filter((r) => r.max > BUDGET_LIMIT);
  if (over.length) {
    console.log("");
    console.log(`MOUNTED BUDGET EXCEEDED: maximum ${Math.max(...over.map((r) => r.max))} against ${BUDGET_LIMIT} in ${over.length} of ${budget.length} runs`);
    process.exitCode = 1;
  } else if (budget.length) {
    console.log("");
    console.log(`Mounted budget: maximum ${Math.max(...budget.map((r) => r.max))} against ${BUDGET_LIMIT}, within it in all ${budget.length} runs`);
  }

  if (o.json) {
    await Bun.write(o.json, JSON.stringify({ options: { ...o, phases: [...o.phases] }, small, large, wheel, stream, budget, drag }, null, 2));
  }
}

if (import.meta.main) await main();
