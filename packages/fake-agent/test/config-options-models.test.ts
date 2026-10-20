// mvp session-models tasks 2.1 and 2.2: the config-options-models scenario advertises the older
// model state (`models`, with `modes`, no config options) and implements session/set_model; other
// scenarios answer it with method not found.
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { SCENARIOS } from "../src/scenarios/index.ts";
import { makeTempDir, readLog, spawnFakeAgent } from "./helpers.ts";

type LegacyModels = {
  currentModelId: string;
  availableModels: { modelId: string; name: string; description?: string }[];
};
type LegacyNewResponse = { sessionId: string; modes?: unknown; configOptions?: unknown; models?: LegacyModels };

function open(scenario: string, texts: string[] = [], logPath?: string) {
  return spawnFakeAgent({
    scenario,
    ...(logPath ? { logPath } : {}),
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
}

describe("fake-agent config-options-models scenario", () => {
  test("the scenario is listed", () => {
    expect(SCENARIOS["config-options-models"]?.name).toBe("config-options-models");
  });

  test("session/new returns modes and models and no config options", async () => {
    const handle = open("config-options-models");
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = (await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] })) as LegacyNewResponse;
      expect(session.configOptions).toBeUndefined();
      expect(session.modes).toMatchObject({ currentModeId: "default" });
      expect(session.models?.currentModelId).toBe("fake-small");
      expect(session.models?.availableModels.map((model) => model.modelId)).toEqual(["fake-small", "fake-large", "fake-hostile"]);
      expect(session.models?.availableModels[0]?.name).toBe("Fake Small");
      const hostile = session.models?.availableModels[2];
      expect(hostile?.name).toContain("\u001b]52;");
      expect(hostile?.description).toContain("\u001b[");
    } finally {
      handle.stop();
    }
  });

  test("session/set_model changes the model the next turn names, and is logged", async () => {
    const texts: string[] = [];
    const logPath = `${makeTempDir()}/log.jsonl`;
    const handle = open("config-options-models", texts, logPath);
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      await handle.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "one" }] });
      expect(texts.join("")).toContain("Current model: fake-small");

      const result = await handle.conn.extMethod("session/set_model", { sessionId: session.sessionId, modelId: "fake-large" });
      expect(result == null || Object.keys(result).length === 0).toBe(true);

      texts.length = 0;
      await handle.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "two" }] });
      expect(texts.join("")).toContain("Current model: fake-large");
      expect(readLog(logPath).filter((entry) => entry.method === "session/set_model").map((entry) => entry.params)).toEqual([
        { sessionId: session.sessionId, modelId: "fake-large" },
      ]);
    } finally {
      handle.stop();
    }
  });

  test("an unknown model ID is invalid params and changes nothing", async () => {
    const texts: string[] = [];
    const handle = open("config-options-models", texts);
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      await expect(handle.conn.extMethod("session/set_model", { sessionId: session.sessionId, modelId: "nope" })).rejects.toMatchObject({ code: -32602 });
      await handle.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "go" }] });
      expect(texts.join("")).toContain("Current model: fake-small");
    } finally {
      handle.stop();
    }
  });

  test("another scenario answers session/set_model with method not found", async () => {
    const handle = open("basic");
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      await expect(handle.conn.extMethod("session/set_model", { sessionId: session.sessionId, modelId: "x" })).rejects.toMatchObject({ code: -32601 });
    } finally {
      handle.stop();
    }
  });

  test("session/load returns the models too", async () => {
    const dir = makeTempDir();
    const loading = spawnFakeAgent({
      scenario: "config-options-models",
      args: ["--load", "--sessions", `${dir}/store.json`, "--persist"],
      client: { async sessionUpdate() {}, async requestPermission() { throw new Error("no permission"); } },
    });
    try {
      await loading.conn.initialize({ protocolVersion: 1 });
      const session = await loading.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      await loading.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "go" }] });
      const loaded = (await loading.conn.loadSession({ sessionId: session.sessionId, cwd: tmpdir(), mcpServers: [] })) as LegacyNewResponse;
      expect(loaded.models?.currentModelId).toBe("fake-small");
      expect(loaded.modes).toMatchObject({ currentModeId: "default" });
    } finally {
      loading.stop();
    }
  });
});
