// day-two-feedback task 6.2 (spec tui-layout "Activity bar" scenarios "Fast tool calls do not
// flicker", "Linger ends", "Replaced at once", "No linger"; design D6): the real CLI against
// fake-agent `fast-tools` at 90x30 under the PTY harness. Six tool calls, each in progress for
// 40 ms and 250 ms apart at delay scale 1, then 3 s of silence. By default the activity line stays
// up between them showing the finished call muted, in the same row, and goes 1.5 s after the last
// call ends while the turn still runs; `activity.linger_seconds` 0 turns that off. Since task 13.2
// (Marcus, 17 October 2026) the bar's blank row and line keep their rows for the whole session, so
// when the line goes blank nothing moves.
//
// parallel-tests task 3.1: renamed to `.timing.test.ts`, since every test samples the screen over a
// time window (the linger's 1.5 s with a band, the calls 250 ms apart) and so runs in the serial pass.
import { afterEach, describe, expect, test } from "bun:test";
import { configEnv } from "../pty/config-home.ts";
import type { PtySession } from "../pty/harness.ts";
import { promptBox, RUNNING, statusRow } from "../pty/regions.ts";
import { sendPrompt, startCli } from "../conversation/cli.ts";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

const SIZE = { cols: 90, rows: 30 };
/** The flat theme's muted token: bright black. */
const MUTED = 8;
const TITLES = ["Read src/Pool.php", `Search for "Pool::acquire"`, "Read src/Connection.php", "Run vendor/bin/phpunit tests/PoolTest.php", "Read tests/PoolTest.php", "Edit src/Pool.php"];

/** The prompt box's top border row; -1 if none. */
function boxTop(s: PtySession): number {
  const rows = s.screenText();
  const box = promptBox(s);
  return rows.findIndex((row, y) => row === box[0] && rows[y + box.length - 1] === box.at(-1));
}

interface Line {
  /** The screen row of the activity line. */
  readonly y: number;
  readonly text: string;
}

/** The activity line, directly above the prompt box with the blank row above it, or null: a
 *  running count (`1 running: <title>`) or a finished call (`✓ <title>`, `✗ <title>`). */
function activity(s: PtySession): Line | null {
  const rows = s.screenText();
  const top = boxTop(s);
  if (top < 2) return null;
  const text = rows[top - 1]!;
  return /^ {2}(\d+ running\b|[✓✗] )/.test(text) && rows[top - 2] === "" ? { y: top - 1, text: text.trimEnd() } : null;
}

/** Samples the screen every `every` ms for `ms`, from now. */
async function sample(s: PtySession, ms: number, every = 25): Promise<{ t: number; line: Line | null; top: number; rows: string[]; running: boolean }[]> {
  const out: { t: number; line: Line | null; top: number; rows: string[]; running: boolean }[] = [];
  const end = performance.now() + ms;
  while (performance.now() < end) {
    await s.flush();
    out.push({ t: performance.now(), line: activity(s), top: boxTop(s), rows: s.screenText(), running: RUNNING.test(statusRow(s)) });
    await Bun.sleep(every);
  }
  return out;
}

/** Waits for the first call's line and returns the time it was seen. */
async function firstCall(s: PtySession): Promise<number> {
  await s.waitFor((p) => activity(p) !== null, 5000);
  return performance.now();
}

describe("activity bar linger (task 6.2)", () => {
  test("Fast tool calls do not flicker: from the first call until 1.5 s after the last one's end the line is on one row, the screen's rows do not move, and between calls it shows the finished call's ✓ and title in muted", async () => {
    const run = startCli({ scenario: "fast-tools", delayScale: 1, ...SIZE });
    session = run.session;
    await sendPrompt(run.session, "go");
    const seen = await firstCall(run.session);
    // The last call ends 5 periods and 40 ms after the first starts, and the line lingers 1.5 s
    // more: sample until a margin before that.
    const captures = await sample(run.session, 5 * 250 + 40 + 1500 - 300 - (performance.now() - seen));
    expect(captures.length).toBeGreaterThan(40);
    // One row for the line, one for the prompt box's top: the conversation never lost or gained a row.
    expect(new Set(captures.map((c) => c.line?.y)).size).toBe(1);
    expect(captures.every((c) => c.line !== null)).toBe(true);
    expect(new Set(captures.map((c) => c.top)).size).toBe(1);
    // The rows round the line stay as they were: the top margin and the blank row above the line.
    const y = captures[0]!.line!.y;
    expect(captures.every((c) => c.rows[y - 1] === "" && c.rows[0] === "")).toBe(true);
    // Between calls: the finished call's glyph and title, muted.
    const lingering = captures.filter((c) => c.line!.text.startsWith("  ✓ "));
    expect(lingering.length).toBeGreaterThanOrEqual(5);
    for (const c of lingering) expect(TITLES.some((title) => c.line!.text === `  ✓ ${title}`)).toBe(true);
    // The muted look, read from the screen: the glyph and the title in bright black.
    await run.session.flush();
    const now = activity(run.session);
    expect(now?.text).toBe("  ✓ Edit src/Pool.php");
    const abs = run.session.term.buffer.active.baseY + now!.y;
    for (const x of [2, 4]) {
      const cell = run.session.cell(abs, x)!;
      expect(cell.isFgPalette() ? cell.getFgColor() : null).toBe(MUTED);
    }
    expect(statusRow(run.session)).toMatch(RUNNING);
  }, 30000);

  test("Linger ends: 1.5 s after the last call ended the activity line is blank while the turn is still running, and the prompt box has not moved", async () => {
    const run = startCli({ scenario: "fast-tools", delayScale: 1, ...SIZE });
    session = run.session;
    await sendPrompt(run.session, "go");
    // The last call's finished line is the first time `Edit src/Pool.php` shows with a ✓.
    await run.session.waitFor((p) => activity(p)?.text === "  ✓ Edit src/Pool.php", 5000);
    const ended = performance.now();
    const top = boxTop(run.session);
    await run.session.waitFor((p) => activity(p) === null, 3000);
    const gone = performance.now() - ended;
    expect(gone).toBeGreaterThanOrEqual(1500 - 150);
    expect(gone).toBeLessThanOrEqual(1500 + 400);
    // Still running, in the silence: the line is blank but keeps its row (task 13.2), so the
    // prompt box has not moved, and the turn has not ended.
    expect(statusRow(run.session)).toMatch(RUNNING);
    const rows = run.session.screenText();
    const after = boxTop(run.session);
    expect(after).toBe(top);
    expect(rows[after - 1]).toBe("");
    expect(rows[after - 2]).toBe("");
    expect(rows.join("\n")).not.toContain("Pool now releases its connections");
    await run.session.waitFor("Pool now releases its connections", 5000);
  }, 30000);

  test("Replaced at once: a call that starts while the line lingers shows `1 running` and its title in the next frame, never the finished one again", async () => {
    const run = startCli({ scenario: "fast-tools", delayScale: 1, ...SIZE });
    session = run.session;
    await sendPrompt(run.session, "go");
    await firstCall(run.session);
    const captures = await sample(run.session, 5 * 250 + 100, 10);
    // The line's text over time, a change at a time: running, finished, running, finished, ... in
    // the calls' order, so each title's finished line never follows the next call's running one.
    const texts = captures.flatMap((c) => (c.line ? [c.line.text.slice(2)] : [])).filter((t, i, all) => t !== all[i - 1]);
    const expected = TITLES.flatMap((title) => [`1 running: ${title}`, `✓ ${title}`]);
    let at = -1;
    for (const text of texts) {
      const next = expected.indexOf(text, at + 1);
      expect(next).toBeGreaterThan(at);
      at = next;
    }
    // Most of the finished lines were seen: the linger covers the 210 ms between calls.
    expect(texts.filter((t) => t.startsWith("✓ ")).length).toBeGreaterThanOrEqual(4);
  }, 30000);

  test("No linger: with activity.linger_seconds 0 the line goes blank between calls and a ✓ line is never shown", async () => {
    const run = startCli({ scenario: "fast-tools", delayScale: 1, ...SIZE, env: configEnv({ density: "compact", activity: { linger_seconds: 0 } }) });
    session = run.session;
    await sendPrompt(run.session, "go");
    await firstCall(run.session);
    const captures = await sample(run.session, 5 * 250 + 40 + 400, 10);
    expect(captures.some((c) => c.line?.text.startsWith("  ✓ "))).toBe(false);
    // Between calls the line is blank: a capture with no line while the turn runs, the prompt box
    // on the row it always had (task 13.2).
    expect(captures.some((c) => c.line === null && c.running)).toBe(true);
    expect(new Set(captures.map((c) => c.top)).size).toBe(1);
    const idle = captures.find((c) => c.line === null && c.running)!;
    expect(idle.rows[idle.top - 1]).toBe("");
    expect(idle.rows[idle.top - 2]).toBe("");
  }, 30000);

  test("The row is reserved for the whole session (task 13.2): with tool calls further apart than the linger the line is blank between them and the prompt box and the conversation's rows never move", async () => {
    // A linger of 0.2 s against calls 500 ms apart (delay scale 2): the line is blank for about
    // 260 ms between calls, as it was absent before task 13.2.
    const run = startCli({ scenario: "fast-tools", delayScale: 2, ...SIZE, env: configEnv({ density: "compact", activity: { linger_seconds: 0.2 } }) });
    session = run.session;
    await run.session.waitFor((p) => promptBox(p).length > 0, 10000);
    const before = boxTop(run.session);
    await sendPrompt(run.session, "go");
    const captures = await sample(run.session, 5 * 500 + 80 + 400, 10);
    // The prompt box never moved, from before the first call to after the last.
    expect(new Set(captures.map((c) => c.top))).toEqual(new Set([before]));
    // The capture set covers both a line with a call and a blank line while the turn runs.
    expect(captures.some((c) => c.line !== null)).toBe(true);
    const blank = captures.filter((c) => c.line === null && c.running);
    expect(blank.length).toBeGreaterThan(5);
    // The two rows above the prompt box are the line and its blank row.
    for (const c of blank) expect([c.rows[c.top - 1], c.rows[c.top - 2]]).toEqual(["", ""]);
  }, 30000);
});
