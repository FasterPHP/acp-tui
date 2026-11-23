// A running call's output that is not an extension of what came before is a moving window
// (`outputWindow`), kept for the rest of the call and after it.
import { describe, expect, test } from "bun:test";
import { reduce } from "../src/reducer.ts";
import { createSession } from "../src/types.ts";
import type { Session, ToolCallItem } from "../src/types.ts";

const numbered = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `line ${from + i}`).join("\n");

function start(): Session {
  let session = reduce(createSession(), { type: "prompt_sent", text: "go", at: 0 });
  return reduce(session, { type: "session_update", at: 1, update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "run", kind: "execute", status: "in_progress" } });
}

function update(session: Session, text: string, status: "in_progress" | "completed" = "in_progress"): Session {
  return reduce(session, {
    type: "session_update",
    at: 2,
    update: { sessionUpdate: "tool_call_update", toolCallId: "t1", status, content: [{ type: "content", content: { type: "text", text } }] },
  });
}

const item = (session: Session) => session.items.get("tool:t1") as ToolCallItem;

describe("moving output window", () => {
  test("output that only grows is not a window", () => {
    let session = update(start(), numbered(1, 10));
    session = update(session, numbered(1, 500));
    session = update(session, numbered(1, 500) + "\n", "completed");
    expect(item(session).outputWindow).toBeUndefined();
  });

  test("a changed first line marks a window, kept after later updates and completion", () => {
    let session = update(start(), numbered(1, 340));
    session = update(session, numbered(1, 347));
    expect(item(session).outputWindow).toBeUndefined();
    session = update(session, numbered(48, 347));
    expect(item(session).outputWindow).toBe(true);
    session = update(session, numbered(48, 400));
    session = update(session, numbered(100, 400), "completed");
    expect(item(session).outputWindow).toBe(true);
  });

  test("fewer lines with the same first line mark a window", () => {
    let session = update(start(), numbered(1, 30));
    session = update(session, numbered(1, 20));
    expect(item(session).outputWindow).toBe(true);
  });

  test("the update that completes a call restating its output does not mark a window", () => {
    let session = update(start(), numbered(1, 30));
    session = update(session, "Exit code 0\n" + numbered(1, 30), "completed");
    expect(item(session).outputWindow).toBeUndefined();
  });
});
