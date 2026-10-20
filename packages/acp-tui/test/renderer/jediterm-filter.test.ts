// Phase-1a task 8.7 (design D5): the JediTerm filter drops cursor-key
// sequences within 30 ms of a wheel report, and nothing else.
import { describe, expect, test } from "bun:test";
import { createJediTermFilter, isCursorKey, JEDITERM_WINDOW_MS } from "../../src/renderer/jediterm-filter.ts";

describe("JediTerm filter", () => {
  test("cursor keys in CSI and SS3 form; nothing else", () => {
    for (const key of ["\x1b[A", "\x1b[B", "\x1b[C", "\x1b[D", "\x1bOA", "\x1bOB"]) expect(isCursorKey(key)).toBe(true);
    for (const key of ["\x1b[5~", "\x1b[1;2A", "a", "\x1b", "\x1b[H", "\r"]) expect(isCursorKey(key)).toBe(false);
  });

  test("Home and End in every encoding are never cursor keys, even right after a wheel report (mvp-rendering task 14.3, review C20)", () => {
    const filter = createJediTermFilter(() => 1000);
    filter.noteWheel();
    for (const key of ["\x1b[H", "\x1b[F", "\x1b[1~", "\x1b[4~", "\x1bOH", "\x1bOF", "\x1b[7~", "\x1b[8~", "\x1b[1;5H", "\x1b[1;5F"]) {
      expect(isCursorKey(key)).toBe(false);
      expect(filter.handle(key)).toBe(false);
    }
  });

  test("drops cursor keys only within the window after a wheel report", () => {
    let clock = 1000;
    const filter = createJediTermFilter(() => clock);
    expect(filter.handle("\x1b[A")).toBe(false);
    filter.noteWheel();
    clock += 3;
    expect(filter.handle("\x1b[A")).toBe(true);
    expect(filter.handle("x")).toBe(false);
    clock = 1000 + JEDITERM_WINDOW_MS;
    expect(filter.handle("\x1b[B")).toBe(true);
    clock += 1;
    expect(filter.handle("\x1b[B")).toBe(false);
  });
});
