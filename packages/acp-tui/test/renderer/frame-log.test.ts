// The frame and mounted-renderable log events (phase-1a task 12.1), on OpenTUI's test renderer.
//
// The timing tests of this file are in frame-log.timing.test.ts (parallel-tests: they run in the serial pass).
import { afterEach, describe, expect, test } from "bun:test";
import { BoxRenderable, TextRenderable } from "@opentui/core";
import { countMounted, installFrameLog } from "../../src/renderer/frame-log.ts";
import { NULL_LOGGER } from "../../src/log.ts";
import { memoryLogger, setup, disposeMade } from "./frame-log-helpers.ts";

afterEach(disposeMade);

describe("countMounted", () => {
  test("counts every renderable below the root, at any depth", async () => {
    const { renderer } = await setup();
    expect(countMounted(renderer.root)).toBe(0);
    const outer = new BoxRenderable(renderer, { id: "outer" });
    const inner = new BoxRenderable(renderer, { id: "inner" });
    const a = new TextRenderable(renderer, { id: "a", content: "a" });
    inner.add(a);
    inner.add(new TextRenderable(renderer, { id: "b", content: "b" }));
    outer.add(inner);
    renderer.root.add(outer);
    expect(countMounted(renderer.root)).toBe(4);
    inner.remove(a);
    expect(countMounted(renderer.root)).toBe(3);
  });
});

describe("installFrameLog", () => {
  test("installs nothing without a logger", async () => {
    const { renderer } = await setup();
    expect(installFrameLog(renderer, NULL_LOGGER)).toBeNull();
  });

  test("dispose stops the frame listener and the timer", async () => {
    const { renderer, renderOnce } = await setup();
    const { logger, entries } = memoryLogger();
    const log = installFrameLog(renderer, logger, { mountedIntervalMs: 10 })!;
    log.dispose();
    renderer.root.add(new BoxRenderable(renderer, { id: "x" }));
    await renderOnce();
    await Bun.sleep(50);
    expect(entries).toEqual([]);
  });
});
