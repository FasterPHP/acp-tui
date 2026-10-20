#!/usr/bin/env bun
// A minimal ACP agent for the Markdown colour test (S1 bug 4 of phase-1a, spec tui-theme):
// every prompt is answered with MARKDOWN_CHUNKS, one agent message streamed in the chunks below,
// then `end_turn`. The message starts with a list, the case in which OpenTUI 0.5.12 drew the list
// in explicit white when `content` was set before the style (conversation/items.tsx), and covers
// headings, emphasis, inline code, a fenced block, a link, a quote and an ordered, nested list.
import { Writable } from "node:stream";
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION, type Agent } from "@agentclientprotocol/sdk";

export const MARKDOWN_CHUNKS = [
  "- first item\n- second item with **bold** and *italic*\n- third item with `code`\n\n",
  "# Heading one\n\nA paragraph with a [link](https://example.com/docs) and `inline code`.\n\n",
  "## Heading two\n\n> A quoted line with *emphasis*.\n\n",
  "1. ordered one\n2. ordered two\n   - nested item\n\n",
  "```ts\nconst answer = 42;\n```\n\n",
  "Closing ~~struck~~ paragraph.\n",
] as const;

if (import.meta.main) {
  const output = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>;
  const stream = ndJsonStream(output, Bun.stdin.stream());
  new AgentSideConnection(
    (conn): Agent => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: {}, agentInfo: { name: "markdown-agent", version: "1" } };
      },
      async newSession() {
        return { sessionId: "markdown-session-1" };
      },
      async authenticate() {
        return {};
      },
      async prompt(params) {
        for (const text of MARKDOWN_CHUNKS) {
          await conn.sessionUpdate({
            sessionId: params.sessionId,
            update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
          });
          await Bun.sleep(20);
        }
        return { stopReason: "end_turn" };
      },
      async cancel() {},
    }),
    stream,
  );
}
