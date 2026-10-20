// The conversation's view model (design D9), keyed by item id: collapse state,
// the cursor and the reading position (anchor and following). It lives in the
// session store, so it outlives the conversation component (a new screen
// layout remounts it) and survives scrolling, focus changes and resizes.
//
// Output snippets (mvp-rendering "Output snippets"): whether a tool call's
// text output is shown in full, kept per item id beside the collapse state and
// cleared with it, and returned to the snippet when the card is collapsed
// (review C19).
//
// Collapse: an explicit user toggle wins; otherwise the default applies, which
// collapses everything, a failed tool call and thoughts included (spec
// tui-conversation "Collapse and expand in place", tui-rendering "Thoughts":
// acp-tui never expands an item by itself; only `verbose` expands them all).
//
// Reactive reads (`expanded`, `cursor`) are Solid-tracked. The anchor and
// the following flag belong to the scroll controller (scroll.ts); they are
// kept here only so a remount resumes at the same place.
import { batch, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import type { Item } from "acp-model";

/** The top visible item and the row of it at the top of the viewport (negative inside the
 *  blank rows above it). */
export interface Anchor {
  readonly id: string;
  readonly offset: number;
}

export interface ConversationViewModel {
  /** Whether an item can be collapsed and expanded: tool calls, thoughts and plans. */
  collapsible(item: Item): boolean;
  /** Whether an item is shown expanded (tracked). */
  expanded(item: Item): boolean;
  /** Toggles a collapsible item and records the user's choice; false if it is not collapsible. */
  toggle(item: Item): boolean;
  /** Records the user's choice for a collapsible item (a toggle against another default, such as
   *  a density's); false if it is not collapsible. */
  setExpanded(item: Item, expanded: boolean): boolean;
  /** Drops the recorded choice for an item, so its default applies again (find puts back an
   *  item it expanded that the user had never toggled). */
  forget(id: string): void;
  /** Whether the user has toggled the item (tracked). */
  toggled(id: string): boolean;
  /** Whether a tool call's text output is shown in full rather than as a snippet (tracked;
   *  mvp-rendering "Output snippets"). Kept while the card stays expanded: collapsing it (`toggle`,
   *  `setExpanded`) returns the output to the snippet. */
  outputShown(id: string): boolean;
  /** Shows a tool call's text output in full (`true`) or as its snippet again. */
  setOutputShown(id: string, shown: boolean): void;
  /** The item under the conversation cursor, or null before the conversation first had focus
   *  (tracked). Kept while focus is elsewhere. */
  cursor(): string | null;
  setCursor(id: string | null): void;
  /** Reading position, owned by the scroll controller. */
  anchor: Anchor | null;
  following: boolean;
  /** Forgets every recorded choice, the cursor and the reading position (another session was
   *  attached, mvp-sessions task 7.4). */
  reset(): void;
}

export function collapsible(item: Item): boolean {
  return item.kind === "tool_call" || item.kind === "thought" || item.kind === "plan";
}

/** The default when the user has not toggled an item: none expands itself, a failed tool call
 *  included (Marcus, 14 October 2026; spec tui-conversation "Collapse and expand in place").
 *  `verbose` expands every item on top of this. */
export function expandedByDefault(_item: Item): boolean {
  return false;
}

/**
 * Expands `item` for find, recorded as a user choice so every density
 * shows it expanded, and returns what puts the previous record back (the user's own choice, or
 * none, so the default applies again); null when it is not collapsible or `shown` (expanded as
 * drawn now) is already true.
 */
export function expandRecorded(vm: ConversationViewModel, item: Item, shown: boolean): (() => void) | null {
  if (!collapsible(item) || shown) return null;
  const had = vm.toggled(item.id) ? vm.expanded(item) : undefined;
  vm.setExpanded(item, true);
  return () => (had === undefined ? vm.forget(item.id) : void vm.setExpanded(item, had));
}

/** The item `delta` steps from `current` in `ids` (clamped); the last item when there is no
 *  current one or it is no longer shown. */
export function moveCursor(ids: readonly string[], current: string | null, delta: number): string | null {
  if (ids.length === 0) return null;
  const at = current === null ? -1 : ids.indexOf(current);
  if (at < 0) return ids.at(-1)!;
  return ids[Math.max(0, Math.min(ids.length - 1, at + delta))]!;
}

export function createConversationViewModel(): ConversationViewModel {
  const [explicit, setExplicit] = createStore<Record<string, boolean>>({});
  const [cursor, setCursor] = createSignal<string | null>(null);
  const [output, setOutput] = createStore<Record<string, boolean>>({});
  const expanded = (item: Item) => {
    if (!collapsible(item)) return false;
    const choice = explicit[item.id];
    return choice ?? expandedByDefault(item);
  };
  // Collapsing a card returns its output to the snippet (review C19).
  const record = (item: Item, value: boolean) =>
    batch(() => {
      setExplicit(item.id, value);
      if (!value && output[item.id] !== undefined) setOutput(item.id, undefined!);
    });
  return {
    collapsible,
    expanded,
    toggle(item) {
      if (!collapsible(item)) return false;
      record(item, !expanded(item));
      return true;
    },
    setExpanded(item, value) {
      if (!collapsible(item)) return false;
      record(item, value);
      return true;
    },
    forget(id) {
      if (explicit[id] !== undefined) setExplicit(id, undefined!);
    },
    toggled: (id) => explicit[id] !== undefined,
    outputShown: (id) => output[id] === true,
    setOutputShown(id, shown) {
      setOutput(id, shown ? true : undefined!);
    },
    cursor,
    setCursor: (id) => void setCursor(id),
    anchor: null,
    following: true,
    reset() {
      for (const id of Object.keys(explicit)) setExplicit(id, undefined!);
      for (const id of Object.keys(output)) setOutput(id, undefined!);
      setCursor(null);
      this.anchor = null;
      this.following = true;
    },
  };
}
