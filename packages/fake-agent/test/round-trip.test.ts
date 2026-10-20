// Task 4.1: proves the SDK runs on Bun from both sides at once -- fake-agent
// as a real child process on AgentSideConnection, driven here by
// ClientSideConnection, exactly as acp-tui will drive it.
import { describe, expect, test } from "bun:test";
import { spawnFakeAgent } from "./helpers.ts";

describe("fake-agent round trip (task 4.1)", () => {
  test("initialize and session/new succeed over real stdio", async () => {
    const handle = spawnFakeAgent({
      scenario: "basic",
      client: {
        async sessionUpdate() {},
        async requestPermission() {
          throw new Error("not expected in this test");
        },
      },
    });

    try {
      const initResult = await handle.conn.initialize({ protocolVersion: 1 });
      expect(initResult.protocolVersion).toBe(1);
      expect(initResult.agentInfo?.name).toBe("fake-agent");

      const sessionResult = await handle.conn.newSession({ cwd: "/tmp", mcpServers: [] });
      expect(sessionResult.sessionId).toBeTruthy();
    } finally {
      handle.stop();
    }
  });
});
