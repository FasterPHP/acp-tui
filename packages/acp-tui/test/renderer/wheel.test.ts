// Phase-1a task 8.6 (design D4; spec tui-screen "Wheel step per terminal"):
// the per-terminal wheel table, detection from the environment, the
// `--wheel-lines` override and fractional accumulation.
import { describe, expect, test } from "bun:test";
import { detectWheelTerminal, WHEEL_TABLE, WheelAccumulator, wheelStep } from "../../src/renderer/wheel.ts";

describe("detection", () => {
  test("both PhpStorm terminals by TERMINAL_EMULATOR, Zed by TERM_PROGRAM, anything else the default", () => {
    expect(detectWheelTerminal({ TERMINAL_EMULATOR: "JetBrains-JediTerm" })).toBe("jetbrains");
    expect(detectWheelTerminal({ TERM_PROGRAM: "zed" })).toBe("zed");
    expect(detectWheelTerminal({ TERM_PROGRAM: "vscode" })).toBe("default");
    expect(detectWheelTerminal({})).toBe("default");
    // JediTerm wins if both are set (a Zed shell started from PhpStorm's terminal keeps TERM_PROGRAM).
    expect(detectWheelTerminal({ TERMINAL_EMULATOR: "JetBrains-JediTerm", TERM_PROGRAM: "zed" })).toBe("jetbrains");
  });

  test("the table gives about 3 rows per notch in the measured IDEs (task 10.4)", () => {
    // PhpStorm reworked: 1 report per notch; Zed 1.18.1: 3 reports per notch (2 at times).
    expect(WHEEL_TABLE).toEqual({ jetbrains: 3, zed: 1, ghostty: 3, kitty: 3, wezterm: 3, iterm2: 3, "windows-terminal": 3, default: 3 });
    expect(WHEEL_TABLE.jetbrains * 1).toBe(3);
    expect(WHEEL_TABLE.zed * 3).toBe(3);
  });

  test("the step comes from the table, the terminal's `terminals` entry, or `wheel_lines` (or --wheel-lines) for every terminal", () => {
    expect(wheelStep(null, { TERMINAL_EMULATOR: "JetBrains-JediTerm" })).toEqual({ rows: 3, terminal: "jetbrains", source: "table" });
    expect(wheelStep(null, { TERM_PROGRAM: "zed" })).toEqual({ rows: 1, terminal: "zed", source: "table" });
    expect(wheelStep(null, {})).toEqual({ rows: 3, terminal: "default", source: "table" });
    expect(wheelStep(2, { TERM_PROGRAM: "zed" })).toEqual({ rows: 2, terminal: "zed", source: "option" });
    expect(wheelStep(null, { TERM_PROGRAM: "zed" }, { zed: { wheel_lines: 0.5 } })).toEqual({ rows: 0.5, terminal: "zed", source: "terminals" });
    // Wheel table entry (spec tui-config "Per-terminal table"): jetbrains at 5, Zed keeps its step.
    expect(wheelStep(null, { TERMINAL_EMULATOR: "JetBrains-JediTerm" }, { jetbrains: { wheel_lines: 5 } }).rows).toBe(5);
    expect(wheelStep(null, { TERM_PROGRAM: "zed" }, { jetbrains: { wheel_lines: 5 } }).rows).toBe(1);
    // One step everywhere: `wheel_lines` wins over the terminals entry.
    expect(wheelStep(2, { TERMINAL_EMULATOR: "JetBrains-JediTerm" }, { jetbrains: { wheel_lines: 5 } })).toEqual({ rows: 2, terminal: "jetbrains", source: "option" });
  });
});

describe("accumulation", () => {
  const run = (rows: number, events: (-1 | 1)[]) => {
    const wheel = new WheelAccumulator(rows);
    return events.map((d) => wheel.add(d));
  };

  test("whole steps scroll at once", () => {
    expect(run(3, [1, 1, -1])).toEqual([3, 3, -3]);
    expect(run(1, [-1, -1])).toEqual([-1, -1]);
  });

  test("0.5 rows per event scrolls one row every second event", () => {
    expect(run(0.5, [1, 1, 1, 1, 1])).toEqual([0, 1, 0, 1, 0]);
    expect(run(0.5, [-1, -1])).toEqual([0, -1]);
  });

  test("fractions carry: 1.5 rows per event gives 1, 2, 1, 2", () => {
    expect(run(1.5, [1, 1, 1, 1])).toEqual([1, 2, 1, 2]);
  });

  test("thirds add up without floating-point loss", () => {
    const rows = run(1 / 3, Array(9).fill(1));
    expect(rows.reduce((a, b) => a + b, 0)).toBe(3);
    expect(rows).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  });

  test("a change of direction drops the carried fraction", () => {
    expect(run(0.5, [1, -1, -1])).toEqual([0, 0, -1]);
  });
});
