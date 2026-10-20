// The source pre-pass (mvp-rendering design decision 2; spec tui-rendering
// "Maths as best-effort Unicode" and "Footnotes").
//
// OpenTUI lexes agent Markdown with its own marked and offers no extension
// hook, and marked would mangle maths (`$a_1$ and $b_2$` parses as emphasis,
// `\(` is an escape). So before the message reaches the lexer, this pure pass
// over its source, outside code spans and fences:
//
// 1. escapes every private-use character the agent sent (U+E000 to U+F8FF)
//    as a `literal` placeholder, so that agent text can never forge one;
// 2. replaces each maths span (`$…$`, `\(…\)`, and `$$…$$` or `\[…\]` on
//    their own lines) and each footnote reference (`[^label]`) with a
//    placeholder carrying a per-message index into `Prepared.maths` or
//    `Prepared.refs`;
// 3. removes footnote definitions (`[^label]: text` at the start of a line,
//    with their continuation lines) into `Prepared.definitions`, their text
//    pre-passed the same way, and ends the source with a paragraph holding
//    only a `section` placeholder, where the definitions are drawn.
//
// A placeholder is `OPEN kind digits CLOSE`, all private-use characters:
// marked treats them as ordinary word characters, so a placeholder always
// stays whole inside one text token. The renderers split text on
// placeholders (`splitPlaceholders`) and substitute what each stands for;
// code (spans, blocks, link targets) gets its source back (`restoreSource`),
// which also undoes any detection the pass made where marked sees code.
//
// The pass is a pure function of the whole source, and an index is the
// span's position among the spans before it, so appending text while a
// message streams never renumbers an earlier placeholder. Detection
// only: converting maths (task 7.5) and drawing footnotes (task 7.3) are the
// renderers' business.

/** Starts every placeholder. */
export const PLACEHOLDER_OPEN = "\uE000";
/** Ends every placeholder. */
export const PLACEHOLDER_CLOSE = "\uE001";

export type PlaceholderKind = "math" | "footnote" | "literal" | "section";

const KIND_CHAR: Readonly<Record<PlaceholderKind, string>> = {
  math: "\uE002",
  footnote: "\uE003",
  literal: "\uE004",
  section: "\uE005",
};
const KIND_OF: Readonly<Record<string, PlaceholderKind>> = { "\uE002": "math", "\uE003": "footnote", "\uE004": "literal", "\uE005": "section" };
/** Hex digits of an index: U+E010 to U+E01F. */
const DIGIT_BASE = 0xe010;

/** Any placeholder the pass writes. */
const PLACEHOLDER = /\uE000([\uE002-\uE005])([\uE010-\uE01F]+)\uE001/g;
/** Private-use characters an agent may send (the BMP's private-use area). */
const PRIVATE_USE = /[\uE000-\uF8FF]/g;

export interface MathSpan {
  /** The LaTeX between the delimiters (private-use characters as the agent sent them: maths
   *  is converted, never lexed, so it needs no escaping). */
  readonly tex: string;
  /** Block maths (`$$` or `\[` on their own lines). */
  readonly display: boolean;
  /** The span as the agent wrote it, delimiters included (lines joined by `\n`). */
  readonly raw: string;
}

export interface FootnoteRef {
  /** The label as written. */
  readonly label: string;
  /** The label as matched against definitions (case-folded). */
  readonly key: string;
  /** `[^label]` (private-use characters as the agent sent them). */
  readonly raw: string;
}

export interface FootnoteDefinition {
  readonly label: string;
  readonly key: string;
  /** The definition's text (continuation lines unindented), itself pre-passed. */
  readonly text: string;
}

export interface Prepared {
  /** The source with placeholders, for the lexer. */
  readonly source: string;
  /** Maths spans, by placeholder index. */
  readonly maths: readonly MathSpan[];
  /** Footnote references, by placeholder index. */
  readonly refs: readonly FootnoteRef[];
  /** Footnote definitions by key; the first definition of a key wins. */
  readonly definitions: ReadonlyMap<string, FootnoteDefinition>;
  /** Footnote keys in the order of their first reference. */
  readonly footnoteOrder: readonly string[];
}

export type Placeholder =
  | { readonly kind: "literal"; readonly char: string }
  | { readonly kind: "math"; readonly index: number; readonly span: MathSpan }
  | { readonly kind: "footnote"; readonly index: number; readonly ref: FootnoteRef }
  /** Where the footnote definitions are drawn: a paragraph of its own at the end of the source. */
  | { readonly kind: "section" };

function placeholder(kind: PlaceholderKind, index: number): string {
  let digits = "";
  for (const d of index.toString(16)) digits += String.fromCharCode(DIGIT_BASE + Number.parseInt(d, 16));
  return PLACEHOLDER_OPEN + KIND_CHAR[kind] + digits + PLACEHOLDER_CLOSE;
}

function decodeIndex(digits: string): number {
  let n = 0;
  for (const ch of digits) n = n * 16 + (ch.charCodeAt(0) - DIGIT_BASE);
  return n;
}

/** Whether `text` holds a placeholder (a cheap test before splitting). */
export function hasPlaceholder(text: string): boolean {
  return text.includes(PLACEHOLDER_OPEN);
}

/**
 * `text` (from the lexer, so from `prepared.source`) as plain strings and placeholders, in order.
 * A placeholder whose index is out of range (which the pass never writes) is kept as text.
 */
export function splitPlaceholders(text: string, prepared: Prepared): (string | Placeholder)[] {
  if (!hasPlaceholder(text)) return [text];
  const out: (string | Placeholder)[] = [];
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER)) {
    const at = m.index;
    const kind = KIND_OF[m[1]!]!;
    const index = decodeIndex(m[2]!);
    let ph: Placeholder | null = null;
    if (kind === "literal") ph = { kind, char: String.fromCharCode(index) };
    else if (kind === "math" && index < prepared.maths.length) ph = { kind, index, span: prepared.maths[index]! };
    else if (kind === "footnote" && index < prepared.refs.length) ph = { kind, index, ref: prepared.refs[index]! };
    else if (kind === "section" && index === 0) ph = { kind };
    if (!ph) continue;
    if (at > last) out.push(text.slice(last, at));
    out.push(ph);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** The agent's source for `text`: every placeholder replaced by what it stands for, as written. */
export function restoreSource(text: string, prepared: Prepared): string {
  if (!hasPlaceholder(text)) return text;
  let out = "";
  for (const part of splitPlaceholders(text, prepared)) {
    if (typeof part === "string") out += part;
    else if (part.kind === "literal") out += part.char;
    else if (part.kind === "math") out += part.span.raw;
    else if (part.kind === "footnote") out += part.ref.raw;
  }
  return out;
}

// -- The pass ----------------------------------------------------------------------------------

/** Quote markers at the start of a line (`> > `), kept around block maths. */
const QUOTE_PREFIX = /^(?:[ \t]{0,3}>[ \t]?)*/;
const FENCE_OPEN = /^((?:[ \t]*>)*)[ \t]*(`{3,}|~{3,})(.*)$/;
const DEFINITION = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]?(.*)$/;
const FOOTNOTE_REF = /^\[\^([^\]\s]+)\]/;
const BLANK = /^[ \t]*$/;

interface Tables {
  maths: MathSpan[];
  refs: FootnoteRef[];
  order: string[];
  seen: Set<string>;
}

/** Whether `text` holds anything the pass may change: a maths delimiter, a backslash, a footnote,
 *  a carriage return or a private-use character. */
function needsPass(text: string): boolean {
  return text.includes("$") || text.includes("\\") || text.includes("[^") || text.includes("\r") || text.search(PRIVATE_USE) >= 0;
}

/** The pre-pass of a message's source (see the module header). */
export function prepass(text: string): Prepared {
  const tables: Tables = { maths: [], refs: [], order: [], seen: new Set() };
  const definitions = new Map<string, FootnoteDefinition>();
  // Most messages hold nothing the pass would change.
  if (!needsPass(text)) return { source: text, maths: [], refs: [], definitions, footnoteOrder: [] };
  const escaped = text.replace(/\r\n?/g, "\n").replace(PRIVATE_USE, (ch) => placeholder("literal", ch.charCodeAt(0)));
  const lines = escaped.split("\n");
  const out: string[] = [];
  /** Lines of the paragraph being gathered, scanned inline as one run (code spans and maths may
   *  cross a soft break). */
  let run: string[] = [];
  /** Whether the source ends inside a fence (a streamed message). */
  let openFence = false;
  const flush = () => {
    if (run.length > 0) out.push(...scanInline(run.join("\n"), tables).split("\n"));
    run = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    // A fence and everything up to its closing fence (or the end) pass untouched.
    const fence = FENCE_OPEN.exec(line);
    if (fence && !(fence[2]![0] === "`" && fence[3]!.includes("`"))) {
      flush();
      const marker = fence[2]!;
      out.push(line);
      i += 1;
      const close = new RegExp(`^(?:[ \\t]*>)*[ \\t]*${marker[0] === "`" ? "`" : "~"}{${marker.length},}[ \\t]*$`);
      openFence = true;
      while (i < lines.length) {
        out.push(lines[i]!);
        i += 1;
        if (close.test(lines[i - 1]!)) {
          openFence = false;
          break;
        }
      }
      continue;
    }

    if (BLANK.test(line)) {
      flush();
      out.push(line);
      i += 1;
      continue;
    }

    const display = displayMaths(lines, i);
    if (display) {
      flush();
      tables.maths.push(display.span);
      out.push(display.prefix + placeholder("math", tables.maths.length - 1));
      i = display.next;
      continue;
    }

    const definition = DEFINITION.exec(line);
    if (definition) {
      flush();
      const body = [definition[2]!];
      i += 1;
      // Lazy continuation lines, then indented paragraphs after blank lines.
      while (i < lines.length) {
        const next = lines[i]!;
        if (!BLANK.test(next)) {
          if (DEFINITION.test(next) || FENCE_OPEN.test(next)) break;
          body.push(next.replace(/^(?: {1,4}|\t)/, ""));
          i += 1;
          continue;
        }
        let k = i;
        while (k < lines.length && BLANK.test(lines[k]!)) k += 1;
        if (k < lines.length && /^(?: {4}|\t)/.test(lines[k]!)) {
          for (; i < k; i++) body.push("");
          continue;
        }
        break;
      }
      const label = definition[1]!;
      const key = footnoteKey(label);
      // The definition's own text may hold maths and references.
      const defText = scanInline(body.join("\n").replace(/\n+$/, ""), tables);
      if (!definitions.has(key)) definitions.set(key, { label, key, text: defText });
      continue;
    }

    run.push(line);
    i += 1;
  }
  flush();
  // The definitions are drawn at the end of the message, where this placeholder stands.
  if (definitions.size > 0 && !openFence) out.push("", placeholder("section", 0));
  return { source: out.join("\n"), maths: tables.maths, refs: tables.refs, definitions, footnoteOrder: tables.order };
}

/** A footnote label as matched against definitions. */
export function footnoteKey(label: string): string {
  return label.toLowerCase();
}

/** Block maths starting at line `i`: `$$` or `\[` alone on a line (behind the same quote markers)
 *  up to the closing `$$` or `\]`, or a whole line `$$ … $$` or `\[ … \]`. */
function displayMaths(lines: readonly string[], i: number): { span: MathSpan; prefix: string; next: number } | null {
  const line = lines[i]!;
  const prefix = QUOTE_PREFIX.exec(line)![0];
  const rest = line.slice(prefix.length);
  const lead = /^ {0,3}/.exec(rest)![0];
  const body = rest.slice(lead.length).replace(/[ \t]+$/, "");
  const forms: readonly [string, string][] = [
    ["$$", "$$"],
    ["\\[", "\\]"],
  ];
  for (const [open, close] of forms) {
    if (!body.startsWith(open)) continue;
    // One line: `$$ x $$`.
    if (body.length > open.length + close.length && body.endsWith(close)) {
      const tex = body.slice(open.length, -close.length);
      if (tex.trim() === "" || tex.includes(open) || tex.includes(close)) continue;
      return { span: mathSpan(tex.trim(), true, rest.trimEnd()), prefix: prefix + lead, next: i + 1 };
    }
    if (body !== open) continue;
    const texLines: string[] = [];
    for (let k = i + 1; k < lines.length; k++) {
      const next = lines[k]!;
      if (!next.startsWith(prefix) || QUOTE_PREFIX.exec(next)![0] !== prefix) return null;
      const inner = next.slice(prefix.length);
      if (BLANK.test(inner)) return null;
      if (inner.trim() === close) {
        if (texLines.length === 0) return null;
        const raw = [rest.trimEnd(), ...lines.slice(i + 1, k + 1).map((l) => l.slice(prefix.length).trimEnd())].join("\n");
        return { span: mathSpan(texLines.join("\n"), true, raw), prefix: prefix + lead, next: k + 1 };
      }
      texLines.push(inner.trim());
    }
    return null;
  }
  return null;
}

/** `literal` placeholders back to the characters the agent sent. */
function unescapeLiterals(text: string): string {
  return text.replace(PLACEHOLDER, (all, kind: string, digits: string) => (KIND_OF[kind] === "literal" ? String.fromCharCode(decodeIndex(digits)) : all));
}

function mathSpan(tex: string, display: boolean, raw: string): MathSpan {
  return { tex: unescapeLiterals(tex), display, raw: unescapeLiterals(raw) };
}

const isSpace = (ch: string | undefined) => ch === undefined || ch === " " || ch === "\t" || ch === "\n";
const isDigit = (ch: string | undefined) => ch !== undefined && ch >= "0" && ch <= "9";

/** The length of the run of `ch` at `at`. */
function runLength(text: string, at: number, ch: string): number {
  let k = at;
  while (text[k] === ch) k += 1;
  return k - at;
}

/** The end (exclusive) of the code span opening with `length` backticks before `from`, or -1. */
function codeSpanEnd(text: string, from: number, length: number): number {
  let k = from;
  while (k < text.length) {
    const at = text.indexOf("`", k);
    if (at < 0) return -1;
    const run = runLength(text, at, "`");
    if (run === length) return at + run;
    k = at + run;
  }
  return -1;
}

/** The index of the closing `$` of inline maths opening at `open`, or -1: the first unescaped
 *  `$` must close it, with no space before it and no digit after it. */
function inlineDollarClose(text: string, open: number): number {
  for (let k = open + 1; k < text.length; k++) {
    const c = text[k]!;
    if (c === "\\") {
      k += 1;
      continue;
    }
    if (c !== "$") continue;
    if (text[k + 1] === "$" || isSpace(text[k - 1]) || isDigit(text[k + 1]) || k === open + 1) return -1;
    return k;
  }
  return -1;
}

/** Inline maths, footnote references and code spans in one paragraph's text. */
function scanInline(text: string, tables: Tables): string {
  if (!/[$\\[`]/.test(text)) return text;
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === "`") {
      const run = runLength(text, i, "`");
      const end = codeSpanEnd(text, i + run, run);
      const stop = end < 0 ? i + run : end;
      out += text.slice(i, stop);
      i = stop;
      continue;
    }
    if (c === "\\") {
      if (text[i + 1] === "(") {
        const close = text.indexOf("\\)", i + 2);
        if (close > i + 2) {
          const raw = text.slice(i, close + 2);
          tables.maths.push(mathSpan(text.slice(i + 2, close), false, raw));
          out += placeholder("math", tables.maths.length - 1);
          i = close + 2;
          continue;
        }
      }
      // An escape: the backslash and the character it escapes stay together.
      out += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === "$") {
      const run = runLength(text, i, "$");
      if (run === 1 && !isSpace(text[i + 1])) {
        const close = inlineDollarClose(text, i);
        if (close > 0) {
          tables.maths.push(mathSpan(text.slice(i + 1, close), false, text.slice(i, close + 1)));
          out += placeholder("math", tables.maths.length - 1);
          i = close + 1;
          continue;
        }
      }
      out += text.slice(i, i + run);
      i += run;
      continue;
    }
    if (c === "[" && text[i + 1] === "^") {
      const ref = FOOTNOTE_REF.exec(text.slice(i, i + 256));
      if (ref) {
        const label = unescapeLiterals(ref[1]!);
        const key = footnoteKey(label);
        tables.refs.push({ label, key, raw: unescapeLiterals(ref[0]) });
        if (!tables.seen.has(key)) {
          tables.seen.add(key);
          tables.order.push(key);
        }
        out += placeholder("footnote", tables.refs.length - 1);
        i += ref[0].length;
        continue;
      }
    }
    out += c;
    i += 1;
  }
  return out;
}
