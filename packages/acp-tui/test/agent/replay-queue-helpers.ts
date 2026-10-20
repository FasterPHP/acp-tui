// Shared by replay-queue.test.ts and replay-queue.timing.test.ts (split by the change parallel-tests, tasks 3.x). Not a test file.
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { createSession, reduce, type ModelEvent, type Session } from "acp-model";
import { generateLongSessionItems, LONG_SESSION_PLAN_EVERY, longSessionPlan } from "fake-agent";
import { createClientHandler } from "../../src/agent/client-handler.ts";
import { type SessionSource } from "../../src/session/store.ts";

/** The updates `long-session` sends for `count` items (its `emitHistory`, as data). */
export function longSessionUpdates(count: number): SessionUpdate[] {
  const updates: SessionUpdate[] = [];
  let index = 0;
  for (const item of generateLongSessionItems(count)) {
    if (item.kind === "user") updates.push({ sessionUpdate: "user_message_chunk", messageId: `long-user-${index}`, content: { type: "text", text: item.text } });
    else if (item.kind === "answer") updates.push({ sessionUpdate: "agent_message_chunk", messageId: `long-msg-${index}`, content: { type: "text", text: item.text } });
    else if (item.kind === "thought") updates.push({ sessionUpdate: "agent_thought_chunk", messageId: `long-thought-${index}`, content: { type: "text", text: item.text } });
    else {
      const toolCallId = `long-tool-${index}`;
      updates.push({ sessionUpdate: "tool_call", toolCallId, title: item.title, kind: item.toolKind, status: "in_progress" });
      updates.push({
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: item.failed ? "failed" : "completed",
        content: item.diff
          ? [{ type: "diff", path: `/work/${item.path}`, oldText: item.diff.oldText, newText: item.diff.newText }]
          : [{ type: "content", content: { type: "text", text: item.output ?? "" } }],
      });
    }
    index += 1;
    if (index % LONG_SESSION_PLAN_EVERY === 0) updates.push({ sessionUpdate: "plan", entries: longSessionPlan(index / LONG_SESSION_PLAN_EVERY) });
  }
  return updates;
}

/** A controller's dispatch, apply and notify around one session, as `connectAgent` wires them. */
export function harness() {
  let session = createSession();
  const listeners = new Set<(s: Session) => void>();
  const apply = (event: ModelEvent): void => {
    session = reduce(session, event);
  };
  const notify = (): void => {
    for (const listener of listeners) listener(session);
  };
  const dispatch = (event: ModelEvent): void => {
    apply(event);
    notify();
  };
  const source: SessionSource = {
    getSession: () => session,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const handler = createClientHandler({ dispatch, apply, flush: notify, now: () => 0 });
  return { handler, source, dispatch, current: () => session };
}
