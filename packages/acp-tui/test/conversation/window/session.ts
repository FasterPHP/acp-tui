// Spike S3 test helpers. The long-session scenario's content
// (fake-agent's generator, the same seeded items the PTY scenario sends) as
// acp-model events, for in-process tests of the windowed list.
import { join } from "node:path";
import type { ModelEvent } from "acp-model";

type LongSessionItem =
  | { kind: "user" | "answer" | "thought"; text: string }
  | { kind: "tool"; toolKind: string; title: string; path: string; failed: boolean; output: string | null; diff: { oldText: string; newText: string } | null };

const { generateLongSessionItems } = (await import(join(import.meta.dir, "../../../../fake-agent/src/long-session-items.ts"))) as {
  generateLongSessionItems: (n: number, options?: { fenced?: boolean }) => Iterable<LongSessionItem>;
};

/** `session_created`, a prompt, the scenario's first `n` items as updates, then the turn end.
 *  `fenced: false` gives `long-session-plain`'s items (tool output unfenced). */
export function longSessionEvents(n: number, options: { fenced?: boolean } = {}): ModelEvent[] {
  let at = 0;
  const events: ModelEvent[] = [
    { type: "session_created", at: at++, cwd: "/w", agentInfo: { name: "fake-agent", version: "1" }, response: { sessionId: "s" } },
    { type: "prompt_sent", text: "scalebench-first-item", at: at++ },
  ];
  const update = (u: object) => events.push({ type: "session_update", at: at++, update: u } as ModelEvent);
  let i = 0;
  for (const item of generateLongSessionItems(n, options)) {
    switch (item.kind) {
      case "user":
        update({ sessionUpdate: "user_message_chunk", messageId: `long-user-${i}`, content: { type: "text", text: item.text } });
        break;
      case "answer":
        update({ sessionUpdate: "agent_message_chunk", messageId: `long-msg-${i}`, content: { type: "text", text: item.text } });
        break;
      case "thought":
        update({ sessionUpdate: "agent_thought_chunk", messageId: `long-thought-${i}`, content: { type: "text", text: item.text } });
        break;
      case "tool": {
        const toolCallId = `long-tool-${i}`;
        update({ sessionUpdate: "tool_call", toolCallId, title: item.title, kind: item.toolKind, status: "in_progress" });
        const content = item.diff
          ? [{ type: "diff", path: `/work/${item.path}`, oldText: item.diff.oldText, newText: item.diff.newText }]
          : [{ type: "content", content: { type: "text", text: item.output ?? "" } }];
        update({ sessionUpdate: "tool_call_update", toolCallId, status: item.failed ? "failed" : "completed", content });
        break;
      }
    }
    i++;
  }
  events.push({ type: "prompt_response", stopReason: "end_turn", at: at++ });
  return events;
}
