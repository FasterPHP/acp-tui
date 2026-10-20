// Which catalogue actions are palette entries (spec tui-palette "Every action in
// the palette"). Pure and free of OpenTUI, so the kept-key check
// (src/keys/kept.ts) and `config --check` can ask; palette.ts re-exports it.
import type { KeyContext } from "../keys/keymap.ts";

/**
 * tui-palette "Every action in the palette": the actions that only make sense as a keystroke and
 * are not palette entries (`all` for a context whose every action is one).
 */
export const KEYSTROKE_ONLY: { readonly [C in KeyContext]?: readonly string[] | "all" } = {
  // The palette's own openers, Esc's return to the prompt box and the card preview's scrolling
  // (Marcus, 11 October 2026; mvp-chrome-and-keys task 12.1).
  global: ["escape", "toggleFocus", "palette"],
  // day-two-feedback: the prompt box's `select*` keys (Select all, Cut, Undo and Redo are entries).
  prompt: ["newline", "lineUp", "lineDown", "palette", "agentCommands", "selectLeft", "selectRight", "selectUp", "selectDown", "selectHome", "selectEnd", "selectWordLeft", "selectWordRight"],
  conversation: ["back"],
  card: ["back", "scrollUp", "scrollDown", "pageUp", "pageDown", "top", "bottom"],
  overlay: "all",
  find: "all",
  elicitation: "all",
};

/** Whether `<context>.<action>` is a palette entry (outside `KEYSTROKE_ONLY`). */
export function isPaletteAction(context: KeyContext, action: string): boolean {
  const only = KEYSTROKE_ONLY[context];
  return only !== "all" && !(only ?? []).includes(action);
}
