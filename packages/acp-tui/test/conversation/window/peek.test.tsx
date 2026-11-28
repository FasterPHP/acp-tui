// expand-and-density (spec tui-conversation "Ctrl+O puts back what it opened", "Switching
// density"): Ctrl+O's peek in process, at 100x30 in the default `focus` density, with a session
// source the test drives, so that calls can start between two presses:
// - the second press closes the call and the focus line the first opened;
// - a call that starts between the presses takes the peek over, the line staying open, and the
//   next press closes both;
// - a line the user opened stays open; only the call is put back;
// - `v` forgets every toggle and every open line.
// Needs the root bunfig `[test] preload`.
import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createSession, reduce, type ModelEvent, type Session } from "acp-model";
import { App } from "../../../src/app/App.tsx";
import type { AppActions, AppContextValue } from "../../../src/app/context.ts";
import { DEFAULT_LAYOUT, resolveLayout } from "../../../src/layout/layout.ts";
import { createSessionStore, type SessionSource, type SessionStore } from "../../../src/session/store.ts";
import { DEFAULT_THEME, resolveTheme } from "../../../src/theme/index.ts";

type Setup = Awaited<ReturnType<typeof testRender>>;
let setup: Setup | undefined;
let store: SessionStore | undefined;
afterEach(async () => {
  await setup?.dispose();
  store?.dispose();
  setup = undefined;
  store = undefined;
});

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

const macrotask = () => new Promise((resolve) => setTimeout(resolve, 0));

async function mount() {
  store = createSessionStore({ home: "/home/x" });
  const actions: AppActions = { prompt: () => null, cancel() {}, answerPermission: () => false, exit() {} };
  const context: AppContextValue = { store, actions, theme: resolveTheme(DEFAULT_THEME) };
  setup = await testRender(() => <App context={context} layout={resolveLayout(DEFAULT_LAYOUT)} />, {
    width: 100,
    height: 30,
    screenMode: "alternate-screen",
  });
  const s = source();
  let at = 0;
  s.dispatch({ type: "session_created", at: at++, cwd: "/home/x/proj", agentInfo: { name: "fake-agent", version: "1" }, response: { sessionId: "s" } });
  store.attach(s);
  const update = (u: unknown) => s.dispatch({ type: "session_update", at: at++, update: u } as ModelEvent);
  const frame = async () => {
    await macrotask();
    await setup!.flush();
    await setup!.renderOnce();
    await setup!.flush();
    await setup!.renderOnce();
    return setup!.captureCharFrame();
  };
  const message = (id: string, text: string) => update({ sessionUpdate: "agent_message_chunk", messageId: id, content: { type: "text", text } });
  const call = (n: number, status = "in_progress") =>
    update({
      sessionUpdate: "tool_call",
      toolCallId: `c${n}`,
      title: `Run step ${n}`,
      kind: "execute",
      status,
      content: [{ type: "content", content: { type: "text", text: `output of step ${n}` } }],
    });
  const key = async (name: string, modifiers: { ctrl?: boolean } = {}) => {
    const keys = setup!.mockInput;
    if (name === "tab") keys.pressTab();
    else if (name === "return") keys.pressEnter();
    else if (name === "up") keys.pressArrow("up");
    else keys.pressKey(name, modifiers);
    return frame();
  };
  return { frame, message, call, key };
}

const line = (screen: string) => screen.split("\n").find((r) => /^ {2}[▸▾] \d+ tool calls?/.test(r)) ?? null;

describe("Ctrl+O puts back what it opened (focus)", () => {
  test("the second press closes the call and the focus line the first opened", async () => {
    const app = await mount();
    app.message("m1", "Working on it.");
    app.call(1, "completed");
    app.call(2, "completed");
    const pristine = await app.frame();
    expect(line(pristine)).toMatch(/▸ 2 tool calls/);
    expect(pristine).not.toContain("Run step");

    let screen = await app.key("o", { ctrl: true });
    expect(line(screen)).toMatch(/▾ 2 tool calls/);
    expect(screen).toContain("output of step 2");
    expect(screen).not.toContain("output of step 1");

    screen = await app.key("o", { ctrl: true });
    expect(screen).toBe(pristine);
  });

  test("a call that starts between the presses takes the peek over; the next press closes the line and the new call", async () => {
    const app = await mount();
    app.message("m1", "Working on it.");
    app.call(1, "completed");
    app.call(2);
    await app.frame();
    let screen = await app.key("o", { ctrl: true });
    expect(screen).toContain("output of step 2");

    app.call(3);
    screen = await app.frame();
    expect(line(screen)).toMatch(/▾ 3 tool calls/);
    // The newest call is the target now: step 2 is put back and step 3 shown, the line still open.
    screen = await app.key("o", { ctrl: true });
    expect(line(screen)).toMatch(/▾ 3 tool calls/);
    expect(screen).toContain("output of step 3");
    expect(screen).not.toContain("output of step 2");

    screen = await app.key("o", { ctrl: true });
    expect(line(screen)).toMatch(/▸ 3 tool calls/);
    expect(screen).not.toContain("Run step");
  });

  test("a line the user opened stays open: only the call is put back", async () => {
    const app = await mount();
    app.message("m1", "Working on it.");
    app.call(1, "completed");
    app.call(2, "completed");
    await app.frame();
    // Tab to the conversation (the cursor on the last entry, the line), Enter opens it.
    await app.key("tab");
    let screen = await app.key("return");
    expect(line(screen)).toMatch(/▾ 2 tool calls/);
    const opened = screen;
    screen = await app.key("o", { ctrl: true });
    expect(screen).toContain("output of step 2");
    screen = await app.key("o", { ctrl: true });
    expect(line(screen)).toMatch(/▾ 2 tool calls/);
    expect(screen).not.toContain("output of step 2");
    expect(screen).toBe(opened);
  });

  test("a press after the user changed the call is a first press again", async () => {
    const app = await mount();
    app.message("m1", "Working on it.");
    app.call(1, "completed");
    app.call(2, "completed");
    await app.frame();
    await app.key("o", { ctrl: true });
    // Tab: the cursor on the last entry, the call the press expanded; Enter collapses it.
    await app.key("tab");
    let screen = await app.key("return");
    expect(screen).not.toContain("output of step 2");
    // Ctrl+O now expands the call again, and the next one collapses only the call: the line was
    // opened by a press whose peek the user's change ended.
    screen = await app.key("o", { ctrl: true });
    expect(screen).toContain("output of step 2");
    screen = await app.key("o", { ctrl: true });
    expect(line(screen)).toMatch(/▾ 2 tool calls/);
    expect(screen).not.toContain("output of step 2");
  });
});

describe("a density switch resets every entry", () => {
  test("v twice and back to focus: the screen as it was before any toggle", async () => {
    const app = await mount();
    app.message("m1", "Working on it.");
    app.call(1, "completed");
    app.call(2, "completed");
    app.message("m2", "Done.");
    app.call(3, "completed");
    const pristine = await app.frame();
    // Ctrl+O opens the last line; Enter on the first line opens it too.
    await app.key("o", { ctrl: true });
    await app.key("tab");
    for (let i = 0; i < 3; i++) await app.key("up");
    let screen = await app.key("return");
    expect(screen.split("\n").filter((r) => /^ {2}▾ /.test(r))).toHaveLength(2);

    // compact: every call collapsed, step 3 included.
    screen = await app.key("v");
    expect(screen).toContain("Run step 3");
    expect(screen).not.toContain("output of step");
    // verbose: every call expanded; Ctrl+O collapses the latest.
    screen = await app.key("v");
    expect(screen).toContain("output of step 1");
    screen = await app.key("o", { ctrl: true });
    expect(screen).not.toContain("output of step 3");
    // focus: every line closed, as before any toggle.
    screen = await app.key("v");
    expect(screen.split("\n").filter((r) => /^ {2}▾ /.test(r))).toHaveLength(0);
    expect(screen).not.toContain("Run step");
    // The conversation's rows (the chrome differs: the notice, the focus's hints).
    const conversation = (text: string) => text.split("\n").slice(0, text.split("\n").findIndex((r) => r.startsWith("╭")));
    expect(conversation(screen)).toEqual(conversation(pristine));
  });
});
