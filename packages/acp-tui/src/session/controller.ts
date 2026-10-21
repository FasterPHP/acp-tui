// Headless session controller (task 5.4): owns the agent connection and
// feeds acp-model's pure `reduce` step, exposing a small observable API that
// a Solid store adapter (or, here, tests) can subscribe to. No rendering, no
// OpenTUI, no Solid -- this module only orchestrates the ACP wire protocol
// and the model.
//
// mvp-sessions (task 5.1): `connectAgent` launches and initialises the agent
// without a session; `newSession` then sends `session/new`, or `openSession`
// reopens an earlier session by `session/load` when the agent advertises
// `loadSession`, else by `session/resume` (design decision 2), with the
// client handler's batched replay during a load (task 6.1). `startSession`
// is both steps for a new session, as before. Switching sessions (task 7.4,
// design decision 7): `reuse` gives a new controller over the same agent
// process and connection, and the agent's messages are routed to it.
import { createSession, reduce, type ModelEvent, type Session, type SessionOpenMode } from "acp-model";
import type { Implementation, ListSessionsResponse, ResourceLink } from "@agentclientprotocol/sdk";
import { createClientHandler, type ClientHandler, type ElicitationHandler } from "../agent/client-handler.ts";
import {
  createConnection,
  createNewSession,
  initializeAgent,
  listSessions,
  loadSession,
  resumeSession,
  sessionSupport,
  type AcpClient,
  type SessionSupport,
} from "../agent/connection.ts";
import { DEFAULT_STARTUP_TIMEOUT_SECONDS } from "../agent/command.ts";
import { harnessActivity, type HarnessActivity } from "../agent/harness-activity.ts";
import { killProcessTree } from "../agent/kill-tree.ts";
import { launchAgent, type LaunchedAgent } from "../agent/launch.ts";
import { isAuthRequired, LoginRequiredError, loginMessage } from "../agent/login.ts";
import { createDebugLogger, type DebugLogger } from "../log.ts";
import type { Pace } from "../renderer/frame-pace.ts";

/** Why a prompt was refused: a turn is running, the session is still being opened by load or
 *  resume (spec tui-sessions "Input while history loads"), or there is no session yet. */
export type PromptRefusal = "turn_running" | "opening" | "no_session";

/** A `resource_link` block sent after a prompt's text: a file mention (task 6.7). */
export type ResourceLinkBlock = ResourceLink & { type: "resource_link" };

export type PromptResult ={ readonly accepted: true } | { readonly accepted: false; readonly reason: PromptRefusal };

/** Thrown by `openSession` when the agent advertises neither `loadSession` nor
 *  `sessionCapabilities.resume` (mvp-sessions design decision 3); nothing is sent. */
export class CannotReopenError extends Error {
  constructor(readonly sessionId: string) {
    super("the harness cannot reopen sessions (no session/load or session/resume)");
    this.name = "CannotReopenError";
  }
}

/** The additional directories a session is started or opened with. The model records the list
 *  (`additionalDirectories`) as the client delivered it; the request carries it as the ACP field
 *  only when `send` is true (the harness advertises the capability and has no argument template),
 *  and an empty list is never sent. */
export interface SessionDirectories {
  readonly additionalDirectories?: readonly string[];
  readonly send?: boolean;
}

const sentField = (directories: SessionDirectories): { additionalDirectories?: readonly string[] } =>
  directories.send === true && (directories.additionalDirectories?.length ?? 0) > 0 ? { additionalDirectories: directories.additionalDirectories! } : {};

export interface SessionController {
  /** What the agent offers for earlier sessions (from `initialize`). */
  readonly support: SessionSupport;
  /** `agentInfo` from the `initialize` response, if any. */
  readonly agentInfo: Implementation | null;
  /** Sends `session/new` with `cwd` (once per controller, instead of `openSession`), and
   *  `options.additionalDirectories` when given and non-empty (the caller checks `support`). */
  newSession(cwd: string, options?: SessionDirectories): Promise<void>;
  /**
   * Reopens session `sessionId` in `cwd`: `session/load` when the agent advertises
   * `loadSession`, else `session/resume` when it advertises `sessionCapabilities.resume`, else
   * throws `CannotReopenError` without sending anything. Both send `cwd` and an empty
   * `mcpServers` list. `session_opening` is dispatched before the request; during a load the
   * replayed updates are reduced in slices, and the promise resolves once the last of them and
   * `session_opened` have reached the listeners. Rejects with the agent's error (a
   * `RequestError` with its `code`) or a start-up error.
   */
  openSession(sessionId: string, cwd: string, options?: SessionDirectories): Promise<SessionOpenMode>;
  /** Appends acp-tui's own notice to the conversation as a marker item (`client_notice`; the
   *  session directory marker, mvp-sessions task 12.3). Nothing is sent to the agent. */
  notice(text: string): void;
  /** One page of `session/list` (`cwd` filters by directory); only when `support.list`. */
  listSessions(params: { readonly cwd?: string; readonly cursor?: string }, signal?: AbortSignal, options?: { readonly startup?: boolean }): Promise<ListSessionsResponse>;
  /** Current, immutable session snapshot. */
  getSession(): Session;
  /** Registers a listener called after every state change; returns an unsubscribe function.
   *  During a load's replay it is called once per slice of updates, not once per update. */
  subscribe(listener: (session: Session) => void): () => void;
  /**
   * Sends `text` as one text block, followed by `links` (the prompt box's file mentions, as
   * `resource_link` blocks; mvp-chrome-and-keys task 6.7), so a prompt without mentions is a
   * single text block. Refuses (without sending anything) while a turn is already running, so
   * the caller (the composer) knows to keep the text (spec "Submit while running"), while the
   * session is being opened (`opening`), and before it exists.
   */
  prompt(text: string, links?: readonly ResourceLinkBlock[]): PromptResult;
  /**
   * Cancels a running turn: answers every open permission request with outcome `cancelled`, then
   * sends `session/cancel` (spec "Turn cancellation", in that order). A no-op while idle.
   */
  cancel(): void;
  /** Answers the open permission request. Returns false if there is none, or `optionId` does not
   *  match one of its options. */
  answerPermission(optionId: string): boolean;
  /**
   * Sends `session/set_config_option`; the full config option list the agent returns replaces the
   * session's (`config_options_replaced`, mvp-chrome-and-keys design D10) before it resolves.
   * Rejects with the agent's error, the session's list unchanged.
   */
  setConfigOption(configId: string, value: string | boolean): Promise<void>;
  /**
   * Sends `session/set_mode` (legacy modes, for an agent that offers no `mode` config option).
   * Once the agent accepts, the session's current mode is `modeId`: the response carries nothing,
   * so a `current_mode_update` is applied as if the agent had sent it. Rejects with the agent's
   * error, the mode unchanged.
   */
  setMode(modeId: string): Promise<void>;
  /**
   * Changes the model of an agent that reports it through the older model state (`models`, no
   * `model` config option), with `session/set_model`. The current model is recorded only when
   * the agent accepts, as a `legacy_model_selected` event, and only if this session is still the
   * one in use (a reply that arrives after a switch changes nothing). Rejects with the agent's
   * error, the model unchanged.
   */
  setModel(modelId: string): Promise<void>;
  /**
   * Detaches: closes the connection (by ending the child's stdin) without ever sending
   * `session/close` or `session/cancel` (spec "Exit is detach"). For a direct stdio agent this
   * ends the child process. That exit, and the rejection of a running prompt that closing the
   * connection causes, are the user's own doing, not a failure: once detach has begun neither is
   * recorded in the session (no `prompt_error`, no `agent_exited`), so the conversation does not
   * gain an error line or an "agent exited" line on the way out (spec "Agent disconnect is
   * survivable" is for a genuine crash). Resolves once the child has exited or after a short
   * grace period, after which it is killed.
   */
  detach(): Promise<void>;
}

/** A controller that can also kill its agent at once (a start-up that failed), and hand its
 *  agent process and connection on to another session (mvp-sessions design decision 7). */
export interface ConnectedController extends SessionController {
  kill(): void;
  /**
   * A new controller, with no session yet, over this controller's agent process and connection
   * (switching sessions with the same agent command; ACP allows several sessions on one
   * connection). From now on the agent's messages go to the new controller; this one keeps its
   * last snapshot and is sent nothing more, and an update or permission request for its session
   * is dropped (a permission request answered `cancelled`). Nothing is sent to the agent for this
   * controller's session (no `session/close`, no `session/cancel`). `detach` and `kill` on any
   * controller of the connection close the shared agent process.
   */
  reuse(): ConnectedController;
  /** Makes this controller the one the agent's messages go to again (a switch that failed). */
  activate(): void;
}

export interface StartSessionOptions {
  readonly command: readonly string[];
  /** Added to acp-tui's own environment for the agent process (a configured agent's `env`). */
  readonly env?: Readonly<Record<string, string>>;
  /** The harness's name in the catalogue, or `ad hoc`, for the errors that name it. */
  readonly harness?: string;
  /** For a built-in harness whose program the user installs: how, appended to the error when the program is not found. */
  readonly installHint?: string;
  /** The built-in harness's login command, for the authentication-required message. */
  readonly loginHint?: string;
  /** The agent process's working directory, and the `cwd` of `startSession`'s new session. */
  readonly cwd: string;
  readonly logger?: DebugLogger;
  /** Clock override for tests; defaults to `Date.now`. */
  now?(): number;
  /** Seconds a starting harness may stay silent before it is stopped (start-up timeout, agent/startup-watch.ts); default 30. */
  readonly startupTimeoutSeconds?: number;
  /** Called as soon as the harness process has been started, before `initialize`: the caller can
   *  end it while it starts (Ctrl+D), which the controller does not exist for yet. */
  onLaunched?(launched: LaunchedHarness): void;
  /** Called once `initialize` has been answered, when the harness is surely running (the Windows
   *  title is set again then: renderer/terminal-signals.ts `reassertTitle`). */
  onInitialized?(): void;
  /** Called after a session was created or opened, a prompt was answered, or a tool call ended
   *  (agent/harness-activity.ts): the moments a harness may have retitled the Windows console, so
   *  the title is set again (renderer/terminal-signals.ts). Never for a replay's updates. */
  onActivity?(activity: HarnessActivity): void;
  /** How long `detach()` waits for the child to exit on its own before killing it (ms). */
  detachGraceMs?: number;
  /** Answers elicitation requests and advertises the capability (the app always gives one). */
  elicitation?: ElicitationHandler;
  /** Paces the replay's drain and the agent read loop around the renderer's frames during a load
   *  (renderer/frame-pace.ts); without one, timer turns. */
  pace?: Pace;
}

/** A harness process that has been started and may still be starting. */
export interface LaunchedHarness {
  /** Ends the process at once (its whole tree on Windows), with no grace period. */
  kill(): void;
  /** Resolves when `initialize` has been answered or the start has failed. */
  readonly settled: Promise<void>;
}

/** How long `detach()` waits for the process tree to be ended after the grace period (ms). */
const KILL_TREE_WAIT_MS = 3000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Launches `options.command`, completes `initialize` and `session/new`, and returns a
 * `SessionController` for the resulting session. Throws `AgentLaunchError` (missing command) or
 * `AgentStartupError` (agent exited before start-up completed) or `ProtocolVersionMismatchError`
 * if start-up fails; the caller is responsible for the exit-code/error-message policy (CLI task
 * 5.1 handles that at the process boundary).
 */
export async function startSession(options: StartSessionOptions): Promise<SessionController> {
  const controller = await connectAgent(options);
  try {
    await controller.newSession(options.cwd);
  } catch (error) {
    controller.kill();
    throw error;
  }
  return controller;
}

/**
 * Launches `options.command` in `options.cwd` and completes `initialize`, with no session yet:
 * the caller follows with `newSession` or `openSession`. Throws as `startSession` does.
 */
export async function connectAgent(options: StartSessionOptions): Promise<ConnectedController> {
  const logger = options.logger ?? createDebugLogger(undefined);
  const now = options.now ?? Date.now;
  const detachGraceMs = options.detachGraceMs ?? 2000;

  let disconnected = false;
  // Set synchronously when detach() starts, before the connection is closed.
  let detached = false;

  const agent: LaunchedAgent = launchAgent(options.command, { cwd: options.cwd, logger, ...(options.env ? { env: options.env } : {}), ...(options.harness !== undefined ? { harness: options.harness } : {}), ...(options.installHint !== undefined ? { installHint: options.installHint } : {}) });

  // One controller's session: the model, its listeners and its client handler. The connection's
  // messages go to the active one (`reuse` makes another active; mvp-sessions design decision 7);
  // the sessions of controllers no longer in use are `retired`, and their updates and permission
  // requests are dropped.
  interface Core {
    session: Session;
    readonly listeners: Set<(session: Session) => void>;
    readonly handler: ClientHandler;
    claimed: boolean;
    dispatch(event: ModelEvent): void;
  }
  const retired = new Set<string>();

  function createCore(): Core {
    const listeners = new Set<(session: Session) => void>();
    let session = createSession();
    function apply(event: ModelEvent): void {
      session = reduce(session, event, (info) => {
        if (info.kind === "unknown_mode") logger.log({ event: "unknown_mode", modeId: info.modeId });
        else if (info.kind === "unknown_model") logger.log({ event: "unknown_model", modelId: info.modelId });
        else if (info.kind === "invalid_models") logger.log({ event: "invalid_models" });
        else logger.log({ event: "unknown_session_update", sessionUpdate: info.sessionUpdate });
      });
    }
    function notify(): void {
      for (const listener of listeners) listener(session);
    }
    function dispatch(event: ModelEvent): void {
      apply(event);
      notify();
      const activity = options.onActivity ? harnessActivity(event) : null;
      if (activity) {
        try {
          options.onActivity?.(activity);
        } catch {
          // a hook never breaks the session
        }
      }
    }
    // The batched replay applies a slice of events, then notifies once (design decision 10).
    const handler = createClientHandler({ dispatch, apply, flush: notify, logger, now, ...(options.pace ? { pace: options.pace } : {}), ...(options.elicitation ? { elicitation: options.elicitation } : {}) });
    return {
      get session() {
        return session;
      },
      set session(next: Session) {
        session = next;
      },
      listeners,
      handler,
      claimed: false,
      dispatch,
    };
  }

  let active = createCore();

  /** The handler for a message about `sessionId`: the active controller's, unless the session
   *  belongs to a controller no longer in use. */
  const route = (sessionId: string): ClientHandler | null => (retired.has(sessionId) && active.session.id !== sessionId ? null : active.handler);
  const routed: AcpClient = {
    requestPermission: (request, context) => route(request.sessionId)?.client.requestPermission(request, context) ?? Promise.resolve({ outcome: { outcome: "cancelled" } }),
    sessionUpdate: (params) => route(params.sessionId)?.client.sessionUpdate(params) ?? Promise.resolve(),
  };
  // Elicitation goes to the active controller's handler.
  if (options.elicitation) {
    routed.createElicitation = (request) => active.handler.client.createElicitation!(request);
    routed.completeElicitation = (notification) => active.handler.client.completeElicitation!(notification);
  }
  // While a load replays, the agent's messages are read in slices too (connection.ts `pacedStream`),
  // with their turns from the pace when there is one (history-replay-pacing design D1).
  const conn = createConnection(agent, () => routed, () => active.handler.replaying(), options.pace, {
    command: options.command,
    timeoutSeconds: options.startupTimeoutSeconds ?? DEFAULT_STARTUP_TIMEOUT_SECONDS,
    logger,
  });

  function handleDisconnect(exitCode: number | null): void {
    if (disconnected) return;
    disconnected = true;
    if (detached) {
      // The exit the user asked for by detaching; not a disconnect to report.
      logger.log({ event: "agent_exited_after_detach", exitCode });
      return;
    }
    active.dispatch({ type: "agent_exited", exitCode, at: now() });
  }

  // Both paths report the same event; either can fire first (stdout closing and the process
  // fully exiting race each other), so both resolve the exit code from `agent.exited` -- the
  // authoritative source -- rather than `proc.exitCode`, which may still read null if read before
  // Bun has reaped the process.
  agent.exited.then((code) => handleDisconnect(code)).catch(() => {});
  conn.closed
    .then(() => agent.exited.then(handleDisconnect))
    .catch(() => agent.exited.then(handleDisconnect));

  // On Windows this ends the harness's whole process tree (agent/kill-tree.ts), so a harness run
  // through `cmd.exe` leaves nothing behind; elsewhere it is `proc.kill()`.
  function kill(): void {
    void killProcessTree(agent.proc);
  }

  // One detach per agent process; a second call (exit after a switch began closing it) waits for
  // the same one.
  let detaching: Promise<void> | null = null;
  function detach(): Promise<void> {
    detaching ??= (async () => {
      detached = true;
      try {
        const writer = agent.stdin.getWriter();
        await writer.close();
      } catch {
        // Already closed, or a write was in flight; either way the child's stdin is going away.
      }
      const exitedInTime = await Promise.race([
        agent.exited.then(() => true),
        Bun.sleep(detachGraceMs).then(() => false),
      ]);
      // On Windows the tree is ended by `taskkill`, so the detach waits for it (bounded), and an
      // exit that follows leaves nothing of the harness running.
      if (!exitedInTime) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const bound = new Promise<void>((resolve) => {
          timer = setTimeout(resolve, KILL_TREE_WAIT_MS);
        });
        await Promise.race([killProcessTree(agent.proc), bound]);
        clearTimeout(timer);
      }
    })();
    return detaching;
  }

  let init: Awaited<ReturnType<typeof initializeAgent>>;
  let markSettled!: () => void;
  const settled = new Promise<void>((resolve) => {
    markSettled = resolve;
  });
  try {
    options.onLaunched?.({ kill, settled });
  } catch {
    // a hook never fails the start-up
  }
  try {
    init = await initializeAgent(conn, agent, options.command, { logger, elicitation: options.elicitation !== undefined });
  } catch (error) {
    kill();
    throw error;
  } finally {
    markSettled();
  }
  try {
    options.onInitialized?.();
  } catch {
    // a hook never fails the start-up
  }
  const support = sessionSupport(init);
  const agentInfo = init.agentInfo ?? null;
  // A built-in harness with a login command is launched with its `loginHint` (a configured entry has none).
  const loginOptions = { harness: options.harness, loginHint: options.loginHint };

  /** Makes `core` the controller the agent's messages go to; the previous one's session retires. */
  function activate(core: Core): void {
    if (core === active) return;
    if (active.session.id) retired.add(active.session.id);
    if (core.session.id) retired.delete(core.session.id);
    active = core;
  }

  function controllerFor(core: Core): ConnectedController {
    // One session per controller: `newSession` or `openSession`, once.
    function claim(): void {
      if (core.claimed) throw new Error("this controller already has a session");
      core.claimed = true;
    }
    const { handler, dispatch } = core;

    return {
      support,
      agentInfo,
      kill,
      detach,

      reuse(): ConnectedController {
        const next = createCore();
        activate(next);
        return controllerFor(next);
      },

      activate: () => activate(core),

      async newSession(cwd: string, directories: SessionDirectories = {}): Promise<void> {
        claim();
        let response;
        try {
          response = await createNewSession(conn, agent, options.command, cwd, { logger, ...sentField(directories) });
        } catch (error) {
          if (isAuthRequired(error)) {
            logger.log({ event: "auth_required", phase: "new" });
            throw new LoginRequiredError(loginMessage(error, loginOptions));
          }
          throw error;
        }
        dispatch({ type: "session_created", response, cwd, additionalDirectories: directories.additionalDirectories ?? [], agentInfo, at: now() });
      },

      async openSession(sessionId: string, cwd: string, directories: SessionDirectories = {}): Promise<SessionOpenMode> {
        const mode: SessionOpenMode | null = support.load ? "load" : support.resume ? "resume" : null;
        if (mode === null) throw new CannotReopenError(sessionId);
        claim();
        // A session switched away from earlier in this run may be opened again.
        if (core === active) retired.delete(sessionId);
        // Before the request, so the replayed updates find the session identified.
        dispatch({ type: "session_opening", mode, sessionId, cwd, additionalDirectories: directories.additionalDirectories ?? [], agentInfo, at: now() });
        const sent = sentField(directories);
        if (mode === "resume") {
          const response = await resumeSession(conn, agent, options.command, sessionId, cwd, { logger, ...sent });
          dispatch({ type: "session_opened", response, at: now() });
          return mode;
        }
        handler.beginReplay();
        let response;
        try {
          response = await loadSession(conn, agent, options.command, sessionId, cwd, { logger, ...sent });
        } catch (error) {
          handler.abortReplay();
          throw error;
        }
        // Behind every queued update, so the replay keeps its order.
        await handler.endReplay({ type: "session_opened", response, at: now() });
        return mode;
      },

      notice(text: string): void {
        dispatch({ type: "client_notice", text, at: now() });
      },

      listSessions(params, signal, listOptions): Promise<ListSessionsResponse> {
        return listSessions(conn, agent, options.command, params, { logger, ...(signal ? { signal } : {}), ...(listOptions?.startup ? { startup: true } : {}) });
      },

      getSession(): Session {
        return core.session;
      },

      subscribe(listener: (session: Session) => void): () => void {
        core.listeners.add(listener);
        return () => core.listeners.delete(listener);
      },

      prompt(text: string, links: readonly ResourceLinkBlock[] = []): PromptResult {
        const session = core.session;
        if (session.opening !== null) return { accepted: false, reason: "opening" };
        if (session.state !== "idle") {
          return { accepted: false, reason: "turn_running" };
        }
        const sessionId = session.id;
        if (!sessionId) return { accepted: false, reason: "no_session" };
        dispatch({ type: "prompt_sent", text, at: now() });
        logger.log({ event: "prompt_request", sessionId });
        void conn.prompt({ sessionId, prompt: [{ type: "text", text }, ...links] }).then(
          (response) => {
            logger.log({ event: "prompt_response", sessionId, stopReason: response.stopReason });
            dispatch({ type: "prompt_response", stopReason: response.stopReason, at: now() });
          },
          (error: unknown) => {
            if (disconnected) return; // already recorded as an agent-exited disconnect
            if (detached) {
              // Closing the connection on detach rejects the pending prompt ("ACP connection
              // closed"); that is the user's exit, not a prompt error.
              logger.log({ event: "prompt_closed_by_detach", sessionId });
              return;
            }
            if (isAuthRequired(error)) {
              logger.log({ event: "auth_required", phase: "prompt" });
              logger.log({ event: "prompt_error", sessionId });
              dispatch({ type: "prompt_error", message: loginMessage(error, loginOptions), at: now() });
              return;
            }
            logger.log({ event: "prompt_error", sessionId });
            dispatch({ type: "prompt_error", message: errorMessage(error), at: now() });
          },
        );
        return { accepted: true };
      },

      cancel(): void {
        const session = core.session;
        if (session.state === "idle") return;
        handler.cancelOpenPermission();
        const sessionId = session.id;
        if (!sessionId) return;
        logger.log({ event: "cancel_request", sessionId });
        void conn.cancel({ sessionId }).catch(() => {
          // The agent may already be gone; agent-exited handling covers that case.
        });
      },

      answerPermission(optionId: string): boolean {
        return handler.answerPermission(optionId);
      },

      async setConfigOption(configId: string, value: string | boolean): Promise<void> {
        const sessionId = core.session.id;
        if (!sessionId) throw new Error("no session");
        logger.log({ event: "set_config_option_request", configId });
        const request = typeof value === "boolean" ? { sessionId, configId, type: "boolean" as const, value } : { sessionId, configId, value };
        const response = await conn.setSessionConfigOption(request);
        logger.log({ event: "set_config_option_response", configId, count: response.configOptions.length });
        // The agent's full list replaces the session's, sanitised by the reducer (design D10).
        dispatch({ type: "config_options_replaced", configOptions: response.configOptions, at: now() });
      },

      async setMode(modeId: string): Promise<void> {
        const sessionId = core.session.id;
        if (!sessionId) throw new Error("no session");
        logger.log({ event: "set_mode_request" });
        await conn.setSessionMode({ sessionId, modeId });
        logger.log({ event: "set_mode_response" });
        dispatch({ type: "session_update", update: { sessionUpdate: "current_mode_update", currentModeId: modeId }, at: now() });
      },

      async setModel(modelId: string): Promise<void> {
        const sessionId = core.session.id;
        if (!sessionId) throw new Error("no session");
        logger.log({ event: "set_model_request" });
        await conn.setSessionModel({ sessionId, modelId });
        logger.log({ event: "set_model_response" });
        // The unstable API has no model update notification, so the reply is the only news. A
        // session switched away from in the meantime is not the one in use: nothing is recorded.
        if (core !== active) return;
        dispatch({ type: "legacy_model_selected", modelId, at: now() });
      },
    };
  }

  return controllerFor(active);
}
