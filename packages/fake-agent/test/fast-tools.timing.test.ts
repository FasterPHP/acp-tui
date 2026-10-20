// parallel-tests task 5.1: the fast-tools tests with timing bands (each call lives 40 ms and starts 250 ms apart within a tolerance, a cancel ends the turn within 2.5 s, a cancel between calls stops the rest), which run in the serial pass; the test of the scenario's events at delay scale 0 stays in fast-tools.test.ts.
// What the file covers is in the header of fast-tools.test.ts; its helpers are in fast-tools-helpers.ts.
import { describe, expect, test } from "bun:test";
import { FAST_TOOLS_CALLS, FAST_TOOLS_LIVE_MS, FAST_TOOLS_PERIOD_MS, FAST_TOOLS_SILENCE_MS } from "../src/scenarios/fast-tools.ts";
import { run, at } from "./fast-tools-helpers.ts";

describe("fake-agent fast-tools scenario (day-two-feedback task 1.2)", () => {
  test("at delay scale 1 each call lives 40 ms, starts are 250 ms apart and 3 s of silence follow", async () => {
    const { stopReason, entries, ended } = await run(1);
    expect(stopReason).toBe("end_turn");
    const tolerance = 40;
    FAST_TOOLS_CALLS.forEach((call, index) => {
      const live = at(entries, call.toolCallId, "completed") - at(entries, call.toolCallId, "in_progress");
      expect(live).toBeGreaterThanOrEqual(FAST_TOOLS_LIVE_MS - 5);
      expect(live).toBeLessThan(FAST_TOOLS_LIVE_MS + tolerance);
      if (index > 0) {
        const previous = FAST_TOOLS_CALLS[index - 1]!;
        const period = at(entries, call.toolCallId, "in_progress") - at(entries, previous.toolCallId, "in_progress");
        expect(period).toBeGreaterThanOrEqual(FAST_TOOLS_PERIOD_MS - 5);
        expect(period).toBeLessThan(FAST_TOOLS_PERIOD_MS + tolerance);
      }
    });
    // The turn ends the silence after the last completion: five periods, 40 ms, the silence.
    const total = 5 * FAST_TOOLS_PERIOD_MS + FAST_TOOLS_LIVE_MS + FAST_TOOLS_SILENCE_MS;
    expect(ended).toBeGreaterThanOrEqual(total - 20);
    expect(ended).toBeLessThan(total + 600);
  }, 15_000);

  test("session/cancel during the silence ends the turn cancelled at once, with no answer", async () => {
    const { stopReason, updates, ended } = await run(1, 1700);
    expect(stopReason).toBe("cancelled");
    expect(updates.some((update) => update.sessionUpdate === "agent_message_chunk")).toBe(false);
    expect(ended).toBeLessThan(2500);
  }, 15_000);

  test("session/cancel between calls stops the remaining ones", async () => {
    const { stopReason, entries } = await run(1, 600);
    expect(stopReason).toBe("cancelled");
    const completed = entries.filter((entry) => entry.params.status === "completed");
    expect(completed.length).toBeGreaterThanOrEqual(2);
    expect(completed.length).toBeLessThan(FAST_TOOLS_CALLS.length);
  }, 15_000);
});
