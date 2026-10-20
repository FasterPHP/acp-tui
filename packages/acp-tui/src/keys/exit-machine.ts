// The two-press state machine for Esc and Ctrl+D (design D8; spec tui-keymap
// "Escape", "Detach and prompt box editing keys", "No single keypress exits";
// spec tui-agent-session "Exit is detach"). A pure reducer: the key controller
// feeds it key presses and clock ticks and carries out the effect it returns.
// The armed state is shown in the status row's `turn-state`. Ctrl+C is not
// here: it is the selection's `copy` and nothing else (mvp-chrome-and-keys
// design D11, tui-keymap "Ctrl+C precedence"), so it never clears, cancels,
// arms exit or exits.
//
// Esc (what an open overlay, the find bar, a selection or the elicitation
//   card takes never reaches here): focus in the conversation or the
//   permission card -> back to the prompt box as well; then, while a turn
//   runs, the first Esc arms interrupt ("Esc again to interrupt") and a
//   second within 2 s cancels it, so two presses interrupt from any of the
//   three (mvp-chrome-and-keys design D6, D11); with the `interrupt` setting
//   at `single`, the Esc that would arm cancels instead. Idle: back to the
//   prompt box from the conversation or the card, and in the prompt box not
//   ours.
// Ctrl+D: non-empty prompt box -> not ours (the textarea deletes forward);
//   idle -> detach at once; running turn -> arm a confirmation that says
//   closing a direct agent stops its running turn; a second Ctrl+D within 2 s
//   detaches.
// Any other key, or the window passing, disarms. One of these keys while
// another's state is armed disarms it and counts as a first press.

import type { InterruptSetting } from "./settings.ts";

export const EXIT_WINDOW_MS = 2000;

export type ArmKind = "detach" | "interrupt";

export interface ExitState {
  readonly armed: { readonly kind: ArmKind; readonly until: number } | null;
}

export const INITIAL_EXIT_STATE: ExitState = { armed: null };

export interface KeyFacts {
  readonly now: number;
  readonly composerEmpty: boolean;
  /** A turn is running or waiting for a permission answer. */
  readonly turnRunning: boolean;
  /** The prompt box has focus (not the conversation or the card); default true. */
  readonly promptFocused?: boolean;
  /** The internal `interrupt` setting (keys/settings.ts); default `double`. */
  readonly interrupt?: InterruptSetting;
}

export type ExitInput =
  | ({ readonly type: "escape" } & KeyFacts)
  | ({ readonly type: "detach" } & KeyFacts)
  | { readonly type: "other-key" }
  | { readonly type: "tick"; readonly now: number };

export type ExitEffect =
  /** Nothing to do beyond the state change (a disarm, or a tick before expiry). */
  | "none"
  | "cancel-turn"
  /** Esc outside the prompt box while idle: focus returns to it, nothing else. */
  | "focus-prompt"
  | "arm-interrupt"
  | "arm-detach"
  | "detach"
  /** The key is not handled here; let it reach the focused component. */
  | "pass";

export interface ExitStep {
  readonly state: ExitState;
  readonly effect: ExitEffect;
  /** Esc from the conversation or the card during a turn: focus also returns to the prompt box,
   *  in the same press as the arm or the cancel. */
  readonly focusPrompt?: true;
}

function armedFor(state: ExitState, kind: ArmKind, now: number): boolean {
  return state.armed !== null && state.armed.kind === kind && now < state.armed.until;
}

const DISARMED: ExitState = INITIAL_EXIT_STATE;

export function exitStep(state: ExitState, input: ExitInput): ExitStep {
  switch (input.type) {
    case "other-key":
      return { state: DISARMED, effect: "none" };

    case "tick":
      if (state.armed && input.now >= state.armed.until) return { state: DISARMED, effect: "none" };
      return { state, effect: "none" };

    case "escape": {
      const away = input.promptFocused === false;
      if (!input.turnRunning) return { state: DISARMED, effect: away ? "focus-prompt" : "pass" };
      const focus = away ? ({ focusPrompt: true } as const) : {};
      if (input.interrupt === "single" || armedFor(state, "interrupt", input.now)) return { state: DISARMED, effect: "cancel-turn", ...focus };
      return { state: { armed: { kind: "interrupt", until: input.now + EXIT_WINDOW_MS } }, effect: "arm-interrupt", ...focus };
    }

    case "detach":
      if (!input.composerEmpty) return { state: DISARMED, effect: "pass" };
      if (!input.turnRunning) return { state: DISARMED, effect: "detach" };
      if (armedFor(state, "detach", input.now)) return { state: DISARMED, effect: "detach" };
      return { state: { armed: { kind: "detach", until: input.now + EXIT_WINDOW_MS } }, effect: "arm-detach" };
  }
}
