// day-two-feedback task 1.2: `fast-tools` sends six short tool calls (each in progress for
// 40 ms, starts 250 ms apart), 3 s of silence, a one-line answer and `end_turn`; every time is
// multiplied by --delay-scale, and session/cancel ends the turn at any point. Timings are read
// from the timestamps of fake-agent's log.
//
// The timing tests of this file are in fast-tools.timing.test.ts (parallel-tests: they run in the serial pass).
import { describe, expect, test } from "bun:test";
import { FAST_TOOLS_ANSWER, FAST_TOOLS_CALLS, fastToolsCalls } from "../src/scenarios/fast-tools.ts";
import { run } from "./fast-tools-helpers.ts";

describe("fake-agent fast-tools scenario (day-two-feedback task 1.2)", () => {
  test("six calls in order, kinds read, search, read, execute, read, edit, then a one-line answer", async () => {
    const { stopReason, entries, updates } = await run(0);
    expect(stopReason).toBe("end_turn");
    expect(FAST_TOOLS_CALLS.map((call) => call.kind)).toEqual(["read", "search", "read", "execute", "read", "edit"]);
    expect(entries.map((entry) => `${entry.params.toolCallId} ${entry.params.status}`)).toEqual(
      FAST_TOOLS_CALLS.flatMap((call) => [`${call.toolCallId} in_progress`, `${call.toolCallId} completed`]),
    );
    expect(updates.map((update) => update.sessionUpdate)).toEqual([
      ...FAST_TOOLS_CALLS.flatMap(() => ["tool_call", "tool_call_update"]),
      "agent_message_chunk",
    ]);
    const started = updates.filter((update) => update.sessionUpdate === "tool_call");
    expect(started.map((update) => (update as { kind: string }).kind)).toEqual(FAST_TOOLS_CALLS.map((call) => call.kind));
    const last = updates.at(-1)!;
    expect(last.sessionUpdate === "agent_message_chunk" && last.content).toEqual({ type: "text", text: FAST_TOOLS_ANSWER });
    expect(FAST_TOOLS_ANSWER.trim().split("\n")).toHaveLength(1);
  });

  test("--tools 20 sends twenty calls cycling the six kinds, then the answer and end_turn", async () => {
    const { stopReason, updates } = await run(0, undefined, ["--tools", "20"]);
    expect(stopReason).toBe("end_turn");
    const started = updates.filter((update) => update.sessionUpdate === "tool_call") as { toolCallId: string; kind: string; title: string }[];
    expect(started).toHaveLength(20);
    expect(started.map((update) => update.toolCallId)).toEqual(Array.from({ length: 20 }, (_, i) => `ft-${i + 1}`));
    expect(started.map((update) => update.kind)).toEqual(fastToolsCalls(20).map((call) => call.kind));
    expect(started[6]!.title).toBe(FAST_TOOLS_CALLS[0]!.title);
    expect(updates.filter((update) => update.sessionUpdate === "tool_call_update")).toHaveLength(20);
    const last = updates.at(-1)!;
    expect(last.sessionUpdate === "agent_message_chunk" && last.content).toEqual({ type: "text", text: FAST_TOOLS_ANSWER });
  });
});
