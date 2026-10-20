// The session store behind session/load, session/resume and session/list
// (mvp-sessions task group 2): sessions with a directory, a title, an
// activity time and the history each replays, from an optional JSON fixture
// (`--sessions <file>`), from sessions created in this process by session/new,
// and from a scenario's built-in generated history (long-session). With
// `--persist` the whole store is written back to the fixture file, so a second
// fake-agent process can load what the first one created.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { RequestError, type SessionInfo, type SessionUpdate } from "@agentclientprotocol/sdk";

export type SendUpdate = (update: SessionUpdate) => Promise<void>;

/** A history a scenario generates on demand instead of storing (never persisted). */
export interface GeneratedHistory {
  /** How many prompt turns the history stands for (the scenario's prompt counter is set to it). */
  readonly turnCount: number;
  replay(send: SendUpdate): Promise<void>;
}

export interface StoredSession {
  readonly sessionId: string;
  readonly cwd: string;
  title?: string;
  updatedAt?: string;
  /** One array of replayed `session/update` payloads per prompt turn. */
  readonly turns: SessionUpdate[][];
  readonly generated?: GeneratedHistory;
}

// -- Fixture format -----------------------------------------------------------------------------

const TOOL_KINDS = ["read", "edit", "delete", "move", "search", "execute", "think", "fetch", "switch_mode", "other"];
const TOOL_STATUSES = ["pending", "in_progress", "completed", "failed"];

type FixtureObject = Record<string, unknown>;

function isObject(value: unknown): value is FixtureObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class FixtureError extends Error {
  constructor(path: string, where: string, problem: string) {
    super(`sessions fixture ${path}: ${where} ${problem}`);
  }
}

function optionalString(path: string, where: string, object: FixtureObject, key: string): string | undefined {
  const value = object[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new FixtureError(path, `${where}.${key}`, "must be a string");
  return value;
}

function requiredString(path: string, where: string, object: FixtureObject, key: string): string {
  const value = optionalString(path, where, object, key);
  if (value === undefined || value === "") throw new FixtureError(path, `${where}.${key}`, "must be a non-empty string");
  return value;
}

function textChunk(
  kind: "user_message_chunk" | "agent_message_chunk" | "agent_thought_chunk",
  text: string,
): SessionUpdate {
  return { sessionUpdate: kind, content: { type: "text", text } };
}

/**
 * The updates one fixture turn replays: the authored fields in the order
 * `user`, `thought`, `tools`, `agent`, then any raw `updates`. Authored
 * messages carry no `messageId` (the case acp-model must keep apart by kind
 * and by user messages); a raw update can carry one.
 */
function turnUpdates(path: string, where: string, sessionId: string, turnIndex: number, turn: unknown): SessionUpdate[] {
  if (!isObject(turn)) throw new FixtureError(path, where, "must be an object");
  const updates: SessionUpdate[] = [];
  const user = optionalString(path, where, turn, "user");
  if (user !== undefined) updates.push(textChunk("user_message_chunk", user));
  const thought = optionalString(path, where, turn, "thought");
  if (thought !== undefined) updates.push(textChunk("agent_thought_chunk", thought));

  const tools = turn["tools"];
  if (tools !== undefined) {
    if (!Array.isArray(tools)) throw new FixtureError(path, `${where}.tools`, "must be an array");
    tools.forEach((tool: unknown, toolIndex) => {
      const at = `${where}.tools[${toolIndex}]`;
      if (!isObject(tool)) throw new FixtureError(path, at, "must be an object");
      const title = requiredString(path, at, tool, "title");
      const kind = optionalString(path, at, tool, "kind") ?? "other";
      if (!TOOL_KINDS.includes(kind)) throw new FixtureError(path, `${at}.kind`, `must be one of ${TOOL_KINDS.join(", ")}`);
      const status = optionalString(path, at, tool, "status") ?? "completed";
      if (!TOOL_STATUSES.includes(status)) {
        throw new FixtureError(path, `${at}.status`, `must be one of ${TOOL_STATUSES.join(", ")}`);
      }
      const output = optionalString(path, at, tool, "output");
      const toolCallId = optionalString(path, at, tool, "id") ?? `${sessionId}-t${turnIndex + 1}-${toolIndex + 1}`;
      updates.push({ sessionUpdate: "tool_call", toolCallId, title, kind, status: "in_progress" } as SessionUpdate);
      updates.push({
        sessionUpdate: "tool_call_update",
        toolCallId,
        status,
        ...(output === undefined ? {} : { content: [{ type: "content", content: { type: "text", text: output } }] }),
      } as SessionUpdate);
    });
  }

  const agent = optionalString(path, where, turn, "agent");
  if (agent !== undefined) updates.push(textChunk("agent_message_chunk", agent));

  const raw = turn["updates"];
  if (raw !== undefined) {
    if (!Array.isArray(raw)) throw new FixtureError(path, `${where}.updates`, "must be an array");
    raw.forEach((update: unknown, updateIndex) => {
      if (!isObject(update) || typeof update["sessionUpdate"] !== "string") {
        throw new FixtureError(path, `${where}.updates[${updateIndex}]`, "must be an object with a sessionUpdate string");
      }
      updates.push(update as unknown as SessionUpdate);
    });
  }
  return updates;
}

/** Parses and validates a fixture's text; `path` only labels the error messages. */
export function parseSessionsFixture(path: string, text: string): StoredSession[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new FixtureError(path, "file", `is not valid JSON (${(error as Error).message})`);
  }
  if (!isObject(parsed) || !Array.isArray(parsed["sessions"])) {
    throw new FixtureError(path, "file", 'must be an object with a "sessions" array');
  }
  const seen = new Set<string>();
  return parsed["sessions"].map((entry: unknown, index): StoredSession => {
    const where = `sessions[${index}]`;
    if (!isObject(entry)) throw new FixtureError(path, where, "must be an object");
    const sessionId = requiredString(path, where, entry, "sessionId");
    if (seen.has(sessionId)) throw new FixtureError(path, `${where}.sessionId`, `'${sessionId}' appears twice`);
    seen.add(sessionId);
    const cwd = requiredString(path, where, entry, "cwd");
    const title = optionalString(path, where, entry, "title");
    const updatedAt = optionalString(path, where, entry, "updatedAt");
    if (updatedAt !== undefined && Number.isNaN(Date.parse(updatedAt))) {
      throw new FixtureError(path, `${where}.updatedAt`, "must be an ISO 8601 timestamp");
    }
    const turns = entry["turns"] ?? [];
    if (!Array.isArray(turns)) throw new FixtureError(path, `${where}.turns`, "must be an array");
    return {
      sessionId,
      cwd,
      ...(title === undefined ? {} : { title }),
      ...(updatedAt === undefined ? {} : { updatedAt }),
      turns: turns.map((turn: unknown, turnIndex) =>
        turnUpdates(path, `${where}.turns[${turnIndex}]`, sessionId, turnIndex, turn),
      ),
    };
  });
}

// -- The store ----------------------------------------------------------------------------------

const CURSOR_PREFIX = "offset:";

export interface SessionPage {
  readonly sessions: SessionInfo[];
  readonly nextCursor?: string;
}

export class SessionStore {
  private readonly sessions = new Map<string, StoredSession>();

  constructor(
    private readonly path: string | undefined,
    private readonly persist: boolean,
    initial: readonly StoredSession[] = [],
  ) {
    for (const session of initial) this.sessions.set(session.sessionId, session);
  }

  /**
   * Reads `path` (when given) and adds the scenario's generated sessions
   * (which a fixture session of the same ID overrides). A missing file is an
   * error unless `persist` is set, in which case the store starts empty and the
   * first save creates the file.
   */
  static open(path: string | undefined, persist: boolean, generated: readonly StoredSession[] = []): SessionStore {
    let fromFile: StoredSession[] = [];
    if (path !== undefined && (existsSync(path) || !persist)) {
      let text: string;
      try {
        text = readFileSync(path, "utf8");
      } catch (error) {
        throw new Error(`cannot read sessions fixture ${path}: ${(error as Error).message}`);
      }
      fromFile = parseSessionsFixture(path, text);
    }
    const fileIds = new Set(fromFile.map((session) => session.sessionId));
    return new SessionStore(path, persist, [...generated.filter((s) => !fileIds.has(s.sessionId)), ...fromFile]);
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  get(sessionId: string): StoredSession | undefined {
    return this.sessions.get(sessionId);
  }

  add(session: StoredSession): void {
    this.sessions.set(session.sessionId, session);
  }

  /**
   * `session/list`: sessions of `cwd` (all when absent), newest `updatedAt`
   * first (sessions without one last, in insertion order), `pageSize` at a time
   * (everything in one page when absent). The cursor is opaque to clients.
   */
  list(cwd: string | null | undefined, cursor: string | null | undefined, pageSize: number | undefined): SessionPage {
    let offset = 0;
    if (cursor !== undefined && cursor !== null) {
      const digits = cursor.startsWith(CURSOR_PREFIX) ? cursor.slice(CURSOR_PREFIX.length) : "";
      if (!/^\d+$/.test(digits)) throw RequestError.invalidParams({ cursor }, "unknown cursor");
      offset = Number(digits);
    }
    const time = (session: StoredSession): number =>
      session.updatedAt === undefined ? Number.NEGATIVE_INFINITY : Date.parse(session.updatedAt);
    const matching = [...this.sessions.values()]
      .filter((session) => cwd === undefined || cwd === null || session.cwd === cwd)
      .map((session, order) => ({ session, order }))
      .sort((a, b) => {
        const byTime = time(b.session) - time(a.session);
        return Number.isNaN(byTime) || byTime === 0 ? a.order - b.order : byTime;
      })
      .map((entry) => entry.session);
    const end = pageSize === undefined ? matching.length : offset + pageSize;
    const page = matching.slice(offset, end).map(
      (session): SessionInfo => ({
        sessionId: session.sessionId,
        cwd: session.cwd,
        ...(session.title === undefined ? {} : { title: session.title }),
        ...(session.updatedAt === undefined ? {} : { updatedAt: session.updatedAt }),
      }),
    );
    return end < matching.length ? { sessions: page, nextCursor: `${CURSOR_PREFIX}${end}` } : { sessions: page };
  }

  /**
   * With `--persist`, rewrites the fixture file (a temporary file renamed over
   * it) with every stored session, each turn in the raw `updates` form.
   * Generated sessions are not written. Without `--persist` it does nothing.
   */
  save(): void {
    if (!this.persist || this.path === undefined) return;
    const sessions = [...this.sessions.values()]
      .filter((session) => session.generated === undefined)
      .map((session) => ({
        sessionId: session.sessionId,
        cwd: session.cwd,
        ...(session.title === undefined ? {} : { title: session.title }),
        ...(session.updatedAt === undefined ? {} : { updatedAt: session.updatedAt }),
        turns: session.turns.map((updates) => ({ updates })),
      }));
    const temporary = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify({ sessions }, null, 2)}\n`, "utf8");
    renameSync(temporary, this.path);
  }
}
