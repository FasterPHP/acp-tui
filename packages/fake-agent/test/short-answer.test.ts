// mvp-rendering task 9.4: short-answer sends a turn shaped like S7 session D4: a read, a thought
// holding a summary and a numbered plan, an `other` call, an execute, then a one-sentence answer.
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { SHORT_ANSWER_IDS, SHORT_ANSWER_TEXT, SHORT_ANSWER_THOUGHT } from "../src/scenarios/short-answer.ts";
import { spawnFakeAgent } from "./helpers.ts";

describe("fake-agent short-answer scenario (mvp-rendering task 9.4)", () => {
  test("the thought holds a bold title and a numbered plan; the answer is one sentence", () => {
    expect(SHORT_ANSWER_THOUGHT).toStartWith("**Planning the S7 steps**\n\n");
    expect(SHORT_ANSWER_THOUGHT.split("\n").filter((line) => /^\d\. /.test(line))).toHaveLength(4);
    expect(SHORT_ANSWER_TEXT).not.toContain("\n");
    expect(SHORT_ANSWER_TEXT.match(/\./g)).toHaveLength(1);
  });

  test("sends the read, the thought, the other call, the execute and the answer, in that order", async () => {
    const updates: SessionUpdate[] = [];
    const handle = spawnFakeAgent({
      scenario: "short-answer",
      client: {
        async sessionUpdate(params) {
          updates.push(params.update);
        },
        async requestPermission() {
          throw new Error("short-answer does not request permission");
        },
      },
    });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      const result = await handle.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "go" }] });
      expect(result.stopReason).toBe("end_turn");
      const steps = updates.map((u) => {
        if (u.sessionUpdate === "tool_call") return `tool_call ${u.toolCallId} ${u.kind}`;
        if (u.sessionUpdate === "tool_call_update") return `tool_call_update ${u.toolCallId} ${u.status}`;
        if (u.sessionUpdate === "agent_thought_chunk" || u.sessionUpdate === "agent_message_chunk") return `${u.sessionUpdate} ${u.messageId}`;
        return u.sessionUpdate;
      });
      expect(steps).toEqual([
        `tool_call ${SHORT_ANSWER_IDS.read} read`,
        `tool_call_update ${SHORT_ANSWER_IDS.read} completed`,
        `agent_thought_chunk ${SHORT_ANSWER_IDS.thought}`,
        `tool_call ${SHORT_ANSWER_IDS.search} other`,
        `tool_call_update ${SHORT_ANSWER_IDS.search} completed`,
        `tool_call ${SHORT_ANSWER_IDS.touch} execute`,
        `tool_call_update ${SHORT_ANSWER_IDS.touch} completed`,
        `agent_message_chunk ${SHORT_ANSWER_IDS.answer}`,
      ]);
      const thought = updates.find((u) => u.sessionUpdate === "agent_thought_chunk");
      expect(thought?.sessionUpdate === "agent_thought_chunk" && thought.content.type === "text" ? thought.content.text : "").toBe(SHORT_ANSWER_THOUGHT);
      const answer = updates.find((u) => u.sessionUpdate === "agent_message_chunk");
      expect(answer?.sessionUpdate === "agent_message_chunk" && answer.content.type === "text" ? answer.content.text : "").toBe(SHORT_ANSWER_TEXT);
    } finally {
      handle.stop();
    }
  });
});
