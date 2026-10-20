// mvp-chrome-and-keys task 2.5: `slow-turn` has a silent gap between two tool calls (3 s, or 45 s
// with --long-gap, both times --delay-scale). The timing tests of the gap are in
// slow-turn.timing.test.ts (parallel-tests task 5.1: they run in the serial pass).
import { describe, expect, test } from "bun:test";
import { parseArgs } from "../src/cli.ts";

describe("fake-agent slow-turn scenario (task 2.5)", () => {
  test("--long-gap is parsed, off by default", () => {
    expect(parseArgs([], {}).longGap).toBe(false);
    expect(parseArgs(["--scenario", "slow-turn", "--long-gap"], {}).longGap).toBe(true);
  });
});
