// The permission card's content (spec tui-layout "Permission card"; design
// 6.4, section 8). Pure: builds themed segment rows from the open permission
// record and its tool call.
//
// Anti-spoofing: the card is docked in a chrome region agent text cannot
// reach, filled with `surface.permission` (a fill no sanitised agent text can
// produce), framed in the warning colour with a marker glyph in its header
// that the conversation never uses (its glyphs are in
// src/conversation/glyphs.ts, and a test checks they do not overlap), it shows
// the tool index that links it to the tool's line in the conversation, and
// option keys are ignored for 300 ms after it appears.
import { sanitise, type PermissionRecordItem, type ToolCallItem } from "acp-model";
import { TextAttributes } from "@opentui/core";
import { cardLines, wrapLine } from "../conversation/content.ts";
import { DEFAULT_PERMISSION_GLYPHS } from "../conversation/glyphs.ts";
import { LIVE_PERMISSION_GLYPHS } from "../conversation/live-glyphs.ts";
import { displayWidth, ELLIPSIS, takeWidth, truncateEnd, type Segment } from "../layout/segments.ts";
import { spanStyle as toSpan, type ResolvedTheme, type SpanStyle, type TokenName } from "../theme/index.ts";
import { CONVERSATION_KEEP_ROWS } from "../layout/layout.ts";

export interface PermissionGlyphs {
  /** Marks the card's header. */
  readonly marker: string;
  /** The rounded frame. */
  readonly topLeft: string;
  readonly topRight: string;
  readonly bottomLeft: string;
  readonly bottomRight: string;
  readonly horizontal: string;
  readonly vertical: string;
}

/** The `unicode` set's card glyphs, fixed. The registry (src/conversation/glyphs.ts) holds them
 *  as `frame.*` and `permission.marker`; `LIVE_PERMISSION_GLYPHS` follows the configuration. */
export const PERMISSION_GLYPHS: PermissionGlyphs = DEFAULT_PERMISSION_GLYPHS;

/** Option keys are ignored for this long after the card appears. */
export const OPTION_GUARD_MS = 300;
/** A card that appears while the prompt box holds a draft flashes this many times. */
export const FLASH_TIMES = 3;
export const FLASH_STEP_MS = 150;
/**
 * The docked card is laid out last (mvp-chrome-and-keys design D6): at rest it takes what it needs
 * while the conversation keeps this many rows of what the other regions leave (`BlockProps.free`).
 */
export const CONVERSATION_ROWS_AT_REST = CONVERSATION_KEEP_ROWS;
/** Grown with Ctrl+O, the card takes every row the other regions leave but this many, so the
 *  conversation keeps a row (with none, its first row was left stale in the S6 PTY run). */
export const CONVERSATION_ROWS_GROWN = 1;
/** The least rows a card is given, whatever is left (a frame and one row of content). */
export const CARD_MIN_ROWS = 3;
/** With a preview, the title takes at most this many rows. */
export const PREVIEW_TITLE_ROWS = 2;
/** The preview rows a card claims before spacing gives way (day-one-feedback, Marcus 15 October
 *  2026; spec tui-layout "Spacing gives way before content"): the two a four-option request had
 *  at 63x21 before the prompt box's padding row. The rest of a longer preview takes the rows left. */
export const PREVIEW_CLAIM_ROWS = 2;

/** The padding inside a docked card's frame (`cards.padding`): blank rows at its top and its
 *  bottom, and columns between the frame and the content on both sides. */
export interface FramePadding {
  readonly rows: number;
  readonly columns: number;
}

/** The padding a card is drawn with when none is given: no padding rows, one column (the frame's
 *  own space). */
export const NO_FRAME_PADDING: FramePadding = { rows: 0, columns: 1 };

/** A docked card's inner width: `width` less its frame and `columns` of padding on each side. */
export function cardInner(width: number, columns: number): number {
  return Math.max(1, width - 2 - 2 * columns);
}

/** The most rows the docked card may take: `free` is what the other regions leave it and the
 *  conversation (`BlockProps.free`). */
export function cardMaxRows(free: number, grown: boolean): number {
  return Math.max(CARD_MIN_ROWS, free - (grown ? CONVERSATION_ROWS_GROWN : CONVERSATION_ROWS_AT_REST));
}

const KIND_LABELS: Record<string, string> = {
  allow_once: "allow once",
  allow_always: "allow always",
  reject_once: "reject once",
  reject_always: "reject always",
};

export interface CardOption {
  /** 1 to 9, or null past the ninth option (not selectable by number). */
  readonly number: number | null;
  readonly label: string;
  readonly optionId: string;
}

export interface CardModel {
  readonly toolKind: string | null;
  /** Title sanitised in approval context: no bidi controls or zero-width characters. */
  readonly title: string;
  readonly index: number | null;
  readonly options: readonly CardOption[];
}

/** One line of approval-sanitised text. */
export function approvalText(text: string): string {
  return sanitise(text, "approval").replace(/[\r\n\t]+/g, " ").trim();
}

export function cardModel(record: PermissionRecordItem, tool: ToolCallItem | undefined): CardModel {
  return {
    toolKind: tool?.toolKind ? approvalText(tool.toolKind) : null,
    title: approvalText(record.title || tool?.title || ""),
    index: tool?.index ?? null,
    options: record.options.map((option, i) => ({
      number: i < 9 ? i + 1 : null,
      // Labelled by kind; the agent's name (sanitised) only for a kind we do not know.
      label: KIND_LABELS[option.kind] ?? approvalText(option.name),
      optionId: option.optionId,
    })),
  };
}

/** A segment of a card row; `selected` marks the selected option (drawn highlighted). */
export interface CardSegment extends Segment {
  readonly selected?: boolean;
  /** A background token for the segment (diff lines in the preview); not drawn under the flat
   *  theme, where the card has no fills. */
  readonly fill?: TokenName;
  /** The index in `model.options` of the option this segment draws (its number or label). */
  readonly option?: number;
}

/**
 * A card segment's span style (both docked cards). The selected option is on
 * `surface.permission.selected` (the card fill stepped towards the foreground, so it is lighter
 * than the card on a dark theme and darker on a light one; spec tui-theme "Selected permission
 * option surface"), or in inverse video under the flat theme (also when the terminal lacks
 * truecolour), with no background colour sent. Spans take flags, not an attributes mask (`toSpan`).
 */
export function cardSpanStyle(theme: ResolvedTheme, s: CardSegment): SpanStyle {
  const base = theme.text(s.token);
  if (!s.selected) return toSpan(s.fill && !theme.flat ? { ...base, bg: theme.color(s.fill) } : base);
  return toSpan(theme.flat ? { ...base, attributes: base.attributes | TextAttributes.INVERSE } : { ...base, bg: theme.color("surface.permission.selected") });
}

/** one display row of the preview, with the surface filling it. */
export interface PreviewRow {
  readonly segments: readonly Segment[];
  readonly fill?: TokenName;
}

/**
 * what the permission approves, as display rows `width` columns wide
 * (the card's inner width): the tool call's content as its expanded card shows it (a numbered
 * unified diff for an edit, text for a command's content), every string sanitised in approval
 * mode (no bidi controls or zero-width characters, section 8), long lines wrapped rather than
 * cut, so nothing approved is hidden. Empty when the tool call has no content.
 */
export function previewRows(tool: ToolCallItem | undefined, width: number): PreviewRow[] {
  if (!tool || tool.content.length === 0) return [];
  const rows: PreviewRow[] = [];
  for (const line of cardLines(tool)) {
    const segments = line.segments.map((seg) => ({ ...seg, text: sanitise(seg.text, "approval").replace(/[\r\n]/g, " ") }));
    const wrapped = segments.length === 0 ? [[]] : wrapLine(segments, Math.max(1, width));
    for (const row of wrapped) rows.push(line.fill ? { segments: row, fill: line.fill } : { segments: row });
  }
  return rows;
}

export interface CardStyle {
  /** The card has keyboard focus (either stop): options drawn in full. */
  focused: boolean;
  /** The answer row has focus: the selected option is drawn highlighted (spec tui-layout
   *  "Permission card focus and typing guard": nothing is selected while the preview has it).
   *  Default: `focused`, for a card with one stop. */
  answer?: boolean;
  /** The preview has focus: its range in the bottom border is drawn in the accent colour. */
  previewFocused?: boolean;
  /** How many permission requests are open (the card shows the first); the header shows
   *  `1 of N` when more than one is (spec tui-layout "Queued and withdrawn cards"). */
  queued?: number;
  /** Flash phase: the frame and marker use the `accent` token instead of `permission`. */
  flash: boolean;
  /** Index of the selected option in `model.options`. */
  selected: number;
  /** The most rows the card may take, borders included. */
  maxRows: number;
  glyphs?: PermissionGlyphs;
  /** the preview's rows (`previewRows`) and the first one shown. */
  preview?: { readonly rows: readonly PreviewRow[]; readonly offset: number };
  /** The padding inside the frame (`NO_FRAME_PADDING` when absent): `rows` blank rows at the top
   *  and the bottom, drawn besides `maxRows`, and `columns` on both sides. */
  padding?: FramePadding;
}

/** the preview as laid out: rows shown, the first shown, rows in all. */
export interface PreviewWindow {
  readonly height: number;
  readonly offset: number;
  readonly total: number;
}

export interface CardLayout {
  readonly rows: CardSegment[][];
  /** Null without a preview, or when there is no room for one. */
  readonly preview: PreviewWindow | null;
  /** Index in `rows` of the first option row (the answer row). */
  readonly answerRow: number;
  /** Index in `rows` after the last option row. */
  readonly answerEnd: number;
  /** The padding rows drawn at the top and at the bottom inside the frame (not in `maxRows`). */
  readonly paddingRows: number;
  /** The options are one per row (Up and Down move the selection). */
  readonly stacked: boolean;
}

/** The preview does not fit, so it is a focus stop of its own (mvp-chrome-and-keys design D6). */
export function previewIsStop(layout: CardLayout | null): boolean {
  return layout?.preview != null && layout.preview.total > layout.preview.height;
}

const OPTION_GAP = "   ";

/** Word-wraps `text` into rows of at most `width` columns, breaking long words. */
export function wrapText(text: string, width: number): string[] {
  const rows: string[] = [];
  let row = "";
  for (const word of text.split(/ +/).filter(Boolean)) {
    let rest = word;
    const candidate = row === "" ? rest : `${row} ${rest}`;
    if (displayWidth(candidate) <= width) {
      row = candidate;
      continue;
    }
    if (row !== "") rows.push(row);
    row = "";
    while (displayWidth(rest) > width) {
      const head = takeWidth(rest, width);
      if (head === "") break;
      rows.push(head);
      rest = rest.slice(head.length);
    }
    row = rest;
  }
  if (row !== "" || rows.length === 0) rows.push(row);
  return rows;
}

function optionSegments(option: CardOption, index: number, style: CardStyle, selected: boolean, width: number): CardSegment[] {
  const number = option.number === null ? "-" : String(option.number);
  const label = truncateEnd(option.label, Math.max(1, width - number.length - 1));
  const numberToken: TokenName = style.focused ? "accent" : "muted";
  const labelToken: TokenName = style.focused ? "text" : "muted";
  const mark = (style.answer ?? style.focused) && selected;
  return [
    { text: number, token: numberToken, selected: mark, option: index },
    { text: ` ${label}`, token: labelToken, selected: mark, option: index },
  ];
}

/**
 * The card's rows for `width` columns: the top border with the marker, `Permission`, the tool
 * kind and index; the title, word-wrapped; the options on one row when they fit the inner width,
 * otherwise one per row; the bottom border. At most `style.maxRows` rows: the title gives way
 * first (its last row ends with an ellipsis), then the options past the last row that fits.
 */
export function cardRows(model: CardModel, width: number, style: CardStyle): CardSegment[][] {
  return cardLayout(model, width, style).rows;
}

/**
 * `cardRows` with the preview's window. With a preview the title takes at
 * most `PREVIEW_TITLE_ROWS` rows, the options keep theirs, and the preview takes the rows left
 * under `maxRows`, between the title and the options, from `style.preview.offset` (clamped so
 * the last row can be reached and no further); the bottom border shows which rows are shown.
 */
export function cardLayout(model: CardModel, width: number, style: CardStyle): CardLayout {
  const g = style.glyphs ?? LIVE_PERMISSION_GLYPHS;
  const frameToken: TokenName = style.flash ? "accent" : "permission";
  const padding = style.padding ?? NO_FRAME_PADDING;
  const inner = cardInner(width, padding.columns);
  // The frame's sides in the frame's token, the padding columns between them and the content
  // plain (no attribute of the frame's, such as bold, on a blank cell).
  const left: CardSegment[] = [{ text: g.vertical, token: frameToken }, { text: " ".repeat(padding.columns), token: "text" }];
  const right: CardSegment[] = [{ text: " ".repeat(padding.columns), token: "text" }, { text: g.vertical, token: frameToken }];

  // Top border: `╭─ ◊ Permission  edit  #2 ────╮`.
  const head: CardSegment[] = [
    { text: `${g.topLeft}${g.horizontal} `, token: frameToken },
    { text: `${g.marker} `, token: frameToken },
    { text: "Permission", token: "permission" },
  ];
  if (model.toolKind) head.push({ text: `  ${model.toolKind}`, token: "accent" });
  if (model.index !== null) head.push({ text: `  #${model.index}`, token: "muted" });
  if ((style.queued ?? 1) > 1) head.push({ text: `  1 of ${style.queued}`, token: "muted" });
  const headRoom = width - 2; // the closing ` ` and corner
  let used = 0;
  const top: CardSegment[] = [];
  for (const s of head) {
    const w = displayWidth(s.text);
    if (used + w > headRoom) {
      const cut = takeWidth(s.text, headRoom - used);
      if (cut) top.push({ ...s, text: cut });
      used += displayWidth(cut);
      break;
    }
    top.push(s);
    used += w;
  }
  const fill = Math.max(0, width - used - 1);
  if (fill > 0) top.push({ text: ` ${g.horizontal.repeat(fill - 1)}`, token: frameToken });
  top.push({ text: g.topRight, token: frameToken });

  // Options: one row when they fit, else stacked.
  const pieces = model.options.map((option, i) => optionSegments(option, i, style, i === style.selected, inner));
  const widths = pieces.map((p) => p.reduce((w, s) => w + displayWidth(s.text), 0));
  const oneRow = widths.reduce((a, b) => a + b, 0) + OPTION_GAP.length * Math.max(0, pieces.length - 1) <= inner;
  let optionRows: CardSegment[][] = oneRow
    ? [pieces.flatMap((p, i) => (i === 0 ? p : [{ text: OPTION_GAP, token: "muted" as TokenName }, ...p]))]
    : pieces;

  // Heights: borders, title, options; the title gives way first.
  const bodyRoom = Math.max(1, style.maxRows - 2);
  optionRows = optionRows.slice(0, Math.max(1, bodyRoom - 1));
  const previewSource = style.preview && style.preview.rows.length > 0 ? style.preview : null;
  const titleCap = previewSource ? PREVIEW_TITLE_ROWS : Infinity;
  const titleRoom = Math.max(model.title ? 1 : 0, Math.min(titleCap, bodyRoom - optionRows.length));
  let titleRows = model.title ? wrapText(model.title, inner) : [];
  if (titleRows.length > titleRoom) {
    titleRows = titleRows.slice(0, titleRoom);
    const last = titleRows.length - 1;
    const row = titleRows[last]!;
    titleRows[last] = displayWidth(row) < inner ? `${row}${ELLIPSIS}` : `${takeWidth(row, inner - 1)}${ELLIPSIS}`;
  }

  const framed = (content: CardSegment[]): CardSegment[] => {
    const w = content.reduce((n, s) => n + displayWidth(s.text), 0);
    return [...left, ...content, { text: " ".repeat(Math.max(0, inner - w)), token: "text" }, ...right];
  };
  // The preview: the rows left between the title and the options.
  let preview: PreviewWindow | null = null;
  let previewShown: CardSegment[][] = [];
  if (previewSource) {
    const room = bodyRoom - titleRows.length - optionRows.length;
    const total = previewSource.rows.length;
    const height = Math.min(total, Math.max(0, room));
    if (height > 0) {
      const offset = Math.max(0, Math.min(previewSource.offset, total - height));
      preview = { height, offset, total };
      previewShown = previewSource.rows.slice(offset, offset + height).map((row) => {
        const content: CardSegment[] = row.segments.map((seg) => (row.fill ? { ...seg, fill: row.fill } : { ...seg }));
        const w = content.reduce((n, seg) => n + displayWidth(seg.text), 0);
        const pad: CardSegment = row.fill ? { text: " ".repeat(Math.max(0, inner - w)), token: "text", fill: row.fill } : { text: " ".repeat(Math.max(0, inner - w)), token: "text" };
        return [...left, ...content, pad, ...right];
      });
    }
  }

  // The bottom border; with a preview that does not fit, the rows shown (`7-12 of 53`).
  let bottom: CardSegment[] = [{ text: `${g.bottomLeft}${g.horizontal.repeat(Math.max(0, width - 2))}${g.bottomRight}`, token: frameToken }];
  if (preview && preview.total > preview.height) {
    const label = ` ${preview.offset + 1}-${preview.offset + preview.height} of ${preview.total} `;
    const line = width - 3 - displayWidth(label);
    if (line >= 1) {
      bottom = [
        { text: `${g.bottomLeft}${g.horizontal.repeat(line)}`, token: frameToken },
        { text: label, token: style.previewFocused ? "accent" : "muted" },
        { text: `${g.horizontal}${g.bottomRight}`, token: frameToken },
      ];
    }
  }

  // The padding rows inside the frame (spec tui-layout "Permission card"), besides `maxRows`.
  const padRows = Math.max(0, padding.rows);
  const blankRows = Array.from({ length: padRows }, (): CardSegment[] => framed([]));
  const answerRow = 1 + padRows + titleRows.length + previewShown.length;
  return {
    rows: [top, ...blankRows, ...titleRows.map((t) => framed([{ text: t, token: "text" }])), ...previewShown, ...optionRows.map(framed), ...blankRows.map((row) => [...row]), bottom],
    preview,
    answerRow,
    answerEnd: answerRow + optionRows.length,
    paddingRows: padRows,
    stacked: !oneRow && optionRows.length > 1,
  };
}

/**
 * The rows a card's content claims before spacing gives way (spec tui-layout "Spacing gives way
 * before content"), its frame included and its padding rows not: the title, the options and the
 * preview's first `PREVIEW_CLAIM_ROWS` rows (all of a shorter one), at `width` columns with
 * `columns` of padding on each side.
 */
export function cardClaim(model: CardModel, width: number, preview: readonly PreviewRow[], columns: number): number {
  return cardLayout(model, width, {
    focused: false,
    flash: false,
    selected: 0,
    maxRows: Number.MAX_SAFE_INTEGER,
    preview: { rows: preview.slice(0, PREVIEW_CLAIM_ROWS), offset: 0 },
    padding: { rows: 0, columns },
  }).rows.length;
}

/**
 * The option drawn at column `x` of row `y` of the card (both relative to the card's top-left
 * cell), as its index in `model.options`, or null (a gap between options, the frame, any other
 * row): what a click on the answer row selects (mvp-chrome-and-keys task 12.5).
 */
export function optionAt(layout: CardLayout | null, x: number, y: number): number | null {
  const row = layout?.rows[y];
  if (!row || y < layout.answerRow || y >= layout.answerEnd) return null;
  let column = 0;
  for (const segment of row) {
    const width = displayWidth(segment.text);
    if (x >= column && x < column + width) return segment.option ?? null;
    column += width;
  }
  return null;
}
