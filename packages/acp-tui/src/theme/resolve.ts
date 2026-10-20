// Theme resolver (design D7). OpenTUI 0.5.12 carries a colour intent on every
// RGBA (rgb, indexed, default) and its native renderer emits `38;5;n` / `48;5;n`
// for indexed colours (when the terminal reports 256-colour support) and
// `39` / `49` for default colours, on every row of the screen. So tokens map straight onto `RGBA.fromIndex` and
// `RGBA.defaultForeground` / `defaultBackground`; no palette query is needed.
//
// OpenTUI #1105: renderables with no `fg` fall back to explicit RGB white. The
// resolver therefore always yields an explicit colour for every foreground
// token, and components must always pass one (`text` for plain body text).
import { RGBA, TextAttributes, type TerminalColors } from "@opentui/core";
import { deriveSurfaces, type Hues, type TerminalColours } from "./derive.ts";
import { enforcePermissionDistinct, type ThemeAdjustment } from "./distinct.ts";
import { effectiveStyle, isLightBackground, styleColour, tokenStyle, validateTheme } from "./style.ts";
import { SURFACE_NAMES, TOKENS, TOKEN_NAMES, type ColorValue, type LightStyle, type SurfaceName, type Theme, type TokenName } from "./tokens.ts";

// The pure helpers live in style.ts (no OpenTUI), so the configuration check can use them; they are
// re-exported here for the modules that always took them from the resolver.
export { effectiveStyle, isLightBackground, styleColour, tokenStyle, validateTheme, withTokens } from "./style.ts";

export interface ResolvedToken {
  role: "fg" | "bg";
  color: RGBA;
  attributes: number;
}

export interface TextStyle {
  fg: RGBA;
  attributes: number;
}

export interface ResolvedTheme {
  readonly name: string;
  /** The colours the terminal reported, which choose the light or dark look of the text tokens
   *  (and the surfaces' colours unless `flat`); `null` until the terminal has answered. */
  readonly terminal: TerminalColours | null;
  /**
   * True while the terminal's colours are unknown, when the renderer cannot draw 24-bit colour,
   * or when the flat style is forced (`theme.flat`): `derived` surfaces then take the terminal's
   * default background, and components draw
   * frames and inverse video instead of fills (spec tui-theme "Flat fallback without colour
   * replies"). Without truecolour OpenTUI would map each derived surface to the nearest
   * 256-colour index, where the 4 to 14 per cent steps collapse (S1 bug 3: the selected
   * permission option took the card's own grey).
   */
  readonly flat: boolean;
  token(name: TokenName): ResolvedToken;
  /** Colour of a token, for `fg`, `bg`, `borderColor` or `backgroundColor` props. */
  color(name: TokenName): RGBA;
  /** `{ fg, attributes }` of a foreground token, to spread onto `<text>` or `<span>`. */
  text(name: TokenName): TextStyle;
  /**
   * The terminal's default background as an opaque fill, for a layer drawn on no surface that
   * must still hide what is under it (the palette's overlay over the prompt box, mvp-chrome-and-keys
   * task 12.7): a box without a fill lets the cells below show through its blank cells. Sent as
   * the default-background SGR, never as a colour.
   */
  background(): RGBA;
  /**
   * Surface values replaced by their derived ones so that the permission card stays distinct
   * (spec tui-theme "Permission card distinct under any theme"); empty for the default theme.
   * The configuration reports them as problems.
   */
  readonly adjustments: readonly ThemeAdjustment[];
}

export interface ResolveOptions {
  /**
   * Optional palette snapshot from `renderer.getPalette()`. Only affects the
   * RGB values stored alongside the intent, which OpenTUI uses when blending
   * or when the terminal lacks 256-colour support; the emitted SGR is
   * unchanged on capable terminals.
   */
  palette?: Pick<TerminalColors, "palette" | "defaultForeground" | "defaultBackground">;
  /** The terminal's reported foreground and background; without them `derived` surfaces are flat. */
  terminal?: TerminalColours | null;
  /**
   * Whether the renderer draws 24-bit colour (OpenTUI's `capabilities.rgb`); default true.
   * False keeps the theme flat whatever the terminal's colours.
   */
  truecolour?: boolean;
  /** `surface_contrast`: scales the derived surfaces' steps (derive.ts `DeriveOptions`); default 1. */
  surfaceContrast?: number;
  /**
   * The flat style whatever the terminal answers (`theme.flat`, spec tui-theme "Flat style as a
   * setting"): no derived fills. The reported colours still choose the light or dark look of the
   * text tokens, so forcing the flat style removes fills only and never recolours text (IDE check
   * 12.1: on Zed Ayu Light it turned inline code from the light choice to the dark one).
   */
  forceFlat?: boolean;
}

export function colorToRGBA(color: ColorValue, role: "fg" | "bg", palette?: ResolveOptions["palette"]): RGBA {
  if (color === "default" || color === "derived") {
    const snapshot = role === "fg" ? palette?.defaultForeground : palette?.defaultBackground;
    return role === "fg"
      ? RGBA.defaultForeground(snapshot ?? undefined)
      : RGBA.defaultBackground(snapshot ?? undefined);
  }
  if (typeof color === "number") {
    return RGBA.fromIndex(color, palette?.palette[color] ?? undefined);
  }
  return RGBA.fromHex(color);
}

function attributesOf(style: LightStyle): number {
  let attrs = TextAttributes.NONE;
  if (style.bold) attrs |= TextAttributes.BOLD;
  if (style.dim) attrs |= TextAttributes.DIM;
  if (style.italic) attrs |= TextAttributes.ITALIC;
  if (style.underline) attrs |= TextAttributes.UNDERLINE;
  return attrs;
}

/** The hue behind a diff foreground token, for the diff backgrounds: a hex value or a known palette entry. */
function hueOf(theme: Theme, name: "diff.add" | "diff.remove", palette: ResolveOptions["palette"], light: boolean): string | undefined {
  const color = styleColour(tokenStyle(theme, name), light);
  if (typeof color === "string") return color.startsWith("#") ? color : undefined;
  const entry = palette?.palette[color];
  return typeof entry === "string" && /^#[0-9a-fA-F]{6}$/.test(entry) ? entry : undefined;
}

export function resolveTheme(theme: Theme, options: ResolveOptions = {}): ResolvedTheme {
  const errors = validateTheme(theme);
  if (errors.length > 0) throw new Error(`invalid theme "${theme.name}": ${errors.join("; ")}`);

  const terminal = options.terminal ?? null;
  const flat = options.forceFlat === true || terminal === null || options.truecolour === false;
  // Design decision 10: a token may name another index for light backgrounds, chosen by the
  // reported background (the dark choice while the terminal has not answered).
  const light = isLightBackground(terminal);
  const hues: Hues = { added: hueOf(theme, "diff.add", options.palette, light), removed: hueOf(theme, "diff.remove", options.palette, light) };
  const surfaces: Record<SurfaceName, string> | null = flat ? null : deriveSurfaces(terminal, hues, { contrast: options.surfaceContrast ?? 1 });
  // The permission card's distinctness (design D8): violating surfaces take their derived values.
  const { theme: checked, adjustments } = enforcePermissionDistinct(theme, { surfaces, background: terminal?.background ?? null, light });

  const resolved = new Map<TokenName, ResolvedToken>();
  for (const name of TOKEN_NAMES) {
    const role = TOKENS[name].role;
    const style = effectiveStyle(tokenStyle(checked, name), light);
    const value = style.color;
    // A `derived` surface is a truecolour fill once the terminal's colours are known (and the
    // renderer draws truecolour), and the terminal's default background otherwise.
    const surface = (SURFACE_NAMES as readonly string[]).includes(name) ? (name as SurfaceName) : null;
    const color =
      value === "derived" && surfaces && surface
        ? RGBA.fromHex(surfaces[surface])
        : colorToRGBA(value, role, options.palette);
    resolved.set(name, { role, color, attributes: attributesOf(style) });
  }

  const token = (name: TokenName): ResolvedToken => {
    const t = resolved.get(name);
    if (!t) throw new Error(`unknown theme token "${name}"`);
    return t;
  };

  return {
    name: theme.name,
    terminal,
    flat,
    token,
    color: (name) => token(name).color,
    text: (name) => {
      const t = token(name);
      if (t.role !== "fg") throw new Error(`theme token "${name}" is a background token`);
      return { fg: t.color, attributes: t.attributes };
    },
    background: () => colorToRGBA("default", "bg", options.palette),
    adjustments,
  };
}

/** What `<span style={...}>` understands in @opentui/solid 0.5.12. */
export interface SpanStyle {
  fg: RGBA;
  bg?: RGBA;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
}

/**
 * A text style for a `<span>`. @opentui/solid 0.5.12 builds a span's attributes from the
 * `style` object's flags (`bold`, `inverse`, ...) through `createTextAttributes`; an
 * `attributes` bitmask, which `<text>` accepts, is ignored there. So a span given
 * `{ fg, attributes: INVERSE }` is drawn without inverse video (S1: the flat theme's selected
 * permission option could not be seen). Spread `theme.text(token)` onto `<text>`, but pass spans
 * through this.
 */
export function spanStyle(style: { fg: RGBA; bg?: RGBA; attributes: number }): SpanStyle {
  const has = (flag: number) => (style.attributes & flag) !== 0;
  return {
    fg: style.fg,
    ...(style.bg ? { bg: style.bg } : {}),
    bold: has(TextAttributes.BOLD),
    dim: has(TextAttributes.DIM),
    italic: has(TextAttributes.ITALIC),
    underline: has(TextAttributes.UNDERLINE),
    inverse: has(TextAttributes.INVERSE),
  };
}
