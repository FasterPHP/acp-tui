// Surface derivation (design D8, spec tui-theme "Surfaces derived from the terminal's
// colours"). Each surface is the reported background stepped towards the reported
// foreground until its CIE L* differs from the background's by a fixed step, so it
// follows whatever theme the IDE or Omarchy is showing, with the same perceived
// separation on dark and light themes. Nothing here needs OSC 4 or the palette.
import type { SurfaceName } from "./tokens.ts";

/** The foreground and background a terminal reported for OSC 10 and OSC 11, as `#rrggbb`. */
export interface TerminalColours {
  foreground: string;
  background: string;
}

export type Rgb = readonly [number, number, number];

/**
 * CIE L* step from the terminal background towards the foreground, per surface (task 11.5, from
 * the S2 screenshots). Until 11.5 these were sRGB mix fractions (status 4 %, card 6, user 9,
 * selected 17, permission 10): a fraction moves L* by an amount that depends on the theme, so the
 * same fills came out at 3.5, 4.9, 7.3 and 13.4 L* on PhpStorm's Islands Dark, 2.8, 4.2, 6.6 and
 * 12.3 on Zed's One Light and 2.4, 3.7, 5.6 and 10.4 on One Dark, where they read as faint. An L*
 * step gives every theme the same separation. The values keep the order of prominence, lift the
 * status row and the card fill, which read as faint (status on both IDEs, the cards on One Light).
 * The highlights (`surface.cursor`, `surface.selection`, `find.current`, `find.other`) are not
 * fixed steps: `deriveHighlights` places them beyond these fills.
 */
export const SURFACE_STEP_L: Readonly<
  Record<
    Exclude<
      SurfaceName,
      | "diff.added.bg"
      | "diff.removed.bg"
      | "surface.permission.selected"
      | "find.current"
      | "find.other"
      | "surface.overlay"
      | "surface.cursor"
      | "surface.selection"
    >,
    number
  >
> = {
  // The faint fill across the item under the conversation cursor (review C5, Marcus, 9 October
  // 2026: option C of docs/mvp-notes/rendering-choices.md, a `▎` bar in `surface.cursor`'s colour
  // over this fill): a neutral step quieter than the status row, so a long message under the
  // cursor keeps its contrast. Exempt from the highlights' 5 L* rule.
  "surface.cursor.faint": 3.5,
  "status.bg": 4.5,
  "surface.card": 5.5,
  // Code blocks (mvp-rendering design decision 8): a neutral step a little beyond the card fill, so
  // a block reads as a block on the pane; inside an expanded card the card's own fill serves. At
  // least 3 L* from the warm permission card (13 and 10 L* from the background, below).
  "surface.code": 6.5,
  "surface.user": 8,
  // The grey step before the warm hue is mixed in; the hue adds about 4.5 L* on a dark theme and
  // 1.5 on a light one, so the card ends 13 and 10 L* from the background.
  "surface.permission": 8.5,
  // The conversation scroll bar (mvp-chrome-and-keys design D17; the trial's steps, which Marcus
  // found easy to see on 7 October 2026). The track is
  // a faint column at the status row's step, so it marks the bar without drawing a line down the
  // screen; the thumb is a clear step beyond it (15.5 L*), findable at a glance.
  "scrollbar.track": 4.5,
  "scrollbar.thumb": 20,
};

/**
 * The highlights (mvp-rendering task 3.2, spec tui-theme "Separate highlight surfaces"): the
 * conversation cursor, a selection and the two find fills are each this many L* (or more) from one
 * another and from the fills they may sit on (`surface.card`, `surface.user`, `surface.code`),
 * measured after rounding to 8 bits per channel. 5 is the spec's floor.
 */
export const HIGHLIGHT_GAP_L = 5.1;

/**
 * The default foreground must keep this contrast (WCAG 2) on every highlight where the theme allows
 * it. It decides how many highlight levels there are: on PhpStorm's Islands Dark (#191a1c, #bcbec4)
 * a fill more than about 23.8 L* from the background takes the text below 4.5:1, which leaves room
 * for three levels beyond the user card but not four (see `deriveHighlights`). A theme whose own
 * text is close to its background (One Dark, Solarized Light, Ayu Light) cannot reach it at all.
 */
export const HIGHLIGHT_MIN_CONTRAST = 4.5;

/**
 * No step goes further than this share of the L* distance from the background to the foreground,
 * so a low-contrast theme cannot get a fill close to its own text colour. It binds only when the
 * two are less than 22 L* apart; real themes are 45 to 95 apart.
 */
export const MAX_STEP_SHARE = 0.4;

/**
 * The highlights may go further, to this share: they must stay apart from one another, and on a
 * low-contrast theme 0.4 would squeeze the top two together (on Solarized Light, 47 L* apart, the
 * selection would sit 0.2 L* from the current find hit).
 */
export const HIGHLIGHT_MAX_STEP_SHARE = 0.5;

/** The permission card leans warm: this hue is mixed into its fill at `PERMISSION_WARMTH`. */
export const PERMISSION_HUE = "#e0a030";
export const PERMISSION_WARMTH = 0.08;

/**
 * The selected option on the permission card is the card's own fill stepped towards the
 * foreground by this many L*. It cannot reuse a highlight surface: those are stepped from the
 * terminal background, and the card's warm hue makes the fill brighter than a plain step, so on
 * PhpStorm dark the selection (48,49,52) once came out darker than the card (56,52,45) and differed
 * only in hue (S1 re-check, bug 3). Stepping from the fill towards the foreground puts the
 * selection lighter than the card on a dark theme and darker on a light one, by construction, and
 * keeps the card's hue. (Until task 11.5 this was a 14 % mix, which gave 8.4 L* on PhpStorm dark;
 * phase 1a stepped 8 L*, which Marcus found too faint beside the card's two focus stops, 13.7, so
 * mvp-chrome-and-keys design D6 raised it to 12, still within `MAX_STEP_SHARE`.)
 */
export const PERMISSION_SELECTED_STEP_L = 12;

/**
 * Where `PERMISSION_SELECTED_STEP_L` would take the default foreground below
 * `HIGHLIGHT_MIN_CONTRAST` on the selected option, the step is the largest that keeps it, but never
 * less than this (contrast wins: Marcus, 10 October 2026, as for `find.other`). On PhpStorm's Islands
 * Dark that is about 10.7 L*; a theme whose text is close to its background cannot keep 4.5:1 at
 * all and gets this floor.
 */
export const PERMISSION_SELECTED_MIN_STEP_L = 8;

/**
 * Find's hits (S5, IDE session B2; checklist (d) item 2, accepted 2 October 2026) are filled with
 * the background stepped towards this amber, by a lightness step rather than a fixed fraction: an
 * sRGB fraction moves CIE L* about twice as far on a dark background as on a light one, so one
 * fraction could not keep the steps visible on light themes and the text readable on dark ones.
 * Text on both fills is the terminal's default foreground. The current hit was inverse video in
 * `warning`, about 1.7:1 on Zed's One Light. Their steps are placed by `deriveHighlights`.
 */
export const FIND_HUE = "#e0a030";

/**
 * Diff backgrounds mix the background with the theme's added and removed hue at this fraction. It
 * stays a fraction (task 11.5): the hue carries the meaning, the S2 screenshots showed the signs
 * and red and green text legible on both IDEs' fills, and a fixed fraction bounds the saturation,
 * which an L* step towards a hue close to the background's lightness would not.
 */
export const DIFF_MIX = 0.15;

/** Hues used for diff backgrounds when the theme's `diff.add` and `diff.remove` are not hex colours. */
export const DEFAULT_ADDED_HUE = "#3fb950";
export const DEFAULT_REMOVED_HUE = "#f85149";

/** Pure black is lifted to this before mixing: a step towards the foreground would be invisible on it. */
export const BLACK_LIFT = 0x10;

export function parseHex(hex: string): Rgb {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
  if (!m) throw new Error(`expected #rrggbb, got "${hex}"`);
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

export function toHex([r, g, b]: Rgb): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** `from` stepped towards `to` by `fraction`, per channel in sRGB. */
export function mix(from: Rgb, to: Rgb, fraction: number): Rgb {
  return [from[0] + (to[0] - from[0]) * fraction, from[1] + (to[1] - from[1]) * fraction, from[2] + (to[2] - from[2]) * fraction];
}

/** Perceived brightness, 0 to 255 (the weights OpenTUI uses for its light/dark test). */
export function luminance([r, g, b]: Rgb): number {
  return (r * 299 + g * 587 + b * 114) / 1000;
}

/**
 * CIE L* (0 to 100) of an sRGB colour, D65: the perceptual lightness the tests measure contrast
 * with. A difference of 1 is about one just-noticeable step; differences under 3 or so are
 * hard to see at terminal-pane size.
 */
export function lightness([r, g, b]: Rgb): number {
  const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
}

/**
 * `from` stepped towards `to` until its CIE L* differs from `from`'s by `deltaL` (or all the way
 * to `to` when that is closer). Lightness along the sRGB line is found by bisection.
 */
export function stepLightness(from: Rgb, to: Rgb, deltaL: number): Rgb {
  const start = lightness(from);
  if (Math.abs(lightness(to) - start) <= deltaL) return to;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (Math.abs(lightness(mix(from, to, mid)) - start) < deltaL) lo = mid;
    else hi = mid;
  }
  return mix(from, to, hi);
}

/** WCAG 2 relative luminance (0 to 1) of an sRGB colour. */
export function relativeLuminance([r, g, b]: Rgb): number {
  const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2 contrast ratio (1 to 21) of two colours. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** CIE L* of a relative luminance. */
function lightnessOfLuminance(y: number): number {
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
}

/**
 * How far (in L*) a fill may step from `base` towards `fg` while `fg` keeps `ratio` against it. The
 * ratio depends on luminance only, and L* is a function of luminance, so the hue of the fill does
 * not matter.
 */
export function contrastBudgetL(base: Rgb, fg: Rgb, ratio: number): number {
  const yf = relativeLuminance(fg);
  const dark = lightness(base) < lightness(fg);
  const limit = dark ? (yf + 0.05) / ratio - 0.05 : ratio * (yf + 0.05) - 0.05;
  if (dark ? limit <= 0 : limit >= 1) return 0;
  return Math.max(0, Math.abs(lightnessOfLuminance(Math.min(1, Math.max(0, limit))) - lightness(base)));
}

export interface Hues {
  added?: string;
  removed?: string;
}

/** Rounded to 8 bits per channel, as the surfaces are drawn. */
const rounded = (c: Rgb): Rgb => parseHex(toHex(c));

/**
 * The four highlights (spec tui-theme "Separate highlight surfaces"), in order of prominence:
 *
 * - `surface.cursor`, the quietest, `HIGHLIGHT_GAP_L` beyond the furthest of the fills it may sit
 *   on (`surface.card`, `surface.user`, `surface.code`), grey (towards the foreground);
 * - `find.other`, a gap beyond the cursor, amber (towards `FIND_HUE`);
 * - `find.current`, a gap beyond that, amber;
 * - `surface.selection`, a gap beyond that, grey.
 *
 * Each level is measured from the previous one after rounding, so the gaps survive the 8-bit fill.
 * When the four levels would take the default foreground below `HIGHLIGHT_MIN_CONTRAST`, as on
 * PhpStorm's Islands Dark, `find.other` takes the cursor's lightness instead, and the others move
 * down a level: the cursor is drawn only while the conversation has focus and the find hits only
 * while the find bar has it, so those two are never on screen together, and their hues still
 * differ. Every level stays within `HIGHLIGHT_MAX_STEP_SHARE` of the way to the foreground.
 */
function deriveHighlights(base: Rgb, fg: Rgb, under: readonly Rgb[]): Record<"surface.cursor" | "find.other" | "find.current" | "surface.selection", Rgb> {
  const baseL = lightness(base);
  const fromBase = (c: Rgb) => Math.abs(lightness(c) - baseL);
  const cap = HIGHLIGHT_MAX_STEP_SHARE * Math.abs(lightness(fg) - baseL);
  const amber = parseHex(FIND_HUE);
  /** `base` stepped towards `to` by at least `deltaL` after rounding (within the cap). */
  const towards = (to: Rgb) => (deltaL: number): Rgb => {
    const target = Math.min(deltaL, cap);
    let c = rounded(stepLightness(base, to, target));
    for (let extra = 0.05; fromBase(c) < target && extra < 1; extra += 0.05) c = rounded(stepLightness(base, to, Math.min(target + extra, cap + 1)));
    return c;
  };
  const grey = towards(fg);
  const warm = towards(amber);
  const floor = Math.max(...under.map(fromBase)) + HIGHLIGHT_GAP_L;
  const cursor = grey(floor);
  const four = fromBase(cursor) + 3 * HIGHLIGHT_GAP_L <= contrastBudgetL(base, fg, HIGHLIGHT_MIN_CONTRAST) - 0.2;
  const findOther = warm(four ? fromBase(cursor) + HIGHLIGHT_GAP_L : floor);
  const findCurrent = warm(fromBase(findOther) + HIGHLIGHT_GAP_L);
  const selection = grey(fromBase(findCurrent) + HIGHLIGHT_GAP_L);
  return { "surface.cursor": cursor, "find.other": findOther, "find.current": findCurrent, "surface.selection": selection };
}

/**
 * The selected permission option (spec tui-theme "Selected permission option surface"): the card
 * fill (`card`, rounded) stepped towards the foreground by `PERMISSION_SELECTED_STEP_L` when the
 * foreground keeps `HIGHLIGHT_MIN_CONTRAST` on the result, otherwise by the largest step that
 * keeps it, never less than `PERMISSION_SELECTED_MIN_STEP_L`; always within `MAX_STEP_SHARE`.
 * Measured after rounding to 8 bits per channel, as drawn.
 */
function deriveSelected(card: Rgb, fg: Rgb): Rgb {
  const cardL = lightness(card);
  const cap = MAX_STEP_SHARE * Math.abs(lightness(fg) - cardL);
  const at = (deltaL: number): Rgb => rounded(stepLightness(card, fg, Math.min(deltaL, cap)));
  const from = (c: Rgb) => Math.abs(lightness(c) - cardL);
  const keeps = (c: Rgb) => contrastRatio(fg, c) >= HIGHLIGHT_MIN_CONTRAST;
  /** At least `deltaL` from the card after rounding (the step alone can land a few tenths short). */
  const atLeast = (deltaL: number): Rgb => {
    const target = Math.min(deltaL, cap);
    let c = at(target);
    for (let extra = 0.05; from(c) < target && extra < 1; extra += 0.05) c = at(target + extra);
    return c;
  };
  const full = atLeast(PERMISSION_SELECTED_STEP_L);
  if (keeps(full)) return full;
  const floor = atLeast(PERMISSION_SELECTED_MIN_STEP_L);
  if (!keeps(floor)) return floor;
  // Back off from the contrast budget until the rounded fill keeps the contrast.
  let deltaL = Math.min(PERMISSION_SELECTED_STEP_L, contrastBudgetL(card, fg, HIGHLIGHT_MIN_CONTRAST));
  let c = at(deltaL);
  while (!keeps(c) && deltaL > PERMISSION_SELECTED_MIN_STEP_L) {
    deltaL -= 0.05;
    c = at(deltaL);
  }
  return keeps(c) && from(c) >= from(floor) ? c : floor;
}

/** The range of `surface_contrast` (spec tui-theme "Surface contrast setting"). */
export const SURFACE_CONTRAST_RANGE = { min: 0.5, max: 2 } as const;

/** A `surface_contrast` factor within its range (1 for anything that is not a number). */
export function clampContrast(factor: number): number {
  return Number.isFinite(factor) ? Math.min(SURFACE_CONTRAST_RANGE.max, Math.max(SURFACE_CONTRAST_RANGE.min, factor)) : 1;
}

export interface DeriveOptions {
  /**
   * `surface_contrast` (mvp-configuration design D7): every fill's L* step from the background
   * (`SURFACE_STEP_L`) is multiplied by it, still capped at `MAX_STEP_SHARE` of the way to the
   * foreground. The highlights are placed beyond the scaled fills with their own minimum gap
   * (`HIGHLIGHT_GAP_L`) and the selected permission option keeps its step from the card, so the
   * separations of "Separate highlight surfaces" and "Selected permission option surface" hold at
   * any factor. Default 1; clamped to 0.5 to 2.
   */
  contrast?: number;
}

/**
 * Derives every surface token from the terminal's colours. Each value is a `#rrggbb`.
 * Rounding is per surface after all mixing, so the values are stable for a given input.
 */
export function deriveSurfaces(colours: TerminalColours, hues: Hues = {}, options: DeriveOptions = {}): Record<SurfaceName, string> {
  const contrast = clampContrast(options.contrast ?? 1);
  const fg = parseHex(colours.foreground);
  const reported = parseHex(colours.background);
  const base: Rgb = reported[0] === 0 && reported[1] === 0 && reported[2] === 0 ? [BLACK_LIFT, BLACK_LIFT, BLACK_LIFT] : reported;
  /** `from` stepped towards the foreground by `deltaL`, capped at `MAX_STEP_SHARE` of the way in L*. */
  const towardsText = (from: Rgb, deltaL: number): Rgb =>
    stepLightness(from, fg, Math.min(deltaL, MAX_STEP_SHARE * Math.abs(lightness(fg) - lightness(from))));
  // `surface_contrast` scales each fill's step; the cap in `towardsText` still holds.
  const step = (name: keyof typeof SURFACE_STEP_L): Rgb => towardsText(base, SURFACE_STEP_L[name] * contrast);
  const added = parseHex(hues.added ?? DEFAULT_ADDED_HUE);
  const removed = parseHex(hues.removed ?? DEFAULT_REMOVED_HUE);
  const permission = mix(step("surface.permission"), parseHex(PERMISSION_HUE), PERMISSION_WARMTH);
  const user = rounded(step("surface.user"));
  const card = rounded(step("surface.card"));
  const code = rounded(step("surface.code"));
  const highlights = deriveHighlights(base, fg, [user, card, code]);
  const selected = deriveSelected(rounded(permission), fg);
  return {
    "status.bg": toHex(step("status.bg")),
    "surface.card": toHex(card),
    // Overlays sit at the card fill's step (spec tui-theme "Theme tokens, never literal colours").
    "surface.overlay": toHex(card),
    "surface.user": toHex(user),
    "surface.code": toHex(code),
    "surface.cursor": toHex(highlights["surface.cursor"]),
    "surface.cursor.faint": toHex(step("surface.cursor.faint")),
    "surface.selection": toHex(highlights["surface.selection"]),
    "surface.permission": toHex(permission),
    "surface.permission.selected": toHex(selected),
    "diff.added.bg": toHex(mix(base, added, DIFF_MIX)),
    "diff.removed.bg": toHex(mix(base, removed, DIFF_MIX)),
    "find.current": toHex(highlights["find.current"]),
    "find.other": toHex(highlights["find.other"]),
    "scrollbar.track": toHex(step("scrollbar.track")),
    "scrollbar.thumb": toHex(step("scrollbar.thumb")),
  };
}
