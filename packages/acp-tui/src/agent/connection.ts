// ACP connection set-up (design D4, task 5.3): an `AgentConnection` over
// `ndJsonStream`, honest client capabilities (no fs, no terminal -- design
// 5.1), the protocol version check and `session/new` with the resolved cwd
// and an empty `mcpServers` list. mvp-sessions (task 5.1) adds `session/load`,
// `session/resume` and `session/list`, each raced against the agent's exit
// like `session/new`.
//
// mvp-chrome-and-keys (task 5.5): the connection is built with the SDK's
// `client()` API rather than the legacy `ClientSideConnection`, whose
// `Client.requestPermission(params)` never sees the abort signal the SDK
// raises when the agent sends `$/cancel_request`. `AgentConnection` offers the
// same agent methods acp-tui calls, and hands the permission handler the
// request's signal and JSON-RPC id (`AcpClient`).
import {
  client as clientApp,
  ndJsonStream,
  type Client,
  type ClientConnection,
  type InitializeRequest,
  type InitializeResponse,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type LoadSessionRequest,
  type LoadSessionResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type ResumeSessionRequest,
  type ResumeSessionResponse,
  type CancelNotification,
  type PromptRequest,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SetSessionConfigOptionRequest,
  type SetSessionConfigOptionResponse,
  type SetSessionModeRequest,
  type SetSessionModeResponse,
} from "@agentclientprotocol/sdk";
import { sanitise } from "acp-model";
import type { DebugLogger } from "../log.ts";
import type { Pace } from "../renderer/frame-pace.ts";
import { harnessDescription, type LaunchedAgent } from "./launch.ts";
import { StartupWatch } from "./startup-watch.ts";

export { AgentNotAcpError, AgentStartupTimeoutError } from "./startup-watch.ts";

export const CLIENT_INFO = { name: "acp-tui", version: "0.0.0" } as const;

/** ACP protocol version acp-tui speaks (design 5.1); Phase 0 supports only 1. */
export const REQUESTED_PROTOCOL_VERSION = 1;

/** Thrown when the agent process exits (or its stdout closes) before completing start-up
 *  (design 5.2's "agent fails to start"). Carries the tail of its stderr for the error message. */
export class AgentStartupError extends Error {
  constructor(
    readonly command: readonly string[],
    readonly stderrTail: string,
    readonly exitCode: number | null,
    readonly harness?: string,
  ) {
    // The stderr tail is printed to the terminal, so it is sanitised like any agent text.
    const tail = sanitise(stderrTail).trimEnd();
    super(
      `${harnessDescription(harness, command)} exited before start-up completed (exit code ${exitCode ?? "unknown"})` +
        (tail ? `\n--- stderr (tail) ---\n${tail}` : ""),
    );
    this.name = "AgentStartupError";
  }
}

/** Thrown when the agent negotiates a protocol version other than the one requested (design 5.1). */
export class ProtocolVersionMismatchError extends Error {
  constructor(
    readonly requested: number,
    readonly negotiated: number,
  ) {
    super(`acp-tui requested protocol version ${requested}, but the harness answered with version ${negotiated}`);
    this.name = "ProtocolVersionMismatchError";
  }
}

/** Lines of agent stderr quoted in a start-up error. */
export const STARTUP_STDERR_LINES = 20;

/** How long a failed start-up request waits to see whether the agent has exited. */
const EXIT_GRACE_MS = 1000;

async function startupError(agent: LaunchedAgent, command: readonly string[], watch?: StartupWatch): Promise<never> {
  const code = await agent.exited;
  // A harness acp-tui ended itself (a silent one, one that is not ACP) is reported as that.
  if (watch?.failed) throw await watch.failed;
  // The exit can be observed before the last stderr chunk has been read.
  await Promise.race([agent.stderrClosed ?? Promise.resolve(), Bun.sleep(200)]);
  throw new AgentStartupError(command, agent.stderr.tail(STARTUP_STDERR_LINES), code, agent.harness);
}

/** Races `promise` against the agent's exit, so start-up hangs on a dead process fail fast
 *  with a useful error instead of waiting forever on a request that will never be answered.
 *  The SDK usually rejects the pending request ("ACP connection closed") as soon as the agent's
 *  stdout ends, before the exit is seen; that is reported as a start-up failure too.
 *  With a `request` name (a start-up request) it is also raced against the silence timer and the
 *  stdout watch (startup-watch.ts), which end a harness that stays alive. */
function raceWithExit<T>(conn: AgentConnection, agent: LaunchedAgent, command: readonly string[], promise: Promise<T>, request?: string): Promise<T> {
  const watch = conn.watch;
  const guard = request !== undefined ? watch?.guard(request) : undefined;
  const guarded = promise.catch(async (error: unknown) => {
    if (watch?.failed) throw await watch.failed;
    const exited = await Promise.race([agent.exited.then(() => true), Bun.sleep(EXIT_GRACE_MS).then(() => false)]);
    if (exited) return startupError(agent, command, watch);
    throw error;
  });
  const racers: Promise<T>[] = [guarded, startupError(agent, command, watch)];
  if (guard) racers.push(guard.failure);
  return Promise.race(racers).finally(() => guard?.end());
}

/** What a permission handler is told besides the request: the request's JSON-RPC id, and the
 *  signal the SDK aborts when the agent withdraws it (`$/cancel_request`). */
export interface PermissionRequestContext {
  readonly requestId: string | number | null;
  readonly signal: AbortSignal;
}

/** The client side acp-tui implements: `Client`, with the permission handler given the request's
 *  context. A handler that rejects with `RequestError.requestCancelled()` answers -32800. */
export interface AcpClient extends Omit<Client, "requestPermission"> {
  requestPermission(params: RequestPermissionRequest, context?: PermissionRequestContext): Promise<RequestPermissionResponse> | RequestPermissionResponse;
}

/**
 * The connection to the agent: the agent methods acp-tui sends, as `ClientSideConnection` named
 * them, over an SDK `client()` app whose handlers forward to the `AcpClient`.
 */
export class AgentConnection {
  private readonly connection: ClientConnection;
  /** The start-up watch (silence timer and stdout watch); none for a connection made without one. */
  readonly watch: StartupWatch | undefined;

  constructor(toClient: (conn: AgentConnection) => AcpClient, stream: ReturnType<typeof ndJsonStream>, watch?: StartupWatch) {
    this.watch = watch;
    const implementation = toClient(this);
    // The silence timer is paused while a card waits for the user (a request the harness is
    // itself waiting on is not silence).
    const whileOpen = async <R,>(work: () => Promise<R> | R): Promise<R> => {
      watch?.hold();
      try {
        return await work();
      } finally {
        watch?.release();
      }
    };
    const app = clientApp()
      .onRequest("session/request_permission", (ctx) =>
        whileOpen(() => implementation.requestPermission(ctx.params, { requestId: (ctx.requestId as string | number | undefined) ?? null, signal: ctx.signal })),
      )
      .onNotification("session/update", (ctx) => implementation.sessionUpdate(ctx.params));
    if (implementation.createElicitation) {
      const create = implementation.createElicitation.bind(implementation);
      app.onRequest("elicitation/create", (ctx) => whileOpen(() => create(ctx.params)));
    }
    if (implementation.completeElicitation) {
      const complete = implementation.completeElicitation.bind(implementation);
      app.onNotification("elicitation/complete", (ctx) => complete(ctx.params));
    }
    this.connection = app.connect(stream);
  }

  initialize(params: InitializeRequest): Promise<InitializeResponse> {
    return this.connection.agent.request("initialize", params);
  }
  newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    return this.connection.agent.request("session/new", params);
  }
  loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    return this.connection.agent.request("session/load", params) as Promise<LoadSessionResponse>;
  }
  resumeSession(params: ResumeSessionRequest): Promise<ResumeSessionResponse> {
    return this.connection.agent.request("session/resume", params);
  }
  /** With `signal`, aborting it sends `$/cancel_request` for the request (cooperative: the agent
   *  may still answer, and the answer is then the caller's to ignore). */
  listSessions(params: ListSessionsRequest, signal?: AbortSignal): Promise<ListSessionsResponse> {
    return this.connection.agent.request("session/list", params, signal ? { cancellationSignal: signal } : undefined);
  }
  setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse> {
    return this.connection.agent.request("session/set_mode", params) as Promise<SetSessionModeResponse>;
  }
  /**
   * `session/set_model`, the older unstable model selection. `@agentclientprotocol/sdk` 1.5.0 no
   * longer types it, so it is sent through the untyped `request` overload. The result is not
   * read: Auggie answers `null`, and the old response carried only `_meta`, so any result is a
   * success; an error rejects. A compatibility fallback (technical design 5.5, Models).
   */
  setSessionModel(params: { readonly sessionId: string; readonly modelId: string }): Promise<void> {
    return this.connection.agent.request("session/set_model", params).then(() => undefined);
  }
  setSessionConfigOption(params: SetSessionConfigOptionRequest): Promise<SetSessionConfigOptionResponse> {
    return this.connection.agent.request("session/set_config_option", params);
  }
  prompt(params: PromptRequest): Promise<PromptResponse> {
    return this.connection.agent.request("session/prompt", params);
  }
  cancel(params: CancelNotification): Promise<void> {
    return this.connection.agent.notify("session/cancel", params);
  }
  /** Aborted when the connection closes. */
  get signal(): AbortSignal {
    return this.connection.signal;
  }
  /** Resolves when the connection closes. */
  get closed(): Promise<void> {
    return this.connection.closed;
  }
}

/** What `createConnection` needs to watch a harness that is starting. */
export interface StartupOptions {
  readonly command: readonly string[];
  /** Seconds of silence allowed while a start-up request is unanswered. */
  readonly timeoutSeconds: number;
  readonly logger?: DebugLogger | undefined;
}

/** `paced` says when the agent's messages are read in slices (`pacedStream`); default never.
 *  `pace` gives those slices their turns outside frames (renderer/frame-pace.ts). `startup` turns on
 *  the start-up watch: the stdout watch before the SDK reads, and the silence timer that the
 *  start-up requests below are raced against (startup-watch.ts). */
export function createConnection(agent: LaunchedAgent, toClient: (agent: AgentConnection) => AcpClient, paced?: () => boolean, pace?: Pace, startup?: StartupOptions): AgentConnection {
  const watch = startup ? new StartupWatch({ agent, command: startup.command, timeoutMs: startup.timeoutSeconds * 1000, logger: startup.logger }) : undefined;
  const stream = ndJsonStream(agent.stdin, watch ? watch.watchStdout(agent.stdout) : agent.stdout);
  const readable = watch ? watch.tap(stream.readable) : stream.readable;
  return new AgentConnection(toClient, paced ? { writable: stream.writable, readable: pacedStream(readable, paced, READ_SLICE_MS, pace) } : { writable: stream.writable, readable }, watch);
}

/** How long the agent's messages are handled before the event loop gets a turn (`pacedStream`). */
export const READ_SLICE_MS = 8;

/**
 * Passes the decoded messages of `source` through unchanged, but lets the event loop turn (a
 * timer, so frames and keys get their turn too) before handing on the next message once
 * `sliceMs` have passed since the last turn (mvp-sessions task 6.3). Without it, a burst such as
 * a `session/load` replay of 8303 notifications, which arrives in a few large chunks, is
 * validated and handed to the client by the SDK in one run of microtasks: measured at about
 * 270 ms in which no frame could be drawn. Only while `active()` (the session controller: while a
 * load replays), so a prompt turn is read as before. With `pace` the turn is the pace's (outside
 * frames, and after the next frame once its budget is spent; history-replay-pacing design D1):
 * on OpenTUI 0.6 a timer turn can fall inside a frame, and the reading then stretches it.
 */
export function pacedStream<T>(source: ReadableStream<T>, active: () => boolean = () => true, sliceMs = READ_SLICE_MS, pace?: Pace): ReadableStream<T> {
  const reader = source.getReader();
  let since = performance.now();
  return new ReadableStream<T>({
    async pull(controller) {
      if (performance.now() - since >= sliceMs && active()) {
        await (pace ? pace.turn() : new Promise((resolve) => setTimeout(resolve, 0)));
        since = performance.now();
      }
      const asked = performance.now();
      const { value, done } = await reader.read();
      // A read that had to wait for the agent left the event loop free: the slice starts again.
      if (performance.now() - asked >= 1) since = performance.now();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

export interface InitializeOptions {
  readonly logger?: DebugLogger;
  /**
   * Advertise `clientCapabilities.elicitation` (form and URL modes): set whenever the session has
   * an elicitation handler, which the app always gives it since mvp-chrome-and-keys task 5.6
   * (decision 13: advertised only once built).
   */
  readonly elicitation?: boolean;
}

/** Sends `initialize`, requesting protocol version 1 and advertising no `fs` or `terminal`
 *  capabilities (design 5.1). Throws `ProtocolVersionMismatchError` if the agent answers with a
 *  different version, and `AgentStartupError` if the agent process exits first. */
export async function initializeAgent(
  conn: AgentConnection,
  agent: LaunchedAgent,
  command: readonly string[],
  options: InitializeOptions = {},
): Promise<InitializeResponse> {
  const request: InitializeRequest = {
    protocolVersion: REQUESTED_PROTOCOL_VERSION,
    clientCapabilities: {
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
      ...(options.elicitation ? { elicitation: { form: {}, url: {} } } : {}),
    },
    clientInfo: CLIENT_INFO,
  };
  options.logger?.log({ event: "initialize_request", protocolVersion: REQUESTED_PROTOCOL_VERSION, ...(options.elicitation ? { elicitation: true } : {}) });
  const response = await raceWithExit(conn, agent, command, conn.initialize(request), "initialize");
  options.logger?.log({ event: "initialize_response", protocolVersion: response.protocolVersion });
  if (response.protocolVersion !== REQUESTED_PROTOCOL_VERSION) {
    throw new ProtocolVersionMismatchError(REQUESTED_PROTOCOL_VERSION, response.protocolVersion);
  }
  return response;
}

export interface NewSessionOptions {
  readonly logger?: DebugLogger;
  /** The session's complete list of additional directories, sent as `additionalDirectories` only
   *  when non-empty (the caller sends it only to a harness that advertises the capability). */
  readonly additionalDirectories?: readonly string[];
}

/** The `additionalDirectories` field of a request, present only for a non-empty list. */
function directoriesField(options: NewSessionOptions): { additionalDirectories?: string[] } {
  const list = options.additionalDirectories ?? [];
  return list.length > 0 ? { additionalDirectories: [...list] } : {};
}

/** Sends `session/new` with the given `cwd` and an empty `mcpServers` list (design 5.2). */
export async function createNewSession(
  conn: AgentConnection,
  agent: LaunchedAgent,
  command: readonly string[],
  cwd: string,
  options: NewSessionOptions = {},
): Promise<NewSessionResponse> {
  const request: NewSessionRequest = { cwd, mcpServers: [], ...directoriesField(options) };
  options.logger?.log({ event: "session_new_request", cwd });
  const response = await raceWithExit(conn, agent, command, conn.newSession(request), "session/new");
  options.logger?.log({ event: "session_new_response", sessionId: response.sessionId });
  return response;
}

/** What the agent offers for earlier sessions, from the `initialize` response (mvp-sessions
 *  design decision 2): `session/load`, `session/resume` and `session/list`. */
export interface SessionSupport {
  readonly load: boolean;
  readonly resume: boolean;
  readonly list: boolean;
  /** `sessionCapabilities.additionalDirectories`: the session requests take a list of directories. */
  readonly additionalDirectories: boolean;
}

export function sessionSupport(response: Pick<InitializeResponse, "agentCapabilities">): SessionSupport {
  const caps = response.agentCapabilities;
  return {
    load: caps?.loadSession === true,
    resume: caps?.sessionCapabilities?.resume != null,
    list: caps?.sessionCapabilities?.list != null,
    additionalDirectories: caps?.sessionCapabilities?.additionalDirectories != null,
  };
}

/** Sends `session/load` for `sessionId` with the session's `cwd` and an empty `mcpServers` list
 *  (spec tui-sessions "Load or resume by the agent's capabilities"). The agent replays the
 *  history as `session/update` notifications before it answers. */
export async function loadSession(
  conn: AgentConnection,
  agent: LaunchedAgent,
  command: readonly string[],
  sessionId: string,
  cwd: string,
  options: NewSessionOptions = {},
): Promise<LoadSessionResponse> {
  const request: LoadSessionRequest = { sessionId, cwd, mcpServers: [], ...directoriesField(options) };
  options.logger?.log({ event: "session_load_request", sessionId, cwd });
  const response = await raceWithExit(conn, agent, command, conn.loadSession(request), "session/load");
  options.logger?.log({ event: "session_load_response", sessionId });
  return response;
}

/** Sends `session/resume` for `sessionId` with the session's `cwd` and an empty `mcpServers`
 *  list; the agent replays nothing. */
export async function resumeSession(
  conn: AgentConnection,
  agent: LaunchedAgent,
  command: readonly string[],
  sessionId: string,
  cwd: string,
  options: NewSessionOptions = {},
): Promise<ResumeSessionResponse> {
  const request: ResumeSessionRequest = { sessionId, cwd, mcpServers: [], ...directoriesField(options) };
  options.logger?.log({ event: "session_resume_request", sessionId, cwd });
  const response = await raceWithExit(conn, agent, command, conn.resumeSession(request), "session/resume");
  options.logger?.log({ event: "session_resume_response", sessionId });
  return response;
}

/** Sends one `session/list` request (one page); `cwd` filters by directory when given. */
export async function listSessions(
  conn: AgentConnection,
  agent: LaunchedAgent,
  command: readonly string[],
  params: { readonly cwd?: string; readonly cursor?: string },
  options: NewSessionOptions & { readonly signal?: AbortSignal; readonly startup?: boolean } = {},
): Promise<ListSessionsResponse> {
  const request: ListSessionsRequest = { ...(params.cwd !== undefined ? { cwd: params.cwd } : {}), ...(params.cursor !== undefined ? { cursor: params.cursor } : {}) };
  options.logger?.log({ event: "session_list_request", cwd: params.cwd ?? null, cursor: params.cursor !== undefined });
  const response = await raceWithExit(conn, agent, command, conn.listSessions(request, options.signal), options.startup ? "session/list" : undefined);
  options.logger?.log({ event: "session_list_response", count: response.sessions.length, more: response.nextCursor != null });
  return response;
}
