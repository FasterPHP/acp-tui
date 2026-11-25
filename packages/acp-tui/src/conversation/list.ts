// The conversation's item rules (design D9), pure: which model items are shown,
// in model (start) order, their spacing groups, and the blank rows above each.
// The windowed list (window/entries.ts) builds its entries from these.
import type { Item } from "acp-model";
import { wordCount } from "./format.ts";

/** Items are spaced by group: a blank row whenever the group changes, and before every user and
 *  agent message; consecutive one-liners (tools, thoughts, permission outcomes) stay together. */
export type ItemGroup = "user" | "agent" | "activity" | "plan" | "marker";

export function groupOf(item: Item): ItemGroup {
  switch (item.kind) {
    case "user_message":
      return "user";
    case "agent_message":
      return "agent";
    case "plan":
      return "plan";
    case "marker":
      return "marker";
    default:
      return "activity";
  }
}

export function spacingBefore(previous: ItemGroup | null, group: ItemGroup): number {
  if (previous === null) return 0;
  return group === "user" || group === "agent" || group !== previous ? 1 : 0;
}

/** The blank rows above a focus line (a gap's line): none directly under an agent message, so it
 *  takes the blank row that separated that message from what follows (design focus-groups D4);
 *  any other neighbour as for an activity item. */
export function spacingBeforeFocusLine(previous: ItemGroup | null): number {
  return previous === "agent" ? 0 : spacingBefore(previous, "activity");
}

/** The blank rows above an item that directly follows a CLOSED focus line: none for an agent
 *  message (the line took its blank row), as usual for any other. An open line's last member is
 *  spaced as any activity item. */
export function spacingAfterClosedFocusLine(group: ItemGroup): number {
  return group === "agent" ? 0 : spacingBefore("activity", group);
}

/** Whether an item has anything to show yet (an open permission is shown by the card, not here). */
export function isRenderable(item: Item): boolean {
  switch (item.kind) {
    case "agent_message":
    case "user_message":
      return item.text.trim() !== "";
    case "thought":
      return wordCount(item.text) > 0;
    case "permission_record":
      return item.outcome.type !== "pending";
    case "plan":
      return item.entries.length > 0;
    default:
      return true;
  }
}

export interface ListRows {
  /** Shown item ids in model order. */
  readonly ids: string[];
  /** Blank rows above each shown item. */
  readonly margins: Map<string, number>;
}

/** The shown item ids in model order, with the blank rows above each. */
export function listRows(order: readonly string[], items: Readonly<Record<string, Item>>): ListRows {
  const ids: string[] = [];
  const margins = new Map<string, number>();
  let previous: ItemGroup | null = null;
  for (const id of order) {
    const item = items[id];
    if (!item || !isRenderable(item)) continue;
    const group = groupOf(item);
    ids.push(id);
    margins.set(id, spacingBefore(previous, group));
    previous = group;
  }
  return { ids, margins };
}
