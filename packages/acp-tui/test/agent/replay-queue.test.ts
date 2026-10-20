// mvp-sessions task 6.1 (design decision 10, spec tui-sessions "Batched
// history replay"): while a load is in progress the client handler queues
// `session/update` notifications and returns at once; a drain loop reduces
// them in slices of about 8 ms and yields between slices, notifying the store
// once for a slice at most every 40 ms (task 6.3); the load's `session_opened`
// is queued behind them. Also the paced reading of the agent's messages while
// a load replays (connection.ts `pacedStream`), and (history-replay-pacing,
// design D1 and D2) both taking their turns from a frame pacer, played here by a
// stand-in whose turns the test holds and gives. The 8303 updates are the ones
// fake-agent's `long-session --items 5000` replays, built here from the same
// generator.
//
// The timing tests of this file are in replay-queue.timing.test.ts (parallel-tests: they run in the serial pass).
import { describe, expect, test } from "bun:test";
import type { SessionNotification } from "@agentclientprotocol/sdk";
import { createSession, reduce } from "acp-model";
import { createClientHandler } from "../../src/agent/client-handler.ts";
import { pacedStream } from "../../src/agent/connection.ts";
import type { Pace } from "../../src/renderer/frame-pace.ts";
import { longSessionUpdates, harness } from "./replay-queue-helpers.ts";

describe("Batched history replay: the client handler's queue (task 6.1)", () => {
  test("the drain loop yields between slices: a timer queued during the replay runs before it ends", async () => {
    const { handler, current , dispatch } = harness();
    dispatch({ type: "session_opening", mode: "load", sessionId: "s", cwd: "/work", at: 0 });
    handler.beginReplay();
    for (const update of longSessionUpdates(2000)) await handler.client.sessionUpdate({ sessionId: "s", update });
    let ticks = 0;
    const timer = setInterval(() => (ticks += 1), 0);
    await handler.endReplay({ type: "session_opened", response: {}, at: 0 });
    clearInterval(timer);
    expect(current().order.length).toBe(2000);
    expect(ticks).toBeGreaterThan(0);
  }, 60000);

  test("updates that arrive after the response but before the queue drains stay behind it", async () => {
    const { handler, current , dispatch } = harness();
    dispatch({ type: "session_opening", mode: "load", sessionId: "s", cwd: "/work", at: 0 });
    handler.beginReplay();
    await handler.client.sessionUpdate({ sessionId: "s", update: { sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: "replayed" } } });
    const ended = handler.endReplay({ type: "session_opened", response: {}, at: 0 });
    await handler.client.sessionUpdate({ sessionId: "s", update: { sessionUpdate: "agent_message_chunk", messageId: "m2", content: { type: "text", text: "live" } } });
    await ended;
    await Bun.sleep(5);
    const session = current();
    expect(session.order).toEqual(["agent_message:m1", "agent_message:m2"]);
    expect(session.items.get("agent_message:m1")!.origin).toBe("replay");
    expect(session.items.get("agent_message:m2")!.origin).toBe("other");
  });

  test("pacedStream: while active, a burst of buffered messages lets timers run, every message passed on in order", async () => {
    const burst = async (active: boolean): Promise<{ out: number[]; ticks: number }> => {
      const messages = Array.from({ length: 2000 }, (_, i) => i);
      const source = new ReadableStream<number>({
        start(controller) {
          for (const m of messages) controller.enqueue(m);
          controller.close();
        },
      });
      let ticks = 0;
      const timer = setInterval(() => (ticks += 1), 0);
      const reader = pacedStream(source, () => active, 2).getReader();
      const out: number[] = [];
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        out.push(value);
        // About 0.05 ms of handling per message, as the SDK's validation takes.
        const until = performance.now() + 0.05;
        while (performance.now() < until) {
          // busy
        }
      }
      clearInterval(timer);
      return { out, ticks };
    };
    const paced = await burst(true);
    expect(paced.out).toEqual(Array.from({ length: 2000 }, (_, i) => i));
    expect(paced.ticks).toBeGreaterThan(5);
    // Not active (no load in progress): read as before, in one run of microtasks.
    const unpaced = await burst(false);
    expect(unpaced.out).toHaveLength(2000);
    expect(unpaced.ticks).toBe(0);
  });

  test("without beginReplay, an update is dispatched at once, as before", async () => {
    const { handler, current } = harness();
    await handler.client.sessionUpdate({ sessionId: "s", update: { sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: "now" } } });
    expect(current().order).toEqual(["agent_message:m1"]);
  });
});

/** A stand-in for the frame pacer: turns are timer turns unless held; `frame()` draws a frame. */
function standInPace() {
  let holding = false;
  let held: (() => void)[] = [];
  let frame = 0;
  const pace: Pace = {
    turn: () => (holding ? new Promise<void>((resolve) => held.push(resolve)) : new Promise<void>((resolve) => setTimeout(resolve, 0))),
    frames: () => frame,
  };
  return {
    pace,
    hold(): void {
      holding = true;
    },
    /** Stops holding and gives every held turn. */
    give(): void {
      holding = false;
      const ready = held;
      held = [];
      for (const resolve of ready) resolve();
    },
    held: () => held.length,
    frame(): void {
      frame += 1;
    },
  };
}

/** Lets `n` macrotasks pass. */
async function ticks(n = 10): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Waits (in macrotasks, without a clock) until `cond`, failing after many. */
async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 100_000 && !cond(); i++) await new Promise((resolve) => setTimeout(resolve, 0));
  expect(cond()).toBe(true);
}

const chunk = (messageId: string): SessionNotification => ({
  sessionId: "s",
  update: { sessionUpdate: "agent_message_chunk", messageId, content: { type: "text", text: messageId } },
});

describe("Batched history replay paced around frames (history-replay-pacing, task group 2)", () => {
  /** A replay with the stand-in pace: counts what was applied and the notifications. */
  function pacedHarness(options: { replaySliceMs?: number } = {}) {
    const stand = standInPace();
    let session = reduce(createSession(), { type: "session_opening", mode: "load", sessionId: "s", cwd: "/", at: 0 });
    let applied = 0;
    let notified = 0;
    const handler = createClientHandler({
      dispatch: (event) => (session = reduce(session, event)),
      apply: (event) => {
        applied += 1;
        session = reduce(session, event);
      },
      flush: () => (notified += 1),
      pace: stand.pace,
      replaySliceMs: options.replaySliceMs ?? 8,
      replayNotifyMs: 0,
      // Far out of reach: only a drawn frame lets the next notification through.
      replayStaleMs: 60_000,
      now: () => 0,
    });
    handler.beginReplay();
    return { stand, handler, applied: () => applied, notified: () => notified, session: () => session };
  }

  test("replay work waits for the frame being drawn: nothing is applied while the turn is held", async () => {
    const h = pacedHarness();
    h.stand.hold();
    for (const id of ["a", "b", "c"]) await h.handler.client.sessionUpdate(chunk(id));
    await ticks();
    expect(h.stand.held()).toBeGreaterThan(0);
    expect(h.applied()).toBe(0);
    expect(h.notified()).toBe(0);
    h.stand.give();
    await h.handler.endReplay({ type: "session_opened", response: {}, at: 0 });
    expect(h.applied()).toBe(4);
    expect(h.session().order).toEqual(["agent_message:a", "agent_message:b", "agent_message:c"]);
  });

  test("at most one notification per drawn frame; the end of the load notifies at once", async () => {
    // One event per slice, so every slice could notify.
    const h = pacedHarness({ replaySliceMs: 0 });
    for (const id of ["a", "b", "c", "d", "e"]) await h.handler.client.sessionUpdate(chunk(id));
    await until(() => h.applied() === 5);
    await ticks();
    expect(h.notified()).toBe(1);
    // A frame is drawn: what was reduced since reaches the store, without another update.
    h.stand.frame();
    await until(() => h.notified() === 2);
    await ticks();
    expect(h.notified()).toBe(2);
    // No frame since, but the load's end notifies at once.
    await h.handler.endReplay({ type: "session_opened", response: {}, at: 0 });
    expect(h.notified()).toBe(3);
    expect(h.session().opening).toBeNull();
  });

  test("an abort drops a turn that is still held", async () => {
    const h = pacedHarness();
    h.stand.hold();
    await h.handler.client.sessionUpdate(chunk("a"));
    await ticks();
    expect(h.stand.held()).toBeGreaterThan(0);
    h.handler.abortReplay();
    h.stand.give();
    await ticks();
    expect(h.applied()).toBe(0);
    expect(h.notified()).toBe(0);
    expect(h.handler.replaying()).toBe(false);
  });

  test("pacedStream: a held turn passes on no further message until it is given", async () => {
    const stand = standInPace();
    const source = new ReadableStream<number>({
      start(controller) {
        for (let i = 0; i < 5; i++) controller.enqueue(i);
        controller.close();
      },
    });
    // A slice of 0 ms: every message waits for a turn.
    const reader = pacedStream(source, () => true, 0, stand.pace).getReader();
    stand.hold();
    let first: number | undefined;
    const read = reader.read().then((r) => (first = r.value));
    await ticks();
    expect(stand.held()).toBe(1);
    expect(first).toBeUndefined();
    stand.give();
    await read;
    expect(first).toBe(0);
    const rest: number[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      rest.push(value);
    }
    expect(rest).toEqual([1, 2, 3, 4]);
  });
});
