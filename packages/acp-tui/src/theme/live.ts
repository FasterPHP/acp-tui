// The theme the running app draws with (design D8). It is a `ResolvedTheme` whose
// answers come from a Solid signal, so a JSX expression such as
// `{...theme.text("accent")}` or `backgroundColor={theme.color("surface.card")}` is
// tracked: `setTerminalColours` re-derives the surfaces and every reader updates.
//
// Since mvp-configuration (design D7) it draws from a `ThemeSource`: the configured theme, composed
// for the background the terminal reports (its `light` or `dark` section, by CIE L*), with its
// `surface_contrast`. `setSource` swaps the theme on a configuration reload; the section is chosen
// again whenever the colours are re-queried (resize settle, Ctrl+L, SIGUSR2, DEC 997).
import { createSignal } from "solid-js";
import { backgroundOf, fixedThemeSource, type ComposedTheme, type ThemeSource } from "./compose.ts";
import type { TerminalColours } from "./derive.ts";
import { resolveTheme, type ResolveOptions, type ResolvedTheme } from "./resolve.ts";
import type { Theme } from "./tokens.ts";

export interface LiveTheme extends ResolvedTheme {
  /**
   * Re-derives the surfaces from the terminal's colours (`null` returns to the flat fallback), and
   * chooses the light or dark look (the default theme's light-background indices, a theme's
   * `light` or `dark` section) by them, also while the flat style is forced. Returns false, and
   * notifies no reader, when the colours are the ones already in use.
   */
  setTerminalColours(colours: TerminalColours | null): boolean;
  /**
   * Whether the renderer draws 24-bit colour (OpenTUI's `capabilities.rgb`, which a capability
   * reply can turn on after start-up). False keeps the flat fallback, so a selection drawn as a
   * fill never collapses into the card's colour. Returns false, notifying no reader, when
   * nothing changed.
   */
  setTruecolour(truecolour: boolean): boolean;
  /**
   * Forces the flat style whatever the terminal answers (`theme.flat`, spec tui-theme "Flat style
   * as a setting"), or leaves it to the terminal's replies again, at once: a configuration reload
   * calls it (mvp-configuration task 3.2). Returns false, notifying no reader, when nothing changed.
   */
  setForceFlat(forced: boolean): boolean;
  /**
   * Draws from another theme (a configuration reload: another theme name, an edited theme file or
   * inline tokens), composed for the background in use. Always notifies the readers, so the styles
   * built from the theme are rebuilt; returns true.
   */
  setSource(source: ThemeSource): boolean;
  /** The theme as composed for the background in use (its tokens, contrast and their origins). */
  readonly composed: ComposedTheme;
  /** Called after every change of the resolved theme (not at creation). */
  onChange(listener: (theme: ResolvedTheme) => void): () => void;
}

export interface LiveThemeOptions extends Omit<ResolveOptions, "terminal" | "surfaceContrast"> {
  /**
   * Keeps the theme on the flat fallback whatever the terminal answers: no derived fills
   * (`theme.flat`). The colours the terminal reports still choose the light or dark look (the
   * default theme's light-background indices, a theme's `light` or `dark` section), so forcing the
   * flat style recolours no text (spec tui-theme "Flat style as a setting"; IDE check 12.1), and
   * `setForceFlat(false)` derives the surfaces from them at once.
   */
  forceFlat?: boolean;
}

export function createLiveTheme(theme: Theme | ThemeSource, options: LiveThemeOptions = {}): LiveTheme {
  const { forceFlat = false, ...rest } = options;
  const resolveOptions: ResolveOptions = { ...rest };
  let source: ThemeSource = "compose" in theme ? theme : fixedThemeSource(theme);
  let forced = forceFlat;
  // The terminal's colours as last reported (used for the light or dark look while the flat style
  // is forced, and for the surfaces once it no longer is).
  let reported: TerminalColours | null = null;
  let composed = source.compose(null);
  const listeners = new Set<(theme: ResolvedTheme) => void>();
  const resolveNow = () => {
    composed = source.compose(backgroundOf(reported));
    return resolveTheme(composed.theme, { ...resolveOptions, terminal: reported, forceFlat: forced, surfaceContrast: composed.surfaceContrast });
  };
  const [current, setCurrent] = createSignal(resolveTheme(composed.theme, { ...resolveOptions, forceFlat: forced, surfaceContrast: composed.surfaceContrast }));
  const update = () => {
    const next = resolveNow();
    setCurrent(() => next);
    for (const listener of [...listeners]) listener(next);
  };
  return {
    get name() {
      return current().name;
    },
    get terminal() {
      return current().terminal;
    },
    get flat() {
      return current().flat;
    },
    get adjustments() {
      return current().adjustments;
    },
    get composed() {
      current();
      return composed;
    },
    token: (name) => current().token(name),
    color: (name) => current().color(name),
    text: (name) => current().text(name),
    background: () => current().background(),
    setTerminalColours(colours) {
      if (reported?.foreground === colours?.foreground && reported?.background === colours?.background) return false;
      reported = colours;
      update();
      return true;
    },
    setTruecolour(truecolour) {
      if ((resolveOptions.truecolour ?? true) === truecolour) return false;
      resolveOptions.truecolour = truecolour;
      if (forced) return false;
      update();
      return true;
    },
    setForceFlat(next) {
      if (next === forced) return false;
      forced = next;
      update();
      return true;
    },
    setSource(next) {
      source = next;
      update();
      return true;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
