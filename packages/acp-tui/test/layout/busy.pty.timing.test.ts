// parallel-tests task 3.1: the timing tests of busy.pty.test.ts (a frame-work budget, a gap and a step interval with a tolerance, a reload within a second, a sweep sampled over a time window), run in the serial pass on a quiet machine.
// What the file covers is in the header of busy.pty.test.ts; its helpers are in busy-helpers.ts.
import { afterEach, describe, expect, test } from "bun:test";
import { configHome } from "../pty/config-home.ts";
import type { PtySession } from "../pty/harness.ts";
import { RUNNING, statusRow } from "../pty/regions.ts";
import { sendPrompt, startCli } from "../conversation/cli.ts";
import { SIZE, BUSY, ACCENT, type Style, STYLES, busyEnv, topRow, indicator, segment, lineFg, changedRows, percentile, inGap } from "./busy-helpers.ts";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

describe("busy indicator (task 4.3)", () => {
  test("gap between tool calls: two screens 250 ms apart differ in the indicator's cells and in no cell outside the top border and the elapsed time", async () => {
    // delay-scale 1: the silent gap between st-1 and st-2 lasts 3 s. The default style: a gap.
    const run = startCli({ scenario: "slow-turn", delayScale: 1, ...SIZE });
    session = run.session;
    await sendPrompt(run.session, "go");
    // st-1 completed: the gap begins (the second tool call has not been sent).
    await inGap(run.session);
    expect(run.session.screenText().join("\n")).not.toContain("Kernel.php");
    const gapStart = performance.now();
    await Bun.sleep(150);
    // Up to three pairs, since a sweep turning at an end of the track can bring the segment back
    // to the same cells after two steps; every pair must change nothing but the border row.
    let moved = false;
    for (let i = 0; i < 3 && !moved; i++) {
      await run.session.flush();
      const a = run.session.screenText();
      const atA = segment(run.session);
      await Bun.sleep(250);
      await run.session.flush();
      const b = run.session.screenText();
      const atB = segment(run.session);
      expect(statusRow(run.session)).toMatch(RUNNING);
      expect(run.session.screenText().join("\n")).not.toContain("Kernel.php");
      const top = topRow(run.session);
      expect(changedRows(a, b).filter((y) => y !== top)).toEqual([]);
      expect(atA).not.toBeNull();
      expect(atB).not.toBeNull();
      moved = atA!.half !== atB!.half;
    }
    expect(moved).toBe(true);
    const gapEnd = performance.now();
    expect(gapEnd - gapStart).toBeLessThan(2900);
  }, 30000);

  // Task 5.4: the frames drawn in the gap redraw the border row alone (no more than one row of cells
  // each: the border; the status row once a second for the elapsed time), and their own work stays
  // under S3's 2 ms idle-running figure at the 95th percentile, for each style at both sizes.
  for (const [cols, rows] of [[63, 21], [200, 50]] as const) {
    for (const style of STYLES) {
      test(`Frame work: style ${style} at ${cols}x${rows} redraws the border row alone, cheaply (task 5.4)`, async () => {
        const run = startCli({ scenario: "slow-turn", delayScale: 1, cols, rows, env: busyEnv({ style }) });
        session = run.session;
        await sendPrompt(run.session, "go");
        await inGap(run.session);
        await run.session.waitFor("end turn", 6000);
        const frames = run.events("frame").map((e) => ({ cells: Number(e["cells"]), work: Number(e["work"] ?? 0) }));
        const quiet = frames.filter((f) => f.cells > 0 && f.cells <= 2 * cols);
        expect(quiet.length).toBeGreaterThanOrEqual(8);
        const p95 = percentile(quiet.map((f) => f.work), 95);
        console.log(
          `busy indicator ${style} at ${cols}x${rows}: ${quiet.length} border-only frames, work p50 ${percentile(quiet.map((f) => f.work), 50).toFixed(3)} ms, p95 ${p95.toFixed(3)} ms, max ${Math.max(...quiet.map((f) => f.work)).toFixed(3)} ms`,
        );
        expect(p95).toBeLessThan(2);
      }, 30000);
    }
  }

  test("Wide pane: at 200x50 with style colour the track is 40 per cent of the border (80 cells) with a 16-cell segment in the busy colour (task 8.3)", async () => {
    // delay-scale 1: the silent gap between st-1 and st-2 lasts 3 s, two passes of the segment.
    const run = startCli({ scenario: "slow-turn", delayScale: 1, cols: 200, rows: 50, env: busyEnv({ style: "colour" }) });
    session = run.session;
    await sendPrompt(run.session, "go");
    await inGap(run.session);
    const starts: number[] = [];
    const deadline = performance.now() + 2600;
    while (performance.now() < deadline && !run.session.screenText().join("\n").includes("Kernel.php")) {
      await run.session.flush();
      const at = segment(run.session, 80);
      if (at) {
        // The segment is 16 cells, or 17 where it starts and ends in the middle of a cell (the
        // half glyphs ╼ and ╾), in the busy colour (not the frame's accent), then the plain line.
        expect(at.cells).toMatch(/^(━{16}|╼━{15}╾)$/);
        expect(at.fg).toBe(BUSY);
        starts.push(at.x);
      }
      await Bun.sleep(30);
    }
    // The segment starts after the corner and one line stub, and its pass spans the 80 cells of
    // the track: its first cell from column 2 to column 66 (the samples are 30 ms apart, so the
    // ends are approached within a few cells).
    expect(starts.length).toBeGreaterThan(20);
    expect(Math.min(...starts)).toBeGreaterThanOrEqual(2);
    expect(Math.min(...starts)).toBeLessThanOrEqual(10);
    expect(Math.max(...starts)).toBeLessThanOrEqual(66);
    expect(Math.max(...starts)).toBeGreaterThanOrEqual(58);
  }, 30000);

  test("Gap by default: at 200x50 16 blank cells move along the 80 columns of the track, every other cell the border's line in the frame's colour", async () => {
    const run = startCli({ scenario: "slow-turn", delayScale: 1, cols: 200, rows: 50 });
    session = run.session;
    await sendPrompt(run.session, "go");
    await inGap(run.session);
    const starts: number[] = [];
    const deadline = performance.now() + 2600;
    while (performance.now() < deadline && !run.session.screenText().join("\n").includes("Kernel.php")) {
      await run.session.flush();
      const at = segment(run.session, 80);
      if (at) {
        // 16 blank cells, or 15 between the half glyphs `╴` and `╶` where it starts mid-cell.
        expect(at.cells).toMatch(/^( {16}|╴ {15}╶)$/);
        // The focused prompt box's frame is in accent: so is the line round the gap.
        expect(lineFg(run.session, 80)).toBe(ACCENT);
        starts.push(at.x);
      }
      await Bun.sleep(30);
    }
    expect(starts.length).toBeGreaterThan(20);
    expect(Math.min(...starts)).toBeLessThanOrEqual(10);
    expect(Math.max(...starts)).toBeGreaterThanOrEqual(58);
  }, 30000);

  test("Even steps on a short track: at 126 columns and 5 per cent, 40 frames move the segment half a cell each, 107 ms apart (within 20 ms), a pass in 1.5 s (within 100 ms)", async () => {
    // The 10-cell minimum track, a 3-cell segment and 7 cells of travel: 14 half-cell steps in a
    // pass. `slow-turn --long-gap` at delay-scale 0.15 holds its silent gap for 6.75 s.
    const run = startCli({
      scenario: "slow-turn",
      delayScale: 0.15,
      agentArgs: ["--long-gap"],
      cols: 126,
      rows: 30,
      env: busyEnv({ track_percent: 5 }),
    });
    session = run.session;
    await sendPrompt(run.session, "go");
    await inGap(run.session);
    // Every change of the indicator's position, with the time xterm parsed the frame that made it.
    const steps: { t: number; half: number }[] = [];
    let y = -1;
    run.session.term.onWriteParsed(() => {
      if (y < 0) y = topRow(run.session);
      const at = y < 0 ? null : indicator(run.session.lineText(run.session.term.buffer.active.baseY + y), 10);
      if (at && at.half !== steps.at(-1)?.half) steps.push({ t: performance.now(), half: at.half });
    });
    await run.session.waitFor(() => steps.length >= 42, 6000);
    // The first sample is a position found, not a step taken; the frames after it are the 40.
    const frames = steps.slice(1, 42);
    expect(frames).toHaveLength(41);
    for (let i = 1; i < frames.length; i++) {
      expect(Math.abs(frames[i]!.half - frames[i - 1]!.half)).toBe(1);
      const interval = frames[i]!.t - frames[i - 1]!.t;
      expect(Math.abs(interval - 1500 / 14)).toBeLessThanOrEqual(20);
    }
    // A pass: from one end of the track (half 0 or 14) to the other.
    const ends = frames.flatMap((f, i) => (f.half === 0 || f.half === 14 ? [i] : []));
    expect(ends.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < ends.length; i++) {
      if (frames[ends[i]!]!.half === frames[ends[i - 1]!]!.half) continue;
      expect(Math.abs(frames[ends[i]!]!.t - frames[ends[i - 1]!]!.t - 1500)).toBeLessThanOrEqual(100);
    }
  }, 30000);

  test("Style changed during a turn: saving the file with style colour redraws the segment as the heavy line within a second, the turn undisturbed", async () => {
    const config = configHome({ density: "compact" });
    const run = startCli({ scenario: "slow-turn", delayScale: 1, ...SIZE, env: config.env });
    session = run.session;
    await sendPrompt(run.session, "go");
    await inGap(run.session);
    await Bun.sleep(100);
    await run.session.flush();
    // The default style: a gap, with no heavy line anywhere in the border.
    expect(segment(run.session)!.cells).toMatch(/^( {5}|╴ {4}╶)$/);
    const saved = performance.now();
    config.write({ density: "compact", busy: { style: "colour" } });
    await run.session.waitFor((p) => /^(━{5}|╼━{4}╾)$/.test(segment(p)?.cells ?? ""), 1500);
    expect(performance.now() - saved).toBeLessThan(1200);
    expect(segment(run.session)!.fg).toBe(BUSY);
    expect(statusRow(run.session)).toMatch(RUNNING);
    expect(run.session.screenText().join("\n")).not.toContain("Kernel.php");
    await run.session.waitFor("end turn", 6000);
  }, 30000);
});
