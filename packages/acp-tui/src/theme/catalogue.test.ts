// The token catalogue (mvp-rendering task 3.7, spec tui-theme "Theme tokens, never literal colours",
// scenarios "Catalogue complete" and "Retired token"): tokens.ts holds exactly the spec's catalogue,
// every catalogue token has a default value, and every token name a component, renderer or bar
// module reads is in the catalogue.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { DEFAULT_THEME } from "./default-theme.ts";
import { validateTheme } from "./resolve.ts";
import { TOKENS, TOKEN_NAMES, TOOL_KINDS } from "./tokens.ts";

/** The catalogue as the spec lists it. */
const SPEC_CATALOGUE = [
  // General.
  "text",
  "muted",
  "accent",
  "hint",
  "warning",
  "danger",
  "user",
  "agent",
  "thought",
  "permission",
  "status.fg",
  "busy",
  // Tool lines.
  "tool.ok",
  "tool.fail",
  "tool.running",
  "tool.kind",
  "tool.title",
  "tool.count",
  "tool.duration",
  "tool.index",
  "tool.result.label",
  ...TOOL_KINDS.map((k) => `tool.kind.${k}`),
  // Diffs.
  "diff.add",
  "diff.remove",
  "diff.hunk",
  // Markdown.
  ...[1, 2, 3, 4, 5, 6].map((n) => `markdown.heading.${n}`),
  "markdown.code",
  "markdown.link",
  "markdown.quote",
  "markdown.list",
  "markdown.task.done",
  "markdown.task.open",
  "markdown.table.border",
  "markdown.table.header",
  "markdown.strike",
  "markdown.math",
  ...["note", "tip", "important", "warning", "caution"].map((k) => `markdown.alert.${k}`),
  // Code.
  ...["keyword", "string", "comment", "number", "constant", "type", "function", "variable", "property", "operator", "punctuation", "tag", "attribute", "default"].map(
    (k) => `code.${k}`,
  ),
  // Surfaces.
  "surface.user",
  "surface.card",
  "surface.code",
  "surface.overlay",
  "surface.cursor",
  // The cursor's faint fill beside its bar (review C5, Marcus, 9 October 2026).
  "surface.cursor.faint",
  "surface.selection",
  "surface.permission",
  "surface.permission.selected",
  "status.bg",
  "diff.added.bg",
  "diff.removed.bg",
  "find.current",
  "find.other",
  // The conversation scroll bar (mvp-chrome-and-keys design D17; in the spec's catalogue since
  // Marcus's review of 9 October 2026).
  "scrollbar.track",
  "scrollbar.thumb",
];

const SRC = join(import.meta.dir, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.fixture\.ts$/.test(name) ? [path] : [];
  });
}

/**
 * Every token name the source reads, by a static scan: string literals passed to the theme's
 * accessors (`theme.text("…")`, `.color("…")`, `.token("…")`), given as a `token` or `fill` (or any
 * `…Token`) property or variable, cast `as TokenName`, chosen in a ternary assigned to a `TokenName`,
 * or given as a bar module's default token; and every literal that looks like a dotted token name
 * of a token family (`tool.`, `markdown.`, `code.`, `surface.`, `diff.`, `find.`, `status.`,
 * `scrollbar.`) anywhere. TypeScript checks the typed reads too; this catches the untyped ones and
 * keeps the catalogue honest.
 */
function tokenReads(): Map<string, string[]> {
  const patterns = [
    /\.(?:text|color|token)\(\s*"([^"]+)"/g,
    /\b(?:token|fill|[a-zA-Z]+Token)\??\s*[:=]\s*"([^"]+)"/g,
    /"([^"]+)"\s+as\s+TokenName\b/g,
    /\bdefaults\([^\n]*?,\s*"([^"]+)"\s*\)/g,
    /\bmeta\(\s*"([^"]+)"/g,
    /"((?:tool|markdown|code|surface|diff|find|status|scrollbar)\.[a-z0-9_.]+)"/g,
  ];
  const ternary = /:\s*TokenName(?:\s*\|\s*undefined)?\s*=\s*([^;\n]+)/g;
  const reads = new Map<string, string[]>();
  // Only literals shaped like a token name: `fill = " "` (a fill character) is not one.
  const add = (name: string, where: string) => void (/^[a-z][a-z0-9_.]*$/.test(name) && reads.set(name, [...(reads.get(name) ?? []), where]));
  for (const file of sources(SRC)) {
    const text = readFileSync(file, "utf8");
    const where = relative(SRC, file);
    // The glyph registry names glyphs (`tool.status.ok`, `code.rule`), which share prefixes with token families.
    if (where === "conversation/glyphs.ts") continue;
    for (const pattern of patterns) for (const m of text.matchAll(pattern)) add(m[1]!, where);
    for (const m of text.matchAll(ternary)) for (const t of m[1]!.matchAll(/[?:]\s*"([^"]+)"/g)) add(t[1]!, where);
  }
  return reads;
}

describe("Theme tokens, never literal colours: the catalogue", () => {
  test("tokens.ts holds exactly the spec's catalogue, the scroll bar surfaces included", () => {
    expect(([...TOKEN_NAMES] as string[]).sort()).toEqual([...SPEC_CATALOGUE].sort());
    expect(new Set(SPEC_CATALOGUE).size).toBe(SPEC_CATALOGUE.length);
  });

  test("Catalogue complete: every token name read by a component, renderer or bar module is in the catalogue", () => {
    const reads = tokenReads();
    // The scan does find the reads (a sample from components, renderers, bar modules and the theme).
    for (const name of ["hint", "permission", "accent", "tool.title", "tool.index", "surface.cursor", "surface.selection", "find.current", "markdown.heading.1", "diff.added.bg"]) {
      expect(reads.has(name), name).toBe(true);
    }
    const unknown = [...reads].filter(([name]) => !(name in TOKENS)).map(([name, files]) => `${name} (${[...new Set(files)].join(", ")})`);
    expect(unknown).toEqual([]);
  });

  test("Catalogue complete: every catalogue token has a value in the default theme", () => {
    expect(validateTheme(DEFAULT_THEME)).toEqual([]);
    for (const name of TOKEN_NAMES) expect(DEFAULT_THEME.tokens[name], name).toBeDefined();
  });

  test("Retired token: the token set holds surface.cursor, surface.selection and markdown.heading.1 to .6, and no retired name; nothing in src reads one", () => {
    const retired = [["surface", "selected"].join("."), "markdown.heading"];
    for (const name of ["surface.cursor", "surface.selection", ...[1, 2, 3, 4, 5, 6].map((n) => `markdown.heading.${n}`)]) {
      expect(TOKEN_NAMES as string[]).toContain(name);
    }
    for (const name of retired) {
      expect(TOKEN_NAMES as string[]).not.toContain(name);
      expect(tokenReads().has(name), name).toBe(false);
    }
  });
});
