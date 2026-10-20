// Legibility over the recorded palettes (mvp-rendering task 3.4, spec tui-theme "Legible defaults in
// low-contrast themes"; mvp-configuration task 5.6, "Legibility report for user themes"). The
// default theme is held to the floors by `legibility.test.ts`; `config --check` runs the same
// measure over the theme in use and reports what falls short as warnings, since the recorded
// palettes are not the user's palette. Plain data, no OpenTUI.
import { contrastRatio, parseHex, toHex } from "./derive.ts";
import { RECORDED_PALETTES, SOLARIZED_LIGHT, ZED_AYU_LIGHT, type RecordedPalette } from "./palettes.fixture.ts";
import { effectiveStyle, isLightBackground, tokenStyle } from "./style.ts";
import { SURFACE_NAMES, TOOL_KINDS, type ColorValue, type Theme, type TokenName } from "./tokens.ts";

/**
 * How far SGR 2 (dim) moves a colour towards the background, as the terminals draw it: both
 * PhpStorm terminals average the foreground with the cell's background, channel by channel in
 * sRGB (JediTerm's `TerminalPanel.getStyleForeground` and the reworked terminal's
 * `TerminalUiUtils.getResultForeground`, read from PhpStorm 2026.2.3's bytecode on 9 October
 * 2026), and Zed draws dim text with reduced opacity. Half way is the IDEs' own rule and the
 * faintest of them, so the floors are checked against it.
 */
export const DIM_BLEND = 0.5;

/** `hex` dimmed on `background`: moved `DIM_BLEND` of the way, each channel rounded down as the
 *  PhpStorm terminals' integer arithmetic does. */
export function dimmed(hex: string, background: string): string {
  const [c, b] = [parseHex(hex), parseHex(background)];
  return toHex(c.map((v, i) => Math.floor(v + (b[i]! - v) * DIM_BLEND)) as [number, number, number]);
}

/** The xterm colour of a 256-colour index above 15 (the 6x6x6 cube and the grey ramp). */
export function xtermColour(index: number): string {
  if (index >= 232) {
    const v = 8 + (index - 232) * 10;
    return toHex([v, v, v]);
  }
  const n = index - 16;
  const level = (c: number) => (c === 0 ? 0 : 55 + c * 40);
  return toHex([level(Math.floor(n / 36)), level(Math.floor(n / 6) % 6), level(n % 6)]);
}

/** The colour a value is drawn in on a palette: an index looked up (0 to 15 from the palette),
 *  `default` the palette's foreground (`bg`: its background), a hex value itself. */
export function paletteColour(colour: ColorValue, palette: RecordedPalette, role: "fg" | "bg" = "fg"): string {
  if (colour === "default" || colour === "derived") return role === "fg" ? palette.foreground : palette.background;
  if (typeof colour === "number") return colour < 16 ? palette.ansi[colour]! : xtermColour(colour);
  return colour.toLowerCase();
}

/** The colour a theme's text token is drawn in on a recorded palette: the index or default the
 *  theme picks for that background's lightness (design decision 10), looked up in the palette,
 *  and moved half way to the background when the style is dim (`DIM_BLEND`). */
export function drawnColour(theme: Theme, name: TokenName, palette: RecordedPalette): string {
  const style = effectiveStyle(tokenStyle(theme, name), isLightBackground(palette));
  const hex = paletteColour(style.color, palette);
  return style.dim ? dimmed(hex, palette.background) : hex;
}

/** At least 3:1 against the background: prose, headings, links, code, task boxes, alerts, the tool
 *  line's kind, title, count and duration, and `warning` (design decision 10, report S2 16.4). */
export const PROSE: readonly TokenName[] = [
  "text",
  "accent",
  "busy",
  "warning",
  "danger",
  "markdown.heading.1",
  "markdown.heading.2",
  "markdown.heading.3",
  "markdown.heading.4",
  "markdown.link",
  "markdown.code",
  "markdown.math",
  "markdown.list",
  "markdown.table.header",
  "markdown.task.done",
  "markdown.task.open",
  "markdown.alert.note",
  "markdown.alert.tip",
  "markdown.alert.important",
  "markdown.alert.warning",
  "markdown.alert.caution",
  "code.keyword",
  "code.string",
  "code.number",
  "code.constant",
  "code.type",
  "code.function",
  "code.variable",
  "code.property",
  "code.operator",
  "code.punctuation",
  "code.tag",
  "code.attribute",
  "code.default",
  "tool.kind",
  ...TOOL_KINDS.map((k) => `tool.kind.${k}` as TokenName),
  "tool.title",
  "tool.count",
  "tool.duration",
];

/** At least 2:1, and between the background and the default foreground in lightness: the muted
 *  tokens, every token whose default is bright black on a dark background. */
export const MUTED: readonly TokenName[] = [
  "muted",
  "hint",
  "thought",
  "markdown.quote",
  "markdown.strike",
  "markdown.table.border",
  "markdown.heading.5",
  "markdown.heading.6",
  "code.comment",
  "tool.index",
  "tool.result.label",
];

export const FLOORS: readonly [readonly TokenName[], number][] = [
  [PROSE, 3],
  [MUTED, 2],
];

/** A pinned surface must leave the default foreground this contrast (spec tui-theme "Legibility
 *  report for user themes"). */
export const SURFACE_TEXT_FLOOR = 4.5;

/**
 * Palette limits (Marcus, 8 October 2026: recorded as named exceptions). Measured on the recorded palettes (Zed's from live OSC 4
 * captures, 9 October 2026), these cannot meet their floor with any ANSI index that keeps the colour, so they are listed here with their ratio
 * instead of failing the test, and the test checks that each one still fails (so the list stays
 * true). Everything else is held to the floor.
 * - Zed Ayu Light: every ANSI colour but 0 (which is the foreground) is under 3:1 on #fcfcfc (red
 *   2.80, green 2.43, yellow 1.89, blue 2.84, magenta 2.31, cyan 2.22). Zed raises low-contrast ANSI
 *   text when it draws (its terminal minimum contrast), so what Zed draws has more contrast than
 *   these ratios; the capture shows the palette it reports, not the colour drawn.
 * - Solarized Light: green 2.97 and cyan 2.93 on #fdf6e3, just under 3:1; the only colours that pass
 *   there are red, orange, blue, magenta, violet and the base tones. Muted text is the body text
 *   (base00 #657b83, itself only 4.13:1) dimmed: 1.88:1 at the IDEs' half-way blend, more where a
 *   terminal dims less. It is the one way to keep it between the background and the body text
 *   with the palette's own colours, since bright black is base03, the darkest tone (Marcus's
 *   review, 9 October 2026).
 */
export const EXCUSED: ReadonlyMap<string, ReadonlySet<TokenName>> = new Map<string, ReadonlySet<TokenName>>([
  [
    ZED_AYU_LIGHT.name,
    new Set<TokenName>([
      "accent",
      "busy",
      "warning",
      "danger",
      "markdown.heading.1",
      "markdown.heading.2",
      "markdown.heading.3",
      "markdown.link",
      "markdown.code",
      "markdown.math",
      "markdown.list",
      "markdown.table.header",
      "markdown.task.done",
      "markdown.alert.note",
      "markdown.alert.tip",
      "markdown.alert.important",
      "markdown.alert.warning",
      "markdown.alert.caution",
      "code.keyword",
      "code.string",
      "code.number",
      "code.constant",
      "code.type",
      "code.function",
      "code.tag",
      "code.attribute",
      "tool.kind",
      ...TOOL_KINDS.map((k) => `tool.kind.${k}` as TokenName),
      "tool.count",
      "tool.duration",
    ]),
  ],
  [
    SOLARIZED_LIGHT.name,
    new Set<TokenName>([
      "markdown.math",
      "markdown.task.done",
      "markdown.alert.tip",
      "code.string",
      "code.number",
      "code.constant",
      "tool.kind",
      ...TOOL_KINDS.map((k) => `tool.kind.${k}` as TokenName),
      ...MUTED,
    ]),
  ],
]);

/** A text token under its floor on a palette. */
export interface LegibilityShortfall {
  readonly token: TokenName;
  readonly palette: string;
  readonly ratio: number;
  readonly floor: number;
  /** `text` for a text token against the background; `surface` for a pinned surface under the
   *  default foreground. */
  readonly kind: "text" | "surface";
  /** The surface's colour, for `surface`. */
  readonly colour?: string;
}

/** Every listed text token under its floor on each palette, the excused ones left out. */
export function legibilityShortfalls(theme: Theme, palettes: readonly RecordedPalette[] = RECORDED_PALETTES, excused: ReadonlyMap<string, ReadonlySet<TokenName>> = EXCUSED): LegibilityShortfall[] {
  const out: LegibilityShortfall[] = [];
  for (const palette of palettes) {
    const bg = parseHex(palette.background);
    for (const [names, floor] of FLOORS) {
      for (const name of names) {
        if (excused.get(palette.name)?.has(name)) continue;
        const ratio = contrastRatio(parseHex(drawnColour(theme, name, palette)), bg);
        if (ratio < floor) out.push({ token: name, palette: palette.name, ratio, floor, kind: "text" });
      }
    }
  }
  return out;
}

/** Every token under its floor on a palette, as `token on palette: ratio:1 (floor n:1)`. */
export function legibilityFailures(theme: Theme, palettes: readonly RecordedPalette[], excused: ReadonlyMap<string, ReadonlySet<TokenName>> = EXCUSED): string[] {
  return legibilityShortfalls(theme, palettes, excused).map((s) => `${s.token} on ${s.palette}: ${s.ratio.toFixed(2)}:1 (floor ${s.floor}:1)`);
}

/** Every surface the theme pins to a `#rrggbb` that leaves the palette's default foreground under
 *  `SURFACE_TEXT_FLOOR`. */
export function surfaceShortfalls(theme: Theme, palettes: readonly RecordedPalette[] = RECORDED_PALETTES): LegibilityShortfall[] {
  const out: LegibilityShortfall[] = [];
  for (const palette of palettes) {
    for (const name of SURFACE_NAMES) {
      const colour = effectiveStyle(tokenStyle(theme, name), isLightBackground(palette)).color;
      if (typeof colour !== "string" || !colour.startsWith("#")) continue;
      const ratio = contrastRatio(parseHex(palette.foreground), parseHex(colour));
      if (ratio < SURFACE_TEXT_FLOOR) out.push({ token: name, palette: palette.name, ratio, floor: SURFACE_TEXT_FLOOR, kind: "surface", colour: colour.toLowerCase() });
    }
  }
  return out;
}

/** How a shortfall reads in a warning (after the token's path). */
export function shortfallMessage(s: LegibilityShortfall): string {
  if (s.kind === "surface") {
    return `(${s.colour}) leaves the default foreground ${s.ratio.toFixed(2)}:1 on ${s.palette}, below ${s.floor}:1; text on it may be hard to read`;
  }
  return `is ${s.ratio.toFixed(2)}:1 against the background on ${s.palette}, below the ${s.floor}:1 floor for ${s.floor === 3 ? "text" : "muted text"}; it may be hard to read there`;
}
