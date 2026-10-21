// harness-feedback task 1.2: --no-initialize never answers `initialize`, and the process keeps reading.
// A wait with an upper bound, so it runs in the serial pass (parallel-tests).
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { recordingClient, spawnFakeAgent } from "./helpers.ts";

describe("fake-agent --no-initialize", () => {
  test("initialize gets no answer within 2 s while the process stays alive and keeps reading", async () => {
    const { client } = recordingClient();
    const handle = spawnFakeAgent({ scenario: "basic", args: ["--no-initialize"], client });
    try {
      const outcome = await Promise.race([
        handle.conn.initialize({ protocolVersion: 1 }).then(() => "answered"),
        new Promise<string>((resolve) => setTimeout(() => resolve("silent"), 2000)),
      ]);
      expect(outcome).toBe("silent");
      expect(handle.proc.killed).toBe(false);
      expect(handle.proc.exitCode).toBeNull();
      // Still reading: another request is answered (here a session, which needs no initialize).
      const session = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      expect(session.sessionId).toMatch(/^fake-session-/);
    } finally {
      handle.stop();
    }
  });
});
