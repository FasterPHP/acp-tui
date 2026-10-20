// parallel-tests task 3.2: the scroll bar tests whose assertions depend on load: the fast 3-second drag (a frame-work budget of 100 ms and a stall budget of 250 ms) and the drag back to the bottom of a streaming reply (the known flake of the serial suite under load).
// What the file covers is in the header of scrollbar.pty.test.ts; its helpers are in scrollbar-helpers.ts.
import { afterEach, describe, expect, test } from "bun:test";
import { sendPrompt, settle } from "./cli.ts";
import { BAR, conversationRows, barColumn, thumbRows, start, scrolledPercent, promptTopBorder, framesBetween, released, run, disposeRun } from "./scrollbar-helpers.ts";

afterEach(disposeRun);

describe("Scrollbar pointer actions", () => {
  test("Drag back to the bottom", async () => {
    // A reply streaming (stream-long, about 50 chunks a second) that soon overflows the conversation.
    const s = await start({ scenario: "stream-long", agentArgs: [], delayScale: 2 });
    await sendPrompt(s, "stream please");
    await s.waitFor((p) => thumbRows(p) !== null && thumbRows(p)!.last - thumbRows(p)!.first < conversationRows(p) / 4, 30000);
    // The reader drags the thumb to the middle of the track.
    const rows = conversationRows(s);
    let thumb = thumbRows(s)!;
    let skip = run!.events("scrollbar").length;
    s.mousePress(BAR, thumb.first);
    s.mouseMove(BAR, Math.floor(rows / 2), "left");
    s.mouseRelease(BAR, Math.floor(rows / 2));
    await released(s, skip);
    // (The reply is one message growing, so no new entry arrives below and the `↓ N new` indicator,
    // which counts entries, does not appear; it is checked to be absent at the bottom.)
    await s.waitFor((p) => scrolledPercent(p) !== null, 5000);
    // Then to the track's last row, while the reply still streams.
    thumb = thumbRows(s)!;
    skip = run!.events("scrollbar").length;
    s.mousePress(BAR, thumb.first);
    for (let y = thumb.first + 1; y <= rows - 1; y++) {
      s.mouseMove(BAR, y, "left");
      await Bun.sleep(10);
    }
    s.mouseRelease(BAR, rows - 1);
    const release = await released(s, skip);
    expect(release["following"]).toBe(true);
    expect(scrolledPercent(s)).toBeNull();
    expect(promptTopBorder(s)).not.toMatch(/↓ \d+ new/);
    // As more text arrives, the reply's last row stays visible: the view moves with it.
    const before = s.screenText().slice(0, rows).join("\n");
    await s.waitFor((p) => p.screenText().slice(0, rows).join("\n") !== before, 5000);
    await Bun.sleep(300);
    expect(scrolledPercent(s)).toBeNull();
    expect(barColumn(s)).toMatch(/T$/);
  }, 120000);
});

describe("Scrollbar drag", () => {
  test("a fast drag up and down the whole track for 3 s: no frame's work at 100 ms, no gap over 250 ms, the budget kept", async () => {
    const s = await start();
    const r = run!;
    const thumb = thumbRows(s)!;
    const rows = conversationRows(s);
    const started = Date.now();
    s.mousePress(BAR, thumb.last);
    // Every 10 ms one row, sweeping the track end to end.
    let y = thumb.last;
    let step = -1;
    let moves = 0;
    while (Date.now() - started < 3000) {
      y += step;
      if (y <= 0 || y >= rows - 1) step = -step;
      s.mouseMove(BAR, y, "left");
      moves++;
      await Bun.sleep(10);
    }
    s.mouseRelease(BAR, y);
    await settle(s);
    const ended = Date.now();
    const frames = framesBetween(r, started, ended);
    const workMax = Math.max(...frames.map((f) => f.work));
    // The first frame's gap includes the idle time before the press.
    const gapMax = Math.max(...frames.slice(1).map((f) => f.gap));
    const mounted = Math.max(...r.events("mounted").map((e) => Number(e["count"])));
    console.log(`scrollbar fast drag: ${JSON.stringify({ moves, frames: frames.length, workMax, gapMax, mounted })}`);
    expect(frames.length).toBeGreaterThan(30);
    expect(workMax).toBeLessThan(100);
    expect(gapMax).toBeLessThan(250);
    expect(mounted).toBeLessThanOrEqual(1500);
  }, 120000);
});
