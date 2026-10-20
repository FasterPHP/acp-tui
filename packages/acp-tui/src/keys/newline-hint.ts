// Which key the splash and key help name for a newline in the prompt box (windows-support design
// D7; spec tui-keymap "Newline key in Windows Terminal"). Shift+Enter is the newline key
// everywhere it can arrive: PhpStorm and IntelliJ send `ESC CR`, Zed `\n`, and a terminal that
// answers the kitty keyboard query sends `CSI 13;2u`, Windows Terminal 1.25 and later included.
// Windows Terminal 1.24 and older do not answer, and send Shift+Enter as a bare `\r`, which is
// Enter: there the newline key is Ctrl+Enter (`\n`). So the hint is `ctrl+enter` only when the
// terminal is `windows-terminal` and OpenTUI's `capabilities.kitty_keyboard` is false, and the
// key map's first newline key otherwise (`shift+enter` by default). The key map itself binds
// Ctrl+Enter to newline in both encodings (`linefeed` and `ctrl+return`), whatever the terminal.
//
// The kitty answer arrives after start-up, so the state is a signal: a splash or help list that
// reads the label re-runs when the answer comes. Nothing here is set outside Windows Terminal, so
// Linux and macOS never see the Ctrl+Enter hint.
import { createSignal } from "solid-js";
import type { TerminalId } from "../renderer/terminal-ids.ts";
import { keyLabel, keysFor, normaliseKey, type KeyMap } from "./keymap.ts";

/** What the hint depends on: the terminal in use and whether it answered the kitty query. */
export interface NewlineHintState {
  readonly terminal: TerminalId;
  readonly kitty: boolean;
}

/** True where Shift+Enter cannot arrive and Ctrl+Enter is the newline key. */
export function ctrlEnterIsNewline(state: NewlineHintState): boolean {
  return state.terminal === "windows-terminal" && !state.kitty;
}

const [state, setState] = createSignal<NewlineHintState>({ terminal: "default", kitty: false });

/** The state in use (tracked inside a reactive scope). */
export function newlineHintState(): NewlineHintState {
  return state();
}

/** Sets the terminal (at start-up) and whether the kitty keyboard protocol was detected (also on a later answer). */
export function setNewlineHintState(next: NewlineHintState): void {
  const now = state();
  if (now.terminal !== next.terminal || now.kitty !== next.kitty) setState(next);
}

const CTRL_ENTER = normaliseKey("ctrl+return");

/**
 * The newline key the splash names: `ctrl+enter` where Shift+Enter cannot arrive and the map binds
 * Ctrl+Enter to newline, otherwise the first newline key of the map that is not Ctrl+Enter
 * (`shift+enter` by default), or Ctrl+Enter itself if it is the only one. Null when the action has
 * no key.
 */
export function newlineLabel(map: KeyMap, hint: NewlineHintState = state()): string | null {
  const keys = keysFor(map, "prompt", "newline");
  if (ctrlEnterIsNewline(hint) && keys.includes(CTRL_ENTER)) return keyLabel(CTRL_ENTER);
  const key = keys.find((k) => k !== CTRL_ENTER) ?? keys[0];
  return key === undefined ? null : keyLabel(key);
}

/**
 * The newline keys key help lists, without repeats. Where Ctrl+Enter is the newline key, it comes
 * first and Shift+Enter, which cannot arrive as itself there (it is Enter), is left out; in every
 * Windows Terminal Alt+Enter is left out too (the terminal keeps it for full screen).
 * Everywhere else Ctrl+Enter is left out, so the list is what it was before the key was bound.
 */
export function newlineKeyLabels(map: KeyMap, hint: NewlineHintState = state()): string[] {
  const keys = keysFor(map, "prompt", "newline");
  const windowsTerminal = hint.terminal === "windows-terminal";
  const ctrlEnter = ctrlEnterIsNewline(hint) && keys.includes(CTRL_ENTER);
  const dropped = new Set<string>(windowsTerminal ? [normaliseKey("meta+return")] : []);
  if (ctrlEnter) dropped.add(normaliseKey("shift+return"));
  const rest = keys.filter((k) => k !== CTRL_ENTER && !dropped.has(k));
  return [...new Set((ctrlEnter ? [CTRL_ENTER, ...rest] : rest).map(keyLabel))];
}
