// The mixed colour of muted text (prompt-box-feedback task 8b; spec tui-theme "Dimmed default
// foreground drawn as a colour"): half and half of the reported foreground and background per sRGB
// channel, rounded, in place of SGR 2, with the fallbacks the spec names.
import { describe, expect, test } from "bun:test";
import { TextAttributes } from "@opentui/core";
import { toHex } from "../../src/theme/derive.ts";
import { DEFAULT_THEME } from "../../src/theme/default-theme.ts";
import { drawnColour } from "../../src/theme/legibility.ts";
import { ISLANDS_DARK, RECORDED_PALETTES } from "../../src/theme/palettes.fixture.ts";
import { mixedDim, resolveTheme, withTokens } from "../../src/theme/resolve.ts";
import { isLightBackground } from "../../src/theme/style.ts";

const FOOT_LIGHT = { foreground: "#212121", background: "#fafafa" };
const NIGHT = { foreground: "#c0caf5", background: "#1a1b26" };
const hex = (t: ReturnType<typeof resolveTheme>, name: Parameters<ReturnType<typeof resolveTheme>["color"]>[0]) => toHex(t.color(name).toInts().slice(0, 3) as [number, number, number]);

describe("The mix", () => {
  test("foot's light theme gives #8e8e8e (141.5 rounds up), a dark theme the mean of its own pair", () => {
    expect(mixedDim(FOOT_LIGHT)).toBe("#8e8e8e");
    expect(mixedDim(NIGHT)).toBe("#6d738e");
    expect(mixedDim({ foreground: "#000000", background: "#ffffff" })).toBe("#808080");
  });

  test("light palettes: muted, hint, thought and the index are the mix, with no dim; bold and italic are kept", () => {
    const t = resolveTheme(DEFAULT_THEME, { terminal: FOOT_LIGHT });
    for (const name of ["muted", "hint", "thought", "tool.index", "markdown.heading.5", "code.comment"] as const) {
      expect(hex(t, name)).toBe("#8e8e8e");
      expect(t.text(name).attributes & TextAttributes.DIM).toBe(0);
      expect(t.color(name).intent).toBe("rgb");
    }
    expect(t.text("thought").attributes & TextAttributes.ITALIC).toBe(TextAttributes.ITALIC);
    expect(t.text("markdown.heading.5").attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD);
    // Normal text is untouched.
    expect(t.color("text").intent).toBe("default");
  });

  test("dark palettes keep bright black (an indexed colour), nothing is mixed", () => {
    const t = resolveTheme(DEFAULT_THEME, { terminal: NIGHT });
    expect(t.color("muted").intent).toBe("indexed");
    expect(t.text("muted").attributes & TextAttributes.DIM).toBe(0);
  });

  test("a flat light theme (forced) still mixes: the replies are known", () => {
    const t = resolveTheme(DEFAULT_THEME, { terminal: FOOT_LIGHT, forceFlat: true });
    expect(hex(t, "muted")).toBe("#8e8e8e");
  });
});

describe("Colours not reported, or not drawable", () => {
  test("no replies: no mix and no dim (the theme is the dark one)", () => {
    const t = resolveTheme(DEFAULT_THEME);
    expect(t.color("muted").intent).toBe("indexed");
    expect(t.text("muted").attributes & TextAttributes.DIM).toBe(0);
  });

  test("a light terminal that cannot draw 24-bit colour: the default foreground with SGR 2, as before", () => {
    const t = resolveTheme(DEFAULT_THEME, { terminal: FOOT_LIGHT, truecolour: false });
    expect(t.color("muted").intent).toBe("default");
    expect(t.text("muted").attributes & TextAttributes.DIM).toBe(TextAttributes.DIM);
  });
});

describe("A theme's own colour is drawn as set", () => {
  test("an index, a hex value, and a dimmed index, on a light background", () => {
    const t = resolveTheme(withTokens(DEFAULT_THEME, { muted: { color: 8 }, hint: "#123456", thought: { color: 8, dim: true } }), { terminal: FOOT_LIGHT });
    expect(t.color("muted").intent).toBe("indexed");
    expect(t.text("muted").attributes & TextAttributes.DIM).toBe(0);
    expect(hex(t, "hint")).toBe("#123456");
    // Dim kept: a theme that asks for SGR 2 on its own colour gets it.
    expect(t.text("thought").attributes & TextAttributes.DIM).toBe(TextAttributes.DIM);
    expect(t.color("thought").intent).toBe("indexed");
  });

  test("a theme that dims the default foreground itself gets the mix", () => {
    const t = resolveTheme(withTokens(DEFAULT_THEME, { muted: { color: "default", dim: true } }), { terminal: NIGHT });
    expect(hex(t, "muted")).toBe("#6d738e");
  });
});

describe("Legibility measures the mix", () => {
  test("drawnColour of a muted token on each light recorded palette is that palette's mix", () => {
    for (const palette of RECORDED_PALETTES.filter((p) => isLightBackground(p))) {
      expect(drawnColour(DEFAULT_THEME, "muted", palette)).toBe(mixedDim(palette));
    }
    expect(drawnColour(DEFAULT_THEME, "muted", ISLANDS_DARK)).toBe(ISLANDS_DARK.ansi[8]!);
  });
});
