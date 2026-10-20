// Phase-1a task 1.6: config-options offers mode, model and thought_level, and
// session/set_config_option returns the full rebuilt list.
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { rejectionOf, spawnFakeAgent } from "./helpers.ts";

function byId(options: readonly SessionConfigOption[]): Record<string, SessionConfigOption> {
  return Object.fromEntries(options.map((option) => [option.id, option]));
}

function valueCount(option: SessionConfigOption | undefined): number {
  return option?.type === "select" ? option.options.length : -1;
}

function current(option: SessionConfigOption | undefined): unknown {
  return option?.currentValue;
}

describe("fake-agent config-options scenario (phase-1a task 1.6)", () => {
  test("session/new lists mode (4), model (20) and thought_level (4)", async () => {
    const handle = spawnFakeAgent({
      scenario: "config-options",
      client: { async sessionUpdate() {}, async requestPermission() { throw new Error("no permission"); } },
    });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      const options = session.configOptions ?? [];
      expect(options.map((o) => o.id)).toEqual(["mode", "model", "thought_level"]);
      expect(options.map(valueCount)).toEqual([4, 20, 4]);
      expect(options.map((o) => o.category)).toEqual(["mode", "model", "thought_level"]);
    } finally {
      handle.stop();
    }
  });

  test("setting model returns all three options with the new current value", async () => {
    const handle = spawnFakeAgent({
      scenario: "config-options",
      client: { async sessionUpdate() {}, async requestPermission() { throw new Error("no permission"); } },
    });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      const before = byId(session.configOptions ?? []);

      const response = await handle.conn.setSessionConfigOption({
        sessionId: session.sessionId,
        configId: "model",
        value: "model-07",
      });
      expect(response.configOptions).toHaveLength(3);
      const after = byId(response.configOptions);
      expect(current(after["model"])).toBe("model-07");
      expect(current(after["mode"])).toBe(current(before["mode"]));
      expect(current(after["thought_level"])).toBe(current(before["thought_level"]));
      expect(response.configOptions.map(valueCount)).toEqual([4, 20, 4]);

      // The change sticks for this session: a second change keeps the first.
      const again = await handle.conn.setSessionConfigOption({
        sessionId: session.sessionId,
        configId: "mode",
        value: "plan",
      });
      const latest = byId(again.configOptions);
      expect(current(latest["mode"])).toBe("plan");
      expect(current(latest["model"])).toBe("model-07");
    } finally {
      handle.stop();
    }
  });

  test("the turn reports the current values", async () => {
    const texts: string[] = [];
    const handle = spawnFakeAgent({
      scenario: "config-options",
      client: {
        async sessionUpdate(params) {
          if (params.update.sessionUpdate === "agent_message_chunk" && params.update.content.type === "text") {
            texts.push(params.update.content.text);
          }
        },
        async requestPermission() {
          throw new Error("no permission");
        },
      },
    });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      await handle.conn.setSessionConfigOption({ sessionId: session.sessionId, configId: "thought_level", value: "high" });
      await handle.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "status" }] });
      expect(texts.join("")).toContain("mode=ask model=model-01 thought_level=high");
    } finally {
      handle.stop();
    }
  });

  test("an unknown option or value is an invalid-params error", async () => {
    const handle = spawnFakeAgent({
      scenario: "config-options",
      client: { async sessionUpdate() {}, async requestPermission() { throw new Error("no permission"); } },
    });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      expect(await rejectionOf(
        handle.conn.setSessionConfigOption({ sessionId: session.sessionId, configId: "nope", value: "x" }),
      )).toBeDefined();
      expect(await rejectionOf(
        handle.conn.setSessionConfigOption({ sessionId: session.sessionId, configId: "model", value: "model-99" }),
      )).toBeDefined();
    } finally {
      handle.stop();
    }
  });

  test("scenarios without config options answer set_config_option as method not found", async () => {
    const handle = spawnFakeAgent({
      scenario: "basic",
      client: { async sessionUpdate() {}, async requestPermission() { throw new Error("no permission"); } },
    });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      expect(await rejectionOf(
        handle.conn.setSessionConfigOption({ sessionId: session.sessionId, configId: "model", value: "x" }),
      )).toBeDefined();
    } finally {
      handle.stop();
    }
  });
});
