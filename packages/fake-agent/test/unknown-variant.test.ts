// Task 4.4: establishes exactly what happens when an agent sends a
// sessionUpdate variant the ACP v1 union does not define
// ("subagent_state_update", the same example the model-session spec uses).
//
// Finding (see docs/phase-0-notes/fake-agent.md for the full writeup and SDK
// source references): the client-side SDK's own zod validation
// (validate.zSessionNotification.parse in dist/acp.js's
// registerAppNotification/onReceiveNotification path) rejects the whole
// notification with a "Invalid params" (-32602) error before the Client's
// sessionUpdate() handler is ever called. jsonrpc.js's
// Connection.processIncomingMessage catches that error per-message
// (message.kind === "notification", so it logs via console.error rather
// than closing the connection or crashing the process) and continues
// reading. Net effect: the unknown update is silently dropped -- never
// delivered to the client's handler, but also never breaking the
// connection or later updates -- which is why model-session's own
// "Unknown updates are ignored, not errors" requirement is verified against
// the reducer directly (packages/acp-model/test), not through this wire
// path: the SDK already discards the update before acp-tui's handler could
// ignore it itself.
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { spawnFakeAgent } from "./helpers.ts";

describe("unknown sessionUpdate variant over the wire (task 4.4)", () => {
  test("is dropped by the SDK, not delivered to the client, connection survives", async () => {
    const updates: SessionUpdate[] = [];

    const handle = spawnFakeAgent({
      scenario: "basic",
      client: {
        async sessionUpdate(params) {
          updates.push(params.update);
        },
        async requestPermission(params) {
          const allowOnce = params.options.find((option) => option.kind === "allow_once");
          if (!allowOnce) throw new Error("expected an allow_once option");
          return { outcome: { outcome: "selected", optionId: allowOnce.optionId } };
        },
      },
    });

    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      const result = await handle.conn.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "hello" }],
      });

      // The turn still completes normally: the dropped notification did not
      // break the connection or stall the prompt response.
      expect(result.stopReason).toBe("end_turn");

      // Never delivered to the client's sessionUpdate handler. Cast to
      // string: "subagent_state_update" is deliberately outside the typed
      // SessionUpdate union, which is exactly the point being tested.
      expect(
        updates.some((update) => (update.sessionUpdate as string) === "subagent_state_update"),
      ).toBe(false);

      // Every update either side of it in the scenario script still arrived,
      // proving the connection kept processing after the drop.
      expect(updates.some((update) => update.sessionUpdate === "agent_thought_chunk")).toBe(true);
      expect(updates.some((update) => update.sessionUpdate === "tool_call")).toBe(true);
      expect(updates.some((update) => update.sessionUpdate === "usage_update")).toBe(true);
    } finally {
      handle.stop();
    }
  });
});
