// Task 8.4 (Phase 0; phase-1a task 6.2 moved the armed states into the store,
// for the status row's `turn-state`): the key controller's global handlers
// against a real session store with a manual clock: Esc (the armed interrupt
// and focus return, phase-1a task 8.2), `interrupt` (no default key since
// mvp-chrome-and-keys task 3.1), the armed Ctrl+D confirmation, Tab focus (task 8.3), PgUp and PgDn, and
// the Ctrl+O, Ctrl+L and F2 hooks.
import { afterEach, describe, expect, test } from "bun:test";
import { createSession, reduce, type ModelEvent, type Session } from "acp-model";
import type { AppActions } from "../../src/app/context.ts";
import { armedState, createKeyController, MOUSE_OFF_NOTICE, NO_TOOL_CALLS_NOTICE, type KeyController } from "../../src/keys/controller.ts";
import { EXIT_WINDOW_MS } from "../../src/keys/exit-machine.ts";
import { DEFAULT_KEY_MAP, loadKeyMap } from "../../src/keys/keymap.ts";
import type { InterruptSetting } from "../../src/keys/settings.ts";
import type { DebugLogEntry } from "../../src/log.ts";
import { createSessionStore, type SessionStore } from "../../src/session/store.ts";

let store: SessionStore | undefined;
let controller: KeyController | undefined;
afterEach(() => {
  controller?.dispose();
  store?.dispose();
});

function setup(extra: Partial<AppActions> = {}, interrupt?: InterruptSetting) {
  let session: Session = createSession();
  const listeners = new Set<(s: Session) => void>();
  const dispatch = (event: ModelEvent) => {
    session = reduce(session, event);
    for (const l of listeners) l(session);
  };
  store = createSessionStore({ home: null });
  store.attach({ getSession: () => session, subscribe: (l) => (listeners.add(l), () => listeners.delete(l)) });
  dispatch({ type: "session_created", at: 0, cwd: "/w", response: { sessionId: "s" } });

  const calls: string[] = [];
  const actions: AppActions = {
    prompt: () => ({ accepted: true }),
    cancel: () => void calls.push("cancel"),
    answerPermission: () => true,
    exit: () => void calls.push("exit"),
    ...extra,
  };
  let clock = 1000;
  const timers: { at: number; fn: () => void; live: boolean }[] = [];
  const logged: DebugLogEntry[] = [];
  controller = createKeyController({
    store,
    actions,
    keyMap: DEFAULT_KEY_MAP,
    ...(interrupt ? { interrupt } : {}),
    logger: { enabled: true, log: (entry) => void logged.push(entry) },
    now: () => clock,
    setTimer: (fn, ms) => {
      const t = { at: clock + ms, fn, live: true };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => void ((t as { live: boolean }).live = false),
  });
  let cleared = 0;
  controller.setComposer({ clear: () => void cleared++ });
  const advance = (ms: number) => {
    clock += ms;
    for (const t of timers) if (t.live && t.at <= clock) (t.live = false), t.fn();
  };
  const running = () => dispatch({ type: "prompt_sent", text: "x", at: 1 });
  const permission = () =>
    dispatch({
      type: "permission_opened",
      toolCallId: "t1",
      at: 2,
      request: { sessionId: "s", toolCall: { toolCallId: "t1", title: "Edit a" }, options: [{ optionId: "a", name: "A", kind: "allow_once" }] },
    });
  return { s: store, c: controller, calls, advance, running, permission, dispatch, cleared: () => cleared, logged };
}

// mvp-chrome-and-keys task 3.1: `interrupt` has no default key (Ctrl+C is the selection's `copy`,
// tui-keymap "Ctrl+C precedence"); it is the palette's `Interrupt the turn`.
describe("interrupt (no default key)", () => {
  test("Ctrl+C is bound to no global action, and `interrupt` to no key", () => {
    expect(DEFAULT_KEY_MAP.global["ctrl+c"]).toBeUndefined();
    expect(Object.values(DEFAULT_KEY_MAP.global)).not.toContain("interrupt");
  });

  test("running turn: cancels at once, stays open and disarms an armed interrupt", () => {
    const { s, c, calls, running } = setup();
    running();
    c.handlers.escape();
    expect(s.ui.armed?.kind).toBe("interrupt");
    expect(c.handlers.interrupt()).toBe(true);
    expect(calls).toEqual(["cancel"]);
    expect(s.ui.armed).toBeNull();
  });

  test("idle: not handled; nothing armed, cleared, sent or exited, with or without a draft", () => {
    const { s, c, calls, cleared, advance } = setup();
    expect(c.handlers.interrupt()).toBe(false);
    advance(500);
    expect(c.handlers.interrupt()).toBe(false);
    s.setPromptEmpty(false);
    expect(c.handlers.interrupt()).toBe(false);
    expect(calls).toEqual([]);
    expect(cleared()).toBe(0);
    expect(s.ui.armed).toBeNull();
  });
});

describe("Ctrl+D through the controller", () => {
  test("idle, empty composer: exits at once", () => {
    const { c, calls } = setup();
    expect(c.handlers.detach()).toBe(true);
    expect(calls).toEqual(["exit"]);
  });

  test("non-empty prompt box: not handled, so the textarea gets it", () => {
    const { s, c, calls } = setup();
    s.setPromptEmpty(false);
    expect(c.handlers.detach()).toBe(false);
    expect(calls).toEqual([]);
  });

  test("running: arms the confirmation (turn-state), second press detaches without cancelling", () => {
    const { s, c, calls, running } = setup();
    running();
    c.handlers.detach();
    expect(calls).toEqual([]);
    expect(s.ui.armed).toEqual({ kind: "detach", key: "ctrl+d" });
    expect(s.ui.notices).toEqual([]);
    c.handlers.detach();
    expect(calls).toEqual(["exit"]);
  });

  test("running: the confirmation goes away after 2 s or on another key", () => {
    const { s, c, calls, running, advance } = setup();
    running();
    c.handlers.detach();
    advance(EXIT_WINDOW_MS);
    expect(s.ui.armed).toBeNull();
    c.handlers.detach();
    expect(s.ui.armed?.kind).toBe("detach");
    c.otherKey();
    expect(s.ui.armed).toBeNull();
    c.handlers.detach();
    expect(calls).toEqual([]);
  });

  test("the armed state names the key bound in the key map in use", () => {
    const map = loadKeyMap({ global: { "ctrl+q": "detach" } });
    expect(armedState(map, "detach")).toEqual({ kind: "detach", key: "ctrl+d" });
    const rebound = loadKeyMap({ global: { "ctrl+q": "detach", "ctrl+d": "repaint" } });
    expect(armedState(rebound, "detach")).toEqual({ kind: "detach", key: "ctrl+q" });
    expect(armedState(DEFAULT_KEY_MAP, "interrupt")).toEqual({ kind: "interrupt", key: "esc" });
  });
});

describe("Esc, Tab, Ctrl+O, Ctrl+L", () => {
  test("Esc while idle in the prompt box: not handled, nothing armed", () => {
    const { s, c, calls } = setup();
    expect(c.handlers.escape()).toBe(false);
    expect(s.ui.armed).toBeNull();
    expect(calls).toEqual([]);
  });

  test("Esc during a turn: the first press arms interrupt (turn-state names the key), the second within 2 s cancels", () => {
    const { s, c, calls, running, advance } = setup();
    running();
    expect(c.handlers.escape()).toBe(true);
    expect(s.ui.armed).toEqual({ kind: "interrupt", key: "esc" });
    expect(calls).toEqual([]);
    advance(EXIT_WINDOW_MS - 1);
    expect(c.handlers.escape()).toBe(true);
    expect(calls).toEqual(["cancel"]);
    expect(s.ui.armed).toBeNull();
  });

  test("Esc during a turn, then 2 s: the armed interrupt disappears and the turn keeps running", () => {
    const { s, c, calls, running, advance } = setup();
    running();
    c.handlers.escape();
    advance(EXIT_WINDOW_MS);
    expect(s.ui.armed).toBeNull();
    expect(calls).toEqual([]);
    // Another key in between disarms too.
    c.handlers.escape();
    c.otherKey();
    expect(s.ui.armed).toBeNull();
    c.handlers.escape();
    expect(calls).toEqual([]);
  });

  test("Esc with the conversation or the card focused while idle: focus returns to the prompt box, nothing armed", () => {
    const { s, c, calls } = setup();
    for (const focus of ["conversation", "card"] as const) {
      s.setFocus(focus);
      expect(c.handlers.escape()).toBe(true);
      expect(s.ui.focus).toBe("prompt");
      expect(s.ui.armed).toBeNull();
      // The regions' own `back` action does the same.
      s.setFocus(focus);
      c.back();
      expect(s.ui.focus).toBe("prompt");
      expect(s.ui.armed).toBeNull();
    }
    expect(calls).toEqual([]);
  });

  // mvp-chrome-and-keys task 3.4 (design D6 "Interrupt from the card").
  test("Esc from the conversation or the card during a turn: focus returns and interrupt arms in one press; the second press cancels", () => {
    const { s, c, calls, running, permission, advance } = setup();
    running();
    permission();
    for (const focus of ["conversation", "card"] as const) {
      s.setFocus(focus);
      c.back();
      expect(s.ui.focus).toBe("prompt");
      expect(s.ui.armed).toEqual({ kind: "interrupt", key: "esc" });
      expect(calls).toEqual([]);
      advance(EXIT_WINDOW_MS);
      expect(s.ui.armed).toBeNull();
    }
    s.setFocus("card");
    c.back();
    advance(EXIT_WINDOW_MS - 1);
    expect(c.handlers.escape()).toBe(true);
    expect(calls).toEqual(["cancel"]);
    expect(s.ui.armed).toBeNull();
  });

  test("back from a region turns a pending detach confirmation into an armed interrupt", () => {
    const { s, c, running } = setup();
    running();
    c.handlers.detach();
    expect(s.ui.armed?.kind).toBe("detach");
    s.setFocus("conversation");
    c.back();
    expect(s.ui.armed?.kind).toBe("interrupt");
  });

  test("interrupt `single`: one Esc cancels from the prompt box, and from the card with focus returned; idle Esc unchanged", () => {
    const { s, c, calls, running, permission } = setup({}, "single");
    expect(c.handlers.escape()).toBe(false);
    running();
    expect(c.handlers.escape()).toBe(true);
    expect(calls).toEqual(["cancel"]);
    expect(s.ui.armed).toBeNull();
    permission();
    s.setFocus("card");
    c.back();
    expect(s.ui.focus).toBe("prompt");
    expect(calls).toEqual(["cancel", "cancel"]);
    expect(s.ui.armed).toBeNull();
  });

  test("Tab cycles prompt box, conversation, prompt box; with a card open, prompt box, conversation, card", () => {
    const { s, c, running, permission } = setup();
    expect(c.handlers.toggleFocus()).toBe(true);
    expect(s.ui.focus).toBe("conversation");
    c.handlers.toggleFocus();
    expect(s.ui.focus).toBe("prompt");
    running();
    permission();
    c.handlers.toggleFocus();
    expect(s.ui.focus).toBe("conversation");
    c.handlers.toggleFocus();
    expect(s.ui.focus).toBe("card");
    c.handlers.toggleFocus();
    expect(s.ui.focus).toBe("prompt");
  });

  test("F2: the toggle action, or a notice when the mouse was switched off on the command line", () => {
    const toggles: string[] = [];
    const { s, c } = setup({ toggleMouse: () => toggles.push("toggle") > 0 });
    expect(c.handlers.toggleMouse()).toBe(true);
    expect(toggles).toEqual(["toggle"]);
    expect(s.ui.notices).toEqual([]);
    const off = setup({ toggleMouse: () => false });
    off.c.handlers.toggleMouse();
    expect(off.s.ui.notices.at(-1)?.text).toBe(MOUSE_OFF_NOTICE);
  });

  test("PgUp and PgDn page the conversation once it has registered; not handled before", () => {
    const { c } = setup();
    expect(c.handlers.pageUp()).toBe(false);
    const pages: number[] = [];
    c.setConversation({ page: (direction) => void pages.push(direction), toBottom: () => {}, first: () => {}, last: () => {}, toggleTool: () => true });
    expect(c.handlers.pageUp()).toBe(true);
    expect(c.handlers.pageDown()).toBe(true);
    expect(pages).toEqual([-1, 1]);
  });

  test("Ctrl+O: toggles through the conversation; the no-tool-call notice when it has none or is not mounted", () => {
    const { s, c } = setup();
    c.handlers.toggleTool();
    expect(s.ui.notices.at(-1)?.text).toBe(NO_TOOL_CALLS_NOTICE);
    const toggled: string[] = [];
    c.setConversation({ page: () => {}, toBottom: () => {}, first: () => {}, last: () => {}, toggleTool: () => toggled.push("toggle") > 0 });
    const before = s.ui.notices.length;
    expect(c.handlers.toggleTool()).toBe(true);
    expect(toggled).toEqual(["toggle"]);
    expect(s.ui.notices).toHaveLength(before);
    c.setConversation({ page: () => {}, toBottom: () => {}, first: () => {}, last: () => {}, toggleTool: () => false });
    c.handlers.toggleTool();
    expect(s.ui.notices).toHaveLength(before + 1);
    expect(s.ui.notices.at(-1)?.text).toBe(NO_TOOL_CALLS_NOTICE);
  });

  test("Ctrl+L: the repaint action, or a notice until it exists", () => {
    const { s, c, advance } = setup();
    c.handlers.repaint();
    expect(s.ui.notices.at(-1)?.text).toBe("repaint not yet available");
    advance(3000);
    expect(s.ui.notices).toEqual([]);
    const repainted: string[] = [];
    setup({ repaint: () => void repainted.push("repaint") }).c.handlers.repaint();
    expect(repainted).toEqual(["repaint"]);
  });
});

describe("debug log (ACP_TUI_LOG)", () => {
  test("logs each global action, the exit machine's effect and its state transitions", () => {
    const { c, advance, logged, running } = setup();
    running();
    c.handlers.detach();
    advance(EXIT_WINDOW_MS);
    c.handlers.detach();
    c.handlers.detach();
    expect(logged).toEqual([
      { event: "exit_state", from: "disarmed", to: "detach", input: "detach" },
      { event: "exit_effect", key: "detach", effect: "arm-detach", composerEmpty: true, turnRunning: true },
      { event: "key_action", action: "detach", handled: true },
      { event: "exit_state", from: "detach", to: "disarmed", input: "tick" },
      { event: "exit_state", from: "disarmed", to: "detach", input: "detach" },
      { event: "exit_effect", key: "detach", effect: "arm-detach", composerEmpty: true, turnRunning: true },
      { event: "key_action", action: "detach", handled: true },
      { event: "exit_state", from: "detach", to: "disarmed", input: "detach" },
      { event: "exit_effect", key: "detach", effect: "detach", composerEmpty: true, turnRunning: true },
      { event: "key_action", action: "detach", handled: true },
    ]);
  });
});
