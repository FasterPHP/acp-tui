// Tool-card content (design 6.2, D9), as pure functions over the session
// model: the Ctrl+O target rule (`viewerTarget`, toggled in place by the
// conversation), the expanded card's lines (`cardLines`: text, numbered
// unified diffs, the terminal notice), and wrapping into display rows. The
// header and `contentLines` were the Phase 0 viewer's. Text is already
// sanitised by acp-model; this only lays it out. No OpenTUI here.
import type { Item, ToolCallItem, ToolCallItemContent } from "acp-model";
import { displayWidth, fitSegments, segmentsWidth, takeWidth, truncateEnd, type Segment } from "../layout/segments.ts";
import type { TokenName } from "../theme/index.ts";
import { TERMINAL_UNAVAILABLE_NOTICE } from "./format.ts";
import { numberedDiff, unifiedDiff, type DiffLine } from "./diff.ts";

/** Labels and glyphs the viewer draws; one object so Phase 1 glyph sets can replace it. */
export const VIEWER_TEXT = {
  noContent: "(no content)",
  awaitingPermission: "awaiting permission",
  /** Columns a tab advances to (multiples of). */
  tabWidth: 8,
  separator: "  ",
} as const;

/** The session fields target selection reads (the store's `SessionState` satisfies it). */
export interface ViewerSession {
  readonly order: readonly string[];
  readonly items: Readonly<Record<string, Item>>;
  readonly openPermissionId: string | null;
}

function toolFor(session: ViewerSession, toolCallId: string): ToolCallItem | null {
  const item = session.items[`tool:${toolCallId}`];
  if (item?.kind === "tool_call") return item;
  // Ids are `tool:<toolCallId>` today; fall back to a scan so the rule does not hang on that.
  for (const id of session.order) {
    const other = session.items[id];
    if (other?.kind === "tool_call" && other.toolCallId === toolCallId) return other;
  }
  return null;
}

/**
 * The Ctrl+O target rule (spec tui-conversation "Collapse and expand in place"): the tool call behind the open permission request if there is one,
 * otherwise the most recent tool call (the highest index). Null when the session has none.
 */
export function viewerTarget(session: ViewerSession): string | null {
  const permissionId = session.openPermissionId;
  const record = permissionId ? session.items[permissionId] : undefined;
  if (record?.kind === "permission_record") {
    const tool = toolFor(session, record.toolCallId);
    if (tool) return tool.id;
  }
  let latest: ToolCallItem | null = null;
  for (const id of session.order) {
    const item = session.items[id];
    if (item?.kind === "tool_call" && (latest === null || item.index > latest.index)) latest = item;
  }
  return latest?.id ?? null;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function statusToken(item: ToolCallItem): Segment["token"] {
  switch (item.toolStatus) {
    case "completed":
      return "tool.ok";
    case "failed":
      return "tool.fail";
    case "in_progress":
      return "tool.running";
    default:
      return "muted";
  }
}

/**
 * Header row: `#7  execute  Run the tests  in_progress`, laid out side by side within `width`
 * so the row never overflows it (that would overlap the row below, or the next repaint).
 *
 * Index and kind (`head`) are shown in full down to widths that would fit no content at all (an
 * index and kind alone rarely reach the width of a terminal usable enough to open the viewer in),
 * falling back to `fitSegments`' truncation only past that point. The status and, when a
 * permission is open, `awaitingPermission` are candidate tails, tried from most to least
 * detailed; the first one that still leaves room for at least one column of title wins, so the
 * title gives way before the status does. Only once no tail leaves any room for the title is the
 * status dropped entirely (the empty tail always "fits", down to an empty title).
 */
export function headerSegments(item: ToolCallItem, width: number, awaitingPermission = false): Segment[] {
  const sep = VIEWER_TEXT.separator;
  const sepWidth = displayWidth(sep);
  const w = Math.max(0, width);
  const head: Segment[] = [
    { text: `#${item.index}`, token: "accent" },
    { text: sep, token: "muted" },
    { text: oneLine(item.toolKind ?? item.toolName ?? "tool"), token: "muted" },
  ];
  const fittedHead = segmentsWidth(head) <= w ? head : fitSegments(head, w);
  const headWidth = segmentsWidth(fittedHead);
  const statusText = item.toolStatus.replace(/_/g, " ");
  const statusSeg: Segment = { text: statusText, token: statusToken(item) };
  const sepSeg: Segment = { text: sep, token: "muted" };

  // Most to least detailed; the last (no status at all) always "fits".
  const tailCandidates: Segment[][] = [];
  if (awaitingPermission) {
    tailCandidates.push([sepSeg, statusSeg, sepSeg, { text: VIEWER_TEXT.awaitingPermission, token: "permission" }]);
  }
  tailCandidates.push([sepSeg, statusSeg]);
  tailCandidates.push([]);

  let tail: Segment[] = tailCandidates[tailCandidates.length - 1]!;
  let titleWidth = 0;
  for (const candidate of tailCandidates) {
    const room = w - headWidth - sepWidth - segmentsWidth(candidate);
    if (room >= 1 || candidate.length === 0) {
      tail = candidate;
      titleWidth = Math.max(0, room);
      break;
    }
  }

  const title = oneLine(item.title) || oneLine(item.toolKind ?? "tool");
  const shownTitle = truncateEnd(title, titleWidth);
  if (shownTitle === "") return [...fittedHead, ...tail];
  return [...fittedHead, sepSeg, { text: shownTitle, token: "text" }, ...tail];
}

/** Expands tabs to the next multiple of `tabWidth` columns, so cell widths are known. */
export function expandTabs(line: string, tabWidth: number = VIEWER_TEXT.tabWidth): string {
  if (!line.includes("\t")) return line;
  let out = "";
  for (const part of line.split(/(\t)/)) {
    if (part === "\t") out += " ".repeat(tabWidth - (displayWidth(out) % tabWidth));
    else out += part;
  }
  return out;
}

function textLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  return lines;
}

const DIFF_TOKENS: Record<DiffLine["kind"], Segment["token"]> = {
  file: "muted",
  hunk: "diff.hunk",
  equal: "text",
  remove: "diff.remove",
  add: "diff.add",
  note: "muted",
};

function blockLines(block: ToolCallItemContent): Segment[][] {
  switch (block.type) {
    case "text":
      return textLines(block.text).map((line) => [{ text: expandTabs(line), token: "text" }]);
    case "diff":
      return unifiedDiff(block.path, block.oldText, block.newText).map((line) => [
        { text: expandTabs(line.text), token: DIFF_TOKENS[line.kind] },
      ]);
    case "terminal_unavailable":
      return [[{ text: TERMINAL_UNAVAILABLE_NOTICE, token: "muted" }]];
  }
}

/** The tool's content as logical lines (unwrapped), blocks separated by a blank line. */
export function contentLines(item: ToolCallItem): Segment[][] {
  const out: Segment[][] = [];
  for (const block of item.content) {
    if (out.length > 0) out.push([]);
    out.push(...blockLines(block));
  }
  if (out.length === 0) out.push([{ text: VIEWER_TEXT.noContent, token: "muted" }]);
  return out;
}

/** One logical line of an expanded tool card, with the surface filling its row (diff lines). */
export interface CardLine {
  readonly segments: Segment[];
  readonly fill?: TokenName;
}

const NUMBERED_TOKENS = { hunk: "diff.hunk", equal: "text", remove: "diff.remove", add: "diff.add", note: "muted" } as const;

/** A diff block as card lines: the path, then `@@` headers and numbered lines with their signs. */
export function diffCardLines(path: string, oldText: string | null, newText: string): CardLine[] {
  const rows = numberedDiff(oldText, newText);
  const width = String(Math.max(1, ...rows.map((r) => r.number ?? 0))).length;
  const out: CardLine[] = [{ segments: [{ text: oldText === null ? `${path} (new file)` : path, token: "muted" }] }];
  for (const row of rows) {
    const token = NUMBERED_TOKENS[row.kind];
    if (row.number === null) {
      out.push({ segments: [{ text: expandTabs(row.text), token }] });
      continue;
    }
    const fill: TokenName | undefined = row.kind === "add" ? "diff.added.bg" : row.kind === "remove" ? "diff.removed.bg" : undefined;
    out.push({
      segments: [
        { text: `${String(row.number).padStart(width)} `, token: "muted" },
        { text: `${row.sign} `, token },
        { text: expandTabs(row.text), token },
      ],
      ...(fill ? { fill } : {}),
    });
  }
  return out;
}

/**
 * An expanded tool card's content (spec tui-conversation "Collapse and expand in place"): text
 * blocks as sanitised text, diffs as numbered unified diffs computed locally, and the notice
 * for `terminal` content; blocks separated by a blank line.
 */
export function cardLines(item: ToolCallItem): CardLine[] {
  const out: CardLine[] = [];
  for (const block of item.content) {
    if (out.length > 0) out.push({ segments: [] });
    switch (block.type) {
      case "text":
        out.push(...textLines(block.text).map((line) => ({ segments: [{ text: expandTabs(line), token: "text" as const }] })));
        break;
      case "diff":
        out.push(...diffCardLines(block.path, block.oldText, block.newText));
        break;
      case "terminal_unavailable":
        out.push({ segments: [{ text: TERMINAL_UNAVAILABLE_NOTICE, token: "muted" }] });
        break;
    }
  }
  if (out.length === 0) out.push({ segments: [{ text: VIEWER_TEXT.noContent, token: "muted" }] });
  return out;
}

/** Splits one logical line into display rows of at most `width` columns (graphemes kept whole). */
export function wrapLine(line: readonly Segment[], width: number): Segment[][] {
  const w = Math.max(1, width);
  const rows: Segment[][] = [];
  let row: Segment[] = [];
  let used = 0;
  for (const segment of line) {
    let text = segment.text;
    while (text !== "") {
      const room = w - used;
      const piece = takeWidth(text, room);
      if (piece === "") {
        // A wide grapheme that does not fit: start a new row (or place it alone on an empty one).
        if (used === 0) {
          const first = Array.from(new Intl.Segmenter().segment(text), (g) => g.segment)[0]!;
          row.push({ ...segment, text: first });
          text = text.slice(first.length);
        }
        rows.push(row);
        row = [];
        used = 0;
        continue;
      }
      row.push({ ...segment, text: piece });
      used += displayWidth(piece);
      text = text.slice(piece.length);
      if (text !== "") {
        rows.push(row);
        row = [];
        used = 0;
      }
    }
  }
  rows.push(row);
  return rows;
}

/** One row of `wrapWordsAt`: its segments, and the display column of the line where it starts. */
export interface WordRow {
  readonly segments: Segment[];
  readonly col: number;
}

/** The part of `line` between string offsets `start` and `end` of its joined text. */
function sliceSegments(line: readonly Segment[], start: number, end: number): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const segment of line) {
    const from = Math.max(start, at);
    const to = Math.min(end, at + segment.text.length);
    if (from < to) out.push({ ...segment, text: segment.text.slice(from - at, to - at) });
    at += segment.text.length;
  }
  return out;
}

/**
 * Splits one logical line of prose into display rows of at most `width` columns at word
 * boundaries (S2, IDE session B2: an expanded thought broke as `runni` / `ng it.`): a word that
 * does not fit starts the next row, a word wider than a row is broken (graphemes kept whole),
 * and the spaces at a break are dropped unless they still fit the row. Leading spaces stay.
 * Each row carries the display column where it starts, for the selection's row maps.
 */
export function wrapWordsAt(line: readonly Segment[], width: number): WordRow[] {
  const w = Math.max(1, width);
  const text = line.map((s) => s.text).join("");
  const ranges: [number, number][] = [];
  let rowStart = 0;
  let rowEnd = 0;
  let used = 0;
  let pos = 0;
  const breakRow = (next: number) => {
    ranges.push([rowStart, rowEnd]);
    rowStart = next;
    rowEnd = next;
    used = 0;
  };
  for (const token of text.match(/ +|[^ ]+/g) ?? []) {
    const tw = displayWidth(token);
    if (token.startsWith(" ")) {
      if (used + tw <= w) {
        used += tw;
        rowEnd = pos + token.length;
      } else {
        // The spaces at a break are dropped: the next row starts after them.
        breakRow(pos + token.length);
      }
    } else if (used + tw <= w) {
      used += tw;
      rowEnd = pos + token.length;
    } else {
      if (used > 0) breakRow(pos);
      // A word wider than a row is broken; the last piece stays open for what follows.
      let rest = token;
      let p = pos;
      while (rest !== "") {
        let piece = takeWidth(rest, w - used);
        if (piece === "") piece = Array.from(new Intl.Segmenter().segment(rest), (g) => g.segment)[0]!;
        used += displayWidth(piece);
        p += piece.length;
        rowEnd = p;
        rest = rest.slice(piece.length);
        if (rest !== "") breakRow(p);
      }
    }
    pos += token.length;
  }
  if (ranges.length === 0 || rowEnd > rowStart) ranges.push([rowStart, rowEnd]);
  return ranges.map(([start, end]) => ({ segments: sliceSegments(line, start, end), col: displayWidth(text.slice(0, start)) }));
}

/** `wrapWordsAt` without the columns: display rows of prose at `width`, broken at spaces. */
export function wrapWords(line: readonly Segment[], width: number): Segment[][] {
  return wrapWordsAt(line, width).map((row) => row.segments);
}

/** All display rows for `lines` at `width`. */
export function wrapLines(lines: readonly (readonly Segment[])[], width: number): Segment[][] {
  const out: Segment[][] = [];
  for (const line of lines) {
    if (line.length === 0 || (line.length === 1 && line[0]!.text === "")) out.push([]);
    else out.push(...wrapLine(line, width));
  }
  return out;
}
