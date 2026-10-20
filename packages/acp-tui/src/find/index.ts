// The find index; design of record 6.3 "Find"; decision 2,
// research/full-screen-synthesis.md section 4.
//
// Find searches the plain-text projection of every item
// (`src/selection/projection.ts`), the same text selection and copy use, so a
// hit's offsets are selection offsets too. That covers collapsed content
// (the projection is the whole item whatever the view shows), user text,
// agent answers (as drawn: Markdown markers concealed, code without fences),
// thoughts, tool titles and output, both sides of diffs (the removed and the
// added lines of the unified diff text, with its context lines), the notice
// for `terminal` content, plan entries, permission records and error
// markers. Turn-end markers project to nothing and are never hit.
//
// Smart case: a query in lower case only matches any case; a query with a
// capital letter (any character that lower-casing changes) matches case
// exactly. The query is literal text, not a pattern.
//
// Incremental: projections are cached per item version (`ProjectionCache`:
// the item object is the version, since the reducer and the store replace a
// changed item and never write into it), so a search while items stream only
// projects the items that changed since the last search. Hits are in
// conversation order, then by offset; they do not overlap.
//
// Pure: no OpenTUI or Solid. The find bar (task 15.2) holds the current hit's
// index and uses `stepHit` and `firstHitFrom`.
import { ProjectionCache, type ItemLookup } from "../selection/projection.ts";

export interface FindHit {
  readonly itemId: string;
  /** Offsets into the item's projection text, `[start, end)`. */
  readonly start: number;
  readonly end: number;
}

export interface FindResult {
  readonly query: string;
  readonly caseSensitive: boolean;
  /** In conversation order, then by offset. */
  readonly hits: readonly FindHit[];
}

/** Smart case: true when the query has a character that lower-casing changes. */
export function isCaseSensitive(query: string): boolean {
  return query !== query.toLowerCase();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class FindIndex {
  readonly cache: ProjectionCache;

  /** `cache` may be shared with the selection, so both read one projection per item version. */
  constructor(cache: ProjectionCache = new ProjectionCache()) {
    this.cache = cache;
  }

  /** Every hit of `query` over the items of `order`, projecting only items that changed. */
  search(query: string, order: readonly string[], lookup: ItemLookup): FindResult {
    const caseSensitive = isCaseSensitive(query);
    const hits: FindHit[] = [];
    if (query === "") {
      this.cache.prune(order);
      return { query, caseSensitive, hits };
    }
    // The `u` flag gives Unicode case folding for the insensitive case; offsets stay offsets
    // into the original text (no lower-cased copy whose length could differ).
    const pattern = new RegExp(escapeRegExp(query), caseSensitive ? "gu" : "giu");
    for (const id of order) {
      const item = lookup(id);
      if (!item) continue;
      const text = this.cache.get(item).text;
      if (text === "") continue;
      pattern.lastIndex = 0;
      for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
        hits.push({ itemId: id, start: match.index, end: match.index + match[0].length });
      }
    }
    this.cache.prune(order);
    return { query, caseSensitive, hits };
  }
}

/** The hit index after moving `delta` from `current`, wrapping; -1 when there are none. With
 *  `current` at -1 (no hit yet), +1 gives the first hit and -1 the last. */
export function stepHit(count: number, current: number, delta: number): number {
  if (count <= 0) return -1;
  if (current < 0) return delta >= 0 ? 0 : count - 1;
  return (((current + delta) % count) + count) % count;
}

/**
 * The index of the first hit at or after the item `fromItemId` (the reader's position when the
 * find bar opens), wrapping to the first hit; -1 when there are none. An item not in `order`
 * counts as the start of the conversation.
 */
export function firstHitFrom(result: FindResult, order: readonly string[], fromItemId: string | null): number {
  if (result.hits.length === 0) return -1;
  const from = fromItemId === null ? -1 : order.indexOf(fromItemId);
  if (from <= 0) return 0;
  const position = new Map<string, number>();
  order.forEach((id, index) => position.set(id, index));
  const k = result.hits.findIndex((hit) => (position.get(hit.itemId) ?? -1) >= from);
  return k < 0 ? 0 : k;
}

/** The hits inside one item (to highlight every visible hit, the current one more strongly). */
export function hitsIn(result: FindResult, itemId: string): FindHit[] {
  return result.hits.filter((hit) => hit.itemId === itemId);
}
