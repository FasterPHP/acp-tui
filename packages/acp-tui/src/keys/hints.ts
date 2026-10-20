// Key hints derived from the key map, so the hints bar names whatever key is
// actually bound (spec tui-keymap "Bindings are data"). A rule whose action
// has no key is left out.
import type { HintRule } from "../layout/modules.ts";
import { actionLabel, keyLabel, keysFor, type KeyMap } from "./keymap.ts";
import { DEFAULT_INTERRUPT, type InterruptSetting } from "./settings.ts";

/** `1-9` when choose1 and choose9 are single keys, else the first choose key's label. */
function chooseLabel(map: KeyMap): string | null {
  const first = keysFor(map, "card", "choose1")[0];
  const last = keysFor(map, "card", "choose9")[0];
  if (!first) return null;
  if (last && first.length === 1 && last.length === 1) return `${first}-${last}`;
  return keyLabel(first);
}

/** `tab tab` for a key pressed twice: the second press is what completes the action. */
function twice(label: string | null): string | null {
  return label === null ? null : `${label} ${label}`;
}

/** The interrupt hint's key under the `interrupt` setting in use (spec tui-config "Interrupt
 *  setting"): Esc twice under `double`, once under `single`; null when Esc has no key. */
export function interruptHintKey(map: KeyMap, interrupt: InterruptSetting = DEFAULT_INTERRUPT): string | null {
  const esc = actionLabel(map, "global", "escape");
  return interrupt === "single" ? esc : twice(esc);
}

// The armed two-press states are not hints: `turn-state` shows them (design D7). `interrupt` is
// the setting in use, so the interrupt hint names the presses it takes.
export function hintsForKeyMap(map: KeyMap, interrupt: InterruptSetting = DEFAULT_INTERRUPT): HintRule[] {
  const rules: (Omit<HintRule, "key"> & { key: string | null })[] = [
    // The most pressing first: a narrow status row keeps the leading hints.
    // The focus cycle is prompt box, conversation, card: from the prompt box the card is two
    // presses away, from the conversation one (task 8.3).
    { key: twice(actionLabel(map, "global", "toggleFocus")), label: "permission", when: { focus: "prompt", permissionOpen: true } },
    { key: chooseLabel(map), label: "select", when: { focus: "card" } },
    { key: actionLabel(map, "card", "confirm"), label: "answer", when: { focus: "card" } },
    { key: actionLabel(map, "global", "toggleFocus"), label: "prompt", when: { focus: "card" } },
    // The conversation's own keys, alone: Esc there returns to the prompt box (task 7.4).
    { key: actionLabel(map, "conversation", "toggle"), label: "toggle", when: { focus: "conversation" }, exclusive: true },
    { key: actionLabel(map, "conversation", "back"), label: "prompt", when: { focus: "conversation" }, exclusive: true },
    { key: actionLabel(map, "global", "toggleFocus"), label: "permission", when: { focus: "conversation", permissionOpen: true }, exclusive: true },
    // Esc interrupts on a double press (task 8.2), the first press arming it, or on one under
    // `interrupt: single`.
    { key: interruptHintKey(map, interrupt), label: "interrupt", when: { turn: "running" } },
    // No send or newline hints: the splash and key help show them (mvp-chrome-and-keys design D5).
    // An idle, focused prompt box: the mode key first, so it keeps its place when the others leave,
    // then for an empty box the agent's commands (`/`), the command palette (`?`; task 12.1) and
    // detach. `/` and `?` are text in a draft, so their hints leave (Marcus, 11 October 2026; task 12.8).
    { key: actionLabel(map, "global", "cycleMode"), label: "mode", when: { turn: "idle", focus: "prompt" } },
    { key: actionLabel(map, "prompt", "agentCommands"), label: "commands", when: { turn: "idle", promptEmpty: true, focus: "prompt" } },
    { key: actionLabel(map, "prompt", "palette"), label: "help", when: { turn: "idle", promptEmpty: true, focus: "prompt" } },
    { key: actionLabel(map, "global", "detach"), label: "detach", when: { turn: "idle", promptEmpty: true, focus: "prompt" } },
  ];
  return rules.filter((r): r is HintRule => r.key !== null);
}
