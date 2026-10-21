// harness-feedback task group 3 (spec tui-agent-session "Start-up timeout"): the silence timer
// against fake-agent's `--session-delay`, `--session-heartbeat` and `--session-permission`. Whether
// a start fails depends on the gaps between the harness's messages against the timeout, so these
// belong in the serial pass.
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection, createNewSession, initializeAgent, AgentStartupTimeoutError, type AcpClient } from "../../src/agent/connection.ts";
import { launchAgent } from "../../src/agent/launch.ts";
import { fakeAgentCommand, rejectionOf } from "./fake-agent-command.ts";

const cwd = () => mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-startup-"));

function client(permission?: () => Promise<void>): AcpClient {
  return {
    async requestPermission() {
      await permission?.();
      return { outcome: { outcome: "selected", optionId: "allow" } };
    },
    async sessionUpdate() {},
  };
}

async function start(extra: readonly string[], timeoutSeconds: number, toClient: () => AcpClient) {
  const command = [...fakeAgentCommand({ scenario: "basic" }), ...extra];
  const agent = launchAgent(command, { harness: "fake" });
  const conn = createConnection(agent, toClient, undefined, undefined, { command, timeoutSeconds });
  await initializeAgent(conn, agent, command);
  return { agent, conn, command };
}

describe("silence, not a total", () => {
  test("a session that is silent for longer than the timeout is stopped", async () => {
    const { agent, conn, command } = await start(["--session-delay", "3000"], 0.6, () => client());
    try {
      const error = await rejectionOf(createNewSession(conn, agent, command, cwd()));
      expect(error).toBeInstanceOf(AgentStartupTimeoutError);
      expect((error as Error).message).toContain("did not answer session/new");
      await agent.exited;
    } finally {
      agent.proc.kill();
    }
  });

  test("Slow session, not silent: a message every 150 ms for 1.5 s before the answer, with a timeout of 0.6 s, starts the session", async () => {
    const { agent, conn, command } = await start(["--session-delay", "1500", "--session-heartbeat", "150"], 0.6, () => client());
    try {
      const started = Date.now();
      expect((await createNewSession(conn, agent, command, cwd())).sessionId).toBeTruthy();
      expect(Date.now() - started).toBeGreaterThanOrEqual(1400);
    } finally {
      agent.proc.kill();
    }
  });

  test("Waiting for the user: a permission request answered after longer than the timeout does not fail the start", async () => {
    const { agent, conn, command } = await start(["--session-permission"], 0.5, () => client(() => Bun.sleep(1500)));
    try {
      expect((await createNewSession(conn, agent, command, cwd())).sessionId).toBeTruthy();
    } finally {
      agent.proc.kill();
    }
  });

  test("the wait starts again when the card is answered: silence after it still fails", async () => {
    const { agent, conn, command } = await start(["--session-permission", "--session-delay", "3000"], 0.6, () => client(() => Bun.sleep(1000)));
    try {
      const started = Date.now();
      const error = await rejectionOf(createNewSession(conn, agent, command, cwd()));
      expect(error).toBeInstanceOf(AgentStartupTimeoutError);
      // The card held the timer for its second, and the timeout ran after it.
      expect(Date.now() - started).toBeGreaterThanOrEqual(1500);
    } finally {
      agent.proc.kill();
    }
  });
});
