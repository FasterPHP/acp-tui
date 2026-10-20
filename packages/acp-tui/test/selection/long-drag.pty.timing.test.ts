// parallel-tests task 3.2: the 10-second drag with auto-scroll of long-drag.pty.test.ts (task
// 14.4, OpenCode #51056): no frame's work over 100 ms and no gap between frames over 250 ms. Both
// are budgets on the machine's speed, so the test runs in the serial pass; the edge auto-scroll test
// stays in long-drag.pty.test.ts, whose header has the rest.
import { afterEach, describe, expect, test } from "bun:test";
import type { PtySession } from "../pty/harness.ts";
import { sendPrompt, settle, startCli, type CliRun } from "../conversation/cli.ts";
import { localEnv, osc52Payloads } from "./pty.ts";

let run: CliRun | undefined;
afterEach(async () => {
  await run?.session.dispose();
  run = undefined;
});

/** The conversation's last row: the row above the prompt box's top border. */
function conversationBottom(s: PtySession): number {
  return s.screenText().findIndex((l) => l.startsWith("╭")) - 1;
}

describe("no freeze during a 10-second drag with auto-scroll (phase-1a task 14.4)", () => {
  test("long-session, 1000 items at 100x30: no frame's work over 100 ms, no gap over 250 ms while input arrives", async () => {
    run = startCli({ scenario: "long-session", agentArgs: ["--items", "1000"], cols: 100, rows: 30, env: localEnv() });
    const s = run.session;
    await sendPrompt(s, "history");
    await s.waitFor(/end turn/, 30000);
    await settle(s);
    // To the top: the conversation's cursor to the first item.
    s.sendKeys("Tab");
    await Bun.sleep(100);
    s.sendKeys("Home");
    // Row 2: below the top margin and the user card's padding row.
    await s.waitFor((p) => p.screenText()[2]!.startsWith("   history"), 5000);
    await settle(s);
    const bottom = conversationBottom(s);
    const started = Date.now();
    s.mousePress(2, 2);
    s.mouseMove(5, 2, "left");
    // Hold the pointer on the last row (one row per step), with motion every 50 ms, for 10 s.
    let moves = 0;
    while (Date.now() - started < 10000) {
      s.mouseMove(40 + (moves++ % 2), bottom, "left");
      await Bun.sleep(50);
    }
    s.mouseRelease(40, bottom);
    const ended = Date.now();
    await s.waitFor((p) => osc52Payloads(p.rawOutput()).length > 0, 10000);
    const copied = osc52Payloads(s.rawOutput())[0]!;

    const frames = run
      .events("frame")
      .filter((e) => {
        const at = Date.parse(String(e["ts"]));
        return at >= started && at <= ended;
      })
      .map((e) => ({ at: Date.parse(String(e["ts"])), work: Number(e["work"]), gap: Number(e["gap"]) }));
    const works = frames.map((f) => f.work).sort((a, b) => a - b);
    const gaps = frames.slice(1).map((f) => f.gap);
    const summary = {
      frames: frames.length,
      workMax: works.at(-1),
      workP95: works[Math.floor(works.length * 0.95)],
      workMedian: works[Math.floor(works.length / 2)],
      gapMax: Math.max(...gaps),
      copiedLines: copied.split("\n").length,
      copiedChars: copied.length,
      moves,
    };
    console.log(`long drag (task 14.4): ${JSON.stringify(summary)}`);
    // It really scrolled for the whole drag: about 25 frames a second and hundreds of rows.
    expect(frames.length).toBeGreaterThan(150);
    expect(summary.copiedLines).toBeGreaterThan(200);
    expect(copied.startsWith("history")).toBe(true);
    expect(summary.workMax!).toBeLessThan(100);
    expect(summary.gapMax).toBeLessThan(250);
  }, 90000);
});
