#!/usr/bin/env bun
// A minimal ACP agent for the palette PTY tests (mvp-chrome-and-keys task group 6, spec
// tui-palette "Agent commands in the slash menu" "Hostile description" and "Config option
// pickers" "Agent refuses"): `session/new` reports a `model` option (`Alpha`, current, and
// `Beta`), then the agent sends an `available_commands_update` whose one command's description
// carries an OSC 52 sequence; `session/set_config_option` is always refused with the error
// `PALETTE_AGENT_REFUSAL`; a prompt is answered `done`. With `PALETTE_AGENT_LEGACY=1` (session-models
// "Legacy model refused") the agent is of Auggie's kind instead: `session/new` reports `models`
// (`Alpha` current, `Beta`) and no config options, and `session/set_model` is refused with the
// same error. Used instead of a fake-agent scenario so
// the tests need nothing from the shared scenario registry.
import { Writable } from "node:stream";
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION, RequestError, type Agent, type SessionConfigOption } from "@agentclientprotocol/sdk";

/** The OSC 52 sequence inside the command's description (it would set the clipboard to `evil`). */
export const HOSTILE_OSC52 = "\x1b]52;c;ZXZpbA==\x07";
export const HOSTILE_DESCRIPTION = `Tidy ${HOSTILE_OSC52}the workspace`;
export const PALETTE_AGENT_REFUSAL = "model locked by policy";

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

if (import.meta.main) {
  const output = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>;
  const stream = ndJsonStream(output, Bun.stdin.stream());
  new AgentSideConnection(
    (conn): Agent => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: {}, agentInfo: { name: "palette-agent", version: "1" } };
      },
      async newSession() {
        const sessionId = "palette-session-1";
        setTimeout(() => {
          void conn.sessionUpdate({
            sessionId,
            update: { sessionUpdate: "available_commands_update", availableCommands: [{ name: "tidy", description: HOSTILE_DESCRIPTION }] },
          });
        }, 50);
        if (process.env["PALETTE_AGENT_LEGACY"] === "1") {
          // `models` is the older, unstable state the SDK no longer types.
          return { sessionId, models: { currentModelId: "alpha", availableModels: [{ modelId: "alpha", name: "Alpha" }, { modelId: "beta", name: "Beta" }] } } as never;
        }
        return { sessionId, configOptions: [MODEL] };
      },
      async authenticate() {
        return {};
      },
      async setSessionConfigOption() {
        throw new RequestError(-32602, PALETTE_AGENT_REFUSAL);
      },
      async extMethod(method) {
        if (method === "session/set_model") throw new RequestError(-32602, PALETTE_AGENT_REFUSAL);
        throw RequestError.methodNotFound(method);
      },
      async prompt(params) {
        await conn.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "done" } } });
        return { stopReason: "end_turn" };
      },
      async cancel() {},
    }),
    stream,
  );
}
