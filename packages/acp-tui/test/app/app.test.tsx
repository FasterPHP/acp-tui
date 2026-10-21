// In-process App test with OpenTUI's test renderer (no PTY): the screen layout
// (the conversation above the prompt box and the status row), the status row
// reading the session store, the prompt box submitting on Enter through the
// app's `prompt` action, and agent text drawn to imitate the permission card
// (spec tui-layout "Imitation in the conversation", with box characters and
// the marker glyph, which fake-agent's hostile chunk does not include). The
// pattern for component tests.
// Needs the root bunfig `[test] preload`; run from the repository root.
import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import type { RGBA } from "@opentui/core";
import { createSession, reduce, type ModelEvent, type Session } from "acp-model";
import { compactConfig } from "./compact-config.ts";
import { App } from "../../src/app/App.tsx";
import type { AppActions, AppContextValue } from "../../src/app/context.ts";
import { DEFAULT_LAYOUT, resolveLayout } from "../../src/layout/layout.ts";
import { createSessionStore, type SessionStore } from "../../src/session/store.ts";
import { DEFAULT_THEME, resolveTheme, type ResolvedTheme } from "../../src/theme/index.ts";

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

// 16 rows: the conversation has 9 rows below the margins (mvp-chrome-and-keys task 4.1), as it had
// 8 at 12 rows before them; the tests read rows from the bottom.
const ROWS = 16;

async function mount(prompt: AppActions["prompt"], theme: ResolvedTheme = resolveTheme(DEFAULT_THEME)) {
  let session: Session = createSession();
  const listeners = new Set<(s: Session) => void>();
  const dispatch = (event: ModelEvent) => {
    session = reduce(session, event);
    for (const l of listeners) l(session);
  };
  store = createSessionStore({ home: "/home/x" });
  const actions: AppActions = { prompt, cancel() {}, answerPermission: () => false, exit() {} };
  const context: AppContextValue = { store, actions, theme, config: compactConfig() };
  setup = await testRender(() => <App context={context} layout={resolveLayout(DEFAULT_LAYOUT)} />, {
    width: 80,
    height: ROWS,
    screenMode: "alternate-screen",
  });
  /** The screen's rows, right-trimmed. */
  const frame = async () => {
    await setup!.flush();
    await setup!.renderOnce();
    return setup!.captureCharFrame().split("\n").slice(0, ROWS).map((l) => l.trimEnd());
  };
  const created = () =>
    dispatch({ type: "session_created", at: 0, cwd: "/home/x/proj", agentInfo: { name: "fake-agent", version: "1" }, response: { sessionId: "s" } });
  const attach = () => store!.attach({ getSession: () => session, subscribe: (l) => (listeners.add(l), () => listeners.delete(l)) });
  return { dispatch, frame, attach, created };
}

describe("App in the test renderer", () => {
  test("status row shows starting, then the cwd, idle and connected once the session is attached", async () => {
    const app = await mount(() => null);
    // The status row is above the bottom margin (mvp-chrome-and-keys task 4.1).
    expect((await app.frame()).at(-2)).toMatch(/idle .*starting$/);
    app.created();
    app.attach();
    const rows = await app.frame();
    expect(rows.at(-1)).toBe("");
    expect(rows.at(-2)).toMatch(/^ ~\/proj {2}idle {2}shift\+tab mode {2}\/ commands {2}\? help {2}ctrl\+d detach +connected$/);
    // The prompt box: a rounded frame (one text row at 12 rows) above the spacer and the status row.
    // One text row, the padding row and the frame (day-one-feedback: the padding row below the text).
    expect(rows.slice(-7, -3)).toEqual([`╭${"─".repeat(78)}╮`, `│${" ".repeat(78)}│`, `│${" ".repeat(78)}│`, `╰${"─".repeat(78)}╯`]);
    expect(rows.at(-3)).toBe("");
  });

  test("the conversation fills the rows above the prompt box with the session's items", async () => {
    const app = await mount(() => null);
    app.created();
    app.attach();
    app.dispatch({ type: "prompt_sent", text: "hi there", at: 1 });
    app.dispatch({ type: "session_update", at: 2, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "An answer." } } });
    app.dispatch({ type: "session_update", at: 3, update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "Read a.ts", kind: "read", status: "in_progress" } });
    const conversation = async () => {
      const rows = await app.frame();
      return rows.slice(0, rows.findIndex((r) => r.startsWith("╭") || r.startsWith(" 1 running"))).filter((r) => r !== "");
    };
    // The Markdown renderable lays its blocks out over a few frames.
    for (let i = 0; i < 50 && !(await conversation()).includes("  An answer."); i++) await Bun.sleep(10);
    const rows = await conversation();
    // The user card (its accent cell and gutter are blank characters), the answer, and the tool
    // line: kind glyph, spinner, kind, title, and the index at the right edge, before the
    // conversation's two-column right margin (no scroll bar is mounted here).
    // The user card's text after its bar and two columns of padding (`cards.padding.columns`).
    expect(rows.slice(0, 2)).toEqual(["   hi there", "  An answer."]);
    expect(rows[2]).toMatch(/^ {2}→ [▖▘▝▗] read {5}Read a\.ts +#1$/);
    expect(rows[2]).toHaveLength(78);
    // The activity bar sits between the conversation and the prompt box while the tool runs.
    expect((await app.frame()).at(-8)).toBe("  1 running: Read a.ts");
  });

  test("Enter submits the prompt box's text and clears it when accepted", async () => {
    const sent: string[] = [];
    const app = await mount((text) => {
      sent.push(text);
      return { accepted: true };
    });
    app.attach();
    await setup!.mockInput.typeText("hello");
    expect((await app.frame()).at(-6)).toBe(`│ hello${" ".repeat(72)}│`);
    expect(store!.ui.promptEmpty).toBe(false);
    setup!.mockInput.pressEnter();
    expect(sent).toEqual(["hello"]);
    expect((await app.frame()).at(-6)).toBe(`│${" ".repeat(78)}│`);
    expect(store!.ui.promptEmpty).toBe(true);
  });

  test("a refused prompt keeps the text, with a notice in the prompt box's top border", async () => {
    const app = await mount(() => ({ accepted: false, reason: "turn_running" }));
    app.attach();
    await setup!.mockInput.typeText("wait");
    setup!.mockInput.pressEnter();
    const rows = await app.frame();
    // The notice in the middle of the top border (idle: no busy indicator's track).
    expect(rows.at(-7)).toBe(`╭${"─".repeat(17)} a turn is running: esc twice to cancel it ${"─".repeat(18)}╮`);
    expect(rows.at(-6)).toBe(`│ wait${" ".repeat(73)}│`);
  });
});

describe("imitation in the conversation (task 6.5)", () => {
  const same = (a: RGBA, b: RGBA) => a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

  test("agent text drawn like the card, box characters and marker glyph included: behind the agent gutter, no permission fill, the card region empty", async () => {
    const theme = resolveTheme(DEFAULT_THEME, { terminal: { foreground: "#bcbec4", background: "#191a1c" } });
    const app = await mount(() => null, theme);
    app.created();
    app.attach();
    app.dispatch({ type: "prompt_sent", text: "go", at: 1 });
    const fake = [
      "╭─ ◊ Permission  execute  #1 ────────╮",
      "│ rm -rf /                           │",
      "│ 1 allow once   2 reject once       │",
      "╰────────────────────────────────────╯",
    ].join("\n");
    app.dispatch({ type: "session_update", at: 2, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `\`\`\`\n${fake}\n\`\`\`\n` } } });
    let rows: string[] = [];
    for (let i = 0; i < 50; i++) {
      rows = await app.frame();
      if (rows.some((r) => r.includes("◊ Permission"))) break;
      await Bun.sleep(10);
    }
    const imitation = rows.flatMap((r, y) => (/[╭│╰]/.test(r) && y < rows.length - 7 ? [y] : []));
    expect(imitation.length).toBe(4);
    for (const y of imitation) expect(rows[y]!.startsWith("  ")).toBe(true);
    // No cell of those rows carries the permission card's fill.
    const fill = theme.color("surface.permission");
    const spans = setup!.captureSpans();
    for (const y of imitation) for (const span of spans.lines[y]!.spans) expect(same(span.bg, fill)).toBe(false);
    // The docked card region is empty: no request is open, so nothing sits between the
    // conversation and the prompt box.
    expect(store!.session.openPermissionId).toBeNull();
    expect(rows.at(-7)).toStartWith("╭─");
    expect(rows.at(-8)).not.toMatch(/awaiting permission/);
  });
});
