// Key help (spec tui-palette "Key help"; mvp-chrome-and-keys design D8 and
// task 6.8): every binding of the key map in use, grouped by context,
// keystroke-only bindings included (the newline key, Tab, the double Esc, `?`
// and `/` in an empty prompt box), one entry per action with its keys; then
// the routes for keys an IDE keeps (spec tui-keymap "Alternatives for keys an IDE keeps")
// and the selection's wording (`SELECTION_HELP`, spec tui-selection "Native
// selection stays one step away"), wrapped to the overlay's width. Shown in
// the palette's overlay (Overlay.tsx). Pure.
import { COMMAND_TITLES, KEY_ACTIONS, KEY_SCOPES, keyLabel, keysFor, normaliseKey, type KeyAction, type KeyContext, type KeyMap } from "../keys/keymap.ts";
import { findPreviousKeyLabels, findPreviousLabel, newlineHintState, newlineKeyLabels, type NewlineHintState } from "../keys/newline-hint.ts";
import { SELECTION_HELP } from "../selection/help.ts";
import { wrapText, type ListItem } from "./list.ts";

/** The help's groups, one per context, in order. */
export const HELP_GROUPS: readonly { readonly context: KeyContext; readonly label: string }[] = [
  { context: "global", label: "Anywhere" },
  { context: "prompt", label: "Prompt box" },
  { context: "conversation", label: "Conversation" },
  { context: "selection", label: "Selection" },
  { context: "card", label: "Permission card" },
  { context: "find", label: "Find bar" },
  { context: "overlay", label: "Lists" },
  { context: "slash", label: "Slash menu" },
  { context: "elicitation", label: "Question card" },
];

export const ALTERNATIVES_GROUP = "When the terminal keeps a key";
export const MOUSE_GROUP = "Mouse and selection";

/** A key of `<context>.<action>`: its first key, or `key` when given (one of several, such as
 *  paste's Alt+V), named by its label with `suffix` after it; nothing when it is not bound. */
type Ref = { readonly context: KeyContext; readonly action: string; readonly key?: string; readonly suffix?: string };
const ref = <C extends KeyContext>(context: C, action: KeyAction<C>, key?: string): Ref => ({ context, action, ...(key ? { key } : {}) });

/**
 * The defaults an IDE keeps and their routes (design D11's table; src/keys/ide-keys.json records
 * the same per terminal): the key, the words for where it is lost, and the routes, each either a key of the key map
 * (named by its label) or plain words.
 */
const KEPT: readonly { readonly key: Ref; readonly by: string; readonly routes: readonly (Ref | string | ((map: KeyMap, hint: NewlineHintState) => string | null))[]; readonly inWindowsTerminal?: string; readonly onlyInWindowsTerminal?: true }[] = [
  { key: ref("global", "find"), by: "Kept by PhpStorm", routes: [ref("global", "findNext"), "the palette"] },
  { key: ref("prompt", "paste"), by: "Kept by PhpStorm", inWindowsTerminal: "Kept by Windows Terminal", routes: ["its own paste for text", ref("prompt", "paste", "meta+v"), "the palette"] },
  // Ctrl+Shift+V, the reader's named key, is kept by both IDEs; Alt+V reaches all three (task 12.2).
  // Windows Terminal pastes with both itself, as one bracketed paste (src/keys/ide-keys.json); its
  // wording replaces the IDEs' only in Windows Terminal, so the text elsewhere is what it was.
  { key: ref("prompt", "paste", "ctrl+shift+v"), by: "Kept by PhpStorm and Zed", inWindowsTerminal: "Kept by Windows Terminal", routes: [ref("prompt", "paste", "meta+v"), "the palette"] },
  // Ctrl+Shift+Z undoes in PhpStorm (it arrives as Ctrl+Z's byte) and never arrives in Zed (day-two-feedback task 12.4).
  { key: ref("prompt", "redo", "ctrl+shift+z"), by: "Kept by PhpStorm and Zed", routes: [ref("prompt", "redo", "ctrl+y"), "the palette"] },
  // PhpStorm on macOS keeps Cmd+Z and Cmd+Shift+Z (day-two-feedback task 13.4); Cmd+X is bound to nothing.
  { key: ref("prompt", "undo", "super+z"), by: "Kept by PhpStorm on a Mac", routes: [ref("prompt", "undo", "ctrl+z"), "the palette"] },
  { key: ref("prompt", "redo", "shift+super+z"), by: "Kept by PhpStorm on a Mac", routes: [ref("prompt", "redo", "ctrl+y"), "the palette"] },
  { key: ref("global", "palette"), by: "Kept by Zed", routes: [{ ...ref("prompt", "palette"), suffix: " in an empty prompt box" }] },
  { key: ref("global", "cycleThoughtLevel"), by: "Kept by Zed", routes: ["the effort pill", "the palette"] },
  { key: ref("global", "keyHelp"), by: "Kept by Zed", routes: ["the palette"] },
  { key: ref("prompt", "newline"), by: "Kept by Zed", routes: ["shift+enter"] },
  // Windows Terminal keeps Alt+Enter for full screen; Ctrl+Enter (1.24: a line feed, 1.25: CSI 13;5u) or Ctrl+J reaches the app.
  { key: ref("prompt", "newline", "meta+return"), by: "Kept by Windows Terminal", onlyInWindowsTerminal: true, routes: [ref("prompt", "newline", "ctrl+return"), ref("prompt", "newline", "ctrl+j")] },
  { key: ref("selection", "copyRich"), by: "Kept by Zed, or sent as ctrl+c", routes: [ref("conversation", "copyItemMarkdown"), "the palette"] },
  { key: ref("global", "findPrevious"), by: "Lost in most terminals", routes: [(map, hint) => { const label = findPreviousLabel(map, hint); return label === null ? null : `${label} in the find bar`; }] },
];

/** A key's label when the key map binds it to the action: the given key, else the first. */
function refLabel(map: KeyMap, r: Ref): string | null {
  const keys = keysFor(map, r.context, r.action as never);
  const key = r.key === undefined ? keys[0] : keys.find((k) => k === normaliseKey(r.key!));
  return key === undefined ? null : keyLabel(key);
}

/** The kept key's label: `ctrl+j` for the newline (Zed keeps that one, not Shift+Enter). */
function keptLabel(map: KeyMap, key: Ref): string | null {
  const keys = keysFor(map, key.context, key.action as never);
  if (key.context === "prompt" && key.action === "newline" && key.key === undefined) return keys.some((k) => keyLabel(k) === "ctrl+j") ? "ctrl+j" : null;
  return refLabel(map, key);
}

/** The labels of an action's keys in the key map, without repeats (`linefeed` and `ctrl+j` are both `ctrl+j`). */
function labels(map: KeyMap, context: KeyContext, action: string): string[] {
  return [...new Set(keysFor(map, context, action as never).map(keyLabel))];
}

/** Key help's entries for `map`, the selection paragraph wrapped to `inner` columns. */
export function helpItems(map: KeyMap, inner: number, hint: NewlineHintState = newlineHintState()): ListItem[] {
  const windowsTerminal = hint.terminal === "windows-terminal";
  const items: ListItem[] = [];
  for (const { context, label } of HELP_GROUPS) {
    const titles = COMMAND_TITLES[context] as Record<string, string>;
    for (const action of KEY_ACTIONS[context]) {
      const keys =
        context === "prompt" && action === "newline" ? newlineKeyLabels(map, hint) : context === "find" && action === "previous" ? findPreviousKeyLabels(map, hint) : labels(map, context, action);
      if (keys.length === 0) continue;
      items.push({ id: `help:${context}.${action}`, group: label, title: titles[action] ?? action, keys, groupNote: KEY_SCOPES[context] });
    }
  }
  for (const kept of KEPT) {
    if (kept.onlyInWindowsTerminal && !windowsTerminal) continue;
    const key = keptLabel(map, kept.key);
    if (key === null) continue;
    const routes = kept.routes
      .map((r) => {
        if (typeof r === "string") return r;
        if (typeof r === "function") return r(map, hint);
        const label = refLabel(map, r);
        return label === null ? null : `${label}${r.suffix ?? ""}`;
      })
      .filter((r): r is string => r !== null);
    if (routes.length === 0) continue;
    items.push({ id: `help:kept.${kept.key.context}.${kept.key.action}${kept.onlyInWindowsTerminal ? ".windows-terminal" : ""}`, group: ALTERNATIVES_GROUP, title: `${windowsTerminal && kept.inWindowsTerminal !== undefined ? kept.inWindowsTerminal : kept.by}: ${routes.join(", ")}`, keys: [key] });
  }
  wrapText(SELECTION_HELP.join(" "), Math.max(8, inner), Number.MAX_SAFE_INTEGER).forEach((line, i) => {
    items.push({ id: `help:mouse.${i}`, group: MOUSE_GROUP, title: line });
  });
  return items;
}
