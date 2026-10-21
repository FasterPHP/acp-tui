// harness-feedback task 1.4: the config-options-providers scenario, an agent of OpenCode's kind.
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { SCENARIOS } from "../src/scenarios/index.ts";
import { rejectionOf, spawnFakeAgent } from "./helpers.ts";

function open(texts: string[] = []) {
  return spawnFakeAgent({
    scenario: "config-options-providers",
    client: {
      async sessionUpdate(params) {
        if (params.update.sessionUpdate === "agent_message_chunk" && params.update.content.type === "text") texts.push(params.update.content.text);
      },
      async requestPermission() {
        throw new Error("no permission");
      },
    },
  });
}

function select(options: readonly SessionConfigOption[] | null | undefined, id: string) {
  const option = options?.find((entry) => entry.id === id);
  if (!option || option.type !== "select") throw new Error(`no select option ${id}`);
  return option;
}

describe("fake-agent config-options-providers scenario", () => {
  test("the scenario is listed", () => {
    expect(SCENARIOS["config-options-providers"]?.name).toBe("config-options-providers");
  });

  test("session/new returns a flat model select over three providers, effort and mode", async () => {
    const handle = open();
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      expect(session.configOptions?.map((option) => option.id)).toEqual(["model", "effort", "mode"]);
      const model = select(session.configOptions, "model");
      const choices = model.options as { value: string; name: string }[];
      expect(choices.every((choice) => "value" in choice)).toBe(true);
      expect(new Set(choices.map((choice) => choice.value.split("/")[0]))).toEqual(new Set(["anthropic", "openrouter", "openai"]));
      expect(choices.filter((choice) => !choice.name.includes("\u001b"))).toHaveLength(6);
      expect(choices.some((choice) => choice.value.split("/").length === 3)).toBe(true);
      for (const choice of choices.filter((entry) => !entry.name.includes("\u001b"))) {
        expect(choice.name.startsWith(`${choice.value.split("/")[0]}/`)).toBe(true);
      }
      expect(choices.filter((choice) => choice.name.includes("\u001b]8;;"))).toHaveLength(1);
      expect(model.currentValue).toBe("anthropic/claude-x");
    } finally {
      handle.stop();
    }
  });

  test("session/set_config_option changes the model, and the turn names it", async () => {
    const texts: string[] = [];
    const handle = open(texts);
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      const changed = await handle.conn.setSessionConfigOption({ sessionId: session.sessionId, configId: "model", value: "openrouter/qwen/qwen3-coder" });
      expect(select(changed.configOptions, "model").currentValue).toBe("openrouter/qwen/qwen3-coder");
      await handle.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "hi" }] });
      expect(texts.join("")).toContain("model=openrouter/qwen/qwen3-coder");
    } finally {
      handle.stop();
    }
  });

  test("an unknown model is invalid params", async () => {
    const handle = open();
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      const error = await rejectionOf(handle.conn.setSessionConfigOption({ sessionId: session.sessionId, configId: "model", value: "nope/none" }));
      expect((error as { code?: number }).code).toBe(-32602);
    } finally {
      handle.stop();
    }
  });
});
