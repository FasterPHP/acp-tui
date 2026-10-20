// The per-item, per-width height cache (design of record 6.2). The windowed list mounts only a slice
// of the conversation; every entry outside it is part of a spacer whose height
// is the sum of the entries' heights. An entry's height is its measured height
// (from Yoga, recorded after every layout while it is mounted) when one was
// recorded at the current width for the same version of the entry, and an
// estimate otherwise.
//
// - Per width: measurements are kept per terminal width; a lookup at another
//   width misses (falls back to the estimate), so a resize invalidates every
//   measurement at once without clearing it. The most recent `retainWidths`
//   widths are kept, so resizing back reuses what was measured before.
// - Per version: a measurement holds the entry's version: the model item it
//   drew (items are immutable; a changed item is a new object) and a variant
//   string for the view state that changes the height (expanded or not, the
//   flat theme's card rule). A lookup with another version misses.
// - Estimates (`estimateHeight`) are pure and cheap: one row per collapsed
//   one-liner; messages, thoughts and tool cards from the layouts they are
//   drawn from (markdown/layout.ts, card.ts), so they are exact. Anchor
//   compensation (range.ts, scroll.ts) hides any difference when a chunk
//   mounts.
import type { Item } from "acp-model";
import { displayWidth } from "../../layout/segments.ts";
import { thoughtCardLayout, toolCardHeight } from "../card.ts";
import { expandTabs, wrapWords } from "../content.ts";
import { toolTitleShown } from "../format.ts";
import type { ConversationGlyphs } from "../glyphs.ts";
import { LIVE_GLYPHS } from "../live-glyphs.ts";
import { cardPadding, terminalFlags } from "../markdown/context.ts";
import { MessageLayout } from "../markdown/layout.ts";

/** What a measurement is valid for, besides the key and the width. */
export interface HeightVersion {
  /** The model item drawn (compared by reference), or null for entries without one. */
  readonly ref: unknown;
  /** View state that changes the height, e.g. `expanded` or `collapsed`. */
  readonly variant: string;
}

interface Measured {
  readonly ref: unknown;
  readonly variant: string;
  readonly height: number;
}

export class HeightCache {
  /** Measurements per width, the most recently used width last. */
  private readonly widths = new Map<number, Map<string, Measured>>();
  /** The most recently used width (a lookup there needs no reordering). */
  private recent: number | null = null;

  constructor(private readonly retainWidths = 2) {}

  private at(width: number, create: boolean): Map<string, Measured> | undefined {
    let map = this.widths.get(width);
    if (map) {
      // Most recently used last.
      if (this.recent !== width) {
        this.widths.delete(width);
        this.widths.set(width, map);
        this.recent = width;
      }
      return map;
    }
    if (!create) return undefined;
    map = new Map();
    this.widths.set(width, map);
    this.recent = width;
    while (this.widths.size > this.retainWidths) this.widths.delete(this.widths.keys().next().value!);
    return map;
  }

  /** The measured height for this key, width and version, or null. */
  measured(key: string, width: number, version: HeightVersion): number | null {
    const m = this.at(width, false)?.get(key);
    return m && m.ref === version.ref && m.variant === version.variant ? m.height : null;
  }

  /** The measured height, or `estimate()` when there is none for this width and version. */
  get(key: string, width: number, version: HeightVersion, estimate: () => number): number {
    return this.measured(key, width, version) ?? estimate();
  }

  /** Records a measured height; true when it differs from what `get` returned before. */
  measure(key: string, width: number, version: HeightVersion, height: number): boolean {
    const map = this.at(width, true)!;
    const before = map.get(key);
    if (before && before.ref === version.ref && before.variant === version.variant && before.height === height) return false;
    map.set(key, { ref: version.ref, variant: version.variant, height });
    return true;
  }

  /** Measurements held at `width` (tests, diagnostics). */
  size(width: number): number {
    return this.widths.get(width)?.size ?? 0;
  }

  /** Widths held, least recently used first. */
  heldWidths(): number[] {
    return [...this.widths.keys()];
  }
}

/** Display rows of `text` wrapped at `width` columns (a blank line is one row). */
export function wrappedRows(text: string, width: number): number {
  const w = Math.max(1, width);
  let rows = 0;
  for (const line of text.split("\n")) {
    const cols = displayWidth(expandTabs(line));
    rows += cols === 0 ? 1 : Math.ceil(cols / w);
  }
  return rows;
}

/** The characters OpenTUI 0.5.12's word wrap may break after (besides spaces), found by probing
 *  `<text wrapMode="word">` with every ASCII punctuation character. */
const BREAK_AFTER = "!(),\\-./:;?[\\\\\\]{}";
/** Wide East Asian characters, each of which OpenTUI's word wrap may break before and after. */
const WIDE = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}\\u3000-\\u303f";
/** A line's pieces for `wordWrappedRows`: a run of spaces, one wide character, or a run of other
 *  characters up to and including a break character, or a run with none. */
const PIECES = new RegExp(` +|[${WIDE}]|[^ ${BREAK_AFTER}${WIDE}]*[${BREAK_AFTER}]|[^ ${BREAK_AFTER}${WIDE}]+`, "gu");
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Display rows of `text` drawn by OpenTUI's `<text wrapMode="word">` at `width` columns (the user
 * card): greedy, breaking at spaces and after the characters in `BREAK_AFTER`, a piece that does
 * not fit moved to the next row and broken by character only when it is wider than a row, spaces
 * at the end of a row never starting one. A test holds it equal to OpenTUI's layout.
 */
export function wordWrappedRows(text: string, width: number): number {
  const w = Math.max(1, width);
  let rows = 0;
  for (const line of text.split("\n")) {
    rows += 1;
    let used = 0;
    for (const piece of expandTabs(line).match(PIECES) ?? []) {
      const pw = displayWidth(piece);
      if (piece.startsWith(" ")) {
        used = Math.min(w, used + pw);
        continue;
      }
      if (used + pw <= w) {
        used += pw;
        continue;
      }
      if (used > 0) {
        rows += 1;
        used = 0;
      }
      if (pw <= w) {
        used = pw;
        continue;
      }
      for (const { segment } of graphemes.segment(piece)) {
        const cw = displayWidth(segment);
        if (used + cw > w && used > 0) {
          rows += 1;
          used = 0;
        }
        used += cw;
      }
    }
  }
  return rows;
}

/** Display rows of prose wrapped at spaces, as an expanded thought's card wraps it (`wrapWords`). */
export function wordRows(text: string, width: number): number {
  let rows = 0;
  for (const line of text.split("\n")) rows += line === "" ? 1 : wrapWords([{ text: line, token: "thought" }], width).length;
  return rows;
}

/**
 * Rows of an agent message's Markdown at `width` columns (behind the gutter): exactly what
 * acp-tui's renderers draw (mvp-rendering; conversation/markdown/layout.ts), at least one row
 * (the gutter's).
 */
export function markdownRows(text: string, width: number, glyphs: ConversationGlyphs = LIVE_GLYPHS, cache = true): number {
  return Math.max(1, new MessageLayout(text, width, glyphs, terminalFlags(), cache).height());
}

export interface EstimateOptions {
  readonly glyphs?: ConversationGlyphs;
  /** The flat theme draws a rule and a space on the left of an expanded card (else one column). */
  readonly flat?: boolean;
  /** A tool call's text output shown in full rather than as a snippet (the view model's
   *  `outputShown`). */
  readonly fullOutput?: boolean;
}

/**
 * An estimate of an item's height in rows at `width` terminal columns, collapsed or expanded,
 * without its margin (the blank rows above it). Mirrors items.tsx: one header row for thoughts,
 * tool calls and plans, plus the card when expanded; user messages wrap beside the bar;
 * agent messages are Markdown behind the gutter.
 */
export function estimateHeight(item: Item, width: number, expanded: boolean, options: EstimateOptions = {}): number {
  const glyphs = options.glyphs ?? LIVE_GLYPHS;
  const body = Math.max(1, width - glyphs.gutterWidth);
  // The card: `cards.padding.columns` columns of padding (or the rule and those columns when flat)
  // on the left and the same on the right.
  const { rows: padRows, columns: padColumns } = cardPadding();
  const inner = Math.max(1, width - glyphs.gutterWidth - (options.flat ? displayWidth(glyphs.cardRule) : 0) - 2 * padColumns);
  switch (item.kind) {
    case "user_message":
      return Math.max(1, wordWrappedRows(item.text.replace(/\n+$/, ""), width - 1 - 2 * padColumns)) + 2 * padRows;
    case "agent_message":
      return markdownRows(item.text, body, glyphs, item.status !== "live");
    case "thought":
      return 1 + (expanded ? thoughtCardLayout(item, inner, glyphs).rows.length : 0);
    case "tool_call":
      return 1 + (expanded ? toolCardHeight(item, inner, options.fullOutput ?? false, glyphs, !toolTitleShown(item, body, glyphs)) : 0);
    case "plan":
      return 1 + (expanded ? item.entries.length + 2 * padRows : 0);
    case "permission_record":
      return 1;
    case "marker":
      return item.markerKind === "turn_end" ? 1 : Math.max(1, wrappedRows(item.text.replace(/\n+$/, ""), body));
  }
}
