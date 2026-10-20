// day-one-feedback task 2.2: usage-without-cost reports the cost once, at the end of turn 1, and
// sends usage updates with `used` and `size` only in turn 2, as claude-agent-acp 0.81.2 does.
import { describe, expect, test } from "bun:test";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { USAGE_WITHOUT_COST_FIRST, USAGE_WITHOUT_COST_LATER } from "../src/scenarios/usage-without-cost.ts";
import { spawnFakeAgent } from "./helpers.ts";

describe("fake-agent usage-without-cost scenario (day-one-feedback task 2.2)", () => {
  test("turn 1 ends with a costed usage_update; turn 2 streams two without a cost", async () => {
    const updates: SessionUpdate[] = [];
    const handle = spawnFakeAgent({
      scenario: "usage-without-cost",
      client: {
        async sessionUpdate(params) {
          updates.push(params.update);
        },
        async requestPermission() {
          throw new Error("usage-without-cost does not request permission");
        },
      },
    });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: "/tmp", mcpServers: [] });
      for (const turn of [1, 2]) {
        const result = await handle.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: `turn ${turn}` }] });
        expect(result.stopReason).toBe("end_turn");
      }

      expect(updates.map((u) => u.sessionUpdate)).toEqual([
        "agent_message_chunk",
        "usage_update",
        "agent_message_chunk",
        "usage_update",
        "usage_update",
      ]);
      const usages = updates.filter((u) => u.sessionUpdate === "usage_update");
      expect(usages[0]).toEqual({ sessionUpdate: "usage_update", ...USAGE_WITHOUT_COST_FIRST });
      expect(usages[0]).toMatchObject({ used: 38000, size: 200000, cost: { amount: 0.42, currency: "USD" } });
      expect(usages.slice(1)).toEqual(USAGE_WITHOUT_COST_LATER.map((later) => ({ sessionUpdate: "usage_update", ...later })));
      for (const later of usages.slice(1)) expect("cost" in later).toBe(false);
    } finally {
      handle.stop();
    }
  });
});
