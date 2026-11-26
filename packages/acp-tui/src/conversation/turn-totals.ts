// The turn's totals for its end line (design focus-groups D5): the counts of the items between a
// turn's user message and its turn-end marker, and the number of gaps those items form in focus.
// Computed from the model's order in one walk, so a marker needs no scan of its own.
import type { Item } from "acp-model";
import { addCounts, EMPTY_COUNTS, type ItemCounts } from "./counts.ts";
import { isRenderable } from "./list.ts";
import { focusGaps, type ItemLookup } from "./window/entries.ts";

export interface TurnTotals {
  readonly counts: ItemCounts;
  /** The gaps the turn's hidden items form (`focusGaps`), whatever the density. */
  readonly gaps: number;
}

export function sameTotals(a: TurnTotals | undefined, b: TurnTotals | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.gaps !== b.gaps) return false;
  const x = a.counts as unknown as Record<string, number>;
  const y = b.counts as unknown as Record<string, number>;
  return Object.keys(x).every((k) => x[k] === y[k]);
}

/** The totals of the turn that `ids` (the items after its user message, in model order) make. */
export function totalsOf(ids: readonly string[], items: ItemLookup): TurnTotals {
  let counts = EMPTY_COUNTS;
  const shown: string[] = [];
  for (const id of ids) {
    const item = items(id);
    if (item === undefined) continue;
    counts = addCounts(counts, item);
    if (isRenderable(item)) shown.push(id);
  }
  const gaps = focusGaps(shown, items).filter((slot) => slot.kind === "group").length;
  return { counts, gaps };
}

/** The totals of every turn that ended in `order`, by the marker's ID: the items from after the
 *  previous user message (or the session's start) to the marker. Totals only matter with more than
 *  one gap, so a turn with fewer gets none. */
export function turnTotals(order: readonly string[], items: ItemLookup): Map<string, TurnTotals> {
  const out = new Map<string, TurnTotals>();
  let range: string[] = [];
  for (const id of order) {
    const item: Item | undefined = items(id);
    if (item === undefined) continue;
    if (item.kind === "user_message") range = [];
    else if (item.kind === "marker" && item.markerKind === "turn_end") {
      const totals = totalsOf(range, items);
      if (totals.gaps > 1) out.set(id, totals);
      range = [];
    } else range.push(id);
  }
  return out;
}
