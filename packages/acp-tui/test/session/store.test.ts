// Solid store adapter (design D2): per-item updates keyed by id, snapshots left
// untouched, change notifications for the transcript writer, UI state.
// Needs the root bunfig `[test] preload` (the Solid client build); run from the
// repository root.
import { describe, expect, test } from "bun:test";
import { createEffect, createRoot } from "solid-js";
import { createSession, reduce, type ModelEvent, type Session } from "acp-model";
import { CLOCK_TICK_MS, createSessionStore, type SessionChange, type SessionSource } from "../../src/session/store.ts";

function fakeSource(): SessionSource & { dispatch(event: ModelEvent): Session } {
  let session = createSession();
  const listeners = new Set<(s: Session) => void>();
  return {
    getSession: () => session,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch(event) {
      session = reduce(session, event);
      for (const l of listeners) l(session);
      return session;
    },
  };
}

const chunk = (messageId: string, text: string, at: number): ModelEvent => ({
  type: "session_update",
  at,
  update: { sessionUpdate: "agent_message_chunk", messageId, content: { type: "text", text } },
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("session store", () => {
  test("starts connecting; attach follows the source and clears it", () => {
    const store = createSessionStore({ home: "/home/x" });
    expect(store.ui.connecting).toBe(true);
    expect(store.view().connection).toBe("connecting");
    const source = fakeSource();
    source.dispatch({ type: "session_created", at: 0, cwd: "/w", agentInfo: { name: "fake", version: "1" }, response: { sessionId: "s1" } });
    store.attach(source);
    expect(store.ui.connecting).toBe(false);
    expect(store.session.id).toBe("s1");
    expect(store.view()).toMatchObject({ connection: "connected", agent: "fake", cwd: "/w", turnState: "idle" });
    store.dispose();
  });

  test("the legacy model state reaches the session state and the view, and a selection updates both (session-models)", () => {
    const store = createSessionStore();
    const source = fakeSource();
    const models = { currentModelId: "a", availableModels: [{ modelId: "a", name: "Alpha" }, { modelId: "b", name: "Beta" }] };
    source.dispatch({ type: "session_created", at: 0, cwd: "/w", response: { sessionId: "s1", models } as never });
    store.attach(source);
    expect(store.session.models?.currentModelId).toBe("a");
    expect(store.view().model).toBe("Alpha");
    source.dispatch({ type: "legacy_model_selected", modelId: "b", at: 1 });
    expect(store.session.models?.currentModelId).toBe("b");
    expect(store.view().model).toBe("Beta");
    expect(store.view().pills).toContainEqual({ category: "model", name: "Model", value: "Beta" });
    store.dispose();
  });

  test("items are keyed by id, order is appended, and snapshots are not mutated", () => {
    const store = createSessionStore();
    const source = fakeSource();
    store.attach(source);
    source.dispatch({ type: "prompt_sent", text: "hi", at: 1 });
    const before = source.dispatch(chunk("m1", "one", 2));
    const itemBefore = before.items.get("agent_message:m1")!;
    source.dispatch(chunk("m1", " two", 3));
    expect(store.session.order).toEqual(["user:1", "agent_message:m1"]);
    expect(store.session.items["agent_message:m1"]).toMatchObject({ kind: "agent_message", text: "one two" });
    // The earlier snapshot still reads its own text.
    expect(itemBefore.kind === "agent_message" && itemBefore.text).toBe("one");
    expect(before.items.get("agent_message:m1")).toBe(itemBefore);
    store.dispose();
  });

  test("a component reading one item does not re-run when another item changes", async () => {
    const store = createSessionStore();
    const source = fakeSource();
    store.attach(source);
    source.dispatch({ type: "prompt_sent", text: "hi", at: 1 });
    source.dispatch(chunk("m1", "a", 2));
    let runs = 0;
    const dispose = createRoot((d) => {
      createEffect(() => {
        void store.session.items["user:1"]?.status;
        runs++;
      });
      return d;
    });
    await flush();
    const baseline = runs;
    source.dispatch(chunk("m1", "b", 3));
    source.dispatch(chunk("m1", "c", 4));
    await flush();
    expect(runs).toBe(baseline);
    dispose();
    store.dispose();
  });

  test("onChange reports changed items in order, with becameFinal", () => {
    const store = createSessionStore();
    const source = fakeSource();
    store.attach(source);
    const changes: SessionChange[] = [];
    store.onChange((c) => changes.push(c));
    source.dispatch({ type: "prompt_sent", text: "hi", at: 1 });
    source.dispatch(chunk("m1", "a", 2));
    source.dispatch(chunk("m1", "b", 3));
    source.dispatch({ type: "prompt_response", stopReason: "end_turn", at: 4 });
    const summary = changes.map((c) => c.items.map((i) => `${i.id}${i.previous ? "" : "+"}${i.becameFinal ? "!" : ""}`));
    expect(summary).toEqual([["user:1+!"], ["agent_message:m1+"], ["agent_message:m1"], ["agent_message:m1!", "marker:2+!"]]);
    expect(changes.at(-1)!.previous.state).toBe("running");
    expect(changes.at(-1)!.session.state).toBe("idle");
    store.dispose();
  });

  test("the view is recomputed for metadata and UI changes, not for text chunks", async () => {
    const store = createSessionStore();
    const source = fakeSource();
    store.attach(source);
    source.dispatch({ type: "prompt_sent", text: "hi", at: 1 });
    let runs = 0;
    const dispose = createRoot((d) => {
      createEffect(() => {
        store.view();
        runs++;
      });
      return d;
    });
    await flush();
    const baseline = runs;
    source.dispatch(chunk("m1", "a", 2));
    source.dispatch(chunk("m1", "b", 3));
    await flush();
    expect(runs).toBe(baseline);
    source.dispatch({ type: "prompt_response", stopReason: "end_turn", at: 4 });
    store.setArmed({ kind: "detach", key: "ctrl+d" });
    await flush();
    expect(runs).toBeGreaterThan(baseline);
    expect(store.view()).toMatchObject({ turnState: "idle", ui: { armed: { kind: "detach", key: "ctrl+d" } } });
    dispose();
    store.dispose();
  });

  test("open permission id and UI state", () => {
    const store = createSessionStore();
    const source = fakeSource();
    store.attach(source);
    source.dispatch({ type: "prompt_sent", text: "hi", at: 1 });
    source.dispatch({
      type: "permission_opened",
      toolCallId: "t1",
      at: 2,
      request: { sessionId: "s", toolCall: { toolCallId: "t1", title: "Run" }, options: [{ optionId: "a", kind: "allow_once", name: "Allow" }] },
    });
    expect(store.session.openPermissionId).toBe("permission:t1");
    expect(store.view().ui.permissionOpen).toBe(true);
    store.setFocus("card");
    store.setPromptEmpty(false);
    const id = store.notify("turn running");
    expect(store.ui.notices).toEqual([{ id, text: "turn running", token: "warning" }]);
    store.dismissNotice(id);
    expect(store.ui.notices).toEqual([]);
    expect(store.view().ui).toMatchObject({ focus: "card", promptEmpty: false });
    store.dispose();
  });

  test("mouse policy and scroll position reach the view", () => {
    const store = createSessionStore({ mouse: "wheel" });
    expect(store.view().mouse).toBe("wheel");
    store.setMouse("off");
    expect(store.view().mouse).toBe("off");
    expect(store.view().scroll.following).toBe(true);
    store.setScroll({ following: false, percent: 40, below: 12, newBelow: 3 });
    expect(store.view().scroll).toEqual({ following: false, percent: 40, below: 12, newBelow: 3 });
    store.dispose();
  });

  test("the clock ticks only while a turn runs, for turn-state's elapsed time", async () => {
    let now = 10_000;
    const store = createSessionStore({ now: () => now });
    const source = fakeSource();
    store.attach(source);
    source.dispatch({ type: "prompt_sent", text: "hi", at: 10_000 });
    expect(store.view().turnStartedAt).toBe(10_000);
    now = 12_500;
    await Bun.sleep(CLOCK_TICK_MS + 100);
    expect(store.view().now).toBe(12_500);
    source.dispatch({ type: "prompt_response", stopReason: "end_turn", at: 13_000 });
    expect(store.view().turnStartedAt).toBeNull();
    now = 20_000;
    await Bun.sleep(CLOCK_TICK_MS + 100);
    expect(store.view().now).toBe(12_500);
    store.dispose();
  });

  test("replace (switching sessions, mvp-sessions task 7.4): the previous session's items and view state go; the epoch moves on", () => {
    const store = createSessionStore();
    const a = fakeSource();
    a.dispatch({ type: "session_created", at: 0, cwd: "/w", agentInfo: null, response: { sessionId: "a" } });
    a.dispatch(chunk("m1", "from a", 1));
    store.attach(a);
    store.conversation.setCursor(store.session.order[0]!);
    store.conversation.following = false;
    expect(store.session.order.length).toBe(1);
    const epoch = store.ui.epoch;

    const b = fakeSource();
    b.dispatch({ type: "session_created", at: 2, cwd: "/w", agentInfo: null, response: { sessionId: "b" } });
    b.dispatch(chunk("m2", "from b", 3));
    store.replace(b);
    expect(store.session.id).toBe("b");
    expect(store.session.order.map((id) => (store.session.items[id] as { text: string }).text)).toEqual(["from b"]);
    expect(Object.keys(store.session.items)).toEqual([...store.session.order]);
    expect(store.ui.epoch).toBe(epoch + 1);
    expect(store.conversation.cursor()).toBeNull();
    expect(store.conversation.following).toBe(true);
    // a's updates no longer reach the store; b's do.
    a.dispatch(chunk("m1", " more", 4));
    b.dispatch(chunk("m2", " more", 5));
    expect(store.session.order.map((id) => (store.session.items[id] as { text: string }).text)).toEqual(["from b more"]);

    // With null: no session, `connecting` again (a switch at start-up that failed).
    store.replace(null);
    expect(store.session.order).toEqual([]);
    expect(store.ui.connecting).toBe(true);
    b.dispatch(chunk("m2", " ignored", 6));
    expect(store.session.order).toEqual([]);
    store.dispose();
  });
});
