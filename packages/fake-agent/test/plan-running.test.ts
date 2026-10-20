// Phase-1a task 6.4: plan-running reaches "two tool calls in progress, a five-entry plan with two
// completed and the third in progress", holds it, and honours cancel while holding.
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { PLAN_RUNNING_ENTRIES, PLAN_RUNNING_TOOL_TITLES } from "../src/scenarios/plan-running.ts";
import { spawnFakeAgent } from "./helpers.ts";

async function run(delayScale: number, cancelAfterMs?: number) {
  const updates: SessionUpdate[] = [];
  const handle = spawnFakeAgent({
    scenario: "plan-running",
    delayScale,
    client: {
      async sessionUpdate(params) {
        updates.push(params.update);
      },
      async requestPermission() {
        throw new Error("plan-running does not request permission");
      },
    },
  });
  try {
    await handle.conn.initialize({ protocolVersion: 1 });
    const session = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
    const turn = handle.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "go" }] });
    if (cancelAfterMs !== undefined) {
      await Bun.sleep(cancelAfterMs);
      await handle.conn.cancel({ sessionId: session.sessionId });
    }
    return { updates, response: await turn };
  } finally {
    handle.stop();
  }
}

describe("fake-agent plan-running scenario (phase-1a task 6.4)", () => {
  test("two tools in progress and the plan at 2 of 5 before anything completes; then everything completes", async () => {
    const { updates, response } = await run(0);
    expect(response.stopReason).toBe("end_turn");
    const starts = updates.flatMap((u) => (u.sessionUpdate === "tool_call" ? [u] : []));
    expect(starts.map((t) => [t.title, t.status])).toEqual(PLAN_RUNNING_TOOL_TITLES.map((title) => [title, "in_progress"]));
    const plans = updates.flatMap((u) => (u.sessionUpdate === "plan" ? [u] : []));
    expect(plans[0]!.entries.map((e) => [e.content, e.status])).toEqual(
      PLAN_RUNNING_ENTRIES.map((content, i) => [content, ["completed", "completed", "in_progress", "pending", "pending"][i]]),
    );
    // The held state comes first: both starts and the first plan precede the first completion.
    const firstCompletion = updates.findIndex((u) => u.sessionUpdate === "tool_call_update");
    expect(updates.findIndex((u) => u.sessionUpdate === "plan")).toBeLessThan(firstCompletion);
    expect(updates.lastIndexOf(starts[1]!)).toBeLessThan(firstCompletion);
    expect(updates.filter((u) => u.sessionUpdate === "tool_call_update")).toHaveLength(2);
    expect(plans.at(-1)!.entries.every((e) => e.status === "completed")).toBe(true);
  });

  test("session/cancel while holding ends the turn cancelled, with no completions", async () => {
    const { updates, response } = await run(200, 300);
    expect(response.stopReason).toBe("cancelled");
    expect(updates.filter((u) => u.sessionUpdate === "tool_call")).toHaveLength(2);
    expect(updates.filter((u) => u.sessionUpdate === "tool_call_update")).toHaveLength(0);
  });
});
