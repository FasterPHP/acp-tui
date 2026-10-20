// Task 4.1: --log writes one JSON line per received method, with session/prompt's
// params stripped of the actual prompt text. acp-tui's later tests rely on this
// log to assert that detach sends neither session/cancel nor session/close.
import { describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { spawnFakeAgent } from "./helpers.ts";

describe("fake-agent --log (task 4.1)", () => {
  test("logs every received method, minus prompt text", async () => {
    const logPath = `${process.env["TMPDIR"] ?? "/tmp"}/fake-agent-log-${Date.now()}.jsonl`;

    const handle = spawnFakeAgent({
      scenario: "basic",
      logPath,
      client: {
        async sessionUpdate() {},
        async requestPermission(params) {
          void handle.conn.cancel({ sessionId: params.sessionId });
          return { outcome: { outcome: "cancelled" } };
        },
      },
    });

    const secretPromptText = "do not leak this exact string into the log";
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: "/tmp", mcpServers: [] });
      await handle.conn.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: secretPromptText }],
      });
    } finally {
      handle.stop();
    }

    // Give the (synchronous) log writes a moment to land on disk after the
    // last notification; appendFileSync itself is synchronous, but the
    // process teardown above is not.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const lines = readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    rmSync(logPath, { force: true });

    const methods = lines.map((entry) => entry.method);
    expect(methods).toContain("initialize");
    expect(methods).toContain("session/new");
    expect(methods).toContain("session/prompt");
    expect(methods).toContain("session/cancel");

    const promptEntry = lines.find((entry) => entry.method === "session/prompt");
    const serializedPromptEntry = JSON.stringify(promptEntry);
    expect(serializedPromptEntry).not.toContain(secretPromptText);
    expect(promptEntry.params.promptBlockCount).toBe(1);
  });
});
