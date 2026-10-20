#!/usr/bin/env bun
// A minimal ACP agent for the emoji PTY test (mvp-rendering task 14.5, review C11): every prompt
// is answered with a thought, a finished `read` call whose text output holds emoji in prose and in
// a fence, and one agent message (`EMOJI_MESSAGE`), then `end_turn`. Each sample is one of the
// classes of src/render/emoji/emoji.ts.
import { Writable } from "node:stream";
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION, type Agent } from "@agentclientprotocol/sdk";

/** One sample per class: ZWJ, flag, keycap, tone, VS16, bare, and a plain emoji. */
export const EMOJI = {
  family: "\u{1F468}‍\u{1F469}‍\u{1F467}",
  flag: "\u{1F1EC}\u{1F1E7}",
  keycap: "1️⃣",
  tone: "\u{1F44D}\u{1F3FD}",
  heart: "❤️",
  bare: "❤",
  grin: "\u{1F600}",
} as const;

export const EMOJI_MESSAGE = `Family ${EMOJI.family} here.\n\nFlag ${EMOJI.flag} keycap ${EMOJI.keycap} tone ${EMOJI.tone} heart ${EMOJI.heart} bare ${EMOJI.bare} grin ${EMOJI.grin} end.\n`;
export const EMOJI_THOUGHT = `Thinking about ${EMOJI.family} and ${EMOJI.keycap}.`;
export const EMOJI_TOOL_TEXT = `Checked ${EMOJI.tone} files:\n\n\`\`\`\nok ${EMOJI.heart} ${EMOJI.family}\n\`\`\`\n`;
export const EMOJI_TOOL_TITLE = `Read notes ${EMOJI.flag}.md`;

if (import.meta.main) {
  const output = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>;
  const stream = ndJsonStream(output, Bun.stdin.stream());
  new AgentSideConnection(
    (conn): Agent => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: {}, agentInfo: { name: "emoji-agent", version: "1" } };
      },
      async newSession() {
        return { sessionId: "emoji-session-1" };
      },
      async authenticate() {
        return {};
      },
      async prompt(params) {
        const sessionId = params.sessionId;
        await conn.sessionUpdate({ sessionId, update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: EMOJI_THOUGHT } } });
        await conn.sessionUpdate({ sessionId, update: { sessionUpdate: "tool_call", toolCallId: "emoji-read", title: EMOJI_TOOL_TITLE, kind: "read", status: "in_progress" } });
        await conn.sessionUpdate({
          sessionId,
          update: { sessionUpdate: "tool_call_update", toolCallId: "emoji-read", status: "completed", content: [{ type: "content", content: { type: "text", text: EMOJI_TOOL_TEXT } }] },
        });
        await conn.sessionUpdate({ sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: EMOJI_MESSAGE } } });
        return { stopReason: "end_turn" };
      },
      async cancel() {},
    }),
    stream,
  );
}
