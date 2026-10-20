// In-process: the conversation block is mounted afresh for each session a
// switch attaches (`store.replace` bumps `ui.epoch`; mvp-sessions task 7.4),
// and a switch away from a session with items never reads a removed item
// (IDE check 10.2: under `--spike window` the switch failed with `undefined is
// not an object (evaluating 'tool().status')`, and from a session without tool
// calls with `... 'user().text'`, because the block was never remounted and
// the windowed list's components outlived the items they read).
// Needs the root bunfig `[test] preload`; run from the repository root.
import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { onCleanup } from "solid-js";
import { createSession, reduce, type ModelEvent, type Session } from "acp-model";
import { compactConfig } from "./compact-config.ts";
import { App, type AppProps } from "../../src/app/App.tsx";
import type { AppActions, AppContextValue } from "../../src/app/context.ts";
import { WindowedConversation } from "../../src/conversation/window/WindowedConversation.tsx";
import type { BlockComponent } from "../../src/layout/Screen.tsx";
import { DEFAULT_LAYOUT, resolveLayout } from "../../src/layout/layout.ts";
import { createSessionStore, type SessionSource, type SessionStore } from "../../src/session/store.ts";
import { DEFAULT_THEME, resolveTheme } from "../../src/theme/index.ts";

type Setup = Awaited<ReturnType<typeof testRender>>;
let setup: Setup | undefined;
let store: SessionStore | undefined;
afterEach(async () => {
  // OpenTUI 0.6: destroy and wait for the native session to close (opentui-0-6 design D7).
  await setup?.dispose();
  store?.dispose();
  setup = undefined;
  store = undefined;
});

const ROWS = 20;

/** A session source driven by model events. */
function source(): SessionSource & { dispatch(event: ModelEvent): void } {
  let session: Session = createSession();
  const listeners = new Set<(s: Session) => void>();
  return {
    getSession: () => session,
    subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
    dispatch(event) {
      session = reduce(session, event);
      for (const l of listeners) l(session);
    },
  };
}

/** A finished history: a user message, a thought, a read and an edit tool call, an answer. */
function withTools(s: ReturnType<typeof source>, id: string): void {
  s.dispatch({ type: "session_created", at: 0, cwd: "/home/x/proj", agentInfo: { name: "fake-agent", version: "1" }, response: { sessionId: id } });
  s.dispatch({ type: "prompt_sent", text: "Why does the router drop the query string?", at: 1 });
  const update = (u: Record<string, unknown>, at: number) => s.dispatch({ type: "session_update", at, update: u as never });
  update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Reading the router" } }, 2);
  update({ sessionUpdate: "tool_call", toolCallId: "t1", title: "Read src/Http/Router.php", kind: "read", status: "completed" }, 3);
  update({ sessionUpdate: "tool_call", toolCallId: "t2", title: "Edit src/Http/Router.php", kind: "edit", status: "completed" }, 4);
  update({ sessionUpdate: "tool_call", toolCallId: "t3", title: "Run vendor/bin/phpunit", kind: "execute", status: "failed" }, 5);
  update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "The edit is in." } }, 6);
  s.dispatch({ type: "prompt_response", at: 7, stopReason: "end_turn" });
}

/** A finished history without tool calls: a user message and an answer. */
function withoutTools(s: ReturnType<typeof source>, id: string): void {
  s.dispatch({ type: "session_created", at: 0, cwd: "/home/x/proj", agentInfo: { name: "fake-agent", version: "1" }, response: { sessionId: id } });
  s.dispatch({ type: "prompt_sent", text: "Add an Appointment model.", at: 1 });
  s.dispatch({ type: "session_update", at: 2, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Added the model." } } });
  s.dispatch({ type: "prompt_response", at: 3, stopReason: "end_turn" });
}

async function mount(blocks?: AppProps["blocks"]) {
  store = createSessionStore({ home: "/home/x" });
  const actions: AppActions = { prompt: () => null, cancel() {}, answerPermission: () => false, exit() {} };
  const context: AppContextValue = { store, actions, theme: resolveTheme(DEFAULT_THEME), config: compactConfig() };
  setup = await testRender(() => <App context={context} layout={resolveLayout(DEFAULT_LAYOUT)} {...(blocks ? { blocks } : {})} />, {
    width: 80,
    height: ROWS,
    screenMode: "alternate-screen",
  });
  const text = async () => {
    await setup!.flush();
    await setup!.renderOnce();
    return setup!.captureCharFrame();
  };
  /** Waits (a few frames at most) until the screen satisfies `ok`. */
  const until = async (ok: (screen: string) => boolean) => {
    let screen = await text();
    for (let i = 0; i < 50 && !ok(screen); i++) {
      await Bun.sleep(10);
      screen = await text();
    }
    return screen;
  };
  return { store, text, until };
}

describe("the conversation block across a switch", () => {
  test("store.replace mounts the conversation block afresh (the previous one is disposed)", async () => {
    let mounts = 0;
    let disposals = 0;
    const counted: BlockComponent = () => {
      mounts++;
      onCleanup(() => disposals++);
      return <WindowedConversation />;
    };
    const app = await mount({ conversation: counted });
    const a = source();
    withTools(a, "a");
    app.store.attach(a);
    await app.text();
    expect([mounts, disposals]).toEqual([1, 0]);
    const b = source();
    withoutTools(b, "b");
    app.store.replace(b);
    await app.text();
    expect([mounts, disposals]).toEqual([2, 1]);
    app.store.replace(null);
    await app.text();
    expect([mounts, disposals]).toEqual([3, 2]);
  });

  for (const [name, blocks] of [
    // The windowed list is the only list since mvp-conversation (design D1).
    ["the windowed list", undefined],
  ] as const) {
    for (const [from, history] of [
      ["with tool calls", withTools],
      ["without tool calls", withoutTools],
    ] as const) {
      test(`${name}: a switch from a session ${from} to an empty one and to another history reads no removed item`, async () => {
        const app = await mount(blocks);
        const a = source();
        history(a, "a");
        app.store.attach(a);
        const marker = history === withTools ? "Run vendor/bin/phpunit" : "Added the model.";
        expect(await app.until((s) => s.includes(marker))).toContain(marker);
        // A new session: nothing in it yet.
        const b = source();
        b.dispatch({ type: "session_created", at: 0, cwd: "/home/x/proj", agentInfo: { name: "other", version: "1" }, response: { sessionId: "b" } });
        expect(() => app.store.replace(b)).not.toThrow();
        const empty = await app.until((s) => !s.includes(marker));
        expect(empty).not.toContain(marker);
        // Let the windowed list's deferred re-read run.
        await Bun.sleep(20);
        expect(await app.text()).not.toContain(marker);
        // Back to a history (the other kind), then to the first again.
        const c = source();
        (history === withTools ? withoutTools : withTools)(c, "c");
        expect(() => app.store.replace(c)).not.toThrow();
        const other = history === withTools ? "Added the model." : "Run vendor/bin/phpunit";
        expect(await app.until((s) => s.includes(other))).toContain(other);
        expect(await app.text()).not.toContain(marker);
        expect(() => app.store.replace(a)).not.toThrow();
        expect(await app.until((s) => s.includes(marker))).toContain(marker);
        expect(await app.text()).not.toContain(other);
      });
    }
  }
});
