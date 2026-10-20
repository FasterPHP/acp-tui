// Task 5.3: initialize and session/new send exactly the payloads the spec
// requires, checked against fake-agent's --log; and a protocol version other
// than 1 is rejected, checked against a tiny inline fake agent (no
// fake-agent change needed for a case none of its scenarios exercise).
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSideConnection, ndJsonStream, type Agent, type Client } from "@agentclientprotocol/sdk";
import {
  createConnection,
  createNewSession,
  initializeAgent,
  ProtocolVersionMismatchError,
} from "../../src/agent/connection.ts";
import { launchAgent, type LaunchedAgent } from "../../src/agent/launch.ts";
import { RingBuffer } from "../../src/agent/ring-buffer.ts";
import { fakeAgentCommand } from "./fake-agent-command.ts";

function noopClient(): Client {
  return {
    async requestPermission() {
      throw new Error("not expected in this test");
    },
    async sessionUpdate() {
      // ignored
    },
  };
}

describe("agent/connection (task 5.3)", () => {
  test("initialize and session/new send the exact payloads the spec requires", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "acp-tui-connection-cwd-"));
    const logDir = mkdtempSync(join(tmpdir(), "acp-tui-connection-log-"));
    const logPath = join(logDir, "fake-agent.log");
    const command = fakeAgentCommand({ scenario: "basic", logPath });
    const agent = launchAgent(command);

    try {
      const conn = createConnection(agent, () => noopClient());
      await initializeAgent(conn, agent, command);
      await createNewSession(conn, agent, command, cwd);

      const lines = readFileSync(logPath, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { method: string; params: unknown });

      // toMatchObject, not toEqual: the SDK's own zod parsing on the agent side fills in a
      // clientCapabilities.auth default ({ terminal: false }) that acp-tui never sent (checked
      // against node_modules/@agentclientprotocol/sdk/dist/schema/zod.gen.js, zClientCapabilities:
      // `auth: ... .default({ terminal: false })`); what the spec actually requires is these four
      // fields, which is what this asserts.
      const initEntry = lines.find((entry) => entry.method === "initialize");
      expect(initEntry?.params).toMatchObject({
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
        clientInfo: { name: "acp-tui", version: "0.0.0" },
      });

      const newSessionEntry = lines.find((entry) => entry.method === "session/new");
      expect(newSessionEntry?.params).toEqual({ cwd, mcpServers: [] });
    } finally {
      agent.proc.kill();
    }
  });

  test("session/set_model is sent with both parameters, and a null result resolves (session-models)", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "acp-tui-connection-cwd-"));
    const logDir = mkdtempSync(join(tmpdir(), "acp-tui-connection-log-"));
    const logPath = join(logDir, "fake-agent.log");
    const command = fakeAgentCommand({ scenario: "config-options-models", logPath });
    const agent = launchAgent(command);

    try {
      const conn = createConnection(agent, () => noopClient());
      await initializeAgent(conn, agent, command);
      const session = await createNewSession(conn, agent, command, cwd);
      // The fake agent answers `null`: any result is a success and its content is not read.
      await conn.setSessionModel({ sessionId: session.sessionId, modelId: "fake-large" });

      const entry = readFileSync(logPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { method: string; params: unknown })
        .find((logged) => logged.method === "session/set_model");
      expect(entry?.params).toEqual({ sessionId: session.sessionId, modelId: "fake-large" });

      // An error from the agent rejects with it.
      await expect(conn.setSessionModel({ sessionId: session.sessionId, modelId: "nope" })).rejects.toMatchObject({ code: -32602 });
    } finally {
      agent.proc.kill();
    }
  });

  test("a protocol version other than 1 is rejected, naming both versions", async () => {
    // A tiny inline fake agent, over an in-memory duplex pair, standing in for a real process:
    // none of fake-agent's scenarios need a non-1 protocolVersion, so this avoids changing that
    // package for a single edge case (per the task's "test by a tiny inline fake" option).
    const toAgent = new TransformStream<Uint8Array, Uint8Array>();
    const toClient = new TransformStream<Uint8Array, Uint8Array>();

    const wrongVersionAgent: Agent = {
      async initialize() {
        return { protocolVersion: 2 };
      },
      async newSession() {
        throw new Error("not expected in this test");
      },
      async prompt() {
        throw new Error("not expected in this test");
      },
      async cancel() {
        // not expected
      },
      async authenticate() {
        throw new Error("not expected in this test");
      },
    };

    const agentSideConnection = new AgentSideConnection(
      () => wrongVersionAgent,
      ndJsonStream(toClient.writable, toAgent.readable),
    );
    agentSideConnection.closed.catch(() => {
      // closing at test teardown is expected
    });

    const fakeAgent: LaunchedAgent = {
      proc: { exitCode: null, kill() {} } as unknown as LaunchedAgent["proc"],
      stdin: toAgent.writable,
      stdout: toClient.readable,
      stderr: new RingBuffer(),
      exited: new Promise<number | null>(() => {
        // never resolves: this fake process never exits during the test
      }),
    };

    const conn = createConnection(fakeAgent, () => noopClient());
    try {
      await initializeAgent(conn, fakeAgent, ["fake"]);
      throw new Error("expected initializeAgent to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(ProtocolVersionMismatchError);
      expect((error as Error).message).toMatch(/requested protocol version 1.*version 2/s);
    }
  });
});
