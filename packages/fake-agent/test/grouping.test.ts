// mvp-conversation task 1.1: the `grouping` scenario's update sequence. One turn: read #1, a quiet
// `other` call, a thought, read #2, an `other` call that asks for permission, read #3, and reads
// #3 to #5 completing in the order #5, #3, #4.
import { describe, expect, test } from "bun:test";
import type { RequestPermissionRequest, SessionUpdate } from "@agentclientprotocol/sdk";
import {
  GROUPING_COMPLETION_ORDER,
  GROUPING_PERMISSION_OTHER_ID,
  GROUPING_QUIET_OTHER_ID,
  groupingReadId,
  groupingReadTitle,
} from "../src/scenarios/grouping.ts";
import { spawnFakeAgent } from "./helpers.ts";

type Event = { readonly step: string; readonly id?: string | undefined; readonly status?: string | null | undefined };

/** Runs the scenario once; `permissions` is what the client answers (default: allow once). */
async function run(answer: "allow" | "reject" = "allow") {
  const events: Event[] = [];
  const updates: SessionUpdate[] = [];
  const requests: RequestPermissionRequest[] = [];
  const handle = spawnFakeAgent({
    scenario: "grouping",
    client: {
      async sessionUpdate(params) {
        const update = params.update;
        updates.push(update);
        if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
          events.push({ step: update.sessionUpdate, id: update.toolCallId, status: update.status });
        } else {
          events.push({ step: update.sessionUpdate });
        }
      },
      async requestPermission(params) {
        requests.push(params);
        events.push({ step: "permission", id: params.toolCall.toolCallId });
        const option = params.options.find((o) => o.kind === (answer === "allow" ? "allow_once" : "reject_once"));
        return { outcome: { outcome: "selected", optionId: option!.optionId } };
      },
    },
  });
  try {
    await handle.conn.initialize({ protocolVersion: 1 });
    const session = await handle.conn.newSession({ cwd: "/tmp", mcpServers: [] });
    const response = await handle.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "go" }] });
    return { events, updates, requests, response };
  } finally {
    handle.stop();
  }
}

describe("fake-agent grouping scenario (mvp-conversation task 1.1)", () => {
  test("the turn's update sequence", async () => {
    const { events, response } = await run();
    expect(response.stopReason).toBe("end_turn");
    const read = (n: number) => groupingReadId(n);
    expect(events).toEqual([
      { step: "tool_call", id: read(1), status: "in_progress" },
      { step: "tool_call_update", id: read(1), status: "completed" },
      { step: "tool_call", id: GROUPING_QUIET_OTHER_ID, status: "in_progress" },
      { step: "tool_call_update", id: GROUPING_QUIET_OTHER_ID, status: "completed" },
      { step: "agent_thought_chunk" },
      { step: "tool_call", id: read(2), status: "in_progress" },
      { step: "tool_call_update", id: read(2), status: "completed" },
      { step: "tool_call", id: GROUPING_PERMISSION_OTHER_ID, status: "pending" },
      { step: "permission", id: GROUPING_PERMISSION_OTHER_ID },
      { step: "tool_call_update", id: GROUPING_PERMISSION_OTHER_ID, status: "completed" },
      { step: "tool_call", id: read(3), status: "in_progress" },
      { step: "tool_call", id: read(4), status: "in_progress" },
      { step: "tool_call", id: read(5), status: "in_progress" },
      { step: "tool_call_update", id: read(5), status: "completed" },
      { step: "tool_call_update", id: read(3), status: "completed" },
      { step: "tool_call_update", id: read(4), status: "completed" },
    ]);
    expect(GROUPING_COMPLETION_ORDER).toEqual([5, 3, 4]);
  });

  test("kinds: reads are read, both other calls are other, the quiet one has text content only", async () => {
    const { updates } = await run();
    const calls = updates.flatMap((u) => (u.sessionUpdate === "tool_call" ? [u] : []));
    expect(calls.map((c) => [c.toolCallId, c.kind])).toEqual([
      ["read-1", "read"],
      [GROUPING_QUIET_OTHER_ID, "other"],
      ["read-2", "read"],
      [GROUPING_PERMISSION_OTHER_ID, "other"],
      ["read-3", "read"],
      ["read-4", "read"],
      ["read-5", "read"],
    ]);
    expect(calls.find((c) => c.toolCallId === "read-3")?.title).toBe(groupingReadTitle(3));
    const quiet = updates.find((u) => u.sessionUpdate === "tool_call_update" && u.toolCallId === GROUPING_QUIET_OTHER_ID);
    expect(quiet?.sessionUpdate === "tool_call_update" && quiet.content?.map((c) => c.type)).toEqual(["content"]);
    const withoutDiff = updates.flatMap((u) => (u.sessionUpdate === "tool_call_update" ? (u.content ?? []) : []));
    expect(withoutDiff.some((c) => c.type === "diff")).toBe(false);
  });

  test("the permission request names the second other call, with an allow and a reject option", async () => {
    const { requests } = await run();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.toolCall.toolCallId).toBe(GROUPING_PERMISSION_OTHER_ID);
    expect(requests[0]!.options.map((o) => o.kind)).toEqual(["allow_once", "reject_once"]);
  });

  test("a rejected request fails the call and the reads still follow", async () => {
    const { events } = await run("reject");
    expect(events).toContainEqual({ step: "tool_call_update", id: GROUPING_PERMISSION_OTHER_ID, status: "failed" });
    expect(events.filter((e) => e.step === "tool_call_update" && e.status === "completed").map((e) => e.id).slice(-3)).toEqual([
      "read-5",
      "read-3",
      "read-4",
    ]);
  });
});
