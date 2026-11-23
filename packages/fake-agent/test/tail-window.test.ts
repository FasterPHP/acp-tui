// `tail-window`: a window whose first line moves and whose line count falls as well as rises.
import { describe, expect, test } from "bun:test";
import { tailWindow, TAIL_WINDOW_UPDATES } from "../src/scenarios/tail-window.ts";

describe("fake-agent tail-window scenario", () => {
  test("the window grows from its first line, then slides: its first line moves and its line count falls", () => {
    const counts = Array.from({ length: TAIL_WINDOW_UPDATES }, (_, i) => tailWindow(i + 1));
    expect(counts[0]!.first).toBe(1);
    expect(counts.at(-1)!.first).toBeGreaterThan(1);
    const sizes = counts.map((w) => w.lines.length);
    expect(sizes.some((n, i) => i > 0 && n < sizes[i - 1]!)).toBe(true);
    expect(sizes.some((n, i) => i > 0 && n > sizes[i - 1]!)).toBe(true);
    expect(counts.at(-1)!.lines.at(-1)).toMatch(new RegExp(`^out ${TAIL_WINDOW_UPDATES} `));
  });
});
