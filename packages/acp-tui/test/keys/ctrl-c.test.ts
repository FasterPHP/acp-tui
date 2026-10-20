// mvp-chrome-and-keys task 3.1 (spec tui-keymap "Ctrl+C precedence"): Ctrl+C
// is the selection's `copy` and nothing else, and no hint or notice names it
// as an exit or cancel key. The key map is checked for what Ctrl+C is bound
// to, the hints and armed states are derived from the default key map, and
// every string literal in `src/` that names Ctrl+C is grepped for an exit,
// cancel, clear or interrupt meaning.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { armedState } from "../../src/keys/controller.ts";
import { hintsForKeyMap } from "../../src/keys/hints.ts";
import { DEFAULT_KEY_MAP, KEY_CONTEXTS } from "../../src/keys/keymap.ts";
import { armedText } from "../../src/layout/modules.ts";

const SRC = join(import.meta.dir, "../../src");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

/** String literals (single, double or template quotes) on one line, comments left out. */
function literals(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const code = line.trimStart();
    if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) continue;
    for (const m of code.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  return out;
}

const EXIT_WORDS = /\b(exit|quit|cancel|interrupt|clear|detach|stop)/i;

describe("Ctrl+C is the copy key only", () => {
  test("bound in the selection context to `copy`, in no other context", () => {
    for (const context of KEY_CONTEXTS) {
      const action = (DEFAULT_KEY_MAP[context] as Record<string, string>)["ctrl+c"];
      expect([context, action]).toEqual(context === "selection" ? ["selection", "copy"] : [context, undefined]);
    }
  });

  test("no hint or armed state of the default key map names Ctrl+C", () => {
    for (const hint of hintsForKeyMap(DEFAULT_KEY_MAP)) expect(hint.key).not.toContain("ctrl+c");
    for (const kind of ["detach", "interrupt"] as const) expect(armedText(armedState(DEFAULT_KEY_MAP, kind))).not.toContain("ctrl+c");
  });

  test("no string in src/ names Ctrl+C as an exit, cancel, clear or interrupt key", () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      for (const literal of literals(readFileSync(file, "utf8"))) {
        if (/ctrl\+c\b/i.test(literal) && EXIT_WORDS.test(literal)) offenders.push(`${file.slice(SRC.length + 1)}: ${literal}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
