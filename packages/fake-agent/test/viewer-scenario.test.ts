// The "viewer" scenario (acp-tui tasks 9.1, 9.2): permission for the earlier
// of two tool calls, then completions in the opposite order to their start.
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { spawnFakeAgent } from "./helpers.ts";

describe("fake-agent viewer scenario", () => {
  test("permission for v1 while v2 is the most recent; v2 completes before v1", async () => {
    const updates: SessionUpdate[] = [];
    let seenAtPermission: string[] = [];
    const handle = spawnFakeAgent({
      scenario: "viewer",
      client: {
        async sessionUpdate(params) {
          updates.push(params.update);
        },
        async requestPermission(params) {
          seenAtPermission = updates.filter((u) => u.sessionUpdate === "tool_call").map((u) => (u as { toolCallId: string }).toolCallId);
          expect(params.toolCall.toolCallId).toBe("v1");
          return { outcome: { outcome: "selected", optionId: "allow-once" } };
        },
      },
    });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      const result = await handle.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "check" }] });
      expect(result.stopReason).toBe("end_turn");
      expect(seenAtPermission).toEqual(["v1", "v2"]);
      const completions = updates
        .filter((u) => u.sessionUpdate === "tool_call_update" && u.status === "completed")
        .map((u) => (u as { toolCallId: string }).toolCallId);
      expect(completions).toEqual(["v2", "v1"]);
    } finally {
      handle.stop();
    }
  });
});
