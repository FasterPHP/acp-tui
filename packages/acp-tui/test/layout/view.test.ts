// SessionView derivation, segments and templates.
import { describe, expect, test } from "bun:test";
import { createSession, type Session } from "acp-model";
import { fitSegments, truncateEnd, truncateMiddle } from "../../src/layout/segments.ts";
import { parseTemplate, renderTemplate } from "../../src/layout/template.ts";
import { configPills, deriveSessionView } from "../../src/layout/view.ts";

describe("deriveSessionView", () => {
  test("a fresh session has no data", () => {
    const v = deriveSessionView(createSession());
    expect(v).toMatchObject({ agent: null, model: null, mode: null, cwd: null, usage: null, cost: null });
    expect(v.connection).toBe("connected");
    expect(v.turnState).toBe("idle");
    expect(v.ui).toEqual({ focus: "prompt", promptEmpty: true, permissionOpen: false, armed: null });
    expect(v).toMatchObject({ turnStartedAt: null, mouse: "full", scroll: { following: true } });
  });

  test("reads model and mode from config options, agent from agentInfo, usage and cost", () => {
    const session: Session = {
      ...createSession(),
      cwd: "/srv/repo",
      state: "requires_action",
      configOptions: [
        {
          id: "m",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "b",
          options: [{ group: "g", name: "G", options: [{ value: "a", name: "A" }, { value: "b", name: "Big" }] }],
        },
        { id: "mo", name: "Mode", category: "mode", type: "select", currentValue: "plan", options: [{ value: "plan", name: "Plan" }] },
      ],
      usage: { used: 10, size: 100, cost: { amount: 1, currency: "EUR" } },
    };
    const v = deriveSessionView(session, { agent: { name: "codex-acp", title: null, version: "1.0" }, home: "/home/x", ui: { armed: { kind: "detach", key: "ctrl+d" } } });
    expect(v).toMatchObject({
      agent: "codex-acp",
      agentVersion: "1.0",
      model: "Big",
      mode: "Plan",
      cwd: "/srv/repo",
      home: "/home/x",
      turnState: "requires_action",
      usage: { used: 10, size: 100 },
      cost: { amount: 1, currency: "EUR" },
    });
    expect(v.ui.permissionOpen).toBe(true);
    expect(v.ui.armed).toEqual({ kind: "detach", key: "ctrl+d" });
  });

  test("falls back to legacy session modes", () => {
    const session: Session = {
      ...createSession(),
      modes: { currentModeId: "ask", availableModes: [{ id: "ask", name: "Ask" }] },
    };
    expect(deriveSessionView(session).mode).toBe("Ask");
  });

  test("names are sanitised again in the view (hand-built sessions bypass the reducer)", () => {
    const session: Session = {
      ...createSession(),
      configOptions: [
        { id: "m", name: "Model", category: "model", type: "select", currentValue: "x", options: [{ value: "x", name: "evil\x1b]52;c;AAAA\x07\nmodel" }] },
      ],
    };
    const v = deriveSessionView(session, { agent: { name: "a", title: "\x1b[2Jtitle" } });
    expect(v.agent).toBe("title");
    expect(v.model).toBe("evil model");
  });

  test("agent identity comes from the session (recorded by session_created) unless overridden", () => {
    const session: Session = { ...createSession(), agent: { name: "fake-agent", title: null, version: "0.0.0" } };
    expect(deriveSessionView(session)).toMatchObject({ agent: "fake-agent", agentVersion: "0.0.0" });
    expect(deriveSessionView(session, { agent: null }).agent).toBeNull();
    expect(deriveSessionView(session, { agent: { name: "other" } }).agent).toBe("other");
  });
});

describe("segments and templates", () => {
  test("templates: placeholders, escaped braces, errors", () => {
    expect(parseTemplate("{a}:{{b}}")).toEqual([
      { kind: "field", name: "a" },
      { kind: "text", text: ":{b}" },
    ]);
    expect(() => parseTemplate("{a")).toThrow(/unclosed/);
    expect(() => parseTemplate("a}")).toThrow(/unmatched/);
    expect(() => parseTemplate("{A B}")).toThrow(/invalid placeholder/);
    expect(renderTemplate("{a}/{b}", { a: "1", b: null }, "muted")).toEqual({ segments: [{ text: "1/", token: "muted" }], empty: false });
    expect(renderTemplate("x{a}", { a: null }, "muted").empty).toBe(true);
  });

  test("truncation respects display width", () => {
    expect(truncateEnd("abcdef", 4)).toBe("abc…");
    expect(truncateEnd("日本語テキスト", 7)).toBe("日本語…");
    expect(truncateMiddle("/a/very/long/path", 9)).toBe("/a/v…path");
    expect(Bun.stringWidth(truncateMiddle("日本語日本語日本語", 9))).toBeLessThanOrEqual(9);
  });

  test("fitSegments cuts at break points first", () => {
    const segs = [
      { text: "one", token: "hint" as const },
      { text: "  ", token: "hint" as const },
      { text: "two", token: "hint" as const, breakBefore: true },
    ];
    expect(fitSegments(segs, 6).map((s) => s.text)).toEqual(["one"]);
    expect(fitSegments(segs, 2).map((s) => s.text)).toEqual(["o…"]);
    expect(fitSegments(segs, 0)).toEqual([]);
  });
});

describe("model pill from the legacy model state (spec tui-layout, \"Config option pills\")", () => {
  const models = {
    currentModelId: "sonnet",
    availableModels: [
      { modelId: "sonnet", name: "Claude Sonnet", description: null },
      { modelId: "opus", name: "Claude Opus", description: null },
    ],
  };
  const modes = { currentModeId: "default", availableModes: [{ id: "default", name: "Default" }, { id: "plan", name: "Plan" }] };
  const modelOption = (value: string, name: string): Session["configOptions"][number] => ({
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: value,
    options: [{ value, name }],
  });

  test("Model from the legacy model state: Mode then Model, and no effort pill", () => {
    const session: Session = { ...createSession(), modes, models };
    expect(configPills(session)).toEqual([
      { category: "mode", name: "Mode", value: "Default" },
      { category: "model", name: "Model", value: "Claude Sonnet" },
    ]);
    expect((deriveSessionView(session).pills ?? []).map((pill) => pill.category)).toEqual(["mode", "model"]);
  });

  test("Current model not listed: the pill reads the ID", () => {
    const session: Session = { ...createSession(), models: { ...models, currentModelId: "custom-1" } };
    expect(configPills(session)).toEqual([{ category: "model", name: "Model", value: "custom-1" }]);
  });

  test("No current model (empty ID): the pill reads default and the view's model too; choosing a model names it", () => {
    const unset: Session = { ...createSession(), modes, models: { ...models, currentModelId: "" } };
    expect(configPills(unset)).toEqual([
      { category: "mode", name: "Mode", value: "Default" },
      { category: "model", name: "Model", value: "default" },
    ]);
    expect(deriveSessionView(unset).model).toBe("default");
    const chosen: Session = { ...unset, models: { ...models, currentModelId: "opus" } };
    expect(configPills(chosen)[1]).toEqual({ category: "model", name: "Model", value: "Claude Opus" });
  });

  test("No current model and no list: no pill, as before (the picker has nothing to offer)", () => {
    const none: Session = { ...createSession(), models: { currentModelId: "", availableModels: [] } };
    expect(configPills(none)).toEqual([]);
    expect(deriveSessionView(none).model).toBeNull();
  });

  test("A model option with an empty current value reads default; with no choices it has no value", () => {
    const empty = (options: { value: string; name: string }[]): Session => ({
      ...createSession(),
      configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "", options }],
    });
    const session = empty([{ value: "a", name: "A" }]);
    expect(configPills(session)).toEqual([{ category: "model", name: "Model", value: "default" }]);
    expect(deriveSessionView(session).model).toBe("default");
    expect(configPills(empty([]))).toEqual([]);
  });

  test("A model option whose current value is not among its options reads the value", () => {
    const session: Session = {
      ...createSession(),
      configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "zz", options: [{ value: "a", name: "A" }] }],
    };
    expect(configPills(session)).toEqual([{ category: "model", name: "Model", value: "zz" }]);
  });

  test("Model option wins: one model pill, from the option", () => {
    const session: Session = { ...createSession(), configOptions: [modelOption("o", "Opus 5.5")], models: { ...models, currentModelId: "opus" } };
    expect(configPills(session)).toEqual([{ category: "model", name: "Model", value: "Opus 5.5" }]);
    expect(deriveSessionView(session).model).toBe("Opus 5.5");
  });

  test("Legacy model after the option goes", () => {
    const withOption: Session = { ...createSession(), configOptions: [modelOption("o", "Opus 5.5")], models };
    expect(configPills(withOption)[0]?.value).toBe("Opus 5.5");
    const after: Session = { ...withOption, configOptions: [] };
    expect(configPills(after)).toEqual([{ category: "model", name: "Model", value: "Claude Sonnet" }]);
  });

  test("an empty model list still shows the current model; hostile names are cleaned again", () => {
    const empty: Session = { ...createSession(), models: { currentModelId: "m1", availableModels: [] } };
    expect(configPills(empty)).toEqual([{ category: "model", name: "Model", value: "m1" }]);
    const hostile: Session = { ...createSession(), models: { currentModelId: "x", availableModels: [{ modelId: "x", name: "evil\x1b]52;c;AAAA\x07\nmodel", description: null }] } };
    expect(configPills(hostile)[0]?.value).toBe("evil model");
  });

  test("no model at all: no pill, no model", () => {
    expect(configPills(createSession())).toEqual([]);
    expect(deriveSessionView(createSession()).model).toBeNull();
  });
});
