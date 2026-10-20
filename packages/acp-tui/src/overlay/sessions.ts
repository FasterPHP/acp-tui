// The session list's rows (mvp-sessions task group 7, design decisions 5 and
// 6, spec tui-sessions "Session list" and "Agent selector"). Pure: the rows
// the overlay shows, from the current agent's `session/list` pages and
// acp-tui's own session index, and their text.
//
// - "New session with <agent>" rows head the list, one per named agent (the
//   built-in entry and every valid `agent_servers` entry), the current agent
//   first. When a harness is named on the command line (`acp-tui auggie -r`) the start-up list
//   holds that harness's row and sessions alone.
// - Session rows merge the current agent's `session/list` with the index by
//   (agent, session ID): the agent's title wins over the index's, the later
//   `updatedAt` wins. Other agents' sessions come from the index only, so
//   building the list launches nothing. Newest first.
// - A row reads: the title, then the agent, the last activity and the
//   directory (`~` for the home directory), in columns aligned across the
//   list (`detailColumns` in list.ts). When the list is narrow whole columns
//   are dropped for every row: right to left, but with all directories shown
//   the time before the directory (`detailDropOrder`); the title is never
//   dropped.
// - Times are ISO strings parsed as instants and shown in the local time
//   zone: relative under a day ("2 minutes ago"), else a local date
//   ("3 Oct", or "3 Oct 2025" in another year).
//
// Every agent-supplied string (titles, directories, IDs) is sanitised and
// held on one line (`oneLine`) before it reaches a row.
import type { SessionInfo } from "@agentclientprotocol/sdk";
import { commandDisplayName } from "../agent/harness-name.ts";
import type { Platform } from "../platform/paths.ts";
import { shortenHome, truncateMiddle } from "../layout/segments.ts";
import { AD_HOC_AGENT, oneLine, type SessionRecord } from "../session/session-index.ts";
import type { ListItem } from "./list.ts";

/** The agent in use: its name, or `ad hoc` with its command. */
export interface CurrentAgent {
  readonly name: string;
  /** The command, for an `ad hoc` agent only. */
  readonly command: readonly string[] | null;
}

/** A "New session with <agent>" row (the agent selector, design decision 6). */
export interface NewSessionEntry {
  readonly kind: "new";
  readonly agent: string;
  /** The agent in use. */
  readonly current: boolean;
}

/** A session of the list. */
export interface SessionEntry {
  readonly kind: "session";
  readonly sessionId: string;
  /** The agent's name in the catalogue, or `ad hoc`. */
  readonly agent: string;
  /** For an `ad hoc` session, the command the index records (never run from the list). */
  readonly command: readonly string[] | null;
  readonly directory: string;
  readonly title: string | null;
  readonly updatedAt: string | null;
  /** The session belongs to the agent in use (its own list, or the index with the same agent). */
  readonly current: boolean;
}

export type SessionListEntry = NewSessionEntry | SessionEntry;

/** The directory of the session in use, or every directory (`toggleScope`, Tab). */
export type SessionScope = "directory" | "all";

/** A directory is cut in the middle to this many columns in a row. */
export const DIRECTORY_COLUMNS = 28;

/** An ISO time as milliseconds; -Infinity when absent or unreadable, so it sorts last. */
export function instant(value: string | null | undefined): number {
  const ms = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isNaN(ms) ? -Infinity : ms;
}

/** Whether an index record belongs to the agent in use: the same name, and for an `ad hoc`
 *  agent the same command. */
export function isCurrentAgent(record: Pick<SessionRecord, "agent" | "command">, current: CurrentAgent): boolean {
  if (record.agent !== current.name) return false;
  if (record.agent !== AD_HOC_AGENT) return true;
  return JSON.stringify(record.command ?? []) === JSON.stringify(current.command ?? []);
}

/**
 * The session rows: `listed` (the current agent's `session/list` pages, so far) merged with the
 * index's `records` by (agent, session ID), newest first. With `directory`, only that directory's
 * sessions (an agent that ignores the `cwd` filter hands over no other directory's). With `only`
 * (a harness named on the command line), only that harness's sessions: the index's records of other
 * harnesses are left out (`listed` is the current harness's, which is `only` when it is given).
 */
export function mergeSessions(
  listed: readonly SessionInfo[],
  records: readonly SessionRecord[],
  current: CurrentAgent,
  directory: string | null = null,
  only: string | null = null,
): SessionEntry[] {
  const rows = new Map<string, SessionEntry>();
  const key = (agent: string, command: readonly string[] | null, sessionId: string) =>
    JSON.stringify([agent, agent === AD_HOC_AGENT ? (command ?? []) : null, sessionId]);
  for (const info of listed) {
    if (typeof info.sessionId !== "string" || typeof info.cwd !== "string") continue;
    const cwd = oneLine(info.cwd);
    if (directory !== null && cwd !== directory) continue;
    const sessionId = oneLine(info.sessionId);
    if (sessionId === "") continue;
    const k = key(current.name, current.command, sessionId);
    if (rows.has(k)) continue;
    rows.set(k, {
      kind: "session",
      sessionId,
      agent: current.name,
      command: current.command,
      directory: cwd,
      title: typeof info.title === "string" ? oneLine(info.title) || null : null,
      updatedAt: typeof info.updatedAt === "string" ? info.updatedAt : null,
      current: true,
    });
  }
  for (const record of records) {
    if (directory !== null && record.directory !== directory) continue;
    if (only !== null && record.agent !== only) continue;
    const mine = isCurrentAgent(record, current);
    const k = key(record.agent, record.command ?? null, record.sessionId);
    const listedRow = rows.get(k);
    if (listedRow) {
      // The index's title wins (it records the titles the agent reports live, and a harness may
      // list another, such as an injected prompt); the harness's title only fills in when the index
      // has none. The later activity wins.
      rows.set(k, {
        ...listedRow,
        title: record.title ?? listedRow.title,
        updatedAt: instant(record.updatedAt) > instant(listedRow.updatedAt) ? record.updatedAt : listedRow.updatedAt,
      });
      continue;
    }
    rows.set(k, {
      kind: "session",
      sessionId: record.sessionId,
      agent: record.agent,
      command: record.command ?? null,
      directory: record.directory,
      title: record.title,
      updatedAt: record.updatedAt,
      current: mine,
    });
  }
  // Newest first; a stable order for equal times.
  return [...rows.values()]
    .map((row, at) => ({ row, at }))
    .sort((a, b) => {
      const ta = instant(a.row.updatedAt);
      const tb = instant(b.row.updatedAt);
      if (ta !== tb) return ta === -Infinity ? 1 : tb === -Infinity ? -1 : tb - ta;
      return a.at - b.at;
    })
    .map(({ row }) => row);
}

/** The "New session with <agent>" rows: one per named agent, the current agent first. */
export function newSessionEntries(agents: readonly string[], current: CurrentAgent): NewSessionEntry[] {
  const names = [...new Set(agents)];
  const ordered = names.includes(current.name) ? [current.name, ...names.filter((n) => n !== current.name)] : names;
  return ordered.map((agent) => ({ kind: "new", agent, current: agent === current.name }));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;

/**
 * When a session was last active, for its row: relative under a day (`just now` under a minute,
 * then minutes and hours), else the date in the local time zone (`3 Oct`, with the year when it
 * is not `now`'s). `iso` is parsed as an instant, so a UTC time and a local clock in summer time
 * agree. Empty when the time is absent or unreadable.
 */
export function activityTime(iso: string | null, now: number): string {
  const at = instant(iso);
  if (at === -Infinity) return "";
  const ago = now - at;
  if (ago < 60_000) return "just now";
  if (ago < 3_600_000) return plural(Math.floor(ago / 60_000), "minute");
  if (ago < 86_400_000) return plural(Math.floor(ago / 3_600_000), "hour");
  const date = new Date(at);
  const day = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === new Date(now).getFullYear() ? day : `${day} ${date.getFullYear()}`;
}

/** An agent as a row names it: its name, or `ad hoc`. */
export function agentName(agent: string): string {
  return oneLine(agent);
}

/** The detail columns of a session row, by index into its `details`. */
export const DETAIL_AGENT = 0;
export const DETAIL_TIME = 1;
export const DETAIL_DIRECTORY = 2;

/** The least width of the time column: "59 minutes ago", the widest relative time, so a row that
 *  arrives later with a longer time does not move the directory column (day-two-feedback 12.5). */
export const TIME_COLUMN_MIN = 14;

/** The least width of each detail column, by index (`OverlayView.detailMin`). */
export const DETAIL_MIN_WIDTHS: readonly number[] = [0, TIME_COLUMN_MIN, 0];

/** The order the detail columns are dropped in when the list is narrow: right to left, but with
 *  all directories shown the time goes before the directory, which tells the sessions apart. */
export function detailDropOrder(scope: SessionScope): readonly number[] {
  return scope === "all" ? [DETAIL_TIME, DETAIL_DIRECTORY, DETAIL_AGENT] : [DETAIL_DIRECTORY, DETAIL_TIME, DETAIL_AGENT];
}

/** The list item of an entry: the title, then the agent, the activity time and the directory
 *  as details, one per column (empty when unknown, so the columns stay in place). */
export function sessionListItem(entry: SessionListEntry, context: { readonly now: number; readonly home: string | null }): ListItem {
  if (entry.kind === "new") {
    const agent = agentName(entry.agent);
    return { id: `new:${entry.agent}`, group: null, title: `New session with ${agent}`, search: agent };
  }
  const agent = agentName(entry.agent);
  const directory = shortenHome(entry.directory, context.home);
  return {
    id: `session:${JSON.stringify([entry.agent, entry.command, entry.sessionId])}`,
    group: null,
    title: entry.title ?? entry.sessionId,
    details: [agent, activityTime(entry.updatedAt, context.now), truncateMiddle(directory, DIRECTORY_COLUMNS)],
    // The filter matches the title, the agent or the directory (spec tui-sessions "Filter").
    search: [agent, entry.directory, directory].join(" "),
  };
}

/** The harness as the list names it in its footer: its name, or for an `ad hoc` command its first
 *  word without the directory (the splash's rule). */
export function harnessName(current: CurrentAgent, platform: Platform = process.platform): string {
  if (current.name !== AD_HOC_AGENT) return oneLine(current.name);
  const first = current.command?.[0] ?? current.name;
  return oneLine(commandDisplayName(first, platform));
}

/** What the list's footer row waits for (day-two-feedback D2): the harness starting, its first page
 *  of sessions being read, or a choice made before the harness is up waiting for it. `glyph` is the
 *  spinner's current frame. */
export type ListWait = "starting" | "reading" | "waiting";

export function waitText(wait: ListWait, harness: string, glyph: string): string {
  const text = wait === "starting" ? `starting ${harness}…` : wait === "reading" ? `reading ${harness}'s sessions…` : `waiting for ${harness} to start…`;
  return `${glyph} ${text}`;
}

/** The list's first row after its entries when it has no session to show: `no sessions yet in
 *  <directory>` (`~` for home), or `no matches` while the filter is typed. */
export function noSessionsLine(scope: SessionScope, directory: string, home: string | null, filtering: boolean): string {
  if (filtering) return "no matches";
  return scope === "all" ? "no sessions yet" : `no sessions yet in ${oneLine(shortenHome(directory, home))}`;
}

/** The index of the entry `held` names in `ids`, 0 (the first row) when the user has not moved
 *  (`held` null) or the entry is gone. */
export function indexOfKey(held: string | null, ids: readonly string[]): number {
  if (held === null) return 0;
  const at = ids.indexOf(held);
  return at < 0 ? 0 : at;
}

/** The selection after the entries changed (rows added, or reordered by a title or time the
 *  harness knows better): `held` is the key of the entry the user moved to, or null while they have
 *  not moved (the first row, the current harness's "New session with" row, which never moves). The
 *  selected entry stays selected, and the first row shown moves with it so that it keeps its screen
 *  row where it can; an entry that is gone leaves the first row selected. `previous` is the index
 *  and first row shown before the change. */
export function keepSelection(held: string | null, ids: readonly string[], previous: { readonly index: number; readonly offset: number }): { readonly index: number; readonly offset: number } {
  if (held === null) return { index: 0, offset: previous.offset };
  const at = ids.indexOf(held);
  if (at < 0) return { index: 0, offset: 0 };
  return { index: at, offset: Math.max(0, previous.offset + at - previous.index) };
}
