// Task 3.3: tool call upserts keyed by toolCallId, per-session index assigned at first sighting,
// merge semantics, sanitisation of title/content/diff text, and the terminal-content marker.

import { describe, expect, test } from "bun:test";
import { reduce } from "../src/reducer.ts";
import { createSession } from "../src/types.ts";
import type { Session, ToolCallItem } from "../src/types.ts";

function startTurn(session: Session, at = 0): Session {
  return reduce(session, { type: "prompt_sent", text: "go", at });
}

function toolItem(session: Session, toolCallId: string): ToolCallItem {
  const item = session.items.get(`tool:${toolCallId}`);
  if (!item || item.kind !== "tool_call") throw new Error(`no tool call item for ${toolCallId}`);
  return item;
}

describe("tool call upserts", () => {
  test("a tool_call followed by a tool_call_update merges into one item, keeping position", () => {
    let session = startTurn(createSession());
    session = reduce(session, {
      type: "session_update",
      at: 1,
      update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "Run tests", status: "pending" },
    });
    const orderBefore = session.order.indexOf("tool:t1");

    session = reduce(session, {
      type: "session_update",
      at: 2,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "t1",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "ok" } }],
      },
    });

    const item = toolItem(session, "t1");
    expect(item.toolStatus).toBe("completed");
    expect(item.status).toBe("final");
    expect(item.content).toEqual([{ type: "text", text: "ok" }]);
    expect(session.order.indexOf("tool:t1")).toBe(orderBefore);
    expect(session.order.filter((id) => id === "tool:t1")).toHaveLength(1);
  });

  test("tool_call_update merges only the fields present", () => {
    let session = startTurn(createSession());
    session = reduce(session, {
      type: "session_update",
      at: 1,
      update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "Run tests", kind: "execute", status: "pending" },
    });
    session = reduce(session, {
      type: "session_update",
      at: 2,
      update: { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "in_progress" },
    });
    const item = toolItem(session, "t1");
    expect(item.title).toBe("Run tests");
    expect(item.toolKind).toBe("execute");
    expect(item.toolStatus).toBe("in_progress");
    expect(item.status).toBe("live");
  });

  test("index follows first sighting, not completion order", () => {
    let session = startTurn(createSession());
    session = reduce(session, {
      type: "session_update",
      at: 1,
      update: { sessionUpdate: "tool_call", toolCallId: "a", title: "A", status: "in_progress" },
    });
    session = reduce(session, {
      type: "session_update",
      at: 2,
      update: { sessionUpdate: "tool_call", toolCallId: "b", title: "B", status: "in_progress" },
    });
    // b completes before a
    session = reduce(session, {
      type: "session_update",
      at: 3,
      update: { sessionUpdate: "tool_call_update", toolCallId: "b", status: "completed" },
    });
    session = reduce(session, {
      type: "session_update",
      at: 4,
      update: { sessionUpdate: "tool_call_update", toolCallId: "a", status: "completed" },
    });

    expect(toolItem(session, "a").index).toBe(1);
    expect(toolItem(session, "b").index).toBe(2);
  });

  test("title, text content and diff text are sanitised", () => {
    let session = startTurn(createSession());
    session = reduce(session, {
      type: "session_update",
      at: 1,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        title: "Run \x1b[31mdanger\x1b[0m",
        status: "completed",
        content: [
          { type: "content", content: { type: "text", text: "out\x07put" } },
          {
            type: "diff",
            path: "/tmp/\x1b]8;;evil\x07f.ts",
            oldText: "old\x1b[0m",
            newText: "new\x1b[0m",
          },
        ],
      },
    });
    const item = toolItem(session, "t1");
    expect(item.title).toBe("Run danger");
    expect(item.content).toEqual([
      { type: "text", text: "output" },
      { type: "diff", path: "/tmp/f.ts", oldText: "old", newText: "new" },
    ]);
  });

  test("terminal content is recorded as a marker so the renderer can show it is unavailable", () => {
    let session = startTurn(createSession());
    session = reduce(session, {
      type: "session_update",
      at: 1,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        title: "Run",
        status: "completed",
        content: [{ type: "terminal", terminalId: "term-1" }],
      },
    });
    expect(toolItem(session, "t1").content).toEqual([{ type: "terminal_unavailable" }]);
  });

  test("a tool_call_update with no prior tool_call still creates the item (defensive first sighting)", () => {
    let session = startTurn(createSession());
    session = reduce(session, {
      type: "session_update",
      at: 1,
      update: { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "in_progress", title: "Late-announced" },
    });
    const item = toolItem(session, "t1");
    expect(item.index).toBe(1);
    expect(item.title).toBe("Late-announced");
  });

  test("turn end finalises an unfinished tool call, keeping its last status", () => {
    let session = startTurn(createSession());
    session = reduce(session, {
      type: "session_update",
      at: 1,
      update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "Slow", status: "in_progress" },
    });
    session = reduce(session, { type: "prompt_response", stopReason: "end_turn", at: 2 });
    const item = toolItem(session, "t1");
    expect(item.status).toBe("final");
    expect(item.toolStatus).toBe("in_progress");
  });
});

describe("raw tool output is recorded", () => {
  function update(session: Session, at: number, fields: Record<string, unknown>): Session {
    return reduce(session, {
      type: "session_update",
      at,
      update: { sessionUpdate: "tool_call_update", toolCallId: "t1", ...fields } as never,
    });
  }

  function started(): Session {
    return reduce(startTurn(createSession()), {
      type: "session_update",
      at: 1,
      update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "Run", kind: "execute", status: "pending" },
    });
  }

  test("a tool call starts with no raw output text", () => {
    expect(toolItem(started(), "t1").rawOutputText).toBeNull();
  });

  test("Auggie's shape: the output field of an object is recorded and the content is unchanged", () => {
    let session = update(started(), 2, { content: [{ type: "content", content: { type: "text", text: "kept" } }] });
    session = update(session, 3, { status: "completed", rawOutput: { output: "done" } });
    const item = toolItem(session, "t1");
    expect(item.rawOutputText).toBe("done");
    expect(item.content).toEqual([{ type: "text", text: "kept" }]);
  });

  test("a string rawOutput is recorded, on tool_call as well as tool_call_update", () => {
    const created = reduce(startTurn(createSession()), {
      type: "session_update",
      at: 1,
      update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "Run", rawOutput: "first" } as never,
    });
    expect(toolItem(created, "t1").rawOutputText).toBe("first");
    expect(toolItem(update(created, 2, { rawOutput: "second" }), "t1").rawOutputText).toBe("second");
  });

  test("Other shapes ignored", () => {
    for (const rawOutput of [{ exitCode: 0 }, { output: 3 }, [1, 2], 7, true, null]) {
      const item = toolItem(update(started(), 2, { rawOutput }), "t1");
      expect(item.rawOutputText).toBeNull();
    }
  });

  test("an update without rawOutput keeps the recorded text, and another shape does not clear it", () => {
    let session = update(started(), 2, { rawOutput: { output: "kept" } });
    session = update(session, 3, { status: "completed" });
    expect(toolItem(session, "t1").rawOutputText).toBe("kept");
    session = update(session, 4, { rawOutput: { exitCode: 0 } });
    expect(toolItem(session, "t1").rawOutputText).toBe("kept");
  });

  test("Hostile raw output: printable characters only, and a second pass changes nothing", () => {
    const hostile = "ok\x1b]52;c;ZXZpbA==\x07 rm \u202Eexe.dangerous\u202C \x1b[31mred\x1b[0m";
    for (const rawOutput of [hostile, { output: hostile }]) {
      const once = toolItem(update(started(), 2, { rawOutput }), "t1").rawOutputText as string;
      expect(once).not.toMatch(/[\x1b\x07\x80-\x9f]/);
      expect(once.startsWith("ok")).toBe(true);
      expect(once).toContain("red");
      expect(toolItem(update(started(), 2, { rawOutput: once }), "t1").rawOutputText).toBe(once);
    }
  });
});
