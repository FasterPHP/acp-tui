// The fake-agent Agent implementation: a thin dispatcher that logs every
// received method, hands prompt() off to the selected scenario, and tracks
// one AbortController per running turn (for `session/cancel`). Since
// mvp-sessions it also keeps the session store: sessions made by session/new
// and their turns are recorded, and session/load, session/resume and
// session/list (each behind its own capability switch) answer from it.
import {
  RequestError,
  type Agent,
  type AgentSideConnection,
  type CancelNotification,
  type InitializeRequest,
  type InitializeResponse,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type LoadSessionRequest,
  type LoadSessionResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
  type ResumeSessionRequest,
  type ResumeSessionResponse,
  type SessionUpdate,
  type SetSessionConfigOptionRequest,
  type SetSessionConfigOptionResponse,
  type SetSessionModeRequest,
  type SetSessionModeResponse,
} from "@agentclientprotocol/sdk";
import type { ScenarioLogger } from "./logger.ts";
import { redactPromptParams } from "./redact.ts";
import { createScenarioContext, type Scenario } from "./scenario.ts";
import { SessionStore, type StoredSession } from "./sessions.ts";

/**
 * The pause after each replayed update of a `session/load`, in milliseconds,
 * multiplied by `--delay-scale`: 2 ms at the default scale (a 1000-item history
 * takes seconds), nothing at scale 0 (the test suite, and the 5000-item load
 * benchmark, which must pass `--delay-scale 0`).
 */
export const LOAD_UPDATE_DELAY_MS = 2;

/** JSON-RPC error code for `Resource not found`, as `claude-agent-acp` answers an unknown session. */
const RESOURCE_NOT_FOUND = -32002;

export interface FakeAgentSessionOptions {
  /** `--load`: advertise `loadSession` and answer `session/load`. */
  readonly load: boolean;
  /** `--resume`: advertise `sessionCapabilities.resume` and answer `session/resume`. */
  readonly resume: boolean;
  /** `--list`: advertise `sessionCapabilities.list` and answer `session/list`. */
  readonly list: boolean;
  /** `--page-size`: sessions per `session/list` page; all in one page when absent. */
  readonly pageSize?: number;
  /** `--load-error`: session IDs `session/load` and `session/resume` refuse. */
  readonly loadErrors: ReadonlySet<string>;
  /** `--title-update`: a `session_info_update` with a title after a session's first turn. */
  readonly titleUpdate: boolean;
  /** `--history`: the scenario's generated history goes to every new session before any prompt is answered. */
  readonly history?: boolean;
  /** `--list-delay`: milliseconds `session/list` waits before answering (absolute, not scaled). */
  readonly listDelayMs?: number;
  readonly store: SessionStore;
}

export interface FakeAgentOptions {
  readonly scenario: Scenario;
  readonly logger: ScenarioLogger;
  readonly delayScale: number;
  readonly items: number;
  /** The `--chunk` knob: characters per streamed chunk (`markdown-gallery`). */
  readonly chunk?: number;
  /** The `--long-gap` knob: `slow-turn` waits 45 s between its tool calls instead of 3 s. */
  readonly longGap?: boolean;
  /** The `--tools` knob: how many calls `fast-tools` sends (default 6). */
  readonly tools?: number;
  /** The `--start-delay` knob: milliseconds `initialize` waits before answering (absolute, not scaled). */
  readonly startDelayMs?: number;
  /** Everything off, an empty in-memory store: the behaviour before mvp-sessions. */
  readonly sessions?: FakeAgentSessionOptions;
}

interface TurnState {
  readonly controller: AbortController;
}

let sessionCounter = 0;

/**
 * The session updates the agent logs when it sends them (`session/update/sent`, with the session
 * ID and the update): the ones the client's chrome follows. Every other update stays out of the
 * log, which would otherwise grow by one line per streamed chunk.
 */
const LOGGED_UPDATES: ReadonlySet<string> = new Set([
  "available_commands_update",
  "config_option_update",
  "current_mode_update",
]);

function promptText(request: PromptRequest): string {
  return request.prompt.map((block) => (block.type === "text" ? block.text : "")).join("");
}

export function createFakeAgent(
  conn: AgentSideConnection,
  options: FakeAgentOptions,
): Agent {
  const { scenario, logger, delayScale, items, chunk, longGap, tools, startDelayMs = 0 } = options;
  const sessions: FakeAgentSessionOptions = options.sessions ?? {
    load: false,
    resume: false,
    list: false,
    loadErrors: new Set(),
    titleUpdate: false,
    store: new SessionStore(undefined, false),
  };
  const { store } = sessions;
  const turns = new Map<string, TurnState>();
  /** Sessions that have had their title update in this process (`--title-update`). */
  const titled = new Set<string>();
  /** The `--history` send of each new session; its first prompt waits for it. */
  const historySends = new Map<string, Promise<void>>();
  /** The scenario's `sessionStarted` send of each new session; its first prompt waits for it too. */
  const startedSends = new Map<string, Promise<void>>();

  /** Sends one update for a session, logging the chrome ones (`LOGGED_UPDATES`). */
  async function sendUpdate(sessionId: string, update: SessionUpdate): Promise<void> {
    if (LOGGED_UPDATES.has(update.sessionUpdate)) {
      logger.record("session/update/sent", { sessionId, update });
    }
    await conn.sessionUpdate({ sessionId, update });
  }

  /** The stored session `session/load` or `session/resume` opens, or Resource not found. */
  function openable(sessionId: string): StoredSession {
    const session = store.get(sessionId);
    if (!session || sessions.loadErrors.has(sessionId)) {
      throw new RequestError(RESOURCE_NOT_FOUND, "Resource not found", { sessionId });
    }
    return session;
  }

  /** What `session/new` returns besides the ID (config options, modes), for a session being opened. */
  function openedResponse(request: LoadSessionRequest | ResumeSessionRequest): LoadSessionResponse {
    const { sessionId, cwd } = request;
    const overrides = scenario.newSession?.({ cwd, mcpServers: request.mcpServers ?? [] }, sessionId) ?? {};
    return {
      ...(overrides.configOptions === undefined ? {} : { configOptions: overrides.configOptions }),
      ...(overrides.modes === undefined ? {} : { modes: overrides.modes }),
      // `models` is the older unstable state, which the SDK's types no longer carry.
      ...("models" in overrides ? { models: (overrides as { models?: unknown }).models } : {}),
    } as LoadSessionResponse;
  }

  /** Replays a session's history as `session/update` notifications, paced by `--delay-scale`. Returns the count. */
  async function replay(session: StoredSession): Promise<number> {
    let count = 0;
    const pause = LOAD_UPDATE_DELAY_MS * delayScale;
    const send = async (update: SessionUpdate): Promise<void> => {
      await conn.sessionUpdate({ sessionId: session.sessionId, update });
      count += 1;
      if (pause > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, pause));
      }
    };
    if (session.generated) {
      await session.generated.replay(send);
    } else {
      for (const turn of session.turns) {
        for (const update of turn) {
          await send(update);
        }
      }
    }
    return count;
  }

  function turnCount(session: StoredSession): number {
    return session.generated?.turnCount ?? session.turns.length;
  }

  return {
    async initialize(request: InitializeRequest): Promise<InitializeResponse> {
      logger.record("initialize", request);
      if (startDelayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, startDelayMs));
      }
      const overrides = scenario.initialize?.(request) ?? {};
      const sessionCapabilities = {
        ...(sessions.list ? { list: {} } : {}),
        ...(sessions.resume ? { resume: {} } : {}),
      };
      return {
        protocolVersion: 1,
        agentInfo: { name: "fake-agent", version: "0.0.0" },
        ...overrides,
        agentCapabilities: {
          loadSession: sessions.load,
          promptCapabilities: { image: false, audio: false, embeddedContext: true },
          ...(Object.keys(sessionCapabilities).length > 0 ? { sessionCapabilities } : {}),
          ...overrides.agentCapabilities,
        },
      };
    },

    async newSession(request: NewSessionRequest): Promise<NewSessionResponse> {
      logger.record("session/new", request);
      let sessionId: string;
      do {
        sessionCounter += 1;
        sessionId = `fake-session-${sessionCounter}`;
      } while (store.has(sessionId));
      const history = sessions.history ? scenario.history?.(items) : undefined;
      store.add({
        sessionId,
        cwd: request.cwd,
        updatedAt: new Date().toISOString(),
        turns: [],
        ...(history ? { generated: history } : {}),
      });
      store.save();
      if (history) {
        // The session already holds its history, so the scenario counts it as answered turns
        // (the first prompt gets the short reply). It is sent once the response to
        // session/new has gone out, which is when the client learns the session ID.
        scenario.sessionLoaded?.(sessionId, history.turnCount);
        historySends.set(
          sessionId,
          (async () => {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            await history.replay((update) => conn.sessionUpdate({ sessionId, update }));
            logger.record("session/history/sent", { sessionId });
          })().catch((error: unknown) => {
            logger.record("session/history/error", { sessionId, message: String(error) });
          }),
        );
      }
      const overrides = scenario.newSession?.(request, sessionId) ?? {};
      if (scenario.sessionStarted) {
        const started = scenario.sessionStarted;
        startedSends.set(
          sessionId,
          (async () => {
            // Once the response to session/new has gone out, as a real agent announces its commands.
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            await started({ sessionId, send: (update) => sendUpdate(sessionId, update) });
          })().catch((error: unknown) => {
            logger.record("session/started/error", { sessionId, message: String(error) });
          }),
        );
      }
      return { sessionId, ...overrides };
    },

    async loadSession(request: LoadSessionRequest): Promise<LoadSessionResponse> {
      logger.record("session/load", request);
      if (!sessions.load) {
        throw RequestError.methodNotFound("session/load");
      }
      const session = openable(request.sessionId);
      const updates = await replay(session);
      scenario.sessionLoaded?.(session.sessionId, turnCount(session));
      logger.record("session/load/response", { sessionId: session.sessionId, updates });
      return openedResponse(request);
    },

    async resumeSession(request: ResumeSessionRequest): Promise<ResumeSessionResponse> {
      logger.record("session/resume", request);
      if (!sessions.resume) {
        throw RequestError.methodNotFound("session/resume");
      }
      const session = openable(request.sessionId);
      scenario.sessionLoaded?.(session.sessionId, turnCount(session));
      logger.record("session/resume/response", { sessionId: session.sessionId });
      return openedResponse(request);
    },

    async listSessions(request: ListSessionsRequest): Promise<ListSessionsResponse> {
      logger.record("session/list", request);
      if (!sessions.list) {
        throw RequestError.methodNotFound("session/list");
      }
      if (sessions.listDelayMs !== undefined && sessions.listDelayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, sessions.listDelayMs));
      }
      return store.list(request.cwd, request.cursor, sessions.pageSize);
    },

    async setSessionConfigOption(
      request: SetSessionConfigOptionRequest,
    ): Promise<SetSessionConfigOptionResponse> {
      logger.record("session/set_config_option", request);
      if (!scenario.setConfigOption) {
        throw RequestError.methodNotFound("session/set_config_option");
      }
      return scenario.setConfigOption(request);
    },

    async setSessionMode(request: SetSessionModeRequest): Promise<SetSessionModeResponse> {
      logger.record("session/set_mode", request);
      if (!scenario.setMode) {
        throw RequestError.methodNotFound("session/set_mode");
      }
      scenario.setMode(request);
      return {};
    },

    /**
     * Requests the SDK does not type: `session/set_model` (the older unstable model state, which
     * SDK 1.5.0 dropped) reaches the agent here by its raw method name. Anything else is method
     * not found, as it is without this handler.
     */
    async extMethod(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
      if (method !== "session/set_model") {
        throw RequestError.methodNotFound(method);
      }
      logger.record("session/set_model", params);
      if (!scenario.setModel) {
        throw RequestError.methodNotFound(method);
      }
      if (typeof params["sessionId"] !== "string" || typeof params["modelId"] !== "string") {
        throw RequestError.invalidParams(params, "sessionId and modelId are required");
      }
      scenario.setModel({ sessionId: params["sessionId"], modelId: params["modelId"] });
      // Auggie answers with no body, so the JSON-RPC result is null.
      return null as unknown as Record<string, unknown>;
    },

    async prompt(request: PromptRequest): Promise<PromptResponse> {
      logger.record("session/prompt", redactPromptParams(request));
      await historySends.get(request.sessionId);
      await startedSends.get(request.sessionId);
      const controller = new AbortController();
      turns.set(request.sessionId, { controller });
      const base = createScenarioContext(
        conn,
        request.sessionId,
        delayScale,
        controller.signal,
        items,
        chunk,
        request.prompt,
        longGap,
        tools,
      );
      // What the turn sends is kept (with the prompt as its first update), so
      // the session can be loaded again later in this process or, with
      // --persist, by another one.
      const recorded: SessionUpdate[] = [];
      const text = promptText(request);
      if (text !== "") {
        recorded.push({ sessionUpdate: "user_message_chunk", content: { type: "text", text } });
      }
      // The client's answers to permission and elicitation requests are logged
      // too, so acp-tui's tests can assert the outcome it sent (task 8.2).
      const ctx = {
        ...base,
        log(method: string, params: unknown) {
          logger.record(method, params);
        },
        async send(update: SessionUpdate) {
          recorded.push(update);
          if (LOGGED_UPDATES.has(update.sessionUpdate)) {
            logger.record("session/update/sent", { sessionId: request.sessionId, update });
          }
          await base.send(update);
        },
        async createElicitation(elicitation: Parameters<typeof base.createElicitation>[0]) {
          const response = await base.createElicitation(elicitation);
          logger.record("elicitation/create/response", response);
          return response;
        },
        async requestPermission(
          permission: Parameters<typeof base.requestPermission>[0],
          permissionOptions?: Parameters<typeof base.requestPermission>[1],
        ) {
          try {
            const response = await base.requestPermission(permission, permissionOptions);
            logger.record("session/request_permission/response", response);
            return response;
          } catch (error) {
            // The client's JSON-RPC error answer, for example -32800 after the agent withdrew the request.
            const code = (error as { code?: unknown }).code;
            logger.record("session/request_permission/error", {
              code: typeof code === "number" ? code : null,
              message: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        },
      };
      const stored = store.get(request.sessionId);
      let response: PromptResponse;
      try {
        response = await scenario.prompt(ctx);
      } finally {
        turns.delete(request.sessionId);
        if (stored && recorded.length > 0) {
          stored.turns.push(recorded);
          stored.updatedAt = new Date().toISOString();
          store.save();
        }
      }
      if (stored && sessions.titleUpdate && !titled.has(request.sessionId)) {
        titled.add(request.sessionId);
        stored.title ??= `Fake title for ${request.sessionId}`;
        stored.updatedAt = new Date().toISOString();
        store.save();
        await conn.sessionUpdate({
          sessionId: request.sessionId,
          update: { sessionUpdate: "session_info_update", title: stored.title, updatedAt: stored.updatedAt },
        });
      }
      return response;
    },

    async cancel(request: CancelNotification): Promise<void> {
      logger.record("session/cancel", request);
      turns.get(request.sessionId)?.controller.abort();
    },

    async authenticate() {
      // fake-agent never advertises authMethods, so a real client never
      // needs to call this; it exists only to satisfy the Agent interface.
      throw RequestError.methodNotFound("authenticate");
    },

    async closeSession(request) {
      logger.record("session/close", request);
    },
  };
}
