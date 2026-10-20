// The conversation's scroll bar under the pointer (src/conversation/scrollbar.ts; mvp-chrome-and-keys
// tasks 10.5 and 10.6, design D17; spec tui-layout "Scrollbar pointer actions" and "Scrollbar
// drag"), on by default, in the real CLI under a PTY against fake-agent's long-session at 5000
// items, 100x30, with the terminal's colours answered (so the derived `scrollbar.*` fills are
// drawn). The bar is the conversation's rightmost column (column 99, 0-based), with the two-column
// right margin left of it. The drag's offsets are read from the `scrollbar` debug log events
// (`drag`: `row`, `dy`, `d`, `from`, `offset`, `max` per report), not from timing.
//
// The timing tests of this file are in scrollbar.pty.timing.test.ts (parallel-tests: they run in the serial pass).
import { afterEach, describe, expect, test } from "bun:test";
import { loadFixture, sgrMotion, sgrPress, sgrRelease, type FixtureRecord } from "../pty/harness.ts";
import { promptText } from "../pty/regions.ts";
import { osc52Payloads } from "../selection/pty.ts";
import { sendPrompt, settle } from "./cli.ts";
import { configEnv } from "../pty/config-home.ts";
import { BAR, JEDITERM, TOP, conversationRows, barColumn, thumbRows, start, scrolledPercent, dragEvents, released, toMiddle, proportional, run, disposeRun } from "./scrollbar-helpers.ts";

afterEach(disposeRun);

describe("the bar", () => {
  test("with layout.scrollbar off nothing is drawn in the conversation's last column but text", async () => {
    const s = await start({ env: configEnv({ layout: { scrollbar: false } }) });
    expect(barColumn(s)).not.toContain("T");
    expect(barColumn(s)).not.toContain("-");
  }, 90000);

  test("by default the rightmost column is the bar: the track, and the thumb at the bottom while following", async () => {
    const s = await start();
    const col = barColumn(s);
    expect(col).toMatch(/^-+T+$/);
    expect(col.split("T").length - 1).toBeGreaterThanOrEqual(2);
    expect(scrolledPercent(s)).toBeNull();
  }, 90000);
});

describe("Scrollbar pointer actions", () => {
  test("Track click", async () => {
    const s = await start();
    const rows = conversationRows(s);
    const middle = Math.floor(rows / 2);
    const size = thumbRows(s)!.last - thumbRows(s)!.first + 1;
    s.mousePress(BAR, middle);
    s.mouseRelease(BAR, middle);
    await s.waitFor((p) => scrolledPercent(p) !== null, 5000);
    await settle(s);
    const thumb = thumbRows(s)!;
    expect(thumb.last - thumb.first + 1).toBe(size);
    // The thumb's middle is on the pressed row, and the view at the matching share of the conversation.
    expect(thumb.first + Math.floor(size / 2)).toBe(middle);
    const percent = scrolledPercent(s)!;
    expect(percent).toBeGreaterThan(40);
    expect(percent).toBeLessThan(60);
    expect(s.screenText().slice(0, rows).join("\n")).not.toContain("end turn");
    // Nothing selected: nothing copied, and no clipboard event.
    expect(osc52Payloads(s.rawOutput())).toEqual([]);
    expect(run!.events("clipboard")).toEqual([]);
    expect(run!.events("scrollbar").map((e) => e["action"])).toEqual(["press", "drag", "release"]);
  }, 90000);

  test("Press keeps focus and selection", async () => {
    const s = await start();
    // The prompt box has focus (from the start); select text in the conversation by a drag.
    s.mousePress(2, 2);
    s.mouseMove(40, 6, "left");
    s.mouseRelease(40, 6);
    await s.waitFor((p) => osc52Payloads(p.rawOutput()).length === 1, 5000);
    const copied = osc52Payloads(s.rawOutput())[0]!;
    expect(copied.length).toBeGreaterThan(20);
    await settle(s);
    // Drag the thumb up and release.
    const thumb = thumbRows(s)!;
    const skip = run!.events("scrollbar").length;
    s.mousePress(BAR, thumb.first);
    for (let y = thumb.first - 1; y >= thumb.first - 4; y--) {
      s.mouseMove(BAR, y, "left");
      await Bun.sleep(30);
    }
    s.mouseRelease(BAR, thumb.first - 4);
    await released(s, skip);
    // The conversation has scrolled.
    expect(scrolledPercent(s)).not.toBeNull();
    // The same text is still selected: Ctrl+C copies it again.
    s.sendKeys({ text: "\x03" });
    await s.waitFor((p) => osc52Payloads(p.rawOutput()).length === 2, 5000);
    expect(osc52Payloads(s.rawOutput())[1]).toBe(copied);
    // The prompt box still has focus: typing goes into it.
    s.sendKeys({ text: "X" });
    await s.waitFor((p) => (promptText(p)[0] ?? "") === "X", 5000);
  }, 90000);

  // The follow-up of 11 October 2026 (docs/mvp-notes/chrome-and-keys.md, "Bench"): the last drag
  // report and the release in one read, while the offset set by the report before them still waits
  // for its frame, so the bottom the last report asked for is applied only after that frame, which
  // the fast stream has made taller. The release must still resume following.
  test("Release in the read of the last drag report", async () => {
    // About 400 chunks a second: the reply gains rows in every frame.
    const s = await start({ scenario: "stream-long", agentArgs: [], delayScale: 0.25 });
    await sendPrompt(s, "stream please");
    await s.waitFor((p) => thumbRows(p) !== null && thumbRows(p)!.last - thumbRows(p)!.first < conversationRows(p) / 4, 30000);
    const rows = conversationRows(s);
    // Away from the bottom first, by the thumb's middle on the track.
    let skip = run!.events("scrollbar").length;
    s.mousePress(BAR, Math.floor(rows / 2));
    s.mouseRelease(BAR, Math.floor(rows / 2));
    await s.waitFor(() => run!.events("scrollbar").slice(skip).some((e) => e["action"] === "release"), 10000);
    await s.waitFor((p) => scrolledPercent(p) !== null, 5000);
    // Then, in one write: the press on the thumb, a report one row above the track's last row (its
    // offset is set on the box and waits for the frame), one on the last row (the bottom, held back
    // for that frame) and the release there.
    const thumb = thumbRows(s)!;
    skip = run!.events("scrollbar").length;
    s.write(sgrPress(BAR, thumb.first) + sgrMotion(BAR, rows - 2, "left") + sgrMotion(BAR, rows - 1, "left") + sgrRelease(BAR, rows - 1));
    await s.waitFor(() => run!.events("scrollbar").slice(skip).some((e) => e["action"] === "release"), 10000);
    const events = run!.events("scrollbar").slice(skip);
    // (The release's own report is logged as a `drag` too.)
    expect(events.map((e) => e["action"])).toEqual(["press", "drag", "drag", "drag", "release"]);
    expect(events.at(-1)!["following"]).toBe(true);
    // The view moves with the text as it arrives.
    await s.waitFor((p) => scrolledPercent(p) === null, 5000);
    await Bun.sleep(300);
    expect(scrolledPercent(s)).toBeNull();
    expect(barColumn(s)).toMatch(/T$/);
  }, 120000);

  test("Indicator only under wheel", async () => {
    const s = await start({ mouse: "wheel" });
    const before = barColumn(s);
    expect(before).toMatch(/^-+T+$/);
    s.mousePress(BAR, TOP);
    s.mouseMove(BAR, TOP + 2, "left");
    s.mouseRelease(BAR, TOP + 2);
    await settle(s);
    // The view does not move, nothing is selected, and the thumb still shows the reading position.
    expect(scrolledPercent(s)).toBeNull();
    expect(barColumn(s)).toBe(before);
    expect(osc52Payloads(s.rawOutput())).toEqual([]);
    expect(run!.events("scrollbar")).toEqual([]);
  }, 90000);

  test("Wheel over the bar", async () => {
    const s = await start();
    const rows = conversationRows(s);
    for (let i = 0; i < 3; i++) s.mouseWheel(BAR, 5, 64);
    await s.waitFor((p) => scrolledPercent(p) !== null, 5000);
    await settle(s);
    const overBar = s.screenText().slice(0, rows);
    // Back down over the bar, then the same three events over the text: the same view.
    for (let i = 0; i < 3; i++) s.mouseWheel(BAR, 5, 65);
    await s.waitFor((p) => scrolledPercent(p) === null, 5000);
    await settle(s);
    for (let i = 0; i < 3; i++) s.mouseWheel(40, 5, 64);
    await s.waitFor((p) => scrolledPercent(p) !== null, 5000);
    await settle(s);
    expect(s.screenText().slice(0, rows)).toEqual(overBar);
    expect(run!.events("scrollbar")).toEqual([]);
  }, 90000);

  // The motion reports of the reworked PhpStorm recording (test/fixtures, S1: the pointer moved
  // over the pane without a button, code 35), moved onto the bar's column and over the thumb,
  // replayed at the recorded timing.
  test("Hover does nothing", async () => {
    const s = await start({ env: JEDITERM });
    const thumb = thumbRows(s)!;
    const before = s.screenText();
    const fixture = await loadFixture(`${import.meta.dir}/../fixtures/jediterm-reworked-mouse.jsonl`);
    const motion = fixture.filter((r) => /^\x1b\[<35;/.test(r.data));
    expect(motion.length).toBeGreaterThan(5);
    const t0 = motion[0]!.t_ms;
    const rows = motion.map((r) => Number(/;(\d+)M$/.exec(r.data)![1]) - 1);
    const lowest = Math.max(...rows);
    const moved: FixtureRecord[] = motion.map((r, i) => ({ t_ms: r.t_ms - t0, data: sgrMotion(BAR, Math.max(TOP, thumb.last - (lowest - rows[i]!))) }));
    expect(moved.some((r) => /;(\d+)M$/.exec(r.data)![1] === String(thumb.first + 1))).toBe(true);
    await s.replay(moved);
    await settle(s, 150);
    expect(scrolledPercent(s)).toBeNull();
    expect(s.screenText()).toEqual(before);
    expect(run!.events("scrollbar")).toEqual([]);
  }, 90000);
});

describe("Scrollbar drag", () => {
  test("Slow drag over 5000 items", async () => {
    const s = await start();
    await toMiddle(s);
    const thumb = thumbRows(s)!;
    const skip = run!.events("scrollbar").length;
    s.mousePress(BAR, thumb.first);
    let y = thumb.first;
    for (let i = 0; i < 5; i++) {
      await Bun.sleep(300);
      s.mouseMove(BAR, ++y, "left");
    }
    await Bun.sleep(300);
    s.mouseRelease(BAR, y);
    await released(s, skip);
    const moves = dragEvents(run!, skip).filter((e) => e.dy !== 0);
    expect(moves).toHaveLength(5);
    for (const e of moves) {
      expect(e.offset - e.from).toBeGreaterThanOrEqual(1);
      expect(e.offset - e.from).toBeLessThanOrEqual(3);
    }
    const travelled = moves.at(-1)!.offset - moves[0]!.from;
    expect(travelled).toBeGreaterThanOrEqual(5);
    expect(travelled).toBeLessThanOrEqual(15);
  }, 90000);

  test("Fast drag over the whole track", async () => {
    const s = await start();
    const rows = conversationRows(s);
    // To the top: a press on the track's first row.
    let skip = run!.events("scrollbar").length;
    s.mousePress(BAR, TOP);
    s.mouseRelease(BAR, TOP);
    await released(s, skip);
    expect(scrolledPercent(s)).toBe(0);
    expect(thumbRows(s)!.first).toBe(TOP);
    // From the track's first row to its last, one cell every 10 ms.
    skip = run!.events("scrollbar").length;
    s.mousePress(BAR, TOP);
    for (let y = TOP + 1; y <= rows - 1; y++) {
      s.mouseMove(BAR, y, "left");
      await Bun.sleep(10);
    }
    s.mouseRelease(BAR, rows - 1);
    const release = await released(s, skip);
    expect(release["following"]).toBe(true);
    expect(scrolledPercent(s)).toBeNull();
    expect(s.screenText().slice(0, rows).join("\n")).toContain("end turn");
    expect(barColumn(s)).toMatch(/^-+TT+$/);
    const moves = dragEvents(run!, skip);
    expect(moves.at(-1)!.offset).toBe(moves.at(-1)!.max);
  }, 90000);

  test("Precision by moving away", async () => {
    const s = await start();
    await toMiddle(s);
    const rows = conversationRows(s);
    const thumb = thumbRows(s)!;
    const skip = run!.events("scrollbar").length;
    s.mousePress(BAR, thumb.first);
    await Bun.sleep(10);
    s.mouseMove(BAR - 10, thumb.first, "left");
    for (let y = thumb.first + 1; y <= thumb.first + 5; y++) {
      await Bun.sleep(10);
      s.mouseMove(BAR - 10, y, "left");
    }
    s.mouseRelease(BAR - 10, thumb.first + 5);
    await released(s, skip);
    const moves = dragEvents(run!, skip).filter((e) => e.dy !== 0);
    expect(moves).toHaveLength(5);
    for (const e of moves) {
      expect(e.d).toBe(10);
      expect(Math.abs(e.offset - e.from - (e.dy * proportional(e, rows - TOP)) / 4)).toBeLessThanOrEqual(1);
    }
  }, 90000);

  test("Back over the bar", async () => {
    const s = await start();
    await toMiddle(s);
    const rows = conversationRows(s);
    const thumb = thumbRows(s)!;
    const skip = run!.events("scrollbar").length;
    s.mousePress(BAR, thumb.first);
    let y = thumb.first;
    for (let i = 0; i < 3; i++) {
      await Bun.sleep(10);
      s.mouseMove(BAR - 10, ++y, "left");
    }
    // Back to the bar's column, going on at the same speed.
    for (let i = 0; i < 2; i++) {
      await Bun.sleep(10);
      s.mouseMove(BAR, ++y, "left");
    }
    s.mouseRelease(BAR, y);
    await released(s, skip);
    const moves = dragEvents(run!, skip).filter((e) => e.dy !== 0);
    expect(moves.map((e) => e.d)).toEqual([10, 10, 10, 0, 0]);
    for (const e of moves.slice(0, 3)) expect(Math.abs(e.offset - e.from - (e.dy * proportional(e, rows - TOP)) / 4)).toBeLessThanOrEqual(1);
    // The next report on the bar moves by the full proportional step.
    const back = moves[3]!;
    expect(Math.abs(back.offset - back.from - back.dy * proportional(back, rows - TOP))).toBeLessThanOrEqual(1);
  }, 90000);

  test("Slow drag reaches the end", async () => {
    const s = await start();
    await toMiddle(s);
    const rows = conversationRows(s);
    const thumb = thumbRows(s)!;
    const skip = run!.events("scrollbar").length;
    s.mousePress(BAR, thumb.first);
    let y = thumb.first;
    while (y < rows - 1) {
      await Bun.sleep(300);
      s.mouseMove(BAR, ++y, "left");
    }
    s.mouseRelease(BAR, y);
    const release = await released(s, skip);
    // The slow cells moved a few rows each; the last row of the track is the bottom all the same.
    const moves = dragEvents(run!, skip).filter((e) => e.dy !== 0);
    expect(moves.slice(0, -1).every((e) => e.offset - e.from <= 3)).toBe(true);
    expect(moves.at(-1)!.offset).toBe(moves.at(-1)!.max);
    expect(release["following"]).toBe(true);
    expect(scrolledPercent(s)).toBeNull();
    expect(s.screenText().slice(0, rows).join("\n")).toContain("end turn");
  }, 90000);
});
