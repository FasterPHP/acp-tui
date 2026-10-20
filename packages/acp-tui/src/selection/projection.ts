// The plain-text projection of each conversation item; design of record 6.3
// "What is copied"; decision 11, research/full-screen-synthesis.md section 4.
//
// One string per model item: the text a user expects to copy, "as rendered
// but without decoration" (design 6.3). Selection (task 14.2) holds its ends
// as (item, offset) positions in these strings, copy (14.3) and `y` read them,
// find (15.1, `src/find/index.ts`) searches them, and the exit print (15.4)
// joins them. Pure: no OpenTUI, no Solid; the only imports are type-only or
// pure helpers (`diff.ts`, `displayWidth`). Agent text is already sanitised by
// acp-model; nothing here adds an escape sequence.
//
// Per item kind:
//
// - User message: its text (trailing newlines dropped, as the card shows it).
// - Agent message: its Markdown as acp-tui's renderers draw it, without
//   decoration (markdown-text.ts, conversation/markdown/project.ts). The
//   Markdown source is what `Y` and the export give (export.ts), not the
//   projection.
// - Thought: its body as the expanded card renders it: Markdown, projected
//   like an agent message's (mvp-rendering task 9.4).
// - Tool call: the title line (the title alone: no kind glyph, status icon,
//   kind column, summary or index), then each content block after a blank
//   line: text as the card renders it, Markdown projected like an agent
//   message's (a text that is one fence gives the code alone; mvp-rendering
//   task 9.2), whole even when the card shows a snippet; a text that is a command result
//   (command-result.ts) as drawn, labels included: `Output: <line>` or `Output:` and each line
//   indented two spaces, then `Return code: <code>`, in two blocks (`result`, `return_code`);
//   a call with no content gives its raw output text the same way; a diff as unified
//   diff text (`---`/`+++` file headers, `@@` hunk headers, lines signed with
//   `+`, `-` or a space, no line numbers; `diff.ts`), and for `terminal`
//   content the notice the card shows. Each block records its content
//   block's index (`content`), for the card's row maps.
// - Plan: one `- <entry>` line per entry (no status glyphs).
// - Permission record: `Permission (<outcome>): <title>`.
// - Marker: an error as `error: <text>` and a notice as its text, as drawn;
//   a turn end projects to the empty string, because it is status chrome
//   (stop reason, duration, context gauge), not conversation content, so
//   copies, find and the transcript skip it.
//
// Offsets are UTF-16 code unit offsets into `Projection.text` (what
// `String.prototype.slice` takes), from 0 to `text.length`. Lines are
// separated by a single `\n`, with no trailing newline.
//
// A range across items is the tail of its first item from the start offset,
// every item between in full, and the head of its last item to the end
// offset, joined with one blank line (`\n\n`) between items; parts that come
// out empty are skipped. With `collapsed`, a collapsed item contributes only
// what its one-liner shows: its text up to `summaryEnd` (a tool call's title,
// a thought's first line), except a collapsed plan, whose line shows only a
// count (`summaryEnd` 0): covered whole, it contributes its entries. A closed
// group line hides collapsed members, so a range across it holds each
// member's summary text.
import type { Item, PermissionRecordItem, ToolCallItem } from "acp-model";
import { commandResult, resultProjectionLines, toolContent } from "../conversation/command-result.ts";
import { glyphsVersion } from "../conversation/live-glyphs.ts";
import { unifiedDiff } from "../conversation/diff.ts";
import { WITHDRAWN_LABEL } from "../conversation/format.ts";
import type { MessageProjection } from "../conversation/markdown/project.ts";
import { markdownProjection, type MarkdownBlockKind } from "./markdown-text.ts";

/** The notice for `terminal` content; equal to `TERMINAL_UNAVAILABLE_NOTICE` in
 *  `conversation/format.ts` (checked by a test; not imported, since format.ts pulls in the theme). */
export const TERMINAL_NOTICE = "terminal output unavailable (client terminals not supported)";

export type ProjectionBlockKind =
  | MarkdownBlockKind
  /** A tool call's title line. */
  | "title"
  /** A tool call's text content. */
  | "output"
  /** A recognised command result's output lines (`Output: ...`, command-result.ts). */
  | "result"
  /** A recognised command result's `Return code: <code>` line. */
  | "return_code"
  /** A tool call's diff, as unified diff text. */
  | "diff"
  /** A tool call's `terminal` content notice. */
  | "notice"
  /** A plan's entries. */
  | "plan";

/** A span of the projection: `[start, end)`, whole lines, blank separator lines outside. */
export interface ProjectionBlock {
  readonly kind: ProjectionBlockKind;
  readonly start: number;
  readonly end: number;
  /** A code block's fence language (may be empty). */
  readonly lang?: string;
  /** An agent message's block: its token index in the message's lex (the selection's row maps
   *  find a drawn block's text by it). */
  readonly token?: number;
  /** A tool call's block: the index of the content block it projects. */
  readonly content?: number;
}

export interface Projection {
  readonly text: string;
  readonly blocks: readonly ProjectionBlock[];
  /** Where the text the collapsed one-liner shows ends: the title line of a tool call, the first
   *  line of a thought, 0 for a plan (its line shows only a count); `text.length` for kinds that
   *  never collapse. */
  readonly summaryEnd: number;
}

/** A position in the projection: the ends of a selection (task 14.2). */
export interface TextPosition {
  readonly itemId: string;
  readonly offset: number;
}

/** A selection as dragged: `anchor` where it started, `focus` where it is now (either order). */
export interface TextRange {
  readonly anchor: TextPosition;
  readonly focus: TextPosition;
}

export type ItemLookup = (id: string) => Item | undefined;

/** A lookup over the model's map or the store's record. */
export function lookupOf(items: ReadonlyMap<string, Item> | Readonly<Record<string, Item>>): ItemLookup {
  if (items instanceof Map) return (id) => items.get(id);
  const record = items as Readonly<Record<string, Item>>;
  return (id) => record[id];
}

// -- Building --------------------------------------------------------------------------------

class Builder {
  private readonly parts: string[] = [];
  private length = 0;
  private lines = 0;
  readonly blocks: ProjectionBlock[] = [];

  private line(text: string): void {
    if (this.lines > 0) {
      this.parts.push("\n");
      this.length += 1;
    }
    this.parts.push(text);
    this.length += text.length;
    this.lines += 1;
  }

  /** A blank line (only between blocks). */
  blank(): void {
    if (this.lines > 0) this.line("");
  }

  block(kind: ProjectionBlockKind, lines: readonly string[], content?: number): void {
    if (lines.length === 0) return;
    const start = this.lines > 0 ? this.length + 1 : 0;
    for (const text of lines) this.line(text);
    this.blocks.push(content === undefined ? { kind, start, end: this.length } : { kind, start, end: this.length, content });
  }

  /** A Markdown projection as the next lines, its blocks with their token indices (and the tool
   *  content block they project). */
  markdown(projection: MessageProjection, content?: number): void {
    if (projection.text === "") return;
    if (this.lines > 0) {
      this.parts.push("\n");
      this.length += 1;
    }
    const base = this.length;
    this.parts.push(projection.text);
    this.length += projection.text.length;
    this.lines += projection.text.split("\n").length;
    for (const b of projection.blocks) {
      const block: ProjectionBlock = { kind: b.kind, start: base + b.start, end: base + b.end, token: b.index };
      const placed = content === undefined ? block : { ...block, content };
      this.blocks.push(b.lang === undefined ? placed : { ...placed, lang: b.lang });
    }
  }

  get offset(): number {
    return this.length;
  }

  done(summaryEnd?: number): Projection {
    const text = this.parts.join("");
    return { text, blocks: this.blocks, summaryEnd: summaryEnd ?? text.length };
  }
}

function textLines(text: string): string[] {
  const trimmed = text.replace(/\n+$/, "");
  return trimmed === "" ? [] : trimmed.split("\n");
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** A tool call's title line: the title, else its kind, else `tool`. */
export function toolTitle(item: ToolCallItem): string {
  return oneLine(item.title) || oneLine(item.toolKind ?? item.toolName ?? "") || "tool";
}

const OUTCOME_LABELS: Readonly<Record<string, string>> = {
  allow_once: "allow once",
  allow_always: "allow always",
  reject_once: "reject once",
  reject_always: "reject always",
};

/** A permission record's outcome as a label (`allow once`, `pending`, `cancelled`). */
export function outcomeLabel(item: PermissionRecordItem): string {
  const outcome = item.outcome;
  return outcome.type === "answered" ? (OUTCOME_LABELS[outcome.optionKind] ?? oneLine(outcome.optionKind)) : outcome.type === "withdrawn" ? WITHDRAWN_LABEL : outcome.type;
}

/** An agent message's Markdown as drawn (markdown-text.ts), into a fresh builder. */
function projectMarkdown(builder: Builder, source: string, cache: boolean): void {
  builder.markdown(markdownProjection(source, cache));
}

/** The plain-text projection of one item (see the module header). */
export function projectItem(item: Item): Projection {
  const b = new Builder();
  switch (item.kind) {
    case "user_message":
      b.block("text", textLines(item.text));
      return b.done();
    case "agent_message":
      projectMarkdown(b, item.text, item.status !== "live");
      return b.done();
    case "thought": {
      projectMarkdown(b, item.text, item.status !== "live");
      const text = b.done().text;
      const firstLine = text.indexOf("\n");
      return b.done(firstLine < 0 ? text.length : firstLine);
    }
    case "tool_call": {
      b.block("title", [toolTitle(item)]);
      const summaryEnd = b.offset;
      toolContent(item).forEach((content, index) => {
        b.blank();
        switch (content.type) {
          case "text": {
            const result = commandResult(content.text, item.toolKind, item.toolStatus);
            if (result) {
              const lines = resultProjectionLines(result);
              b.block("result", lines.output, index);
              b.block("return_code", [lines.code], index);
              break;
            }
            const projection = markdownProjection(content.text, item.status !== "live");
            if (projection.text === "") b.block("output", [""], index);
            else b.markdown(projection, index);
            break;
          }
          case "diff":
            b.block(
              "diff",
              unifiedDiff(content.path, content.oldText, content.newText).map((line) => line.text),
              index,
            );
            break;
          case "terminal_unavailable":
            b.block("notice", [TERMINAL_NOTICE], index);
            break;
        }
      });
      return b.done(summaryEnd);
    }
    case "plan":
      b.block("plan", item.entries.map((entry) => `- ${oneLine(entry.content)}`));
      // The collapsed line (`plan 3/4`) shows none of the entries.
      return b.done(0);
    case "permission_record":
      b.block("text", [`Permission (${outcomeLabel(item)}): ${oneLine(item.title) || item.toolCallId}`]);
      return b.done();
    case "marker":
      if (item.markerKind === "turn_end") return b.done();
      b.block("text", textLines(item.markerKind === "error" ? `error: ${item.text}` : item.text));
      return b.done();
  }
}

// -- Cache -----------------------------------------------------------------------------------

/**
 * Projections cached per item version. The reducer (and the store, which replaces item
 * references and never writes into one) gives a changed item a new object, so the object is the
 * version: an entry is reused while `lookup(id)` returns the same object. `computed` counts the
 * projections built, for tests of incremental updates.
 */
export class ProjectionCache {
  private readonly entries = new Map<string, { item: Item; projection: Projection }>();
  computed = 0;
  /** The glyph set the entries were projected with: a bullet is in the copy text, so a reload that
   *  changes `glyphs` drops them. */
  private glyphs = glyphsVersion();

  get(item: Item): Projection {
    const glyphs = glyphsVersion();
    if (glyphs !== this.glyphs) {
      this.entries.clear();
      this.glyphs = glyphs;
    }
    const entry = this.entries.get(item.id);
    if (entry && entry.item === item) return entry.projection;
    const projection = projectItem(item);
    this.computed += 1;
    this.entries.set(item.id, { item, projection });
    return projection;
  }

  /** Drops entries for items no longer in `order` (items are rarely removed; call when it shrinks). */
  prune(order: readonly string[]): void {
    if (this.entries.size <= order.length) return;
    const keep = new Set(order);
    for (const id of this.entries.keys()) if (!keep.has(id)) this.entries.delete(id);
  }

  get size(): number {
    return this.entries.size;
  }
}

// -- Positions -------------------------------------------------------------------------------

/** `offset` clamped into `[0, text.length]`. */
export function clampOffset(projection: Projection, offset: number): number {
  return Math.max(0, Math.min(projection.text.length, Math.floor(offset)));
}

/** Offsets of the first character of each line. */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) starts.push(at + 1);
  return starts;
}

/** Line (0-based) and column (code units into the line) of `offset`. */
export function lineColumnAt(projection: Projection, offset: number): { line: number; column: number } {
  const at = clampOffset(projection, offset);
  const starts = lineStarts(projection.text);
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= at) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, column: at - starts[lo]! };
}

/** The offset of `line` and `column`, both clamped (a column past the line's end gives its end). */
export function offsetAt(projection: Projection, line: number, column: number): number {
  const starts = lineStarts(projection.text);
  const l = Math.max(0, Math.min(starts.length - 1, line));
  const lineEnd = l + 1 < starts.length ? starts[l + 1]! - 1 : projection.text.length;
  return Math.max(starts[l]!, Math.min(lineEnd, starts[l]! + Math.max(0, column)));
}

/** The block holding `offset`, or null on a blank separator line. */
export function blockAt(projection: Projection, offset: number): ProjectionBlock | null {
  const at = clampOffset(projection, offset);
  for (const block of projection.blocks) if (at >= block.start && at <= block.end) return block;
  return null;
}

/** The text between two offsets of one item (either order). */
export function textBetween(projection: Projection, a: number, b: number): string {
  const from = clampOffset(projection, Math.min(a, b));
  const to = clampOffset(projection, Math.max(a, b));
  return projection.text.slice(from, to);
}

// -- Ranges, items and the conversation ------------------------------------------------------

export interface JoinOptions {
  /** Projections to reuse (the find index and the selection share one). */
  readonly cache?: ProjectionCache;
  /** Items shown collapsed (or hidden behind a closed group line): inside a range they give only
   *  their summary text, and a plan its entries when covered whole. */
  readonly collapsed?: (itemId: string) => boolean;
}

function projectionOf(item: Item, options: JoinOptions | undefined): Projection {
  return options?.cache ? options.cache.get(item) : projectItem(item);
}

/** The range's ends in conversation order, or null when an end is not in `order`. */
export function orderedEnds(order: readonly string[], range: TextRange): { start: TextPosition; end: TextPosition; startIndex: number; endIndex: number } | null {
  const a = order.indexOf(range.anchor.itemId);
  const f = order.indexOf(range.focus.itemId);
  if (a < 0 || f < 0) return null;
  const anchorFirst = a < f || (a === f && range.anchor.offset <= range.focus.offset);
  return anchorFirst
    ? { start: range.anchor, end: range.focus, startIndex: a, endIndex: f }
    : { start: range.focus, end: range.anchor, startIndex: f, endIndex: a };
}

/**
 * How far into a collapsed item's projection a range may reach: its summary end, or for a
 * collapsed plan covered whole (from its start to its end) all of it; the whole text when the
 * item is drawn expanded.
 */
function visibleEnd(item: Item, projection: Projection, from: number, to: number, options: JoinOptions | undefined): number {
  if (!options?.collapsed?.(item.id)) return projection.text.length;
  if (item.kind === "plan" && from <= 0 && to >= projection.text.length) return projection.text.length;
  return projection.summaryEnd;
}

/** The text of a range across items (see the module header); empty when an end is unknown. */
export function rangeText(order: readonly string[], lookup: ItemLookup, range: TextRange, options?: JoinOptions): string {
  const ends = orderedEnds(order, range);
  if (!ends) return "";
  const parts: string[] = [];
  for (let k = ends.startIndex; k <= ends.endIndex; k++) {
    const id = order[k]!;
    const item = lookup(id);
    if (!item) continue;
    const projection = projectionOf(item, options);
    const from = k === ends.startIndex ? ends.start.offset : 0;
    const to = k === ends.endIndex ? ends.end.offset : projection.text.length;
    const part = textBetween(projection, from, Math.max(from, Math.min(to, visibleEnd(item, projection, from, to, options))));
    if (part !== "") parts.push(part);
  }
  return parts.join("\n\n");
}

/** One item's copy text (`y`): its whole projection. */
export function itemText(item: Item, cache?: ProjectionCache): string {
  return (cache ? cache.get(item) : projectItem(item)).text;
}

/** Every item's projection in order, joined with a blank line; empty projections skipped. */
export function conversationText(order: readonly string[], lookup: ItemLookup, options?: Pick<JoinOptions, "cache">): string {
  const parts: string[] = [];
  for (const id of order) {
    const item = lookup(id);
    if (!item) continue;
    const text = projectionOf(item, options).text;
    if (text !== "") parts.push(text);
  }
  return parts.join("\n\n");
}

/** The last agent message's projection, or null (for `--exit-print last-answer`, task 15.4). */
export function lastAnswerText(order: readonly string[], lookup: ItemLookup, options?: Pick<JoinOptions, "cache">): string | null {
  for (let k = order.length - 1; k >= 0; k--) {
    const item = lookup(order[k]!);
    if (item?.kind === "agent_message") {
      const text = projectionOf(item, options).text;
      if (text !== "") return text;
    }
  }
  return null;
}
