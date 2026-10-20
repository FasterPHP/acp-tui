// mvp-chrome-and-keys tasks 2.1 and 2.2: the updates the agent sends on its own in
// `config-options` (commands, a second commands update, an agent-initiated config option change)
// and in its legacy-mode variant `config-options-legacy` (`current_mode_update`). Each update is
// checked at the client and in fake-agent's log (`session/update/sent`).
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { CONFIG_OPTIONS_COMMANDS, CONFIG_OPTIONS_COMMANDS_AFTER_FIRST_TURN } from "../src/scenarios/config-options.ts";
import { makeTempDir, readLog, rejectionOf, spawnFakeAgent } from "./helpers.ts";

type Kind = SessionUpdate["sessionUpdate"];

function collector(...kinds: Kind[]) {
  const updates: SessionUpdate[] = [];
  return {
    updates,
    client: {
      async sessionUpdate(params: { update: SessionUpdate }) {
        if (kinds.includes(params.update.sessionUpdate)) updates.push(params.update);
      },
      async requestPermission(): Promise<never> {
        throw new Error("no permission");
      },
    },
    /** Notifications reach the client a moment after the call that follows them returns. */
    async waitFor(count: number): Promise<void> {
      for (let waited = 0; updates.length < count && waited < 2000; waited += 10) await Bun.sleep(10);
    },
  };
}

const sentUpdates = (log: { method: string; params: unknown }[]) =>
  log.filter((entry) => entry.method === "session/update/sent").map((entry) => (entry.params as { update: SessionUpdate }).update);

describe("fake-agent config-options commands and agent-initiated changes (task 2.1, 2.2)", () => {
  test("announces two commands after session/new, drops one after the first turn, changes the effort after the second", async () => {
    const logPath = `${makeTempDir()}/log.jsonl`;
    const seen = collector("available_commands_update", "config_option_update");
    const handle = spawnFakeAgent({ scenario: "config-options", logPath, client: seen.client });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      const prompt = () => handle.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "go" }] });

      // 1. After session/new: a command with an input hint and one without.
      await seen.waitFor(1);
      expect(seen.updates[0]).toEqual({ sessionUpdate: "available_commands_update", availableCommands: [...CONFIG_OPTIONS_COMMANDS] });
      expect(CONFIG_OPTIONS_COMMANDS.map((command) => command.input?.hint ?? null)).toEqual(["PR number", null]);

      // 2. The first turn ends with a second update that drops one.
      await prompt();
      await seen.waitFor(2);
      expect(seen.updates[1]).toEqual({
        sessionUpdate: "available_commands_update",
        availableCommands: [...CONFIG_OPTIONS_COMMANDS_AFTER_FIRST_TURN],
      });
      expect(CONFIG_OPTIONS_COMMANDS_AFTER_FIRST_TURN.map((command) => command.name)).toEqual(["review"]);

      // 3. The second turn ends with an agent-initiated config_option_update: thought_level medium -> low.
      await prompt();
      await seen.waitFor(3);
      const change = seen.updates[2];
      expect(change?.sessionUpdate).toBe("config_option_update");
      if (change?.sessionUpdate === "config_option_update") {
        expect(change.configOptions.map((option) => [option.id, option.currentValue])).toEqual([
          ["mode", "ask"],
          ["model", "model-01"],
          ["thought_level", "low"],
        ]);
      }

      // 4. Later turns send nothing of the kind, and the value sticks.
      await prompt();
      await Bun.sleep(100);
      expect(seen.updates).toHaveLength(3);
      const options = (await handle.conn.setSessionConfigOption({ sessionId: session.sessionId, configId: "mode", value: "plan" })).configOptions;
      expect(options.find((option) => option.id === "thought_level")?.currentValue).toBe("low");
    } finally {
      handle.stop();
    }

    // The log records all three sent, in order.
    const sent = sentUpdates(readLog(logPath));
    expect(sent.map((update) => update.sessionUpdate)).toEqual([
      "available_commands_update",
      "available_commands_update",
      "config_option_update",
    ]);
    const first = readLog(logPath).find((entry) => entry.method === "session/update/sent");
    expect(first?.params).toMatchObject({ sessionId: expect.stringMatching(/^fake-session-/) });
  });

  test("an agent that has already moved the effort to low moves it to high", async () => {
    const seen = collector("config_option_update");
    const handle = spawnFakeAgent({ scenario: "config-options", client: seen.client });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      await handle.conn.setSessionConfigOption({ sessionId: session.sessionId, configId: "thought_level", value: "low" });
      for (let turn = 0; turn < 2; turn += 1) {
        await handle.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "go" }] });
      }
      await seen.waitFor(1);
      const change = seen.updates[0];
      expect(change?.sessionUpdate === "config_option_update" && change.configOptions.find((o) => o.id === "thought_level")?.currentValue).toBe("high");
    } finally {
      handle.stop();
    }
  });

  test("scenarios without the hook send no commands and the log has no session/update/sent", async () => {
    const logPath = `${makeTempDir()}/log.jsonl`;
    const seen = collector("available_commands_update", "config_option_update", "current_mode_update");
    const handle = spawnFakeAgent({ scenario: "basic", logPath, client: { ...seen.client, async requestPermission() { return { outcome: { outcome: "cancelled" } }; } } });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      await handle.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "go" }] });
    } finally {
      handle.stop();
    }
    expect(seen.updates).toEqual([]);
    expect(readLog(logPath).map((entry) => entry.method)).not.toContain("session/update/sent");
  });
});

describe("fake-agent config-options-legacy scenario (task 2.2)", () => {
  test("session/new offers legacy modes and no config options; the agent moves itself to plan after the first turn", async () => {
    const logPath = `${makeTempDir()}/log.jsonl`;
    const seen = collector("current_mode_update");
    const handle = spawnFakeAgent({ scenario: "config-options-legacy", logPath, client: seen.client });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      expect(session.configOptions ?? []).toEqual([]);
      expect(session.modes?.currentModeId).toBe("default");
      expect(session.modes?.availableModes.map((mode) => mode.id)).toEqual(["default", "plan", "accept-edits"]);

      await handle.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "go" }] });
      await seen.waitFor(1);
      expect(seen.updates).toEqual([{ sessionUpdate: "current_mode_update", currentModeId: "plan" }]);

      // Later turns leave the mode alone.
      await handle.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "again" }] });
      await Bun.sleep(100);
      expect(seen.updates).toHaveLength(1);
    } finally {
      handle.stop();
    }
    expect(sentUpdates(readLog(logPath))).toEqual([{ sessionUpdate: "current_mode_update", currentModeId: "plan" }]);
  });

  test("session/set_mode changes the mode, a later turn reports it, an unknown mode is an error", async () => {
    const texts: string[] = [];
    const logPath = `${makeTempDir()}/log.jsonl`;
    const handle = spawnFakeAgent({
      scenario: "config-options-legacy",
      logPath,
      client: {
        async sessionUpdate(params) {
          if (params.update.sessionUpdate === "agent_message_chunk" && params.update.content.type === "text") texts.push(params.update.content.text);
        },
        async requestPermission() {
          throw new Error("no permission");
        },
      },
    });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      await handle.conn.setSessionMode({ sessionId: session.sessionId, modeId: "accept-edits" });
      expect(await rejectionOf(handle.conn.setSessionMode({ sessionId: session.sessionId, modeId: "nope" }))).toBeDefined();
      await handle.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "go" }] });
      expect(texts.join("")).toContain("Current mode: accept-edits");
    } finally {
      handle.stop();
    }
    expect(readLog(logPath).filter((entry) => entry.method === "session/set_mode").map((entry) => entry.params)).toEqual([
      { sessionId: expect.any(String), modeId: "accept-edits" },
      { sessionId: expect.any(String), modeId: "nope" },
    ]);
  });

  test("scenarios without legacy modes answer session/set_mode as method not found", async () => {
    const handle = spawnFakeAgent({ scenario: "config-options", client: collector().client });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      expect(await rejectionOf(handle.conn.setSessionMode({ sessionId: session.sessionId, modeId: "plan" }))).toBeDefined();
    } finally {
      handle.stop();
    }
  });
});
