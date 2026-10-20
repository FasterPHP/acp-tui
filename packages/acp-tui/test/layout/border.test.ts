// Task 6.3 and mvp-chrome-and-keys tasks 4.3 to 4.5: the prompt box's borders
// (spec tui-layout "Prompt box", "Border values", "Config option pills",
// "Prompt box top border", "Busy indicator"). The values come through the real
// view derivation from a session reporting mode `Auto`, model `Opus 5.5`,
// effort `high` and usage 38000 of 200000, which no fake-agent scenario
// reports together (the PTY tests use `config-options` and `basic`).
import { describe, expect, test } from "bun:test";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { createSession, type Session } from "acp-model";
import {
  BUSY_INTERVAL_MAX_MS,
  BUSY_INTERVAL_MIN_MS,
  BUSY_PASS_MS,
  bottomBorder,
  busyPosition,
  busySegmentWidth,
  busySteps,
  busyTiming,
  busyTrack,
  busyTrackWidth,
  newBelowSpan,
  pillAt,
  topBorder,
  type BusyState,
} from "../../src/layout/border.ts";
import { ASCII_CHROME_GLYPHS, DEFAULT_CHROME_GLYPHS } from "../../src/layout/glyphs.ts";
import { displayWidth } from "../../src/layout/segments.ts";
import { deriveSessionView } from "../../src/layout/view.ts";

const option = (id: string, name: string, category: string, value: string, valueName: string): SessionConfigOption => ({
  id,
  name,
  category,
  type: "select",
  currentValue: value,
  options: [{ value, name: valueName }],
});
const session: Session = {
  ...createSession(),
  configOptions: [
    option("mode", "Mode", "mode", "auto", "Auto"),
    option("model", "Model", "model", "opus", "Opus 5.5"),
    option("effort", "Effort", "thought_level", "high", "high"),
  ],
  usage: { used: 38_000, size: 200_000, cost: null },
};
const text = (segments: { text: string }[]) => segments.map((s) => s.text).join("");

describe("bottom border: config option pills (task 4.5)", () => {
  test("border values: Auto, Opus 5.5, high and the context as 38k of 200k", () => {
    const row = text(bottomBorder(deriveSessionView(session), 63, "accent"));
    expect(row).toBe(`╰─ Mode Auto ─ Model Opus 5.5 ─ Effort high ${"─".repeat(7)} 38k/200k ─╯`);
    expect(displayWidth(row)).toBe(63);
  });

  test("effort shown: Mode Auto, Model Opus 5.5 and Effort high in that order at 120 columns, whatever the options' order", () => {
    const reordered: Session = { ...session, configOptions: [...session.configOptions].reverse() };
    const row = text(bottomBorder(deriveSessionView(reordered), 120, "muted"));
    expect(row.startsWith("╰─ Mode Auto ─ Model Opus 5.5 ─ Effort high ─")).toBe(true);
  });

  test("narrow pane: at 61 columns the values and the gauge are all visible, the names dropped where they do not fit", () => {
    const view = deriveSessionView({
      ...session,
      configOptions: [
        option("mode", "Permission mode", "mode", "auto", "Auto"),
        option("model", "Model", "model", "opus", "Opus 5.5"),
        option("effort", "Reasoning effort", "thought_level", "high", "high"),
      ],
    });
    const row = text(bottomBorder(view, 61, "muted"));
    expect(displayWidth(row)).toBe(61);
    for (const value of ["Auto", "Opus 5.5", "high", "38k/200k"]) expect(row).toContain(value);
    expect(row).not.toContain("Reasoning effort");
    // The names go from the last pill first.
    expect(row).toContain("Permission mode Auto");
  });

  test("narrower still: names, then values truncated, the gauge last; the width is never exceeded", () => {
    const view = deriveSessionView(session);
    for (const width of [50, 40, 30, 24, 16, 8]) expect(displayWidth(text(bottomBorder(view, width, "muted")))).toBeLessThanOrEqual(width);
    const forty = text(bottomBorder(view, 40, "muted"));
    expect(forty).toContain("38k/200k");
    expect(forty).not.toContain("Mode");
    const thirty = text(bottomBorder(view, 30, "muted"));
    expect(thirty).toContain("…");
    expect(thirty).toContain("38k/200k");
    expect(text(bottomBorder(view, 16, "muted"))).not.toContain("38k");
  });

  test("no effort option: no effort pill", () => {
    const view = deriveSessionView({ ...session, configOptions: session.configOptions.slice(0, 2) });
    const row = text(bottomBorder(view, 63, "muted"));
    expect(row).toBe(`╰─ Mode Auto ─ Model Opus 5.5 ${"─".repeat(21)} 38k/200k ─╯`);
    expect(row).not.toContain("Effort");
  });

  test("legacy session modes stand in for the mode option, named Mode", () => {
    const legacy: Session = { ...createSession(), modes: { currentModeId: "ask", availableModes: [{ id: "ask", name: "Ask" }] } };
    expect(text(bottomBorder(deriveSessionView(legacy), 30, "muted"))).toBe(`╰─ Mode Ask ${"─".repeat(17)}╯`);
  });

  test("nothing reported: a plain line", () => {
    expect(text(bottomBorder(deriveSessionView(createSession()), 20, "muted"))).toBe(`╰${"─".repeat(18)}╯`);
  });

  test("tokens: the frame takes the given token, names muted, values in accent on surface.card, the gauge muted", () => {
    const row = bottomBorder(deriveSessionView(session), 63, "accent");
    expect(row[0]).toEqual({ text: "╰", token: "accent" });
    expect(row.find((s) => s.text === "Mode ")?.token).toBe("muted");
    for (const value of ["Auto", "Opus 5.5", "high"]) {
      const s = row.find((seg) => seg.text === value);
      expect(s?.token).toBe("accent");
      expect(s?.fill).toBe("surface.card");
    }
    expect(row.find((s) => s.text === "38k/200k")?.token).toBe("muted");
    expect(row.find((s) => s.text === " ─ ")?.token).toBe("accent");
  });

  test("a hostile option name is drawn sanitised: no escape sequence reaches the row", () => {
    const view = deriveSessionView({ ...session, configOptions: [option("effort", "Eff\u001b]8;;https://x\u0007ort", "thought_level", "high", "hi‮gh")] });
    const row = text(bottomBorder(view, 63, "muted"));
    expect(row).not.toContain("\u001b");
    expect(row).not.toContain("https://x");
  });

  test("the pill under a column, for a click", () => {
    const row = bottomBorder(deriveSessionView(session), 63, "muted");
    const line = text(row);
    expect(pillAt(row, line.indexOf("Mode"))).toBe("mode");
    expect(pillAt(row, line.indexOf("Auto") + 3)).toBe("mode");
    expect(pillAt(row, line.indexOf("Opus"))).toBe("model");
    expect(pillAt(row, line.indexOf("Effort"))).toBe("thought_level");
    expect(pillAt(row, line.indexOf("high"))).toBe("thought_level");
    expect(pillAt(row, line.indexOf(" ─ "))).toBeNull();
    expect(pillAt(row, line.indexOf("38k"))).toBeNull();
    expect(pillAt(row, 0)).toBeNull();
  });
});

describe("top border (mvp-chrome-and-keys tasks 4.3 and 4.4)", () => {
  test("plain, or with the newest notice in the middle; idle, the notice may use the track's columns", () => {
    expect(text(topBorder(null, 20, "muted"))).toBe(`╭${"─".repeat(18)}╮`);
    expect(text(topBorder({ text: "a turn is running", token: "warning" }, 63, "muted"))).toBe(
      `╭${"─".repeat(21)} a turn is running ${"─".repeat(21)}╮`,
    );
    // Busy: the notice is centred in what the corner, a stub and the track (here a quarter of the
    // border: 15 cells at 63 columns) leave.
    expect(text(topBorder({ text: "a turn is running", token: "warning" }, 63, "muted", 0, { frame: 0, waiting: false, percent: 25, style: "colour" }))).toBe(
      `╭─━━━${"─".repeat(12)}${"─".repeat(12)} a turn is running ${"─".repeat(14)}╮`,
    );
    const long = text(topBorder({ text: "x".repeat(80), token: "warning" }, 30, "muted"));
    expect(displayWidth(long)).toBe(30);
    expect(long).toContain("…");
    expect(long.startsWith("╭─ x")).toBe(true);
  });

  test("a notice too long for the border keeps its `more` whole at the end, after its short text cut with … (IDE check 12.5)", () => {
    const notice = {
      text: "configuration: config.jsonc:4:38: keys.global.ctrl+f PhpStorm keeps ctrl+f, so it may never reach acp-tui there",
      short: "config.jsonc:4:38: keys.global.ctrl+f PhpStorm keeps ctrl+f, so it may never reach acp-tui there",
      token: "warning" as const,
      more: "(see ? configuration)",
    };
    const row = text(topBorder(notice, 80, "muted"));
    expect(displayWidth(row)).toBe(80);
    expect(row).toMatch(/^╭─ config\.jsonc:4:38: keys\.global\.ctrl\+f .*… \(see \? configuration\) ─╮$/);
    expect(topBorder(notice, 80, "muted").find((s) => s.text === " (see ? configuration)")?.token).toBe("warning");
    // Without a short text, the text itself is cut.
    expect(text(topBorder({ ...notice, short: undefined }, 80, "muted"))).toMatch(/^╭─ configuration: config\.jsonc:4:38: .*… \(see \? configuration\) ─╮$/);
    // Whole when it fits: neither `short` nor `more`.
    expect(text(topBorder({ ...notice, text: "configuration: config.jsonc:1:1: x" }, 80, "muted"))).toMatch(/^╭─+ configuration: config\.jsonc:1:1: x ─+╮$/);
    // Too narrow to keep NOTICE_TEXT_MIN columns of the text beside it: the text alone, cut.
    const narrow = text(topBorder(notice, 30, "muted"));
    expect(narrow).not.toContain("see");
    expect(narrow).toMatch(/^╭─ configuration: .*… ─╮$/);
  });

  test("the ↓ N new indicator at the right end, with the notice kept in the middle", () => {
    expect(text(topBorder(null, 30, "muted", 4))).toBe(`╭${"─".repeat(18)} ↓ 4 new ─╮`);
    expect(topBorder(null, 30, "muted", 4).find((s) => s.text === "↓ 4 new")?.token).toBe("accent");
    expect(text(topBorder(null, 30, "muted", 0))).toBe(`╭${"─".repeat(28)}╮`);
    const both = text(topBorder({ text: "density: focus", token: "muted" }, 63, "muted", 12));
    expect(both).toBe(`╭${"─".repeat(17)} density: focus ${"─".repeat(17)} ↓ 12 new ─╮`);
    // A long notice is cut to leave the indicator whole.
    const long = text(topBorder({ text: "x".repeat(80), token: "warning" }, 30, "muted", 4));
    expect(displayWidth(long)).toBe(30);
    expect(long).toContain("↓ 4 new ─╮");
  });

  const cellsOf = (segments: readonly { text: string }[]) => segments.map((s) => s.text).join("");
  const colour = (frame: number, extra: Partial<BusyState> = {}): BusyState => ({ frame, waiting: false, style: "colour", ...extra });

  test("busy: a segment of a fifth of the track sweeps back and forth over it, in the busy token under style colour; idle the border is plain", () => {
    // 30 columns at 25 per cent: the track is the 10-cell minimum, the segment 3 cells, the span 7
    // cells or 14 half-cell steps, so frame 14 is the far end.
    expect(text(topBorder(null, 30, "muted", 0, colour(14, { percent: 25 })))).toBe(`╭─${"─".repeat(7)}━━━${"─".repeat(17)}╮`);
    const row = topBorder(null, 30, "muted", 0, colour(14, { percent: 25 }));
    expect(row.find((s) => s.text === "━━━")?.token).toBe("busy");
    // The track stays where it is with a notice and with the indicator.
    const busyRow = text(topBorder({ text: "hello", token: "muted" }, 63, "accent", 3, colour(24, { percent: 25 })));
    expect(busyRow.slice(0, 17)).toBe(`╭─${"─".repeat(12)}━━━`);
    expect(busyRow).toContain(" hello ");
    expect(busyRow.endsWith(" ↓ 3 new ─╮")).toBe(true);
    // Idle: no segment at all.
    expect(text(topBorder(null, 30, "accent"))).not.toContain("━");
  });

  test("Even steps: equal steps and intervals for spans 7, 9, 40 and 64, a pass of 1.5 s within one interval", () => {
    expect(busySteps(7, true)).toEqual({ steps: 14, perFrame: 1, interval: 1500 / 14 });
    expect(busySteps(9, true)).toEqual({ steps: 18, perFrame: 1, interval: 1500 / 18 });
    // Where one step a frame would need more than 25 frames a second, a frame moves several.
    expect(busySteps(40, true)).toEqual({ steps: 80, perFrame: 3, interval: 56.25 });
    expect(busySteps(64, true)).toEqual({ steps: 128, perFrame: 4, interval: 46.875 });
    for (const span of [7, 9, 12, 25, 40, 64]) {
      const pace = busySteps(span, true);
      expect(Math.abs((pace.steps / pace.perFrame) * pace.interval - BUSY_PASS_MS)).toBeLessThan(pace.interval);
      expect(pace.interval).toBeGreaterThanOrEqual(BUSY_INTERVAL_MIN_MS);
      expect(pace.interval).toBeLessThanOrEqual(BUSY_INTERVAL_MAX_MS);
      // Every frame of a pass moves the same distance.
      for (let frame = 0; frame < Math.floor(pace.steps / pace.perFrame); frame++) {
        expect(busyPosition(frame + 1, pace) - busyPosition(frame, pace)).toBe(pace.perFrame);
      }
    }
    // Whole cells: one step a cell, and never a longer interval than the indicator's floor allows.
    expect(busySteps(7, false)).toEqual({ steps: 7, perFrame: 1, interval: BUSY_INTERVAL_MAX_MS });
    expect(busySteps(40, false)).toEqual({ steps: 40, perFrame: 2, interval: 75 });
  });

  test("the position runs from one end to the other and back, a step at a time", () => {
    const pace = busySteps(7, true);
    expect([0, 1, 13, 14, 15, 27, 28, 29].map((frame) => busyPosition(frame, pace))).toEqual([0, 1, 13, 14, 13, 1, 0, 1]);
    const fast = busySteps(40, true);
    expect([0, 1, 2, 26, 27, 53, 54].map((frame) => busyPosition(frame, fast))).toEqual([0, 3, 6, 78, 79, 1, 2]);
  });

  test("Wide pane: at 200 columns the track is 80 cells (40 per cent by default, Marcus 15 October 2026), the segment 16, and a pass spans the 80 columns of the track", () => {
    expect(busyTrackWidth(200)).toBe(80);
    expect(busySegmentWidth(80)).toBe(16);
    const cells = (frame: number) => {
      const r = text(topBorder(null, 200, "accent", 0, colour(frame)));
      return { start: r.indexOf("━"), len: [...r].filter((c) => c === "━").length };
    };
    expect(cells(0)).toEqual({ start: 2, len: 16 });
    // 64 cells of travel are 128 half steps, 4 a frame: the far end is frame 32, 1.5 s on.
    expect(cells(32)).toEqual({ start: 2 + 64, len: 16 });
    expect(busyTiming(200).interval * 32).toBeCloseTo(BUSY_PASS_MS, 5);
  });

  test("the track is busy.track_percent of the border, at least 10 cells and never more than leaves 12 columns for a notice", () => {
    expect(busyTrackWidth(100, 40)).toBe(40);
    expect(busyTrackWidth(63)).toBe(25);
    expect(busyTrackWidth(63, 25)).toBe(15);
    expect(busyTrackWidth(30)).toBe(12);
    expect(busyTrackWidth(30, 25)).toBe(10);
    expect(busyTrackWidth(40, 50)).toBe(20);
    expect(busyTrackWidth(100, 50)).toBe(50);
    expect(busyTrackWidth(40, 50)).toBeLessThanOrEqual(40 - 16);
    expect(busySegmentWidth(10)).toBe(3);
    expect(busySegmentWidth(40)).toBe(8);
    // The setting reaches the drawn border.
    const row = text(topBorder(null, 100, "muted", 0, colour(0, { percent: 40 })));
    expect(row.slice(0, 2 + 8)).toBe(`╭─${"━".repeat(8)}`);
  });

  test("half cells: the segment's ends are ╼ and ╾, a gap's ╴ and ╶, in the style's token", () => {
    const at = (frame: number, style: BusyState["style"]) => busyTrack({ frame, waiting: false, style }, "muted", DEFAULT_CHROME_GLYPHS.busy, 10);
    expect(cellsOf(at(0, "colour"))).toBe("━━━───────");
    expect(cellsOf(at(1, "colour"))).toBe("╼━━╾──────");
    expect(cellsOf(at(2, "colour"))).toBe("─━━━──────");
    expect(cellsOf(at(3, "colour"))).toBe("─╼━━╾─────");
    expect(cellsOf(at(14, "colour"))).toBe("───────━━━");
    expect(cellsOf(at(13, "colour"))).toBe("──────╼━━╾");
    // Every position fills the track exactly.
    for (let frame = 0; frame < 28; frame++) expect(displayWidth(cellsOf(at(frame, "gap")))).toBe(10);
    expect(cellsOf(at(0, "gap"))).toBe("   ───────");
    expect(cellsOf(at(1, "gap"))).toBe("╴  ╶──────");
    expect(cellsOf(at(2, "gap"))).toBe("─   ──────");
    expect(cellsOf(at(3, "gap"))).toBe("─╴  ╶─────");
    // Colour: the busy token; border: the frame's; gap: the frame's, with blank cells.
    expect(at(1, "colour").find((s) => s.text === "╼━━╾")?.token).toBe("busy");
    expect(at(1, "border").every((s) => s.token === "muted")).toBe(true);
    expect(cellsOf(at(1, "border"))).toBe("╼━━╾──────");
    expect(at(1, "gap").every((s) => s.token === "muted")).toBe(true);
  });

  test("Whole cells in ASCII: = over - for the segment, a blank gap, one cell a step", () => {
    const ascii = (frame: number, style: BusyState["style"]) => cellsOf(busyTrack({ frame, waiting: false, style }, "muted", ASCII_CHROME_GLYPHS.busy, 10));
    expect(ascii(0, "colour")).toBe("===-------");
    expect(ascii(1, "colour")).toBe("-===------");
    expect(ascii(7, "colour")).toBe("-------===");
    expect(ascii(8, "colour")).toBe("------===-");
    expect(ascii(3, "gap")).toBe("---   ----");
    for (let frame = 0; frame < 14; frame++) expect(/^[-= ]{10}$/.test(ascii(frame, "colour"))).toBe(true);
    // Without half glyphs a pass is whole cells, so a ten-cell track is swept faster than 1.5 s.
    expect(busyTiming(30, 25, "colour", ASCII_CHROME_GLYPHS.busy)).toEqual({ steps: 7, perFrame: 1, interval: BUSY_INTERVAL_MAX_MS });
    // A half glyph set empty by an override: that style steps by whole cells.
    const noGapHalves = { ...DEFAULT_CHROME_GLYPHS.busy, gapLead: "" };
    expect(busyTiming(30, 25, "gap", noGapHalves).steps).toBe(7);
    expect(busyTiming(30, 25, "colour", noGapHalves).steps).toBe(14);
  });

  test("Gap by default: 16 blank cells move along 80 columns at 200 columns, every other cell of the track the border's line in the frame's colour", () => {
    const row = topBorder(null, 200, "accent", 0, { frame: 0, waiting: false });
    expect(text(row).slice(2, 82)).toBe(`${" ".repeat(16)}${"─".repeat(64)}`);
    expect(row.filter((s) => s.text.includes(" ")).map((s) => s.token)).toEqual(["accent"]);
    expect(text(topBorder(null, 200, "accent", 0, { frame: 32, waiting: false })).slice(2, 82)).toBe(`${"─".repeat(64)}${" ".repeat(16)}`);
  });

  test("Focused frame: the segment's token is not the frame's accent under colour, and is under border", () => {
    const row = topBorder(null, 63, "accent", 0, colour(5));
    const segment = row.find((s) => s.text.includes("━"))!;
    expect(segment.token).toBe("busy");
    expect(segment.token).not.toBe("accent");
    expect(topBorder(null, 63, "accent", 0, colour(5, { style: "border" })).find((s) => s.text.includes("━"))?.token).toBe("accent");
    expect(topBorder(null, 63, "muted", 0, colour(5, { style: "border" })).find((s) => s.text.includes("━"))?.token).toBe("muted");
  });

  test("waiting for the user: the segment stands where it was, as the heavy line in the warning colour, in every style", () => {
    for (const style of ["gap", "colour", "border"] as const) {
      const row = topBorder(null, 30, "muted", 0, { frame: 9, waiting: true, percent: 25, style });
      // Frame 9 is half step 9: the segment starts in the middle of cell 4.
      expect(text(row).slice(0, 12)).toBe(`╭─────╼━━╾──`);
      expect(row.find((s) => s.text === "╼━━╾")?.token).toBe("warning");
    }
    // A set with no half glyphs for the segment stands on a whole cell.
    const noHalves = { ...DEFAULT_CHROME_GLYPHS.busy, segmentLead: "", segmentTrail: "" };
    const row = busyTrack({ frame: 9, waiting: true, style: "gap" }, "muted", noHalves, 10);
    expect(cellsOf(row)).toBe("────━━━───");
    expect(row.find((s) => s.text === "━━━")?.token).toBe("warning");
  });

  test("the ascii glyphs: = over -", () => {
    expect(cellsOf(busyTrack({ frame: 0, waiting: false, style: "colour" }, "muted", ASCII_CHROME_GLYPHS.busy))).toBe("===-------");
    expect(cellsOf(busyTrack({ frame: 0, waiting: false, style: "colour" }, "muted", DEFAULT_CHROME_GLYPHS.busy))).toBe("━━━───────");
    expect(cellsOf(busyTrack({ frame: 0, waiting: false, style: "colour" }, "muted", DEFAULT_CHROME_GLYPHS.busy, 15))).toBe("━━━────────────");
  });

  test("the indicator's columns, for a click", () => {
    for (const [n, width] of [[4, 30], [12, 40], [250, 63]] as const) {
      const row = text(topBorder(null, width, "muted", n));
      const span = newBelowSpan(n, width);
      expect(row.slice(span.start, span.end)).toBe(` ↓ ${n} new `);
    }
  });
});
