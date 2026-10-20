// Starting the session a launch asks for (mvp-sessions task groups 5 and 12,
// design decisions 2 to 4 and 13, spec tui-sessions): launch and initialise
// the agent, then
//
// - a new session: `session/new` in the session directory;
// - `--resume <id>`: reopen it, in the directory the index records, else the
//   `cwd` the agent's `session/list` reports for it (read without a `cwd`
//   filter, only when the index lacks the session and the agent advertises
//   `list`, at most `LIST_PAGE_LIMIT` pages), else (an agent that cannot
//   list) the launch directory;
// - `--continue`: reopen the most recently active session tied to the
//   session directory, across agents: the index's entries for it (any
//   configured agent; an ad hoc one only with the same command after `--`)
//   and the default agent's `session/list { cwd }`, opened with the agent it
//   belongs to; `-a` or `--` narrows it to that agent.
//
// `prepareLaunch` does the finding for `--resume <id>` and `--continue` (`--continue` survives a
// default agent that cannot be started or listed: the index decides, `prepareContinue`)
// before the full-screen app starts (design decision 13): an ID found nowhere,
// a directory without sessions and an agent that cannot reopen sessions are
// a `SessionOpenFailure` then, so nothing is drawn. The agent process it
// launched is kept, and `startOn` opens the session on it once the app is up,
// so the replay is drawn as it arrives.
//
// Reopening is `session/load` or `session/resume` by the agent's capabilities
// (the controller). A failure to reopen is a `SessionOpenFailure` naming the
// session, the agent and the reason with the agent's own message and code,
// sanitised; it never mentions installing anything (design decision 3); from
// the command line it ends with `RESUME_HINT`. A session opened in another
// directory than the launch directory gains a marker after its history
// (`directoryMarker`, design decision 2). The recorder writes the session to
// the index: at once when it was reopened, on its first prompt when it is new
// (task 4.2).
//
// The steps are separate for the session list (task group 7):
// `connectLaunch` launches and initialises the agent (`--resume` without an
// ID then lists its sessions), and `startOn` starts a session on an
// initialised agent, either a new one or the `target` that `prepareLaunch`
// or the list chose; `startLaunch` is all of them, killing the agent when the
// start fails. The list itself is a new session here (the headless mode has
// no list).
import { existsSync, statSync } from "node:fs";
import { sanitise, type SessionOpenMode } from "acp-model";
import type { SessionInfo } from "@agentclientprotocol/sdk";
import { findAgent, loadAgentCatalogue, type AgentCatalogue } from "../agent/catalogue.ts";
import type { ElicitationHandler } from "../agent/client-handler.ts";
import { AD_HOC_AGENT, launchArgv, type LaunchDescription } from "../agent/resolve.ts";
import { shortenHome } from "../layout/segments.ts";
import type { DebugLogger } from "../log.ts";
import { CannotReopenError, connectAgent, type ConnectedController, type SessionController } from "./controller.ts";
import { createSessionRecorder, type SessionRecorder } from "./recorder.ts";
import { oneLine, type SessionIndex } from "./session-index.ts";
import type { Pace } from "../renderer/frame-pace.ts";

/** The end of a command-line failure to find or open a session (Marcus, 5 October 2026, IDE
 *  check 10.4, decision D: a mistyped ID is the most probable cause). */
export const RESUME_HINT = "to choose a session by title and time: acp-tui --resume";

/** The marker for a session opened in another directory than the launch directory, after its
 *  history (design decision 2; Marcus, 5 October 2026, IDE check 10.4, decision B): both
 *  directories, with the home directory as `~`. */
export function directoryMarker(directory: string, launchDirectory: string, home: string | null): string {
  return `opened in ${shortenHome(directory, home)} (launched from ${shortenHome(launchDirectory, home)})`;
}

/** `--resume <id>` for an ID that no source knows. */
export function sessionNotFoundMessage(sessionId: string): string {
  return `no session ${oneLine(sessionId)} found; ${RESUME_HINT}`;
}

/** `--continue` in a directory without sessions. */
export function noSessionForDirectoryMessage(directory: string, home: string | null): string {
  return `no session found for ${shortenHome(directory, home)}; to choose a session: acp-tui --resume`;
}

/** At most this many pages of `session/list` are read to find one session (design decision 2). */
export const LIST_PAGE_LIMIT = 20;

/** The ACP error code for an unknown resource, which `claude-agent-acp` answers for a session it
 *  never saved (report S7). */
export const RESOURCE_NOT_FOUND = -32002;

/** A failure to reopen a session, as the start-up error message says it (design decision 3). */
export class SessionOpenFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionOpenFailure";
  }
}

export interface StartLaunchOptions {
  readonly launch: LaunchDescription;
  readonly logger?: DebugLogger;
  readonly index: SessionIndex;
  /** Shows a notice (the prompt box's top border in the app). */
  notify?(text: string): void;
  /** Called as soon as the agent is initialised, before any session request, so the caller can
   *  detach it on exit; `recorder` records the session in the index. */
  onConnected?(controller: ConnectedController, recorder: SessionRecorder): void;
  /** Called to attach the store: before `session/load` or `session/resume` (`open`, so the replay
   *  is drawn as it arrives), or after `session/new` (`new`). */
  attach?(controller: ConnectedController, how: "new" | "open"): void;
  /** True once the user has exited; the start stops (the caller has detached). */
  cancelled?(): boolean;
  readonly elicitation?: ElicitationHandler;
  /** Paces a load's replay around the renderer's frames (renderer/frame-pace.ts). */
  readonly pace?: Pace;
  /** Called each time a harness has answered `initialize` (a start, a switch to another harness). */
  readonly onHarnessInitialized?: () => void;
  readonly now?: () => number;
  /** Home directory, shown as `~` in the directory marker; default `process.env.HOME`. */
  readonly home?: string | null;
  /** The session to reopen, its directory and title already known (`prepareLaunch`, or a row of
   *  the session list); without one, `startOn` starts a new session. */
  readonly target?: SessionTarget | null;
  /** Added to an agent's error while reopening (`RESUME_HINT` from the command line); default
   *  none (the session list). */
  readonly openHint?: string;
  /** Reads the agent catalogue (`--continue` across agents); default `loadAgentCatalogue()`. */
  readonly catalogue?: () => AgentCatalogue;
}

export interface StartedSession {
  readonly controller: ConnectedController;
  readonly recorder: SessionRecorder;
  /** `new`, or how the session was reopened. */
  readonly mode: "new" | SessionOpenMode;
}

/** A session to reopen and where. */
export interface SessionTarget {
  readonly sessionId: string;
  readonly directory: string;
  /** A title known before opening (the agent's list, else the index). */
  readonly title: string | null;
  /** A marker for the conversation, after the history and before the directory marker (`--continue`
   *  when the default agent could not be asked for its sessions, task 12.11). */
  readonly note?: string;
}

/** What `prepareLaunch` found: the launch to use (for `--continue`, possibly another agent's),
 *  its initialised agent, and the session to reopen (null: a new session, or the list). */
export interface PreparedLaunch {
  readonly launch: LaunchDescription;
  readonly controller: ConnectedController;
  readonly target: SessionTarget | null;
}

/** The harness as a message names it: `harness 'fake'`, or `ad hoc harness 'bun main.ts'`. */
export function agentLabel(launch: Pick<LaunchDescription, "agentName" | "command" | "args">): string {
  if (launch.agentName === AD_HOC_AGENT) return `ad hoc harness '${oneLine(launchArgv(launch).join(" "))}'`;
  return `harness '${oneLine(launch.agentName)}'`;
}

/** An error's numeric JSON-RPC code (the SDK's `RequestError`), else null. */
function errorCode(error: unknown): number | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "number" ? code : null;
}

/** The start-up failure for `error` while reopening `sessionId` (design decision 3); `openHint`
 *  (`RESUME_HINT` from the command line) ends an agent's error. */
export function openFailure(error: unknown, sessionId: string, launch: Pick<LaunchDescription, "agentName" | "command" | "args">, openHint?: string): SessionOpenFailure {
  const session = `session ${oneLine(sessionId)}`;
  const agent = agentLabel(launch);
  if (error instanceof CannotReopenError) {
    // No hint: another session of the same agent could not be opened either.
    return new SessionOpenFailure(`cannot open ${session}: ${agent} cannot reopen sessions (no session/load or session/resume)`);
  }
  const tail = openHint ? `; ${openHint}` : "";
  const code = errorCode(error);
  const raw = error instanceof Error ? error.message : String(error);
  // The harness's message reaches the terminal: sanitised, one line.
  const message = oneLine(raw) || "no message";
  if (code === null) return new SessionOpenFailure(`cannot open ${session} with ${agent}: ${sanitise(raw, "approval").trimEnd()}${tail}`);
  return new SessionOpenFailure(`cannot open ${session} with ${agent}: the harness answered ${message} (${code})${tail}`);
}

function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Reads `session/list` pages until `each` returns true or the pages run out (at most
 *  `LIST_PAGE_LIMIT`); every session seen is passed to `each`. An error ends the search, and
 *  resolves false (logged); otherwise true. */
async function scanList(
  controller: SessionController,
  cwd: string | undefined,
  logger: DebugLogger | undefined,
  each: (info: SessionInfo) => boolean,
  onError?: (error: unknown) => void,
): Promise<boolean> {
  let cursor: string | undefined;
  for (let page = 0; page < LIST_PAGE_LIMIT; page++) {
    let response;
    try {
      response = await controller.listSessions({ ...(cwd !== undefined ? { cwd } : {}), ...(cursor !== undefined ? { cursor } : {}) });
    } catch (error) {
      logger?.log({ event: "session_list_error", code: errorCode(error) });
      onError?.(error);
      return false;
    }
    for (const info of response.sessions) if (each(info)) return true;
    if (response.nextCursor == null) return true;
    cursor = response.nextCursor;
  }
  return true;
}

/** An ISO time as milliseconds; -Infinity when absent or unreadable, so it sorts last. */
function instant(value: string | null | undefined): number {
  const ms = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isNaN(ms) ? -Infinity : ms;
}

function homeOf(options: Pick<StartLaunchOptions, "home">): string | null {
  return options.home === undefined ? (process.env["HOME"] ?? null) : options.home;
}

/** Launches and initialises the agent `launch` names, in the session directory (or the launch
 *  directory when that has gone), with no session yet. Throws the agent's start-up errors. */
export function connectLaunch(options: Pick<StartLaunchOptions, "launch" | "logger" | "elicitation" | "now" | "pace" | "onHarnessInitialized">): Promise<ConnectedController> {
  const { launch, logger } = options;
  // The agent runs in the session directory; one the index recorded may have gone since.
  const processCwd = isDirectory(launch.directory) ? launch.directory : launch.launchDirectory;
  return connectAgent({
    command: launchArgv(launch),
    env: launch.env,
    harness: launch.agentName,
    cwd: processCwd,
    ...(logger ? { logger } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.elicitation ? { elicitation: options.elicitation } : {}),
    ...(options.pace ? { pace: options.pace } : {}),
    ...(options.onHarnessInitialized ? { onInitialized: options.onHarnessInitialized } : {}),
  });
}

/** Refuses, before anything is sent, an agent that can neither load nor resume sessions. */
function requireReopen(controller: SessionController, sessionId: string, launch: LaunchDescription): void {
  if (!controller.support.load && !controller.support.resume) throw openFailure(new CannotReopenError(sessionId), sessionId, launch);
}

/** `--resume <id>`: the session's directory and a known title (design decision 2), or a
 *  `SessionOpenFailure` when no source knows it. */
async function resumeTarget(controller: SessionController, launch: LaunchDescription, sessionId: string, logger?: DebugLogger): Promise<SessionTarget> {
  if (launch.indexed) return { sessionId, directory: launch.indexed.directory, title: launch.indexed.title };
  // An agent that cannot list cannot confirm the ID: the load decides, in the launch directory
  // (design decision 13).
  if (!controller.support.list) return { sessionId, directory: launch.directory, title: null };
  let listed: SessionInfo | null = null;
  const read = await scanList(controller, undefined, logger, (info) => {
    if (info.sessionId !== sessionId) return false;
    listed = info;
    return true;
  });
  const info = listed as SessionInfo | null;
  // A list that failed has not ruled the ID out: the load decides, as for an agent that cannot list.
  if (info === null && !read) return { sessionId, directory: launch.directory, title: null };
  if (info === null) throw new SessionOpenFailure(sessionNotFoundMessage(sessionId));
  const directory = typeof info.cwd === "string" && info.cwd !== "" ? info.cwd : launch.directory;
  return { sessionId, directory, title: typeof info.title === "string" ? oneLine(info.title) || null : null };
}

/** A `--continue` candidate: a session and the agent it belongs to (its catalogue name, or the
 *  launch's own agent). */
interface Candidate extends SessionTarget {
  readonly agent: string;
  readonly at: number;
}

/**
 * `--continue` (design decision 4): the most recently active session tied to the session
 * directory. Without `-a` or `--` (`agentSource` `default`), across agents: the index's entries
 * for the directory of every configured named agent, and the launched default agent's
 * `session/list { cwd }`; otherwise only the launch's agent (an ad hoc one by its command).
 */
async function latestCandidate(
  controller: SessionController | null,
  index: SessionIndex,
  launch: LaunchDescription,
  catalogue: () => AgentCatalogue,
  logger?: DebugLogger,
  onListError?: (error: unknown) => void,
): Promise<Candidate | null> {
  const directory = launch.directory;
  const argv = launchArgv(launch);
  let best: Candidate | null = null;
  const consider = (candidate: Candidate): void => {
    if (best === null || candidate.at > best.at) best = candidate;
  };
  // No controller: the default agent could not be started, so its list is skipped.
  if (controller?.support.list) {
    await scanList(controller, directory, logger, (info) => {
      // An agent that ignores the filter must not hand over another directory's session.
      if (info.cwd === directory) {
        consider({ sessionId: info.sessionId, agent: launch.agentName, directory, title: typeof info.title === "string" ? oneLine(info.title) || null : null, at: instant(info.updatedAt) });
      }
      return false;
    }, onListError);
  }
  const acrossAgents = launch.agentSource === "default";
  const agents = acrossAgents ? catalogue().agents : null;
  for (const record of index.list(acrossAgents ? { directory } : { agent: launch.agentName, directory })) {
    if (record.agent === AD_HOC_AGENT) {
      // An ad hoc session counts only when the same command was given after `--`.
      if (launch.agentName !== AD_HOC_AGENT || JSON.stringify(record.command ?? []) !== JSON.stringify(argv)) continue;
    } else if (agents !== null && !agents.has(record.agent)) {
      // A session of an agent no longer configured could not be opened.
      continue;
    }
    consider({ sessionId: record.sessionId, agent: record.agent, directory, title: record.title, at: instant(record.updatedAt) });
  }
  return best;
}

/**
 * Finds the session `--resume <id>` or `--continue` asks for, before the full-screen app starts
 * (design decision 13): launches and initialises the agent, refuses one that cannot reopen
 * sessions, and finds the session (and, for `--continue`, the agent it belongs to, launching
 * that agent instead when it is another one). Resolves with the launch, its initialised agent
 * and the target; for a new session or the list, with no target. Throws the agent's start-up
 * errors and `SessionOpenFailure` (the session found nowhere, an agent that cannot reopen), the
 * agent killed.
 */
export async function prepareLaunch(options: StartLaunchOptions): Promise<PreparedLaunch> {
  const { launch, logger } = options;
  if (launch.session.kind === "continue") return prepareContinue(options);
  const controller = await connectLaunch(options);
  try {
    const session = launch.session;
    if (session.kind === "resume") {
      requireReopen(controller, session.id, launch);
      const target = await resumeTarget(controller, launch, session.id, logger);
      return { launch, controller, target };
    }
    return { launch, controller, target: null };
  } catch (error) {
    controller.kill();
    throw error;
  }
}

/** Why asking the default agent for its sessions failed, as one short line (task 12.11). */
function reasonOf(error: unknown): string {
  const text = oneLine(error instanceof Error ? error.message : String(error)) || "no message";
  return text.length > 160 ? `${text.slice(0, 159)}…` : text;
}

/**
 * `--continue` (design decision 4), the part of `prepareLaunch` that finds the latest session. The
 * default agent (no `-a`, no `--`) is launched only to read its `session/list { cwd }`: when it
 * cannot be started, or its list fails, that lookup is skipped and acp-tui's index decides. A
 * session the index supplies is opened with its own agent and gains a marker saying so
 * (`target.note`); with none, the error is preceded on its own line by why the agent could not be
 * asked. An agent named with `-a` or `--` is the one asked for: its start-up failure is the error.
 */
async function prepareContinue(options: StartLaunchOptions): Promise<PreparedLaunch> {
  const { launch, logger, index } = options;
  const lenient = launch.agentSource === "default";
  let controller: ConnectedController | null = null;
  // Why the default agent could not be asked, once known (an object: the callbacks assign it).
  const asked: { skipped: string | null } = { skipped: null };
  try {
    controller = await connectLaunch(options);
  } catch (error) {
    if (!lenient) throw error;
    asked.skipped = reasonOf(error);
    logger?.log({ event: "continue_list_skipped", reason: "start" });
  }
  try {
    const catalogue = options.catalogue ?? (() => loadAgentCatalogue());
    const best = await latestCandidate(controller, index, launch, catalogue, logger, (error) => {
      if (lenient) asked.skipped = reasonOf(error);
    });
    if (best === null) {
      const none = noSessionForDirectoryMessage(launch.directory, homeOf(options));
      // Why the lookup was skipped, on a line of its own above the error.
      throw new SessionOpenFailure(asked.skipped === null ? none : `could not ask ${oneLine(launch.agentName)} for its sessions (${asked.skipped})\nacp-tui: ${none}`);
    }
    const target: SessionTarget = {
      sessionId: best.sessionId,
      directory: best.directory,
      title: best.title,
      ...(asked.skipped !== null ? { note: `could not ask ${oneLine(launch.agentName)} for its sessions; continued from acp-tui's record` } : {}),
    };
    if (best.agent === launch.agentName) {
      // The agent that was launched (or, when it could not be, launched again: its start-up error).
      const using = controller ?? (controller = await connectLaunch(options));
      requireReopen(using, target.sessionId, launch);
      return { launch, controller: using, target };
    }
    // Another agent's session (from the index): that agent is launched, and the one launched to
    // list is closed as on exit (it has no session).
    const entry = findAgent(catalogue(), best.agent);
    const other: LaunchDescription = {
      ...launch,
      agentName: entry.name,
      agentSource: "index",
      command: entry.command,
      args: entry.args,
      env: entry.env,
      directory: target.directory,
      directorySource: "index",
    };
    if (controller !== null) {
      await controller.detach();
      controller = null;
    }
    const next = await connectLaunch({ ...options, launch: other });
    try {
      requireReopen(next, target.sessionId, other);
    } catch (error) {
      next.kill();
      throw error;
    }
    return { launch: other, controller: next, target };
  } catch (error) {
    controller?.kill();
    throw error;
  }
}

/**
 * Starts what `options.launch` asks for: `prepareLaunch`, then `startOn`. Resolves with the
 * controller and its recorder, or null when the user exited during start-up (the controller is
 * detached). Throws the agent's start-up errors, and `SessionOpenFailure` when a session cannot
 * be found or reopened (the agent is killed).
 */
export async function startLaunch(options: StartLaunchOptions): Promise<StartedSession | null> {
  const prepared = await prepareLaunch(options);
  try {
    return await startOn(prepared.controller, { ...options, launch: prepared.launch, target: prepared.target });
  } catch (error) {
    prepared.controller.kill();
    throw error;
  }
}

/**
 * Starts a session on an initialised agent (`connectLaunch` or `prepareLaunch`, or a controller
 * `reuse` gave): the session `options.target` names (found by `prepareLaunch`, or a row of the
 * session list, mvp-sessions task group 7), else a new session in the session directory.
 * Resolves as `startLaunch` does; throws as it does but never kills the agent, so a caller that
 * keeps the process (the session list) can try another session on it.
 */
export async function startOn(controller: ConnectedController, options: StartLaunchOptions): Promise<StartedSession | null> {
  const { launch, index } = options;
  const cancelled = (): boolean => options.cancelled?.() ?? false;
  const notify = (text: string): void => options.notify?.(sanitise(text, "approval"));
  const command = launchArgv(launch);
  const recorder = createSessionRecorder(
    index,
    { agent: launch.agentName, ...(launch.agentName === AD_HOC_AGENT ? { command } : {}) },
    options.now ? { now: options.now } : {},
  );
  controller.subscribe((session) => recorder.observe(session));
  options.onConnected?.(controller, recorder);
  if (cancelled()) {
    await controller.detach();
    return null;
  }

  const target: SessionTarget | null = options.target ?? null;
  if (target === null) {
    await controller.newSession(launch.directory);
    options.attach?.(controller, "new");
    return { controller, recorder, mode: "new" };
  }
  // Nothing is sent, and nothing attached, to an agent that cannot reopen sessions.
  requireReopen(controller, target.sessionId, launch);

  if (launch.indexMatches > 1) notify(`${launch.indexMatches} harnesses have this session: opened with ${oneLine(launch.agentName)} (latest)`);

  options.attach?.(controller, "open");
  let mode: SessionOpenMode;
  try {
    mode = await controller.openSession(target.sessionId, target.directory);
  } catch (error) {
    if (cancelled()) return null;
    throw openFailure(error, target.sessionId, launch, options.openHint);
  }
  if (cancelled()) return null;
  // Design decision 2: a session in another directory than the launch directory (the shell's)
  // says so after its history, directly above the prompt box, wrapping like conversation text.
  if (target.note) controller.notice(target.note);
  if (target.directory !== launch.launchDirectory) controller.notice(directoryMarker(target.directory, launch.launchDirectory, homeOf(options)));
  recorder.opened(controller.getSession(), { title: target.title });
  return { controller, recorder, mode };
}
