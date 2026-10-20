// What a block renderer is given besides its token: the width and the small
// context every renderer shares. Pure data: no theme, no OpenTUI (the
// rendering settings are one Solid signal, so what is laid out from them
// follows a reload).
import { createSignal } from "solid-js";
import type { EmojiClass } from "../../render/emoji/emoji.ts";
import { terminalCapabilities } from "../../renderer/capabilities.ts";
import type { TokenName } from "../../theme/index.ts";
import type { Prepared } from "./prepass.ts";
import type { MarkdownGlyphs } from "./types.ts";

/** How long lines in code blocks break (the setting `markdown.code_wrap`): at the last space that
 *  fits in every block (`word`), in prose blocks only (`prose`), or at the column (`column`). */
export type CodeWrap = "word" | "prose" | "column";

/** Settings that change how Markdown is drawn (the `markdown.*` settings, `RenderSettings`). */
export interface MarkdownFlags {
  /** Show a heading's `#` markers, muted (the setting `markdown.heading_markers`; off). */
  readonly headingMarkers: boolean;
  /** Below this many columns per column, a table is drawn as records (the setting
   *  `markdown.table_min_column_width`). */
  readonly tableMinColumnWidth: number;
  /** How long code lines break (the setting `markdown.code_wrap`; `word`). */
  readonly codeWrap: CodeWrap;
  /** The padding inside a code block's fill outside a card, the cards' own (`cards.padding`;
   *  day-one-feedback, Marcus 15 October 2026): blank rows at the top and the bottom, columns at
   *  the left and the right. A code block inside a card draws none (the card pads it). */
  readonly codePadding: CardPadding;
  /**
   * The classes of emoji sequence drawn as their names, muted, because the terminal draws them at
   * another width than the layout (render/emoji/emoji.ts; task 14.5, review C11): the capability
   * table's `emoji` for the terminal acp-tui runs in (`terminalFlags`), none in `DEFAULT_FLAGS`.
   * Never changes the projection, which keeps the emoji.
   */
  readonly emoji: readonly EmojiClass[];
}

/** The minimum column width before a table is drawn as records (spec "Wide tables as records"). */
export const TABLE_MIN_COLUMN_WIDTH = 10;

export const DEFAULT_FLAGS: MarkdownFlags = {
  headingMarkers: false,
  tableMinColumnWidth: TABLE_MIN_COLUMN_WIDTH,
  codeWrap: "word",
  codePadding: { rows: 1, columns: 2 },
  emoji: [],
};

/**
 * The rendering settings of `tui-config` "Rendering settings" (mvp-configuration task 4.8):
 * `markdown.heading_markers`, `markdown.table_min_column_width`, `tool_output.snippet_rows` and
 * `cards.padding`.
 * `app/run.tsx` sets them from the configuration at start-up and on each reload
 * (`setRenderSettings`); they are read through `terminalFlags()` and `snippetRows()`, which are
 * reactive, so a layout made in a reactive scope (an agent message's, a card's) is made again
 * when they change, and `renderSettingsKey()` goes into the keys of every cache of layouts and
 * heights.
 */
export interface RenderSettings {
  readonly headingMarkers: boolean;
  readonly tableMinColumnWidth: number;
  /** The output snippet's height in an expanded tool card (card.ts). */
  readonly snippetRows: number;
  /** `markdown.code_wrap`. */
  readonly codeWrap: CodeWrap;
  /** `cards.padding.rows`: blank rows at the top and the bottom of a card (0 or 1). */
  readonly cardPadRows: number;
  /** `cards.padding.columns`: columns at the left and the right of a card's content (1 to 3). */
  readonly cardPadColumns: number;
}

/** The padding inside every card's fill (spec tui-rendering "Card padding"). */
export interface CardPadding {
  readonly rows: number;
  readonly columns: number;
}

/** The output snippet's height by default (mvp-rendering "Output snippets"). */
export const SNIPPET_ROWS = 10;

export const DEFAULT_RENDER_SETTINGS: RenderSettings = Object.freeze({
  headingMarkers: DEFAULT_FLAGS.headingMarkers,
  tableMinColumnWidth: DEFAULT_FLAGS.tableMinColumnWidth,
  snippetRows: SNIPPET_ROWS,
  codeWrap: "word",
  cardPadRows: DEFAULT_FLAGS.codePadding.rows,
  cardPadColumns: DEFAULT_FLAGS.codePadding.columns,
});

const sameSettings = (a: RenderSettings, b: RenderSettings) =>
  a.headingMarkers === b.headingMarkers &&
  a.tableMinColumnWidth === b.tableMinColumnWidth &&
  a.snippetRows === b.snippetRows &&
  a.codeWrap === b.codeWrap &&
  a.cardPadRows === b.cardPadRows &&
  a.cardPadColumns === b.cardPadColumns;

const [renderSettings, setRenderSettingsSignal] = createSignal<RenderSettings>(DEFAULT_RENDER_SETTINGS, { equals: sameSettings });

/** The rendering settings from now on (`app/run.tsx`), or (null) the defaults again; a setting
 *  left out keeps its default. */
export function setRenderSettings(settings: Partial<RenderSettings> | null): void {
  setRenderSettingsSignal(settings ? { ...DEFAULT_RENDER_SETTINGS, ...settings } : DEFAULT_RENDER_SETTINGS);
}

/** The output snippet's height (`tool_output.snippet_rows`); reactive. */
export function snippetRows(): number {
  return renderSettings().snippetRows;
}

/** The padding inside every card (`cards.padding`); reactive. */
export function cardPadding(): CardPadding {
  const s = renderSettings();
  return { rows: s.cardPadRows, columns: s.cardPadColumns };
}

/** A key of the rendering settings in use, for caches of layouts and heights; reactive. */
export function renderSettingsKey(): string {
  const s = renderSettings();
  return `${s.headingMarkers ? "h" : ""}${s.tableMinColumnWidth}:${s.snippetRows}:${s.cardPadRows}${s.cardPadColumns}:${s.codeWrap}`;
}

let terminalEmoji: readonly EmojiClass[] | undefined;
let flagsCache: { settings: RenderSettings; emoji: readonly EmojiClass[]; flags: MarkdownFlags } | undefined;

/** The flags for the terminal this process runs in: the rendering settings, with the capability
 *  table's emoji classes (read once). What the conversation draws and estimates with, so its
 *  heights and its screen agree; the projection reads `DEFAULT_FLAGS`, which gives the same text
 *  (heading markers and a code block's padding are decoration). Reactive, through the settings; the same object while
 *  nothing changed. */
export function terminalFlags(): MarkdownFlags {
  const settings = renderSettings();
  terminalEmoji ??= terminalCapabilities(process.env).emoji;
  if (flagsCache?.settings !== settings || flagsCache.emoji !== terminalEmoji) {
    flagsCache = {
      settings,
      emoji: terminalEmoji,
      flags: {
        headingMarkers: settings.headingMarkers,
        tableMinColumnWidth: settings.tableMinColumnWidth,
        codeWrap: settings.codeWrap,
        codePadding: { rows: settings.cardPadRows, columns: settings.cardPadColumns },
        emoji: terminalEmoji,
      },
    };
  }
  return flagsCache.flags;
}

/** Tests only: the emoji classes `terminalFlags` gives from now on, or (null) the terminal's
 *  again. Items laid out before keep their layouts until they change. */
export function setTerminalEmoji(emoji: readonly EmojiClass[] | null): void {
  terminalEmoji = emoji === null ? undefined : emoji;
}

export interface MarkdownContext {
  /** Columns available to the block. */
  readonly width: number;
  readonly glyphs: MarkdownGlyphs;
  /** The message's pre-pass: placeholders' maths spans, footnotes and literals. */
  readonly prepared: Prepared;
  readonly flags: MarkdownFlags;
  /** The token of plain text here: `text`, or `markdown.quote` inside a quote. */
  readonly textToken: TokenName;
  /** How many lists enclose the block (bullets go by depth). */
  readonly listDepth: number;
}

/** A context for a block nested `indent` columns in, with any of its fields changed. */
export function nested(ctx: MarkdownContext, indent: number, changes: Partial<MarkdownContext> = {}): MarkdownContext {
  return { ...ctx, ...changes, width: Math.max(1, ctx.width - indent) };
}
