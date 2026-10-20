// parallel-tests task 3.4: the two replay-queue tests with a time bound: handing 8303 notifications over in under a second, and what was reduced reaching the store within the notification interval (a replay whose updates trickle in), which run in the serial pass.
// What the file covers is in the header of replay-queue.test.ts; its helpers are in replay-queue-helpers.ts.
import { describe, expect, test } from "bun:test";
import type { SessionNotification } from "@agentclientprotocol/sdk";
import { createSession, reduce } from "acp-model";
import { createClientHandler } from "../../src/agent/client-handler.ts";
import { createSessionStore } from "../../src/session/store.ts";
import { longSessionUpdates, harness } from "./replay-queue-helpers.ts";

describe("Batched history replay: the client handler's queue (task 6.1)", () => {
  test("8303 queued updates reach the store in order with fewer than 500 notifications", async () => {
    const updates = longSessionUpdates(5000);
    expect(updates).toHaveLength(8303);

    const { handler, source, dispatch } = harness();
    const store = createSessionStore({ home: null });
    store.attach(source);
    let notifications = 0;
    let previousLength = 0;
    let inOrder = true;
    store.onChange((change) => {
      notifications += 1;
      if (change.session.order.length < previousLength) inOrder = false;
      previousLength = change.session.order.length;
    });

    dispatch({ type: "session_opening", mode: "load", sessionId: "long-session", cwd: "/work", at: 0 });
    handler.beginReplay();
    // As the SDK's read loop would: every notification is handed over and returns at once.
    const started = performance.now();
    for (const update of updates) {
      await handler.client.sessionUpdate({ sessionId: "long-session", update } satisfies SessionNotification);
    }
    const handOver = performance.now() - started;
    await handler.endReplay({ type: "session_opened", response: {}, at: 0 });

    // The reference: the same events reduced one at a time.
    let reference = reduce(createSession(), { type: "session_opening", mode: "load", sessionId: "long-session", cwd: "/work", at: 0 });
    for (const update of updates) reference = reduce(reference, { type: "session_update", update, at: 0 });
    reference = reduce(reference, { type: "session_opened", response: {}, at: 0 });

    const snapshot = store.snapshot();
    expect(snapshot.order).toEqual(reference.order);
    expect([...store.session.order]).toEqual([...reference.order]);
    expect(snapshot.opening).toBeNull();
    expect(snapshot.order.map((id) => snapshot.items.get(id)!.origin).every((o) => o === "replay")).toBe(true);
    expect(inOrder).toBe(true);
    expect(notifications).toBeLessThan(500);
    // Handing the notifications over reduced nothing: far less time than the reduce takes.
    expect(handOver).toBeLessThan(1000);
    store.dispose();
  }, 60000);

  test("notifications during a replay are at least replayNotifyMs apart, and the last state always reaches the store", async () => {
    let session = createSession();
    const times: number[] = [];
    const handler = createClientHandler({
      dispatch: (event) => (session = reduce(session, event)),
      apply: (event) => (session = reduce(session, event)),
      flush: () => times.push(performance.now()),
      replaySliceMs: 1,
      replayNotifyMs: 30,
      now: () => 0,
    });
    session = reduce(session, { type: "session_opening", mode: "load", sessionId: "s", cwd: "/", at: 0 });
    handler.beginReplay();
    for (const update of longSessionUpdates(3000)) await handler.client.sessionUpdate({ sessionId: "s", update });
    await handler.endReplay({ type: "session_opened", response: {}, at: 0 });
    expect(times.length).toBeGreaterThan(1);
    for (let i = 1; i < times.length - 1; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(29);
    expect(session.opening).toBeNull();

    // A replay whose updates trickle in: what was reduced reaches the store within the interval,
    // without waiting for the response.
    let notified = 0;
    let trickle = createSession();
    const slow = createClientHandler({
      dispatch: (event) => (trickle = reduce(trickle, event)),
      apply: (event) => (trickle = reduce(trickle, event)),
      flush: () => (notified += 1),
      replayNotifyMs: 30,
      now: () => 0,
    });
    trickle = reduce(trickle, { type: "session_opening", mode: "load", sessionId: "s", cwd: "/", at: 0 });
    slow.beginReplay();
    await slow.client.sessionUpdate({ sessionId: "s", update: { sessionUpdate: "agent_message_chunk", messageId: "a", content: { type: "text", text: "one" } } });
    await Bun.sleep(5);
    await slow.client.sessionUpdate({ sessionId: "s", update: { sessionUpdate: "agent_message_chunk", messageId: "b", content: { type: "text", text: "two" } } });
    await Bun.sleep(80);
    expect(notified).toBeGreaterThanOrEqual(1);
    expect(trickle.order).toHaveLength(2);
    await slow.endReplay({ type: "session_opened", response: {}, at: 0 });
  });
});
