// Task 4.2: asserts the "basic" scenario's update sequence, the answered
// permission path and the cancelled-mid-permission path, all over a real
// spawned child process.
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { editFixture } from "../src/diff-fixture.ts";
import { spawnFakeAgent } from "./helpers.ts";

describe("fake-agent basic scenario (task 4.2)", () => {
  test("answered permission path streams the full update sequence", async () => {
    const updates: SessionUpdate[] = [];
    const permissionRequests: unknown[] = [];

    const handle = spawnFakeAgent({
      scenario: "basic",
      client: {
        async sessionUpdate(params) {
          updates.push(params.update);
        },
        async requestPermission(params) {
          permissionRequests.push(params);
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

      expect(result.stopReason).toBe("end_turn");

      const kinds = updates.map((update) => update.sessionUpdate);
      expect(kinds).toEqual([
        "agent_message_chunk",
        "agent_message_chunk",
        "agent_message_chunk",
        "agent_message_chunk",
        "agent_message_chunk",
        "agent_message_chunk",
        "agent_thought_chunk",
        "tool_call",
        "tool_call",
        "tool_call_update",
        "tool_call_update",
        "usage_update",
        "plan",
      ]);

      // The unknown sessionUpdate variant (task 4.4) must never reach here:
      // the SDK's own zod validation drops it before this handler is called.
      expect(kinds).not.toContain("subagent_state_update");

      // messageId groups: first three chunks share msg-1, the rest have none.
      const messageChunks = updates.filter(
        (update): update is Extract<SessionUpdate, { sessionUpdate: "agent_message_chunk" }> =>
          update.sessionUpdate === "agent_message_chunk",
      );
      expect(messageChunks.slice(0, 3).every((chunk) => chunk.messageId === "msg-1")).toBe(true);
      expect(messageChunks.slice(3).every((chunk) => chunk.messageId === undefined)).toBe(true);

      // Hostile chunk text survives fake-agent untouched (sanitisation is
      // acp-model's job, not fake-agent's); both fixtures must be present.
      const hostileChunk = messageChunks[5];
      const hostileText = hostileChunk?.content.type === "text" ? hostileChunk.content.text : "";
      expect(hostileText).toContain("\u001b]52;c;");
      expect(hostileText).toContain("Permission: execute rm -rf /");

      // Tool calls start in order (t1 then t2) but complete out of order
      // (t2's update arrives before t1's).
      const toolCalls = updates.filter(
        (update): update is Extract<SessionUpdate, { sessionUpdate: "tool_call" }> =>
          update.sessionUpdate === "tool_call",
      );
      expect(toolCalls.map((call) => call.toolCallId)).toEqual(["t1", "t2"]);

      const toolCallUpdates = updates.filter(
        (update): update is Extract<SessionUpdate, { sessionUpdate: "tool_call_update" }> =>
          update.sessionUpdate === "tool_call_update",
      );
      expect(toolCallUpdates.map((call) => call.toolCallId)).toEqual(["t2", "t1"]);

      const editUpdate = toolCallUpdates[0];
      const diffContent = editUpdate?.content?.[0];
      expect(diffContent?.type).toBe("diff");
      const expectedDiff = editFixture();
      if (diffContent?.type === "diff") {
        const oldText = diffContent.oldText ?? "";
        expect(oldText).toBe(expectedDiff.oldText);
        expect(diffContent.newText).toBe(expectedDiff.newText);
        expect(oldText.split("\n").length).toBe(11); // 10 lines + trailing blank
        expect(diffContent.newText.split("\n").length).toBe(20); // 7 kept + 12 added + trailing blank
      }

      // Permission request: exactly one, tied to t2, options in agent order.
      expect(permissionRequests).toHaveLength(1);
      const request = permissionRequests[0] as {
        toolCall: { toolCallId: string };
        options: Array<{ optionId: string; kind: string }>;
      };
      expect(request.toolCall.toolCallId).toBe("t2");
      expect(request.options.map((option) => option.kind)).toEqual([
        "allow_once",
        "allow_always",
        "reject_once",
      ]);

      const usageUpdate = updates.find(
        (update): update is Extract<SessionUpdate, { sessionUpdate: "usage_update" }> =>
          update.sessionUpdate === "usage_update",
      );
      expect(usageUpdate?.used).toBe(38000);
      expect(usageUpdate?.size).toBe(200000);

      const planUpdate = updates.find(
        (update): update is Extract<SessionUpdate, { sessionUpdate: "plan" }> =>
          update.sessionUpdate === "plan",
      );
      expect(planUpdate?.entries).toHaveLength(3);
    } finally {
      handle.stop();
    }
  });

  test("cancelling while a permission request is open stops the turn", async () => {
    const updates: SessionUpdate[] = [];

    const handle = spawnFakeAgent({
      scenario: "basic",
      client: {
        async sessionUpdate(params) {
          updates.push(params.update);
        },
        async requestPermission(params) {
          // Mirror acp-tui's contract (tui-agent-session spec, "Cancel with a
          // permission request open"): answer with outcome cancelled and send
          // session/cancel.
          void handle.conn.cancel({ sessionId: params.sessionId });
          return { outcome: { outcome: "cancelled" } };
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

      expect(result.stopReason).toBe("cancelled");

      const kinds = updates.map((update) => update.sessionUpdate);
      // Everything up to and including both tool_call starts, but nothing
      // that only happens after the permission gate.
      expect(kinds).not.toContain("tool_call_update");
      expect(kinds).not.toContain("usage_update");
      expect(kinds).not.toContain("plan");
      expect(kinds.filter((kind) => kind === "tool_call")).toHaveLength(2);
    } finally {
      handle.stop();
    }
  });
});
