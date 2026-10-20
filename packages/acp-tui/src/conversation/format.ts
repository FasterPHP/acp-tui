// Pure formatting for the conversation view's collapsed items (design 6.2,
// spec tui-conversation "Item presentation"): tool lines, thought and plan
// lines, permission outcomes, turn-end markers, plan entries, and the Phase 0
// activity-region rows.
// Everything returns styled segments (text plus theme token) so it is unit
// testable and never holds a literal colour. Text is already sanitised by
// acp-model; only whitespace is flattened for one-line layouts.
import type { PlanEntry, UsageUpdate } from "@agentclientprotocol/sdk";
import type { MarkerItem, PermissionRecordItem, ThoughtItem, ToolCallItem } from "acp-model";
import { formatCount } from "../layout/modules.ts";
import { displayWidth, fitSegments, segmentsWidth, truncateEnd, type Segment } from "../layout/segments.ts";
import { toolKindToken } from "../theme/tokens.ts";
import type { ConversationGlyphs } from "./glyphs.ts";
import { LIVE_GLYPHS } from "./live-glyphs.ts";
import { commandResult, resultOutputLines, toolContent } from "./command-result.ts";
import { singleFence } from "./markdown/project.ts";

/** Spec tui-agent-session, "Unsupported client-side terminal content": an expanded tool card's text
 *  for a `terminal` content block. */
export const TERMINAL_UNAVAILABLE_NOTICE = "terminal output unavailable (client terminals not supported)";
/** The same notice, shortened for a one-liner summary. */
export const TERMINAL_UNAVAILABLE_SHORT = "terminal output unavailable";

/** Durations below this are not shown on one-liners (noise from fast local tools). */
export const MIN_SHOWN_DURATION_MS = 100;

const KIND_WIDTH = 8;

/** Collapses newlines and runs of whitespace, for text shown on one row. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function lines(text: string): string[] {
  if (text === "") return [];
  const out = text.split("\n");
  if (out.at(-1) === "") out.pop();
  return out;
}

/**
 * Added and removed line counts between two texts, counting lines as a multiset: a line present
 * in both (as often as it occurs in both) is unchanged. Equals the unified diff's counts for
 * insertions, deletions and replacements; expanded tool cards compute the real diff (diff.ts).
 */
export function diffCounts(oldText: string | null, newText: string): { added: number; removed: number } {
  const before = new Map<string, number>();
  for (const line of lines(oldText ?? "")) before.set(line, (before.get(line) ?? 0) + 1);
  let added = 0;
  for (const line of lines(newText)) {
    const n = before.get(line) ?? 0;
    if (n > 0) before.set(line, n - 1);
    else added += 1;
  }
  let removed = 0;
  for (const n of before.values()) removed += n;
  return { added, removed };
}

/** A tool's summary: line counts for diffs, output line count, or the terminal notice. */
export function toolSummary(item: ToolCallItem): Segment[] {
  let added = 0;
  let removed = 0;
  let diffs = 0;
  let outputLines = 0;
  let terminal = false;
  // A non-zero return code of a recognised command result (the last one, if several).
  let exitCode: number | null = null;
  for (const block of toolContent(item)) {
    if (block.type === "diff") {
      const counts = diffCounts(block.oldText, block.newText);
      added += counts.added;
      removed += counts.removed;
      diffs += 1;
    } else if (block.type === "text") {
      const result = commandResult(block.text, item.toolKind, item.toolStatus);
      if (result) {
        // A command result counts its output lines; a non-zero code is the summary.
        outputLines += resultOutputLines(result.output).length;
        if (result.code !== 0) exitCode = result.code;
        continue;
      }
      // A text that is exactly one fence (as `claude-agent-acp` sends command output and files)
      // counts the lines inside it, as the card draws them, not its two marker lines.
      const fence = singleFence(block.text);
      outputLines += fence ? lines(fence.code).length : lines(block.text).length;
    } else {
      terminal = true;
    }
  }
  const out: Segment[] = [];
  if (diffs > 0) {
    out.push({ text: `+${added}`, token: "diff.add" }, { text: " ", token: "muted" }, { text: `-${removed}`, token: "diff.remove" });
  } else if (exitCode !== null) {
    out.push({ text: `exit ${exitCode}`, token: "tool.fail" });
  } else if (outputLines > 1) {
    out.push({ text: `${outputLines} lines`, token: "tool.count" });
  }
  if (terminal) {
    if (out.length > 0) out.push({ text: "  ", token: "muted" });
    out.push({ text: TERMINAL_UNAVAILABLE_SHORT, token: "muted" });
  }
  return out;
}

export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function toolDuration(item: ToolCallItem): string | null {
  if (item.startedAt === null || item.endedAt === null) return null;
  const ms = item.endedAt - item.startedAt;
  return ms >= MIN_SHOWN_DURATION_MS ? formatDuration(ms) : null;
}

function toolKind(item: ToolCallItem): string {
  return oneLine(item.toolKind ?? item.toolName ?? "tool");
}

function statusOf(item: ToolCallItem, glyphs: ConversationGlyphs, frame: number | null): Segment {
  // A live tool is still running; a final one the turn ended on while pending is stopped.
  const live = item.status === "live";
  switch (item.toolStatus) {
    case "completed":
      return { text: glyphs.toolStatus.ok, token: "tool.ok" };
    case "failed":
      return { text: glyphs.toolStatus.fail, token: "tool.fail" };
    default: {
      if (!live) return { text: glyphs.toolStatus.stopped, token: "muted" };
      const spinner = frame === null ? glyphs.toolStatus.running : glyphs.spinner[frame % glyphs.spinner.length]!;
      return { text: spinner, token: "tool.running" };
    }
  }
}

function pad(text: string, width: number): string {
  const w = displayWidth(text);
  return w >= width ? text : text + " ".repeat(width - w);
}

/**
 * Joins `head` (fixed), a title that may be truncated, and `tail` (fixed) into at most `width`
 * columns: the title gives way first, then everything is cut with an ellipsis.
 */
function fitWithTitle(head: Segment[], title: Segment, tail: Segment[], width: number): Segment[] {
  const fixed = segmentsWidth(head) + segmentsWidth(tail);
  const room = width - fixed;
  if (room >= Math.min(displayWidth(title.text), 8)) {
    const out = [...head, { ...title, text: truncateEnd(title.text, room) }, ...tail];
    // A short title leaves the tail's leading gap; nothing more to do.
    return out;
  }
  return fitSegments([...head, title, ...tail], width);
}

/** A tool kind's glyph (`→` read, `←` edit, `$` execute, ...). */
export function kindGlyph(item: ToolCallItem, glyphs: ConversationGlyphs = LIVE_GLYPHS): string {
  return (item.toolKind && glyphs.toolKind[item.toolKind]) || glyphs.toolKind.other;
}

/**
 * A collapsed tool call without its gutter (spec tui-conversation "Item presentation"): the kind
 * glyph, the status (a spinner frame while running, `✓`, `✗` or `stop`), the kind, the title,
 * then right-aligned the summary, the duration and the dim index; exactly `width` columns when
 * it fits, the title giving way first. `frame` picks the spinner frame (null: the static glyph).
 * Each segment is in its own token (spec tui-theme "Tool-line segment tokens"): the kind glyph and
 * kind in `tool.kind.<kind>` (which defaults to `tool.kind`), the title in `tool.title`, counts in
 * `tool.count`, diff counts in `diff.add` and `diff.remove`, the duration in `tool.duration`, the
 * index in `tool.index`, and the status in `tool.ok`, `tool.fail` or `tool.running`.
 */
export function toolLine(item: ToolCallItem, width: number, glyphs: ConversationGlyphs = LIVE_GLYPHS, frame: number | null = 0): Segment[] {
  const status = statusOf(item, glyphs, frame);
  const kind = toolKindToken(item.toolKind);
  const head: Segment[] = [
    { text: kindGlyph(item, glyphs), token: kind },
    { text: " ", token: "muted" },
    { ...status, text: `${status.text} ` },
    { text: pad(toolKind(item), KIND_WIDTH) + " ", token: kind },
  ];
  const gap: Segment = { text: "  ", token: "muted" };
  const tail: Segment[] = [];
  const summary = toolSummary(item);
  if (summary.length > 0) tail.push(...summary);
  const duration = toolDuration(item);
  if (duration) tail.push(...(tail.length > 0 ? [gap] : []), { text: duration, token: "tool.duration" });
  tail.push(...(tail.length > 0 ? [gap] : []), { text: `#${item.index}`, token: "tool.index" });
  const title: Segment = { text: oneLine(item.title) || toolKind(item), token: "tool.title" };
  const room = width - segmentsWidth(head) - segmentsWidth(tail) - 2;
  if (room >= Math.min(displayWidth(title.text), 8)) {
    const shown = truncateEnd(title.text, room);
    const fill = width - segmentsWidth(head) - displayWidth(shown) - segmentsWidth(tail);
    return [...head, { ...title, text: shown }, { text: " ".repeat(fill), token: "muted" }, ...tail];
  }
  return fitSegments([...head, title, gap, ...tail], width);
}

/**
 * Whether the collapsed tool line at `width` columns (without its gutter) shows the whole title,
 * so an expanded card need not repeat it (spec tui-rendering "Expanded tool card"; review C13).
 * Read from the line itself, so it agrees with what is drawn; the spinner frame never changes it
 * (every frame is one column, as is the static glyph).
 */
export function toolTitleShown(item: ToolCallItem, width: number, glyphs: ConversationGlyphs = LIVE_GLYPHS): boolean {
  const title = oneLine(item.title) || toolKind(item);
  return toolLine(item, width, glyphs, null).some((s) => s.token === "tool.title" && s.text === title);
}

/** One activity-region row for an in-progress tool, without its gutter. */
export function activityLine(item: ToolCallItem, width: number, glyphs: ConversationGlyphs = LIVE_GLYPHS): Segment[] {
  const head: Segment[] = [
    { text: `${glyphs.toolStatus.running} `, token: "tool.running" },
    { text: `#${item.index} `, token: "tool.index" },
    { text: pad(toolKind(item), KIND_WIDTH) + " ", token: toolKindToken(item.toolKind) },
  ];
  return fitWithTitle(head, { text: oneLine(item.title) || toolKind(item), token: "tool.title" }, [], width);
}

/** The activity region's rows (without gutters): at most `max` tools, then `+N more`. */
export function activityRows(tools: readonly ToolCallItem[], width: number, max = 3, glyphs: ConversationGlyphs = LIVE_GLYPHS): Segment[][] {
  const rows = tools.slice(0, max).map((tool) => activityLine(tool, width, glyphs));
  if (tools.length > max) rows.push([{ text: `+${tools.length - max} more`, token: "muted" }]);
  return rows;
}

export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

/** The title of a thought: its leading bold line (`**Checking the pool tests**`), or null. */
export function thoughtTitle(text: string): string | null {
  const match = /^\s*(?:\*\*|__)(.+?)(?:\*\*|__)[ \t]*(?:\n|$)/.exec(text);
  const title = match ? oneLine(match[1]!) : "";
  return title === "" ? null : title;
}

/**
 * A collapsed thought without its gutter (spec tui-conversation "Item presentation"): the thought
 * glyph, `Thought` (`Thinking` while it streams) and the title from a leading bold line; without
 * a title, the word count.
 */
export function thoughtLine(item: ThoughtItem, width = Infinity, glyphs: ConversationGlyphs = LIVE_GLYPHS): Segment[] {
  const label = item.status === "live" ? "Thinking" : "Thought";
  const title = thoughtTitle(item.text);
  const n = wordCount(item.text);
  const rest = title !== null ? `: ${title}` : `${glyphs.separator}${n} ${n === 1 ? "word" : "words"}`;
  const segments: Segment[] = [{ text: `${glyphs.thought} ${label}${rest}`, token: "thought" }];
  return Number.isFinite(width) ? fitSegments(segments, width) : segments;
}

/** A collapsed plan without its gutter: `plan 3/5` (entries completed of all). */
export function planLine(entries: readonly PlanEntry[]): Segment[] {
  const done = entries.filter((e) => e.status === "completed").length;
  return [{ text: `plan ${done}/${entries.length}`, token: "muted" }];
}

const OUTCOME_LABELS: Record<string, string> = {
  allow_once: "allow once",
  allow_always: "allow always",
  reject_once: "reject once",
  reject_always: "reject always",
};

/** A request the agent withdrew (`$/cancel_request`; spec tui-agent-session "Permission withdrawal"). */
export const WITHDRAWN_LABEL = "withdrawn by agent";

/** Permission outcome one-liner without its gutter: `#2 permission  allow once  Edit src/x.ts`. */
export function permissionLine(item: PermissionRecordItem, tool: ToolCallItem | null, width: number): Segment[] {
  const outcome = item.outcome;
  const label =
    outcome.type === "answered" ? (OUTCOME_LABELS[outcome.optionKind] ?? oneLine(outcome.optionKind)) : outcome.type === "withdrawn" ? WITHDRAWN_LABEL : outcome.type;
  const token = outcome.type === "answered" ? (outcome.optionKind.startsWith("allow") ? "tool.ok" : "tool.fail") : "muted";
  const head: Segment[] = [
    { text: tool ? `#${tool.index} ` : "", token: "muted" },
    { text: "permission  ", token: "muted" },
    { text: label, token },
    { text: "  ", token: "muted" },
  ];
  return fitWithTitle(head, { text: oneLine(item.title || tool?.title || ""), token: "text" }, [], width);
}

function stopReasonLabel(reason: string): string {
  return reason.replace(/_/g, " ");
}

/** Turn-end marker without its gutter: `end turn · 1.2s · ctx 38k/200k`. */
export function turnEndLine(
  marker: Extract<MarkerItem, { markerKind: "turn_end" }>,
  glyphs: ConversationGlyphs = LIVE_GLYPHS,
): Segment[] {
  const parts = [stopReasonLabel(marker.stopReason), formatDuration(marker.durationMs)];
  const usage: UsageUpdate | null = marker.usage;
  if (usage && usage.size > 0) parts.push(`ctx ${formatCount(usage.used)}/${formatCount(usage.size)}`);
  return [{ text: parts.join(glyphs.separator), token: "muted" }];
}

/** An expanded plan's rows without gutters: one row per entry with its status. */
export function planRows(entries: readonly PlanEntry[], glyphs: ConversationGlyphs = LIVE_GLYPHS): Segment[][] {
  const rows: Segment[][] = [];
  for (const entry of entries) {
    const glyph = glyphs.plan[entry.status] ?? glyphs.plan.pending;
    const token = entry.status === "completed" ? "muted" : entry.status === "in_progress" ? "accent" : "text";
    rows.push([
      { text: `${glyph} `, token },
      { text: oneLine(entry.content), token: entry.status === "completed" ? "muted" : "text" },
    ]);
  }
  return rows;
}
