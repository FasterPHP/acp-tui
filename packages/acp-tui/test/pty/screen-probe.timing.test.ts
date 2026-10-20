// parallel-tests task 3.4: the fixture replay test, whose assertions are timing bands (the replay takes at least 295 ms, the two wheel reports arrive between 90 and 400 ms apart, a fast replay takes under 100 ms), which runs in the serial pass.
// What the file covers is in the header of screen-probe.test.ts; its helpers are in screen-probe-helpers.ts.
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { parseFixture, serialiseFixture } from "./harness.ts";
import { sgrMotion, sgrWheel } from "./mouse.ts";
import { probe, quit, createDir, disposeSessions } from "./screen-probe-helpers.ts";

beforeAll(createDir);
afterEach(disposeSessions);

describe("SGR mouse injection (2.3)", () => {
  test("replays a recorded fixture with its timing", async () => {
    const records = parseFixture(
      serialiseFixture([
        { t_ms: 0, data: sgrWheel(4, 4, 68) },
        { t_ms: 3, data: "\x1b[A" },
        { t_ms: 120, data: sgrWheel(4, 4, 69) },
        { t_ms: 123, data: "\x1b[B" },
        { t_ms: 300, data: sgrMotion(6, 7) },
      ]),
    );
    expect(records).toHaveLength(5);
    expect(() => parseFixture('{"t_ms":5,"data":"a"}\n{"t_ms":1,"data":"b"}')).toThrow(/backwards/);
    const p = probe();
    await p.waitLog((e) => e.kind === "ready");
    const elapsed = await p.s.replay(records);
    expect(elapsed).toBeGreaterThanOrEqual(295);
    await p.waitLog((e) => e.kind === "mouse" && e.type === "move");
    const log = p.log();
    const scrolls = log.filter((e) => e.kind === "mouse" && e.type === "scroll");
    expect(scrolls.map((e) => e.dir)).toEqual(["up", "down"]);
    // The timing survived: the second wheel report arrived about 120 ms after the first.
    const gap = scrolls[1]!.t - scrolls[0]!.t;
    expect(gap).toBeGreaterThanOrEqual(90);
    expect(gap).toBeLessThan(400);
    // The cursor keys that followed each wheel report reached the key handler.
    const keys = log.filter((e) => e.kind === "key").map((e) => e.name);
    expect(keys).toEqual(["up", "down"]);
    // Fast replay ignores the clock.
    expect(await p.s.replay(records, { speed: Infinity })).toBeLessThan(100);
    expect(await quit(p)).toBe(0);
  }, 15000);
});
