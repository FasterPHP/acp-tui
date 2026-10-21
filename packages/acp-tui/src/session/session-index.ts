// acp-tui's own session index (mvp-sessions tasks 4.1 and 4.3, design
// decision 1, spec tui-sessions "Session index"): a JSON-lines file,
// `$XDG_STATE_HOME/acp-tui/sessions.jsonl` (`~/.local/state` when
// XDG_STATE_HOME is unset or not absolute, `%LOCALAPPDATA%` on Windows;
// platform/paths.ts), in a `0700` directory with mode
// `0600`. It gives `acp-tui --resume <id>` its agent and directory, gives
// agents without `session/list` a list, and holds a title for every session.
//
// Writing: one record per event (`recorded`, `title`, `activity`), appended
// with a single `write` of one line on a descriptor opened with O_APPEND, so
// two instances never interleave a record. A `recorded` record is complete; a
// `title` or `activity` record carries only what changed. Reading: the
// records are merged per (agent, session ID) in file order, so the result is
// the last state of each session; a torn or garbage line is skipped. When the
// file passes `compactAt` records (about 2000), it is rewritten with one
// `recorded` record for each of the `keep` (1000) most recently active
// sessions, into a temporary file that is renamed over it. A record another
// instance appends between that read and the rename is lost; a rewrite
// happens about once per thousand appends, so that is accepted rather than
// locking the file.
//
// Who records what is not decided here but in `recorder.ts` (task 4.2): a
// session is recorded when its first prompt is sent, or when it is opened
// by load or resume, never at `session/new`. Titles, agent names and
// directories are sanitised and held on one line when stored and again when
// read, since the file is not trusted. When the state directory cannot be
// written, the index says so once through `onWarning` (and `warning`), and
// every later write fails quietly: acp-tui carries on (task 4.3).
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync, constants } from "node:fs";
import { join } from "node:path";
import { sanitise } from "acp-model";
import { shortenHome } from "../layout/segments.ts";
import { renameOver, retryWhileBusy, type RenameOptions } from "../platform/replace-file.ts";
import { APP_DIR_NAME, pathsFor, stateDirectory, stateHome, userHome, type Platform } from "../platform/paths.ts";

/** The agent name recorded for a command given after `--` (also exported by agent/resolve.ts). */
export const AD_HOC_AGENT = "ad hoc";

/** One session as the index knows it. Times are ISO 8601 instants (UTC). */
export interface SessionRecord {
  readonly sessionId: string;
  /** The agent's name in the catalogue, or `ad hoc`. */
  readonly agent: string;
  /** The agent command, for an `ad hoc` session only (the resume line repeats it; it is never run
   *  from the index). */
  readonly command?: readonly string[];
  /** The session's directory, absolute. */
  readonly directory: string;
  readonly title: string | null;
  /** The directories added for this session (`--add-dir`, or during the session), absolute; absent
   *  for a session that has none, and for entries written before the field existed. The
   *  configuration's directories are not recorded. */
  readonly addedDirectories?: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A session in the index: its agent and ID. */
export interface SessionKey {
  readonly agent: string;
  readonly sessionId: string;
}

export interface RecordInput extends SessionKey {
  readonly command?: readonly string[];
  readonly directory: string;
  readonly title?: string | null;
  /** The directories added for the session, written with it. */
  readonly addedDirectories?: readonly string[];
  /** Creation and last-activity time, as epoch milliseconds; default now. */
  readonly at?: number;
}

export interface FindResult {
  /** The most recently active session with this ID, across agents; null if none. */
  readonly record: SessionRecord | null;
  /** How many agents have a session with this ID (more than one: name the agent in a notice). */
  readonly matches: number;
}

export interface SessionIndex {
  /** The index file. */
  readonly path: string;
  /** Records a session (on its first prompt, or when opened by load or resume). Recording a
   *  session again keeps its creation time and, when no title is given, its title. */
  record(input: RecordInput): void;
  /** Sets or clears a session's title. */
  updateTitle(key: SessionKey, title: string | null): void;
  /** Sets a session's last-activity time (epoch milliseconds; default now). */
  updateActivity(key: SessionKey, at?: number): void;
  find(sessionId: string): FindResult;
  /** Sessions of one agent in one directory, most recently active first. */
  list(filter: { readonly agent?: string; readonly directory?: string }): SessionRecord[];
  /** Every session, most recently active first. */
  listAll(): SessionRecord[];
  /** The unwritable-state message once a write has failed, else null. */
  readonly warning: string | null;
}

export interface SessionIndexOptions {
  /** The state home; default `$XDG_STATE_HOME`, else `~/.local/state` (`%LOCALAPPDATA%` on Windows). */
  readonly stateHome?: string;
  /** The environment the default state home comes from; default `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly now?: () => number;
  /** Called once, with a message for a notice, when the index cannot be written. */
  readonly onWarning?: (message: string) => void;
  /** Compaction threshold in records; default 2000. */
  readonly compactAt?: number;
  /** Sessions kept by compaction; default 1000. */
  readonly keep?: number;
  /** How compaction replaces the file (the rename, the wait between retries, the platform); default
   *  the real rename, retried briefly on Windows while another process holds the file. The wait and
   *  the platform also apply to opening the file to append. */
  readonly rename?: RenameOptions;
  /** Opens the index to append and returns the descriptor; default `fs.openSync`, retried briefly on
   *  Windows while another process holds the file without write sharing. */
  readonly openAppend?: (path: string) => number;
}

export const INDEX_FILE_NAME = "sessions.jsonl";
const FORMAT_VERSION = 1;
const DEFAULT_COMPACT_AT = 2000;
const DEFAULT_KEEP = 1000;

/** `$XDG_STATE_HOME`, or `~/.local/state` when it is unset or not absolute (`%LOCALAPPDATA%` on
 *  Windows). acp-tui's own directory is `acp-tui` below it. */
export function stateHomeDir(env: Readonly<Record<string, string | undefined>> = process.env, platform: Platform = process.platform): string {
  return stateHome(env, platform);
}

/** The index file the environment gives: `sessions.jsonl` in acp-tui's state directory. */
export function sessionIndexPath(env: Readonly<Record<string, string | undefined>> = process.env, platform: Platform = process.platform): string {
  return pathsFor(platform).join(stateDirectory(env, platform), INDEX_FILE_NAME);
}

/** Printable and on one line: approval-mode sanitising, then every run of whitespace one space. */
export function oneLine(text: string): string {
  return sanitise(text, "approval").replace(/\s+/g, " ").trim();
}

type Line =
  | { readonly v: number; readonly kind: "recorded"; readonly record: SessionRecord }
  | { readonly v: number; readonly kind: "title"; readonly agent: string; readonly sessionId: string; readonly title: string | null }
  | { readonly v: number; readonly kind: "activity"; readonly agent: string; readonly sessionId: string; readonly updatedAt: string };

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isInstant(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/** The record in a parsed line, validated and cleaned; null if it is not one. */
function readRecord(value: unknown): SessionRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const r = value as Record<string, unknown>;
  if (!isString(r["sessionId"]) || !isString(r["agent"]) || !isString(r["directory"])) return null;
  if (!isInstant(r["createdAt"]) || !isInstant(r["updatedAt"])) return null;
  if (r["title"] !== null && !isString(r["title"])) return null;
  const command = r["command"];
  if (command !== undefined && !(Array.isArray(command) && command.every(isString))) return null;
  // Optional, and ignored when it is not a list of strings (the file is not trusted).
  const added = r["addedDirectories"];
  const addedDirectories = Array.isArray(added) && added.every(isString) ? (added as string[]).map(oneLine).filter((d) => d !== "") : [];
  return {
    sessionId: oneLine(r["sessionId"]),
    agent: oneLine(r["agent"]),
    ...(command !== undefined ? { command: command as string[] } : {}),
    directory: oneLine(r["directory"]),
    title: r["title"] === null ? null : oneLine(r["title"]) || null,
    ...(addedDirectories.length > 0 ? { addedDirectories } : {}),
    createdAt: r["createdAt"],
    updatedAt: r["updatedAt"],
  };
}

function parseLine(text: string): Line | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const l = value as Record<string, unknown>;
  if (l["v"] !== FORMAT_VERSION) return null;
  if (l["kind"] === "recorded") {
    const record = readRecord(l["record"]);
    return record ? { v: FORMAT_VERSION, kind: "recorded", record } : null;
  }
  if (!isString(l["agent"]) || !isString(l["sessionId"])) return null;
  const key = { agent: oneLine(l["agent"]), sessionId: oneLine(l["sessionId"]) };
  if (l["kind"] === "title" && (l["title"] === null || isString(l["title"]))) {
    return { v: FORMAT_VERSION, kind: "title", ...key, title: l["title"] === null ? null : oneLine(l["title"]) || null };
  }
  if (l["kind"] === "activity" && isInstant(l["updatedAt"])) {
    return { v: FORMAT_VERSION, kind: "activity", ...key, updatedAt: l["updatedAt"] };
  }
  return null;
}

function keyOf(key: SessionKey): string {
  return JSON.stringify([key.agent, key.sessionId]);
}

/** Newest first by last activity; ties by ID, so the order is stable. */
function byRecency(a: SessionRecord, b: SessionRecord): number {
  return Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0);
}

/** Merges the file's lines into one record per (agent, session ID), in file order. */
function merge(lines: readonly Line[]): Map<string, SessionRecord> {
  const sessions = new Map<string, SessionRecord>();
  for (const line of lines) {
    if (line.kind === "recorded") {
      const k = keyOf(line.record);
      const previous = sessions.get(k);
      if (!previous) {
        sessions.set(k, line.record);
        continue;
      }
      // Recorded again (opened by load after an earlier run): the first creation time stays, and a
      // title is not lost to a record without one.
      sessions.set(k, {
        ...line.record,
        createdAt: Date.parse(previous.createdAt) < Date.parse(line.record.createdAt) ? previous.createdAt : line.record.createdAt,
        title: line.record.title ?? previous.title,
        updatedAt: Date.parse(previous.updatedAt) > Date.parse(line.record.updatedAt) ? previous.updatedAt : line.record.updatedAt,
      });
      continue;
    }
    const k = keyOf(line);
    const previous = sessions.get(k);
    // A change to a session the file does not (or no longer) record is ignored.
    if (!previous) continue;
    if (line.kind === "title") sessions.set(k, { ...previous, title: line.title });
    else sessions.set(k, { ...previous, updatedAt: line.updatedAt });
  }
  return sessions;
}

function errorCode(error: unknown): string {
  return (error as NodeJS.ErrnoException | undefined)?.code ?? (error instanceof Error ? error.message : String(error));
}

/** Opens the index (nothing is created until the first write). */
export function openSessionIndex(options: SessionIndexOptions = {}): SessionIndex {
  const dir = options.stateHome === undefined ? stateDirectory(options.env) : join(options.stateHome, APP_DIR_NAME);
  const path = join(dir, INDEX_FILE_NAME);
  const now = options.now ?? Date.now;
  const compactAt = options.compactAt ?? DEFAULT_COMPACT_AT;
  const keep = options.keep ?? DEFAULT_KEEP;
  let warning: string | null = null;
  // Lines in the file as far as this instance knows: counted on the first write, then kept up to
  // date by its own appends. Another instance's appends are seen at the next count (after a
  // compaction), which is enough for a threshold of "about 2000".
  let lineCount: number | null = null;
  let prepared = false;

  function warn(error: unknown): void {
    if (warning !== null) return;
    // Short enough for the prompt box's top border at about 60 columns with the default state
    // directory; a longer one is cut at its end.
    warning = `sessions not recorded (${errorCode(error)}): ${shortenHome(dir, userHome(options.env ?? process.env))}`;
    options.onWarning?.(warning);
  }

  /** Group and other bits off (owner only), never adding a permission the owner took away. */
  function ownerOnly(target: string): void {
    const mode = statSync(target).mode & 0o777;
    if (mode & 0o077) chmodSync(target, mode & 0o700);
  }

  /** The directory exists, created `0700` and kept owner-only; checked once per instance. */
  function prepare(): void {
    if (prepared) return;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    ownerOnly(dir);
    prepared = true;
  }

  function readLines(): Line[] {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      return [];
    }
    const lines: Line[] = [];
    for (const raw of text.split("\n")) {
      if (raw === "") continue;
      const line = parseLine(raw);
      if (line) lines.push(line);
    }
    return lines;
  }

  function countLines(): number {
    try {
      const text = readFileSync(path, "utf8");
      let n = 0;
      for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
      return n;
    } catch {
      return 0;
    }
  }

  function compact(): void {
    const kept = [...merge(readLines()).values()].sort(byRecency).slice(0, keep);
    const text = kept.map((record) => `${JSON.stringify({ v: FORMAT_VERSION, kind: "recorded", record })}\n`).join("");
    const tmp = join(dir, `.${INDEX_FILE_NAME}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
    const fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
      writeSync(fd, text);
    } finally {
      closeSync(fd);
    }
    try {
      renameOver(tmp, path, options.rename);
    } catch (error) {
      try {
        unlinkSync(tmp);
      } catch {
        // gone already
      }
      throw error;
    }
    lineCount = kept.length;
  }

  function append(line: Line): void {
    try {
      prepare();
      if (lineCount === null) lineCount = countLines();
      const open = options.openAppend ?? ((target: string) => openSync(target, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT, 0o600));
      const fd = retryWhileBusy(() => open(path), options.rename);
      try {
        ownerOnly(path);
        // One write of one line: O_APPEND puts each write at the end as a whole.
        writeSync(fd, `${JSON.stringify(line)}\n`);
      } finally {
        closeSync(fd);
      }
      lineCount += 1;
      if (lineCount > compactAt) compact();
    } catch (error) {
      warn(error);
    }
  }

  const iso = (ms: number): string => new Date(ms).toISOString();
  const sessions = (): SessionRecord[] => [...merge(readLines()).values()].sort(byRecency);

  return {
    path,
    get warning() {
      return warning;
    },

    record(input) {
      const at = iso(input.at ?? now());
      const title = input.title == null ? null : oneLine(input.title) || null;
      const record: SessionRecord = {
        sessionId: oneLine(input.sessionId),
        agent: oneLine(input.agent),
        ...(input.command ? { command: [...input.command] } : {}),
        directory: oneLine(input.directory),
        title,
        ...(input.addedDirectories && input.addedDirectories.length > 0 ? { addedDirectories: input.addedDirectories.map(oneLine).filter((d) => d !== "") } : {}),
        createdAt: at,
        updatedAt: at,
      };
      append({ v: FORMAT_VERSION, kind: "recorded", record });
    },

    updateTitle(key, title) {
      append({ v: FORMAT_VERSION, kind: "title", agent: oneLine(key.agent), sessionId: oneLine(key.sessionId), title: title === null ? null : oneLine(title) || null });
    },

    updateActivity(key, at) {
      append({ v: FORMAT_VERSION, kind: "activity", agent: oneLine(key.agent), sessionId: oneLine(key.sessionId), updatedAt: iso(at ?? now()) });
    },

    find(sessionId) {
      const matches = sessions().filter((r) => r.sessionId === sessionId);
      return { record: matches[0] ?? null, matches: matches.length };
    },

    list(filter) {
      return sessions().filter((r) => (filter.agent === undefined || r.agent === filter.agent) && (filter.directory === undefined || r.directory === filter.directory));
    },

    listAll: sessions,
  };
}
