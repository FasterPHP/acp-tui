// parallel-tests task 3.3: the search cost at 5000 items with the projections warmed (tui-find
// "Search cost"): the first keystroke under 100 ms and later ones under 16 ms, fenced and unfenced
// tool output. The budgets are on the machine's speed, so this runs in the serial pass; the
// warmer's own tests are in warm.test.ts.
import { describe, expect, test } from "bun:test";
import { createSession, reduce, type Session } from "acp-model";
import { FindIndex } from "../../src/find/index.ts";
import { ProjectionWarmer } from "../../src/find/warm.ts";
import { lookupOf, ProjectionCache } from "../../src/selection/projection.ts";
import { longSessionEvents } from "../conversation/window/session.ts";

/** Types `query` one character at a time: each prefix's search time. */
function typing(index: FindIndex, model: Session, query: string): number[] {
  const lookup = lookupOf(model.items);
  const times: number[] = [];
  for (let n = 1; n <= query.length; n++) {
    const t = performance.now();
    index.search(query.slice(0, n), model.order, lookup);
    times.push(performance.now() - t);
  }
  return times;
}

function session(fenced: boolean): Session {
  let model: Session = createSession();
  for (const event of longSessionEvents(5000, { fenced })) model = reduce(model, event);
  return model;
}

describe("Search cost at 5000 items with the projections warmed (tui-find)", () => {
  for (const fenced of [true, false]) {
    const label = fenced ? "fenced tool output (claude-agent-acp)" : "unfenced tool output (long-session-plain)";
    test(`${label}: first keystroke under 100 ms, later ones under 16 ms`, async () => {
      const model = session(fenced);
      const lookup = lookupOf(model.items);
      const cache = new ProjectionCache();
      let drained = false;
      const warmer = new ProjectionWarmer(cache, () => lookup, { onDrained: () => (drained = true) });
      const t0 = performance.now();
      warmer.add(model.order.map((id) => model.items.get(id)!));
      while (!drained) await Bun.sleep(5);
      const warmWall = performance.now() - t0;
      expect(cache.size).toBe(model.order.length);

      const times = typing(new FindIndex(cache), model, "needle-500-back");
      // The cold cost the warmer saves: the same typing with nothing projected yet.
      const cold = typing(new FindIndex(), model, "needle-500-back");
      console.log(
        `find 5000 ${fenced ? "fenced" : "unfenced"}: warm-up ${warmWall.toFixed(0)} ms wall; ` +
          `warmed: first ${times[0]!.toFixed(1)} ms, later at most ${Math.max(...times.slice(1)).toFixed(1)} ms; ` +
          `unwarmed: first ${cold[0]!.toFixed(1)} ms`,
      );
      expect(times[0]!).toBeLessThan(100);
      for (const ms of times.slice(1)) expect(ms).toBeLessThan(16);
    }, 60000);
  }
});
