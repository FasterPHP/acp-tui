#!/usr/bin/env bun
// A minimal ACP agent for the slash command completion PTY tests (spec tui-palette "Completing a
// slash command" and "Slash prompts sent without trailing white space"): fake-agent's log keeps
// only a prompt's block count, so a test that must see the exact text sent (a trailing space, an
// argument after a completed command) needs an agent that records it. `session/new` reports a
// `model` and a `mode` option; the agent then advertises `compact`, `openspec-apply-change`, `diagnose-crash`, `Bootstrap`, `heapdump` and `claude-api` with no
// `input`, and `review` with the hint `PR number`, in an order that is not alphabetical, and no `exit`. Every prompt's text is appended as one
// JSON string per line to the file named by `SLASH_AGENT_PROMPTS`; a prompt whose text is `wait`
// stays running until it is cancelled (a turn in progress); any other is answered `done`.
import { appendFileSync } from "node:fs";
import { Writable } from "node:stream";
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION, type Agent, type SessionConfigOption } from "@agentclientprotocol/sdk";

const MODEL: SessionConfigOption = {
  type: "select",
  id: "model",
  name: "Model",
  category: "model",
  currentValue: "alpha",
  options: [
    { value: "alpha", name: "Alpha" },
    { value: "beta", name: "Beta" },
  ],
};

const MODE: SessionConfigOption = {
  type: "select",
  id: "mode",
  name: "Mode",
  category: "mode",
  currentValue: "ask",
  options: [
    { value: "ask", name: "Ask" },
    { value: "plan", name: "Plan" },
  ],
};

if (import.meta.main) {
  const output = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>;
  const stream = ndJsonStream(output, Bun.stdin.stream());
  const waiting = new Map<string, () => void>();
  new AgentSideConnection(
    (conn): Agent => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: {}, agentInfo: { name: "slash-agent", version: "1" } };
      },
      async newSession() {
        const sessionId = "slash-session-1";
        setTimeout(() => {
          void conn.sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: "available_commands_update",
              // Not in alphabetical order, so a test sees the menu put them in order; `diagnose-crash`
              // names "application" in its description and `compact` names "model" in its.
              availableCommands: [
                { name: "review", description: "Review a pull request", input: { hint: "PR number" } },
                { name: "openspec-apply-change", description: "Implement tasks from a change" },
                { name: "diagnose-crash", description: "Diagnose a crash in the application" },
                { name: "compact", description: "Compact the conversation and its model context" },
                { name: "Bootstrap", description: "Set up the project" },
                { name: "heapdump", description: "Write a heap snapshot to a file" },
                { name: "claude-api", description: "Build with the Anthropic interface" },
              ],
            },
          });
        }, 50);
        return { sessionId, configOptions: [MODEL, MODE] };
      },
      async authenticate() {
        return {};
      },
      async prompt(params) {
        const text = params.prompt.map((block) => (block.type === "text" ? block.text : `<${block.type}>`)).join("");
        const file = process.env["SLASH_AGENT_PROMPTS"];
        if (file) appendFileSync(file, `${JSON.stringify(text)}\n`);
        if (text === "wait") {
          await new Promise<void>((resolve) => waiting.set(params.sessionId, resolve));
          return { stopReason: "cancelled" };
        }
        await conn.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "done" } } });
        return { stopReason: "end_turn" };
      },
      async cancel(params) {
        waiting.get(params.sessionId)?.();
        waiting.delete(params.sessionId);
      },
    }),
    stream,
  );
}
