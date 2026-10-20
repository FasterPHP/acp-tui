// The session in use and switching to another one (mvp-sessions task group
// 7, design decisions 5 to 7, spec tui-sessions "Reaching the session list",
// "Agent selector", "Switching sessions is detach" and "Honest errors when a
// session cannot be opened"). The app (app/run.tsx) starts through it and the
// session list (overlay/SessionList.tsx) reads and chooses through it.
//
// - `prepare` finds what `--resume <id>` or `--continue` asks for before the
//   full-screen app starts (`prepareLaunch`, design decision 13), keeping the
//   agent it launched; `start` then opens it (or a new session) once the app
//   is up; `connect` (`--resume` without an ID) launches and initialises the
//   agent with no session, so the list can read the agent's `session/list`;
//   `startNew` (Esc in the list at start-up) then starts a new session on it.
//   The list opens with the app's first frame, while `connect` is still running
//   (day-two-feedback D2): `starting()` says whether it is, and `ready()` is the promise
//   the list's first page, a choice made meanwhile, and `startNew` wait for.
// - `choose` opens a row of the list. A session of the agent in use, or a new
//   session with the same agent command, keeps the agent process and
//   connection (`reuse`: a new controller over it). Another agent is launched
//   first; only once its session is open is the old process closed, exactly
//   as on exit (its stdin ended). Nothing is sent for the old session: no
//   `session/close`, no `session/cancel`. The store is attached to the new
//   controller (`store.replace`, which also resets the conversation's view).
// - A choice that fails leaves everything as it was (the old controller
//   active again, a newly launched agent killed, the store back on the old
//   session) and resolves with the message the list shows in its footer row.
//   An error thrown by the store while it attaches the new session is not
//   such a failure but acp-tui's own: `choose` rejects with it, nothing rolled
//   back (IDE check 10.2).
// - Switching is refused while a turn runs, a permission request is open or
//   the session is still being opened; nothing is sent then. An `ad hoc`
//   session that is not the agent in use's, and a session of an agent no
//   longer configured, are refused with a message before anything runs.
import type { ListSessionsResponse } from "@agentclientprotocol/sdk";
import type { ElicitationHandler } from "../agent/client-handler.ts";
import { findAgent, loadAgentCatalogue, type AgentCatalogue } from "../agent/catalogue.ts";
import { commandDisplayName } from "../agent/harness-name.ts";
import { AD_HOC_AGENT, adHocSessionMessage, launchArgv, unconfiguredAgentMessage, type LaunchDescription } from "../agent/resolve.ts";
import type { DebugLogger } from "../log.ts";
import type { CurrentAgent, SessionListEntry } from "../overlay/sessions.ts";
import type { ConnectedController } from "./controller.ts";
import type { SessionRecorder } from "./recorder.ts";
import { oneLine, type SessionIndex, type SessionRecord } from "./session-index.ts";
import { agentLabel, connectLaunch, prepareLaunch, RESUME_HINT, SessionOpenFailure, startOn, type PreparedLaunch, type SessionTarget } from "./start.ts";
import type { SessionStore } from "./store.ts";
import type { Pace } from "../renderer/frame-pace.ts";

/** The session in use: what launched it, its controller and recorder, and how it was opened. */
export interface CurrentSession {
  readonly launch: LaunchDescription;
  readonly controller: ConnectedController;
  /** Null while the agent has no session yet (`--resume` without an ID, before a row is chosen). */
  readonly recorder: SessionRecorder | null;
  /** Opened by load or resume (requested: a detach during the load still leaves a session to
   *  resume). */
  readonly opened: boolean;
}

/** Shown when the list is chosen from while a turn runs (spec "Switch refused while running"). */
export const SWITCH_REFUSED_RUNNING = "the running turn must finish or be interrupted before you switch sessions; nothing was sent";
export const SWITCH_REFUSED_PERMISSION = "a permission request is open: answer it before you switch sessions; nothing was sent";
export const SWITCH_REFUSED_OPENING = "the session is still opening: wait for it before you switch sessions";

export interface SessionSwitcherOptions {
  /** The launch the command line asked for. */
  readonly launch: LaunchDescription;
  readonly logger?: DebugLogger;
  readonly index: SessionIndex;
  readonly store: Pick<SessionStore, "attach" | "replace">;
  /** Shows a notice. */
  notify?(text: string): void;
  /** True once the user has exited. */
  cancelled?(): boolean;
  readonly elicitation?: ElicitationHandler;
  /** Paces a load's replay around the renderer's frames (renderer/frame-pace.ts). */
  readonly pace?: Pace;
  /** Called each time a harness has answered `initialize` (start-up, a switch to another harness). */
  readonly onHarnessInitialized?: () => void;
  /** Reads the agent catalogue (each time the list asks); default `loadAgentCatalogue()`. */
  readonly catalogue?: () => AgentCatalogue;
  readonly now?: () => number;
}

export interface SessionSwitcher {
  /** The session in use, or null before the agent has started. */
  current(): CurrentSession | null;
  /** Before the full-screen app: for `--resume <id>` and `--continue`, launches and initialises
   *  the agent and finds the session (`prepareLaunch`); nothing for a new session or the list.
   *  Throws the agent's start-up errors and `SessionOpenFailure`, nothing left running. */
  prepare(): Promise<void>;
  /** Starts what the launch asks for: a new session, or the session `prepare` found (prepared
   *  now if it was not). Throws as `startLaunch` does, an agent's error ending with
   *  `RESUME_HINT`. */
  start(): Promise<void>;
  /** `--resume` without an ID: launches and initialises the agent, with no session. */
  connect(): Promise<void>;
  /** Whether `connect` is still launching and initialising the agent. */
  starting(): boolean;
  /** Resolves once the agent `connect` started is up (at once when no `connect` is running or it
   *  has finished), and rejects with its start-up error. */
  ready(): Promise<void>;
  /** Esc in the list at start-up: a new session with the agent in use in the session directory,
   *  once the agent is up. Throws the agent's error. */
  startNew(): Promise<void>;
  /** The names of the agents the "New session with" rows offer (built-in and configured). */
  agents(): readonly string[];
  /** The agent in use. */
  currentAgent(): CurrentAgent;
  /** The session directory: the session in use's, else the launch's. */
  directory(): string;
  /** Whether the agent in use can list its sessions now. */
  canList(): boolean;
  /** One page of the agent in use's `session/list`. */
  listPage(params: { readonly cwd?: string; readonly cursor?: string }, signal?: AbortSignal): Promise<ListSessionsResponse>;
  /** The index's sessions. */
  records(): readonly SessionRecord[];
  /** Why switching is refused now, or null. */
  refusal(): string | null;
  /**
   * Opens `entry` (a session, or a new session with an agent). Resolves with null once it is open
   * (or the user exited meanwhile), else with the message for the list's footer row, everything
   * left as it was. Rejects only with an error the store threw while attaching the new session
   * (acp-tui's own fault), the new session then left in use.
   */
  choose(entry: SessionListEntry): Promise<string | null>;
  /** Detaches every agent this run has started and not yet closed (exit). */
  detach(): Promise<void>;
}

/** The harness's name for a message (`auggie`; for an ad hoc command its first word, without its directory and, on Windows, its `.cmd`, `.bat` or `.exe` extension). */
function harnessOf(launch: Pick<LaunchDescription, "agentName" | "command">): string {
  return launch.agentName === AD_HOC_AGENT ? commandDisplayName(launch.command) : launch.agentName;
}

/** The command and environment a launch runs, to tell whether two launches share an agent. */
function commandKey(launch: Pick<LaunchDescription, "command" | "args" | "env">): string {
  return JSON.stringify([launchArgv(launch), Object.entries(launch.env).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))]);
}

function message(error: unknown): string {
  return oneLine(error instanceof Error ? error.message : String(error)) || "unknown error";
}

export function createSessionSwitcher(options: SessionSwitcherOptions): SessionSwitcher {
  const { launch, logger, index, store } = options;
  const cancelled = (): boolean => options.cancelled?.() ?? false;
  const readCatalogue = options.catalogue ?? (() => loadAgentCatalogue());
  /**
   * The agent in use, for its own rows of the list: a named agent as the configuration defines it
   * now (mvp-configuration task 3.3: an edited `agent_servers` entry applies to the next session,
   * while the running process is never restarted by the reload itself), so a changed command,
   * arguments or environment launches a new process and an unchanged one keeps the process
   * (`commandKey`). An ad hoc agent, or a named one no longer configured, keeps the command it
   * was launched with.
   */
  const currentAgentLaunch = (using: LaunchDescription): Pick<LaunchDescription, "agentName" | "agentSource" | "command" | "args" | "env"> => {
    if (using.agentName === AD_HOC_AGENT) return using;
    try {
      const found = findAgent(readCatalogue(), using.agentName);
      return { agentName: found.name, agentSource: using.agentSource, command: found.command, args: found.args, env: found.env };
    } catch {
      return using;
    }
  };
  let state: CurrentSession | null = null;
  // What `prepare` found, until `start` uses it.
  let prepared: PreparedLaunch | null = null;
  // Every controller started in this run, for exit (detach is per agent process and idempotent).
  const started = new Set<ConnectedController>();
  let switching = false;
  // The start-up `connect`, for `starting` and `ready`; null when none was begun.
  let connection: Promise<void> | null = null;
  let connecting = false;

  const common = {
    ...(logger ? { logger } : {}),
    ...(options.elicitation ? { elicitation: options.elicitation } : {}),
    ...(options.pace ? { pace: options.pace } : {}),
    ...(options.onHarnessInitialized ? { onHarnessInitialized: options.onHarnessInitialized } : {}),
    ...(options.now ? { now: options.now } : {}),
  };
  const notify = (text: string): void => options.notify?.(text);

  function refusal(): string | null {
    const session = state?.controller.getSession();
    if (!session?.id) return null;
    if (session.turn?.openPermissionToolCallId) return SWITCH_REFUSED_PERMISSION;
    if (session.state !== "idle") return SWITCH_REFUSED_RUNNING;
    if (session.opening !== null) return SWITCH_REFUSED_OPENING;
    return null;
  }

  function directory(): string {
    return state?.controller.getSession().cwd ?? state?.launch.directory ?? launch.directory;
  }

  /** The launch for a session of `base`'s agent in `dir`. */
  function launchFor(
    base: Pick<LaunchDescription, "agentName" | "agentSource" | "command" | "args" | "env">,
    dir: string,
    session: LaunchDescription["session"],
  ): LaunchDescription {
    return {
      agentName: base.agentName,
      agentSource: base.agentSource,
      command: base.command,
      args: base.args,
      env: base.env,
      directory: dir,
      directorySource: "index",
      launchDirectory: launch.launchDirectory,
      session,
      indexed: null,
      indexMatches: 0,
      problems: [],
    };
  }

  return {
    current: () => state,

    async prepare() {
      if (launch.session.kind !== "resume" && launch.session.kind !== "continue") return;
      prepared = await prepareLaunch({ launch, index, catalogue: readCatalogue, ...common });
      started.add(prepared.controller);
    },

    async start() {
      const found = prepared ?? (await prepareLaunch({ launch, index, catalogue: readCatalogue, ...common }));
      prepared = null;
      started.add(found.controller);
      try {
        await startOn(found.controller, {
          // For `--continue`, the launch of the agent the session belongs to.
          launch: found.launch,
          target: found.target,
          index,
          notify,
          cancelled,
          openHint: RESUME_HINT,
          ...common,
          onConnected: (controller, recorder) => {
            state = { launch: found.launch, controller, recorder, opened: false };
          },
          attach: (controller, how) => {
            if (state) state = { ...state, opened: how === "open" };
            store.attach(controller);
          },
        });
      } catch (error) {
        found.controller.kill();
        throw error;
      }
    },

    connect() {
      connecting = true;
      connection = (async () => {
        try {
          const controller = await connectLaunch({ launch, ...common });
          started.add(controller);
          state = { launch, controller, recorder: null, opened: false };
          if (cancelled()) await controller.detach();
        } finally {
          connecting = false;
        }
      })();
      // A failure belongs to whoever waits for `ready`; none waiting is not an unhandled rejection.
      connection.catch(() => {});
      return connection;
    },

    starting: () => connecting,

    ready: () => connection ?? Promise.resolve(),

    async startNew() {
      await (connection ?? Promise.resolve());
      if (!state) throw new Error(`${harnessOf(launch)} has not started`);
      const target: LaunchDescription = { ...state.launch, directory: directory(), session: { kind: "new" } };
      // The agent has no session yet unless one was started on it since.
      const controller = state.recorder === null ? state.controller : state.controller.reuse();
      await startOn(controller, {
        launch: target,
        index,
        notify,
        cancelled,
        ...common,
        onConnected: (c, recorder) => {
          state = { launch: target, controller: c, recorder, opened: false };
        },
        attach: (c) => store.replace(c),
      });
    },

    agents: () => [...readCatalogue().agents.keys()],

    currentAgent: () => {
      const using = state?.launch ?? launch;
      return { name: using.agentName, command: using.agentName === AD_HOC_AGENT ? launchArgv(using) : null };
    },

    directory,

    canList: () => state !== null && state.controller.support.list && state.controller.getSession().connection !== "disconnected",

    listPage: (params, signal) => {
      if (!state) return Promise.reject(new Error(`${harnessOf(launch)} has not started`));
      return state.controller.listSessions(params, signal);
    },

    records: () => index.listAll(),

    refusal,

    async choose(entry) {
      const refused = refusal();
      if (refused) return refused;
      if (switching) return "another session is being opened";
      const previous = state;
      if (!previous) return `${harnessOf(launch)} is still starting`;

      // Which agent: the one in use for its own sessions and its own new-session row; otherwise a
      // named agent from the catalogue. The index never supplies a command (design decision 2).
      let base: Pick<LaunchDescription, "agentName" | "agentSource" | "command" | "args" | "env">;
      if (entry.current) base = currentAgentLaunch(previous.launch);
      else if (entry.kind === "session" && entry.agent === AD_HOC_AGENT) return adHocSessionMessage(entry.sessionId, entry.command);
      else {
        try {
          const found = findAgent(readCatalogue(), entry.agent);
          base = { agentName: found.name, agentSource: "option", command: found.command, args: found.args, env: found.env };
        } catch (error) {
          if (entry.kind === "session") return unconfiguredAgentMessage(entry.sessionId, entry.agent, error);
          return `cannot start a new session: ${message(error)}`;
        }
      }
      const target = entry.kind === "session" ? launchFor(base, entry.directory, { kind: "resume", id: entry.sessionId }) : launchFor(base, directory(), { kind: "new" });
      const sessionTarget: SessionTarget | null = entry.kind === "session" ? { sessionId: entry.sessionId, directory: entry.directory, title: entry.title } : null;
      // The same command (and environment) on a live connection: the agent process is kept.
      const shared = commandKey(target) === commandKey(previous.launch) && previous.controller.getSession().connection !== "disconnected";

      switching = true;
      let controller: ConnectedController | null = null;
      let attached = false;
      // An error thrown while the store attaches the new session (a component of the conversation
      // that throws) is acp-tui's own fault, not a failure to open the session: see the catch.
      let storeError: { readonly error: unknown } | null = null;
      try {
        if (shared) controller = previous.controller.reuse();
        else {
          try {
            controller = await connectLaunch({ launch: target, ...common });
          } catch (error) {
            return `cannot start ${agentLabel(target)}: ${message(error)}`;
          }
          started.add(controller);
        }
        const result = await startOn(controller, {
          launch: target,
          index,
          notify,
          cancelled,
          target: sessionTarget,
          ...common,
          onConnected: (c, recorder) => {
            // From here the exit text names this session, and exit detaches its agent.
            state = { launch: target, controller: c, recorder, opened: false };
          },
          attach: (c, how) => {
            attached = true;
            state = { ...state!, opened: how === "open" };
            try {
              store.replace(c);
            } catch (error) {
              storeError = { error };
              throw error;
            }
          },
        });
        if (result === null) return null;
        // The old agent process is no longer used: closed exactly as on exit (design 6.7), its
        // stdin ended; the list need not wait for it to go (exit waits, through `detach`).
        if (!shared) void previous.controller.detach();
        return null;
      } catch (error) {
        // Not a switch failure (IDE check 10.2): the agent did its part, so nothing is rolled back
        // or blamed on it, and putting the old session back would run the same components again.
        // The new session stays the one in use (the exit text names it, exit detaches both
        // agents), and the error goes on to the app's uncaught-error path.
        // (Set in `attach`, which TypeScript's narrowing does not see.)
        const failure = storeError as { readonly error: unknown } | null;
        if (failure) throw failure.error;
        if (cancelled()) return null;
        // Everything back as it was.
        if (controller && !shared) controller.kill();
        previous.controller.activate();
        state = previous;
        // Before any session (`--resume` without an ID), back to `connecting`.
        if (attached) store.replace(previous.recorder ? previous.controller : null);
        if (error instanceof SessionOpenFailure) return error.message;
        return entry.kind === "session" ? `cannot open session ${entry.sessionId} with ${agentLabel(target)}: ${message(error)}` : `cannot start a new session with ${agentLabel(target)}: ${message(error)}`;
      } finally {
        switching = false;
      }
    },

    async detach() {
      await Promise.all([...started].map((c) => c.detach()));
    },
  };
}
