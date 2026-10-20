// Which live model events can follow a harness retitling the Windows console (harness-activity.ts).
import { describe, expect, test } from "bun:test";
import type { ModelEvent } from "acp-model";
import { harnessActivity } from "../../src/agent/harness-activity.ts";

const at = 0;
const update = (u: Record<string, unknown>): ModelEvent => ({ type: "session_update", update: u as never, at });

describe("harnessActivity", () => {
  test("a session created or opened is a session moment", () => {
    expect(harnessActivity({ type: "session_created", response: {} as never, cwd: "/w", agentInfo: null, at })).toBe("session");
    expect(harnessActivity({ type: "session_opened", response: {} as never, at })).toBe("session");
  });

  test("a prompt answered, or failed, ends a turn", () => {
    expect(harnessActivity({ type: "prompt_response", stopReason: "end_turn", at })).toBe("turn_end");
    expect(harnessActivity({ type: "prompt_error", message: "x", at })).toBe("turn_end");
  });

  test("a tool call counts when it reaches a final status", () => {
    expect(harnessActivity(update({ sessionUpdate: "tool_call", toolCallId: "1", status: "pending" }))).toBeNull();
    expect(harnessActivity(update({ sessionUpdate: "tool_call_update", toolCallId: "1", status: "in_progress" }))).toBeNull();
    expect(harnessActivity(update({ sessionUpdate: "tool_call_update", toolCallId: "1" }))).toBeNull();
    expect(harnessActivity(update({ sessionUpdate: "tool_call_update", toolCallId: "1", status: "completed" }))).toBe("tool");
    expect(harnessActivity(update({ sessionUpdate: "tool_call_update", toolCallId: "1", status: "failed" }))).toBe("tool");
  });

  test("message chunks and the rest are not", () => {
    expect(harnessActivity(update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } }))).toBeNull();
    expect(harnessActivity({ type: "prompt_sent", text: "hi", at })).toBeNull();
  });
});
