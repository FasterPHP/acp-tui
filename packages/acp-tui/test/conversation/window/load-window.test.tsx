// history-replay-pacing task group 3 (design D3, D4): the conversation window while a load
// replays. In-process, at 100x30, with a session source that plays the batched replay's part:
// events applied without notifying, then one notification for the batch (the drain's `flush`).
// - D3: a replay notification's items are mounted in the notification's own turn; a change
//   outside a load is still re-read on a timer (coalesced).
// - D4: while the session replays and the view follows, only the entries that cover the viewport
//   are mounted; the full tail of 40 once the replay has ended; scrolling up during the load takes
//   the normal window.
// Counts of mounted entries, never times. Needs the root bunfig `[test] preload`.
import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import type { Renderable } from "@opentui/core";
import { createSession, reduce, type ModelEvent, type Session } from "acp-model";
import { App } from "../../../src/app/App.tsx";
import type { AppActions, AppContextValue } from "../../../src/app/context.ts";
import { DEFAULT_LAYOUT, resolveLayout } from "../../../src/layout/layout.ts";
import { createSessionStore, type SessionSource, type SessionStore } from "../../../src/session/store.ts";
import { DEFAULT_THEME, resolveTheme } from "../../../src/theme/index.ts";
import { TAIL } from "../../../src/conversation/window/range.ts";

type Setup = Awaited<ReturnType<typeof testRender>>;
let setup: Setup | undefined;
let store: SessionStore | undefined;
afterEach(async () => {
  await setup?.dispose();
  store?.dispose();
  setup = undefined;
  store = undefined;
});

/** A source that applies events without notifying, and notifies once per `flush`. */
function replaySource(): SessionSource & { apply(event: ModelEvent): void; flush(): void; dispatch(event: ModelEvent): void } {
  let session: Session = createSession();
  const listeners = new Set<(s: Session) => void>();
  const flush = () => {
    for (const l of listeners) l(session);
  };
  return {
    getSession: () => session,
    subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
    apply(event) {
      session = reduce(session, event);
    },
    flush,
    dispatch(event) {
      session = reduce(session, event);
      flush();
    },
  };
}

/** One-line agent messages: `count` items, each a message `line N`. */
function replayMessages(s: ReturnType<typeof replaySource>, from: number, count: number): void {
  for (let i = from; i < from + count; i++) {
    s.apply({ type: "session_update", at: i, update: { sessionUpdate: "agent_message_chunk", messageId: `m${i}`, content: { type: "text", text: `line ${i}` } } });
  }
}

/** The entries the window has mounted: the children between its two spacers. */
function mountedEntries(root: Renderable): number {
  const stack: Renderable[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const children = node.getChildren() as Renderable[];
    if (children.some((c) => c.id === "window:top")) return children.filter((c) => c.id !== "window:top" && c.id !== "window:bottom").length;
    stack.push(...children);
  }
  return 0;
}

async function mount() {
  store = createSessionStore({ home: "/home/x" });
  const actions: AppActions = { prompt: () => null, cancel() {}, answerPermission: () => false, exit() {} };
  const context: AppContextValue = { store, actions, theme: resolveTheme(DEFAULT_THEME) };
  setup = await testRender(() => <App context={context} layout={resolveLayout(DEFAULT_LAYOUT)} />, {
    width: 100,
    height: 30,
    screenMode: "alternate-screen",
  });
  const frame = async () => {
    await setup!.flush();
    await setup!.renderOnce();
    return setup!.captureCharFrame();
  };
  return { store, frame, entries: () => mountedEntries(setup!.renderer.root) };
}

const macrotask = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the conversation window while a load replays", () => {
  test("only the viewport is mounted while replaying, the tail of 40 once the load ends", async () => {
    const app = await mount();
    const s = replaySource();
    s.dispatch({ type: "session_opening", mode: "load", sessionId: "s", cwd: "/home/x/proj", at: 0 });
    app.store.attach(s);
    await app.frame();
    // A first replay notification: far more than the tail.
    replayMessages(s, 0, 200);
    s.flush();
    // Mounted in the notification's own turn (D3): no macrotask has passed.
    const during = app.entries();
    expect(during).toBeGreaterThan(0);
    expect(during).toBeLessThan(TAIL);
    let screen = await app.frame();
    expect(screen).toContain("line 199");
    // Two more notifications, as the drain sends them.
    for (const from of [200, 400]) {
      replayMessages(s, from, 200);
      s.flush();
      screen = await app.frame();
      expect(app.entries()).toBeLessThan(TAIL);
    }
    expect(screen).toContain("line 599");
    // The load answers: the replay ends with the last notification, and the full tail mounts.
    s.dispatch({ type: "session_opened", response: {}, at: 1000 });
    expect(app.entries()).toBe(TAIL);
    screen = await app.frame();
    expect(screen).toContain("line 599");
  });

  test("outside a load, a change is re-read on a timer, as before", async () => {
    const app = await mount();
    const s = replaySource();
    s.dispatch({ type: "session_created", at: 0, cwd: "/home/x/proj", agentInfo: { name: "fake-agent", version: "1" }, response: { sessionId: "s" } });
    app.store.attach(s);
    await app.frame();
    const before = app.entries();
    replayMessages(s, 0, 3);
    s.flush();
    // Not yet re-read: the mounted entries are those of before the change.
    expect(app.entries()).toBe(before);
    await macrotask();
    expect(app.entries()).not.toBe(before);
    expect(await app.frame()).toContain("line 2");
  });

  test("scrolling up during a load leaves the viewport-only window", async () => {
    const app = await mount();
    const s = replaySource();
    s.dispatch({ type: "session_opening", mode: "load", sessionId: "s", cwd: "/home/x/proj", at: 0 });
    app.store.attach(s);
    await app.frame();
    replayMessages(s, 0, 300);
    s.flush();
    await app.frame();
    expect(app.entries()).toBeLessThan(TAIL);
    // PgUp from the prompt box scrolls the conversation and stops following.
    setup!.mockInput.pressKey("\u001b[5~");
    let screen = await app.frame();
    for (let i = 0; i < 10 && app.entries() < TAIL; i++) screen = await app.frame();
    expect(app.store.ui.scroll.following).toBe(false);
    expect(app.entries()).toBeGreaterThanOrEqual(TAIL);
    expect(screen).not.toContain("line 299");
  });
});
