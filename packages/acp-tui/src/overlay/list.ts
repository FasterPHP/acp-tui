// The list model behind the overlays (spec tui-palette; design 6.4
// "Overlays", decision 16 and parity 7.2 in research/full-screen-synthesis.md):
// items, the filter, grouping, the selection, the scrolled window and the
// overlay's rows. Pure, so it is unit-tested without a renderer. The command
// palette, the slash menu, the config pickers and key help (Overlay.tsx,
// mvp-chrome-and-keys task group 6) draw their lists with it; group headers
// are bold in the default foreground ((d) 4), and an entry may carry a muted
// description after its title (an agent command's).
// mvp-sessions (task 7.1, design decision 5): the session list
// (SessionList.tsx) uses this module too, adding rows with details in aligned
// columns (`detailColumns`: one layout for the whole list, whole columns
// dropped at narrow widths) and a footer row for errors and notices.
import { PROMPT_FRAME } from "../layout/border.ts";
import { displayWidth, fitSegments, takeWidth, truncateEnd, type Segment } from "../layout/segments.ts";
import type { TokenName } from "../theme/index.ts";

/** One entry of a palette or a picker. */
export interface ListItem {
  readonly id: string;
  /** The category it is listed under (its header shows while at least one of its items is shown);
   *  null for none. Never matched by the filter (task 12.8). */
  readonly group: string | null;
  readonly title: string;
  /** Muted text after the title, cut to the room left (an agent command's description); the
   *  filter matches it. */
  readonly description?: string | null;
  /** The current value, right-aligned in the accent colour (the current model, the mouse policy). */
  readonly value?: string | null;
  /** Labels of the keys bound to it, right-aligned and muted. */
  readonly keys?: readonly string[];
  /** What the group's heading says after its name, in brackets (`shortcuts apply while it is
   *  selected`), when the keys of the group work in one place only (spec tui-palette "Group
   *  headings say where keys work"); read from the first item of each group, never matched by the
   *  filter, as the group is not. */
  readonly groupNote?: string | null;
  /** Not available now (spec tui-palette "Only entries that can run now are active"): drawn in the
   *  muted colour, never highlighted, skipped by the keyboard selection and the pointer, and run by
   *  neither Enter nor a click. */
  readonly muted?: boolean;
  /** Shown in the key column, as the keys are, while no key is bound to it: how to reach it
   *  otherwise (`esc esc` for interrupting the turn, `click the pill` for the model; spec
   *  tui-palette "Command palette overlay"). The filter matches it. */
  readonly route?: string | null;
  /** A picker's current value: marked with `●`. */
  readonly current?: boolean;
  /** More text the filter matches (an option's id or description). */
  readonly search?: string;
  /** Muted details after the title, one per column, most important first (the session list:
   *  agent, time, directory; an empty string for a missing value keeps the columns in place).
   *  They line up across the list (`detailColumns`); at narrow widths whole columns are dropped,
   *  and the title never is. */
  readonly details?: readonly string[];
}

/** A row of the list: a group header, the blank row before every header but the first, or an item
 *  (by index into the shown items). */
export type ListRow = { readonly kind: "header"; readonly label: string } | { readonly kind: "gap" } | { readonly kind: "item"; readonly index: number };

/** A segment of an overlay row; `selected` rows are highlighted, `cursor` is the filter's caret. */
export interface OverlaySegment extends Segment {
  readonly selected?: boolean;
  readonly cursor?: boolean;
  /** Drawn bold (group headers). */
  readonly bold?: boolean;
}

/**
 * The items that match `query`: every word of it (case-insensitive) appears in the item's title,
 * description, value, keys, route or search text. An empty query matches everything, in the given
 * order. The group is never matched: the filter applies to items only, and a group's header is
 * shown while at least one of its items matches (`listRows`; Marcus, 11 October 2026,
 * mvp-chrome-and-keys task 12.8: typing `session` no longer keeps every entry of the Session group).
 */
export function filterItems(items: readonly ListItem[], query: string): ListItem[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...items];
  return items.filter((item) => {
    const hay = [item.title, item.description ?? "", item.value ?? "", ...(item.keys ?? []), item.route ?? "", item.search ?? ""]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => hay.includes(term));
  });
}

/** The list's rows: a header before each new group while `grouped`, with a blank row before every
 *  header but the first (Marcus, 11 October 2026, so the sections read apart), then the items.
 *  Given the filtered items, a group's header shows only above the items of it that match. */
export function listRows(items: readonly ListItem[], grouped: boolean): ListRow[] {
  const rows: ListRow[] = [];
  let group: string | null = null;
  items.forEach((item, index) => {
    if (grouped && item.group !== null && item.group !== group) {
      if (rows.length > 0) rows.push({ kind: "gap" });
      rows.push({ kind: "header", label: item.groupNote ? `${item.group} (${item.groupNote})` : item.group });
    }
    group = item.group;
    rows.push({ kind: "item", index });
  });
  return rows;
}

/**
 * The first row shown so the selected item is in a window of `height` rows, moving as little as
 * possible from `offset`; the header of the selected item's group is kept in view when the item is
 * the first of its group.
 */
export function scrollOffset(rows: readonly ListRow[], selected: number, height: number, offset: number): number {
  const max = Math.max(0, rows.length - height);
  const at = rows.findIndex((r) => r.kind === "item" && r.index === selected);
  let next = Math.max(0, Math.min(offset, max));
  if (at < 0 || height <= 0) return next;
  const top = at > 0 && rows[at - 1]!.kind === "header" ? at - 1 : at;
  if (top < next) next = top;
  if (at >= next + height) next = at - height + 1;
  return Math.max(0, Math.min(next, max));
}

/**
 * PgUp and PgDn: the item a page of `height` rows (less one, kept for context) away from the
 * selected one in `rows`, counted in rows, so that headers and the blank rows before them (task
 * 12.7) do not make the window jump by more than its height and skip a row. The nearest item
 * inside that page, or the next item beyond it when the page holds none; the selection itself
 * at either end.
 */
export function pageSelection(rows: readonly ListRow[], selected: number, height: number, direction: 1 | -1, skip?: (index: number) => boolean): number {
  const at = rows.findIndex((r) => r.kind === "item" && r.index === selected);
  if (at < 0) return selected;
  const target = at + direction * Math.max(1, height - 1);
  let found: number | null = null;
  for (let r = at + direction; r >= 0 && r < rows.length; r += direction) {
    const row = rows[r]!;
    if (row.kind !== "item" || skip?.(row.index)) continue;
    if (found !== null && (direction > 0 ? r > target : r < target)) break;
    found = row.index;
  }
  return found ?? selected;
}

/**
 * Moves the selection by `delta` items (clamped), or to the first or last item. With `skip`, an
 * item it names (a muted entry) is passed over: the move goes to the nearest other item in its
 * direction, and stays where it is when there is none ("first" and "last" look inward from the end).
 */
export function moveSelection(count: number, selected: number, move: number | "first" | "last", skip?: (index: number) => boolean): number {
  if (count === 0) return 0;
  const passed = skip ?? (() => false);
  const nearest = (from: number, step: 1 | -1): number | null => {
    for (let i = from; i >= 0 && i < count; i += step) if (!passed(i)) return i;
    return null;
  };
  if (move === "first") return nearest(0, 1) ?? 0;
  if (move === "last") return nearest(count - 1, -1) ?? count - 1;
  const target = Math.max(0, Math.min(count - 1, selected + move));
  if (!passed(target) || move === 0) return target;
  const step = move > 0 ? 1 : -1;
  return nearest(target, step) ?? selected;
}

/** The first item `skip` does not name (0 when it names them all): where a list's selection starts. */
export function firstActive(count: number, skip: (index: number) => boolean): number {
  for (let i = 0; i < count; i++) if (!skip(i)) return i;
  return 0;
}

/** The overlays' frame: the prompt box's own (mvp-chrome-and-keys task 12.7). */
export const OVERLAY_FRAME = PROMPT_FRAME;

/** The overlay leaves this many rows of the screen: it is at most `rows - OVERLAY_RESERVED_ROWS` tall. */
export const OVERLAY_RESERVED_ROWS = 4;
/** Pickers get a filter field above this many choices (parity 7.2, as Zed). */
export const PICKER_FILTER_ABOVE = 5;
/** A picker's mark for the current value. */
export const CURRENT_MARK = "●";

export interface OverlayView {
  readonly title: string;
  /** The filter text, or null when the list has no filter field. */
  readonly filter: string | null;
  readonly placeholder: string;
  readonly items: readonly ListItem[];
  readonly grouped: boolean;
  readonly selected: number;
  /** The first list row shown last time (kept stable while the selection stays in view). */
  readonly offset: number;
  /** The screen's size. */
  readonly width: number;
  readonly rows: number;
  /** Label of the close key, shown at the right of the top border (`esc`). */
  readonly closeLabel: string | null;
  /** Key hints for the bottom border, most important first. */
  readonly hints: readonly Segment[];
  /** Mark the current value with `CURRENT_MARK` (pickers). */
  readonly marks: boolean;
  /** A footer row above the bottom border for errors and notices (the session list); its text
   *  wraps to at most `FOOTER_MAX_ROWS` rows, and it keeps one row while it is empty. Absent: no
   *  footer row. */
  readonly footer?: OverlayFooter;
  /** The order the detail columns are dropped in when the list is narrow, by index into
   *  `details`; default right to left. */
  readonly detailDrop?: readonly number[];
  /** The least width of each detail column once it has a value, by index into `details`: a column
   *  that could grow when a later row has a wider value starts at the width it may reach. */
  readonly detailMin?: readonly number[];
  /** The most rows the overlay may take, when less than `rows - OVERLAY_RESERVED_ROWS` (the `@`
   *  file picker's 8). */
  readonly maxRows?: number;
  /** The fewest rows the overlay takes (within its most): blank framed rows below the list make up
   *  the rest. The palette's overlay covers the prompt box it replaces (mvp-chrome-and-keys task
   *  12.7), so it is at least as tall as the prompt box. */
  readonly minRows?: number;
  /** Shown instead of the number of `items` after the title (the file picker passes only the rows
   *  in view, and counts the matches itself). */
  readonly count?: string;
  /** The line shown instead of `no matches` when the list has nothing to show. */
  readonly empty?: string;
  /** A muted line in the first list row after the last entry, when there is a blank row for it (the
   *  session list's `no sessions yet in <directory>` under its "New session with" rows). */
  readonly tail?: string;
  /** A muted line between the filter field and the list that is not an entry (the slash menu of an
   *  agent with no commands, naming the command palette's key). */
  readonly note?: string;
  /** What the selected entry's row cuts, wrapped in muted text under the list after a blank row
   *  (the `Configuration problems` list: a problem's message, whose place and setting the row
   *  already shows). Drawn only when the selected row is cut (its title or description does not
   *  fit); when the row shows the entry whole there is no detail and the list keeps the rows. It
   *  takes the rows the overlay can spare once the list keeps `DETAIL_LIST_MIN` rows (or all of
   *  its own, when fewer); its last row ends with `…` when even that is not enough. */
  readonly detail?: string | null;
}

export interface OverlayFooter {
  readonly text: string;
  readonly token: TokenName;
}

/** The footer wraps to at most this many rows (an error that names a session, an agent and the
 *  agent's own message). */
export const FOOTER_MAX_ROWS = 4;

/** The list keeps at least this many rows (or all of its rows, when fewer) beside a detail area. */
export const DETAIL_LIST_MIN = 3;

/** Detail columns keep the title column at least this wide (or as wide as the longest title, when
 *  that is shorter); columns are dropped until it is. */
export const DETAIL_TITLE_MIN = 24;

/** The title column is never wider than this: a title is cut to 80 columns when it is stored. */
export const DETAIL_TITLE_MAX = 80;

/** Two spaces before each detail column. */
const DETAIL_GAP = 2;

/** The detail columns of a list: the title column's width, then the columns kept, in order. */
export interface DetailColumns {
  readonly title: number;
  readonly columns: readonly { readonly index: number; readonly width: number }[];
}

/**
 * One layout for every row with details (the session list), so the columns line up and do not
 * move when rows arrive later (day-two-feedback task 12.5): each column as wide as its widest
 * value over `items` and at least `minWidths[index]` (a column with no values takes no room), and
 * the title column whatever the kept columns leave of `inner`, up to `DETAIL_TITLE_MAX`: a
 * title that arrives later and is longer than the ones before it changes nothing but its own cut.
 * While the title column would be less than `DETAIL_TITLE_MIN` (or the longest title, when
 * shorter: so a pane too narrow for the columns drops them as before, and only there can a title
 * arriving later change what is dropped), whole columns are dropped for every row at once, in
 * `dropOrder` (indices into `details`; default right to left). The title is never dropped; a
 * longer one is cut with `…`. Null when no item has details.
 */
export function detailColumns(
  items: readonly ListItem[],
  inner: number,
  dropOrder?: readonly number[],
  minWidths: readonly number[] = [],
): DetailColumns | null {
  const rows = items.filter((item) => item.details !== undefined);
  if (rows.length === 0) return null;
  const count = Math.max(0, ...rows.map((item) => item.details!.length));
  const widths = Array.from({ length: count }, (_, i) => {
    const widest = Math.max(0, ...rows.map((item) => displayWidth(item.details![i] ?? "")));
    return widest > 0 ? Math.max(widest, minWidths[i] ?? 0) : 0;
  });
  const longest = Math.max(1, ...rows.map((item) => displayWidth(item.title)));
  const titleMin = Math.min(longest, DETAIL_TITLE_MIN);
  const kept = new Set(widths.map((w, i) => (w > 0 ? i : -1)).filter((i) => i >= 0));
  const used = () => [...kept].reduce((n, i) => n + DETAIL_GAP + widths[i]!, 0);
  const order = [...(dropOrder ?? []), ...widths.map((_, i) => i).reverse()];
  for (const index of order) {
    if (inner - used() >= titleMin) break;
    kept.delete(index);
  }
  return {
    title: Math.max(1, Math.min(DETAIL_TITLE_MAX, inner - used())),
    columns: [...kept].sort((a, b) => a - b).map((index) => ({ index, width: widths[index]! })),
  };
}

/** `text` wrapped at spaces to `width` columns, at most `max` rows; the last row ends with `…` when
 *  more was cut. Always at least one row. */
export function wrapText(text: string, width: number, max: number): string[] {
  const rows: string[] = [];
  let line = "";
  const words = text.split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    let word = words[i]!;
    const candidate = line === "" ? word : `${line} ${word}`;
    if (displayWidth(candidate) <= width) {
      line = candidate;
      continue;
    }
    if (line !== "") rows.push(line);
    // A word wider than the row is cut into pieces.
    while (displayWidth(word) > width) {
      const piece = takeWidth(word, width);
      rows.push(piece);
      word = word.slice(piece.length);
    }
    line = word;
  }
  if (line !== "" || rows.length === 0) rows.push(line);
  if (rows.length <= max) return rows;
  const kept = rows.slice(0, max);
  kept[max - 1] = truncateEnd(`${kept[max - 1]!} ${rows[max]!}`, width);
  if (!kept[max - 1]!.endsWith("…")) kept[max - 1] = `${takeWidth(kept[max - 1]!, width - 1)}…`;
  return kept;
}

export interface OverlayLayout {
  readonly lines: OverlaySegment[][];
  /** List rows shown (the page size). */
  readonly listHeight: number;
  readonly offset: number;
  /** The list's rows as laid out (headers and blank rows included), for paging (`pageSelection`). */
  readonly rows: readonly ListRow[];
  /** For each line of `lines`, the index into `OverlayView.items` of the item it shows, or null for
   *  every other line (borders, filter, headers, blank rows, footer): what a click or the pointer
   *  on that line means (day-two-feedback task 13.6). */
  readonly itemAt: readonly (number | null)[];
}

const frame: TokenName = "accent";

function framed(content: OverlaySegment[], inner: number, selected = false): OverlaySegment[] {
  const w = content.reduce((n, s) => n + displayWidth(s.text), 0);
  return [
    { text: `${OVERLAY_FRAME.vertical} `, token: frame },
    ...content,
    { text: " ".repeat(Math.max(0, inner - w)), token: "text", ...(selected ? { selected: true } : {}) },
    { text: ` ${OVERLAY_FRAME.vertical}`, token: frame },
  ];
}

/** A row with details, in the list's columns: the title padded to the title column (cut with
 *  `…` when longer), then each kept detail padded to its column, two spaces apart. */
function detailRow(item: ListItem, columns: DetailColumns, selected: boolean): OverlaySegment[] {
  const sel = selected ? { selected: true } : {};
  const title = truncateEnd(item.title, columns.title);
  const out: OverlaySegment[] = [{ text: title, token: "text", ...sel }];
  const pad = columns.title - displayWidth(title);
  if (pad > 0) out.push({ text: " ".repeat(pad), token: "text", ...sel });
  for (const { index, width } of columns.columns) {
    const detail = item.details![index] ?? "";
    out.push({ text: `${" ".repeat(DETAIL_GAP)}${detail}${" ".repeat(Math.max(0, width - displayWidth(detail)))}`, token: "muted", ...sel });
  }
  return out;
}

function itemRow(item: ListItem, inner: number, selected: boolean, marks: boolean, columns: DetailColumns | null): OverlaySegment[] {
  if (item.details && columns) return detailRow(item, columns, selected);
  // A muted entry (not available now) is never highlighted and is drawn whole in the muted colour.
  const sel = selected && !item.muted ? { selected: true } : {};
  const body: TokenName = item.muted ? "muted" : "text";
  const valueToken: TokenName = item.muted ? "muted" : "accent";
  const mark = marks ? 2 : 0;
  // The value and the keys (or the route), at most half the row; the title keeps the rest.
  const half = Math.floor(inner / 2);
  const right: OverlaySegment[] = [];
  if (item.value) right.push({ text: item.value, token: valueToken, ...sel });
  const keys = item.keys && item.keys.length > 0 ? item.keys.join(" ") : (item.route ?? "");
  if (keys) right.push({ text: `${item.value ? "  " : ""}${keys}`, token: "muted", ...sel });
  let rightWidth = right.reduce((n, s) => n + displayWidth(s.text), 0);
  if (rightWidth > half) {
    const text = truncateEnd(right.map((s) => s.text).join(""), half);
    right.splice(0, right.length, { text, token: valueToken, ...sel });
    rightWidth = displayWidth(text);
  }
  const titleRoom = Math.max(1, inner - mark - rightWidth - (rightWidth > 0 ? 2 : 0));
  const title = truncateEnd(item.title, titleRoom);
  const out: OverlaySegment[] = [];
  if (marks) out.push({ text: item.current ? `${CURRENT_MARK} ` : "  ", token: valueToken, ...sel });
  out.push({ text: title, token: body, ...sel });
  let left = displayWidth(title);
  // The description in what the title leaves, two columns after it, while a few columns are left.
  const descriptionRoom = titleRoom - left - 2;
  if (item.description && descriptionRoom >= 4) {
    const description = truncateEnd(item.description, descriptionRoom);
    out.push({ text: `  ${description}`, token: "muted", ...sel });
    left += 2 + displayWidth(description);
  }
  const gap = inner - mark - left - rightWidth;
  if (rightWidth > 0) out.push({ text: " ".repeat(Math.max(1, gap)), token: body, ...sel }, ...right);
  return out;
}

/** Whether the row of `item` cuts its title or description (`…`), so that the detail has more
 *  to show than the row. */
function rowIsCut(item: ListItem, inner: number, marks: boolean, columns: DetailColumns | null): boolean {
  const shown = itemRow(item, inner, false, marks, columns).map((s) => s.text).join("");
  return !shown.includes(item.title) || (!!item.description && !shown.includes(item.description));
}

/**
 * The overlay's rows for the whole screen width: the top border with the title, the match count
 * and the close key; the filter field (when the list has one); the list, grouped (a header above
 * the matching items of each group while filtered), scrolled to keep the selection in view; the
 * selected entry in full (`detail`, when given); the footer; the bottom border with key hints. At most
 * `rows - OVERLAY_RESERVED_ROWS` rows, and no taller than the list needs (or than `minRows`).
 */
export function overlayLayout(view: OverlayView): OverlayLayout {
  const width = Math.max(8, view.width);
  const inner = width - 4;
  const h = OVERLAY_FRAME.horizontal;
  // Headers stay while the list is filtered, above the items that match (task 12.8).
  const rows = listRows(view.items, view.grouped);
  const maxHeight = Math.min(view.maxRows ?? Infinity, Math.max(4, view.rows - OVERLAY_RESERVED_ROWS));
  const footer = view.footer ? wrapText(view.footer.text, inner, FOOTER_MAX_ROWS) : [];
  const fixedBase = 2 + (view.filter !== null ? 1 : 0) + (view.note ? 1 : 0) + footer.length;
  const columns = detailColumns(view.items, inner, view.detailDrop, view.detailMin);
  // The detail area: a blank row, then what the selected row cuts, wrapped, in the rows the list
  // can spare; none when the row shows the entry whole.
  const selectedItem = view.items[view.selected];
  const detailRoom = maxHeight - fixedBase - Math.min(Math.max(1, rows.length), DETAIL_LIST_MIN);
  const detail =
    view.detail && selectedItem && detailRoom >= 2 && rowIsCut(selectedItem, inner, view.marks, columns)
      ? ["", ...wrapText(view.detail, inner, detailRoom - 1)]
      : [];
  const fixed = fixedBase + detail.length;
  const fewest = Math.min(maxHeight, view.minRows ?? 0) - fixed;
  const listHeight = Math.max(1, Math.min(Math.max(1, rows.length, fewest), maxHeight - fixed));
  const offset = scrollOffset(rows, view.selected, listHeight, view.offset);

  // Top border: `╭─ Commands 18 ───── esc ─╮`.
  const count = ` ${view.count ?? view.items.length}`;
  const close = view.closeLabel ? ` ${view.closeLabel} ` : "";
  const titleRoom = Math.max(1, width - 5 - displayWidth(count) - displayWidth(close) - 1);
  const title = truncateEnd(view.title, titleRoom);
  const used = 3 + displayWidth(title) + displayWidth(count) + 1 + displayWidth(close) + 2;
  const top: OverlaySegment[] = [
    { text: `${OVERLAY_FRAME.topLeft}${h} `, token: frame },
    { text: title, token: "accent" },
    { text: count, token: "muted" },
    { text: ` ${h.repeat(Math.max(0, width - used))}`, token: frame },
    ...(close ? [{ text: close, token: "muted" as TokenName }] : []),
    { text: `${h}${OVERLAY_FRAME.topRight}`, token: frame },
  ];

  const lines: OverlaySegment[][] = [top];
  // Which line shows which item (for a click or the pointer: `OverlayLayout.itemAt`).
  const itemLines = new Map<number, number>();
  if (view.filter !== null) {
    const shown = view.filter === "" ? [] : [{ text: takeWidth(view.filter.slice(-(inner - 4)), inner - 4), token: "text" as TokenName }];
    lines.push(
      framed(
        [
          { text: "› ", token: "accent" },
          ...shown,
          { text: " ", token: "text", cursor: true },
          ...(view.filter === "" ? [{ text: truncateEnd(view.placeholder, inner - 3), token: "muted" as TokenName }] : []),
        ],
        inner,
      ),
    );
  }
  if (view.note) lines.push(framed([{ text: truncateEnd(view.note, inner), token: "muted" }], inner));
  for (let r = offset; r < offset + listHeight; r++) {
    const row = rows[r];
    if (!row) {
      const text = r === 0 ? (view.empty ?? "no matches") : r === rows.length ? view.tail : undefined;
      lines.push(framed(text === undefined ? [] : [{ text: truncateEnd(text, inner), token: "muted" }], inner));
      continue;
    }
    if (row.kind === "gap") {
      lines.push(framed([], inner));
      continue;
    }
    if (row.kind === "header") {
      // Bold in the default foreground, so a header never reads as a disabled entry ((d) 4).
      lines.push(framed([{ text: truncateEnd(row.label, inner), token: "text", bold: true }], inner));
      continue;
    }
    const selected = row.index === view.selected && !view.items[row.index]!.muted;
    itemLines.set(lines.length, row.index);
    lines.push(framed(itemRow(view.items[row.index]!, inner, selected, view.marks, columns), inner, selected));
  }
  for (const text of detail) lines.push(framed(text === "" ? [] : [{ text, token: "muted" }], inner));
  for (const text of footer) lines.push(framed(text === "" ? [] : [{ text, token: view.footer!.token }], inner));

  // Bottom border with the hints, cut between hints when narrow.
  const hints = fitSegments(view.hints, Math.max(0, width - 6));
  const hintWidth = hints.reduce((n, s) => n + displayWidth(s.text), 0);
  lines.push([
    { text: `${OVERLAY_FRAME.bottomLeft}${h}${hintWidth > 0 ? " " : h}`, token: frame },
    ...hints,
    { text: `${hintWidth > 0 ? " " : h}${h.repeat(Math.max(0, width - 5 - hintWidth))}${OVERLAY_FRAME.bottomRight}`, token: frame },
  ]);
  return { lines, listHeight, offset, rows, itemAt: lines.map((_, line) => itemLines.get(line) ?? null) };
}
