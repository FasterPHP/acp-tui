// Task 3.2: message and thought upserts keyed by messageId, synthesised ids per contiguous run
// when absent, sanitising on entry. Covers both scenarios in spec model-session's "Items are
// upserts keyed by stable identifiers" requirement plus the hostile-chunk scenario.

import { describe, expect, test } from "bun:test";
import { reduce } from "../src/reducer.ts";
import { createSession } from "../src/types.ts";
import type { AgentMessageItem, Session, ThoughtItem, UserMessageItem } from "../src/types.ts";

function startTurn(session: Session, at = 0): Session {
  return reduce(session, { type: "prompt_sent", text: "go", at });
}

describe("message and thought upserts", () => {
  test("chunks with a messageId accumulate into one item, in arrival order", () => {
    let session = startTurn(createSession());
    for (const text of ["Hello", ", ", "world"]) {
      session = reduce(session, {
        type: "session_update",
        at: 1,
        update: { sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text } },
      });
    }

    const messageItems = session.order
      .map((id) => session.items.get(id))
      .filter((item): item is AgentMessageItem => item?.kind === "agent_message");

    expect(messageItems).toHaveLength(1);
    expect(messageItems[0]?.text).toBe("Hello, world");
    expect(messageItems[0]?.status).toBe("live");
  });

  test("chunks without a messageId are grouped by contiguous run", () => {
    let session = startTurn(createSession());
    const send = (s: Session, sessionUpdate: "agent_message_chunk" | "agent_thought_chunk", text: string) =>
      reduce(s, { type: "session_update", at: 1, update: { sessionUpdate, content: { type: "text", text } } });

    session = send(session, "agent_message_chunk", "first message, ");
    session = send(session, "agent_message_chunk", "still first message");
    session = send(session, "agent_thought_chunk", "a thought");
    session = send(session, "agent_message_chunk", "second message");

    const items = session.order.map((id) => session.items.get(id));
    const kinds = items.map((item) => item?.kind);
    expect(kinds).toEqual(["user_message", "agent_message", "thought", "agent_message"]);

    const [, msg1, thought, msg2] = items;
    expect((msg1 as AgentMessageItem).text).toBe("first message, still first message");
    expect((msg1 as AgentMessageItem).status).toBe("final"); // finalised when the thought began
    expect((thought as ThoughtItem).text).toBe("a thought");
    expect((thought as ThoughtItem).status).toBe("final"); // finalised when the second message began
    expect((msg2 as AgentMessageItem).text).toBe("second message");
    expect((msg2 as AgentMessageItem).status).toBe("live"); // still the live item
    // The two agent_message items are distinct despite sharing a kind (contiguity broke).
    expect(msg1).not.toBe(msg2);
    expect((msg1 as AgentMessageItem).id).not.toBe((msg2 as AgentMessageItem).id);
  });

  test("prompt_sent records the user's own message as a final item", () => {
    const session = startTurn(createSession());
    const userItems = session.order
      .map((id) => session.items.get(id))
      .filter((item): item is UserMessageItem => item?.kind === "user_message");
    expect(userItems).toHaveLength(1);
    expect(userItems[0]?.text).toBe("go");
    expect(userItems[0]?.status).toBe("final");
    expect(userItems[0]?.origin).toBe("self");
  });

  test("hostile chunk: an OSC 52 clipboard sequence is stripped, surrounding text survives", () => {
    let session = startTurn(createSession());
    session = reduce(session, {
      type: "session_update",
      at: 1,
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "m1",
        content: { type: "text", text: "before\x1b]52;c;ZXZpbA==\x07after" },
      },
    });
    const item = session.items.get("agent_message:m1") as AgentMessageItem;
    expect(item.text).toBe("beforeafter");
  });

  test("a non-text content block is represented as a sanitised placeholder", () => {
    let session = startTurn(createSession());
    session = reduce(session, {
      type: "session_update",
      at: 1,
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "m1",
        content: { type: "image", data: "", mimeType: "image/png" },
      },
    });
    const item = session.items.get("agent_message:m1") as AgentMessageItem;
    expect(item.text).toBe("[image: image/png]");
  });

  test("origin is 'other' for updates arriving while idle (no active turn)", () => {
    const session = reduce(createSession(), {
      type: "session_update",
      at: 1,
      update: { sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: "hi" } },
    });
    const item = session.items.get("agent_message:m1") as AgentMessageItem;
    expect(item.origin).toBe("other");
  });
});

describe("a tool call or permission request is a different item beginning", () => {
  const chunk = (text: string) =>
    ({ type: "session_update", at: 1, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } }) as const;

  test("a new tool call finalises the live message and ends its run", () => {
    let session = startTurn(createSession());
    session = reduce(session, chunk("before"));
    const first = session.order.at(-1)!;
    session = reduce(session, {
      type: "session_update",
      at: 2,
      update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "Read", status: "in_progress" },
    });
    expect(session.items.get(first)?.status).toBe("final");

    session = reduce(session, chunk("after"));
    const messages = session.order.map((id) => session.items.get(id)).filter((i) => i?.kind === "agent_message");
    expect(messages.map((m) => (m as AgentMessageItem).text)).toEqual(["before", "after"]);
    expect(messages.map((m) => m!.status)).toEqual(["final", "live"]);
  });

  test("an update to an existing tool call does not finalise the live message", () => {
    let session = startTurn(createSession());
    session = reduce(session, {
      type: "session_update",
      at: 1,
      update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "Read", status: "in_progress" },
    });
    session = reduce(session, chunk("streaming"));
    const message = session.order.at(-1)!;
    session = reduce(session, {
      type: "session_update",
      at: 2,
      update: { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" },
    });
    expect(session.items.get(message)?.status).toBe("live");
  });

  test("a permission request finalises the live thought", () => {
    let session = startTurn(createSession());
    session = reduce(session, {
      type: "session_update",
      at: 1,
      update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hmm" } },
    });
    const thought = session.order.at(-1)!;
    session = reduce(session, {
      type: "session_update",
      at: 1,
      update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "Edit", status: "pending" },
    });
    // Already finalised by the tool call; the permission record must not reopen it either.
    session = reduce(session, {
      type: "permission_opened",
      toolCallId: "t1",
      at: 2,
      request: { sessionId: "s", toolCall: { toolCallId: "t1" }, options: [{ optionId: "a", name: "Allow", kind: "allow_once" }] },
    });
    expect((session.items.get(thought) as ThoughtItem).status).toBe("final");
  });
});
