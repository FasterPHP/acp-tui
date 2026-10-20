// The windowed list's rows ("entries"), pure (design of record 6.2; decisions 4
// and 8, research/full-screen-synthesis.md section 4): what the conversation
// shows for the model's items under a density, with runs grouped. An entry is a
// model item or a group line; the window (range.ts) mounts a slice of them.
//
// Densities (decision 8; design 6.2 "Density"), switched by `v` while the
// conversation has focus:
//
// - `compact`: tool calls, thoughts and plans collapsed to one
//   line, failed tool calls included, and runs grouped: two or more
//   consecutive finished read, search, fetch and think calls, quiet `other`
//   calls (no diff, no permission request) and thoughts, with nothing else
//   between them, become one line such as
//   `▸ 5 reads · 2 searches · 3.1s` (OpenCode v2's grouping; design 6.2
//   "Group"). A failed call is never grouped (it ends the run, so its ✗ line is seen
//   on its own), nor is a live one (it shows its spinner on its own line until
//   it finishes, then joins the run).
// - `verbose`: everything expanded: tool calls, thoughts and plans show their
//   cards, and nothing is grouped.
// - `focus`, the default (Marcus, 14 October 2026): tool calls and thoughts (with their permission records and
//   plans) are hidden behind one line per turn, such as
//   `▸ 12 tool calls · 3 thoughts · 1 failed`, leaving user and agent
//   messages and the markers (turn ends, errors). A turn starts at a user
//   message; the line sits where the turn's first hidden item was (Claude
//   Code's VS Code focus view, parity 1.1).
//
// An explicit user toggle of an item wins in every density (design 6.2
// "Collapsing anywhere"); a group line opens and closes like an item, and an
// open group shows its members below it (each one line, or its card). Group
// state is kept per group key (`group:run:<first member>` or
// `group:turn:<first hidden item>`), which stays put as a run or turn grows at
// the end.
import type { Item, ThoughtItem, ToolCallItem } from "acp-model";
import type { Segment } from "../../layout/segments.ts";
import { formatDuration, MIN_SHOWN_DURATION_MS } from "../format.ts";
import { isRenderable, spacingBefore, groupOf, type ItemGroup } from "../list.ts";

export type Density = "compact" | "verbose" | "focus";
export const DENSITIES: readonly Density[] = ["compact", "verbose", "focus"];

/** The density after `density` in the `v` cycle. */
export function nextDensity(density: Density): Density {
  return DENSITIES[(DENSITIES.indexOf(density) + 1) % DENSITIES.length]!;
}

export interface ItemEntry {
  readonly kind: "item";
  /** The item's id. */
  readonly key: string;
  /** Blank rows above it. */
  readonly margin: number;
  /** The group whose open line it is shown under, if any. */
  readonly group: string | null;
}

export interface GroupEntry {
  readonly kind: "group";
  /** `group:run:<first member id>` or `group:turn:<first hidden item id>` (model ids never start
   *  with `group:`; some start with `run:`). */
  readonly key: string;
  readonly mode: "run" | "turn";
  /** Member item ids in model order. */
  readonly members: readonly string[];
  readonly open: boolean;
  readonly margin: number;
}

export type Entry = ItemEntry | GroupEntry;

/** Items by id: the store's record or the model's map, behind one function. */
export type ItemLookup = (id: string) => Item | undefined;

/** A lookup over a record (the store's `session.items`). */
export const fromRecord = (items: Readonly<Record<string, Item>>): ItemLookup => (id) => items[id];

export interface EntryList {
  readonly entries: readonly Entry[];
  readonly keys: readonly string[];
  /** Entry index by key. */
  readonly index: ReadonlyMap<string, number>;
  /** The index of the entry that shows each shown item: its own entry, or its group's line
   *  when the group is closed. */
  readonly holder: ReadonlyMap<string, number>;
}

export interface EntryOptions {
  readonly density: Density;
  /** Whether a group key is open (default closed). */
  readonly open: (key: string) => boolean;
}

const GROUPED_TOOL_KINDS = new Set(["read", "search", "fetch", "think"]);

const NO_REQUESTS: ReadonlySet<string> = new Set();

/** The tool call IDs a permission record names (the calls that asked for the user's consent). */
export function permissionRequests(ids: readonly string[], items: ItemLookup): Set<string> {
  const requested = new Set<string>();
  for (const id of ids) {
    const item = items(id);
    if (item?.kind === "permission_record") requested.add(item.toolCallId);
  }
  return requested;
}

/** Whether an item may join a run in `compact`: a finished read, search, fetch or think call
 *  that did not fail, a quiet `other` call (finished, not failed, no diff content and no
 *  permission request among `requested`; design D2), or a finished thought. */
export function groupable(item: Item, requested: ReadonlySet<string> = NO_REQUESTS): boolean {
  if (item.status === "live") return false;
  if (item.kind === "thought") return true;
  if (item.kind !== "tool_call" || item.toolStatus === "failed" || item.toolKind === null) return false;
  if (GROUPED_TOOL_KINDS.has(item.toolKind)) return true;
  return item.toolKind === "other" && !item.content.some((c) => c.type === "diff") && !requested.has(item.toolCallId);
}

/** Whether `focus` hides an item behind its turn's line. */
export function hiddenInFocus(item: Item): boolean {
  return item.kind === "tool_call" || item.kind === "thought" || item.kind === "permission_record" || item.kind === "plan";
}

type Slot = { kind: "item"; id: string } | { kind: "group"; key: string; mode: "run" | "turn"; members: string[] };

/** Runs of two or more groupable items become groups (compact). `requested` is the tool calls
 *  that asked for permission (those named in `ids` unless given). */
export function groupRuns(
  ids: readonly string[],
  items: ItemLookup,
  requested: ReadonlySet<string> = permissionRequests(ids, items),
): Slot[] {
  const out: Slot[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length >= 2) out.push({ kind: "group", key: `${GROUP_PREFIX}run:${run[0]}`, mode: "run", members: run });
    else for (const id of run) out.push({ kind: "item", id });
    run = [];
  };
  for (const id of ids) {
    if (groupable(items(id)!, requested)) run.push(id);
    else {
      flush();
      out.push({ kind: "item", id });
    }
  }
  flush();
  return out;
}

/** One line per turn for the hidden items (focus); a turn starts at a user message and ends at
 *  its turn-end line. */
export function turnRows(ids: readonly string[], items: ItemLookup): Slot[] {
  const out: Slot[] = [];
  let group: { kind: "group"; key: string; mode: "turn"; members: string[] } | null = null;
  for (const id of ids) {
    const item = items(id)!;
    if (item.kind === "user_message") group = null;
    if (!hiddenInFocus(item)) {
      out.push({ kind: "item", id });
      // A turn also ends at its turn-end line.
      if (item.kind === "marker" && item.markerKind === "turn_end") group = null;
      continue;
    }
    if (group === null) {
      group = { kind: "group", key: `${GROUP_PREFIX}turn:${id}`, mode: "turn", members: [] };
      out.push(group);
    }
    group.members.push(id);
  }
  return out;
}

/** The entries for the shown items of `order` under `options`. */
export function buildEntries(order: readonly string[], items: ItemLookup, options: EntryOptions): EntryList {
  const shown = order.filter((id) => {
    const item = items(id);
    return item !== undefined && isRenderable(item);
  });
  const slots: Slot[] =
    options.density === "compact" ? groupRuns(shown, items, permissionRequests(order, items)) : options.density === "focus" ? turnRows(shown, items) : shown.map((id) => ({ kind: "item", id }));
  const entries: Entry[] = [];
  const keys: string[] = [];
  const index = new Map<string, number>();
  const holder = new Map<string, number>();
  let previous: ItemGroup | null = null;
  const push = (entry: Entry, group: ItemGroup) => {
    index.set(entry.key, entries.length);
    keys.push(entry.key);
    entries.push(entry);
    previous = group;
  };
  const margin = (group: ItemGroup) => spacingBefore(previous, group);
  for (const slot of slots) {
    if (slot.kind === "item") {
      const group = groupOf(items(slot.id)!);
      holder.set(slot.id, entries.length);
      push({ kind: "item", key: slot.id, margin: margin(group), group: null }, group);
      continue;
    }
    const open = options.open(slot.key);
    const at = entries.length;
    push({ kind: "group", key: slot.key, mode: slot.mode, members: slot.members, open, margin: margin("activity") }, "activity");
    for (const id of slot.members) {
      if (!open) {
        holder.set(id, at);
        continue;
      }
      const group = groupOf(items(id)!);
      holder.set(id, entries.length);
      push({ kind: "item", key: id, margin: margin(group), group: slot.key }, group);
    }
  }
  return { entries, keys, index, holder };
}

/**
 * The entry key the jump actions move the cursor to (`previousPrompt`, `nextPrompt`,
 * `previousTool`, `nextTool`): the nearest entry from `from` (null: past the end) in `direction`
 * that is a user message (`prompt`) or a tool call (`tool`), or null when there is none. A tool
 * call hidden in a closed group is reached by its group line; an open group's line is passed
 * over, its members follow it.
 */
export function jumpTarget(list: EntryList, items: ItemLookup, from: string | null, direction: -1 | 1, what: "prompt" | "tool"): string | null {
  const at = from === null ? list.entries.length : (list.index.get(from) ?? list.entries.length);
  for (let i = at + direction; i >= 0 && i < list.entries.length; i += direction) {
    const entry = list.entries[i]!;
    if (entry.kind === "item") {
      if (items(entry.key)?.kind === (what === "prompt" ? "user_message" : "tool_call")) return entry.key;
    } else if (what === "tool" && !entry.open && entry.members.some((id) => items(id)?.kind === "tool_call")) {
      return entry.key;
    }
  }
  return null;
}

/** The prefix of group keys. */
export const GROUP_PREFIX = "group:";

/** The model item a group key was named after (its first member), or null for an item key. */
export function groupKeyItem(key: string): string | null {
  const match = /^group:(?:run|turn):(.*)$/s.exec(key);
  return match ? match[1]! : null;
}

/** The first model item an entry shows (a group's first member). */
export function firstItem(entry: Entry): string {
  return entry.kind === "item" ? entry.key : entry.members[0]!;
}

// ---------------------------------------------------------------- the group line

const NOUNS: Record<string, [string, string]> = {
  read: ["read", "reads"],
  search: ["search", "searches"],
  fetch: ["fetch", "fetches"],
  think: ["think", "thinks"],
  thought: ["thought", "thoughts"],
  tool: ["tool call", "tool calls"],
  permission: ["permission", "permissions"],
  plan: ["plan", "plans"],
};

function counted(n: number, noun: string): string {
  const [one, many] = NOUNS[noun] ?? [noun, `${noun}s`];
  return `${n} ${n === 1 ? one : many}`;
}

/** From the first tool call's start to the last one's end, when all have both. */
function span(tools: readonly ToolCallItem[]): number | null {
  let start = Infinity;
  let end = -Infinity;
  for (const tool of tools) {
    if (tool.startedAt === null || tool.endedAt === null) return null;
    start = Math.min(start, tool.startedAt);
    end = Math.max(end, tool.endedAt);
  }
  return tools.length > 0 ? end - start : null;
}

export interface GroupGlyphs {
  readonly closed: string;
  readonly open: string;
  readonly separator: string;
}

/** `▸` (design 6.2) and `▾`: in JetBrains Mono but not in Lilex, so Zed draws them by font
 *  fallback, as it does `✗` (tools/glyph-check.py --also ▸▾, 30 September 2026). */
export const GROUP_GLYPHS: GroupGlyphs = { closed: "▸", open: "▾", separator: " · " };

/**
 * A group's line without its gutter: the open or closed glyph, then counts and the duration.
 * A run: `▸ 5 reads · 2 searches · 1 thought · 3.1s` (kinds in first-seen order). A turn:
 * `▸ 12 tool calls · 1 failed · 3 thoughts · 1 plan · 2 permissions · 41.0s`.
 */
export function groupLine(entry: GroupEntry, items: ItemLookup, glyphs: GroupGlyphs = GROUP_GLYPHS): Segment[] {
  const members = entry.members.map((id) => items(id)).filter((item): item is Item => item !== undefined);
  const tools = members.filter((m): m is ToolCallItem => m.kind === "tool_call");
  const thoughts = members.filter((m): m is ThoughtItem => m.kind === "thought").length;
  const parts: Segment[] = [];
  const add = (text: string, token: Segment["token"] = "muted") => {
    if (parts.length > 0) parts.push({ text: glyphs.separator, token: "muted" });
    parts.push({ text, token });
  };
  if (entry.mode === "run") {
    const counts = new Map<string, number>();
    for (const m of members) {
      const noun = m.kind === "thought" ? "thought" : m.kind === "tool_call" ? (m.toolKind ?? "tool") : m.kind;
      counts.set(noun, (counts.get(noun) ?? 0) + 1);
    }
    for (const [noun, n] of counts) add(counted(n, noun));
  } else {
    if (tools.length > 0) add(counted(tools.length, "tool"));
    const failed = tools.filter((t) => t.toolStatus === "failed").length;
    if (failed > 0) add(`${failed} failed`, "tool.fail");
    const running = tools.filter((t) => t.status === "live" && (t.toolStatus === "pending" || t.toolStatus === "in_progress")).length;
    if (running > 0) add(`${running} running`, "tool.running");
    if (thoughts > 0) add(counted(thoughts, "thought"));
    const plans = members.filter((m) => m.kind === "plan").length;
    if (plans > 0) add(counted(plans, "plan"));
    const permissions = members.filter((m) => m.kind === "permission_record").length;
    if (permissions > 0) add(counted(permissions, "permission"));
  }
  const ms = span(tools);
  if (ms !== null && ms >= MIN_SHOWN_DURATION_MS) add(formatDuration(ms));
  return [{ text: `${entry.open ? glyphs.open : glyphs.closed} `, token: "muted" }, ...parts];
}
