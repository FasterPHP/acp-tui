// Theme files (mvp-configuration design D7; spec tui-theme "Theme files", "Token values in a theme"
// and "Theme validation"): `themes/<name>.jsonc` beside the configuration file, holding `tokens`,
// optional `light` and `dark` token sections, an optional `extends` naming another theme and an
// optional `surface_contrast`.
//
// A theme file is checked token by token: an unknown name (with the closest known one), a retired
// name (with its replacement), a value of the wrong kind (such as `derived` for a text token) or an
// attribute outside the safe set is a problem with the file's line and column, and that token alone
// is left out, so it keeps the value it would otherwise have. A file that does not parse, an
// `extends` cycle or a theme name with no file leaves no theme (`spec: null`): the caller keeps the
// previous theme in use. Problems use the configuration's `ConfigProblem`, so they reach the store
// (`setProblems("theme", ...)`), the notice and `config --check` like any other.
//
// No OpenTUI and no Solid here: `config --check` runs it before the app is imported.
import { join } from "node:path";
import { parseTree, printParseErrorCode, type Node, type ParseError } from "jsonc-parser";
import { lineStarts, Loader, position, properties, valueOf } from "../config/load.ts";
import { suggest, type ConfigProblem } from "../config/problems.ts";
import { THEME_NAME_PATTERN, ThemeFileSchema, tokenNameProblem, tokenValueSchema } from "../config/schema.ts";
import type { FileRead } from "../config/sources.ts";
import { RETIRED_TOKENS, TOKEN_NAMES, type ColorValue, type TokenName } from "./tokens.ts";

/** The built-in theme's name: the root of every `extends` chain, never read from a file. */
export const BUILT_IN_THEME = "default";

/** A token's value as a theme or the configuration writes it (validated). */
export type TokenOverride = ColorValue | { color?: ColorValue; bold?: boolean; dim?: boolean; italic?: boolean; underline?: boolean };
export type TokenOverrides = Partial<Record<TokenName, TokenOverride>>;

/** Where a token's value was written: for problems found later (distinctness, legibility). */
export interface TokenOrigin {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  /** The setting's path in that file (`tokens.accent`, `light.tokens.tool.duration`, `theme.tokens.accent`). */
  readonly path: string;
}

/** One theme file, validated. */
export interface ThemeLayer {
  readonly name: string;
  readonly file: string;
  /** The theme it extends; `default` (the built-in) when it names none. */
  readonly extends: string;
  /** Where `extends` is written, for a problem about the theme it names. */
  readonly extendsAt: { readonly line: number; readonly column: number } | null;
  readonly surfaceContrast: number | null;
  readonly tokens: TokenOverrides;
  readonly light: TokenOverrides;
  readonly dark: TokenOverrides;
  /** Per section (`tokens`, `light`, `dark`), where each accepted token was written. */
  readonly origins: Readonly<Record<"tokens" | "light" | "dark", Readonly<Partial<Record<TokenName, TokenOrigin>>>>>;
}

/** A theme as chosen: the built-in default, then its files from the root of the chain to the theme
 *  itself. */
export interface ThemeSpec {
  readonly name: string;
  readonly layers: readonly ThemeLayer[];
}

const FILE_KEYS = ["$schema", "extends", "surface_contrast", "tokens", "light", "dark"] as const;
const shape = (ThemeFileSchema as unknown as { shape: Record<string, unknown> }).shape;

/** The theme file of `name` in `themesDir`. */
export function themeFile(themesDir: string, name: string): string {
  return join(themesDir, `${name}.jsonc`);
}

/**
 * One theme file's text, validated (`text` null: there is no such file). Never throws. `layer` is
 * null when the file cannot be used at all (missing, not JSONC, not an object, an invalid
 * `extends`), and the previous theme then stays in use.
 */
export function parseThemeFile(text: string | null, file: string, name: string): { layer: ThemeLayer | null; problems: ConfigProblem[] } {
  if (text === null) {
    return { layer: null, problems: [{ file, line: 1, column: 1, path: "", severity: "error", message: `does not exist, so theme "${name}" cannot be used; the previous theme stays in use` }] };
  }
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, { allowTrailingComma: true, disallowComments: false, allowEmptyContent: true });
  const loader = new Loader(file, text, root);
  const starts = lineStarts(text);
  const at = (node: Node) => position(starts, node.offset);
  if (errors.length > 0) {
    const first = errors[0]!;
    const { line, column } = position(starts, first.offset);
    const message = `is not valid JSONC here (${printParseErrorCode(first.error)}); the theme is not used until it parses, and the previous theme stays in use`;
    return { layer: null, problems: [{ file, line, column, path: "", severity: "error", message }] };
  }
  const empty = { tokens: {}, light: {}, dark: {} };
  if (root === undefined) return { layer: { name, file, extends: BUILT_IN_THEME, extendsAt: null, surfaceContrast: null, ...empty, origins: { ...empty } }, problems: [] };
  if (root.type !== "object") {
    loader.problem(root, [], "error", "is not an object of theme settings; the previous theme stays in use");
    return { layer: null, problems: loader.problems };
  }

  let parent: string = BUILT_IN_THEME;
  let extendsAt: { line: number; column: number } | null = null;
  let surfaceContrast: number | null = null;
  const sections = { tokens: {} as TokenOverrides, light: {} as TokenOverrides, dark: {} as TokenOverrides };
  const origins = { tokens: {} as Partial<Record<TokenName, TokenOrigin>>, light: {} as Partial<Record<TokenName, TokenOrigin>>, dark: {} as Partial<Record<TokenName, TokenOrigin>> };
  let usable = true;

  const readTokens = (node: Node | undefined, path: string[], into: "tokens" | "light" | "dark") => {
    if (!node) return;
    if (node.type !== "object") {
      loader.problem(node, path, "error", "takes an object of token values; it is ignored");
      return;
    }
    for (const { keyNode, key, value } of properties(node)) {
      const nameProblem = tokenNameProblem(key);
      if (nameProblem) {
        // The closest name as a suggestion of its own, not inside the message.
        const close = Object.hasOwn(RETIRED_TOKENS, key) ? undefined : suggest(key, TOKEN_NAMES);
        loader.problem(keyNode, [...path, key], "error", nameProblem.replace(/ \(did you mean [^)]*\)$/, "") + "; it is ignored", close);
        continue;
      }
      const token = key as TokenName;
      if (value && loader.validate(tokenValueSchema(token) as never, value, [...path, key])) {
        sections[into][token] = valueOf(value) as TokenOverride;
        origins[into][token] = { file, ...at(value), path: [...path, key].join(".") };
      }
    }
  };

  for (const { keyNode, key, value } of properties(root)) {
    switch (key) {
      case "$schema":
        break;
      case "extends":
        if (!loader.validate(shape["extends"] as never, value, [key])) usable = false;
        else {
          parent = String(value?.value);
          extendsAt = value ? at(value) : null;
        }
        break;
      case "surface_contrast":
        if (loader.validate(shape["surface_contrast"] as never, value, [key])) surfaceContrast = Number(value?.value);
        break;
      case "tokens":
        readTokens(value, [key], "tokens");
        break;
      case "light":
      case "dark": {
        if (value?.type !== "object") {
          loader.problem(value, [key], "error", "takes an object with tokens; it is ignored");
          break;
        }
        for (const inner of properties(value)) {
          if (inner.key === "tokens") readTokens(inner.value, [key, "tokens"], key);
          else loader.problem(inner.keyNode, [key, inner.key], "warning", "is not a known setting and is ignored", suggest(inner.key, ["tokens"]));
        }
        break;
      }
      default:
        loader.problem(keyNode, [key], "warning", "is not a known setting and is ignored", suggest(key, FILE_KEYS));
    }
  }
  if (!usable) return { layer: null, problems: loader.problems };
  return { layer: { name, file, extends: parent, extendsAt, surfaceContrast, ...sections, origins }, problems: loader.problems };
}

export interface ThemeLoadOptions {
  readonly themesDir: string;
  /** Reads a file (the configuration's reader, sources.ts `readConfigFile`, or a test's). */
  readonly read: (path: string) => FileRead;
}

export interface ThemeLoad {
  /** The theme to use, or null to keep the previous one (a missing file, a cycle, a broken file). */
  readonly spec: ThemeSpec | null;
  readonly problems: readonly ConfigProblem[];
}

/**
 * The theme `name` and its `extends` chain, from `themesDir`. The built-in `default` needs no file.
 * A name with no file, a file that cannot be used, or a cycle gives `spec: null` with the problem;
 * token problems leave the token out and keep the theme.
 */
export function loadThemeSpec(name: string, options: ThemeLoadOptions): ThemeLoad {
  if (name === BUILT_IN_THEME) return { spec: { name, layers: [] }, problems: [] };
  const problems: ConfigProblem[] = [];
  const chain: ThemeLayer[] = [];
  const seen: string[] = [];
  let current = name;
  // A problem at the `extends` of the last file read (the one that names `current`).
  const atExtends = (message: string): ConfigProblem => {
    const child = chain.at(-1)!;
    return { file: child.file, line: child.extendsAt?.line ?? 1, column: child.extendsAt?.column ?? 1, path: "extends", severity: "error", message };
  };
  while (current !== BUILT_IN_THEME) {
    if (seen.includes(current)) {
      const cycle = [...seen.slice(seen.indexOf(current)), current].join(" extends ");
      problems.push(atExtends(`makes a cycle: ${cycle}; the previous theme stays in use`));
      return { spec: null, problems };
    }
    if (!THEME_NAME_PATTERN.test(current)) {
      // Only the configuration's own name can get here unchecked (the schema checks it too).
      problems.push({ file: themeFile(options.themesDir, name), line: 1, column: 1, path: "", severity: "error", message: `"${current}" is not a theme name; the previous theme stays in use` });
      return { spec: null, problems };
    }
    seen.push(current);
    const file = themeFile(options.themesDir, current);
    const read = options.read(file);
    if (read.error !== null) {
      problems.push({ file, line: 1, column: 1, path: "", severity: "error", message: `could not be read (${read.error}); the previous theme stays in use` });
      return { spec: null, problems };
    }
    const parsed = parseThemeFile(read.text, file, current);
    problems.push(...parsed.problems);
    if (!parsed.layer) {
      // A missing parent is named from the file that extends it.
      if (read.text === null && chain.length > 0) {
        problems.pop();
        problems.push(atExtends(`names theme "${current}", which has no file ${file}; the previous theme stays in use`));
      }
      return { spec: null, problems };
    }
    chain.push(parsed.layer);
    current = parsed.layer.extends;
  }
  return { spec: { name, layers: chain.reverse() }, problems };
}
