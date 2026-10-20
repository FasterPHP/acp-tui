// The theme from the configuration (mvp-configuration design D6 to D8, tasks 5.1 to 5.6): the
// `theme` section (name, flat, surface_contrast, inline tokens) and the theme files it names become
// the live theme's source, and every theme problem (a theme file's, and a surface replaced so the
// permission card stays distinct) goes to the configuration store under the channel `theme`, with
// the file, line and column it was written at.
//
// `createConfiguredTheme` is what `app/run.tsx` wires: load at start-up, `attach` the live theme
// (its adjustments follow the terminal's colours), `reload` on every configuration reload (a theme
// file changes without the `theme` section changing). `checkTheme` and `themeLegibilityWarnings`
// are what `acp-tui config --check` reports. No OpenTUI and no Solid here.
import { findNodeAtLocation, parseTree, type Node } from "jsonc-parser";
import { lineStarts, position } from "../config/load.ts";
import type { ConfigProblem } from "../config/problems.ts";
import type { Config, ThemeConfig } from "../config/schema.ts";
import { readConfigFile, type FileRead } from "../config/sources.ts";
import { backgroundOf, themeSource, type Background, type ComposedTheme, type InlineTheme, type ThemeSource } from "./compose.ts";
import { DEFAULT_THEME } from "./default-theme.ts";
import { enforcePermissionDistinct, type ThemeAdjustment } from "./distinct.ts";
import { drawnColour, legibilityShortfalls, shortfallMessage, surfaceShortfalls, type LegibilityShortfall } from "./legibility.ts";
import { RECORDED_PALETTES, type RecordedPalette } from "./palettes.fixture.ts";
import { isRef } from "./style.ts";
import { loadThemeSpec, themeFile, BUILT_IN_THEME, type ThemeSpec, type TokenOrigin, type TokenOverrides } from "./theme-file.ts";
import type { Theme, TokenName } from "./tokens.ts";

/** The store channel theme problems are reported under. */
export const THEME_PROBLEMS = "theme";

export interface ThemeFiles {
  /** The themes directory (`themes/` beside `config.jsonc`). */
  readonly themes: string;
  /** The user's configuration file and the project file in use (where inline tokens are written). */
  readonly user: string;
  readonly project: string | null;
}

export interface ThemeReadOptions {
  /** Reads a file; default `readConfigFile`. */
  readonly read?: (path: string) => FileRead;
}

/** Where each inline `theme.tokens` entry is written: the project file's over the user's. */
export function inlineTokenOrigins(files: ThemeFiles, tokens: readonly string[], options: ThemeReadOptions = {}): Partial<Record<TokenName, TokenOrigin>> {
  const read = options.read ?? ((path: string) => readConfigFile(path));
  const origins: Partial<Record<TokenName, TokenOrigin>> = {};
  if (tokens.length === 0) return origins;
  for (const file of [files.user, files.project]) {
    if (file === null) continue;
    const text = read(file).text;
    if (text === null) continue;
    const root = parseTree(text, [], { allowTrailingComma: true, disallowComments: false, allowEmptyContent: true });
    if (!root) continue;
    const starts = lineStarts(text);
    for (const name of tokens) {
      const node: Node | undefined = findNodeAtLocation(root, ["theme", "tokens", name]);
      if (node) origins[name as TokenName] = { file, ...position(starts, node.offset), path: `theme.tokens.${name}` };
    }
  }
  return origins;
}

/** The inline part of a `theme` section. */
function inlineOf(theme: ThemeConfig, files: ThemeFiles, options: ThemeReadOptions): InlineTheme {
  const tokens = theme.tokens as unknown as TokenOverrides;
  return { tokens, surfaceContrast: theme.surface_contrast, origins: inlineTokenOrigins(files, Object.keys(tokens), options) };
}

export interface ConfiguredThemeLoad {
  /** The source to draw from, or null to keep the previous one (a missing file, a cycle). */
  readonly source: ThemeSource | null;
  readonly spec: ThemeSpec | null;
  readonly inline: InlineTheme;
  /** The theme files' problems. */
  readonly problems: readonly ConfigProblem[];
}

/** The theme a `theme` section asks for, from the themes directory. Never throws. */
export function loadConfiguredTheme(theme: ThemeConfig, files: ThemeFiles, options: ThemeReadOptions = {}): ConfiguredThemeLoad {
  const read = options.read ?? ((path: string) => readConfigFile(path));
  const { spec, problems } = loadThemeSpec(theme.name, { themesDir: files.themes, read });
  const inline = inlineOf(theme, files, options);
  return { source: spec ? themeSource(spec, inline) : null, spec, inline, problems };
}

/** The origin of a token's value in a composed theme, following references (`tool.kind.read` to
 *  `tool.kind`); null for a value the theme does not set. */
function originOf(composed: ComposedTheme, name: TokenName): TokenOrigin | null {
  const seen = new Set<string>();
  let current: TokenName = name;
  while (!seen.has(current)) {
    seen.add(current);
    const origin = composed.origins[current];
    if (origin) return origin;
    const value = composed.theme.tokens[current];
    if (!isRef(value)) return null;
    current = value.ref;
  }
  return null;
}

/** A problem at a token's origin (or at the theme file, else the user's file, at 1:1). */
function atToken(composed: ComposedTheme, name: TokenName, files: ThemeFiles, themeName: string, severity: ConfigProblem["severity"], message: string): ConfigProblem {
  const origin = originOf(composed, name);
  if (origin) return { file: origin.file, line: origin.line, column: origin.column, path: origin.path, severity, message };
  const file = themeName === BUILT_IN_THEME ? files.user : themeFile(files.themes, themeName);
  return { file, line: 1, column: 1, path: `tokens.${name}`, severity, message };
}

/** The adjustments of a resolved theme as problems. */
export function adjustmentProblems(adjustments: readonly ThemeAdjustment[], composed: ComposedTheme, files: ThemeFiles, themeName: string): ConfigProblem[] {
  return adjustments.map((a) => atToken(composed, a.token, files, themeName, "error", a.message));
}

export interface LiveThemeLike {
  readonly adjustments: readonly ThemeAdjustment[];
  readonly composed: ComposedTheme;
  setSource(source: ThemeSource): boolean;
  setForceFlat(forced: boolean): boolean;
  onChange(listener: () => void): () => void;
}

export interface ConfigStoreLike {
  config(): Config;
  files(): { readonly user: string; readonly project: string | null; readonly themes: string };
  setProblems(channel: string, problems: readonly ConfigProblem[]): void;
}

export interface ConfiguredTheme {
  /** The source at start-up (the default theme when the configured one cannot be used). */
  readonly source: ThemeSource;
  /** Whether the flat style is forced now (`theme.flat`). */
  flat(): boolean;
  /** Reports the live theme's adjustments as they change; returns the unsubscribe. */
  attach(theme: LiveThemeLike): () => void;
  /** After a configuration reload: reads the theme files again and applies what changed (the
   *  source, the flat style). True when the live theme changed (repaint). */
  reload(): boolean;
}

export type ConfiguredThemeOptions = ThemeReadOptions;

export function createConfiguredTheme(store: ConfigStoreLike, options: ConfiguredThemeOptions = {}): ConfiguredTheme {
  const flat = (): boolean => store.config().theme.flat;
  let fileProblems: readonly ConfigProblem[] = [];
  let source: ThemeSource = themeSource({ name: BUILT_IN_THEME, layers: [] }, { tokens: {} });
  let key = "";
  let live: LiveThemeLike | null = null;
  let published = "";

  const publish = () => {
    const files = store.files();
    const name = store.config().theme.name;
    const problems = [...fileProblems, ...(live ? adjustmentProblems(live.adjustments, live.composed, files, name) : [])];
    const next = JSON.stringify(problems);
    if (next === published) return;
    published = next;
    store.setProblems(THEME_PROBLEMS, problems);
  };

  /** Loads the configured theme; true when the source changed. */
  const load = (): boolean => {
    const loaded = loadConfiguredTheme(store.config().theme, store.files(), options);
    fileProblems = loaded.problems;
    if (!loaded.source) return false;
    const nextKey = JSON.stringify([loaded.spec, loaded.inline]);
    if (nextKey === key) return false;
    key = nextKey;
    source = loaded.source;
    return true;
  };

  load();
  publish();
  return {
    get source() {
      return source;
    },
    flat,
    attach(theme) {
      live = theme;
      publish();
      const stop = theme.onChange(publish);
      return () => {
        stop();
        live = null;
      };
    },
    reload() {
      const changed = load();
      let repaint = false;
      if (live) {
        // A flat switch first, so a new source is resolved once with the right style.
        repaint = live.setForceFlat(flat()) || repaint;
        if (changed) repaint = live.setSource(source) || repaint;
      }
      publish();
      return repaint;
    },
  };
}

// -- config --check (task 9.1 wires these) ---------------------------------------------------------

export interface ThemeCheckOptions extends ThemeReadOptions {
  /** The palettes to measure against; default the recorded ones. */
  readonly palettes?: readonly RecordedPalette[];
}

/** The palette's background as the section chooser sees it. */
const paletteBackground = (palette: RecordedPalette): Background => backgroundOf(palette);

/**
 * Legibility warnings for the theme in use (spec tui-theme "Legibility report for user themes"):
 * the theme composed for each recorded palette's background, every text token it changes from the
 * default theme that falls below its floor there (3:1, 2:1 for the muted tokens), and every surface
 * it pins to a `#rrggbb` that leaves the palette's default foreground under 4.5:1. Each warning
 * names the token, the palette and the ratio, at the token's place in its file. Warnings only:
 * the theme is not rejected. Empty when the configured theme cannot be loaded (`checkTheme`
 * reports that).
 */
export function themeLegibilityWarnings(config: Config, files: ThemeFiles, options: ThemeCheckOptions = {}): ConfigProblem[] {
  const loaded = loadConfiguredTheme(config.theme, files, options);
  if (!loaded.source) return [];
  const out: ConfigProblem[] = [];
  for (const palette of options.palettes ?? RECORDED_PALETTES) {
    const composed = loaded.source.compose(paletteBackground(palette));
    const changed = (s: LegibilityShortfall) => s.kind === "surface" || drawnColour(composed.theme, s.token, palette) !== drawnColour(DEFAULT_THEME, s.token, palette);
    const shortfalls = [...legibilityShortfalls(composed.theme, [palette], new Map()), ...surfaceShortfalls(composed.theme, [palette])].filter(changed);
    for (const s of shortfalls) out.push(atToken(composed, s.token, files, config.theme.name, "warning", shortfallMessage(s)));
  }
  return out;
}

/**
 * Every theme problem `config --check` reports: the theme files' (errors reject a token, or keep
 * the previous theme), surfaces pinned too close to the permission card (checked without a
 * terminal: pinned values only), and the legibility warnings.
 */
export function checkTheme(config: Config, files: ThemeFiles, options: ThemeCheckOptions = {}): ConfigProblem[] {
  const loaded = loadConfiguredTheme(config.theme, files, options);
  const problems: ConfigProblem[] = [...loaded.problems];
  if (loaded.source) {
    const seen = new Set<string>();
    for (const background of [null, "dark", "light"] as const) {
      const composed = loaded.source.compose(background);
      const { adjustments } = enforcePermissionDistinct(composed.theme as Theme, { surfaces: null, background: null, light: background === "light" });
      for (const p of adjustmentProblems(adjustments, composed, files, config.theme.name)) {
        const id = `${p.file}:${p.line}:${p.column}:${p.message}`;
        if (!seen.has(id)) problems.push(p);
        seen.add(id);
      }
    }
  }
  return [...problems, ...themeLegibilityWarnings(config, files, options)];
}
