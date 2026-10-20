// Task 3.4: turn state transitions, stop reason and turn-end marker, finalisation rules, plan
// replacement and turn-end commit, usage tracking, unknown-variant handling, and the 5000-item
// retention test. One test per requirement/scenario in spec model-session.

import { describe, expect, test } from "bun:test";
import { reduce } from "../src/reducer.ts";
import { createSession } from "../src/types.ts";
import type {
  MarkerItem,
  PermissionRecordItem,
  PlanItem,
  Session,
  ToolCallItem,
} from "../src/types.ts";

function markersOf(session: Session): MarkerItem[] {
  return session.order
    .map((id) => session.items.get(id))
    .filter((item): item is MarkerItem => item?.kind === "marker");
}

describe("turn state follows ACP v2 semantics", () => {
  test("prompt lifecycle: idle -> running -> requires_action -> running -> idle, turn-end marker appended", () => {
    let session = createSession();
    expect(session.state).toBe("idle");

    session = reduce(session, { type: "prompt_sent", text: "do it", at: 0 });
    expect(session.state).toBe("running");

    session = reduce(session, {
      type: "permission_opened",
      toolCallId: "t1",
      at: 1,
      request: { sessionId: "s1", toolCall: { toolCallId: "t1", title: "Run" }, options: [] },
    });
    expect(session.state).toBe("requires_action");

    session = reduce(session, {
      type: "permission_answered",
      toolCallId: "t1",
      optionId: "allow-once",
      optionKind: "allow_once",
      at: 2,
    });
    expect(session.state).toBe("running");

    session = reduce(session, { type: "prompt_response", stopReason: "end_turn", at: 10 });
    expect(session.state).toBe("idle");
    expect(session.stopReason).toBe("end_turn");

    const markers = markersOf(session).filter((m) => m.markerKind === "turn_end");
    expect(markers).toHaveLength(1);
    expect(markers[0]?.stopReason).toBe("end_turn");
    expect(markers[0]?.durationMs).toBe(10);
  });

  test("Two requests open: the state stays requires_action until the second is answered or withdrawn", () => {
    let session = reduce(createSession(), { type: "prompt_sent", text: "go", at: 0 });
    for (const [n, id] of ["t1", "t2"].entries()) {
      session = reduce(session, {
        type: "permission_opened",
        toolCallId: id,
        at: 1 + n,
        request: { sessionId: "s1", toolCall: { toolCallId: id, title: `Run ${id}` }, options: [] },
      });
    }
    expect(session.state).toBe("requires_action");
    expect(session.turn?.openPermissionToolCallIds).toEqual(["t1", "t2"]);
    expect(session.turn?.openPermissionToolCallId).toBe("t1");

    session = reduce(session, {
      type: "permission_answered",
      toolCallId: "t1",
      optionId: "allow-once",
      optionKind: "allow_once",
      at: 3,
    });
    expect(session.state).toBe("requires_action");
    expect(session.turn?.openPermissionToolCallId).toBe("t2");
    expect((session.items.get("permission:t2") as PermissionRecordItem).outcome).toEqual({ type: "pending" });

    session = reduce(session, { type: "permission_withdrawn", toolCallId: "t2", at: 4 });
    expect(session.state).toBe("running");
    expect(session.turn?.openPermissionToolCallId).toBeNull();
  });

  test("Withdrawal outcome: the record closes as withdrawn and the tool call item is unchanged", () => {
    let session = reduce(createSession(), { type: "prompt_sent", text: "go", at: 0 });
    session = reduce(session, {
      type: "permission_opened",
      toolCallId: "t1",
      at: 1,
      request: { sessionId: "s1", toolCall: { toolCallId: "t1", title: "Run" }, options: [] },
    });
    const toolBefore = session.items.get("tool:t1");
    session = reduce(session, { type: "permission_withdrawn", toolCallId: "t1", at: 2 });
    const permission = session.items.get("permission:t1") as PermissionRecordItem;
    expect(permission.outcome).toEqual({ type: "withdrawn" });
    expect(permission.status).toBe("final");
    expect(session.items.get("tool:t1")).toBe(toolBefore);
    expect(session.state).toBe("running");
  });

  test("Withdrawal leaves any other open request open", () => {
    let session = reduce(createSession(), { type: "prompt_sent", text: "go", at: 0 });
    for (const id of ["t1", "t2"]) {
      session = reduce(session, {
        type: "permission_opened",
        toolCallId: id,
        at: 1,
        request: { sessionId: "s1", toolCall: { toolCallId: id, title: id }, options: [] },
      });
    }
    session = reduce(session, { type: "permission_withdrawn", toolCallId: "t2", at: 2 });
    expect(session.state).toBe("requires_action");
    expect(session.turn?.openPermissionToolCallIds).toEqual(["t1"]);
    expect((session.items.get("permission:t1") as PermissionRecordItem).outcome).toEqual({ type: "pending" });
    expect((session.items.get("permission:t2") as PermissionRecordItem).outcome).toEqual({ type: "withdrawn" });
  });

  test("Elicitation open: requires_action while a request is open, running once answered, no item added", () => {
    let session = reduce(createSession(), { type: "prompt_sent", text: "go", at: 0 });
    const order = session.order;
    session = reduce(session, { type: "elicitation_opened", elicitationId: "e1", at: 1 });
    expect(session.state).toBe("requires_action");
    expect(session.turn?.openElicitationIds).toEqual(["e1"]);
    session = reduce(session, { type: "elicitation_closed", elicitationId: "e1", at: 2 });
    expect(session.state).toBe("running");
    expect(session.order).toBe(order);
  });

  test("Elicitation closes: no open request remains and the item order is unchanged", () => {
    let session = reduce(createSession(), { type: "prompt_sent", text: "go", at: 0 });
    const order = session.order;
    session = reduce(session, { type: "elicitation_opened", elicitationId: "e1", at: 1 });
    session = reduce(session, { type: "elicitation_closed", elicitationId: "e1", at: 2 });
    expect(session.turn?.openElicitationIds).toEqual([]);
    expect(session.order).toEqual(order);
    expect(session.items.size).toBe(order.length);
  });

  test("a permission and an elicitation open together keep requires_action until both close", () => {
    let session = reduce(createSession(), { type: "prompt_sent", text: "go", at: 0 });
    session = reduce(session, { type: "elicitation_opened", elicitationId: "e1", at: 1 });
    session = reduce(session, {
      type: "permission_opened",
      toolCallId: "t1",
      at: 2,
      request: { sessionId: "s1", toolCall: { toolCallId: "t1", title: "Run" }, options: [] },
    });
    session = reduce(session, { type: "permission_cancelled", toolCallId: "t1", at: 3 });
    expect(session.state).toBe("requires_action");
    session = reduce(session, { type: "elicitation_closed", elicitationId: "e1", at: 4 });
    expect(session.state).toBe("running");
  });

  test("closing an unknown elicitation, or ending the turn, leaves nothing open", () => {
    let session = reduce(createSession(), { type: "prompt_sent", text: "go", at: 0 });
    expect(reduce(session, { type: "elicitation_closed", elicitationId: "nope", at: 1 })).toBe(session);
    session = reduce(session, { type: "elicitation_opened", elicitationId: "e1", at: 1 });
    session = reduce(session, { type: "prompt_response", stopReason: "cancelled", at: 2 });
    expect(session.state).toBe("idle");
    expect(session.turn).toBeNull();
  });

  test("cancelling an open permission also returns the turn to running", () => {
    let session = reduce(createSession(), { type: "prompt_sent", text: "go", at: 0 });
    session = reduce(session, {
      type: "permission_opened",
      toolCallId: "t1",
      at: 1,
      request: { sessionId: "s1", toolCall: { toolCallId: "t1", title: "Run" }, options: [] },
    });
    expect(session.state).toBe("requires_action");
    session = reduce(session, { type: "permission_cancelled", toolCallId: "t1", at: 2 });
    expect(session.state).toBe("running");
    const permission = session.items.get("permission:t1") as PermissionRecordItem;
    expect(permission.outcome).toEqual({ type: "cancelled" });
    expect(permission.status).toBe("final");
  });

  test("prompt_error returns the turn to idle and commits an error marker", () => {
    let session = reduce(createSession(), { type: "prompt_sent", text: "go", at: 0 });
    session = reduce(session, { type: "prompt_error", message: "agent crashed", at: 5 });
    expect(session.state).toBe("idle");
    const markers = markersOf(session).filter((m) => m.markerKind === "error");
    expect(markers).toHaveLength(1);
    expect((markers[0] as Extract<MarkerItem, { markerKind: "error" }>).text).toBe("agent crashed");
  });

  test("agent exit while idle still commits a notice marker and marks the session disconnected", () => {
    let session = reduce(createSession(), { type: "agent_exited", exitCode: 1, at: 0 });
    expect(session.connection).toBe("disconnected");
    const markers = markersOf(session).filter((m) => m.markerKind === "notice");
    expect(markers).toHaveLength(1);
    expect((markers[0] as Extract<MarkerItem, { markerKind: "notice" }>).text).toBe("agent exited (code 1)");
  });

  test("agent exit mid-turn finalises the turn to idle first", () => {
    let session = reduce(createSession(), { type: "prompt_sent", text: "go", at: 0 });
    session = reduce(session, {
      type: "session_update",
      at: 1,
      update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "Slow", status: "in_progress" },
    });
    session = reduce(session, { type: "agent_exited", exitCode: null, at: 5 });
    expect(session.state).toBe("idle");
    expect((session.items.get("tool:t1") as ToolCallItem).status).toBe("final");
  });
});

describe("plans replace in full and commit at turn end", () => {
  test("a second plan replaces the first", () => {
    let session = reduce(createSession(), { type: "prompt_sent", text: "go", at: 0 });
    session = reduce(session, {
      type: "session_update",
      at: 1,
      update: {
        sessionUpdate: "plan",
        entries: [
          { content: "one", priority: "high", status: "pending" },
          { content: "two", priority: "medium", status: "pending" },
          { content: "three", priority: "low", status: "pending" },
        ],
      },
    });
    expect(session.plan).toHaveLength(3);

    session = reduce(session, {
      type: "session_update",
      at: 2,
      update: {
        sessionUpdate: "plan",
        entries: [
          { content: "a", priority: "high", status: "pending" },
          { content: "b", priority: "low", status: "pending" },
        ],
      },
    });
    expect(session.plan).toHaveLength(2);
    expect(session.plan.map((e) => e.content)).toEqual(["a", "b"]);
  });

  test("a plan reported during the turn is committed as an item at turn end", () => {
    let session = reduce(createSession(), { type: "prompt_sent", text: "go", at: 0 });
    session = reduce(session, {
      type: "session_update",
      at: 1,
      update: { sessionUpdate: "plan", entries: [{ content: "one", priority: "high", status: "pending" }] },
    });
    session = reduce(session, { type: "prompt_response", stopReason: "end_turn", at: 2 });
    const planItems = session.order
      .map((id) => session.items.get(id))
      .filter((item): item is PlanItem => item?.kind === "plan");
    expect(planItems).toHaveLength(1);
    expect(planItems[0]?.entries).toEqual(session.plan);
    expect(planItems[0]?.status).toBe("final");
  });

  test("no plan item is committed when no plan was reported during the turn", () => {
    let session = reduce(createSession(), { type: "prompt_sent", text: "go", at: 0 });
    session = reduce(session, { type: "prompt_response", stopReason: "end_turn", at: 2 });
    const planItems = session.order
      .map((id) => session.items.get(id))
      .filter((item): item is PlanItem => item?.kind === "plan");
    expect(planItems).toHaveLength(0);
  });
});

describe("unknown updates are ignored, not errors", () => {
  test("an update with an unrecognised sessionUpdate leaves the model unchanged", () => {
    const before = reduce(createSession(), { type: "prompt_sent", text: "go", at: 0 });
    let debugInfo: unknown = null;
    const after = reduce(
      before,
      {
        type: "session_update",
        at: 1,
        // Not a variant the v1 union defines (Claude's subagent_state_update, design 5.3).
        update: { sessionUpdate: "subagent_state_update" } as never,
      },
      (info) => {
        debugInfo = info;
      },
    );
    expect(after).toEqual(before);
    expect(debugInfo).toEqual({ kind: "unknown_session_update", sessionUpdate: "subagent_state_update" });
  });

  test("a known-but-unimplemented variant (e.g. notice) is also ignored without error", () => {
    const before = reduce(createSession(), { type: "prompt_sent", text: "go", at: 0 });
    const after = reduce(before, {
      type: "session_update",
      at: 1,
      update: { sessionUpdate: "notice", text: "hello" } as never,
    });
    expect(after).toEqual(before);
  });
});

describe("usage and session metadata are tracked", () => {
  test("usage_update sets used and size", () => {
    let session = reduce(createSession(), { type: "prompt_sent", text: "go", at: 0 });
    session = reduce(session, {
      type: "session_update",
      at: 1,
      update: { sessionUpdate: "usage_update", used: 38000, size: 200000 },
    });
    expect(session.usage).toEqual({ used: 38000, size: 200000, cost: null });
  });

  test("Cost recorded: amount and currency are held, the currency sanitised", () => {
    let session = reduce(createSession(), { type: "prompt_sent", text: "go", at: 0 });
    session = reduce(session, {
      type: "session_update",
      at: 1,
      update: { sessionUpdate: "usage_update", used: 38000, size: 200000, cost: { amount: 1.23, currency: "USD" } },
    });
    expect(session.usage).toEqual({ used: 38000, size: 200000, cost: { amount: 1.23, currency: "USD" } });

    session = reduce(session, {
      type: "session_update",
      at: 2,
      update: {
        sessionUpdate: "usage_update",
        used: 40000,
        size: 200000,
        cost: { amount: 1.5, currency: "U\x1b]52;c;ZXZpbA==\x07SD" },
      },
    });
    expect(session.usage?.cost).toEqual({ amount: 1.5, currency: "USD" });
  });

  test("Cost kept when an update omits it", () => {
    let session = reduce(createSession(), { type: "prompt_sent", text: "go", at: 0 });
    session = reduce(session, {
      type: "session_update",
      at: 1,
      update: { sessionUpdate: "usage_update", used: 38000, size: 200000, cost: { amount: 0.42, currency: "USD" } },
    });
    session = reduce(session, {
      type: "session_update",
      at: 2,
      update: { sessionUpdate: "usage_update", used: 51000, size: 200000 },
    });
    expect(session.usage).toEqual({ used: 51000, size: 200000, cost: { amount: 0.42, currency: "USD" } });
  });

  test("Cost cleared by null", () => {
    let session = reduce(createSession(), { type: "prompt_sent", text: "go", at: 0 });
    session = reduce(session, {
      type: "session_update",
      at: 1,
      update: { sessionUpdate: "usage_update", used: 38000, size: 200000, cost: { amount: 0.42, currency: "USD" } },
    });
    session = reduce(session, {
      type: "session_update",
      at: 2,
      update: { sessionUpdate: "usage_update", used: 51000, size: 200000, cost: null },
    });
    expect(session.usage).toEqual({ used: 51000, size: 200000, cost: null });
  });

  test("a later cost replaces the recorded one", () => {
    let session = reduce(createSession(), { type: "prompt_sent", text: "go", at: 0 });
    for (const [at, amount] of [[1, 0.42], [2, 0.57]] as const) {
      session = reduce(session, {
        type: "session_update",
        at,
        update: { sessionUpdate: "usage_update", used: 38000, size: 200000, cost: { amount, currency: "USD" } },
      });
    }
    expect(session.usage?.cost).toEqual({ amount: 0.57, currency: "USD" });
  });

  test("session_created records id, cwd, configOptions and modes from session/new", () => {
    const session = reduce(createSession(), {
      type: "session_created",
      at: 0,
      cwd: "/work/repo",
      response: {
        sessionId: "s1",
        configOptions: [{ id: "model", type: "select", name: "Model", options: [] } as never],
        modes: { currentModeId: "auto", availableModes: [{ id: "auto", name: "Auto" }] },
      },
    });
    expect(session.id).toBe("s1");
    expect(session.cwd).toBe("/work/repo");
    expect(session.configOptions).toHaveLength(1);
    expect(session.modes?.currentModeId).toBe("auto");
  });
});

describe("the model keeps every item", () => {
  test("5000 items remain retrievable, in order", () => {
    let session = reduce(createSession(), { type: "prompt_sent", text: "go", at: 0 });
    for (let i = 0; i < 4999; i++) {
      session = reduce(session, {
        type: "session_update",
        at: i + 1,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: `t${i}`,
          title: `Tool ${i}`,
          status: "completed",
        },
      });
    }
    // 4999 tool calls + 1 user_message from prompt_sent = 5000 items.
    expect(session.order).toHaveLength(5000);
    expect(new Set(session.order).size).toBe(5000);
    for (let i = 0; i < 4999; i++) {
      const item = session.items.get(`tool:t${i}`) as ToolCallItem;
      expect(item.index).toBe(i + 1);
    }
    // Order is preserved: the user message comes first, then the tool calls in arrival order.
    expect(session.order[0]).toBe("user:1");
    expect(session.order[1]).toBe("tool:t0");
    expect(session.order[4999]).toBe("tool:t4998");
  });
});
