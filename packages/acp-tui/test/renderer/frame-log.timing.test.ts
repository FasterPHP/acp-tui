// parallel-tests task 3.4: the frame log tests with a time bound: a frame time under 1 s, a 25 ms frame logged as under 200 ms, and the mounted-count timer firing within 90 ms of a 20 ms interval, which run in the serial pass.
// What the file covers is in the header of frame-log.test.ts; its helpers are in frame-log-helpers.ts.
import { afterEach, describe, expect, test } from "bun:test";
import { BoxRenderable, TextRenderable } from "@opentui/core";
import { installFrameLog } from "../../src/renderer/frame-log.ts";
import { memoryLogger, setup, disposeMade } from "./frame-log-helpers.ts";

afterEach(disposeMade);

describe("installFrameLog", () => {
  test("logs one frame event per rendered frame with a time and a gap", async () => {
    const { renderer, renderOnce } = await setup();
    const { logger, entries } = memoryLogger();
    installFrameLog(renderer, logger, { mountedIntervalMs: 60_000 });
    renderer.root.add(new TextRenderable(renderer, { id: "t", content: "hello" }));
    await renderOnce();
    await renderOnce();
    const frames = entries.filter((e) => e.event === "frame");
    expect(frames.length).toBeGreaterThanOrEqual(2);
    for (const f of frames) {
      expect(typeof f["id"]).toBe("number");
      expect(f["ms"] as number).toBeGreaterThanOrEqual(0);
      expect(f["ms"] as number).toBeLessThan(1000);
      expect(f["gap"] as number).toBeGreaterThanOrEqual(0);
      expect(typeof f["cells"]).toBe("number");
    }
    expect(new Set(frames.map((f) => f["id"])).size).toBe(frames.length);
  });

  test("the frame time is in milliseconds", async () => {
    const { renderer, renderOnce } = await setup();
    const { logger, entries } = memoryLogger();
    installFrameLog(renderer, logger, { mountedIntervalMs: 60_000 });
    renderer.setFrameCallback(async () => {
      const start = performance.now();
      while (performance.now() - start < 25) {
        // busy: a slow frame
      }
    });
    await renderOnce();
    const frame = entries.find((e) => e.event === "frame")!;
    expect(frame["ms"] as number).toBeGreaterThanOrEqual(24);
    expect(frame["ms"] as number).toBeLessThan(200);
  });

  test("logMounted logs the count on demand; the timer logs only a changed count", async () => {
    const { renderer } = await setup();
    const { logger, entries } = memoryLogger();
    const log = installFrameLog(renderer, logger, { mountedIntervalMs: 20 })!;
    renderer.root.add(new BoxRenderable(renderer, { id: "one" }));
    renderer.root.add(new BoxRenderable(renderer, { id: "two" }));
    expect(log.logMounted()).toBe(2);
    expect(entries.filter((e) => e.event === "mounted")).toEqual([{ event: "mounted", count: 2 }]);
    await Bun.sleep(90);
    // Unchanged since logMounted: the timer stays quiet.
    expect(entries.filter((e) => e.event === "mounted").length).toBe(1);
    renderer.root.add(new BoxRenderable(renderer, { id: "three" }));
    await Bun.sleep(90);
    const counts = entries.filter((e) => e.event === "mounted").map((e) => e["count"]);
    expect(counts).toEqual([2, 3]);
    log.dispose();
  });
});
