// Unit tests for spec tui-theme "Surfaces derived from the terminal's colours" (task 5.1) and the
// colour reply parser and tracker (task 5.2). The PTY counterparts are in test/pty/surfaces.test.ts.
import { describe, expect, test } from "bun:test";
import { TextAttributes } from "@opentui/core";
import {
  bindTerminalColours,
  contrastBudgetL,
  contrastRatio,
  BLACK_LIFT,
  createColourTracker,
  createLiveTheme,
  createThemeRefresh,
  DEFAULT_THEME,
  deriveSurfaces,
  lightness,
  luminance,
  MAX_STEP_SHARE,
  mix,
  parseColourReply,
  parseHex,
  resolveTheme,
  spanStyle,
  stepLightness,
  SURFACE_NAMES,
  SURFACE_STEP_L,
  toHex,
  withTokens,
  type SurfaceName,
  type TerminalColours,
} from "./index.ts";
import { deltaE2000 } from "./colour-difference.ts";
import { ISLANDS_DARK, RECORDED_PALETTES } from "./palettes.fixture.ts";
import { PERMISSION_SELECTED_MIN_STEP_L } from "./derive.ts";
import { cardSpanStyle } from "../app/permission.ts";

// PhpStorm's dark terminal: OSC 11 rgb:1919/1a1a/1c1c, OSC 10 rgb:bcbc/bebe/c4c4.
const PHPSTORM_DARK: TerminalColours = { background: "#191a1c", foreground: "#bcbec4" };
const LIGHT: TerminalColours = { background: "#ffffff", foreground: "#1f2328" };
const BLACK: TerminalColours = { background: "#000000", foreground: "#ffffff" };
// The JetBrains Darcula-derived dark theme's real terminal colours, and Zed's One Light style.
const PHPSTORM_DARK_2026: TerminalColours = { background: "#1e1f22", foreground: "#bcbec4" };
const ZED_LIGHT: TerminalColours = { background: "#fafafa", foreground: "#242529" };
// Zed's One Light as Zed answered OSC 10 and 11 in S2 (IDE session B2): rgb:2a2a/2c2c/3333, rgb:fafa/fafa/fafa.
const ZED_ONE_LIGHT: TerminalColours = { background: "#fafafa", foreground: "#2a2c33" };
// One Dark: a dark theme with less contrast between text and background than PhpStorm's.
const ONE_DARK: TerminalColours = { background: "#282c34", foreground: "#abb2bf" };

const TEXT_SURFACES: SurfaceName[] = [
  "surface.user",
  "surface.card",
  "surface.cursor",
  "surface.permission",
  "surface.permission.selected",
  "status.bg",
];

const lum = (hex: string) => luminance(parseHex(hex));

describe("Surfaces derived from the terminal's colours", () => {
  test("PhpStorm dark background: user, card and permission are lighter than the background, darker than the foreground", () => {
    const surfaces = deriveSurfaces(PHPSTORM_DARK);
    for (const name of ["surface.user", "surface.card", "surface.permission"] as const) {
      const value = surfaces[name];
      expect(value).not.toBe(PHPSTORM_DARK.background);
      expect(lum(value)).toBeGreaterThan(lum(PHPSTORM_DARK.background));
      expect(lum(value)).toBeLessThan(lum(PHPSTORM_DARK.foreground));
    }
  });

  test("the permission surface leans warm: more red than blue relative to its plain grey step", () => {
    const s = deriveSurfaces(PHPSTORM_DARK);
    const [r, , b] = parseHex(s["surface.permission"]);
    const plain = parseHex(toHex(stepLightness(parseHex(PHPSTORM_DARK.background), parseHex(PHPSTORM_DARK.foreground), SURFACE_STEP_L["surface.permission"])));
    expect(r).toBeGreaterThan(plain[0]);
    expect(b).toBeLessThanOrEqual(plain[2]);
  });

  test("diff backgrounds are the background mixed 15 per cent with the added and removed hues", () => {
    const s = deriveSurfaces(PHPSTORM_DARK, { added: "#00ff00", removed: "#ff0000" });
    expect(parseHex(s["diff.added.bg"])).toEqual([Math.round(0x19 * 0.85), Math.round(0x1a * 0.85 + 255 * 0.15), Math.round(0x1c * 0.85)]);
    expect(parseHex(s["diff.removed.bg"])).toEqual([Math.round(0x19 * 0.85 + 255 * 0.15), Math.round(0x1a * 0.85), Math.round(0x1c * 0.85)]);
  });

  test("pure black background is lifted to at least #101010 so every surface differs from it", () => {
    const s = deriveSurfaces(BLACK);
    for (const name of SURFACE_NAMES) {
      expect(s[name]).not.toBe("#000000");
      for (const channel of parseHex(s[name])) expect(channel).toBeGreaterThanOrEqual(BLACK_LIFT);
    }
    // Stepped from the lifted base, so still ordered.
    expect(lum(s["status.bg"])).toBeLessThan(lum(s["surface.cursor"]));
  });

  test("a near-black but not pure black background is not lifted", () => {
    const s = deriveSurfaces({ background: "#050505", foreground: "#ffffff" });
    expect(s["status.bg"]).not.toBe(deriveSurfaces(BLACK)["status.bg"]);
    expect(lightness(parseHex(s["status.bg"])) - lightness(parseHex("#050505"))).toBeCloseTo(SURFACE_STEP_L["status.bg"], 0);
  });

  test("light background: surfaces are darker than the background and lighter than the foreground", () => {
    const s = deriveSurfaces(LIGHT);
    for (const name of TEXT_SURFACES) {
      expect(s[name]).not.toBe(LIGHT.background);
      expect(lum(s[name])).toBeLessThan(lum(LIGHT.background));
      expect(lum(s[name])).toBeGreaterThan(lum(LIGHT.foreground));
    }
  });

  test("derivation depends on the two colours only", () => {
    expect(deriveSurfaces(PHPSTORM_DARK)).toEqual(deriveSurfaces({ ...PHPSTORM_DARK }));
  });
});

// Task 11.5 (S2): each surface is a fixed CIE L* step from the terminal background, towards the
// foreground, so dark and light themes get the same separation. Under the old sRGB fractions the
// status row was 3.5 L* from the pane on PhpStorm dark, 2.8 on Zed's One Light and 2.4 on One Dark.
describe("Surface steps in CIE L* (task 11.5)", () => {
  const L = (hex: string) => lightness(parseHex(hex));
  const themes: [string, TerminalColours][] = [
    ["PhpStorm dark #191a1c/#bcbec4", PHPSTORM_DARK],
    ["Zed One Light #fafafa/#2a2c33", ZED_ONE_LIGHT],
    ["pure black #000000/#ffffff", BLACK],
    ["One Dark #282c34/#abb2bf", ONE_DARK],
    ["white #ffffff/#1f2328", LIGHT],
  ];
  const STEPPED = ["status.bg", "surface.card", "surface.code", "surface.user"] as const;

  for (const [name, colours] of themes) {
    // Pure black is lifted first, and the steps are taken from the lifted base.
    const base = colours.background === "#000000" ? toHex([BLACK_LIFT, BLACK_LIFT, BLACK_LIFT]) : colours.background;
    const sign = L(colours.background) < L(colours.foreground) ? 1 : -1;

    test(`${name}: status, card, code and user are ${STEPPED.map((n) => SURFACE_STEP_L[n]).join(", ")} L* from the background, towards the foreground`, () => {
      const s = deriveSurfaces(colours);
      for (const surface of STEPPED) {
        // Rounding to 8 bits per channel moves L* by at most about 0.4.
        expect(Math.abs(sign * (L(s[surface]) - L(base)) - SURFACE_STEP_L[surface])).toBeLessThan(0.5);
      }
    });

    test(`${name}: ordered by prominence, and the warm permission card further out than the user card`, () => {
      const s = deriveSurfaces(colours);
      const out = (hex: string) => sign * (L(hex) - L(base));
      expect(out(s["status.bg"])).toBeLessThan(out(s["surface.card"]));
      expect(out(s["surface.card"])).toBeLessThan(out(s["surface.code"]));
      expect(out(s["surface.code"])).toBeLessThan(out(s["surface.user"]));
      expect(out(s["surface.user"])).toBeLessThan(out(s["surface.permission"]));
      expect(out(s["surface.user"])).toBeLessThan(out(s["surface.cursor"]));
    });
  }

  test("the values the IDE checks will sample (PhpStorm Islands Dark and Zed One Light)", () => {
    // Islands Dark has room for three highlight levels at 4.5:1, so find.other shares the cursor's
    // lightness (amber against grey); One Light has room for four (mvp-rendering task 3.2).
    expect(deriveSurfaces(PHPSTORM_DARK)).toMatchObject({
      "status.bg": "#222325",
      "surface.card": "#242527",
      "surface.overlay": "#242527",
      "surface.code": "#26272a",
      "surface.user": "#292a2d",
      "surface.cursor": "#343638",
      "surface.selection": "#4c4d50",
      "surface.permission": "#39352e",
      "surface.permission.selected": "#504d49",
      "diff.added.bg": "#1f3224",
      "diff.removed.bg": "#3a2223",
      "find.other": "#3f3420",
      "find.current": "#4f3f21",
    });
    expect(deriveSurfaces(ZED_ONE_LIGHT)).toMatchObject({
      "status.bg": "#ededee",
      "surface.card": "#eaeaeb",
      "surface.overlay": "#eaeaeb",
      "surface.code": "#e7e7e8",
      "surface.user": "#e3e3e4",
      "surface.cursor": "#d4d4d6",
      "surface.selection": "#a9a9ac",
      "surface.permission": "#e1dcd4",
      "surface.permission.selected": "#bebab5",
      "diff.added.bg": "#def0e1",
      "diff.removed.bg": "#fae1df",
      "find.other": "#e9c078",
      "find.current": "#e4af52",
    });
  });

  test("the same steps on dark and light: the old fractions gave PhpStorm dark, One Light and One Dark different ones", () => {
    const steps = (colours: TerminalColours) => {
      const s = deriveSurfaces(colours);
      return STEPPED.map((n) => Math.abs(L(s[n]) - L(colours.background)));
    };
    const dark = steps(PHPSTORM_DARK);
    for (const other of [ZED_ONE_LIGHT, ONE_DARK, LIGHT]) {
      steps(other).forEach((step, i) => expect(Math.abs(step - dark[i]!)).toBeLessThan(0.6));
    }
    // The old user card: a 9 % mix was 7.2 L* on PhpStorm dark and 5.5 on One Dark.
    const oldUser = (c: TerminalColours) => lightness(mix(parseHex(c.background), parseHex(c.foreground), 0.09)) - lightness(parseHex(c.background));
    expect(oldUser(PHPSTORM_DARK) - oldUser(ONE_DARK)).toBeGreaterThan(1.5);
  });

  test(`a low-contrast theme: no step goes further than ${MAX_STEP_SHARE * 100} per cent of the way to the foreground in L*`, () => {
    const dim: TerminalColours = { background: "#303030", foreground: "#606060" };
    const span = L(dim.foreground) - L(dim.background);
    const s = deriveSurfaces(dim);
    for (const surface of STEPPED) {
      expect(L(s[surface]) - L(dim.background)).toBeLessThanOrEqual(MAX_STEP_SHARE * span + 0.5);
      expect(s[surface]).not.toBe(dim.foreground);
    }
  });
});

// S1 re-check, bug 3 (follow-up): on PhpStorm dark the selected permission option (48,49,52) was
// slightly darker than the card (56,52,45) and differed mainly in hue. The derived selection must be
// clearly lighter (dark themes) or darker (light themes) than the surface it sits on. The measure is
// the CIE L* difference (perceptual lightness, 0 to 100), at least MIN_SELECTION_DELTA_L.
const MIN_SELECTION_DELTA_L = 5;

describe("Selection contrast against the surface underneath", () => {
  const themes: [string, TerminalColours][] = [
    ["PhpStorm dark #191a1c/#bcbec4 (as reported by the IDE)", PHPSTORM_DARK],
    ["PhpStorm dark #1e1f22/#bcbec4", PHPSTORM_DARK_2026],
    ["Zed light #fafafa/#242529", ZED_LIGHT],
    ["Zed One Light #fafafa/#2a2c33 (as reported by the IDE)", ZED_ONE_LIGHT],
    ["white #ffffff/#1f2328", LIGHT],
    ["One Dark #282c34/#abb2bf", ONE_DARK],
    ["pure black #000000/#ffffff", BLACK],
  ];
  const L = (hex: string) => lightness(parseHex(hex));
  /** Signed L* step of `selection` from `under`: positive on a dark theme means lighter. */
  const delta = (selection: string, under: string) => L(selection) - L(under);

  for (const [name, colours] of themes) {
    const dark = lightness(parseHex(colours.background)) < lightness(parseHex(colours.foreground));
    const sign = dark ? 1 : -1;

    test(`${name}: the selected permission option differs from the card fill by at least ${MIN_SELECTION_DELTA_L} L*, lighter on dark and darker on light`, () => {
      const s = deriveSurfaces(colours);
      expect(sign * delta(s["surface.permission.selected"], s["surface.permission"])).toBeGreaterThanOrEqual(MIN_SELECTION_DELTA_L);
    });

    test(`${name}: the conversation selection differs from the terminal background, the user card and the expanded card by at least ${MIN_SELECTION_DELTA_L} L*`, () => {
      const s = deriveSurfaces(colours);
      for (const under of [colours.background, s["surface.user"], s["surface.card"]]) {
        expect(sign * delta(s["surface.cursor"], under)).toBeGreaterThanOrEqual(MIN_SELECTION_DELTA_L);
      }
    });

    test(`${name}: the text selection is at least ${MIN_SELECTION_DELTA_L} L* beyond the cursor's fill, so it shows inside the cursor's item`, () => {
      const s = deriveSurfaces(colours);
      expect(sign * delta(s["surface.selection"], s["surface.cursor"])).toBeGreaterThanOrEqual(MIN_SELECTION_DELTA_L);
    });

    // One Dark's blue-grey foreground leaves its card barely warm under the old fractions and the
    // L* steps alike (red minus blue 3 and 2), so there is no warmth to keep (task 11.5, for 11.6).
    test.skipIf(colours === ONE_DARK)(`${name}: the selection on the card keeps the card's warm hue`, () => {
      const s = deriveSurfaces(colours);
      const [r, , b] = parseHex(s["surface.permission.selected"]);
      const [cr, , cb] = parseHex(s["surface.permission"]);
      // Red minus blue (warmth) does not fall to neutral: at least 60 % of the card's own.
      expect(r - b).toBeGreaterThanOrEqual(0.6 * (cr - cb));
      expect(r).toBeGreaterThan(b);
    });
  }

  test("the old behaviour would have failed: a plain background step is under 2 L* from the warm card on PhpStorm dark", () => {
    // The card as it was then (56,52,45; S1 re-check), before the L* steps of task 11.5.
    const s = { "surface.permission": "#38342d" };
    const fromBackground = toHex([0x19 + 0.14 * (0xbc - 0x19), 0x1a + 0.14 * (0xbe - 0x1a), 0x1c + 0.14 * (0xc4 - 0x1c)]);
    expect(fromBackground).toBe("#303134");
    expect(Math.abs(delta(fromBackground, s["surface.permission"]))).toBeLessThan(2);
  });
});

// mvp-rendering task 3.2, spec tui-theme "Separate highlight surfaces" and "Code block surface".
describe("Separate highlight surfaces", () => {
  const L = (hex: string) => lightness(parseHex(hex));
  const HIGHLIGHTS = ["surface.cursor", "surface.selection", "find.current", "find.other"] as const;
  const UNDER = ["surface.card", "surface.user", "surface.code"] as const;
  const themes: [string, TerminalColours][] = [
    ["PhpStorm Islands Dark #191a1c/#bcbec4", ISLANDS_DARK],
    ["Zed One Light #fafafa/#2a2c33", ZED_ONE_LIGHT],
    ["Zed One Dark #282c34/#abb2bf", ONE_DARK],
    ["white #ffffff/#1f2328", LIGHT],
    ["pure black #000000/#ffffff", BLACK],
  ];
  /**
   * Decided by Marcus on 8 October 2026 (option A, reported with task 3.2): on Islands Dark the four highlights cannot
   * be 5 L* apart with the default foreground at 4.5:1 on each (only about 23.8 L* of room beyond the
   * background, and the cursor must start 5 beyond the user card at 8), so `find.other` takes the
   * cursor's lightness, in amber against grey. They are never on screen together: the cursor is drawn
   * only while the conversation has focus (WindowedConversation's `focused()`), the find hits only
   * while the bar is open, and the bar closes whenever focus leaves it (src/find/Find.tsx). One Dark
   * has less room still and gets the same exception. This is the only pair excused, and only there.
   */
  const EXCUSED: Record<string, readonly (readonly [string, string])[]> = {
    [ISLANDS_DARK.background]: [["surface.cursor", "find.other"]],
    [ONE_DARK.background]: [["surface.cursor", "find.other"]],
  };
  const excused = (colours: TerminalColours, a: string, b: string) =>
    (EXCUSED[colours.background] ?? []).some(([x, y]) => (x === a && y === b) || (x === b && y === a));

  for (const [name, colours] of themes) {
    test(`${name}: each highlight is at least ${MIN_SELECTION_DELTA_L} L* from the others and from the card, user and code fills`, () => {
      const s = deriveSurfaces(colours);
      for (const [i, h] of HIGHLIGHTS.entries()) {
        for (const other of [...HIGHLIGHTS.slice(i + 1), ...UNDER]) {
          const d = Math.abs(L(s[h]) - L(s[other]));
          if (excused(colours, h, other)) {
            // The exception, asserted as such: the same lightness, a different hue.
            expect(d, `${h} / ${other}`).toBeLessThan(MIN_SELECTION_DELTA_L);
            expect(s[h]).not.toBe(s[other]);
          } else {
            expect(d, `${h} / ${other}`).toBeGreaterThanOrEqual(MIN_SELECTION_DELTA_L);
          }
        }
      }
    });

    // One Dark's own text is only 6.3:1 on its background, and the cursor must start 13 L* out, so
    // 4.5:1 cannot hold there on any highlight (the find tests below keep it at 3:1 for the hits).
    const minContrast = colours === ONE_DARK ? 2.8 : 4.5;
    test(`${name}: the default foreground is at least ${minContrast}:1 on every highlight`, () => {
      const s = deriveSurfaces(colours);
      for (const h of HIGHLIGHTS) {
        expect(contrastRatio(parseHex(colours.foreground), parseHex(s[h])), h).toBeGreaterThanOrEqual(minContrast);
      }
    });
  }

  test("PhpStorm Islands Dark: three highlight levels (find.other shares the cursor's), One Light and white four", () => {
    const levels = (c: TerminalColours) => new Set(HIGHLIGHTS.map((h) => Math.round(L(deriveSurfaces(c)[h])))).size;
    expect(levels(ISLANDS_DARK)).toBe(3);
    expect(levels(ZED_ONE_LIGHT)).toBe(4);
    expect(levels(LIGHT)).toBe(4);
    expect(levels(BLACK)).toBe(4);
  });

  test("Cursor inside a selection (Islands Dark): the selection differs by at least 5 L* from the cursor's bar colour and from its faint fill", () => {
    const s = deriveSurfaces(ISLANDS_DARK);
    expect(Math.abs(L(s["surface.selection"]) - L(s["surface.cursor"]))).toBeGreaterThanOrEqual(MIN_SELECTION_DELTA_L);
    expect(Math.abs(L(s["surface.selection"]) - L(s["surface.cursor.faint"]))).toBeGreaterThanOrEqual(MIN_SELECTION_DELTA_L);
    for (const h of ["find.current", "find.other"] as const) {
      expect(Math.abs(L(s[h]) - L(s["surface.cursor.faint"])), h).toBeGreaterThanOrEqual(MIN_SELECTION_DELTA_L);
    }
  });

  // Review C5 (Marcus, 9 October 2026): the cursor is a `▎` bar in surface.cursor's colour over a
  // faint fill, so a long message under it keeps its contrast. The faint fill is exempt from the
  // 5 L* rule above (it is meant to be quiet); the default foreground keeps 4.5:1 on it wherever
  // the theme's own text has it on the background with room to spare. Solarized Light's body text
  // is 4.1:1 on its own background, so no fill can reach 4.5:1 there; it keeps at least 85 per
  // cent of the text's own contrast instead, as every palette does.
  describe("the cursor's faint fill (surface.cursor.faint)", () => {
    const faintThemes: [string, TerminalColours][] = [...RECORDED_PALETTES.map((p) => [p.name, p] as [string, TerminalColours]), ["white", LIGHT], ["pure black", BLACK]];
    for (const [name, colours] of faintThemes) {
      const base = colours.background === "#000000" ? toHex([BLACK_LIFT, BLACK_LIFT, BLACK_LIFT]) : colours.background;
      const own = contrastRatio(parseHex(colours.foreground), parseHex(base));
      test(`${name}: a neutral step of about ${SURFACE_STEP_L["surface.cursor.faint"]} L* from the background, quieter than the status row and every card, the text legible on it`, () => {
        const s = deriveSurfaces(colours);
        const sign = L(base) < L(colours.foreground) ? 1 : -1;
        const out = (hex: string) => sign * (L(hex) - L(base));
        expect(Math.abs(out(s["surface.cursor.faint"]) - SURFACE_STEP_L["surface.cursor.faint"])).toBeLessThan(0.5);
        expect(out(s["surface.cursor.faint"])).toBeLessThan(out(s["status.bg"]));
        for (const fill of ["surface.card", "surface.user", "surface.code", "surface.cursor"] as const) expect(out(s["surface.cursor.faint"])).toBeLessThan(out(s[fill]));
        // Neutral: the plain step towards the foreground, nothing added.
        const plain = parseHex(toHex(stepLightness(parseHex(base), parseHex(colours.foreground), SURFACE_STEP_L["surface.cursor.faint"])));
        expect(parseHex(s["surface.cursor.faint"]).every((c, i) => Math.abs(c - plain[i]!) <= 1)).toBe(true);
        const ratio = contrastRatio(parseHex(colours.foreground), parseHex(s["surface.cursor.faint"]));
        if (own >= 5) expect(ratio).toBeGreaterThanOrEqual(4.5);
        expect(ratio).toBeGreaterThanOrEqual(0.85 * own);
      });
    }

    test("the values the IDE checks will sample: Islands Dark, One Light, Ayu Light", () => {
      expect(deriveSurfaces(ISLANDS_DARK)["surface.cursor.faint"]).toBe("#202123");
      expect(deriveSurfaces(ZED_ONE_LIGHT)["surface.cursor.faint"]).toBe("#f0f0f0");
      expect(deriveSurfaces({ background: "#fcfcfc", foreground: "#5c6166" })["surface.cursor.faint"]).toBe("#f2f2f2");
    });
  });

  const recorded: [string, TerminalColours][] = [...RECORDED_PALETTES.map((p) => [p.name, p] as [string, TerminalColours]), ["white", LIGHT], ["pure black", BLACK]];
  for (const [name, colours] of recorded) {
    test(`${name}: surface.code is a neutral step (no warm hue of its own) at least 3 L* from the permission card`, () => {
      const s = deriveSurfaces(colours);
      const base = colours.background === "#000000" ? toHex([BLACK_LIFT, BLACK_LIFT, BLACK_LIFT]) : colours.background;
      // The plain step from the background towards the foreground: whatever hue the theme's own
      // colours give it, and nothing added.
      const plain = parseHex(toHex(stepLightness(parseHex(base), parseHex(colours.foreground), SURFACE_STEP_L["surface.code"])));
      const [r, g, b] = parseHex(s["surface.code"]);
      expect([r, g, b].map((c, i) => Math.abs(c - plain[i]!)).every((d) => d <= 1)).toBe(true);
      const warmth = (hex: string) => {
        const [cr, , cb] = parseHex(hex);
        return cr - cb;
      };
      expect(warmth(s["surface.code"])).toBeLessThan(warmth(s["surface.permission"]));
      expect(Math.abs(L(s["surface.code"]) - L(s["surface.permission"]))).toBeGreaterThanOrEqual(3);
      expect(s["surface.code"]).not.toBe(s["surface.permission"]);
      expect(s["surface.code"]).not.toBe(s["surface.permission.selected"]);
    });
  }

  test("surface.overlay is derived at surface.card's step", () => {
    for (const [, colours] of themes) {
      const s = deriveSurfaces(colours);
      expect(s["surface.overlay"]).toBe(s["surface.card"]);
    }
  });

  test("flat theme: every highlight and the cursor's faint fill are the terminal's default background, so the components draw inverse video and underline instead", () => {
    // The drawing itself is covered by the PTY tests: the cursor's inverse gutter
    // (test/conversation/interaction.suite.ts), the selection in inverse video
    // (test/selection/select.pty.test.ts) and the current hit in inverse video with the others
    // underlined (test/find/find.pty.test.ts).
    const theme = resolveTheme(DEFAULT_THEME);
    expect(theme.flat).toBe(true);
    for (const h of [...HIGHLIGHTS, "surface.cursor.faint", "surface.code"] as const) expect(theme.color(h).intent).toBe("default");
  });
});

// mvp-configuration task 5.5, spec tui-theme "Surface contrast setting": `surface_contrast` scales the
// fills' L* steps within the 40 per cent cap; the highlights keep their separations beyond them.
describe("Surface contrast setting", () => {
  const L = (hex: string) => lightness(parseHex(hex));
  const step = (colours: TerminalColours, hex: string) => Math.abs(L(hex) - L(colours.background));
  const HIGHLIGHTS = ["surface.cursor", "surface.selection", "find.current", "find.other"] as const;
  /** The fills stepped straight from the background (`SURFACE_STEP_L`) and the overlay at the card's step. */
  const FILLS = ["status.bg", "surface.card", "surface.overlay", "surface.code", "surface.user", "surface.cursor.faint", "scrollbar.track", "scrollbar.thumb"] as const;

  test("Stronger cards on a light theme: at 1.2 on Zed One Light, surface.card is 1.2 times its default step, and the highlights still differ pairwise by at least 5 L*", () => {
    const normal = deriveSurfaces(ZED_ONE_LIGHT);
    const strong = deriveSurfaces(ZED_ONE_LIGHT, {}, { contrast: 1.2 });
    // Within the rounding of an 8-bit fill (about 0.4 L* at this lightness).
    expect(step(ZED_ONE_LIGHT, strong["surface.card"])).toBeCloseTo(1.2 * step(ZED_ONE_LIGHT, normal["surface.card"]), 0);
    expect(Math.abs(step(ZED_ONE_LIGHT, strong["surface.card"]) - 1.2 * SURFACE_STEP_L["surface.card"])).toBeLessThan(0.5);
    for (const name of FILLS) expect(step(ZED_ONE_LIGHT, strong[name]), name).toBeGreaterThan(step(ZED_ONE_LIGHT, normal[name]));
    for (let i = 0; i < HIGHLIGHTS.length; i++) {
      for (let j = i + 1; j < HIGHLIGHTS.length; j++) {
        const [a, b] = [HIGHLIGHTS[i]!, HIGHLIGHTS[j]!];
        expect(Math.abs(L(strong[a]) - L(strong[b])), `${a} / ${b}`).toBeGreaterThanOrEqual(5);
      }
    }
    // The selected option keeps its step from the (stronger) card.
    expect(Math.abs(L(strong["surface.permission.selected"]) - L(strong["surface.permission"]))).toBeGreaterThanOrEqual(PERMISSION_SELECTED_MIN_STEP_L);
  });

  test("Cap kept: at 2 with a background and foreground 30 L* apart, no fill's step exceeds 12 L* (40 per cent); the highlights stay within their own 50 per cent", () => {
    const low: TerminalColours = { background: "#303030", foreground: "#777777" };
    const span = L(low.foreground) - L(low.background);
    expect(span).toBeCloseTo(30, 0);
    const s = deriveSurfaces(low, {}, { contrast: 2 });
    for (const name of FILLS) expect(step(low, s[name]), name).toBeLessThanOrEqual(MAX_STEP_SHARE * span + 0.3);
    // (`deriveHighlights` may pass its cap by up to 1 L* to clear the 8-bit rounding.)
    for (const name of HIGHLIGHTS) expect(step(low, s[name]), name).toBeLessThanOrEqual(0.5 * span + 1);
    // The scale is clamped to 0.5 to 2: 5 draws as 2.
    expect(deriveSurfaces(low, {}, { contrast: 5 })).toEqual(s);
  });

  test("1 is the default derivation; the factor reaches the resolved theme through surfaceContrast", () => {
    expect(deriveSurfaces(ZED_ONE_LIGHT, {}, { contrast: 1 })).toEqual(deriveSurfaces(ZED_ONE_LIGHT));
    const resolved = resolveTheme(DEFAULT_THEME, { terminal: ZED_ONE_LIGHT, surfaceContrast: 1.2 });
    expect(toHex(resolved.color("surface.card").toInts().slice(0, 3) as [number, number, number])).toBe(deriveSurfaces(ZED_ONE_LIGHT, {}, { contrast: 1.2 })["surface.card"]);
  });
});

// mvp-configuration task 5.3, spec tui-theme "Permission card distinct under any theme" (Marcus,
// 13 October 2026, option A): the derived surfaces differ from the derived permission card by a
// CIEDE2000 colour difference (lightness, chroma and hue together) of at least 3, at any factor.
describe("Derived surfaces apart from the derived permission card (task 5.3)", () => {
  const MIN_DELTA_E = 3;
  const FACTORS = Array.from({ length: 16 }, (_, i) => Math.round((0.5 + i * 0.1) * 10) / 10);
  const compared = SURFACE_NAMES.filter((n) => n !== "surface.permission" && n !== "surface.permission.selected");

  /** Every compared surface's difference from the card. */
  const measure = (colours: TerminalColours, factor: number) => {
    const s = deriveSurfaces(colours, {}, { contrast: factor });
    return compared.map((name) => ({ name, deltaE: deltaE2000(parseHex(s[name]), parseHex(s["surface.permission"])) }));
  };

  for (const palette of RECORDED_PALETTES) {
    for (const factor of FACTORS) {
      test(`${palette.name} at surface_contrast ${factor}: every derived surface but the selected option is at least ${MIN_DELTA_E} CIEDE2000 from surface.permission`, () => {
        const failures = measure(palette, factor)
          .filter((m) => m.deltaE < MIN_DELTA_E)
          .map((m) => `${m.name} on ${palette.name} at ${factor}: ${m.deltaE.toFixed(2)}`);
        expect(failures).toEqual([]);
      });
    }
  }

  test("the comparison covers every derived surface but the card and its selected option", () => {
    expect(compared).toContain("surface.user");
    expect(compared).toContain("diff.added.bg");
    expect(compared).not.toContain("surface.permission");
    expect(compared).not.toContain("surface.permission.selected");
    expect(compared.length).toBe(SURFACE_NAMES.length - 2);
  });
});

describe("Find hits (S5, IDE session B2; checklist (d) item 2)", () => {
  const L = (hex: string) => lightness(parseHex(hex));
  const linear = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const relative = (hex: string) => {
    const [r, g, b] = parseHex(hex);
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  };
  /** WCAG 2 contrast ratio of two colours. */
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [relative(a), relative(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  };
  const themes: [string, TerminalColours, number][] = [
    ["PhpStorm dark #191a1c/#bcbec4", PHPSTORM_DARK, 4.5],
    ["PhpStorm dark #1e1f22/#bcbec4", PHPSTORM_DARK_2026, 4.5],
    ["Zed light #f8f9f9/#383a42", { background: "#f8f9f9", foreground: "#383a42" }, 4.5],
    ["Zed One Light as reported #fafafa/#2a2c33", { background: "#fafafa", foreground: "#2a2c33" }, 4.5],
    ["white #ffffff/#1f2328", LIGHT, 4.5],
    ["pure black #000000/#ffffff", BLACK, 4.5],
    ["One Dark #282c34/#abb2bf", { background: "#282c34", foreground: "#abb2bf" }, 3],
  ];

  for (const [name, colours, minContrast] of themes) {
    const dark = L(colours.background) < L(colours.foreground);
    const sign = dark ? 1 : -1;
    const step = (fill: string, under: string) => sign * (L(fill) - L(under));

    test(`${name}: find.other is at least ${MIN_SELECTION_DELTA_L} L* from the background, the user card and the card fill, lighter on dark and darker on light`, () => {
      const s = deriveSurfaces(colours);
      for (const under of [colours.background, s["surface.user"], s["surface.card"]]) {
        expect(step(s["find.other"], under)).toBeGreaterThanOrEqual(MIN_SELECTION_DELTA_L);
      }
    });

    test(`${name}: find.current is at least ${MIN_SELECTION_DELTA_L} L* beyond find.other and the conversation cursor's fill`, () => {
      const s = deriveSurfaces(colours);
      expect(step(s["find.current"], s["find.other"])).toBeGreaterThanOrEqual(MIN_SELECTION_DELTA_L);
      expect(step(s["find.current"], s["surface.cursor"])).toBeGreaterThanOrEqual(MIN_SELECTION_DELTA_L);
    });

    test(`${name}: the default foreground on both fills is at least ${minContrast}:1, and both are amber`, () => {
      const s = deriveSurfaces(colours);
      expect(contrast(colours.foreground, s["find.current"])).toBeGreaterThanOrEqual(minContrast);
      expect(contrast(colours.foreground, s["find.other"])).toBeGreaterThanOrEqual(minContrast);
      for (const fill of [s["find.current"], s["find.other"]]) {
        const [r, g, b] = parseHex(fill);
        expect(r).toBeGreaterThan(g);
        expect(g).toBeGreaterThan(b);
      }
    });
  }

  test("the old current hit (inverse video in One Light's yellow over the card fill) was about 1.7:1", () => {
    expect(contrast("#d0b67d", "#ecedee")).toBeLessThan(2);
  });

  test("stepLightness stops at the target step, or at the colour it steps towards", () => {
    const base = parseHex("#191a1c");
    const to = parseHex("#e0a030");
    const stepped = stepLightness(base, to, 10);
    expect(lightness(stepped) - lightness(base)).toBeCloseTo(10, 1);
    expect(stepLightness(base, to, 500)).toEqual(to);
  });

  test("without the terminal's colours (flat) both find tokens are the default background", () => {
    const theme = resolveTheme(DEFAULT_THEME);
    expect(theme.flat).toBe(true);
    expect(theme.color("find.current").intent).toBe("default");
    expect(theme.color("find.other").intent).toBe("default");
  });
});

// mvp-chrome-and-keys task 5.3, spec tui-theme "Selected permission option surface": the selected
// option steps 12 L* beyond the card fill (8 in phase 1a), within the 40 per cent cap; where that
// would take the default foreground below 4.5:1, the largest step that keeps it, never below 8
// (contrast wins: Marcus, 10 October 2026).
describe("Selected permission option surface", () => {
  const L = (hex: string) => lightness(parseHex(hex));
  const step = (s: Record<SurfaceName, string>) => Math.abs(L(s["surface.permission.selected"]) - L(s["surface.permission"]));
  const ratio = (fg: string, s: Record<SurfaceName, string>) => contrastRatio(parseHex(fg), parseHex(s["surface.permission.selected"]));

  test("Step on a dark theme: PhpStorm Islands Dark, the largest step up to 12 L* that keeps 4.5:1 (about 10.7), more than 8", () => {
    const s = deriveSurfaces(ISLANDS_DARK);
    expect(L(s["surface.permission.selected"])).toBeGreaterThan(L(s["surface.permission"]));
    expect(ratio(ISLANDS_DARK.foreground, s)).toBeGreaterThanOrEqual(4.5);
    // The contrast budget beyond the (rounded) card fill; the step reaches it but for 8-bit rounding.
    const budget = contrastBudgetL(parseHex(s["surface.permission"]), parseHex(ISLANDS_DARK.foreground), 4.5);
    expect(budget).toBeGreaterThan(10.5);
    expect(budget).toBeLessThan(11);
    expect(step(s)).toBeGreaterThan(8);
    expect(step(s)).toBeGreaterThan(budget - 0.4);
    expect(step(s)).toBeLessThanOrEqual(budget);
  });

  test("Step on a light theme: Zed One Light, at least 12 L* darker than the card fill, within the 40 per cent cap", () => {
    const s = deriveSurfaces(ZED_ONE_LIGHT);
    expect(L(s["surface.permission.selected"])).toBeLessThan(L(s["surface.permission"]));
    expect(step(s)).toBeGreaterThanOrEqual(12);
    expect(step(s)).toBeLessThanOrEqual(MAX_STEP_SHARE * Math.abs(L(ZED_ONE_LIGHT.foreground) - L(s["surface.permission"])));
    expect(contrastRatio(parseHex(ZED_ONE_LIGHT.foreground), parseHex(s["surface.permission.selected"]))).toBeGreaterThanOrEqual(4.5);
  });

  test("every recorded palette: 12 L* where 4.5:1 holds, else the contrast decides, never below 8 L*, within the cap", () => {
    for (const palette of RECORDED_PALETTES) {
      const s = deriveSurfaces(palette);
      const cap = MAX_STEP_SHARE * Math.abs(L(palette.foreground) - L(s["surface.permission"]));
      expect(step(s)).toBeGreaterThanOrEqual(Math.min(8, cap) - 0.01);
      expect(step(s)).toBeLessThanOrEqual(Math.min(12, cap) + 1);
      // Short of 12 only where 12 would lose the contrast.
      if (step(s) < 12) expect(ratio(palette.foreground, s) < 4.5 || contrastBudgetL(parseHex(s["surface.permission"]), parseHex(palette.foreground), 4.5) < 12).toBe(true);
    }
  });

  test("Flat theme: no colour replies, the selected option is drawn in inverse video and no truecolour background is sent", () => {
    const flat = resolveTheme(DEFAULT_THEME);
    expect(flat.flat).toBe(true);
    const selected = cardSpanStyle(flat, { text: "1 allow once", token: "text", selected: true });
    expect(selected.inverse).toBe(true);
    expect(selected.bg).toBeUndefined();
    const lit = cardSpanStyle(resolveTheme(DEFAULT_THEME, { terminal: PHPSTORM_DARK }), { text: "1 allow once", token: "text", selected: true });
    expect(lit.inverse).toBe(false);
    expect(toHex(lit.bg!.toInts().slice(0, 3) as [number, number, number])).toBe(deriveSurfaces(PHPSTORM_DARK)["surface.permission.selected"]);
  });
});

describe("Resolved theme", () => {
  test("with the terminal's colours every surface token is an rgb fill; without them, the default background", () => {
    const flat = resolveTheme(DEFAULT_THEME);
    expect(flat.flat).toBe(true);
    expect(flat.terminal).toBeNull();
    const lit = resolveTheme(DEFAULT_THEME, { terminal: PHPSTORM_DARK });
    expect(lit.flat).toBe(false);
    for (const name of SURFACE_NAMES) {
      expect(flat.color(name).intent).toBe("default");
      expect(lit.color(name).intent).toBe("rgb");
      expect(toHex(lit.color(name).toInts().slice(0, 3) as [number, number, number])).toBe(deriveSurfaces(PHPSTORM_DARK)[name]);
    }
  });

  test("text tokens do not change with the terminal's colours, except by the light background's choice; never an rgb colour", () => {
    const flat = resolveTheme(DEFAULT_THEME);
    const lit = resolveTheme(DEFAULT_THEME, { terminal: LIGHT });
    for (const name of ["text", "accent", "permission", "status.fg"] as const) {
      expect(lit.color(name).equals(flat.color(name))).toBe(true);
      expect(lit.color(name).intent).not.toBe("rgb");
    }
    // Muted text on a light background: the default foreground, dimmed (review, 9 October 2026).
    expect(flat.color("muted").intent).toBe("indexed");
    expect(lit.color("muted").intent).toBe("default");
    expect(lit.text("muted").attributes & TextAttributes.DIM).toBe(TextAttributes.DIM);
    expect(flat.text("muted").attributes & TextAttributes.DIM).toBe(0);
  });

  test("a surface token given a hex colour keeps it; diff hues follow the theme's hex diff colours", () => {
    // A fill well away from the permission card's (L* 36 against about 23): one within 3 L* of it
    // would take its derived value instead (spec tui-theme "Permission card distinct under any theme").
    const theme = withTokens(DEFAULT_THEME, { "surface.card": "#123456", "diff.add": "#00ff00" });
    const lit = resolveTheme(withTokens(theme, { "surface.card": "#345678" }), { terminal: PHPSTORM_DARK });
    expect(lit.color("surface.card").toInts()).toEqual([0x34, 0x56, 0x78, 255]);
    expect(toHex(lit.color("diff.added.bg").toInts().slice(0, 3) as [number, number, number])).toBe(
      deriveSurfaces(PHPSTORM_DARK, { added: "#00ff00" })["diff.added.bg"],
    );
    expect(resolveTheme(theme).color("surface.card").toInts()).toEqual([0x12, 0x34, 0x56, 255]);
  });

  test("a palette snapshot supplies the diff hues for indexed diff colours", () => {
    const palette = Array.from({ length: 16 }, () => null as string | null);
    palette[2] = "#00ff00";
    const lit = resolveTheme(DEFAULT_THEME, {
      terminal: PHPSTORM_DARK,
      palette: { palette, defaultForeground: null, defaultBackground: null },
    });
    expect(toHex(lit.color("diff.added.bg").toInts().slice(0, 3) as [number, number, number])).toBe(
      deriveSurfaces(PHPSTORM_DARK, { added: "#00ff00" })["diff.added.bg"],
    );
  });
});

describe("Live theme", () => {
  test("setTerminalColours re-derives the surfaces, reports whether anything changed and can return to flat", () => {
    const theme = createLiveTheme(DEFAULT_THEME);
    expect(theme.flat).toBe(true);
    expect(theme.setTerminalColours(PHPSTORM_DARK)).toBe(true);
    expect(theme.flat).toBe(false);
    expect(theme.terminal).toEqual(PHPSTORM_DARK);
    const dark = theme.color("surface.card").toInts();
    expect(theme.setTerminalColours({ ...PHPSTORM_DARK })).toBe(false);
    expect(theme.setTerminalColours(LIGHT)).toBe(true);
    expect(theme.color("surface.card").toInts()).not.toEqual(dark);
    expect(theme.setTerminalColours(null)).toBe(true);
    expect(theme.color("surface.card").intent).toBe("default");
  });

  test("without truecolour the theme stays flat, whatever the terminal answers (S1 bug 3)", () => {
    const resolved = resolveTheme(DEFAULT_THEME, { terminal: PHPSTORM_DARK, truecolour: false });
    expect(resolved.flat).toBe(true);
    expect(resolved.terminal).toEqual(PHPSTORM_DARK);
    for (const name of SURFACE_NAMES) expect(resolved.color(name).intent).toBe("default");

    const theme = createLiveTheme(DEFAULT_THEME);
    expect(theme.setTerminalColours(PHPSTORM_DARK)).toBe(true);
    expect(theme.flat).toBe(false);
    expect(theme.setTruecolour(false)).toBe(true);
    expect(theme.flat).toBe(true);
    expect(theme.color("surface.cursor").intent).toBe("default");
    expect(theme.setTruecolour(false)).toBe(false);
    // New colours keep it flat; truecolour turning on (a capability reply) derives them.
    expect(theme.setTerminalColours(LIGHT)).toBe(true);
    expect(theme.flat).toBe(true);
    expect(theme.setTruecolour(true)).toBe(true);
    expect(theme.flat).toBe(false);
    expect(theme.color("surface.card").intent).toBe("rgb");

    const forced = createLiveTheme(DEFAULT_THEME, { forceFlat: true });
    expect(forced.setTruecolour(false)).toBe(false);
    expect(forced.setTruecolour(true)).toBe(false);
    expect(forced.flat).toBe(true);
  });

  test("setForceFlat switches the forced flat style live (theme.flat, mvp-configuration task 3.2), keeping the colours reported meanwhile", () => {
    const theme = createLiveTheme(DEFAULT_THEME, { forceFlat: true });
    // Reported while forced: kept for the light or dark look (here dark), no fills.
    expect(theme.setTerminalColours(PHPSTORM_DARK)).toBe(true);
    expect(theme.flat).toBe(true);
    expect(theme.setForceFlat(true)).toBe(false);
    // Turned off: the surfaces are derived at once from the colours the terminal already gave.
    expect(theme.setForceFlat(false)).toBe(true);
    expect(theme.flat).toBe(false);
    expect(theme.terminal).toEqual(PHPSTORM_DARK);
    expect(theme.color("surface.card").intent).toBe("rgb");
    // Turned on again: flat, whatever the terminal answers.
    expect(theme.setForceFlat(true)).toBe(true);
    expect(theme.flat).toBe(true);
    for (const name of SURFACE_NAMES) expect(theme.color(name).intent).toBe("default");
  });

  test("spanStyle turns a token's attribute mask into the flags a <span> reads", () => {
    const theme = resolveTheme(DEFAULT_THEME, { terminal: PHPSTORM_DARK });
    const thought = spanStyle(theme.text("thought"));
    expect(thought).toMatchObject({ italic: true, bold: false, inverse: false });
    expect(thought.fg).toBe(theme.color("thought"));
    expect("bg" in thought).toBe(false);
    const selected = spanStyle({ ...theme.text("text"), attributes: TextAttributes.INVERSE | TextAttributes.BOLD });
    expect(selected).toMatchObject({ inverse: true, bold: true, dim: false, underline: false });
    const filled = spanStyle({ ...theme.text("text"), bg: theme.color("surface.cursor") });
    expect(filled.bg).toBe(theme.color("surface.cursor"));
  });

  test("forceFlat (theme.flat) draws no fill whatever the answers, through binding and refreshes; the answers still choose the light or dark look", async () => {
    const renderer = fakeRenderer();
    const theme = createLiveTheme(DEFAULT_THEME, { forceFlat: true });
    expect(theme.flat).toBe(true);
    expect(theme.setTerminalColours(LIGHT)).toBe(true);
    expect(theme.terminal).toEqual(LIGHT);
    expect(theme.color("warning")).toEqual(resolveTheme(DEFAULT_THEME, { terminal: LIGHT }).color("warning"));
    const colours = bindTerminalColours(renderer, theme, { write: () => {} });
    const first = colours.refresh(1000);
    renderer.emit("\x1b]10;rgb:bcbc/bebe/c4c4\x07");
    renderer.emit("\x1b]11;rgb:1919/1a1a/1c1c\x07");
    expect(await first).toEqual(PHPSTORM_DARK);
    expect(theme.flat).toBe(true);
    expect(theme.terminal).toEqual(PHPSTORM_DARK);
    expect(theme.color("surface.card").intent).toBe("default");
  });
});

describe("Colour replies", () => {
  test("rgb: with four digits per channel, either terminator", () => {
    expect(parseColourReply("\x1b]11;rgb:1919/1a1a/1c1c\x1b\\")).toEqual({ code: 11, colour: "#191a1c" });
    expect(parseColourReply("\x1b]10;rgb:bcbc/bebe/c4c4\x07")).toEqual({ code: 10, colour: "#bcbec4" });
  });

  test("shorter channels scale to 8 bits, a missing terminator and #rrggbb are accepted", () => {
    expect(parseColourReply("\x1b]11;rgb:ff/00/80")).toEqual({ code: 11, colour: "#ff0080" });
    expect(parseColourReply("\x1b]10;rgb:f/0/8\x07")).toEqual({ code: 10, colour: "#ff0088" });
    expect(parseColourReply("\x1b]11;#1E1F22\x07")).toEqual({ code: 11, colour: "#1e1f22" });
    expect(parseColourReply("\x1b]11;rgba:1919/1a1a/1c1c/ffff\x07")).toEqual({ code: 11, colour: "#191a1c" });
  });

  test("other sequences and queries are ignored", () => {
    for (const s of ["\x1b]11;?\x07", "\x1b]4;1;rgb:0000/0000/0000\x07", "\x1b]12;rgb:0000/0000/0000\x07", "\x1b]11;rgb:zz/00/00\x07", "rgb:00/00/00", ""]) {
      expect(parseColourReply(s)).toBeNull();
    }
  });
});

/** A renderer stand-in whose OSC subscribers the test feeds. */
function fakeRenderer() {
  const subscribers = new Set<(sequence: string) => void>();
  return {
    subscribeOsc(handler: (sequence: string) => void) {
      subscribers.add(handler);
      return () => void subscribers.delete(handler);
    },
    emit: (sequence: string) => subscribers.forEach((h) => h(sequence)),
    count: () => subscribers.size,
  };
}

describe("Colour tracker", () => {
  test("query writes OSC 10 and 11 and resolves once both replies have arrived", async () => {
    const renderer = fakeRenderer();
    const writes: string[] = [];
    const tracker = createColourTracker(renderer, { write: (d) => writes.push(d) });
    const pending = tracker.query(1000);
    expect(writes).toEqual(["\x1b]10;?\x07\x1b]11;?\x07"]);
    renderer.emit("\x1b]10;rgb:bcbc/bebe/c4c4\x1b\\");
    renderer.emit("\x1b]11;rgb:1919/1a1a/1c1c\x1b\\");
    expect(await pending).toEqual(PHPSTORM_DARK);
    expect(tracker.colours()).toEqual(PHPSTORM_DARK);
  });

  test("one reply is not enough: the query times out with null", async () => {
    const renderer = fakeRenderer();
    const tracker = createColourTracker(renderer, { write: () => {} });
    const pending = tracker.query(30);
    renderer.emit("\x1b]11;rgb:1919/1a1a/1c1c\x07");
    expect(await pending).toBeNull();
    expect(tracker.colours()).toBeNull();
  });

  test("a query forgets the previous answer, and later replies still count", async () => {
    const renderer = fakeRenderer();
    const tracker = createColourTracker(renderer, { write: () => {} });
    const changes: TerminalColours[] = [];
    tracker.onChange((c) => changes.push(c));
    renderer.emit("\x1b]10;#ffffff\x07");
    renderer.emit("\x1b]11;#000000\x07");
    expect(changes).toEqual([{ foreground: "#ffffff", background: "#000000" }]);
    expect(await tracker.query(20)).toBeNull();
    // A reply OpenTUI provoked itself (after CSI ? 997 ; n n) arrives with no query pending.
    renderer.emit("\x1b]10;#111111\x07");
    renderer.emit("\x1b]11;#eeeeee\x07");
    expect(changes.at(-1)).toEqual({ foreground: "#111111", background: "#eeeeee" });
    tracker.dispose();
    expect(renderer.count()).toBe(0);
  });

  test("bindTerminalColours: refresh derives the surfaces, an unanswered refresh keeps them", async () => {
    const renderer = fakeRenderer();
    const theme = createLiveTheme(DEFAULT_THEME);
    const writes: string[] = [];
    const colours = bindTerminalColours(renderer, theme, { write: (d) => writes.push(d) });
    const first = colours.refresh(1000);
    renderer.emit("\x1b]10;rgb:bcbc/bebe/c4c4\x07");
    renderer.emit("\x1b]11;rgb:1919/1a1a/1c1c\x07");
    expect(await first).toEqual(PHPSTORM_DARK);
    expect(theme.flat).toBe(false);
    expect(await colours.refresh(20)).toBeNull();
    expect(theme.terminal).toEqual(PHPSTORM_DARK);
    // An unsolicited change re-derives.
    renderer.emit("\x1b]10;#000000\x07");
    renderer.emit("\x1b]11;#ffffff\x07");
    expect(theme.terminal).toEqual({ foreground: "#000000", background: "#ffffff" });
    expect(writes.length).toBe(2);
  });
});

describe("Theme refresh", () => {
  function setup() {
    const renderer = fakeRenderer();
    const theme = createLiveTheme(DEFAULT_THEME);
    const colours = bindTerminalColours(renderer, theme, { write: () => {} });
    let repaints = 0;
    const refresh = createThemeRefresh({ colours, theme, repaint: () => repaints++ });
    const answer = (c: TerminalColours) => {
      renderer.emit(`\x1b]10;${c.foreground}\x07`);
      renderer.emit(`\x1b]11;${c.background}\x07`);
    };
    return { theme, refresh, answer, repaints: () => repaints };
  }

  test("a changed answer repaints once; the same answer does not; always forces one", async () => {
    const t = setup();
    let pending = t.refresh.run();
    t.answer(PHPSTORM_DARK);
    await pending;
    expect(t.repaints()).toBe(1);
    pending = t.refresh.run();
    t.answer(PHPSTORM_DARK);
    await pending;
    expect(t.repaints()).toBe(1);
    pending = t.refresh.run({ always: true });
    t.answer(PHPSTORM_DARK);
    await pending;
    expect(t.repaints()).toBe(2);
    // A changed answer under `always` repaints once, not twice.
    pending = t.refresh.run({ always: true });
    t.answer(LIGHT);
    await pending;
    expect(t.repaints()).toBe(3);
    expect(t.theme.terminal).toEqual(LIGHT);
  });

  test("overlapping refreshes join, and an unsolicited answer (DEC 997) repaints", async () => {
    const t = setup();
    const first = t.refresh.run();
    expect(t.refresh.run()).toBe(first);
    t.answer(LIGHT);
    await first;
    t.answer(PHPSTORM_DARK);
    expect(t.repaints()).toBe(2);
  });

  test("an unanswered refresh neither repaints nor drops the colours", async () => {
    const t = setup();
    t.theme.setTerminalColours(LIGHT);
    const pending = t.refresh.run();
    t.answer(LIGHT);
    await pending;
    const before = t.repaints();
    // No answer within the timeout: bindTerminalColours' default is 300 ms, so cut it short.
    await Promise.race([t.refresh.run(), Bun.sleep(400)]);
    expect(t.theme.terminal).toEqual(LIGHT);
    expect(t.repaints()).toBe(before);
  });
});
