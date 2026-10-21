// Spec model-session, "Model text is sanitised on entry", for session metadata: config options,
// modes, agent identity and permission option names are stored sanitised.
import { describe, expect, test } from "bun:test";
import { reduce } from "../src/reducer.ts";
import { createSession } from "../src/types.ts";
import type { ModelDebugInfo, PermissionRecordItem } from "../src/types.ts";

const ESC = "\x1b";
const OSC52 = `${ESC}]52;c;ZXZpbA==\x07`;
const hasEscape = (value: unknown): boolean => /[\x1b\x07\x80-\x9f]/.test(JSON.stringify(value).replace(/\\u001b/g, "\x1b").replace(/\\u0007/g, "\x07"));

describe("session metadata is sanitised on entry", () => {
  const session = reduce(createSession(), {
    type: "session_created",
    at: 0,
    cwd: "/work/repo",
    agentInfo: { name: `fake${OSC52}-agent`, title: `Fake ${ESC}[31mAgent`, version: `1.0${ESC}[2J` },
    response: {
      sessionId: "s1",
      configOptions: [
        {
          id: "model",
          type: "select",
          category: "model",
          name: `Model${OSC52}`,
          description: `Pick ${ESC}]0;title\x07one`,
          currentValue: "sonnet",
          options: [
            { value: "opus", name: `opus${ESC}[5m` },
            { value: "sonnet", name: `sonnet${OSC52}-4.5`, description: `fast${ESC}[?1049h` },
          ],
        },
        {
          id: "effort",
          type: "select",
          category: "thought_level",
          name: "Effort",
          currentValue: "high",
          options: [{ group: "g", name: `Group${ESC}[1m`, options: [{ value: "high", name: `High${OSC52}` }] }],
        },
        { id: "fast", type: "boolean", name: `Fast${ESC}[3J`, currentValue: true },
      ],
      modes: {
        currentModeId: "auto",
        availableModes: [{ id: "auto", name: `Auto${OSC52}`, description: `mode${ESC}[r` }],
      },
    },
  });

  test("no escape sequence survives anywhere in config options, modes or agent info", () => {
    expect(hasEscape(session.configOptions)).toBe(false);
    expect(hasEscape(session.modes)).toBe(false);
    expect(hasEscape(session.agent)).toBe(false);
  });

  test("surrounding text and structure are kept", () => {
    const model = session.configOptions[0]!;
    expect(model.name).toBe("Model");
    expect(model.description).toBe("Pick one");
    expect(model.type === "select" && model.currentValue).toBe("sonnet");
    expect(model.type === "select" && model.options).toEqual([
      { value: "opus", name: "opus" },
      { value: "sonnet", name: "sonnet-4.5", description: "fast" },
    ]);
    const effort = session.configOptions[1]!;
    expect(effort.type === "select" && effort.options).toEqual([{ group: "g", name: "Group", options: [{ value: "high", name: "High" }] }]);
    expect(session.configOptions[2]).toMatchObject({ name: "Fast", currentValue: true });
    expect(session.modes).toEqual({ currentModeId: "auto", availableModes: [{ id: "auto", name: "Auto", description: "mode" }] });
    expect(session.agent).toEqual({ name: "fake-agent", title: "Fake Agent", version: "1.0" });
  });

  test("no agentInfo gives a null agent", () => {
    const bare = reduce(createSession(), { type: "session_created", at: 0, cwd: "/x", response: { sessionId: "s" } });
    expect(bare.agent).toBeNull();
  });

  test("permission option names are sanitised; option ids are kept verbatim for the answer", () => {
    let s = reduce(createSession(), { type: "prompt_sent", text: "go", at: 0 });
    s = reduce(s, {
      type: "permission_opened",
      toolCallId: "t1",
      at: 1,
      request: {
        sessionId: "s1",
        toolCall: { toolCallId: "t1", title: "Run" },
        options: [
          { optionId: "allow", kind: "allow_once", name: `Allow${OSC52} once` },
          { optionId: "reject", kind: "reject_once", name: `Reject${ESC}[2J` },
        ],
      },
    });
    const record = s.items.get("permission:t1") as PermissionRecordItem;
    expect(record.options.map((o) => o.name)).toEqual(["Allow once", "Reject"]);
    expect(record.options.map((o) => o.optionId)).toEqual(["allow", "reject"]);
  });
});

describe("legacy model state (spec model-session, \"Legacy model state is recorded\")", () => {
  const created = (response: Record<string, unknown>, onDebug?: (info: ModelDebugInfo) => void) =>
    reduce(createSession(), { type: "session_created", at: 0, cwd: "/work/repo", response: { sessionId: "s1", ...response } }, onDebug);

  test("Recorded from a new session", () => {
    const session = created({
      models: {
        currentModelId: "opus",
        availableModels: [
          { modelId: "opus", name: "Claude Opus" },
          { modelId: "gpt", name: "GPT", description: "OpenAI" },
        ],
      },
    });
    expect(session.models).toEqual({
      currentModelId: "opus",
      availableModels: [
        { modelId: "opus", name: "Claude Opus", description: null },
        { modelId: "gpt", name: "GPT", description: "OpenAI" },
      ],
    });
  });

  test("a new session without models, or with null, has none", () => {
    expect(created({}).models).toBeNull();
    expect(created({ models: null }).models).toBeNull();
  });

  test("a null description is kept as null and other keys are ignored", () => {
    const session = created({ models: { currentModelId: "a", _meta: { x: 1 }, availableModels: [{ modelId: "a", name: "A", description: null, _meta: {} }] } });
    expect(session.models).toEqual({ currentModelId: "a", availableModels: [{ modelId: "a", name: "A", description: null }] });
  });

  test("an empty current model ID is kept as sent (Auggie right after a login) with the list", () => {
    const session = created({ models: { currentModelId: "", availableModels: [{ modelId: "a", name: "A" }] } });
    expect(session.models).toEqual({ currentModelId: "", availableModels: [{ modelId: "a", name: "A", description: null }] });
  });

  test("Wrong shape ignored", () => {
    const wrong: unknown[] = [
      { currentModelId: "a", availableModels: "nope" },
      { currentModelId: 3, availableModels: [] },
      { availableModels: [] },
      { currentModelId: "a", availableModels: [{ modelId: "a" }] },
      { currentModelId: "a", availableModels: [{ modelId: 1, name: "A" }] },
      { currentModelId: "a", availableModels: [null] },
      { currentModelId: "a", availableModels: [{ modelId: "a", name: "A", description: 5 }] },
      "text",
      7,
      [],
    ];
    for (const models of wrong) {
      const seen: ModelDebugInfo[] = [];
      const session = created({ models }, (info) => seen.push(info));
      expect(session.models).toBeNull();
      expect(seen).toEqual([{ kind: "invalid_models" }]);
    }
  });

  test("Hostile model name", () => {
    const session = created({
      models: {
        currentModelId: `cur${OSC52}rent`,
        availableModels: [{ modelId: `id${ESC}[2J`, name: `Fake${OSC52}Small`, description: `fast${ESC}[31m` }],
      },
    });
    expect(hasEscape(session.models)).toBe(false);
    expect(session.models?.availableModels[0]).toEqual({ modelId: "id", name: "FakeSmall", description: "fast" });
    expect(session.models?.currentModelId).toBe("current");
  });

  test("Kept beside a model config option", () => {
    const models = { currentModelId: "m1", availableModels: [{ modelId: "m1", name: "M1" }] };
    let session = created({
      configOptions: [{ id: "model", type: "select", category: "model", name: "Model", currentValue: "x", options: [{ value: "x", name: "X" }] }],
      models,
    });
    expect(session.configOptions).toHaveLength(1);
    expect(session.models?.currentModelId).toBe("m1");
    const before = session.models;
    session = reduce(session, {
      type: "config_options_replaced",
      at: 1,
      configOptions: [{ id: "model", type: "select", category: "model", name: "Model", currentValue: "y", options: [{ value: "y", name: "Y" }] }],
    });
    expect(session.models).toBe(before);
    session = reduce(session, { type: "session_update", at: 2, update: { sessionUpdate: "config_option_update", configOptions: [] } });
    expect(session.configOptions).toHaveLength(0);
    expect(session.models).toBe(before);
  });
});
