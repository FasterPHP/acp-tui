// The recorded palettes (mvp-rendering task 3.3) and the legibility of the default theme over them
// (task 3.4, spec tui-theme "Legible defaults in low-contrast themes"). The measure itself is
// src/theme/legibility.ts, which `config --check` also runs over the theme in use (task 5.6).
import { describe, expect, test } from "bun:test";
import type { ToolCallItem } from "acp-model";
import { toolLine } from "../conversation/format.ts";
import { DEFAULT_THEME } from "./default-theme.ts";
import { contrastRatio, lightness, parseHex } from "./derive.ts";
import { drawnColour, EXCUSED, legibilityFailures, MUTED } from "./legibility.ts";
import { ISLANDS_DARK, RECORDED_PALETTES, SOLARIZED_LIGHT, ZED_ONE_LIGHT, type RecordedPalette } from "./palettes.fixture.ts";
import { effectiveStyle, styleColour, tokenStyle } from "./resolve.ts";
import { TOOL_KINDS, type Theme, type TokenName } from "./tokens.ts";

const HEX = /^#[0-9a-f]{6}$/;

describe("Recorded palettes", () => {
  test("Islands Dark and Light, One Light, One Dark, Ayu Light and Solarized Light are recorded", () => {
    expect(RECORDED_PALETTES.map((p) => p.name)).toEqual([
      "PhpStorm Islands Dark",
      "PhpStorm Islands Light",
      "Zed One Light",
      "Zed One Dark",
      "Zed Ayu Light",
      "Solarized Light",
    ]);
  });

  for (const palette of RECORDED_PALETTES) {
    test(`${palette.name}: 16 colours plus foreground and background, each #rrggbb, with its source noted`, () => {
      expect(palette.ansi).toHaveLength(16);
      for (const colour of [...palette.ansi, palette.foreground, palette.background]) expect(colour).toMatch(HEX);
      expect(palette.source.length).toBeGreaterThan(10);
      if (palette.name.startsWith("Zed")) expect(palette.source).toContain("captured live by OSC 4 in Zed 1.18.1");
    });
  }
});

describe("Legible defaults in low-contrast themes", () => {
  test("every listed token meets its floor (3:1 for prose, headings, links, code, task boxes, alerts and the tool line; 2:1 muted) on every recorded palette", () => {
    expect(legibilityFailures(DEFAULT_THEME, RECORDED_PALETTES)).toEqual([]);
  });

  test("One Light: a failure names the token, the palette and the measured ratio", () => {
    // A deliberately weakened theme: inline code in yellow on light backgrounds too.
    const weak: Theme = { ...DEFAULT_THEME, tokens: { ...DEFAULT_THEME.tokens, "markdown.code": 3 } };
    const failures = legibilityFailures(weak, RECORDED_PALETTES.filter((p) => p.name === "Zed One Light"));
    expect(failures).toEqual(["markdown.code on Zed One Light: 1.88:1 (floor 3:1)"]);
  });

  test("the excused tokens are still under their floor (the list is kept true)", () => {
    for (const [paletteName, names] of EXCUSED) {
      const palette = RECORDED_PALETTES.find((p) => p.name === paletteName)!;
      const stillFailing = legibilityFailures(DEFAULT_THEME, [palette], new Map()).map((f) => f.split(" on ")[0]);
      expect([...names].filter((n) => !stillFailing.includes(n))).toEqual([]);
    }
  });

  test("Solarized Light's muted tokens are named at 1.88:1, under the half-way dim", () => {
    const failures = legibilityFailures(DEFAULT_THEME, [SOLARIZED_LIGHT], new Map());
    for (const name of MUTED) expect(failures).toContain(`${name} on Solarized Light: 1.88:1 (floor 2:1)`);
  });

  test("light backgrounds take other indices where yellow fails (One Light's yellow is 1.88:1), dark ones keep the design's defaults", () => {
    const one = (name: TokenName, palette: RecordedPalette) => drawnColour(DEFAULT_THEME, name, palette);
    const oneLight = RECORDED_PALETTES.find((p) => p.name === "Zed One Light")!;
    expect(one("markdown.code", ISLANDS_DARK)).toBe(ISLANDS_DARK.ansi[3]!);
    expect(one("markdown.code", oneLight)).not.toBe(oneLight.ansi[3]!);
    expect(one("warning", oneLight)).not.toBe(oneLight.ansi[3]!);
  });
});

/** Every muted token drawn outside the background and the default foreground's lightness, or in
 *  `markdown.link`'s colour, on a palette. */
export function mutedFailures(theme: Theme, palettes: readonly RecordedPalette[]): string[] {
  const failures: string[] = [];
  for (const palette of palettes) {
    const [bg, fg] = [lightness(parseHex(palette.background)), lightness(parseHex(palette.foreground))];
    const link = drawnColour(theme, "markdown.link", palette);
    for (const name of MUTED) {
      const colour = drawnColour(theme, name, palette);
      const l = lightness(parseHex(colour));
      if (!(l > Math.min(bg, fg) && l < Math.max(bg, fg))) {
        failures.push(`${name} on ${palette.name}: L* ${l.toFixed(1)} not between ${Math.min(bg, fg).toFixed(1)} and ${Math.max(bg, fg).toFixed(1)}`);
      }
      if (colour === link) failures.push(`${name} on ${palette.name}: the link colour ${link}`);
    }
  }
  return failures;
}

describe("Muted between the background and the foreground (review, 9 October 2026)", () => {
  test("Muted on One Light: lighter than the default foreground, darker than the background, not the link colour", () => {
    const [bg, fg] = [ZED_ONE_LIGHT.background, ZED_ONE_LIGHT.foreground].map((c) => lightness(parseHex(c)));
    const muted = drawnColour(DEFAULT_THEME, "muted", ZED_ONE_LIGHT);
    expect(lightness(parseHex(muted))).toBeGreaterThan(fg!);
    expect(lightness(parseHex(muted))).toBeLessThan(bg!);
    expect(muted).not.toBe(drawnColour(DEFAULT_THEME, "markdown.link", ZED_ONE_LIGHT));
    // Bright black, the old muted colour, is pure black there: darker than the body text.
    expect(ZED_ONE_LIGHT.ansi[8]).toBe("#000000");
    expect(contrastRatio(parseHex(muted), parseHex(ZED_ONE_LIGHT.background))).toBeGreaterThanOrEqual(2);
  });

  test("every muted token on every recorded palette lies between the background and the default foreground in lightness, and is never the link colour", () => {
    expect(mutedFailures(DEFAULT_THEME, RECORDED_PALETTES)).toEqual([]);
  });

  test("the check catches the old default (bright black everywhere) on One Light, Ayu Light and Solarized Light", () => {
    const old: Theme = { ...DEFAULT_THEME, tokens: { ...DEFAULT_THEME.tokens, muted: 8 } };
    const names = mutedFailures(old, RECORDED_PALETTES).filter((f) => f.startsWith("muted on "));
    expect(names).toEqual([
      "muted on Zed One Light: L* 0.0 not between 18.1 and 98.3",
      "muted on Zed Ayu Light: the link colour #3b9ee5",
      "muted on Solarized Light: L* 15.5 not between 50.2 and 97.0",
    ]);
  });

  test("dark backgrounds keep bright black; light ones draw the default foreground dimmed, the token's other attributes kept", () => {
    for (const name of MUTED) {
      const style = tokenStyle(DEFAULT_THEME, name);
      const [dark, light] = [effectiveStyle(style, false), effectiveStyle(style, true)];
      expect(dark.color).toBe(8);
      expect(light).toEqual({ ...dark, color: "default", dim: true });
    }
  });
});

describe("Adjacent segments differ", () => {
  const base: ToolCallItem = {
    id: "tool:t",
    status: "final",
    origin: "self",
    kind: "tool_call",
    toolCallId: "t",
    index: 7,
    title: "src/index.ts",
    toolName: null,
    toolKind: "read",
    toolStatus: "completed",
    content: [],
    locations: [],
    rawOutputText: null,
    startedAt: 0,
    endedAt: 900,
  };
  const output = { type: "text" as const, text: "a\nb\nc\n" };
  const samples: ToolCallItem[] = TOOL_KINDS.flatMap((kind) => [
    { ...base, toolKind: kind, content: [output as never] },
    { ...base, toolKind: kind, endedAt: 10 },
    { ...base, toolKind: kind, toolStatus: "failed" as const, content: [{ type: "diff", path: "a", oldText: "a\n", newText: "b\n" } as never] },
    { ...base, toolKind: kind, toolStatus: "in_progress" as const, status: "live" as const, endedAt: null },
    { ...base, toolKind: kind, toolStatus: "in_progress" as const, endedAt: null },
  ]);

  /**
   * No palette limit any more: Ayu Light's bright black is its blue, so the duration (blue) and the
   * index met in one colour there until muted text on a light background became the default
   * foreground dimmed (Marcus's review, 9 October 2026). Kept as a map so that a new limit is
   * named, not hidden.
   */
  const EXCUSED_CLASHES = new Map<string, string[]>();

  for (const palette of RECORDED_PALETTES) {
    test(`${palette.name}: neighbouring segments of a tool line never resolve to the same colour`, () => {
      const clashes: string[] = [];
      for (const item of samples) {
        const segments = toolLine(item, 80).filter((s) => s.text.trim() !== "");
        for (let i = 1; i < segments.length; i++) {
          const [a, b] = [segments[i - 1]!, segments[i]!];
          const [ca, cb] = [drawnColour(DEFAULT_THEME, a.token, palette), drawnColour(DEFAULT_THEME, b.token, palette)];
          if (ca === cb) clashes.push(`${a.token} "${a.text.trim()}" / ${b.token} "${b.text.trim()}": ${ca}`);
        }
      }
      expect([...new Set(clashes)]).toEqual(EXCUSED_CLASHES.get(palette.name) ?? []);
    });
  }

  test("default theme: tool.kind, tool.count and tool.duration are three different ANSI colours, none of them tool.title's", () => {
    for (const light of [false, true]) {
      const [kind, count, duration, title] = (["tool.kind", "tool.count", "tool.duration", "tool.title"] as const).map((n) => styleColour(tokenStyle(DEFAULT_THEME, n), light));
      expect(new Set([kind, count, duration, title]).size).toBe(4);
    }
  });
});
