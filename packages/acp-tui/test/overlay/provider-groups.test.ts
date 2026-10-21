// Model lists grouped by provider (spec tui-palette "Model choices grouped by provider", spec
// tui-layout "Model names with their provider", spec tui-config "Model list settings"): the rule,
// the picker's items and the names the pill, the module and the splash read.
import { describe, expect, test } from "bun:test";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { createSession, type Session } from "acp-model";
import { parseConfigText } from "../../src/config/load.ts";
import { defaultConfig } from "../../src/config/schema.ts";
import { modelDisplayName, providerGroups } from "../../src/layout/provider-groups.ts";
import { configPills, deriveSessionView } from "../../src/layout/view.ts";
import { currentName, pickerItems, pickerOptions } from "../../src/overlay/palette.ts";

type Select = Extract<SessionConfigOption, { type: "select" }>;

const model = (options: Select["options"], currentValue: string): Select => ({ type: "select", id: "model", name: "Model", category: "model", currentValue, options });

const OPENCODE = model(
  [
    { value: "anthropic/claude-x", name: "anthropic/Claude X" },
    { value: "anthropic/claude-y", name: "anthropic/Claude Y" },
    { value: "openrouter/qwen/qwen3-coder", name: "openrouter/Qwen: Qwen3 Coder" },
  ],
  "openrouter/qwen/qwen3-coder",
);

const sessionWith = (option: SessionConfigOption): Session => ({ ...createSession(), configOptions: [option] });

describe("providerGroups", () => {
  test("OpenCode-like list: headings at each change of provider, titles after the prefix, the filter matches the full name and value", () => {
    const items = pickerItems(OPENCODE);
    expect(items.map((i) => [i.group, i.title, i.current])).toEqual([
      ["anthropic", "Claude X", false],
      ["anthropic", "Claude Y", false],
      ["openrouter", "Qwen: Qwen3 Coder", true],
    ]);
    // A value with a further slash splits at the first one only.
    expect(items[2]!.id).toBe("openrouter/qwen/qwen3-coder");
    expect(items[2]!.search).toContain("openrouter/Qwen: Qwen3 Coder");
    expect(items[2]!.search).toContain("openrouter/qwen/qwen3-coder");
  });

  test("One provider: drawn as sent", () => {
    const one = model([{ value: "local/a", name: "local/A" }, { value: "local/b", name: "local/B" }], "local/a");
    expect(providerGroups(one)).toBeNull();
    expect(pickerItems(one).map((i) => [i.group, i.title])).toEqual([[null, "local/A"], [null, "local/B"]]);
  });

  test("Groups sent by the harness: unchanged", () => {
    const grouped = model(
      [
        { group: "g1", name: "Claude", options: [{ value: "anthropic/a", name: "anthropic/A" }] },
        { group: "g2", name: "Open", options: [{ value: "openai/b", name: "openai/B" }] },
      ],
      "anthropic/a",
    );
    expect(providerGroups(grouped)).toBeNull();
    expect(pickerItems(grouped).map((i) => [i.group, i.title])).toEqual([["Claude", "anthropic/A"], ["Open", "openai/B"]]);
  });

  test("a list that fails the rule is drawn as sent: a value without a provider, a name without a prefix, two prefixes for one provider, one prefix for two providers", () => {
    expect(providerGroups(model([{ value: "plain", name: "Plain" }, { value: "a/b", name: "a/B" }], "plain"))).toBeNull();
    expect(providerGroups(model([{ value: "a/x", name: "a/X" }, { value: "b/y", name: "Y" }], "a/x"))).toBeNull();
    expect(providerGroups(model([{ value: "a/x", name: "a/X" }, { value: "b/y", name: "b/" }], "a/x"))).toBeNull();
    // A slash inside one provider's model names (`Qwen/Qwen3`) is not a provider.
    expect(providerGroups(model([{ value: "a/x", name: "Alpha/X" }, { value: "a/q", name: "Qwen/Qwen3" }, { value: "b/y", name: "Beta/Y" }], "a/x"))).toBeNull();
    expect(providerGroups(model([{ value: "a/x", name: "Same/X" }, { value: "b/y", name: "Same/Y" }], "a/x"))).toBeNull();
    expect(providerGroups({ ...OPENCODE, category: "mode" })).toBeNull();
  });

  test("OpenCode 1.x list, named `<display name>/<model>`: headings from the names' prefix, and the pill names the display name", () => {
    const v1 = model(
      [
        { value: "augment/gpt-6-luna", name: "Augment Code/GPT 6 Luna" },
        { value: "augment/kimi-k3", name: "Augment Code/Kimi K3" },
        { value: "blueai/Gemma-4-31B", name: "BlueAI Platform/Gemma4 31b" },
        { value: "blueai/Qwen3.5-397B-A17B-AWQ", name: "BlueAI Platform/Qwen3.5 397b" },
      ],
      "blueai/Qwen3.5-397B-A17B-AWQ",
    );
    expect(pickerItems(v1).map((i) => [i.group, i.title, i.current])).toEqual([
      ["Augment Code", "GPT 6 Luna", false],
      ["Augment Code", "Kimi K3", false],
      ["BlueAI Platform", "Gemma4 31b", false],
      ["BlueAI Platform", "Qwen3.5 397b", true],
    ]);
    expect(pickerItems(v1)[0]!.search).toContain("augment/gpt-6-luna");
    expect(modelDisplayName(v1, "blueai/Qwen3.5-397B-A17B-AWQ", "BlueAI Platform/Qwen3.5 397b")).toBe("BlueAI Platform / Qwen3.5 397b");
  });

  test("Older model state: the fold groups in the same way", () => {
    const options = pickerOptions({
      configOptions: [],
      modes: null,
      models: {
        currentModelId: "openai/gpt",
        availableModels: [
          { modelId: "anthropic/opus", name: "anthropic/Opus", description: null },
          { modelId: "openai/gpt", name: "openai/GPT", description: null },
        ],
      },
    } as never);
    const legacy = options[0] as Select;
    expect(pickerItems(legacy).map((i) => [i.group, i.title, i.current])).toEqual([["anthropic", "Opus", false], ["openai", "GPT", true]]);
  });

  test("a hostile name is sanitised as before", () => {
    const hostile = model(
      [
        { value: "a/x", name: "a/\u001b]8;;https://example.com/\u0007Linked\u001b]8;;\u0007" },
        { value: "b/y", name: "b/Y" },
      ],
      "a/x",
    );
    const titles = pickerItems(hostile).map((i) => i.title);
    expect(titles[0]).not.toContain("\u001b");
    expect(titles[0]).toContain("Linked");
  });

  test("grouping off draws the picker as sent", () => {
    expect(pickerItems(OPENCODE, { groupByProvider: false, separator: " / " }).map((i) => [i.group, i.title])).toEqual([
      [null, "anthropic/Claude X"],
      [null, "anthropic/Claude Y"],
      [null, "openrouter/Qwen: Qwen3 Coder"],
    ]);
  });
});

describe("display names", () => {
  test("OpenCode model in the pill, the model module and the notice", () => {
    const session = sessionWith(OPENCODE);
    expect(configPills(session).find((p) => p.category === "model")?.value).toBe("openrouter / Qwen: Qwen3 Coder");
    expect(deriveSessionView(session).model).toBe("openrouter / Qwen: Qwen3 Coder");
    expect(currentName(OPENCODE)).toBe("openrouter / Qwen: Qwen3 Coder");
  });

  test("No current model: the entry reads default, and a value not among the choices reads as sent", () => {
    expect(currentName({ ...OPENCODE, currentValue: "" })).toBe("default");
    expect(currentName({ ...OPENCODE, currentValue: "zz" })).toBe("zz");
  });

  test("Name as sent", () => {
    const plain = model([{ value: "opus", name: "Opus 5.5" }, { value: "sonnet", name: "Sonnet" }], "opus");
    expect(configPills(sessionWith(plain)).find((p) => p.category === "model")?.value).toBe("Opus 5.5");
    expect(modelDisplayName(plain, "opus", "Opus 5.5")).toBe("Opus 5.5");
  });

  test("Grouping off and Separator", () => {
    const session = sessionWith(OPENCODE);
    expect(configPills(session, { groupByProvider: false, separator: " / " }).find((p) => p.category === "model")?.value).toBe("openrouter/Qwen: Qwen3 Coder");
    expect(deriveSessionView(session, { models: { groupByProvider: true, separator: "·" } }).model).toBe("openrouter·Qwen: Qwen3 Coder");
    expect(currentName(OPENCODE, { groupByProvider: true, separator: "·" })).toBe("openrouter·Qwen: Qwen3 Coder");
  });

  test("the older model state reads the same in the pill and the module", () => {
    const session: Session = {
      ...createSession(),
      models: {
        currentModelId: "anthropic/opus",
        availableModels: [
          { modelId: "anthropic/opus", name: "anthropic/Opus", description: null },
          { modelId: "openai/gpt", name: "openai/GPT", description: null },
        ],
      },
    } as Session;
    expect(configPills(session)[0]?.value).toBe("anthropic / Opus");
    expect(deriveSessionView(session).model).toBe("anthropic / Opus");
  });
});

describe("the models section", () => {
  const FILE = "/home/u/.config/acp-tui/config.jsonc";

  test("defaults", () => {
    expect(defaultConfig().models).toEqual({ group_by_provider: true, provider_separator: " / " });
  });

  test("accepts a boolean and a separator of one to five printable characters; a project file may set both", () => {
    for (const separator of ["·", " > ", "12345"]) {
      const parsed = parseConfigText(`{ "models": { "group_by_provider": false, "provider_separator": ${JSON.stringify(separator)} } }`, "/repo/.acp-tui.jsonc", { kind: "project" });
      expect(parsed.problems).toEqual([]);
      expect(parsed.sections["models"]).toEqual({ group_by_provider: false, provider_separator: separator });
    }
  });

  test("an empty, long or non-printable separator is a problem naming the setting", () => {
    for (const bad of [`""`, `"123456"`, `"a\\nb"`, `"\\u001b"`, "3"]) {
      const problems = parseConfigText(`{ "models": { "provider_separator": ${bad} } }`, FILE).problems;
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatchObject({ path: "models.provider_separator", severity: "error" });
    }
  });
});
