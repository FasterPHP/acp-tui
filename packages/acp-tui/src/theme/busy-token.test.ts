// day-one-feedback task 8.1 (spec tui-theme "Busy and result label tokens"): the `busy` token, which
// the busy indicator's segment is drawn in, apart from the focused prompt frame's `accent`.
import { describe, expect, test } from "bun:test";
import { DEFAULT_THEME, effectiveStyle, tokenStyle } from "./index.ts";

describe("the busy token", () => {
  test("bright blue (ANSI 12) and bold on a dark background, which differs from accent", () => {
    const busy = effectiveStyle(tokenStyle(DEFAULT_THEME, "busy"), false);
    const accent = effectiveStyle(tokenStyle(DEFAULT_THEME, "accent"), false);
    expect(busy.color).toBe(12);
    expect(busy.bold).toBe(true);
    expect(busy.color).not.toBe(accent.color);
  });

  test("on a light background it is bold magenta, legible where bright blue is a pale grey-blue", () => {
    const busy = effectiveStyle(tokenStyle(DEFAULT_THEME, "busy"), true);
    expect(busy).toMatchObject({ color: 5, bold: true });
  });
});
