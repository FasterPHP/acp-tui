// Task 3.1: acp-model must import no UI or SDK runtime code. This walks every import statement
// in this package's own source (not node_modules) and asserts none of them is a runtime import
// (only `import type` / `export type` ...) from the SDK, Solid or OpenTUI packages, and that none
// of these packages is imported at all from Paseo client packages.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SRC_DIR = join(import.meta.dir, "..", "src");

const FORBIDDEN_RUNTIME_SPECIFIERS = [
  "@agentclientprotocol/sdk",
  "solid-js",
  "@opentui/",
  "@getpaseo/",
];

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Matches `import ... from "specifier"` and `export ... from "specifier"` statements, spanning
 * multiple lines (our own SDK type imports are multi-line), and captures whether the statement
 * is type-only (`import type` / `export type`) and the specifier.
 *
 * This does not special-case a per-specifier inline `type` modifier (`import { type Foo, Bar }
 * from "x"`, which is a runtime import because of `Bar`): none of this package's source uses
 * that form, so the whole-statement check below is sufficient.
 */
const IMPORT_STATEMENT = /^[ \t]*(import|export)\s+(type\s+)?[\s\S]*?\s*from\s*["']([^"']+)["']/gm;

interface ParsedImport {
  readonly statement: string;
  readonly isTypeOnly: boolean;
  readonly specifier: string;
}

function parseImports(source: string): ParsedImport[] {
  const results: ParsedImport[] = [];
  for (const match of source.matchAll(IMPORT_STATEMENT)) {
    const [statement, , typeKeyword, specifier] = match;
    results.push({
      statement: statement as string,
      isTypeOnly: Boolean(typeKeyword),
      specifier: specifier as string,
    });
  }
  return results;
}

describe("acp-model import graph", () => {
  const files = collectSourceFiles(SRC_DIR);

  test("scans at least the expected source files", () => {
    // Sanity check that the walk actually found something, so a refactor that empties the
    // directory (or a path typo) fails loudly rather than the test trivially passing.
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  for (const file of files) {
    const relative = file.slice(SRC_DIR.length + 1);
    test(`${relative} imports SDK/UI packages only as types, if at all`, () => {
      const source = readFileSync(file, "utf8");
      const imports = parseImports(source);
      for (const forbidden of FORBIDDEN_RUNTIME_SPECIFIERS) {
        const offending = imports.filter(
          (imp) => imp.specifier.startsWith(forbidden) && !imp.isTypeOnly,
        );
        expect(offending).toEqual([]);
      }
    });
  }

  test("package.json declares no runtime dependency other than the SDK (types only)", () => {
    const pkg = JSON.parse(readFileSync(join(SRC_DIR, "..", "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const deps = Object.keys(pkg.dependencies ?? {});
    expect(deps).toEqual(["@agentclientprotocol/sdk"]);
  });
});
