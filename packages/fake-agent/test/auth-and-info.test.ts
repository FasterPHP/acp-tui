// colleague-preview: `--auth-required` makes session/new (or session/prompt) answer -32000, and
// `--agent-info` sets the agentInfo that initialize reports.
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { recordingClient, spawnFakeAgent } from "./helpers.ts";

async function newSessionError(args: readonly string[]): Promise<{ code: number; message: string }> {
  const { client } = recordingClient();
  const handle = spawnFakeAgent({ scenario: "basic", args, client });
  try {
    await handle.conn.initialize({ protocolVersion: 1 });
    try {
      await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
    } catch (error) {
      const e = error as { code: number; message: string };
      return { code: e.code, message: e.message };
    }
    throw new Error("session/new did not fail");
  } finally {
    handle.stop();
  }
}

describe("fake-agent --auth-required", () => {
  test("answers session/new with -32000 and Auggie 0.36.0's text", async () => {
    const error = await newSessionError(["--auth-required"]);
    expect(error.code).toBe(-32000);
    expect(error.message).toBe(
      "Authentication required: Auggie does not currently support authenticating over ACP. Please run `auggie login` from your terminal then try again.",
    );
  });

  test("=bare answers Authentication required alone", async () => {
    const error = await newSessionError(["--auth-required=bare"]);
    expect(error.code).toBe(-32000);
    expect(error.message).toBe("Authentication required");
  });

  test("=prompt lets session/new succeed and fails the prompt", async () => {
    const { client } = recordingClient();
    const handle = spawnFakeAgent({ scenario: "basic", args: ["--auth-required=prompt"], client });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      const failure = await handle.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "hi" }] }).then(
        () => null,
        (error: unknown) => error as { code: number },
      );
      expect(failure?.code).toBe(-32000);
    } finally {
      handle.stop();
    }
  });
});

describe("fake-agent --agent-info", () => {
  test("initialize reports the name, a title equal to it, and the version", async () => {
    const { client } = recordingClient();
    const handle = spawnFakeAgent({ scenario: "basic", args: ["--agent-info", "auggie@1.2.0"], client });
    try {
      const response = await handle.conn.initialize({ protocolVersion: 1 });
      expect(response.agentInfo).toEqual({ name: "auggie", title: "auggie", version: "1.2.0" });
    } finally {
      handle.stop();
    }
  });

  test("without it the identity is fake-agent 0.0.0", async () => {
    const { client } = recordingClient();
    const handle = spawnFakeAgent({ scenario: "basic", client });
    try {
      const response = await handle.conn.initialize({ protocolVersion: 1 });
      expect(response.agentInfo).toEqual({ name: "fake-agent", version: "0.0.0" });
    } finally {
      handle.stop();
    }
  });
});
