// mvp-chrome-and-keys task 4.4 (spec tui-layout "Prompt box top border"): the
// real CLI against fake-agent's `grouping` scenario under the PTY harness. The
// top border holds, left to right, the busy indicator's track, a notice in the
// middle and the `↓ N new` indicator at the right end; a click on the
// indicator resumes following. mvp-conversation's "Scrolling and following"
// tests (test/conversation/window/navigation.pty.test.ts) cover the count and
// the reading position in more detail.
import { afterEach, describe, expect, test } from "bun:test";
import type { PtySession } from "../pty/harness.ts";
import { promptBox, REQUIRES_ACTION, statusRow } from "../pty/regions.ts";
import { answerPermission, sendPrompt, settle, startCli, type CliRun } from "../conversation/cli.ts";

let run: CliRun | undefined;
afterEach(async () => {
  run?.session.kill("SIGTERM");
  await run?.session.dispose();
  run = undefined;
});

const COLS = 80;
const topBorder = (s: PtySession): string => promptBox(s)[0] ?? "";
const LONG_PROMPT = "Please look at the router and its wiring, then reload the configuration. ".repeat(6).trim();

describe("prompt box top border (task 4.4)", () => {
  test("new content while scrolled up: the right end reads ↓ 4 new, and a click on it resumes following and removes it", async () => {
    run = startCli({ scenario: "grouping", cols: COLS, rows: 16, delayScale: 25 });
    const s = run.session;
    await sendPrompt(s, LONG_PROMPT);
    await s.waitFor(REQUIRES_ACTION, 30000);
    await settle(s);
    for (let i = 0; i < 6; i++) s.mouseWheel(10, 1, 64);
    await s.waitFor((p) => /scrolled/.test(statusRow(p)), 5000);
    await answerPermission(s, "1");
    // The permission record and three reads arrive below the reader: four entries.
    await s.waitFor((p) => topBorder(p).includes("↓ 4 new"), 10000);
    expect(topBorder(s).endsWith(" ↓ 4 new ─╮")).toBe(true);
    // The track at the left is the busy indicator's (the turn is still running): 40 per cent of the
    // 80-column border, 32 cells, with the default style's moving gap of 6 cells (7 with its half glyphs).
    expect(topBorder(s).slice(2, 34)).toMatch(/[ ╴╶]{6,}/);

    const y = s.screenText().findIndex((row) => row === topBorder(s));
    s.mouseClick(topBorder(s).indexOf("↓") + 2, y);
    await s.waitFor((p) => !topBorder(p).includes("↓") && !/scrolled/.test(statusRow(p)), 5000);
  }, 60000);
});
