// Token styles as plain data (design D7): following references, choosing the light-background
// look, and validating a theme's token table. No OpenTUI here, so the configuration check
// (`config --check`, run before the app is imported) can resolve a user's theme to colours
// without loading the renderer; resolve.ts turns these styles into OpenTUI colours.
import { lightness, parseHex, type TerminalColours } from "./derive.ts";
import { SURFACE_NAMES, TOKENS, TOKEN_NAMES, type ColorValue, type LightStyle, type Theme, type TokenName, type TokenRef, type TokenStyle, type TokenValue } from "./tokens.ts";

export function isRef(value: TokenValue | undefined): value is TokenRef {
  return typeof value === "object" && "ref" in value;
}

/**
 * The style a theme gives a token, following references (`{ ref: "tool.kind" }`) to the token
 * they name. Throws on a reference cycle or to a missing token; `validateTheme` reports both.
 */
export function tokenStyle(theme: Theme, name: TokenName): TokenStyle {
  const seen = new Set<string>();
  let current: string = name;
  for (;;) {
    if (seen.has(current)) throw new Error(`theme "${theme.name}": reference cycle at token "${current}"`);
    seen.add(current);
    const value = (theme.tokens as Record<string, TokenValue | undefined>)[current];
    if (value === undefined) throw new Error(`theme "${theme.name}": token "${current}" has no value`);
    if (!isRef(value)) return typeof value === "object" ? value : { color: value };
    current = value.ref;
  }
}

/** A style as drawn on a light or a dark background: on a light one, `light` replaces the colour
 *  (a bare colour) or the whole style (a style); otherwise the style itself. */
export function effectiveStyle(style: TokenStyle, lightBackground: boolean): LightStyle {
  const { light, ...own } = style;
  if (!lightBackground || light === undefined) return own;
  return typeof light === "object" ? light : { ...own, color: light };
}

/** The colour of a style on a light or a dark background (`light` when given and the background is light). */
export function styleColour(style: TokenStyle, lightBackground: boolean): ColorValue {
  return effectiveStyle(style, lightBackground).color;
}

/** Whether the terminal reported a background lighter than its foreground. */
export function isLightBackground(terminal: TerminalColours | null | undefined): boolean {
  return terminal ? lightness(parseHex(terminal.background)) > lightness(parseHex(terminal.foreground)) : false;
}

/** Returns a list of problems; empty when the theme is usable. */
export function validateTheme(theme: Theme): string[] {
  const errors: string[] = [];
  const tokens = theme.tokens as Record<string, TokenValue | undefined>;
  for (const name of TOKEN_NAMES) {
    if (tokens[name] === undefined) errors.push(`missing token "${name}"`);
  }
  for (const [name, value] of Object.entries(tokens)) {
    if (!(name in TOKENS)) {
      errors.push(`unknown token "${name}"`);
      continue;
    }
    if (value === undefined) continue;
    if (isRef(value)) {
      const target = value.ref as string;
      if (!(target in TOKENS)) errors.push(`token "${name}": refers to unknown token "${target}"`);
      else if (TOKENS[target as TokenName].role !== TOKENS[name as TokenName].role) {
        errors.push(`token "${name}": refers to "${target}", a ${TOKENS[target as TokenName].role === "fg" ? "text" : "background"} token`);
      } else {
        try {
          tokenStyle(theme, name as TokenName);
        } catch (e) {
          errors.push(`token "${name}": ${(e as Error).message.replace(/^theme "[^"]*": /, "")}`);
        }
      }
      continue;
    }
    const style = typeof value === "object" ? value : { color: value };
    const light = typeof style.light === "object" ? style.light.color : style.light;
    for (const color of light === undefined ? [style.color] : [style.color, light]) {
      if (typeof color === "number") {
        if (!Number.isInteger(color) || color < 0 || color > 255) {
          errors.push(`token "${name}": palette index must be an integer from 0 to 255, got ${color}`);
        }
      } else if (color === "derived") {
        if (!(SURFACE_NAMES as readonly string[]).includes(name)) {
          errors.push(`token "${name}": "derived" is only valid for surface tokens`);
        }
      } else if (color !== "default" && !/^#[0-9a-fA-F]{6}$/.test(color)) {
        errors.push(`token "${name}": expected an index, "default", "derived" or #rrggbb, got "${color}"`);
      }
    }
  }
  return errors;
}

/** Returns a copy of `theme` with some tokens replaced. */
export function withTokens(theme: Theme, overrides: Partial<Record<TokenName, TokenValue>>, name?: string): Theme {
  return { name: name ?? theme.name, tokens: { ...theme.tokens, ...overrides } };
}
