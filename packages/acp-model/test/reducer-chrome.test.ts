// mvp-chrome-and-keys, tasks 1.1 to 1.3: config options replaced in full, the current mode
// following the agent, and the agent's commands. One test per scenario in spec model-session
// ("Config options are replaced in full", "Current mode follows the agent", "Available commands
// are recorded"), named after the scenario.

import { describe, expect, test } from "bun:test";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { reduce } from "../src/reducer.ts";
import { createSession } from "../src/types.ts";
import type { ModelDebugInfo, Session } from "../src/types.ts";

const ESC = "\x1b";
const OSC52 = `${ESC}]52;c;ZXZpbA==\x07`;

function select(id: string, category: string, currentValue: string, values: readonly string[]): SessionConfigOption {
  return {
    id,
    type: "select",
    category,
    name: id,
    currentValue,
    options: values.map((value) => ({ value, name: value })),
  };
}

function withOptions(): Session {
  let session = reduce(createSession(), {
    type: "session_created",
    at: 0,
    cwd: "/work/repo",
    response: {
      sessionId: "s1",
      configOptions: [
        select("mode", "mode", "default", ["default", "plan"]),
        select("model", "model", "model-10", ["model-10", "model-11"]),
        select("effort", "thought_level", "high", ["low", "high"]),
      ],
      modes: { currentModeId: "default", availableModes: [{ id: "default", name: "Default" }, { id: "plan", name: "Plan" }] },
    },
  });
  session = reduce(session, { type: "prompt_sent", text: "go", at: 1 });
  return reduce(session, {
    type: "session_update",
    at: 2,
    update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "Read", status: "completed" },
  });
}

function valueOf(session: Session, id: string): string | boolean | undefined {
  return session.configOptions.find((option) => option.id === id)?.currentValue;
}

describe("config options are replaced in full", () => {
  test("Response replaces the list", () => {
    const before = withOptions();
    const after = reduce(before, {
      type: "config_options_replaced",
      at: 3,
      configOptions: [select("mode", "mode", "default", ["default", "plan"]), select("model", "model", "model-11", ["model-10", "model-11"])],
    });
    expect(after.configOptions.map((option) => option.id)).toEqual(["mode", "model"]);
    expect(valueOf(after, "model")).toBe("model-11");
    expect(after.configOptions.find((option) => option.id === "effort")).toBeUndefined();
    // Nothing else changed: same references for everything the event does not name.
    expect(after.items).toBe(before.items);
    expect(after.order).toBe(before.order);
    expect(after.modes).toBe(before.modes);
    expect(after.plan).toBe(before.plan);
    expect(after.turn).toBe(before.turn);
    expect(after.state).toBe(before.state);
  });

  test("Agent-initiated update", () => {
    const before = withOptions();
    const after = reduce(before, {
      type: "session_update",
      at: 3,
      update: {
        sessionUpdate: "config_option_update",
        configOptions: [
          select("mode", "mode", "default", ["default", "plan"]),
          select("model", "model", "model-10", ["model-10", "model-11"]),
          select("effort", "thought_level", "low", ["low", "high"]),
        ],
      },
    });
    expect(valueOf(after, "effort")).toBe("low");
    expect(after.items).toBe(before.items);
    expect(after.modes).toBe(before.modes);
  });

  test("Hostile option name", () => {
    const hostile: SessionConfigOption = {
      id: "model",
      type: "select",
      name: `Model${OSC52}`,
      description: `Pick${OSC52}`,
      currentValue: "a",
      options: [{ value: "a", name: `A${OSC52}` }],
    };
    for (const event of [
      { type: "config_options_replaced", at: 1, configOptions: [hostile] } as const,
      { type: "session_update", at: 1, update: { sessionUpdate: "config_option_update", configOptions: [hostile] } } as const,
    ]) {
      const after = reduce(createSession(), event);
      expect(after.configOptions).toEqual([
        { id: "model", type: "select", name: "Model", description: "Pick", currentValue: "a", options: [{ value: "a", name: "A" }] },
      ]);
      expect(JSON.stringify(after.configOptions)).not.toContain("ZXZpbA");
    }
  });

  test("the event never reads the clock: same input, same output", () => {
    const before = withOptions();
    const event = { type: "config_options_replaced", at: 5, configOptions: [select("mode", "mode", "plan", ["default", "plan"])] } as const;
    expect(reduce(before, event)).toEqual(reduce(before, event));
  });
});

describe("the current mode follows the agent", () => {
  test("Mode changed by the agent", () => {
    const before = withOptions();
    const after = reduce(before, {
      type: "session_update",
      at: 3,
      update: { sessionUpdate: "current_mode_update", currentModeId: "plan" },
    });
    expect(after.modes?.currentModeId).toBe("plan");
    expect(after.modes?.availableModes).toBe(before.modes?.availableModes);
    expect(after.items).toBe(before.items);
  });

  test("an unknown mode ID is recorded and debug-logged, not an error", () => {
    const before = withOptions();
    const seen: ModelDebugInfo[] = [];
    let after: Session | undefined;
    expect(() => {
      after = reduce(before, { type: "session_update", at: 3, update: { sessionUpdate: "current_mode_update", currentModeId: "mystery" } }, (info) =>
        seen.push(info),
      );
    }).not.toThrow();
    expect(after?.modes?.currentModeId).toBe("mystery");
    expect(seen).toEqual([{ kind: "unknown_mode", modeId: "mystery" }]);
  });

  test("a known mode ID is not debug-logged", () => {
    const seen: ModelDebugInfo[] = [];
    reduce(withOptions(), { type: "session_update", at: 3, update: { sessionUpdate: "current_mode_update", currentModeId: "plan" } }, (info) =>
      seen.push(info),
    );
    expect(seen).toEqual([]);
  });

  test("with no legacy mode state the update is debug-logged and the session unchanged", () => {
    const before = createSession();
    const seen: ModelDebugInfo[] = [];
    const after = reduce(before, { type: "session_update", at: 1, update: { sessionUpdate: "current_mode_update", currentModeId: "plan" } }, (info) =>
      seen.push(info),
    );
    expect(after).toBe(before);
    expect(seen).toEqual([{ kind: "unknown_mode", modeId: "plan" }]);
  });

  test("the mode ID is sanitised", () => {
    const after = reduce(withOptions(), {
      type: "session_update",
      at: 3,
      update: { sessionUpdate: "current_mode_update", currentModeId: `pl${OSC52}an` },
    });
    expect(after.modes?.currentModeId).toBe("plan");
  });
});

describe("available commands are recorded", () => {
  test("Commands replaced", () => {
    let session = reduce(createSession(), {
      type: "session_update",
      at: 1,
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          { name: "review", description: "Review a change" },
          { name: "compact", description: "Compact the context" },
        ],
      },
    });
    expect(session.commands.map((command) => command.name)).toEqual(["review", "compact"]);
    session = reduce(session, {
      type: "session_update",
      at: 2,
      update: { sessionUpdate: "available_commands_update", availableCommands: [{ name: "review", description: "Review a change" }] },
    });
    expect(session.commands).toEqual([{ name: "review", description: "Review a change", inputHint: null }]);
  });

  test("Input hint kept", () => {
    const session = reduce(createSession(), {
      type: "session_update",
      at: 1,
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          { name: "review", description: "Review a pull request", input: { hint: "PR number" } },
          { name: "compact", description: "Compact the context" },
        ],
      },
    });
    expect(session.commands[0]).toEqual({ name: "review", description: "Review a pull request", inputHint: "PR number" });
    expect(session.commands[1]?.inputHint).toBeNull();
  });

  test("commands are sanitised and an empty update clears the list", () => {
    let session = reduce(createSession(), {
      type: "session_update",
      at: 1,
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: [{ name: `re${OSC52}view`, description: `Do${ESC}[2J it`, input: { hint: `PR${OSC52} number` } }],
      },
    });
    expect(session.commands).toEqual([{ name: "review", description: "Do it", inputHint: "PR number" }]);
    session = reduce(session, { type: "session_update", at: 2, update: { sessionUpdate: "available_commands_update", availableCommands: [] } });
    expect(session.commands).toEqual([]);
  });

  test("commands survive a turn and do not touch the items", () => {
    const withCommands = reduce(createSession(), {
      type: "session_update",
      at: 1,
      update: { sessionUpdate: "available_commands_update", availableCommands: [{ name: "review", description: "R" }] },
    });
    expect(withCommands.items.size).toBe(0);
    const after = reduce(reduce(withCommands, { type: "prompt_sent", text: "go", at: 2 }), { type: "prompt_response", stopReason: "end_turn", at: 3 });
    expect(after.commands).toBe(withCommands.commands);
  });
});

describe("current legacy model follows a successful selection", () => {
  const legacy = (): Session =>
    reduce(createSession(), {
      type: "session_created",
      at: 0,
      cwd: "/work/repo",
      response: {
        sessionId: "s1",
        models: { currentModelId: "opus", availableModels: [{ modelId: "opus", name: "Opus" }, { modelId: "gpt", name: "GPT" }] },
      } as never,
    });
  const selected = (modelId: string): { type: "legacy_model_selected"; modelId: string; at: number } => ({ type: "legacy_model_selected", modelId, at: 5 });

  test("Model selected", () => {
    let before = reduce(legacy(), { type: "prompt_sent", text: "go", at: 1 });
    before = reduce(before, { type: "session_update", at: 2, update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "Read", status: "completed" } });
    const after = reduce(before, selected("gpt"));
    expect(after.models?.currentModelId).toBe("gpt");
    expect(after.models?.availableModels).toBe(before.models?.availableModels);
    expect(after.items).toBe(before.items);
    expect(after.order).toBe(before.order);
    expect(after.state).toBe(before.state);
    expect(after.configOptions).toBe(before.configOptions);
  });

  test("Unknown model", () => {
    const seen: ModelDebugInfo[] = [];
    const after = reduce(legacy(), selected("missing"), (info) => seen.push(info));
    expect(after.models?.currentModelId).toBe("missing");
    expect(seen).toEqual([{ kind: "unknown_model", modelId: "missing" }]);
  });

  test("no legacy model state: nothing changes, reported", () => {
    const seen: ModelDebugInfo[] = [];
    const before = createSession();
    const after = reduce(before, selected("gpt"), (info) => seen.push(info));
    expect(after).toBe(before);
    expect(seen).toEqual([{ kind: "unknown_model", modelId: "gpt" }]);
  });

  test("the model ID is sanitised", () => {
    const after = reduce(legacy(), selected(`gp${OSC52}t`));
    expect(after.models?.currentModelId).toBe("gpt");
  });
});
