// The permission card stays distinct under any theme (mvp-configuration design D8, spec tui-theme
// "Permission card distinct under any theme"): its fill is never `default`, no other surface of the
// catalogue resolves within 3 L* of it, and its selected option differs from it. A violating value
// is replaced by the derived one and reported, so a theme can recolour the card but never make it a
// fill agent text can sit on.
//
// What is compared: a pinned `#rrggbb`, a `derived` surface once the surfaces are derived (null
// while flat or before the terminal answers), `default` as the terminal's reported background, and
// two equal ANSI indices as the same colour (an index's colour is otherwise unknown, since nothing
// queries OSC 4). Pinned values can therefore be checked at load, without a terminal, and the rest
// when the surfaces are derived.
//
// Two derived surfaces are not compared: replacing a value by the derived one cannot separate them,
// and the default derivation is tuned elsewhere (derive.ts, the IDE checks). Plain data, no OpenTUI.
import { lightness, parseHex } from "./derive.ts";
import { styleColour, tokenStyle } from "./style.ts";
import { SURFACE_NAMES, type ColorValue, type SurfaceName, type Theme, type TokenValue } from "./tokens.ts";

/** No surface but the selected option may resolve within this many L* of the permission card. */
export const PERMISSION_MIN_SEPARATION_L = 3;

/** A token replaced by its derived value, and why. */
export interface ThemeAdjustment {
  readonly token: SurfaceName;
  readonly message: string;
}

export interface DistinctContext {
  /** The derived surfaces, or null while the theme is flat. */
  readonly surfaces: Readonly<Record<SurfaceName, string>> | null;
  /** The terminal's reported background (what `default` draws), or null when unknown. */
  readonly background: string | null;
  /** Whether a token's light-background look applies. */
  readonly light: boolean;
}

const PERMISSION = "surface.permission";
const SELECTED = "surface.permission.selected";

/** A colour as compared: a hex value, an index, or unknown. */
type Resolved = { hex: string } | { index: number } | null;

function resolveColour(name: SurfaceName, value: ColorValue, ctx: DistinctContext): Resolved {
  if (value === "derived") return ctx.surfaces ? { hex: ctx.surfaces[name] } : null;
  if (value === "default") return ctx.background ? { hex: ctx.background } : null;
  if (typeof value === "number") return { index: value };
  return { hex: value.toLowerCase() };
}

function tooClose(a: Resolved, b: Resolved, minL: number): boolean {
  if (!a || !b) return false;
  if ("index" in a || "index" in b) return "index" in a && "index" in b && a.index === b.index;
  return Math.abs(lightness(parseHex(a.hex)) - lightness(parseHex(b.hex))) < minL;
}

const describe = (value: ColorValue): string => (typeof value === "number" ? `ANSI colour ${value}` : value === "default" || value === "derived" ? `"${value}"` : value);

/**
 * The theme with every violating surface replaced by `derived`, and what was replaced. Order: a
 * `default` card fill first; then each other surface too close to the card (a pinned one takes its
 * derived value; if it is derived, or still too close once derived, the card takes its derived fill
 * instead); then the selected option.
 */
export function enforcePermissionDistinct(theme: Theme, ctx: DistinctContext): { theme: Theme; adjustments: ThemeAdjustment[] } {
  const tokens = { ...theme.tokens } as Record<string, TokenValue>;
  const adjustments: ThemeAdjustment[] = [];
  const current = { name: theme.name, tokens } as Theme;
  const value = (name: SurfaceName): ColorValue => styleColour(tokenStyle(current, name), ctx.light);
  const derive = (name: SurfaceName, message: string) => {
    tokens[name] = "derived";
    adjustments.push({ token: name, message });
  };

  if (value(PERMISSION) === "default") {
    derive(PERMISSION, `cannot be "default": the permission card keeps a fill of its own, so it is derived instead`);
  }

  const others = SURFACE_NAMES.filter((n) => n !== PERMISSION && n !== SELECTED);
  // Two passes at most: once the card falls back to its derived fill, pinned surfaces are checked
  // against that.
  for (let pass = 0; pass < 2; pass++) {
    let cardChanged = false;
    for (const name of others) {
      const card = value(PERMISSION);
      const other = value(name);
      if (other === "derived" && card === "derived") continue;
      if (!tooClose(resolveColour(PERMISSION, card, ctx), resolveColour(name, other, ctx), PERMISSION_MIN_SEPARATION_L)) continue;
      if (other !== "derived") {
        derive(
          name,
          `(${describe(other)}) is within ${PERMISSION_MIN_SEPARATION_L} L* of surface.permission, so text on it could pass for the permission card; it is derived instead`,
        );
        if (!tooClose(resolveColour(PERMISSION, value(PERMISSION), ctx), resolveColour(name, "derived", ctx), PERMISSION_MIN_SEPARATION_L)) continue;
      }
      if (value(PERMISSION) !== "derived") {
        derive(PERMISSION, `(${describe(value(PERMISSION))}) is within ${PERMISSION_MIN_SEPARATION_L} L* of ${name}, so text on ${name} could pass for the permission card; it is derived instead`);
        cardChanged = true;
      }
    }
    if (!cardChanged) break;
  }

  const selected = value(SELECTED);
  if (selected !== "derived") {
    const a = resolveColour(SELECTED, selected, ctx);
    const b = resolveColour(PERMISSION, value(PERMISSION), ctx);
    const same = a && b && ("index" in a ? "index" in b && a.index === b.index : "hex" in b && a.hex === b.hex);
    if (same) derive(SELECTED, `(${describe(selected)}) is the permission card's own fill, so the selected option would not show; it is derived instead`);
  }
  return { theme: current, adjustments };
}
