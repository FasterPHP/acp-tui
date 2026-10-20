// The find's projections computed ahead of the first search (src/find/warm.ts; tui-find "Search
// cost"): the warmer queues final items, works through them in slices on the scheduler, skips
// live items, projects a changed item again, and with it the first search of a 5000-item session
// stays under 100 ms and later keystrokes under 16 ms, with tool output fenced as
// claude-agent-acp sends it and unfenced (`long-session-plain`).
//
// The search-cost test at 5000 items is in warm.timing.test.ts (parallel-tests: it runs in the serial pass).
import { describe, expect, test } from "bun:test";
import type { Item } from "acp-model";
import { FindIndex } from "../../src/find/index.ts";
import { ProjectionWarmer } from "../../src/find/warm.ts";
import { ProjectionCache } from "../../src/selection/projection.ts";
import { agent, conversation, tool, user } from "../selection/items.ts";

/** A scheduler the test runs by hand. */
function manual() {
  const queue: (() => void)[] = [];
  return {
    schedule: (fn: () => void) => void queue.push(fn),
    runAll() {
      let n = 0;
      while (queue.length > 0) {
        queue.shift()!();
        n += 1;
      }
      return n;
    },
    get pending() {
      return queue.length;
    },
  };
}

describe("ProjectionWarmer", () => {
  test("final items are projected on the scheduler, not when added; live items wait", () => {
    const items: Item[] = [user("u", "hello"), agent("a", "**bold** answer"), { ...agent("live", "streaming"), status: "live" }];
    const { lookup } = conversation(...items);
    const cache = new ProjectionCache();
    const timer = manual();
    const drained: { projected: number; ms: number }[] = [];
    const warmer = new ProjectionWarmer(cache, () => lookup, { schedule: timer.schedule, quietMs: 0, onDrained: (s) => drained.push(s) });
    warmer.add(items);
    expect(cache.computed).toBe(0);
    expect(warmer.pending).toBe(2);
    timer.runAll();
    expect(cache.computed).toBe(2);
    expect(warmer.pending).toBe(0);
    expect(drained.map((d) => d.projected)).toEqual([2]);
    // A search finds them ready.
    new FindIndex(cache).search("answer", ["u", "a"], lookup);
    expect(cache.computed).toBe(2);
  });

  test("a slice yields when its time is up, and the next slice carries on", () => {
    const items = Array.from({ length: 10 }, (_, i) => user(`u${i}`, `message ${i}`));
    const { lookup } = conversation(...items);
    const cache = new ProjectionCache();
    const timer = manual();
    let clock = 0;
    // Each projection "takes" 2 ms by the injected clock; slices of 4 ms project two items each.
    const warmer = new ProjectionWarmer(cache, () => lookup, {
      schedule: timer.schedule, quietMs: 0,
      now: () => (clock += 1),
      sliceMs: 4,
    });
    warmer.add(items);
    expect(timer.runAll()).toBeGreaterThan(1);
    expect(cache.computed).toBe(10);
  });

  test("a changed item is projected again; an unchanged one is not; a removed one is skipped", () => {
    const first = tool("t", { content: [{ type: "text", text: "one" }] });
    let current: Record<string, Item> = { t: first };
    const cache = new ProjectionCache();
    const timer = manual();
    const warmer = new ProjectionWarmer(cache, () => (id) => current[id], { schedule: timer.schedule, quietMs: 0 });
    warmer.add([first]);
    timer.runAll();
    expect(cache.computed).toBe(1);
    warmer.add([first]);
    timer.runAll();
    expect(cache.computed).toBe(1);
    const second = tool("t", { content: [{ type: "text", text: "two" }] });
    current = { t: second };
    warmer.add([second]);
    timer.runAll();
    expect(cache.computed).toBe(2);
    current = {};
    warmer.add([second]);
    timer.runAll();
    expect(cache.computed).toBe(2);
  });

  test("when the queue drains, projections of items no longer in the conversation are dropped", () => {
    const old = [user("old1", "first session"), user("old2", "first session again")];
    const fresh = [user("new1", "second session")];
    let current = conversation(...old);
    const cache = new ProjectionCache();
    const timer = manual();
    const warmer = new ProjectionWarmer(cache, () => current.lookup, { schedule: timer.schedule, quietMs: 0, order: () => current.order });
    warmer.add(old);
    timer.runAll();
    expect(cache.size).toBe(2);
    current = conversation(...fresh);
    warmer.add(fresh);
    timer.runAll();
    expect(cache.size).toBe(1);
  });

  test("slices wait until no item has arrived or changed for the quiet time", () => {
    const items = [user("u1", "one"), user("u2", "two")];
    const { lookup } = conversation(...items);
    const cache = new ProjectionCache();
    const delays: number[] = [];
    const queue: (() => void)[] = [];
    let clock = 0;
    const warmer = new ProjectionWarmer(cache, () => lookup, {
      schedule: (fn, delay) => {
        delays.push(delay);
        queue.push(fn);
      },
      now: () => clock,
      quietMs: 100,
    });
    warmer.add([items[0]!]);
    clock = 30;
    queue.shift()!();
    expect(cache.computed).toBe(0);
    // A live chunk is activity too: the wait starts again from it.
    clock = 60;
    warmer.add([{ ...agent("live", "streaming"), status: "live" }]);
    clock = 90;
    queue.shift()!();
    expect(cache.computed).toBe(0);
    expect(delays.at(-1)).toBe(70);
    clock = 160;
    queue.shift()!();
    expect(cache.computed).toBe(1);
    expect(queue).toHaveLength(0);
  });

  test("nothing runs after dispose", () => {
    const items = [user("u", "hello")];
    const { lookup } = conversation(...items);
    const cache = new ProjectionCache();
    const timer = manual();
    const warmer = new ProjectionWarmer(cache, () => lookup, { schedule: timer.schedule, quietMs: 0 });
    warmer.add(items);
    warmer.dispose();
    timer.runAll();
    warmer.add(items);
    expect(timer.pending).toBe(0);
    expect(cache.computed).toBe(0);
  });
});
