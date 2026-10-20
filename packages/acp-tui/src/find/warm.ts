// Projections computed ahead of the find's first search (spec tui-find "Search cost": the first
// search of a 5000-item session under 100 ms "because projections are reused until an item
// changes").
//
// Since mvp-rendering, an item's projection is its Markdown as the renderers draw it, so
// projecting every item at the first keystroke costs far more than the budget when an agent
// sends tool output unfenced (marked lexes all of it). The warmer fills the find's projection
// cache in idle time instead: every item that arrives or changes is queued once it is final (a
// live item changes with every chunk, so its projection would be thrown away), and the queue is
// worked through in short slices on timers, never inside a frame, and only once the conversation
// has been quiet for `WARM_QUIET_MS` (no item arrived or changed), so the work never competes with
// a session's updates being reduced and drawn (`bench:scale`'s populate and open-at-end figures).
// A search finds the projections ready and only scans their text; an item that changed since, or
// one the warmer has not reached yet, is projected by the search itself, as before. Items are
// looked up again when their turn comes, so a queued item that has changed again or gone costs
// nothing extra.
//
// Pure apart from the timer: the scheduler and the clock are injectable for tests.
import type { Item } from "acp-model";
import type { ItemLookup, ProjectionCache } from "../selection/projection.ts";

/** Longest a slice works before it yields (one item may run over). */
export const WARM_SLICE_MS = 4;
/** How long no item may have arrived or changed before a slice runs. */
export const WARM_QUIET_MS = 100;

export interface WarmerOptions {
  /** Runs `fn` after `delayMs`; default `setTimeout`. */
  readonly schedule?: (fn: () => void, delayMs: number) => void;
  readonly now?: () => number;
  readonly sliceMs?: number;
  readonly quietMs?: number;
  /** The conversation's items in order: when the queue drains, projections of items no longer
   *  in it (a session switched away from) are dropped. */
  readonly order?: () => readonly string[];
  /** Called when the queue has drained, with the items projected since it last drained and the
   *  time spent projecting them. */
  readonly onDrained?: (stats: { projected: number; ms: number }) => void;
}

export class ProjectionWarmer {
  private readonly queue = new Set<string>();
  private scheduled = false;
  private disposed = false;
  private projected = 0;
  private spent = 0;
  private lastChange = Number.NEGATIVE_INFINITY;
  private readonly schedule: (fn: () => void, delayMs: number) => void;
  private readonly now: () => number;
  private readonly sliceMs: number;
  private readonly quietMs: number;

  constructor(
    private readonly cache: ProjectionCache,
    private readonly lookup: () => ItemLookup,
    private readonly options: WarmerOptions = {},
  ) {
    this.schedule =
      options.schedule ??
      ((fn, delayMs) => {
        const timer = setTimeout(fn, delayMs);
        (timer as { unref?: () => void }).unref?.();
      });
    this.now = options.now ?? (() => performance.now());
    this.sliceMs = options.sliceMs ?? WARM_SLICE_MS;
    this.quietMs = options.quietMs ?? WARM_QUIET_MS;
  }

  /** Queues items that arrived or changed (live ones included, as activity: they wait for the
   *  change that makes them final). */
  add(items: readonly Item[]): void {
    if (this.disposed) return;
    if (items.length > 0) this.lastChange = this.now();
    for (const item of items) if (item.status !== "live") this.queue.add(item.id);
    this.kick();
  }

  /** Items still waiting. */
  get pending(): number {
    return this.queue.size;
  }

  dispose(): void {
    this.disposed = true;
    this.queue.clear();
  }

  private kick(delayMs = 0): void {
    if (this.scheduled || this.queue.size === 0) return;
    this.scheduled = true;
    this.schedule(() => this.slice(), delayMs);
  }

  /** Projects queued items until the slice's time is up, once the conversation is quiet. */
  private slice(): void {
    this.scheduled = false;
    if (this.disposed) return;
    const quietFor = this.now() - this.lastChange;
    if (quietFor < this.quietMs) {
      this.kick(Math.ceil(this.quietMs - quietFor));
      return;
    }
    const lookup = this.lookup();
    const start = this.now();
    for (const id of this.queue) {
      this.queue.delete(id);
      const item = lookup(id);
      if (item && item.status !== "live") {
        const before = this.cache.computed;
        this.cache.get(item);
        if (this.cache.computed !== before) this.projected += 1;
      }
      if (this.now() - start >= this.sliceMs) break;
    }
    this.spent += this.now() - start;
    if (this.queue.size > 0) {
      this.kick();
      return;
    }
    if (this.options.order) this.cache.prune(this.options.order());
    if (this.projected > 0) this.options.onDrained?.({ projected: this.projected, ms: this.spent });
    this.projected = 0;
    this.spent = 0;
  }
}
