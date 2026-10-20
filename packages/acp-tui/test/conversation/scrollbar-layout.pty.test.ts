// The conversation's right margin and the scroll bar's place (mvp-chrome-and-keys tasks 10.2,
// 10.3 and 11.1; spec tui-layout "Conversation right margin" and "Conversation scrollbar"), in the
// real CLI under a PTY. Each session is a fixture opened with `--resume` (fake-agent `--load
// --sessions`): a crafted agent paragraph last, so its wrapping can be compared with a greedy wrap
// at the expected width, after up to 2499 short turns (5000 items in all) where the scenario wants
// a session that overflows.
//
// The timing tests of this file are in scrollbar-layout.pty.timing.test.ts (parallel-tests: they run in the serial pass).
import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_GLYPHS } from "../../src/conversation/glyphs.ts";
import { osc52Payloads } from "../selection/pty.ts";
import { settle } from "./cli.ts";
import { SURFACES, OFF, PARAGRAPH, wrap, open, bgOf, charOf, TOP, conversationRows, expectBlank, paragraphRows, textWidth, run, disposeRun } from "./scrollbar-layout-helpers.ts";

afterEach(disposeRun);

describe("Conversation right margin", () => {
  test("Margin at IDE-pane width", async () => {
    const s = await open({ cols: 63, rows: 21, turns: 3, env: OFF });
    const expected = wrap(PARAGRAPH, textWidth(63, false));
    expect(expected.length).toBeGreaterThan(3);
    // The wrap really is at column 61: one column narrower or wider would break it elsewhere.
    expect(wrap(PARAGRAPH, textWidth(63, false) - 1)).not.toEqual(expected);
    expect(wrap(PARAGRAPH, textWidth(63, false) + 1)).not.toEqual(expected);
    expect(paragraphRows(s, expected)).toEqual(expected);
    expectBlank(s, 62, 63);
  }, 90000);

  test("Margin in a wide pane", async () => {
    const s = await open({ cols: 100, rows: 30, turns: 3, env: OFF });
    const expected = wrap(PARAGRAPH, textWidth(100, false));
    expect(expected.length).toBeGreaterThan(1);
    expect(wrap(PARAGRAPH, textWidth(100, false) - 1)).not.toEqual(expected);
    expect(wrap(PARAGRAPH, textWidth(100, false) + 1)).not.toEqual(expected);
    expect(paragraphRows(s, expected)).toEqual(expected);
    expectBlank(s, 99, 100);
  }, 90000);
});

describe("Conversation scrollbar", () => {
  test("Bar and padding at IDE-pane size", async () => {
    const s = await open({ cols: 63, rows: 21, turns: 2500 });
    const rows = conversationRows(s);
    for (let y = TOP; y < rows; y++) expect([SURFACES["scrollbar.track"], SURFACES["scrollbar.thumb"]]).toContain(bgOf(s, y, 62));
    // No text beyond column 60: the margin is blank, and the bar has no character on it.
    expectBlank(s, 61, 62);
    for (let y = 0; y < rows; y++) expect(charOf(s, y, 62) || " ").toBe(" ");
    // The paragraph wraps at column 60.
    const expected = wrap(PARAGRAPH, textWidth(63, true));
    expect(paragraphRows(s, expected)).toEqual(expected);
  }, 120000);

  test("Thumb visible at scale", async () => {
    const s = await open({ cols: 63, rows: 21, turns: 2500 });
    const rows = conversationRows(s);
    const column = Array.from({ length: rows - TOP }, (_, i) => TOP + i).map((y) => (bgOf(s, y, 62) === SURFACES["scrollbar.thumb"] ? "T" : bgOf(s, y, 62) === SURFACES["scrollbar.track"] ? "-" : "."));
    expect(column.join("")).toMatch(/^-+TT+$/);
    for (let y = 0; y < rows; y++) expect(["▀", "▄", "▌", "▐"]).not.toContain(charOf(s, y, 62));
  }, 120000);

  test("Nothing to scroll", async () => {
    // Three short items: a prompt, a read and a reply.
    const s = await open({ cols: 63, rows: 21, turns: [{ user: "one", tools: [{ title: "Read a.txt", kind: "read" }], agent: "two" }] });
    expectBlank(s, 61, 63);
  }, 60000);

  // mvp-configuration task 6.5 (spec tui-layout "Scrollbar setting"): the setting from the file.
  test("Scrollbar off from the file: no conversation cell on the bar's surfaces, and agent text wraps at column 61", async () => {
    const off = await open({ cols: 63, rows: 21, turns: 2500, env: OFF });
    const rows = conversationRows(off);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < 63; x++) expect([SURFACES["scrollbar.track"], SURFACES["scrollbar.thumb"]]).not.toContain(bgOf(off, y, x));
    }
    const wider = paragraphRows(off, wrap(PARAGRAPH, textWidth(63, false)));
    await disposeRun();
    const on = await open({ cols: 63, rows: 21, turns: 2500 });
    const narrower = paragraphRows(on, wrap(PARAGRAPH, textWidth(63, true)));
    // One column wider: the same text, wrapped at 61 instead of 60.
    expect(wider).toEqual(wrap(PARAGRAPH, 59));
    expect(narrower).toEqual(wrap(PARAGRAPH, 58));
    expect(wider).not.toEqual(narrower);
  }, 180000);

  test("Flat theme", async () => {
    const s = await open({ cols: 63, rows: 21, turns: 2500, colours: null });
    const rows = conversationRows(s);
    // To the middle: a press and release on the track's middle row.
    s.mousePress(62, Math.floor(rows / 2));
    s.mouseRelease(62, Math.floor(rows / 2));
    // The status row is above the bottom margin.
    await s.waitFor((p) => /scrolled \d+%/.test(p.screenText().at(-2) ?? ""), 5000);
    await settle(s);
    const glyphs = Array.from({ length: rows - TOP }, (_, i) => charOf(s, TOP + i, 62)).join("");
    const { track, thumb } = DEFAULT_GLYPHS.scrollbar;
    expect(glyphs).toMatch(new RegExp(`^${track}+${thumb}{2,}${track}+$`));
    for (let y = TOP; y < rows; y++) {
      const cell = s.cell(s.term.buffer.active.baseY + y, 62)!;
      // In `muted` (bright black under the flat theme), and no truecolour background.
      expect(cell.isFgPalette() && cell.getFgColor()).toBe(8);
      expect(cell.isBgRGB()).toBe(false);
    }
  }, 120000);

  test("Highlights stay off the margin and the bar", async () => {
    // mvp-conversation's selection and find with the bar on: no highlight in columns 61 to 63.
    const s = await open({ cols: 63, rows: 21, turns: 2500 });
    const rows = conversationRows(s);
    const highlights = [SURFACES["surface.selection"], SURFACES["find.current"], SURFACES["find.other"]];
    const rightColumns = () => {
      for (let y = TOP; y < conversationRows(s); y++) {
        expect([bgOf(s, y, 60), bgOf(s, y, 61)]).toEqual(["default", "default"]);
        expect([SURFACES["scrollbar.track"], SURFACES["scrollbar.thumb"]]).toContain(bgOf(s, y, 62));
      }
    };
    // A drag from the first row into the margin, over the paragraph's rows to the last row.
    s.mousePress(2, TOP);
    s.mouseMove(30, 4, "left");
    s.mouseMove(61, rows - 1, "left");
    s.mouseRelease(61, rows - 1);
    await s.waitFor((p) => osc52Payloads(p.rawOutput()).length > 0, 5000);
    await settle(s);
    const selected = Array.from({ length: rows }, (_, y) => Array.from({ length: 60 }, (_, x) => bgOf(s, y, x))).flat();
    expect(selected.filter((bg) => bg === SURFACES["surface.selection"]).length).toBeGreaterThan(100);
    rightColumns();
    // Find: every `abc` on screen is a hit, many of them at the paragraph's right edge.
    s.sendKeys("Esc");
    await Bun.sleep(150);
    s.sendKeys({ text: "\x06" });
    // The find bar is above the status row and the bottom margin.
    await s.waitFor((p) => (p.screenText().at(-3) ?? "").startsWith("find: "), 5000);
    s.sendKeys({ text: "abc" });
    await s.waitFor((p) => /\bhits\b/.test(p.screenText().at(-3) ?? ""), 5000);
    s.sendKeys("Enter");
    await s.waitFor((p) => /\b\d+ of \d+/.test(p.screenText().at(-3) ?? ""), 5000);
    await settle(s);
    const found = Array.from({ length: conversationRows(s) }, (_, y) => Array.from({ length: 60 }, (_, x) => bgOf(s, y, x))).flat();
    expect(found.filter((bg) => highlights.includes(bg)).length).toBeGreaterThan(10);
    rightColumns();
  }, 120000);
});
