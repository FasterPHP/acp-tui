// mvp-chrome-and-keys task 4.3 and day-two-feedback task group 5 (spec tui-layout "Busy indicator";
// design D3 and D4): the real CLI against fake-agent under the PTY harness at 63x21. A segment
// sweeps over the track at the left of the prompt box's top border from the prompt to the response,
// through the silent gap between two tool calls (`slow-turn`), as a moving gap by default
// (`busy.style` `gap`), as the heavy line in the busy token's colour (`colour`) or in the frame's
// own (`border`); it moves a half cell a frame at one even interval, stands still in the warning
// colour while a permission request waits (`basic`), and is gone once the turn ends. Only the
// border row redraws for it: the frame log (`ACP_TUI_LOG`) shows at most one row of cells per frame
// during the gap, and the frames' own work (`work`) stays under S3's figure (95th percentile under
// 2 ms idle-running), for each style at 63x21 and 200x50.
//
// The timing tests of this file are in busy.pty.timing.test.ts (parallel-tests: they run in the serial pass).
import { afterEach, describe, expect, test } from "bun:test";
import type { PtySession } from "../pty/harness.ts";
import { CARD_HEADER, promptBox, READY, REQUIRES_ACTION } from "../pty/regions.ts";
import { sendPrompt, startCli } from "../conversation/cli.ts";
import { SIZE, TRACK, BUSY, ACCENT, WARNING, STYLES, busyEnv, indicator, segment, lineFg, inGap } from "./busy-helpers.ts";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

describe("busy indicator (task 4.3)", () => {
  test("Border style: the segment is the heavy line in the frame's accent colour while the prompt box has focus", async () => {
    const run = startCli({ scenario: "slow-turn", delayScale: 1, ...SIZE, env: busyEnv({ style: "border" }) });
    session = run.session;
    await sendPrompt(run.session, "go");
    await inGap(run.session);
    await Bun.sleep(100);
    await run.session.flush();
    const at = segment(run.session);
    expect(at).not.toBeNull();
    expect(at!.cells).toMatch(/^(━{5}|╼━{4}╾)$/);
    expect(at!.fg).toBe(ACCENT);
  }, 20000);

  test("Focused frame: with style colour the segment's foreground differs from the frame's accent", async () => {
    const run = startCli({ scenario: "slow-turn", delayScale: 1, ...SIZE, env: busyEnv({ style: "colour" }) });
    session = run.session;
    await sendPrompt(run.session, "go");
    await inGap(run.session);
    await Bun.sleep(100);
    await run.session.flush();
    const at = segment(run.session);
    expect(at!.fg).toBe(BUSY);
    expect(at!.fg).not.toBe(ACCENT);
    expect(lineFg(run.session, TRACK)).toBe(ACCENT);
  }, 20000);

  for (const style of STYLES) {
    test(`waiting for the user: a permission request stops the indicator, drawn as the heavy line in the warning colour until it is answered (style ${style})`, async () => {
      const run = startCli({ scenario: "basic", ...SIZE, env: busyEnv({ style }) });
      session = run.session;
      await sendPrompt(run.session, "go");
      await run.session.waitFor(CARD_HEADER, 5000);
      await run.session.waitFor(REQUIRES_ACTION, 5000);
      await Bun.sleep(100);
      await run.session.flush();
      const first = segment(run.session);
      expect(first).not.toBeNull();
      expect(first!.cells).toMatch(/^(━{5}|╼━{4}╾)$/);
      expect(first!.fg).toBe(WARNING);
      await Bun.sleep(350);
      await run.session.flush();
      expect(segment(run.session)).toEqual(first);
      // Answered: the turn ends (basic finishes at once at delay-scale 0) and the border is plain.
      run.session.sendKeys("Enter");
      await run.session.waitFor(READY, 5000);
      await run.session.waitFor((p) => segment(p) === null, 5000);
    }, 20000);
  }

  test("idle: once the prompt response arrives the top border shows no indicator", async () => {
    const run = startCli({ scenario: "slow-turn", delayScale: 0, ...SIZE });
    session = run.session;
    await run.session.waitFor(READY, 15000);
    expect(segment(run.session)).toBeNull();
    await sendPrompt(run.session, "go");
    await run.session.waitFor("Both files read.", 5000);
    await run.session.waitFor(READY, 5000);
    await run.session.waitFor((p) => segment(p) === null, 5000);
    const box = promptBox(run.session);
    expect(box[0]).toBe(`╭${"─".repeat(SIZE.cols - 2)}╮`);
  }, 20000);
});
