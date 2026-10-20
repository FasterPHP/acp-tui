// mvp-chrome-and-keys task 4.8 (spec tui-layout "Find bar block"): the real
// CLI against fake-agent under the PTY harness at 63x21 with the default
// layout and an empty prompt box. Closed, the find block takes no row; open, it
// is row 19, directly above the status row on row 20, and the conversation
// gives up one row with its reading position kept. mvp-conversation's "Bar
// position" (test/find/find.pty.test.ts) checks the same at 100x30, scrolled up.
import { afterEach, describe, expect, test } from "bun:test";
import type { PtySession } from "../pty/harness.ts";
import { CARD_HEADER, READY, statusRow } from "../pty/regions.ts";
import { startCli } from "../keys/cli-pty.ts";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

const CTRL_F = { text: "\u0006" };

describe("find bar block (task 4.8)", () => {
  test("find opens: the bar is on row 19, the status row on row 20, and the conversation gives up one row with its reading position kept", async () => {
    const run = startCli("basic", 0, { cols: 63, rows: 21 });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor(CARD_HEADER, 5000);
    await Bun.sleep(400);
    run.s.sendKeys("Enter");
    await run.s.waitFor("end turn", 5000);
    await run.s.waitFor(READY, 5000);
    await Bun.sleep(200);
    await run.s.flush();
    const closed = run.s.screenText();
    // Closed: conversation rows 2 to 13, the blank row 14 (day-one-feedback task group 13), prompt
    // box 15 to 18, spacer 19, status 20, margin 21.
    expect(closed[13]).toBe("");
    expect(closed[14]).toStartWith("╭");
    expect(closed[18]).toBe("");
    const lastBefore = closed[12];

    run.s.sendKeys(CTRL_F);
    await run.s.waitFor((p) => (p.screenText()[18] ?? "").startsWith("find: "), 5000);
    await Bun.sleep(150);
    await run.s.flush();
    const open = run.s.screenText();
    expect(open[18]).toStartWith("find: ");
    expect(open[19]).toBe(statusRow(run.s));
    expect(open[19]).toContain("connected");
    expect(open[20]).toBe("");
    // The prompt box moved up a row (rows 14 to 17, the blank row above it 13, the spacer 18) and
    // the conversation lost its top row: following, the reading position is the end, which stays
    // in view.
    expect(open[13]).toStartWith("╭");
    expect(open[12]).toBe("");
    expect(open[17]).toBe("");
    expect(open[11]).toBe(lastBefore);

    run.s.sendKeys("Esc");
    await run.s.waitFor((p) => !(p.screenText()[18] ?? "").startsWith("find: "), 5000);
    await run.s.flush();
    expect(run.s.screenText()[12]).toBe(lastBefore);
  }, 20000);
});
