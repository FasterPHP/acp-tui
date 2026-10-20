#!/usr/bin/env bun
/**
 * Generates `src/render/emoji/emoji-names.ts`, the emoji name table behind the emoji a terminal
 * cannot draw at the width acp-tui lays out (mvp-rendering task 14.5, review C11; spec
 * tui-rendering "Other extensions stay text"). Such a sequence is drawn as its CLDR short name in
 * the long form, as a snake_case shortcode (`:family_man_woman_girl:`), with the emoji kept in
 * the projection (src/render/emoji/emoji.ts).
 *
 * The data is Unicode's `emoji-test.txt` at a pinned version (Emoji 18.0, Unicode License v3),
 * used at GENERATION TIME ONLY: the file is downloaded once from unicode.org into a cache
 * (`$XDG_CACHE_HOME/acp-tui/`, else `~/.cache/acp-tui/`), checked against the SHA-256 below, and
 * never read at run time. It is not vendored (it is 670 kB, and its header uses dashes the
 * repository does not hold). The generator writes a plain TypeScript module with sorted keys,
 * every non-ASCII character escaped and no timestamp, so a second run is byte-for-byte identical.
 *
 *   bun packages/acp-tui/scripts/build-emoji-names.ts            # write the module (downloads once)
 *   bun packages/acp-tui/scripts/build-emoji-names.ts --check    # exit 1 if the committed module differs
 *   bun packages/acp-tui/scripts/build-emoji-names.ts --source <emoji-test.txt>   # a local copy
 *
 * What the table holds (as small as the per-terminal rule needs, src/render/emoji/emoji.ts):
 *   EMOJI_NAMES   the slug of the CLDR short name of every fully-qualified ZWJ sequence, flag
 *                 (regional indicators and the three subdivision flags), keycap, emoji that takes
 *                 variation selector 16, and emoji that takes a skin tone, keyed by the sequence
 *                 without U+FE0F and without skin tones;
 *   EMOJI_TONES   for every key that takes skin tones, the name's template, `""` when it is the
 *                 name followed by the tones (`thumbs_up_medium_skin_tone`), else with `%` where
 *                 the tones go (`man_%_red_hair`, and the hand pairs that have no untoned form);
 *   OPENTUI_MISMEASURED  the sequences the pinned OpenTUI (OPENTUI_VERSION) counts in another number of cells than
 *                 acp-tui's layout (`Bun.stringWidth`) does, in every terminal: bare text-default
 *                 symbols such as U+2764 (2 against 1) and the skin tones and unqualified forms on
 *                 narrow bases such as U+270C (1 against 2). Measured here with OpenTUI's own width
 *                 function (an owned buffer's `encodeUnicode`, method `unicode`, since 0.6), so
 *                 the installed OpenTUI must be the pinned one.
 *
 * Names: lower case, accents dropped, apostrophes, quotation marks and full stops dropped, `&` as
 * `and`, and every other run of characters but letters, digits, `#` and `*` as `_`
 * (`flag: St. Kitts & Nevis` is `flag_st_kitts_and_nevis`, `keycap: #` is `keycap_#`). Flags
 * keep CLDR's country name (`flag_united_kingdom`, not the region code `flag_gb`), since the spec
 * asks for the CLDR short name in the long form. The generator checks that every name is unique
 * and that the run-time rule gives the CLDR name of every fully-qualified sequence it names.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The Emoji version the table is generated from, and where it is published. */
export const EMOJI_VERSION = "18.0";
export const SOURCE_URL = "https://www.unicode.org/Public/18.0.0/emoji/emoji-test.txt";
/** SHA-256 of that file (published 2026-04-30). */
export const SOURCE_SHA256 = "8f3735cda1f92a779d78af67cf86066bb1f07143dc22f2ac29394d9bc57ab21a";
/** The OpenTUI whose widths OPENTUI_MISMEASURED records (pinned in package.json too). */
export const OPENTUI_VERSION = "0.6.6";

const here = dirname(fileURLToPath(import.meta.url));
export const OUTPUT_PATH = resolve(here, "../src/render/emoji/emoji-names.ts");

/** The Unicode License v3 (https://www.unicode.org/license.txt), with the copyright sign written `(c)` so the module stays ASCII. */
const UNICODE_NOTICE = `UNICODE LICENSE V3

COPYRIGHT AND PERMISSION NOTICE

Copyright (c) 1991-2026 Unicode, Inc.

NOTICE TO USER: Carefully read the following legal agreement. BY
DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a
copy of data files and any associated documentation (the "Data Files") or
software and any associated documentation (the "Software") to deal in the
Data Files or Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, and/or sell
copies of the Data Files or Software, and to permit persons to whom the
Data Files or Software are furnished to do so, provided that either (a)
this copyright and permission notice appear with all copies of the Data
Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall
not be used in advertising or otherwise to promote the sale, use or other
dealings in these Data Files or Software without prior written
authorization of the copyright holder.`;

const ZWJ = 0x200d;
const VS15 = 0xfe0e;
const VS16 = 0xfe0f;
const KEYCAP = 0x20e3;
const isTone = (cp: number) => cp >= 0x1f3fb && cp <= 0x1f3ff;
const isRegional = (cp: number) => cp >= 0x1f1e6 && cp <= 0x1f1ff;
const BLACK_FLAG = 0x1f3f4;

/** The skin tones' CLDR names, in modifier order (U+1F3FB to U+1F3FF). */
export const TONE_NAMES = ["light skin tone", "medium-light skin tone", "medium skin tone", "medium-dark skin tone", "dark skin tone"] as const;

interface Entry {
  readonly cps: readonly number[];
  readonly status: "component" | "fully-qualified" | "minimally-qualified" | "unqualified";
  readonly name: string;
}

/** The data lines of `emoji-test.txt`: `code points ; status # emoji E<version> name`. */
export function parseEmojiTest(text: string): Entry[] {
  const out: Entry[] = [];
  for (const line of text.split("\n")) {
    const m = /^([0-9A-F]+(?: [0-9A-F]+)*)\s*;\s*(component|fully-qualified|minimally-qualified|unqualified)\s*#\s*\S+\s+E\d+\.\d+\s+(.+)$/.exec(line);
    if (!m) continue;
    out.push({ cps: m[1]!.split(" ").map((h) => parseInt(h, 16)), status: m[2] as Entry["status"], name: m[3]!.trim() });
  }
  return out;
}

/** A CLDR short name as a shortcode name (see the module header). */
export function slug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['.’“”]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9#*]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** The table key of a sequence: without variation selectors and skin tones. */
const keyOf = (cps: readonly number[]) => String.fromCodePoint(...cps.filter((c) => c !== VS16 && c !== VS15 && !isTone(c)));

/** The tones of a sequence as a name part: one tone named once when every tone is the same. */
function tonePart(cps: readonly number[]): string {
  const tones = cps.filter(isTone).map((c) => TONE_NAMES[c - 0x1f3fb]!);
  return (tones.every((t) => t === tones[0]) ? [tones[0]!] : tones).join(", ");
}

/** OpenTUI's width of `text` in cells (its `unicode` method, the default), from its native
 *  library: `encodeUnicode` of a buffer measuring by that method. OpenTUI 0.6 removed
 *  `RenderLib.encodeUnicode` and gives every buffer an owner, here a context of its own. */
export async function openTuiWidth(): Promise<(text: string) => number> {
  const { OptimizedBuffer, ResourceContext } = await import("@opentui/core");
  const owner = new ResourceContext({ objectCapacity: 16, renderCellsMax: 16 });
  const buffer = OptimizedBuffer.create(1, 1, "unicode", { owner });
  return (text) => {
    const encoded = buffer.encodeUnicode(text);
    const width = encoded.data.reduce((sum, d) => sum + d.width, 0);
    buffer.freeUnicode(encoded);
    return width;
  };
}

/** `"..."` literal: JSON, with every non-ASCII UTF-16 unit escaped, so the output is pure ASCII. */
function literal(text: string): string {
  return JSON.stringify(text).replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function emitRecord(name: string, doc: string, entries: Map<string, string>): string {
  const keys = [...entries.keys()].sort(byCodeUnits);
  const body = keys.map((k) => `  ${literal(k)}: ${literal(entries.get(k)!)},`).join("\n");
  return `${doc}\nexport const ${name}: Readonly<Record<string, string>> = {\n${body}\n};\n`;
}

function emitList(name: string, doc: string, items: Set<string>): string {
  const body = [...items].sort(byCodeUnits).map((k) => `  ${literal(k)},`).join("\n");
  return `${doc}\nexport const ${name}: readonly string[] = [\n${body}\n];\n`;
}

/** The name the run-time rule (src/render/emoji/emoji.ts) gives `cps` from the tables, or null. */
export function ruleName(cps: readonly number[], names: ReadonlyMap<string, string>, tones: ReadonlyMap<string, string>): string | null {
  const key = keyOf(cps);
  if (!cps.some(isTone)) return names.get(key) ?? null;
  const template = tones.get(key);
  if (template === undefined) return null;
  const pattern = template === "" ? `${names.get(key)}_%` : template;
  return pattern.replace("%", slug(tonePart(cps)));
}

export async function generate(text: string): Promise<string> {
  const sha = createHash("sha256").update(text).digest("hex");
  if (sha !== SOURCE_SHA256) throw new Error(`emoji-test.txt has SHA-256 ${sha}, not the pinned ${SOURCE_SHA256}`);
  if (!new RegExp(`^# Version: ${EMOJI_VERSION.replace(".", "\\.")}$`, "m").test(text)) throw new Error(`emoji-test.txt is not Emoji ${EMOJI_VERSION}`);
  const pkg = JSON.parse(await readFile(join(dirname(fileURLToPath(import.meta.resolve("@opentui/core"))), "package.json"), "utf8")) as { version: string };
  if (pkg.version !== OPENTUI_VERSION) throw new Error(`@opentui/core ${pkg.version} is installed, ${OPENTUI_VERSION} is pinned`);
  const width = await openTuiWidth();

  const entries = parseEmojiTest(text);
  const qualified = entries.filter((e) => e.status === "fully-qualified" || e.status === "component");
  if (qualified.length < 3900) throw new Error(`only ${qualified.length} fully-qualified sequences: the file layout changed`);

  // Every fully-qualified name is a unique shortcode.
  const seen = new Map<string, string>();
  for (const e of qualified) {
    const s = slug(e.name);
    if (!/^[a-z0-9#*]+(?:_[a-z0-9#*]+)*$/.test(s)) throw new Error(`the name ${JSON.stringify(e.name)} gives ${JSON.stringify(s)}`);
    const other = seen.get(s);
    if (other !== undefined && other !== keyOf(e.cps)) throw new Error(`two emoji are named ${s}`);
    seen.set(s, keyOf(e.cps));
  }

  // The untoned names by key, and the keys that need one.
  const all = new Map<string, string>();
  for (const e of qualified) if (!e.cps.some(isTone)) all.set(keyOf(e.cps), slug(e.name));
  const needed = new Set<string>();
  for (const e of qualified) {
    const cps = e.cps;
    // A toned sequence is named through its template (below): some have no untoned form.
    if (cps.some(isTone)) continue;
    if (cps.includes(ZWJ) || cps.includes(KEYCAP) || isRegional(cps[0]!) || (cps[0] === BLACK_FLAG && cps.length > 2)) needed.add(keyOf(cps));
    else if (cps.length === 2 && cps[1] === VS16) needed.add(keyOf(cps));
  }

  // Tone templates: the tones' place in the name, the same for every tone of a key.
  const tones = new Map<string, string>();
  for (const e of qualified) {
    if (!e.cps.some(isTone) || e.cps.length < 2) continue;
    const key = keyOf(e.cps);
    const part = slug(tonePart(e.cps));
    const s = slug(e.name);
    const at = s.indexOf(part);
    if (at < 0) throw new Error(`${e.name}: the tones are not in the name`);
    const pattern = s.slice(0, at) + "%" + s.slice(at + part.length);
    const template = all.has(key) && pattern === `${all.get(key)}_%` ? "" : pattern;
    const before = tones.get(key);
    if (before !== undefined && before !== template) throw new Error(`${e.name}: tones placed differently from another tone of the same emoji`);
    tones.set(key, template);
    if (template === "") needed.add(key);
  }

  const names = new Map<string, string>();
  for (const key of needed) {
    const name = all.get(key);
    if (name === undefined) throw new Error(`no untoned name for ${literal(key)}`);
    names.set(key, name);
  }

  // The run-time rule gives every fully-qualified sequence it names its CLDR name.
  let checked = 0;
  for (const e of qualified) {
    const got = ruleName(e.cps, names, tones);
    if (got === null) continue;
    if (got !== slug(e.name)) throw new Error(`${e.name}: the rule gives ${got}`);
    checked++;
  }

  // What OpenTUI and the layout measure differently: every sequence of the file, and each base
  // alone and with U+FE0E (text presentation).
  const mismeasured = new Set<string>();
  const candidates = new Set<string>();
  for (const e of entries) {
    candidates.add(String.fromCodePoint(...e.cps));
    if (e.cps.length === 1 || (e.cps.length === 2 && e.cps[1] === VS16)) {
      candidates.add(String.fromCodePoint(e.cps[0]!));
      candidates.add(String.fromCodePoint(e.cps[0]!, VS15));
    }
  }
  for (const c of candidates) {
    const cps = [...c].map((ch) => ch.codePointAt(0)!);
    if (cps.length === 1 && cps[0]! < 0x80) continue;
    if (width(c) === Bun.stringWidth(c)) continue;
    if (ruleName(cps, names, tones) === null) throw new Error(`${literal(c)} is measured differently by OpenTUI and has no name`);
    mismeasured.add(c);
  }

  const out = [
    `// GENERATED FILE: do not edit. Source: packages/acp-tui/scripts/build-emoji-names.ts`,
    `// (bun packages/acp-tui/scripts/build-emoji-names.ts; \`--check\` verifies this file).`,
    `//`,
    `// Data: Unicode emoji-test.txt, Emoji ${EMOJI_VERSION} (${SOURCE_URL}), sha256`,
    `// ${sha}:`,
    `// the CLDR short names as shortcode names (${names.size} names, ${tones.size} skin-tone templates, ${checked}`,
    `// sequences checked against the rule), and the ${mismeasured.size} sequences OpenTUI ${OPENTUI_VERSION} measures`,
    `// differently from Bun.stringWidth. The file is read at generation time only.`,
    `//`,
    `// The generated data is distributed under the licence of its source:`,
    `//`,
    ...UNICODE_NOTICE.split("\n").map((line) => (line === "" ? "//" : `// ${line}`)),
    ``,
    `/** The Emoji version of the names. */`,
    `export const EMOJI_VERSION = ${literal(EMOJI_VERSION)};`,
    ``,
    emitRecord(
      "EMOJI_NAMES",
      "/** A sequence without U+FE0F and skin tones to its CLDR short name as a shortcode name, for ZWJ sequences, flags, keycaps, emoji that take U+FE0F and emoji that take skin tones. */",
      names,
    ),
    emitRecord(
      "EMOJI_TONES",
      '/** The keys that take skin tones: `""` when the toned name is the name and the tones, else the template with `%` where the tones go. */',
      tones,
    ),
    emitList(
      "OPENTUI_MISMEASURED",
      `/** Sequences OpenTUI ${OPENTUI_VERSION} gives another number of cells than Bun.stringWidth (acp-tui's layout), exactly as written. */`,
      mismeasured,
    ),
  ];
  return out.join("\n");
}

/** Where the downloaded source is kept. */
export function cachePath(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const base = env["XDG_CACHE_HOME"]?.startsWith("/") ? env["XDG_CACHE_HOME"]! : join(homedir(), ".cache");
  return join(base, "acp-tui", `emoji-test-${EMOJI_VERSION}.txt`);
}

/** The source text: `--source`, else the cache, else (with `download`) fetched into the cache. Null when absent and not downloaded. */
export async function loadSource(options: { source?: string; download?: boolean } = {}): Promise<string | null> {
  if (options.source) return readFile(options.source, "utf8");
  const path = cachePath();
  if (existsSync(path)) return readFile(path, "utf8");
  if (!options.download) return null;
  const response = await fetch(SOURCE_URL);
  if (!response.ok) throw new Error(`${SOURCE_URL}: HTTP ${response.status}`);
  const text = await response.text();
  const sha = createHash("sha256").update(text).digest("hex");
  if (sha !== SOURCE_SHA256) throw new Error(`${SOURCE_URL} has SHA-256 ${sha}, not the pinned ${SOURCE_SHA256}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
  return text;
}

async function main(): Promise<void> {
  const at = process.argv.indexOf("--source");
  const source = at >= 0 ? process.argv[at + 1] : undefined;
  const text = await loadSource({ ...(source ? { source } : {}), download: true });
  const output = await generate(text!);
  if (process.argv.includes("--check")) {
    const current = await Bun.file(OUTPUT_PATH).text();
    if (current !== output) {
      console.error(`${OUTPUT_PATH} differs from the generator's output`);
      process.exit(1);
    }
    console.log("emoji-names.ts is up to date");
    return;
  }
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, output);
  console.log(`wrote ${OUTPUT_PATH} (${output.length} bytes)`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
