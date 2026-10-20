// mvp-configuration task 5.1 (design D6): a theme switch rebuilds the native styles drawn from the
// theme (the Markdown `SyntaxStyle` of the windowed conversation and the prompt box's mention style)
// under the renderer that owns them. Two test renderers run in one process at once, both drawing
// from one live theme; the switch must redraw each with the new colours, destroy the old styles,
// and never hand one renderer's style to the other (OpenTUI 0.6 refuses resources of another
// owner). Both renderers are disposed at the end.
// Needs the root bunfig `[test] preload`; run from the repository root.
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { SyntaxStyle, type RGBA } from "@opentui/core";
import { createSession, reduce, type ModelEvent, type Session } from "acp-model";
import { App } from "../../src/app/App.tsx";
import type { AppActions, AppContextValue } from "../../src/app/context.ts";
import { DEFAULT_LAYOUT, resolveLayout } from "../../src/layout/layout.ts";
import { createSessionStore, type SessionStore } from "../../src/session/store.ts";
import { fixedThemeSource } from "../../src/theme/compose.ts";
import { createLiveTheme, DEFAULT_THEME, withTokens, type TerminalColours } from "../../src/theme/index.ts";

type Setup = Awaited<ReturnType<typeof testRender>>;
const setups: Setup[] = [];
const stores: SessionStore[] = [];
afterEach(async () => {
  // OpenTUI 0.6: destroy and wait for the native session to close (opentui-0-6 design D7).
  for (const setup of setups.splice(0)) await setup.dispose();
  for (const store of stores.splice(0)) store.dispose();
});

const ROWS = 16;
const DARK: TerminalColours = { foreground: "#bcbec4", background: "#191a1c" };

async function mount(context: Omit<AppContextValue, "store" | "actions">) {
  let session: Session = createSession();
  const listeners = new Set<(s: Session) => void>();
  const dispatch = (event: ModelEvent) => {
    session = reduce(session, event);
    for (const l of listeners) l(session);
  };
  const store = createSessionStore({ home: "/home/x" });
  stores.push(store);
  const actions: AppActions = { prompt: () => null, cancel() {}, answerPermission: () => false, exit() {} };
  const setup = await testRender(() => <App context={{ ...context, store, actions }} layout={resolveLayout(DEFAULT_LAYOUT)} />, {
    width: 80,
    height: ROWS,
    screenMode: "alternate-screen",
  });
  setups.push(setup);
  dispatch({ type: "session_created", at: 0, cwd: "/home/x/proj", agentInfo: { name: "fake-agent", version: "1" }, response: { sessionId: "s" } });
  store.attach({ getSession: () => session, subscribe: (l) => (listeners.add(l), () => listeners.delete(l)) });
  dispatch({ type: "prompt_sent", text: "go", at: 1 });
  dispatch({ type: "session_update", at: 2, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello from the agent." } } });
  dispatch({ type: "prompt_response", at: 3, stopReason: "end_turn" });
  const frame = async () => {
    await setup.flush();
    await setup.renderOnce();
    return setup.captureCharFrame().split("\n").slice(0, ROWS);
  };
  /** The background of the user card's text and the foreground of the agent's text. */
  const colours = async () => {
    let rows = await frame();
    for (let i = 0; i < 50 && !rows.some((r) => r.includes("Hello from the agent.")); i++) {
      await Bun.sleep(10);
      rows = await frame();
    }
    const spans = setup.captureSpans().lines;
    const userRow = rows.findIndex((r) => /^\s*.\s*go\s*$/.test(r) || r.includes(" go"));
    const agentRow = rows.findIndex((r) => r.includes("Hello from the agent."));
    expect(userRow).toBeGreaterThanOrEqual(0);
    expect(agentRow).toBeGreaterThanOrEqual(0);
    const userSpan = spans[userRow]!.spans.find((s) => s.text.includes("go"))!;
    const agentText = spans[agentRow]!.spans.find((s) => s.text.includes("Hello"))!;
    return { userBg: userSpan.bg, agentFg: agentText.fg };
  };
  return { colours };
}

const ints = (c: RGBA) => c.toInts().slice(0, 3);

describe("A theme switch under two renderers (task 5.1)", () => {
  test("both renderers draw the new colours, the old styles are destroyed, both are disposed, and no owner error is thrown", async () => {
    const theme = createLiveTheme(fixedThemeSource(DEFAULT_THEME));
    theme.setTerminalColours(DARK);
    const created = spyOn(SyntaxStyle, "fromStyles");
    const made = spyOn(SyntaxStyle, "create");
    const a = await mount({ theme });
    const b = await mount({ theme });
    const before = [await a.colours(), await b.colours()];
    for (const c of before) {
      expect(ints(c.userBg)).toEqual(ints(theme.color("surface.user")));
      expect(ints(c.agentFg)).toEqual(ints(theme.color("text")));
    }
    // fromStyles makes its style through create, so the two lists can name one style twice.
    const made0 = () => [...new Set([...created.mock.results, ...made.mock.results].map((r) => r.value as SyntaxStyle))];
    const styles = made0();
    expect(styles.length).toBeGreaterThanOrEqual(4); // a Markdown style and a mention style per renderer
    const destroyed = styles.map((s) => spyOn(s, "destroy"));

    // The switch a configuration reload makes: another theme, with the user card and the body text
    // recoloured (the body text is also the Markdown style's default scope).
    const switched = withTokens(DEFAULT_THEME, { "surface.user": "#204060", text: 2 }, "mine");
    expect(theme.setSource(fixedThemeSource(switched))).toBe(true);
    const after = [await a.colours(), await b.colours()];
    for (const c of after) {
      expect(ints(c.userBg)).toEqual([0x20, 0x40, 0x60]);
      expect(ints(c.agentFg)).toEqual(ints(theme.color("text")));
      expect(ints(c.agentFg)).not.toEqual(ints(before[0]!.agentFg));
    }
    // Every style made before the switch was destroyed, and new ones were made for each renderer.
    for (const d of destroyed) expect(d).toHaveBeenCalledTimes(1);
    const later = made0().length - styles.length;
    expect(later).toBeGreaterThanOrEqual(4);
    created.mockRestore();
    made.mockRestore();
  });
});
