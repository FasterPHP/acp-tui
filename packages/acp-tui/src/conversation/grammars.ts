import { addDefaultParsers, type FiletypeParserOptions } from "@opentui/core";
import { fileURLToPath } from "node:url";

/**
 * The tree-sitter grammars acp-tui bundles for code-block highlighting (mvp-rendering design
 * decision 8, tasks 8.1 and 8.2). JavaScript, TypeScript, Markdown and Markdown inline are
 * OpenTUI's own bundled parsers and are not repeated here; these nine are built by
 * `scripts/build-grammars.ts` from pinned commits and committed under `assets/grammars/`
 * with their highlight queries and licences (`manifest.json` records the sources).
 *
 * Every path is a local absolute path. OpenTUI's parser worker downloads anything that starts
 * with `http://` or `https://` on first use; a terminal client must never do that silently, so
 * `bundledGrammars()` refuses to return a URL.
 *
 * The aliases are the info strings OpenTUI's own mapping (`infoStringToFiletype`) does not
 * already turn into the filetype: `php`, `json`, `bash` (for `sh`, `zsh`, `ksh`), `sql`,
 * `python` (for `py`) and `yaml` (for `yml`) need none; `kotlin` takes `kt` and `kts`, `xml` takes `pom`, `xsd` and `svg`.
 */

/** The `assets/grammars` directory, resolved from this module so it works from source and from the launcher. */
export const GRAMMAR_DIR = fileURLToPath(new URL("../../assets/grammars/", import.meta.url));

interface BundledGrammar {
  /** OpenTUI's filetype and the directory name under `assets/grammars/`. */
  filetype: string;
  /** Further info strings that mean the same language. */
  aliases?: string[];
}

export const BUNDLED_GRAMMARS: readonly BundledGrammar[] = [
  // php_only: a snippet highlights with or without the `<?php` tag.
  { filetype: "php" },
  { filetype: "json" },
  { filetype: "bash", aliases: ["shell"] },
  { filetype: "sql", aliases: ["mysql", "postgresql", "pgsql"] },
  { filetype: "python", aliases: ["python3"] },
  { filetype: "yaml" },
  { filetype: "java" },
  { filetype: "kotlin", aliases: ["kt", "kts"] },
  { filetype: "xml", aliases: ["pom", "xsd", "svg"] },
];

/** The registrations for `addDefaultParsers`, with absolute local paths. */
export function bundledGrammars(dir: string = GRAMMAR_DIR): FiletypeParserOptions[] {
  return BUNDLED_GRAMMARS.map(({ filetype, aliases }) => {
    const wasm = `${dir}${filetype}/tree-sitter-${filetype}.wasm`;
    const highlights = `${dir}${filetype}/highlights.scm`;
    for (const path of [wasm, highlights]) {
      if (/^https?:\/\//i.test(path)) throw new Error(`grammar asset ${path} is a URL; acp-tui bundles its grammars`);
    }
    return { filetype, ...(aliases ? { aliases } : {}), queries: { highlights: [highlights] }, wasm };
  });
}

let registered = false;

/**
 * Registers the bundled grammars with OpenTUI. Call once at start-up, before the first
 * highlight: `addDefaultParsers` takes effect when OpenTUI's tree-sitter client initialises
 * (its first use), and each grammar's wasm is read from disk only when a block in that language
 * is first highlighted. Idempotent.
 */
export function registerGrammars(): void {
  if (registered) return;
  registered = true;
  addDefaultParsers(bundledGrammars());
}
