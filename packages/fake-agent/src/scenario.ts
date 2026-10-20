// Scenario interface (design D12): scenarios are sequential TypeScript
// scripts driven through a small context object, so timing is controlled by
// the script itself rather than by network or model latency, and tests stay
// deterministic.
import type {
  AgentSideConnection,
  ContentBlock,
  CreateElicitationRequest,
  CreateElicitationResponse,
  InitializeRequest,
  InitializeResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionUpdate,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
  SetSessionModeRequest,
} from "@agentclientprotocol/sdk";
import type { GeneratedHistory, StoredSession } from "./sessions.ts";

/**
 * The parameters of `session/set_model`, the older unstable method that changes a session's
 * model. `@agentclientprotocol/sdk` 1.5.0 no longer types it, so fake-agent defines them.
 */
export interface SetSessionModelRequest {
  readonly sessionId: string;
  readonly modelId: string;
}

/** Everything a scenario's prompt() needs to drive one turn. */
export interface ScenarioContext {
  readonly sessionId: string;
  /** Sends one session/update notification for this session. */
  send(update: SessionUpdate): Promise<void>;
  /**
   * Sends session/request_permission and waits for the client's answer.
   * Aborting `options.signal` sends `$/cancel_request` for it (the agent
   * withdraws the request); the client then answers with the request-cancelled
   * error (-32800), which rejects this promise.
   */
  requestPermission(
    request: Omit<RequestPermissionRequest, "sessionId">,
    options?: { readonly signal?: AbortSignal },
  ): Promise<RequestPermissionResponse>;
  /**
   * Sends elicitation/create for this session (the caller supplies
   * `sessionId: ctx.sessionId`) and waits for the client's answer. Rejects if
   * the client does not implement elicitation.
   */
  createElicitation(request: CreateElicitationRequest): Promise<CreateElicitationResponse>;
  /** Sends elicitation/complete for a URL-mode elicitation. */
  completeElicitation(elicitationId: string): Promise<void>;
  /** The content blocks of the prompt this turn answers. */
  readonly prompt: readonly ContentBlock[];
  /** Appends a scenario-defined entry to the `--log` file (nothing without `--log`). */
  log(method: string, params: unknown): void;
  /** The `--long-gap` knob; only `slow-turn` reads it. */
  readonly longGap: boolean;
  /** The `--items` knob (default 200); only `long-session` reads it. */
  readonly items: number;
  /** The `--chunk` knob: characters per streamed chunk; `markdown-gallery` and `fence-first` read it. */
  readonly chunk: number | undefined;
  /**
   * Sleeps ms * delayScale (the --delay-scale knob), returning early without
   * error if session/cancel arrives while asleep.
   */
  sleep(ms: number): Promise<void>;
  /** Aborts when session/cancel arrives for this turn. */
  readonly cancelled: AbortSignal;
}

/** A scriptable ACP agent scenario (design D12). */
export interface Scenario {
  readonly name: string;
  /** Overrides fields of the default initialize response. */
  initialize?(request: InitializeRequest): Partial<InitializeResponse> | void;
  /** Overrides fields of the default session/new response. */
  newSession?(request: NewSessionRequest, sessionId: string): Partial<NewSessionResponse> | void;
  /** Handles session/set_config_option; without it the method is not found. */
  setConfigOption?(request: SetSessionConfigOptionRequest): SetSessionConfigOptionResponse;
  /** Handles session/set_mode (legacy modes); without it the method is not found. */
  setMode?(request: SetSessionModeRequest): void;
  /**
   * Handles session/set_model (the older model state); without it the method is not found.
   * Throws a `RequestError` to refuse; the agent answers `null`.
   */
  setModel?(request: SetSessionModelRequest): void;
  /**
   * Called once the response to `session/new` has gone out, as a real agent
   * announces its commands: `send` delivers a session update for the new
   * session. The first prompt waits until it returns.
   */
  sessionStarted?(session: { readonly sessionId: string; send(update: SessionUpdate): Promise<void> }): Promise<void>;
  /**
   * Sessions the scenario brings with it (for `session/load`, `session/resume`
   * and `session/list`); `items` is the `--items` value. A fixture session of
   * the same ID replaces one. Never written back by `--persist`.
   */
  builtinSessions?(items: number): readonly StoredSession[];
  /**
   * The history the scenario generates, sent to every new session right after
   * `session/new` and before any prompt is answered when `--history` is given
   * (`items` is the `--items` value). The session then holds it, so
   * `session/load` replays it too, and the first prompt gets an ordinary reply.
   */
  history?(items: number): GeneratedHistory;
  /**
   * Called after a stored session has been loaded or resumed, with the number
   * of prompt turns it already holds, so a scenario that counts turns carries
   * on from there instead of starting again.
   */
  sessionLoaded?(sessionId: string, turns: number): void;
  /** Drives one prompt turn; resolves with the turn's stop reason. */
  prompt(ctx: ScenarioContext): Promise<PromptResponse>;
}

export function createScenarioContext(
  conn: AgentSideConnection,
  sessionId: string,
  delayScale: number,
  cancelled: AbortSignal,
  items: number,
  chunk?: number,
  prompt: readonly ContentBlock[] = [],
  longGap = false,
): ScenarioContext {
  return {
    sessionId,
    cancelled,
    items,
    chunk,
    prompt,
    longGap,
    log() {},
    async send(update) {
      await conn.sessionUpdate({ sessionId, update });
    },
    async requestPermission(request, options) {
      if (!options?.signal) {
        return conn.requestPermission({ sessionId, ...request });
      }
      // The legacy AgentSideConnection.requestPermission takes no options, so a withdrawable
      // request goes through the connection it wraps (private in the typings only).
      const { connection } = conn as unknown as {
        connection: {
          sendRequest(
            method: string,
            params: unknown,
            mapResponse: undefined,
            options: { cancellationSignal: AbortSignal },
          ): Promise<RequestPermissionResponse>;
        };
      };
      return connection.sendRequest("session/request_permission", { sessionId, ...request }, undefined, {
        cancellationSignal: options.signal,
      });
    },
    async createElicitation(request) {
      return conn.createElicitation(request);
    },
    async completeElicitation(elicitationId) {
      await conn.completeElicitation({ elicitationId });
    },
    async sleep(ms) {
      const scaled = ms * delayScale;
      if (scaled <= 0 || cancelled.aborted) {
        return;
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, scaled);
        cancelled.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    },
  };
}
