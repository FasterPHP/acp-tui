// The plain-text projection of rendered Markdown, and the map from drawn
// cells back to it (spec tui-rendering "Projection follows the rendered
// text"; tui-selection).
//
// The projection is the rows read in order (types.ts `projectRows`): what is
// drawn, without decoration (quote bars, borders, rules, the indent of a
// wrapped row), with wrapped lines rejoined as the source had them. Because a
// wrap only records what it consumed, the projection of a block does not
// depend on the width it was drawn at, so the projection of a message is
// computed once, at `PROJECTION_WIDTH`, and the rows drawn at any width map
// onto it cell for cell (`mapBlockRows`). A table's projection is its own
// (table.ts `tableProjection`): its cells carry their place in it (`Span.at`),
// since the record layout repeats and reorders them.
import { displayWidth } from "../../layout/segments.ts";
import type { ConversationGlyphs } from "../glyphs.ts";
import { blockProjection } from "./blocks.ts";
import { DEFAULT_FLAGS } from "./context.ts";
import { MessageLayout } from "./layout.ts";
import type { Row } from "./types.ts";

/** Wide enough that nothing wraps (rules are capped, see blocks.ts `rule`). */
export const PROJECTION_WIDTH = 100_000;

/** What a top-level block holds, for the projection's block list. */
export type ProjectedKind = "text" | "heading" | "code" | "table" | "list" | "quote";

const KIND_OF: Readonly<Record<string, ProjectedKind>> = {
  paragraph: "text",
  text: "text",
  html: "text",
  heading: "heading",
  code: "code",
  table: "table",
  list: "list",
  blockquote: "quote",
};

export interface ProjectedBlock {
  /** The block's token index in the message's lex (`MessageLayout.tokens`). */
  readonly index: number;
  readonly kind: ProjectedKind;
  /** `[start, end)` in the message's projection. */
  readonly start: number;
  readonly end: number;
  /** A code block's fence language (may be empty). */
  readonly lang?: string;
}

export interface MessageProjection {
  readonly text: string;
  readonly blocks: readonly ProjectedBlock[];
}

/** A fence line: its run of backticks or tildes, at most three spaces in. */
const BACKTICK_FENCE = /^ {0,3}(`{3,})[ \t]*$/;
const TILDE_FENCE = /^ {0,3}(~{3,})[ \t]*$/;

/**
 * A text that is exactly one fenced code block (a fence at its very start, its closing fence at
 * the end, blank lines after it allowed), read without marked: its language word and its code as
 * the block projects it, or null for anything else (then marked decides). The projection's fast
 * path (mvp-rendering task 9.2): a tool's text is usually one fence (`claude-agent-acp` fences
 * files and command output), and lexing thousands of them made the find's first search ten times
 * slower. A test holds it equal to the lexed projection.
 */
export function singleFence(text: string): { lang: string; code: string } | null {
  // Private-use characters (the pre-pass's escapes) and carriage returns: leave them to marked.
  if (/[-\r]/.test(text)) return null;
  const open = /^(`{3,}|~{3,})([^\n]*)\n/.exec(text);
  if (!open) return null;
  const fence = open[1]!;
  const info = open[2]!;
  if (fence[0] === "`" && info.includes("`")) return null;
  const lines = text.slice(open[0].length).split("\n");
  let end = lines.length;
  while (end > 0 && lines[end - 1]!.trim() === "") end--;
  if (end < 2) return null;
  const closing = fence[0] === "`" ? BACKTICK_FENCE : TILDE_FENCE;
  const closes = (line: string) => {
    const m = closing.exec(line);
    return m !== null && m[1]!.length >= fence.length;
  };
  if (!closes(lines[end - 1]!)) return null;
  for (let i = 0; i < end - 1; i++) if (closes(lines[i]!)) return null;
  const code = lines.slice(0, end - 1).join("\n");
  if (code.trim() === "") return null;
  return { lang: info.trim().split(/\s+/)[0] ?? "", code };
}

/**
 * What may not appear anywhere in a plain text (`plainParagraphs`): every character that can open
 * inline Markdown or a pre-pass span (emphasis, code, strikethrough, links, footnotes, HTML,
 * entities, escapes, maths, table cells), the email autolink's `@`, controls other than the line
 * feed (tabs and carriage returns included), whitespace other than the space, and private-use
 * characters (the pre-pass escapes them).
 */
const NOT_PLAIN = /[`*_~[\]<&\\$|@\u0000-\u0009\u000b-\u001f\u007f\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\ue000-\uf8ff\udb80-\udbff]|:\/\/|www\./i;
/** A line that could open a block (a heading, quote, list item, rule, setext underline or
 *  indented code) or a definition list's definition (inline.ts draws it on a row of its own), or
 *  that ends in whitespace (a hard break). */
const NOT_PLAIN_LINE = /^(?:[\s#>=+:-]|\d{1,9}[.)])|\s$/;
/** Longer lines are left to marked (well under `PROJECTION_WIDTH`, so nothing wraps). */
const PLAIN_LINE_MAX = 10_000;

/**
 * A text with no Markdown in it, projected without lexing (the plain-text fast path of the find's
 * first search, for tool output an agent sends unfenced): paragraphs of lines that cannot open a
 * block or an inline span, separated by blank lines. Marked makes each run of lines one paragraph,
 * a soft break drawn as a space, and the renderers draw the text as it is; the projection is the
 * paragraphs' lines joined by spaces, one blank line between paragraphs, and each paragraph's
 * token index counts the `space` tokens marked puts between them. Null for anything else (then
 * marked decides). A test holds it equal to the lexed projection.
 */
export function plainParagraphs(text: string): MessageProjection | null {
  if (NOT_PLAIN.test(text)) return null;
  const lines = text.split("\n");
  const blocks: ProjectedBlock[] = [];
  let out = "";
  let index = lines[0] === "" ? 1 : 0;
  let paragraph: string[] = [];
  const close = () => {
    if (paragraph.length === 0) return;
    if (blocks.length > 0) out += "\n\n";
    const start = out.length;
    out += paragraph.join(" ");
    blocks.push({ index, kind: "text", start, end: out.length });
    index += 2;
    paragraph = [];
  };
  for (const line of lines) {
    if (line === "") {
      close();
      continue;
    }
    if (line.length > PLAIN_LINE_MAX || NOT_PLAIN_LINE.test(line)) return null;
    paragraph.push(line);
  }
  close();
  return { text: out, blocks };
}

/** A message's projection: its blocks' projections, a blank line for each blank row between
 *  them. Rules and blocks that draw nothing are left out. With `fast`, a text that is exactly one
 *  fence (`singleFence`), or plain text with no Markdown in it (`plainParagraphs`), is projected
 *  without lexing. */
export function projectMessage(source: string, glyphs: ConversationGlyphs, cache = true, fast = true): MessageProjection {
  const fence = fast ? singleFence(source) : null;
  if (fence) return { text: fence.code, blocks: [{ index: 0, kind: "code", start: 0, end: fence.code.length, lang: fence.lang }] };
  const plain = fast ? plainParagraphs(source) : null;
  if (plain) return plain;
  const layout = new MessageLayout(source, PROJECTION_WIDTH, glyphs, DEFAULT_FLAGS, cache);
  let text = "";
  let any = false;
  const blocks: ProjectedBlock[] = [];
  for (const block of layout.blocks()) {
    if (block.rows.every((row) => row.decorative)) continue;
    const own = blockProjection(block.token, block.rows, layout.ctx);
    if (any) text += "\n" + "\n".repeat(block.marginTop);
    any = true;
    const start = text.length;
    text += own;
    const kind = KIND_OF[block.token.type] ?? "text";
    const lang = block.token.type === "code" ? ((block.token as { lang?: string }).lang ?? "").trim().split(/\s+/)[0] ?? "" : undefined;
    blocks.push(lang === undefined ? { index: block.index, kind, start, end: text.length } : { index: block.index, kind, start, end: text.length, lang });
  }
  return { text, blocks };
}

/** One drawn row mapped onto the projection. */
export interface RowCells {
  /** Per display column: the projection offset of the character drawn there, or -1. */
  readonly from: number[];
  /** Per display column: the offset just after that character, or -1. */
  readonly to: number[];
  /** Where a pointer left of the row's text resolves to. */
  readonly start: number;
  /** Where a pointer right of the row's text resolves to. */
  readonly end: number;
  /** The row stands for an empty projection line (a blank line inside the block) at `start`. */
  readonly blank: boolean;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * The cells of `rows` (one block, drawn at some width) mapped onto `text`, the block's
 * projection, which starts at `base` in the message's: one entry per row, null for a decorative
 * row. Null when the rows read in order do not give `text` (they always do; the check keeps a
 * mismatch from mapping wrong characters). With `positioned` (a table), spans map from their
 * `at` and the order of the rows is not checked.
 */
export function mapBlockRows(rows: readonly Row[], text: string, base: number, positioned = false): (RowCells | null)[] | null {
  const out: (RowCells | null)[] = [];
  let read = "";
  let first = true;
  for (const row of rows) {
    if (row.decorative) {
      out.push(null);
      continue;
    }
    if (!first) read += row.joined ?? "\n";
    first = false;
    const rowStart = read.length;
    const from: number[] = [];
    const to: number[] = [];
    let lo = Infinity;
    let hi = -Infinity;
    for (const span of row.spans) {
      const shown = span.projection ?? span.text;
      if (span.at !== undefined && span.projection !== undefined && span.projection !== "") {
        // A placed span drawn differently from its projection (a link's host): every cell stands
        // for the whole of it.
        const a = base + span.at;
        for (let c = 0; c < displayWidth(span.text); c++) {
          from.push(a);
          to.push(a + span.projection.length);
        }
        lo = Math.min(lo, a);
        hi = Math.max(hi, a + span.projection.length);
      } else if (span.at !== undefined) {
        let k = 0;
        for (const { segment } of graphemes.segment(span.text)) {
          const a = base + span.at + k;
          for (let c = 0; c < displayWidth(segment); c++) {
            from.push(a);
            to.push(a + segment.length);
          }
          lo = Math.min(lo, a);
          hi = Math.max(hi, a + segment.length);
          k += segment.length;
        }
      } else if (shown === "") {
        for (let c = 0; c < displayWidth(span.text); c++) {
          from.push(-1);
          to.push(-1);
        }
      } else if (span.projection !== undefined) {
        // Drawn differently from its projection: every cell stands for the whole of it.
        const a = base + read.length;
        for (let c = 0; c < displayWidth(span.text); c++) {
          from.push(a);
          to.push(a + shown.length);
        }
        lo = Math.min(lo, a);
        hi = Math.max(hi, a + shown.length);
      } else {
        let k = 0;
        for (const { segment } of graphemes.segment(span.text)) {
          const a = base + read.length + k;
          for (let c = 0; c < displayWidth(segment); c++) {
            from.push(a);
            to.push(a + segment.length);
          }
          lo = Math.min(lo, a);
          hi = Math.max(hi, a + segment.length);
          k += segment.length;
        }
      }
      if (span.at === undefined) read += shown;
    }
    const empty = lo === Infinity;
    const lineStart = base + rowStart;
    out.push({
      from,
      to,
      start: empty ? lineStart : Math.min(lo, row.joined === undefined && !positioned ? lineStart : lo),
      end: empty ? (positioned ? lineStart : base + read.length) : hi,
      blank: empty && !positioned && read.length === rowStart,
    });
  }
  if (!positioned && read !== text) return null;
  return out;
}
