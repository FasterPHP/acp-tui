// parallel-tests task 3.3: the 5000-item needle of index.test.ts (phase-1a task 15.1 performance):
// found exactly once, the cold search (projection plus search) under 1 s and the warm one under
// 250 ms. The times are budgets on the machine's speed, so the test runs in the serial pass.
import { describe, expect, test } from "bun:test";
import { createSession, reduce, type Session } from "acp-model";
import { expandedByDefault } from "../../src/conversation/view-model.ts";
import { FindIndex } from "../../src/find/index.ts";
import { itemText, lookupOf } from "../../src/selection/projection.ts";
import { longSessionEvents } from "../conversation/window/session.ts";

describe("long-session --items 5000 (phase-1a task 15.1 performance)", () => {
  test("`needle-500-back` found exactly once, in item n - 500, well under 1 s including indexing", () => {
    let model: Session = createSession();
    for (const event of longSessionEvents(5000)) model = reduce(model, event);
    expect(model.order.length).toBeGreaterThanOrEqual(5001);
    const lookup = lookupOf(model.items);

    const index = new FindIndex();
    const t0 = performance.now();
    const cold = index.search("needle-500-back", model.order, lookup);
    const coldMs = performance.now() - t0;

    // The prompt is item 0, so emitted item 4500 (500 from the end of 5000) is at 4501.
    expect(cold.hits).toHaveLength(1);
    const hit = cold.hits[0]!;
    expect(hit.itemId).toBe("tool:long-tool-4500");
    expect(model.order.indexOf(hit.itemId)).toBe(4501);
    expect(model.order.length - 1 - model.order.indexOf(hit.itemId)).toBe(500);
    const holder = lookup(hit.itemId)!;
    expect(holder.kind).toBe("tool_call");
    expect(expandedByDefault(holder)).toBe(false);
    expect(itemText(holder).slice(hit.start, hit.end)).toBe("needle-500-back");

    const t1 = performance.now();
    const warm = index.search("needle-500-back", model.order, lookup);
    const warmMs = performance.now() - t1;
    const t2 = performance.now();
    const insensitive = index.search("NEEDLE-500-BACK".toLowerCase(), model.order, lookup);
    const t3 = performance.now();
    const chars = model.order.reduce((sum, id) => sum + itemText(lookup(id)!, index.cache).length, 0);
    expect(warm.hits).toEqual(cold.hits);
    expect(insensitive.hits).toEqual(cold.hits);

    console.log(
      `find long-session 5000: ${model.order.length} items, ${(chars / 1e6).toFixed(1)}M chars; ` +
        `cold (projection + search) ${coldMs.toFixed(0)} ms, warm ${warmMs.toFixed(0)} ms, warm smart-case ${(t3 - t2).toFixed(0)} ms`,
    );
    expect(coldMs).toBeLessThan(1000);
    expect(warmMs).toBeLessThan(250);
  }, 60000);
});
