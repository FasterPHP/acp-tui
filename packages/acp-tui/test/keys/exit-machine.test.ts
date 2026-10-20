// Task 8.4 (Phase 0) and phase-1a task 8.2: every transition of the Esc and
// Ctrl+D state machine, a pure reducer (design D8; spec tui-keymap "Escape",
// "Detach and prompt box editing keys", "No single keypress exits"; spec
// tui-agent-session "Exit is detach"). mvp-chrome-and-keys task 3.1: Ctrl+C
// is no longer an input of the machine (tui-keymap "Ctrl+C precedence"), so
// nothing arms exit.
import { describe, expect, test } from "bun:test";
import { EXIT_WINDOW_MS, INITIAL_EXIT_STATE, exitStep, type ExitState, type KeyFacts } from "../../src/keys/exit-machine.ts";

const idleEmpty: KeyFacts = { now: 1000, composerEmpty: true, turnRunning: false };
const runningEmpty: KeyFacts = { now: 1000, composerEmpty: true, turnRunning: true };
const draft = (turnRunning: boolean): KeyFacts => ({ now: 1000, composerEmpty: false, turnRunning });
const armedDetach: ExitState = { armed: { kind: "detach", until: 1000 + EXIT_WINDOW_MS } };
const armedInterrupt: ExitState = { armed: { kind: "interrupt", until: 1000 + EXIT_WINDOW_MS } };

describe("disarming", () => {
  test("any other key disarms", () => {
    expect(exitStep(armedInterrupt, { type: "other-key" })).toEqual({ state: INITIAL_EXIT_STATE, effect: "none" });
    expect(exitStep(armedDetach, { type: "other-key" })).toEqual({ state: INITIAL_EXIT_STATE, effect: "none" });
    expect(exitStep(INITIAL_EXIT_STATE, { type: "other-key" })).toEqual({ state: INITIAL_EXIT_STATE, effect: "none" });
  });

  test("2 s passing disarms; an earlier tick does not", () => {
    expect(exitStep(armedDetach, { type: "tick", now: 1000 + EXIT_WINDOW_MS - 1 })).toEqual({ state: armedDetach, effect: "none" });
    expect(exitStep(armedDetach, { type: "tick", now: 1000 + EXIT_WINDOW_MS })).toEqual({ state: INITIAL_EXIT_STATE, effect: "none" });
    expect(exitStep(INITIAL_EXIT_STATE, { type: "tick", now: 99999 })).toEqual({ state: INITIAL_EXIT_STATE, effect: "none" });
  });

  test("after a disarm, Ctrl+D arms again rather than detaching", () => {
    const disarmed = exitStep(armedDetach, { type: "other-key" }).state;
    expect(exitStep(disarmed, { type: "detach", ...runningEmpty, now: 1100 }).effect).toBe("arm-detach");
  });
});

describe("Ctrl+D", () => {
  test("non-empty composer: not handled (the textarea deletes forward), disarms", () => {
    expect(exitStep(armedInterrupt, { type: "detach", ...draft(true), now: 1100 })).toEqual({ state: INITIAL_EXIT_STATE, effect: "pass" });
    expect(exitStep(INITIAL_EXIT_STATE, { type: "detach", ...draft(false) }).effect).toBe("pass");
  });

  test("empty composer, idle: detach at once", () => {
    expect(exitStep(INITIAL_EXIT_STATE, { type: "detach", ...idleEmpty })).toEqual({ state: INITIAL_EXIT_STATE, effect: "detach" });
  });

  test("empty composer, running turn: arm the confirmation", () => {
    expect(exitStep(INITIAL_EXIT_STATE, { type: "detach", ...runningEmpty })).toEqual({
      state: { armed: { kind: "detach", until: 1000 + EXIT_WINDOW_MS } },
      effect: "arm-detach",
    });
  });

  test("confirmed within 2 s: detach; after 2 s: asks again", () => {
    expect(exitStep(armedDetach, { type: "detach", ...runningEmpty, now: 2999 })).toEqual({ state: INITIAL_EXIT_STATE, effect: "detach" });
    expect(exitStep(armedDetach, { type: "detach", ...runningEmpty, now: 3000 }).effect).toBe("arm-detach");
  });
});

describe("Esc", () => {
  test("prompt box focused, running turn: arm interrupt for 2 s (a single press never cancels)", () => {
    for (const composerEmpty of [true, false]) {
      expect(exitStep(INITIAL_EXIT_STATE, { type: "escape", ...runningEmpty, composerEmpty })).toEqual({
        state: armedInterrupt,
        effect: "arm-interrupt",
      });
    }
  });

  test("second press within 2 s: cancel the turn, disarmed", () => {
    expect(exitStep(armedInterrupt, { type: "escape", ...runningEmpty, now: 2999 })).toEqual({ state: INITIAL_EXIT_STATE, effect: "cancel-turn" });
  });

  test("second press at or after 2 s: arms again instead of cancelling", () => {
    expect(exitStep(armedInterrupt, { type: "escape", ...runningEmpty, now: 3000 })).toEqual({
      state: { armed: { kind: "interrupt", until: 3000 + EXIT_WINDOW_MS } },
      effect: "arm-interrupt",
    });
  });

  test("2 s passing disarms; any other key disarms", () => {
    expect(exitStep(armedInterrupt, { type: "tick", now: 2999 }).state).toBe(armedInterrupt);
    expect(exitStep(armedInterrupt, { type: "tick", now: 3000 }).state).toEqual(INITIAL_EXIT_STATE);
    expect(exitStep(armedInterrupt, { type: "other-key" })).toEqual({ state: INITIAL_EXIT_STATE, effect: "none" });
  });

  test("idle: not handled (the key reaches the prompt box, which does nothing), disarms", () => {
    expect(exitStep(INITIAL_EXIT_STATE, { type: "escape", ...idleEmpty })).toEqual({ state: INITIAL_EXIT_STATE, effect: "pass" });
    expect(exitStep(armedDetach, { type: "escape", ...idleEmpty, now: 1100 })).toEqual({ state: INITIAL_EXIT_STATE, effect: "pass" });
    // The turn ended while armed: the second press does not cancel anything.
    expect(exitStep(armedInterrupt, { type: "escape", ...idleEmpty, now: 1100 })).toEqual({ state: INITIAL_EXIT_STATE, effect: "pass" });
  });

  test("conversation or card focused, idle: focus returns to the prompt box, nothing armed", () => {
    for (const state of [INITIAL_EXIT_STATE, armedInterrupt, armedDetach]) {
      expect(exitStep(state, { type: "escape", ...idleEmpty, now: 1100, promptFocused: false })).toEqual({
        state: INITIAL_EXIT_STATE,
        effect: "focus-prompt",
      });
    }
  });

  // mvp-chrome-and-keys task 3.4 (design D6 "Interrupt from the card"): two presses interrupt from
  // the prompt box, the conversation or the permission card.
  test("conversation or card focused, running turn: focus returns and interrupt arms in one press; a second press cancels", () => {
    for (const state of [INITIAL_EXIT_STATE, armedDetach]) {
      expect(exitStep(state, { type: "escape", ...runningEmpty, promptFocused: false })).toEqual({
        state: armedInterrupt,
        effect: "arm-interrupt",
        focusPrompt: true,
      });
    }
    expect(exitStep(armedInterrupt, { type: "escape", ...runningEmpty, now: 1100, promptFocused: false })).toEqual({
      state: INITIAL_EXIT_STATE,
      effect: "cancel-turn",
      focusPrompt: true,
    });
  });

  test("interrupt `single`: the Esc that would arm cancels, from any of the three; idle and away-from-prompt meanings unchanged", () => {
    expect(exitStep(INITIAL_EXIT_STATE, { type: "escape", ...runningEmpty, interrupt: "single" })).toEqual({ state: INITIAL_EXIT_STATE, effect: "cancel-turn" });
    expect(exitStep(INITIAL_EXIT_STATE, { type: "escape", ...runningEmpty, interrupt: "single", promptFocused: false })).toEqual({
      state: INITIAL_EXIT_STATE,
      effect: "cancel-turn",
      focusPrompt: true,
    });
    expect(exitStep(INITIAL_EXIT_STATE, { type: "escape", ...idleEmpty, interrupt: "single" }).effect).toBe("pass");
    expect(exitStep(INITIAL_EXIT_STATE, { type: "escape", ...idleEmpty, interrupt: "single", promptFocused: false }).effect).toBe("focus-prompt");
    // `double` is the default.
    expect(exitStep(INITIAL_EXIT_STATE, { type: "escape", ...runningEmpty, interrupt: "double" }).effect).toBe("arm-interrupt");
  });

  test("Esc while a detach confirmation is armed counts as a first press", () => {
    expect(exitStep(armedDetach, { type: "escape", ...runningEmpty, now: 1100 }).effect).toBe("arm-interrupt");
  });

  test("Ctrl+D while interrupt is armed counts as a first press of its own", () => {
    expect(exitStep(armedInterrupt, { type: "detach", ...runningEmpty, now: 1100 }).effect).toBe("arm-detach");
  });
});
