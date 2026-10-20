// history-replay-pacing task 1.1 (design D1): the frame pacer gives background work its turns
// outside frames. A stand-in renderer plays OpenTUI 0.6's part (`isRendering` from a frame's start
// to its end, `frameId` counting frames started, the `frame` event before the flag is cleared).
// No assertion depends on the machine's speed: a turn that must be held is checked after some
// macrotasks with the bound set far out of reach, and a turn that must be given is awaited.
import { EventEmitter } from "node:events";
import { describe, expect, test } from "bun:test";
import { createFramePace, type FramePaceRenderer } from "../../src/renderer/frame-pace.ts";

/** A stand-in for the part of `CliRenderer` the pacer reads. */
class StandIn extends EventEmitter {
  isRendering = false;
  frameId = 0;
  isDestroyed = false;
  requests = 0;
  getSchedulerState() {
    return { isRunning: false, isRendering: this.isRendering, hasScheduledRender: false };
  }
  requestRender(): void {
    this.requests += 1;
  }
  /** A frame starts. */
  start(): void {
    this.frameId += 1;
    this.isRendering = true;
  }
  /** The frame ends; `emit` as a frame that drew does (the event first, then the flag). */
  end(emit = true): void {
    if (emit) this.emit("frame", { frameId: this.frameId });
    this.isRendering = false;
  }
  destroy(): void {
    this.isDestroyed = true;
    this.emit("destroy");
  }
  get asRenderer(): FramePaceRenderer {
    return this as unknown as FramePaceRenderer;
  }
}

/** Lets `n` macrotasks pass. */
async function ticks(n = 5): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Tracks whether a promise has settled. */
function track(promise: Promise<void>): { readonly done: boolean; readonly promise: Promise<void> } {
  const state = { done: false, promise };
  promise.then(() => {
    state.done = true;
  });
  return state;
}

// A bound far beyond any test's run: a turn held here is held by the pacer, not released by it.
const NEVER = 60_000;

describe("frame pacer", () => {
  test("without a renderer a turn is a timer turn, and there is no frame count", async () => {
    const pace = createFramePace();
    let sync = true;
    const turn = pace.turn().then(() => expect(sync).toBe(false));
    sync = false;
    await turn;
    expect(pace.frames()).toBeUndefined();
  });

  test("with no frame in progress and budget left, a turn is given without a frame", async () => {
    const r = new StandIn();
    const pace = createFramePace({ budgetMs: NEVER, maxWaitMs: NEVER });
    pace.attach(r.asRenderer);
    await pace.turn();
    expect(r.requests).toBe(0);
  });

  test("a turn asked during a frame is held until that frame's frame event", async () => {
    const r = new StandIn();
    const pace = createFramePace({ budgetMs: NEVER, maxWaitMs: NEVER });
    pace.attach(r.asRenderer);
    r.start();
    const turn = track(pace.turn());
    await ticks();
    expect(turn.done).toBe(false);
    let flagWhenGiven = null as boolean | null;
    const given = turn.promise.then(() => {
      flagWhenGiven = r.isRendering;
    });
    r.end();
    await given;
    // Given after the frame's synchronous end: OpenTUI has cleared its rendering flag by then.
    expect(flagWhenGiven).toBe(false);
    expect(r.requests).toBe(0);
  });

  test("a frame that drew nothing (no event) still releases the turn when it ends", async () => {
    const r = new StandIn();
    const pace = createFramePace({ budgetMs: NEVER, maxWaitMs: NEVER, pollMs: 1 });
    pace.attach(r.asRenderer);
    r.start();
    const turn = track(pace.turn());
    await ticks();
    expect(turn.done).toBe(false);
    r.end(false);
    await turn.promise;
  });

  test("past the budget, a turn requests a frame and waits for it to end", async () => {
    const r = new StandIn();
    const pace = createFramePace({ budgetMs: 0, maxWaitMs: NEVER, pollMs: 1 });
    pace.attach(r.asRenderer);
    const turn = track(pace.turn());
    await ticks();
    expect(r.requests).toBe(1);
    expect(turn.done).toBe(false);
    // The requested frame starts and ends without an event; the turn is given after it.
    r.start();
    await ticks();
    expect(turn.done).toBe(false);
    r.end(false);
    await turn.promise;
  });

  test("turns waiting together are given by the same frame", async () => {
    const r = new StandIn();
    const pace = createFramePace({ budgetMs: NEVER, maxWaitMs: NEVER });
    pace.attach(r.asRenderer);
    r.start();
    const a = track(pace.turn());
    const b = track(pace.turn());
    await ticks();
    expect(a.done || b.done).toBe(false);
    r.end();
    await Promise.all([a.promise, b.promise]);
  });

  test("a frame that never comes holds a turn no longer than the bound", async () => {
    const r = new StandIn();
    const pace = createFramePace({ budgetMs: 0, maxWaitMs: 5, pollMs: 1 });
    pace.attach(r.asRenderer);
    await pace.turn();
    expect(r.requests).toBe(1);
  });

  test("destroying the renderer gives a waiting turn and detaches the pacer", async () => {
    const r = new StandIn();
    const pace = createFramePace({ budgetMs: NEVER, maxWaitMs: NEVER });
    pace.attach(r.asRenderer);
    r.start();
    const turn = track(pace.turn());
    await ticks();
    expect(turn.done).toBe(false);
    r.destroy();
    await turn.promise;
    expect(pace.frames()).toBeUndefined();
    expect(r.listenerCount("frame")).toBe(0);
    expect(r.listenerCount("destroy")).toBe(0);
  });

  test("detach gives a waiting turn and goes back to timer turns", async () => {
    const r = new StandIn();
    const pace = createFramePace({ budgetMs: NEVER, maxWaitMs: NEVER });
    const detach = pace.attach(r.asRenderer);
    r.start();
    const turn = track(pace.turn());
    await ticks();
    detach();
    await turn.promise;
    // Still drawing, but no longer paced.
    await pace.turn();
    expect(r.listenerCount("frame")).toBe(0);
  });

  test("frames() is the id of the last frame that has ended", () => {
    const r = new StandIn();
    const pace = createFramePace();
    pace.attach(r.asRenderer);
    expect(pace.frames()).toBe(0);
    r.start();
    expect(pace.frames()).toBe(0);
    r.end();
    expect(pace.frames()).toBe(1);
    r.start();
    r.end(false);
    expect(pace.frames()).toBe(2);
  });
});
