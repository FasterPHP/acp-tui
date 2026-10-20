// day-two-feedback task 9.1, "the history starts afresh when the session changes": the real
// prompt box inside the App, a session switch (`store.replace` bumps `ui.epoch`), and Ctrl+Z.
// Needs the root bunfig `[test] preload`; run from the repository root.
import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createSession, reduce, type ModelEvent, type Session } from "acp-model";
import { compactConfig } from "./compact-config.ts";
import { App } from "../../src/app/App.tsx";
import type { AppActions, AppContextValue } from "../../src/app/context.ts";
import { DEFAULT_LAYOUT, resolveLayout } from "../../src/layout/layout.ts";
import { createSessionStore, type SessionSource, type SessionStore } from "../../src/session/store.ts";
import { DEFAULT_THEME, resolveTheme } from "../../src/theme/index.ts";

let setup: Awaited<ReturnType<typeof testRender>> | undefined;
let store: SessionStore | undefined;
afterEach(async () => {
  await setup?.dispose();
  store?.dispose();
  setup = undefined;
  store = undefined;
});

function source(id: string): SessionSource {
  let session: Session = createSession();
  const dispatch = (event: ModelEvent) => (session = reduce(session, event));
  dispatch({ type: "session_created", at: 0, cwd: "/home/x/proj", agentInfo: { name: "fake-agent", version: "1" }, response: { sessionId: id } });
  return { getSession: () => session, subscribe: () => () => {} };
}

const CTRL_Z = "\x1a";
const CTRL_Y = "\x19";

async function mount() {
  store = createSessionStore({ home: "/home/x" });
  const sent: string[] = [];
  const actions: AppActions = { prompt: (text) => (sent.push(text), { accepted: true }), cancel() {}, answerPermission: () => false, exit() {} };
  const context: AppContextValue = { store, actions, theme: resolveTheme(DEFAULT_THEME), config: compactConfig() };
  setup = await testRender(() => <App context={context} layout={resolveLayout(DEFAULT_LAYOUT)} />, { width: 80, height: 20, screenMode: "alternate-screen" });
  store.attach(source("s1"));
  const draft = async () => {
    await setup!.flush();
    await setup!.renderOnce();
    return setup!
      .captureCharFrame()
      .split("\n")
      .filter((l) => l.startsWith("│ "))
      .map((l) => l.replace(/^│ /, "").replace(/ *│$/, ""))
      .filter((l) => l !== "");
  };
  return { draft, sent };
}

describe("the prompt box's undo in the App", () => {
  test("Undo by word and redo through the real keys", async () => {
    const app = await mount();
    await setup!.mockInput.pressKeys(Array.from("fix the router"));
    expect(await app.draft()).toEqual(["fix the router"]);
    await setup!.mockInput.pressKeys([CTRL_Z]);
    expect(await app.draft()).toEqual(["fix the"]);
    await setup!.mockInput.pressKeys([CTRL_Z, CTRL_Z]);
    expect(await app.draft()).toEqual([]);
    await setup!.mockInput.pressKeys([CTRL_Y]);
    expect(await app.draft()).toEqual(["fix"]);
  });

  test("A session switch starts the history afresh: Ctrl+Z after it undoes nothing", async () => {
    const app = await mount();
    await setup!.mockInput.pressKeys(Array.from("hello world"));
    expect(await app.draft()).toEqual(["hello world"]);
    store!.replace(source("s2"));
    await setup!.flush();
    await setup!.mockInput.pressKeys([CTRL_Z]);
    expect(await app.draft()).toEqual(["hello world"]);
    // Typing after the switch is undone, and only that.
    await setup!.mockInput.pressKeys(Array.from(" again"));
    await setup!.mockInput.pressKeys([CTRL_Z]);
    expect(await app.draft()).toEqual(["hello world"]);
  });

  test("A sent prompt is not brought back: Ctrl+Z in the emptied prompt box leaves it empty", async () => {
    const app = await mount();
    await setup!.mockInput.pressKeys(Array.from("fix the router"));
    setup!.mockInput.pressEnter();
    expect(app.sent).toEqual(["fix the router"]);
    expect(await app.draft()).toEqual([]);
    await setup!.mockInput.pressKeys([CTRL_Z]);
    expect(await app.draft()).toEqual([]);
  });
});
