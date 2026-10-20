#!/usr/bin/env bun
// A minimal ACP agent for the terminal title and attention PTY tests (mvp-chrome-and-keys group 7):
// every prompt first reports the session title from `TITLE_AGENT_TITLE` (when set) through
// `session_info_update`, then, when the prompt text contains "ask", raises a permission request and
// waits for the answer, then ends the turn. `TITLE_AGENT_HOLD_MS` keeps a turn running that long
// before it ends (default 0). Used instead of a fake-agent scenario so the tests need nothing from
// the shared scenario registry.
import { Writable } from "node:stream";
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION, type Agent } from "@agentclientprotocol/sdk";

if (import.meta.main) {
  const output = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>;
  const stream = ndJsonStream(output, Bun.stdin.stream());
  new AgentSideConnection(
    (conn): Agent => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: {}, agentInfo: { name: "title-agent", version: "1" } };
      },
      async newSession() {
        return { sessionId: "title-session-1" };
      },
      async authenticate() {
        return {};
      },
      async prompt(params) {
        const title = process.env["TITLE_AGENT_TITLE"];
        if (title !== undefined) {
          await conn.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: "session_info_update", title } });
        }
        const text = params.prompt.map((block) => (block.type === "text" ? block.text : "")).join(" ");
        if (text.includes("ask")) {
          await conn.requestPermission({
            sessionId: params.sessionId,
            toolCall: { toolCallId: "t1", title: "Edit a file", kind: "edit", status: "pending" },
            options: [
              { optionId: "allow", name: "Allow once", kind: "allow_once" },
              { optionId: "reject", name: "Reject once", kind: "reject_once" },
            ],
          });
        }
        await Bun.sleep(Number(process.env["TITLE_AGENT_HOLD_MS"] ?? "0"));
        await conn.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "done" } } });
        return { stopReason: "end_turn" };
      },
      async cancel() {},
    }),
    stream,
  );
}
