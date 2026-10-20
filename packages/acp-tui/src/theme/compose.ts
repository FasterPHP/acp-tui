// Composing the theme in use (mvp-configuration design D7; spec tui-theme "Theme files"): the
// built-in default, then each file of the `extends` chain from its root (its `tokens`, then its
// `light` or `dark` section by the reported background), then the configuration's inline
// `theme.tokens`, last. Plain data, no OpenTUI: the live theme (live.ts) composes on every change of
// the terminal's colours, and `config --check` composes once per recorded palette.
//
// A token's value replaces what it overrides the way a stylesheet property does: a bare colour sets
// the colour and keeps the attributes; a style sets the attributes it names and its colour, when it
// gives one. Either way a colour of its own drops the default theme's light-background alternative
// (`TokenStyle.light`), since the theme chose the colour; a style without a colour keeps it.
import { DEFAULT_THEME } from "./default-theme.ts";
import { clampContrast, lightness, parseHex, type TerminalColours } from "./derive.ts";
import { tokenStyle } from "./style.ts";
import type { ThemeLayer, ThemeSpec, TokenOrigin, TokenOverride, TokenOverrides } from "./theme-file.ts";
import type { Theme, TokenName, TokenStyle, TokenValue } from "./tokens.ts";

/** Which section of a theme applies: by the reported background, or neither without a reply. */
export type Background = "light" | "dark" | null;

/** A background whose CIE L* is at least this is light (design D7). */
export const LIGHT_BACKGROUND_L = 50;

/** The section the terminal's reported colours choose (null: no reply, neither section). */
export function backgroundOf(terminal: TerminalColours | null | undefined): Background {
  if (!terminal) return null;
  return lightness(parseHex(terminal.background)) >= LIGHT_BACKGROUND_L ? "light" : "dark";
}

/** The configuration's own part of the theme: `theme.tokens` and `theme.surface_contrast`. */
export interface InlineTheme {
  readonly tokens: TokenOverrides;
  readonly surfaceContrast?: number | undefined;
  /** Where each inline token was written (for problems found later). */
  readonly origins?: Readonly<Partial<Record<TokenName, TokenOrigin>>>;
}

/** A theme composed for one background. */
export interface ComposedTheme {
  readonly theme: Theme;
  /** The configuration's `surface_contrast` times the nearest file's in the chain (each default 1), within 0.5 to 2. */
  readonly surfaceContrast: number;
  /** Where the value in use of each overridden token was written. */
  readonly origins: Readonly<Partial<Record<TokenName, TokenOrigin>>>;
}

/** What the live theme draws from: a theme for each background. */
export interface ThemeSource {
  readonly name: string;
  compose(background: Background): ComposedTheme;
}

const ATTRIBUTES = ["bold", "dim", "italic", "underline"] as const;

/** `value` over `base`, as the header says. */
export function applyOverride(base: TokenStyle, value: TokenOverride): TokenStyle {
  const given = typeof value === "object" ? value : { color: value };
  const attributes: Partial<Record<(typeof ATTRIBUTES)[number], boolean>> = {};
  for (const name of ATTRIBUTES) if (given[name] !== undefined) attributes[name] = given[name];
  const { light, ...own } = base;
  if (given.color !== undefined) return { ...own, ...attributes, color: given.color };
  const keptLight = light === undefined ? undefined : typeof light === "object" ? { ...light, ...attributes } : light;
  return { ...own, ...attributes, ...(keptLight === undefined ? {} : { light: keptLight }) };
}

/** `overrides` applied to `tokens` in place (each over the token's current style). */
function applyAll(theme: Theme, overrides: TokenOverrides, origins: Partial<Record<TokenName, TokenOrigin>>, from?: Readonly<Partial<Record<TokenName, TokenOrigin>>>): void {
  const tokens = theme.tokens as Record<TokenName, TokenValue>;
  for (const [name, value] of Object.entries(overrides) as [TokenName, TokenOverride][]) {
    tokens[name] = applyOverride(tokenStyle(theme, name), value);
    const origin = from?.[name];
    if (origin) origins[name] = origin;
  }
}

/** The theme `spec` with `inline` on top, for `background`. */
export function composeTheme(spec: ThemeSpec, inline: InlineTheme, background: Background, base: Theme = DEFAULT_THEME): ComposedTheme {
  const theme: Theme = { name: spec.name, tokens: { ...base.tokens } };
  const origins: Partial<Record<TokenName, TokenOrigin>> = {};
  let fileContrast: number | null = null;
  for (const layer of spec.layers as ThemeLayer[]) {
    applyAll(theme, layer.tokens, origins, layer.origins.tokens);
    if (background !== null) applyAll(theme, layer[background], origins, layer.origins[background]);
    if (layer.surfaceContrast !== null) fileContrast = layer.surfaceContrast;
  }
  applyAll(theme, inline.tokens, origins, inline.origins);
  // Both scale the steps: the configuration's (default 1) times the nearest file's in the chain.
  return { theme, surfaceContrast: clampContrast((inline.surfaceContrast ?? 1) * (fileContrast ?? 1)), origins };
}

/** A source over a spec and the inline part. */
export function themeSource(spec: ThemeSpec, inline: InlineTheme): ThemeSource {
  return { name: spec.name, compose: (background) => composeTheme(spec, inline, background) };
}

/** A source that is one fixed theme on every background (tests, and the app before configuration). */
export function fixedThemeSource(theme: Theme, surfaceContrast = 1): ThemeSource {
  return { name: theme.name, compose: () => ({ theme, surfaceContrast, origins: {} }) };
}
