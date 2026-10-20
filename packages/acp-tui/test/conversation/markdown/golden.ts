// Golden rows of rendered Markdown (mvp-rendering tasks 4.2 to 5.2): the rows acp-tui's
// renderers give for each sample of fake-agent's `markdown-gallery`, in a text format a reviewer
// can read, held per gallery tag in `test/conversation/golden/`.
//
// Each drawn row is two lines: the text between bars, then its runs of style, each run opened by
// «token flags» (flags: +b bold, +i italic, +u underline, +d dim, +s struck, ~ decoration (not
// projected), ->target a link, bg:token a fill, =text an emoji drawn as its name and projected as
// the emoji, task 14.5). A row the projection leaves out is marked
// (decorative); a blank row between blocks shows as an empty pair of bars.
//
// Regenerate with `UPDATE_GOLDEN=1 bun test packages/acp-tui/test/conversation/markdown/golden.test.ts`
// and review the diff against docs/phase-1a-notes/markdown-audit.md section 3.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_GLYPHS, type ConversationGlyphs } from "../../../src/conversation/glyphs.ts";
import type { Tokens } from "marked";
import { isFootnoteSection } from "../../../src/conversation/markdown/footnotes.ts";
import { DEFAULT_FLAGS, type MarkdownFlags } from "../../../src/conversation/markdown/context.ts";
import { MessageLayout } from "../../../src/conversation/markdown/layout.ts";
import { rowText, type Row, type Span } from "../../../src/conversation/markdown/types.ts";

export const GALLERY_PATH = join(import.meta.dir, "../../../../fake-agent/src/scenarios/markdown-gallery.md");
export const GOLDEN_DIR = join(import.meta.dir, "../golden");

export function gallerySource(): string {
  return readFileSync(GALLERY_PATH, "utf8");
}

function runLabel(span: Span): string {
  const flags = [
    span.bold ? "+b" : "",
    span.italic ? "+i" : "",
    span.underline ? "+u" : "",
    span.dim ? "+d" : "",
    span.strike ? "+s" : "",
    span.projection === "" ? "~" : "",
    span.link ? `->${span.link.href}` : "",
    span.fill ? `bg:${span.fill}` : "",
    span.named && span.projection ? `=${span.projection}` : "",
  ].filter(Boolean);
  return `«${[span.token, ...flags].join(" ")}»`;
}

/** One row as its text line and its style line. */
export function formatRow(row: Row | null, n: number): string {
  if (!row || (row.spans.length === 0 && !row.label)) return `${String(n).padStart(3)} ││`;
  const text = rowText(row) + (row.label ? `  [label ${runLabel(row.label)}${row.label.text}]` : "");
  let styled = "";
  let last = "";
  for (const span of row.spans) {
    const label = runLabel(span);
    styled += (label === last ? "" : label) + span.text;
    last = label;
  }
  const flags = [row.decorative ? "(decorative)" : "", row.fill ? `(bg:${row.fill})` : ""].filter(Boolean).join(" ");
  return `${String(n).padStart(3)} │${text}│${flags ? ` ${flags}` : ""}\n    ${styled}`;
}

/** The rows of a message laid out at `width`, blank rows between blocks as null; `section` is the
 *  first row of the footnote definitions drawn at its end (blank rows above it included), or -1. */
export function messageRows(source: string, width: number, glyphs: ConversationGlyphs = DEFAULT_GLYPHS, flags: MarkdownFlags = DEFAULT_FLAGS): { rows: (Row | null)[]; starts: number[]; section: number } {
  const rows: (Row | null)[] = [];
  const starts: number[] = [];
  let section = -1;
  const layout = new MessageLayout(source, width, glyphs, flags);
  for (const block of layout.blocks()) {
    if (block.token.type === "paragraph" && isFootnoteSection(block.token as Tokens.Paragraph, layout.ctx)) section = rows.length;
    for (let k = 0; k < block.marginTop; k++) rows.push(null);
    starts.push(rows.length);
    rows.push(...block.rows);
  }
  return { rows, starts, section };
}

/** Rows formatted, numbered from 1. */
export function formatRows(rows: readonly (Row | null)[]): string {
  return rows.map((row, i) => formatRow(row, i + 1)).join("\n");
}

const TAG = /^M\d\d /;

/** The gallery's rows in a pane `width` columns wide (behind the agent gutter), split per sample
 *  tag (`M01`, ...): from the block whose first
 *  row starts with the tag to the next tagged block, blank rows before it left out. The footnote
 *  definitions, drawn at the end of the message, belong to the tag of the footnotes sample
 *  (`FOOTNOTE_TAG`): they follow its own rows, a blank row between, and not the last tag's. */
export function galleryByTag(width: number, source = gallerySource(), flags: MarkdownFlags = DEFAULT_FLAGS): Map<string, (Row | null)[]> {
  const all = messageRows(source, width - DEFAULT_GLYPHS.gutterWidth, DEFAULT_GLYPHS, flags);
  const rows = all.section < 0 ? all.rows : all.rows.slice(0, all.section);
  const starts = all.starts.filter((s) => s < rows.length);
  const out = new Map<string, (Row | null)[]>();
  let tag: string | null = null;
  let from = 0;
  const close = (to: number) => {
    if (tag === null) return;
    const part = rows.slice(from, to);
    while (part.length > 0 && part[part.length - 1] === null) part.pop();
    out.set(tag, part);
  };
  for (const start of starts) {
    const first = rows[start];
    const text = first ? rowText(first) : "";
    if (!TAG.test(text)) continue;
    close(start);
    tag = text.slice(0, 3);
    from = start;
  }
  close(rows.length);
  const footnotes = out.get(FOOTNOTE_TAG);
  if (all.section >= 0 && footnotes) {
    const section = all.rows.slice(all.section);
    while (section[0] === null) section.shift();
    out.set(FOOTNOTE_TAG, [...footnotes, null, ...section]);
  }
  return out;
}

/** The gallery's footnotes sample, whose golden rows include the definitions. */
export const FOOTNOTE_TAG = "M25";

/** A tag's golden file: its rows at each width. */
export function goldenText(tag: string, widths: readonly number[], byWidth: ReadonlyMap<number, Map<string, (Row | null)[]>>, terminal?: string): string {
  const parts = [`${tag} (markdown-gallery), rendered rows${terminal ? ` ${terminal}` : ""}; see test/conversation/markdown/golden.ts for the format.`];
  for (const width of widths) {
    parts.push("", `in a pane ${width} columns wide (${width - DEFAULT_GLYPHS.gutterWidth} behind the agent gutter):`, formatRows(byWidth.get(width)?.get(tag) ?? []));
  }
  return parts.join("\n") + "\n";
}
