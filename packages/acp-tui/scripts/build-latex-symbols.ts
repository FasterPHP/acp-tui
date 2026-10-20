#!/usr/bin/env bun
/**
 * Generates `src/render/math/latex-symbols.ts`, the LaTeX-to-Unicode symbol table behind the
 * maths converter (mvp-rendering design decision 7 and open question 1, task 7.4).
 *
 * The data comes from `unicode2latex` (npm, ISC, Emiliano Heyns), used here at GENERATION TIME
 * ONLY: it is a pinned devDependency of this package and nothing at run time imports it. The
 * generator reads the package's `dist/tables/latex2unicode.json` (about 4600 macro entries),
 * keeps the math symbols, normalises what the table gets wrong for a terminal (see below), adds
 * a short, reviewed overlay, and writes a plain TypeScript module with sorted keys and no
 * timestamp, so a second run is byte-for-byte identical.
 *
 *   bun packages/acp-tui/scripts/build-latex-symbols.ts           # write the module
 *   bun packages/acp-tui/scripts/build-latex-symbols.ts --check   # exit 1 if the committed module differs
 *
 * What it keeps from the table (all of it comes from the pinned data):
 *   SYMBOLS        `\name` macros whose value is a symbol in a mathematical block of Unicode (Greek,
 *                  letterlike symbols, arrows, operators, technical, shapes, misc. symbols and arrows,
 *                  supplemental operators) or Latin-1 punctuation and signs, plus the escapes `\{ \} \# \$ \% \& \_`.
 *   BLACKBOARD     `\mathbb{X}` for A to Z, a to z and 0 to 9.
 *   SUPERSCRIPTS   `^{x}` forms; SUBSCRIPTS: `_{x}` forms (one character each).
 *   ACCENTS        the combining mark behind `\hat`, `\tilde`, `\dot` and so on, from the table's text accents.
 * and what it adds by hand, below (`OVERLAY`, `OPERATOR_NAMES`, `SPACES`), each with its reason.
 *
 * `unicodeit` (MIT) was consulted as a reference for which super- and subscript forms exist; no
 * code or data was taken from it.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The exact unicode2latex release the table is generated from (pinned in package.json too). */
export const UNICODE2LATEX_VERSION = "7.0.35";

const here = dirname(fileURLToPath(import.meta.url));
export const OUTPUT_PATH = resolve(here, "../src/render/math/latex-symbols.ts");

/** The ISC licence text. unicode2latex ships no licence file (only `"license": "ISC"` and the author in package.json), so this is the standard ISC text with the author named there. */
const ISC_NOTICE = `ISC License

Copyright (c) Emiliano Heyns

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`;

/** Code point ranges (inclusive) a macro's value may lie in to count as a maths symbol. */
const SYMBOL_RANGES: readonly [number, number][] = [
  [0x00a0, 0x00bf], // Latin-1 signs: plus-minus, degree, middle dot, not sign...
  [0x00d7, 0x00d7], // multiplication sign
  [0x00f7, 0x00f7], // division sign
  [0x0370, 0x03ff], // Greek
  [0x2016, 0x2016], // double vertical line
  [0x2020, 0x2027], // dagger, double dagger, bullet, ellipsis...
  [0x2030, 0x205e], // per mille, primes, reference mark...
  [0x2100, 0x214f], // letterlike symbols: hbar, ell, aleph, Re, Im...
  [0x2190, 0x21ff], // arrows
  [0x2200, 0x22ff], // mathematical operators
  [0x2308, 0x230b], // ceilings and floors
  [0x2322, 0x2323], // frown and smile
  [0x25a0, 0x25ff], // geometric shapes
  [0x2660, 0x2667], // card suits
  [0x266d, 0x266f], // flat, natural, sharp
  [0x2713, 0x2714], // check marks
  [0x27c0, 0x27ef], // miscellaneous mathematical symbols A
  [0x27f0, 0x27ff], // supplemental arrows A
  [0x2900, 0x297f], // supplemental arrows B
  [0x2980, 0x29ff], // miscellaneous mathematical symbols B
  [0x2a00, 0x2aff], // supplemental mathematical operators
];

/** Macro name prefixes that are text-mode, font or phonetic commands, not maths symbols. */
const EXCLUDED_PREFIXES = ["\\text", "\\math", "\\APL", "\\Bbb", "\\mit", "\\Elz", "\\Elsevier"];

/** Hand-written entries: names the table lacks, and values chosen for a terminal over the table's. */
const OVERLAY: Readonly<Record<string, string>> = {
  // Names unicode2latex does not list (LaTeX kernel, amsmath and amssymb).
  "\\omicron": "ο",
  "\\land": "∧",
  "\\lor": "∨",
  "\\emptyset": "∅",
  "\\triangle": "△",
  "\\smallsetminus": "∖",
  // The table has the long arrows; \implies and friends are the long arrows in LaTeX, but the
  // short ones are in more terminal fonts (mvp-rendering markdown audit section 9).
  "\\implies": "⇒",
  "\\impliedby": "⇐",
  "\\iff": "⇔",
  "\\lvert": "|",
  "\\rvert": "|",
  "\\lVert": "‖",
  "\\rVert": "‖",
  // Delimiters whose value is plain ASCII, which the symbol ranges leave out.
  "\\lbrace": "{",
  "\\rbrace": "}",
  "\\lbrack": "[",
  "\\rbrack": "]",
  "\\vert": "|",
  "\\backslash": "\\",
  "\\|": "‖",
  "\\degree": "°",
  "\\qed": "∎",
  "\\colon": ":",
  "\\thickapprox": "≈",
  "\\unlhd": "⊴",
  "\\unrhd": "⊵",
  "\\circledR": "®",
  "\\varsubsetneq": "⊊",
  "\\imath": "ı",
  "\\jmath": "ȷ",
  // Values the table gets wrong for a terminal.
  // U+22C5 (dot operator) is in neither JetBrains Mono nor Lilex; U+00B7 is in both.
  "\\cdot": "·",
  // The table maps \setminus to U+29F5 (reverse solidus operator); LaTeX means U+2216.
  "\\setminus": "∖",
  // The table maps \hbar to U+0127 (h with stroke); the Planck constant is U+210F.
  "\\hbar": "ℏ",
  // U+2223 (divides) is a rare glyph; in a monospace font the plain bar reads the same.
  "\\mid": "|",
};

/** The names of the log-like operators LaTeX sets upright (`\sin x` is "sin x"). Hand-written: not a symbol table matter. */
const OPERATOR_NAMES: readonly string[] = [
  "arccos", "arcsin", "arctan", "arg", "cos", "cosh", "cot", "coth", "csc", "deg", "det", "dim", "exp", "gcd", "hom",
  "inf", "ker", "lg", "lim", "liminf", "limsup", "ln", "log", "max", "min", "Pr", "sec", "sin", "sinh", "sup", "tan", "tanh",
];

/** LaTeX spacing commands as terminal text. Hand-written: the table gives U+2009 and friends, which are not one cell. */
const SPACES: Readonly<Record<string, string>> = {
  "\\,": " ",
  "\\:": " ",
  "\\;": " ",
  "\\ ": " ",
  "\\!": "",
  "\\quad": "  ",
  "\\qquad": "    ",
};

/** The math accent macros and the table's text accent they correspond to (their value is a combining mark). */
const ACCENT_SOURCES: Readonly<Record<string, string>> = {
  acute: "\\'",
  grave: "\\`",
  hat: "\\^",
  tilde: "\\~",
  dot: "\\.",
  ddot: '\\"',
  bar: "\\=", // macron (U+0304); the overline U+0305 and \vec's U+20D7 are in neither terminal font
  breve: "\\u",
  check: "\\v",
  mathring: "\\r",
};

type RawTable = Record<string, string | { text?: string; math?: string }>;

const inRanges = (cp: number): boolean => SYMBOL_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
const isMathAlphanumeric = (cp: number): boolean => cp >= 0x1d400 && cp <= 0x1d7ff;

/** Macros the table gives as Mathematical Alphanumeric Symbols (italic mu, bold nabla...) that mean the plain character. Every other macro with such a value is a font-style variant (\\mbfA...) and is left out. */
const FOLD_ALPHANUMERIC = new Set(["\\mu", "\\nabla", "\\imath", "\\jmath"]);

/** A table value as a terminal symbol (composed, with Mathematical Alphanumeric Symbols folded to the base character), or null when it is not a maths symbol. */
function symbolValue(key: string, value: string): string | null {
  const styled = [...value].some((c) => isMathAlphanumeric(c.codePointAt(0)!));
  if (styled && !FOLD_ALPHANUMERIC.has(key)) return null;
  // NFC rejoins "=" + U+0338 as U+2260; NFKC folds U+1D707 (italic mu) to U+03BC.
  const folded = styled ? value.normalize("NFKC") : value.normalize("NFC");
  const points = [...folded].map((c) => c.codePointAt(0)!);
  if (points.length === 0 || points.length > 2) return null;
  if (!points.every(inRanges)) return null;
  if (points.some((cp) => cp === 0x2013 || cp === 0x2014)) return null;
  return folded;
}

/** `"α"`-style literal: JSON, with every non-ASCII UTF-16 unit escaped, so the output is pure ASCII. */
function literal(text: string): string {
  return JSON.stringify(text).replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function emitRecord(name: string, doc: string, entries: Map<string, string>): string {
  const keys = [...entries.keys()].sort();
  const body = keys.map((k) => `  ${literal(k)}: ${literal(entries.get(k)!)},`).join("\n");
  return `${doc}\nexport const ${name}: Readonly<Record<string, string>> = {\n${body}\n};\n`;
}

export async function generate(): Promise<string> {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.resolve("unicode2latex"))), "../..");
  const pkg = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as { version: string; license: string };
  if (pkg.version !== UNICODE2LATEX_VERSION) throw new Error(`unicode2latex ${pkg.version} is installed, ${UNICODE2LATEX_VERSION} is pinned`);
  if (pkg.license !== "ISC") throw new Error(`unicode2latex declares licence ${pkg.license}, not ISC`);
  const raw = await readFile(join(packageRoot, "dist/tables/latex2unicode.json"));
  const table = JSON.parse(raw.toString("utf8")) as RawTable;

  const symbols = new Map<string, string>();
  const blackboard = new Map<string, string>();
  const superscripts = new Map<string, string>();
  const subscripts = new Map<string, string>();

  for (const [key, value] of Object.entries(table)) {
    if (typeof value !== "string") continue;
    let m: RegExpMatchArray | null;
    if ((m = key.match(/^\\mathbb\{([A-Za-z0-9])\}$/))) {
      blackboard.set(m[1]!, value);
    } else if ((m = key.match(/^\^\{(.)\}$/u))) {
      superscripts.set(m[1]!, value);
    } else if ((m = key.match(/^_\{(.)\}$/u))) {
      subscripts.set(m[1]!, value);
    } else if (/^\\[{}#$%&_]$/.test(key)) {
      if (value === key[1]) symbols.set(key, value);
    } else if (/^\\[A-Za-z]+$/.test(key)) {
      if (EXCLUDED_PREFIXES.some((p) => key.startsWith(p))) continue;
      const symbol = symbolValue(key, value);
      if (symbol !== null) symbols.set(key, symbol);
    }
  }
  for (const [key, value] of Object.entries(OVERLAY)) symbols.set(key, value);

  const accents = new Map<string, string>();
  for (const [name, source] of Object.entries(ACCENT_SOURCES)) {
    const mark = table[source];
    if (typeof mark !== "string" || [...mark].length !== 1 || mark.codePointAt(0)! < 0x300 || mark.codePointAt(0)! > 0x36f) {
      throw new Error(`the table's ${source} (for \\${name}) is not one combining mark: ${JSON.stringify(mark)}`);
    }
    accents.set(`\\${name}`, mark);
  }

  for (const [name, map, expected] of [
    ["blackboard", blackboard, 62],
    ["superscripts", superscripts, 1],
    ["subscripts", subscripts, 1],
  ] as const) {
    if (map.size < expected) throw new Error(`the table has no ${name}: the data layout changed`);
  }
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789") {
    if (!blackboard.has(letter)) throw new Error(`the table has no \\mathbb{${letter}}`);
  }

  const out = [
    `// GENERATED FILE: do not edit. Source: packages/acp-tui/scripts/build-latex-symbols.ts`,
    `// (bun packages/acp-tui/scripts/build-latex-symbols.ts; \`--check\` verifies this file).`,
    `//`,
    `// Data: unicode2latex ${pkg.version} (npm, ISC), dist/tables/latex2unicode.json, sha256`,
    `// ${createHash("sha256").update(raw).digest("hex")},`,
    `// filtered to maths symbols and normalised for a terminal, plus a reviewed overlay (see the`,
    `// generator). unicode2latex is a generation-time devDependency only; nothing imports it at run time.`,
    `//`,
    `// The generated data is distributed under the licence of its source:`,
    `//`,
    ...ISC_NOTICE.split("\n").map((line) => (line === "" ? "//" : `// ${line}`)),
    ``,
    emitRecord("SYMBOLS", "/** \`\\name\` macros to Unicode text: Greek letters, operators, relations, arrows and other symbols (the key includes the backslash). */", symbols),
    emitRecord("BLACKBOARD", "/** The argument of \\mathbb{...} (A to Z, a to z, 0 to 9) to its double-struck form. Letters outside C, H, N, P, Q, R and Z lie outside the BMP. */", blackboard),
    emitRecord("SUPERSCRIPTS", "/** A character to its superscript form, where Unicode has one (a letter or sign may lack one). */", superscripts),
    emitRecord("SUBSCRIPTS", "/** A character to its subscript form, where Unicode has one. */", subscripts),
    emitRecord("ACCENTS", "/** Accent macros to the combining mark that follows the base character. */", accents),
    `/** Log-like operators LaTeX sets upright (\`\\sin\`): the name without the backslash. */\nexport const OPERATOR_NAMES: readonly string[] = [\n${OPERATOR_NAMES.map((n) => `  ${literal(n)},`).join("\n")}\n];\n`,
    emitRecord("SPACES", "/** Spacing commands to the text they leave in a terminal. */", new Map(Object.entries(SPACES))),
  ];
  return out.join("\n");
}

async function main(): Promise<void> {
  const text = await generate();
  if (process.argv.includes("--check")) {
    const current = await Bun.file(OUTPUT_PATH).text();
    if (current !== text) {
      console.error(`${OUTPUT_PATH} differs from the generator's output`);
      process.exit(1);
    }
    console.log("latex-symbols.ts is up to date");
    return;
  }
  await writeFile(OUTPUT_PATH, text);
  console.log(`wrote ${OUTPUT_PATH} (${text.length} bytes)`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
