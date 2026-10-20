// Frame pacing for background work (history-replay-pacing design D1): while a `session/load`
// replays, the drain loop (agent/client-handler.ts) and the agent read loop (agent/connection.ts
// `pacedStream`) ask for a turn here before each slice, so that no slice runs inside a frame.
//
// OpenTUI 0.6 draws a frame across several event-loop turns: it yields (`setImmediate`) after
// every frame callback, may yield while the native scene paints, and awaits the frame's
// presentation. A timer that falls due in one of those turns runs inside the frame, and the frame
// lasts as long as the work it let in (on 0.5.12 a frame ran start to finish, and work ran only
// between frames). So a turn is given only while no frame is in progress, and once about
// `budgetMs` of work has been done since the last frame ended, only after the next frame (which
// the turn requests). Without a renderer (tests, or before the app is up) a turn is one
// `setTimeout(0)`, the turn the drain and the read loop took before.
//
// Public renderer API only: `getSchedulerState().isRendering` (from a frame's start to its end),
// `frameId` (counts frames started), `requestRender()`, and the `frame` event, which a frame that
// drew emits near its end, in the same synchronous run in which OpenTUI clears its rendering flag.
import { CliRenderEvents, type CliRenderer } from "@opentui/core";

/** What paced work needs: one turn of the event loop outside a frame. */
export interface Pace {
  /** Resolves in a later macrotask, when no frame is in progress (and, past the budget, after
   *  the next frame). */
  turn(): Promise<void>;
  /** The id of the last frame that has ended (it only grows); undefined without a renderer. */
  frames(): number | undefined;
}

export interface FramePace extends Pace {
  /** Paces turns around `renderer`'s frames until `detach` is called (also the returned
   *  function) or the renderer is destroyed. */
  attach(renderer: FramePaceRenderer): () => void;
  /** Back to timer turns; a turn waiting for a frame is given at once. */
  detach(): void;
}

/** The part of the renderer the pacer reads. */
export type FramePaceRenderer = Pick<CliRenderer, "getSchedulerState" | "frameId" | "requestRender" | "on" | "off" | "isDestroyed">;

export interface FramePaceOptions {
  /** Work allowed after a frame before a turn waits for the next one, ms; default
   *  `PACE_BUDGET_MS`. */
  budgetMs?: number;
  /** The longest a turn waits for a frame (a renderer that does not draw, such as a suspended
   *  one, never holds the work up longer), ms; default `PACE_MAX_WAIT_MS`. */
  maxWaitMs?: number;
  /** How often a waiting turn looks for the end of a frame that emitted no `frame` event (one
   *  that drew nothing), ms; default `FRAME_POLL_MS`. */
  pollMs?: number;
}

/** Work after a frame before a turn waits for the next one, ms (design D1). */
export const PACE_BUDGET_MS = 40;

/** The longest a turn waits for a frame, ms. */
export const PACE_MAX_WAIT_MS = 100;

/** How often a waiting turn checks for a frame's end without an event, ms. */
export const FRAME_POLL_MS = 2;

const timerTurn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export function createFramePace(options: FramePaceOptions = {}): FramePace {
  const budgetMs = options.budgetMs ?? PACE_BUDGET_MS;
  const maxWaitMs = options.maxWaitMs ?? PACE_MAX_WAIT_MS;
  const pollMs = options.pollMs ?? FRAME_POLL_MS;
  let renderer: FramePaceRenderer | null = null;
  let unhook: (() => void) | null = null;
  // When the last frame was seen to end.
  let endedAt = 0;
  // Turns waiting for a frame: given once a frame after `after` (a frame id) has ended.
  let waiting: (() => void)[] = [];
  let after = 0;
  let since = 0;
  let poll: ReturnType<typeof setTimeout> | null = null;

  const live = (): FramePaceRenderer | null => (renderer !== null && !renderer.isDestroyed ? renderer : null);

  /** The id of the last frame that has ended: the frame in progress has not. */
  function lastEnded(r: FramePaceRenderer): number {
    return r.getSchedulerState().isRendering ? r.frameId - 1 : r.frameId;
  }

  function release(): void {
    if (poll !== null) clearTimeout(poll);
    poll = null;
    const ready = waiting;
    waiting = [];
    for (const resolve of ready) resolve();
  }

  /** Gives the waiting turns once a frame after `after` has ended, or the wait is too long. */
  function check(): void {
    poll = null;
    if (waiting.length === 0) return;
    const r = live();
    if (r === null) return release();
    if (lastEnded(r) > after) {
      endedAt = performance.now();
      return release();
    }
    if (performance.now() - since >= maxWaitMs) return release();
    poll = setTimeout(check, pollMs);
  }

  // A turn given here continues in a microtask after the frame's synchronous end, outside it.
  const onFrame = (): void => {
    endedAt = performance.now();
    release();
  };

  /** Waits for the frame in progress, or (`request`) the next one, to end. */
  function waitForFrame(r: FramePaceRenderer, request: boolean): Promise<void> {
    return new Promise((resolve) => {
      if (waiting.length === 0) {
        since = performance.now();
        after = lastEnded(r);
      }
      waiting.push(resolve);
      if (request) r.requestRender();
      if (poll === null) poll = setTimeout(check, pollMs);
    });
  }

  function detach(): void {
    unhook?.();
    unhook = null;
    renderer = null;
    release();
  }

  return {
    async turn() {
      await timerTurn();
      const r = live();
      if (r === null) return;
      // The timer may have fallen due inside a frame (in one of its yields): wait for its end.
      if (r.getSchedulerState().isRendering) return waitForFrame(r, false);
      // Past the budget since the last frame: the next frame comes first.
      if (performance.now() - endedAt >= budgetMs) return waitForFrame(r, true);
    },
    frames() {
      const r = live();
      return r === null ? undefined : lastEnded(r);
    },
    attach(next) {
      detach();
      renderer = next;
      endedAt = performance.now();
      const onDestroy = (): void => detach();
      next.on(CliRenderEvents.FRAME, onFrame);
      next.on(CliRenderEvents.DESTROY, onDestroy);
      unhook = () => {
        next.off(CliRenderEvents.FRAME, onFrame);
        next.off(CliRenderEvents.DESTROY, onDestroy);
      };
      return detach;
    },
    detach,
  };
}
