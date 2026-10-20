// Edge auto-scroll (phase-1a task 14.2) and no freeze during a long drag (task
// 14.4, OpenCode #51056), in the real CLI under a PTY. The child has no display, so no host clipboard, and the
// copy is read back from OSC 52 in the PTY output (./pty.ts).
//
// 14.4's measure: the `frame` log event's `work` (the frame's own time:
// callbacks, layout, render including the selection's post-process, native
// write), never over 100 ms; and, while motion reports keep arriving every
// 50 ms, no gap between two frames over 250 ms. Auto-scroll steps every 40 ms,
// so frames are expected about every 40 ms; 250 ms is six missed steps, a
// hitch anyone would see (4 frames a second), and far enough above the step
// not to flake on a loaded machine.
//
// The 10-second drag of task 14.4 is in long-drag.pty.timing.test.ts (parallel-tests: it runs in the serial pass).
import { afterEach, describe, expect, test } from "bun:test";
import type { PtySession } from "../pty/harness.ts";
import { READY } from "../pty/regions.ts";
import { sendPrompt, settle, startCli, type CliRun } from "../conversation/cli.ts";
import { localEnv, osc52Payloads } from "./pty.ts";

let run: CliRun | undefined;
afterEach(async () => {
  await run?.session.dispose();
  run = undefined;
});

describe("edge auto-scroll while dragging (phase-1a task 14.2)", () => {
  test("dragging to the conversation's top row scrolls it and extends the selection to text that was off screen", async () => {
    run = startCli({ scenario: "copy-fixtures", cols: 60, rows: 20, env: localEnv() });
    const s = run.session;
    await sendPrompt(s, "give me things to copy");
    await s.waitFor((p) => p.screenText().some((l) => l.startsWith("  ● third item")) && READY.test(p.screenText().join("\n")), 15000);
    await settle(s);
    // Following the bottom: the prompt at the top of the conversation is off screen.
    expect(s.screenText().some((l) => l.startsWith("   give me things to copy"))).toBe(false);
    const row = s.screenText().findIndex((l) => l.startsWith("  ● third item"));
    s.mousePress(4, row);
    s.mouseMove(4, row - 1, "left");
    // Row 2 is the conversation's top row, below the top margin (mvp-chrome-and-keys task 4.1).
    for (let t = 0; t < 40; t++) {
      // Column 1 is the gutter, column 2 the first character: both resolve to the line's start.
      s.mouseMove(1 + (t % 2), 1, "left");
      await Bun.sleep(50);
    }
    s.mouseRelease(2, 1);
    await s.waitFor((p) => osc52Payloads(p.rawOutput()).length > 0, 5000);
    const copied = osc52Payloads(s.rawOutput())[0]!;
    expect(copied.startsWith("give me things to copy\n\n<?php\n")).toBe(true);
    expect(copied.endsWith("● first item\n● second item, with bold text\n● t")).toBe(true);
    // The user card has a padding row above its text (cards.padding.rows), and its text starts
    // after the bar and two columns of padding.
    expect(s.screenText()[2]).toStartWith("   give me things to copy");
  }, 40000);
});
