// The Client implementation (design D2/D4, task 5.4): translates inbound ACP
// requests/notifications into acp-model `ModelEvent`s and forwards them to
// the controller's `dispatch`. Holds the one piece of state the wire
// protocol needs that the model does not: the pending `requestPermission`
// promises, each unresolved until `answerPermission` or
// `cancelOpenPermission` is called (spec "Permission requests" / "Turn
// cancellation"). mvp-sessions (task 6.1) adds the batched replay: while a
// `session/load` is in progress, updates are queued and reduced in slices
// (`beginReplay`, `endReplay`); history-replay-pacing (design D1, D2) takes
// each slice's turn from the frame pacer and notifies once per drawn frame.
//
// mvp-chrome-and-keys (tasks 5.4 and 5.5, design D6): every open permission
// request is kept, in the order received, keyed by its JSON-RPC request (spec
// tui-agent-session "Concurrent permission requests"); the card shows the
// head. A request the agent withdraws (`$/cancel_request`, which aborts the
// request's signal) leaves the queue, its handler rejects with the SDK's
// request-cancelled error (-32800), and `permission_withdrawn` is dispatched
// ("Permission withdrawal"). Cancelling the turn answers every open request
// `cancelled`.
import { RequestError } from "@agentclientprotocol/sdk";
import type {
  CompleteElicitationNotification,
  CreateElicitationRequest,
  CreateElicitationResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from "@agentclientprotocol/sdk";
import type { ModelEvent } from "acp-model";
import type { DebugLogger } from "../log.ts";
import type { Pace } from "../renderer/frame-pace.ts";
import type { AcpClient, PermissionRequestContext } from "./connection.ts";

/**
 * The elicitation card's side of `elicitation/create` and `elicitation/complete`
 * (src/card/elicitation.tsx). With one, the client answers those methods and `initialize`
 * advertises the capability (mvp-chrome-and-keys task 5.6); app/run.tsx always passes one.
 */
export interface ElicitationHandler {
  /** Shows the request and resolves with the user's answer (`accept`, `decline` or `cancel`). */
  create(request: CreateElicitationRequest): Promise<CreateElicitationResponse>;
  /** The agent reports that a URL elicitation finished. */
  complete(notification: CompleteElicitationNotification): void;
}

export interface ClientHandlerOptions {
  /** Feeds a ModelEvent to the session controller's reducer step. */
  dispatch(event: ModelEvent): void;
  /**
   * The batched replay (mvp-sessions design decision 10): reduces one event WITHOUT notifying
   * anyone. With `flush`, enables `beginReplay`; without them a replay is dispatched one event at
   * a time, as before.
   */
  apply?(event: ModelEvent): void;
  /** Notifies the session's listeners once, after a slice of `apply` calls. */
  flush?(): void;
  /** Work per slice of the drain loop, ms; default `REPLAY_SLICE_MS`. */
  replaySliceMs?: number;
  /** The least time between two notifications during a replay, ms; default `REPLAY_NOTIFY_MS`. */
  replayNotifyMs?: number;
  /**
   * Gives the drain loop its turns outside frames (renderer/frame-pace.ts; history-replay-pacing
   * design D1), and with them at most one notification per drawn frame (D2). Without one, a turn
   * is a `setTimeout(0)` and only `replayNotifyMs` spaces the notifications.
   */
  pace?: Pace;
  /** With a pace, the longest the store goes without a notification for want of a frame, ms;
   *  default `REPLAY_STALE_MS`. */
  replayStaleMs?: number;
  logger?: DebugLogger;
  /** Clock, overridable in tests; defaults to `Date.now`. */
  now?(): number;
  /** Elicitation (the docked elicitation card). */
  elicitation?: ElicitationHandler;
}

interface PendingPermission {
  /** The JSON-RPC request id, or a local number when the connection gives none. */
  readonly key: string | number;
  readonly toolCallId: string;
  readonly options: RequestPermissionRequest["options"];
  readonly resolve: (response: RequestPermissionResponse) => void;
  /** Stops watching the request's abort signal. */
  readonly release: () => void;
}

export interface ClientHandler {
  readonly client: AcpClient;
  /** Answers the head of the open permission requests (the one the card shows) with `optionId`.
   *  Returns false if there is no open request, or the id does not match one of its options (a
   *  no-op either way). */
  answerPermission(optionId: string): boolean;
  /** Answers every open permission request with outcome `cancelled`, in order. Returns false if
   *  there was nothing open. */
  cancelOpenPermission(): boolean;
  /** The toolCallId of the head of the open permission requests (the one the card shows), or null. */
  openPermissionToolCallId(): string | null;
  /** How many permission requests are open. */
  openPermissionCount(): number;
  /**
   * Starts queuing `session/update` notifications: a `session/load` is in progress (mvp-sessions
   * design decision 10). Each one is queued and the handler returns at once; a drain loop reduces
   * the queue in slices of about `replaySliceMs` of work, yields to the event loop (and the
   * renderer) between slices, and notifies once for a slice at most every `replayNotifyMs`.
   */
  beginReplay(): void;
  /**
   * Queues `event` (the load's `session_opened`) behind every queued update, so the order is
   * kept, and ends the replay; resolves once it has been reduced and notified. Updates that
   * arrive while the queue still drains are queued behind it.
   */
  endReplay(event: ModelEvent): Promise<void>;
  /** Drops whatever is queued and ends the replay (the load failed); nothing more is reduced. */
  abortReplay(): void;
  /** True from `beginReplay` until `endReplay` (the load is in progress). */
  replaying(): boolean;
}

/** About 8 ms of reducing per slice of the drain loop (design decision 10). */
export const REPLAY_SLICE_MS = 8;

/** The store is notified (and a frame drawn) at most this often during a replay (task 6.3). */
export const REPLAY_NOTIFY_MS = 40;

/** With a pace, what has been reduced reaches the store after this long even when no frame has
 *  been drawn since the last notification (a renderer that is not drawing), ms. */
export const REPLAY_STALE_MS = 250;

/** With a pace, how soon an idle drain looks again for the frame that shows its last
 *  notification, before notifying what it has reduced since, ms. */
const REPLAY_RETRY_MS = 4;

/** A discriminant from the wire, logged only if it looks like one (never free text). */
function tag(value: unknown): string {
  return typeof value === "string" && /^[a-z_]{1,32}$/.test(value) ? value : "other";
}

/**
 * The types of a tool call's content items, never their text: `content` items carry the inner
 * block type (`text`, `image`, ...), `diff` and `terminal` items stand alone. Answers whether an
 * agent sends `terminal` content (design 5.1; S7).
 */
export function toolContentTypes(content: unknown): { type: string; block?: string }[] | undefined {
  if (!Array.isArray(content)) return undefined;
  return content.map((item: { type?: unknown; content?: { type?: unknown } } | null) => {
    const type = tag(item?.type);
    return type === "content" ? { type, block: tag(item?.content?.type) } : { type };
  });
}

export function createClientHandler(options: ClientHandlerOptions): ClientHandler {
  const now = options.now ?? Date.now;
  // The open permission requests, in the order received; the head is the one the card shows.
  let pending: PendingPermission[] = [];
  let nextKey = 1;
  const replay = createReplayQueue(options);

  /** Takes `entry` out of the queue; false when it was no longer there. */
  const take = (entry: PendingPermission): boolean => {
    if (!pending.includes(entry)) return false;
    pending = pending.filter((p) => p !== entry);
    entry.release();
    return true;
  };

  const client: AcpClient = {
    async requestPermission(request: RequestPermissionRequest, context?: PermissionRequestContext): Promise<RequestPermissionResponse> {
      const toolCallId = request.toolCall.toolCallId;
      options.logger?.log({ event: "permission_opened", toolCallId, optionCount: request.options.length, open: pending.length + 1 });
      const permissionContent = toolContentTypes(request.toolCall.content);
      if (permissionContent) options.logger?.log({ event: "tool_content", source: "permission", toolCallId, content: permissionContent });
      return new Promise<RequestPermissionResponse>((resolve, reject) => {
        const signal = context?.signal;
        const onAbort = () => {
          // The agent withdrew the request (`$/cancel_request`): answer -32800 and record it.
          if (!take(entry)) return;
          options.logger?.log({ event: "permission_withdrawn", toolCallId });
          options.dispatch({ type: "permission_withdrawn", toolCallId, at: now() });
          reject(RequestError.requestCancelled());
        };
        const entry: PendingPermission = {
          key: context?.requestId ?? `local-${nextKey++}`,
          toolCallId,
          options: request.options,
          resolve,
          release: () => signal?.removeEventListener("abort", onAbort),
        };
        pending = [...pending, entry];
        options.dispatch({ type: "permission_opened", toolCallId, request, at: now() });
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort, { once: true });
      });
    },

    async sessionUpdate(params: SessionNotification): Promise<void> {
      options.logger?.log({ event: "session_update", sessionUpdate: params.update.sessionUpdate });
      const update = params.update;
      if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
        const content = toolContentTypes(update.content);
        if (content) options.logger?.log({ event: "tool_content", source: update.sessionUpdate, toolCallId: update.toolCallId, content });
      }
      const event: ModelEvent = { type: "session_update", update, at: now() };
      // While a load replays (or its queue still drains), queued in order and reduced later.
      if (!replay.offer(event)) options.dispatch(event);
    },
  };

  // Without a handler the SDK answers `elicitation/create` with "method not found". While a
  // request is open the session is `requires_action` (task 5.7): `elicitation_opened` and
  // `elicitation_closed` name it by a local key.
  const elicitation = options.elicitation;
  let nextElicitation = 1;
  if (elicitation) {
    client.createElicitation = async (request) => {
      const elicitationId = `elicitation-${nextElicitation++}`;
      options.logger?.log({ event: "elicitation_opened", mode: tag(request.mode) });
      options.dispatch({ type: "elicitation_opened", elicitationId, at: now() });
      try {
        const response = await elicitation.create(request);
        options.logger?.log({ event: "elicitation_answered", mode: tag(request.mode), action: tag(response.action) });
        return response;
      } finally {
        options.dispatch({ type: "elicitation_closed", elicitationId, at: now() });
      }
    };
    client.completeElicitation = async (notification) => {
      options.logger?.log({ event: "elicitation_completed" });
      elicitation.complete(notification);
    };
  }

  return {
    client,

    answerPermission(optionId: string): boolean {
      const head = pending[0];
      if (!head) return false;
      const option = head.options.find((candidate) => candidate.optionId === optionId);
      if (!option) return false;
      const { toolCallId, resolve } = head;
      take(head);
      resolve({ outcome: { outcome: "selected", optionId } });
      options.logger?.log({ event: "permission_answered", toolCallId, optionKind: option.kind });
      options.dispatch({
        type: "permission_answered",
        toolCallId,
        optionId,
        optionKind: option.kind,
        at: now(),
      });
      return true;
    },

    cancelOpenPermission(): boolean {
      if (pending.length === 0) return false;
      for (const entry of pending) {
        const { toolCallId, resolve } = entry;
        take(entry);
        resolve({ outcome: { outcome: "cancelled" } });
        options.logger?.log({ event: "permission_cancelled", toolCallId });
        options.dispatch({ type: "permission_cancelled", toolCallId, at: now() });
      }
      return true;
    },

    openPermissionToolCallId(): string | null {
      return pending[0]?.toolCallId ?? null;
    },

    openPermissionCount: () => pending.length,

    beginReplay: () => replay.begin(),
    endReplay: (event) => replay.end(event),
    abortReplay: () => replay.abort(),
    replaying: () => replay.active(),
  };
}

interface ReplayQueue {
  begin(): void;
  /** Queues `event` when a replay is on or the queue still drains; false to dispatch it now. */
  offer(event: ModelEvent): boolean;
  end(event: ModelEvent): Promise<void>;
  abort(): void;
  active(): boolean;
}


/**
 * The batched replay behind `beginReplay` (mvp-sessions design decision 10). The queue is an
 * array with a read index, so taking an event is O(1). The drain loop runs from a timer, never
 * from the notification handler, so the SDK's read loop is never held up by the reducer: it
 * reduces for about `replaySliceMs`, then yields, so keys and frames get a turn between slices.
 * Each slice's turn comes from the pace when there is one (outside frames, and after the next
 * frame once the pace's budget is spent; history-replay-pacing design D1), else from
 * `setTimeout(0)`.
 *
 * The store is notified at the end of a slice only when `replayNotifyMs` have passed since the
 * last notification, or the replay has ended, or (once the load has answered) the queue is
 * empty; a slice that does not notify leaves a deadline so the store is never left stale. Each
 * notification is one Solid batch and one frame, and with the windowed list a frame that mounts a
 * new tail of 40 items costs about 16 ms: notifying after every 8 ms slice spent two thirds of
 * the load drawing (task 6.3). With a pace, a notification also waits until a frame has been
 * drawn since the last one (design D2: on OpenTUI 0.6 two notifications for one frame remounted
 * the window twice), or `REPLAY_STALE_MS` has passed.
 */
function createReplayQueue(options: ClientHandlerOptions): ReplayQueue {
  const { apply, flush } = options;
  const sliceMs = options.replaySliceMs ?? REPLAY_SLICE_MS;
  const notifyMs = options.replayNotifyMs ?? REPLAY_NOTIFY_MS;
  const staleMs = options.replayStaleMs ?? REPLAY_STALE_MS;
  let queue: (ModelEvent | undefined)[] = [];
  let head = 0;
  let replaying = false;
  // A drain is scheduled: a deadline timer, or a turn asked for (`cancel` drops either).
  let scheduled = false;
  let deadline: ReturnType<typeof setTimeout> | null = null;
  // Bumped by abort and by `cancel`, so a drain scheduled before it does nothing.
  let generation = 0;
  const pace = options.pace;
  const turn = (): Promise<void> => (pace ? pace.turn() : new Promise((resolve) => setTimeout(resolve, 0)));
  // The pace's last ended frame when the store was last notified.
  let notifiedFrame: number | undefined;
  let ending: { readonly event: ModelEvent; readonly resolve: () => void } | null = null;
  // Reduced but not yet notified; and when the store was last notified.
  let pending = false;
  let notifiedAt = 0;
  let stats = { updates: 0, slices: 0, notifications: 0, startedAt: 0, reduceMs: 0, notifyMs: 0 };

  const draining = (): boolean => head < queue.length;

  /** Drains after `delay` ms and a turn. */
  function schedule(delay = 0): void {
    if (scheduled) return;
    scheduled = true;
    const at = generation;
    const run = (): void => {
      void turn().then(() => {
        if (at !== generation) return;
        scheduled = false;
        drain();
      });
    };
    if (delay <= 0) return run();
    deadline = setTimeout(() => {
      deadline = null;
      if (at === generation) run();
    }, delay);
  }

  /** Drops the scheduled drain, if any. */
  function cancel(): void {
    if (deadline !== null) clearTimeout(deadline);
    deadline = null;
    if (scheduled) generation += 1;
    scheduled = false;
  }

  /** Without a pace always; with one, once a frame has been drawn since the last notification. */
  function drawnSinceNotified(): boolean {
    const frames = pace?.frames();
    return frames === undefined || frames !== notifiedFrame;
  }

  function notify(): void {
    const before = performance.now();
    // One notification for everything reduced since the last: the store applies it in one Solid
    // batch.
    flush!();
    notifiedAt = performance.now();
    notifiedFrame = pace?.frames();
    stats.notifications += 1;
    stats.notifyMs += notifiedAt - before;
    pending = false;
  }

  function drain(): void {
    const start = performance.now();
    let ended: (() => void) | null = null;
    while (head < queue.length) {
      const event = queue[head]!;
      queue[head] = undefined;
      head += 1;
      apply!(event);
      pending = true;
      if (ending && event === ending.event) {
        ended = ending.resolve;
        ending = null;
      }
      if (performance.now() - start >= sliceMs) break;
    }
    const now = performance.now();
    if (pending) {
      stats.slices += 1;
      stats.reduceMs += now - start;
    }
    const empty = !draining();
    const since = now - notifiedAt;
    const due = since >= notifyMs && (drawnSinceNotified() || since >= staleMs);
    if (pending && (ended !== null || due || (empty && !replaying))) notify();
    if (!empty) schedule();
    else {
      queue = [];
      head = 0;
      // More updates may follow; meanwhile the store sees what has been reduced, in time (with a
      // pace, once the frame showing the last notification has been drawn).
      if (pending) schedule(Math.max(drawnSinceNotified() ? 0 : REPLAY_RETRY_MS, notifyMs - since));
    }
    if (ended) {
      options.logger?.log({
        event: "replay_drained",
        updates: stats.updates,
        slices: stats.slices,
        notifications: stats.notifications,
        ms: Math.round(performance.now() - stats.startedAt),
        reduceMs: Math.round(stats.reduceMs),
        notifyMs: Math.round(stats.notifyMs),
      });
      ended();
    }
  }

  return {
    begin() {
      if (!apply || !flush) return;
      replaying = true;
      pending = false;
      notifiedAt = 0;
      stats = { updates: 0, slices: 0, notifications: 0, startedAt: performance.now(), reduceMs: 0, notifyMs: 0 };
    },
    offer(event) {
      if (!replaying && !draining() && !pending) return false;
      if (event.type === "session_update") stats.updates += 1;
      const waiting = !draining();
      queue.push(event);
      // A deadline drain may be waiting; this one should run at once.
      if (deadline !== null && waiting) cancel();
      schedule();
      return true;
    },
    end(event) {
      if (!replaying && !draining() && !pending) {
        options.dispatch(event);
        return Promise.resolve();
      }
      replaying = false;
      return new Promise<void>((resolve) => {
        ending = { event, resolve };
        queue.push(event);
        if (deadline !== null) cancel();
        schedule();
      });
    },
    active: () => replaying,
    abort() {
      cancel();
      generation += 1;
      replaying = false;
      pending = false;
      queue = [];
      head = 0;
      const pendingEnd = ending;
      ending = null;
      pendingEnd?.resolve();
    },
  };
}
