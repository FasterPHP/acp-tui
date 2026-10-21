// The "config-options-providers" scenario: an agent of OpenCode's kind. `session/new` returns a flat
// `model` select whose values are `provider/model` and whose names are `provider/Display Name`, over
// three providers: six ordinary choices (one with a further slash in its value, as OpenRouter's
// `openrouter/qwen/qwen3-coder`) and a seventh whose name carries an OSC 8 sequence, for the sanitiser.
// `effort` and `mode` options come with it. `session/set_config_option` changes any of them and
// answers the full rebuilt list; the turn names the current model so a test can see a change arrive.
import {
  RequestError,
  type PromptResponse,
  type SessionConfigOption,
  type SetSessionConfigOptionRequest,
  type SetSessionConfigOptionResponse,
} from "@agentclientprotocol/sdk";
import type { Scenario, ScenarioContext } from "../scenario.ts";

interface ConfigDefinition {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly values: readonly { readonly value: string; readonly name: string }[];
  readonly initial: string;
}

export const PROVIDER_MODELS: readonly { readonly value: string; readonly name: string }[] = [
  { value: "anthropic/claude-x", name: "anthropic/Claude X" },
  { value: "anthropic/claude-y", name: "anthropic/Claude Y" },
  { value: "openrouter/qwen/qwen3-coder", name: "openrouter/Qwen: Qwen3 Coder" },
  { value: "openrouter/meta/llama-4", name: "openrouter/Meta: Llama 4" },
  { value: "openai/gpt-x", name: "openai/GPT X" },
  { value: "openai/gpt-x-mini", name: "openai/GPT X Mini" },
  { value: "openai/linked", name: "openai/\u001b]8;;https://example.com/\u0007Linked\u001b]8;;\u0007" },
];

export const PROVIDER_DEFINITIONS: readonly ConfigDefinition[] = [
  { id: "model", name: "Model", category: "model", initial: "anthropic/claude-x", values: PROVIDER_MODELS },
  {
    id: "effort",
    name: "Effort",
    category: "thought_level",
    initial: "medium",
    values: [
      { value: "low", name: "Low" },
      { value: "medium", name: "Medium" },
      { value: "high", name: "High" },
    ],
  },
  {
    id: "mode",
    name: "Mode",
    category: "mode",
    initial: "build",
    values: [
      { value: "build", name: "Build" },
      { value: "plan", name: "Plan" },
    ],
  },
];

/** Current value per option, per session (the agent process serves one scenario, so module state is enough). */
const sessions = new Map<string, Map<string, string>>();

function currentValues(sessionId: string): Map<string, string> {
  let values = sessions.get(sessionId);
  if (!values) {
    values = new Map(PROVIDER_DEFINITIONS.map((definition) => [definition.id, definition.initial]));
    sessions.set(sessionId, values);
  }
  return values;
}

function buildOptions(sessionId: string): SessionConfigOption[] {
  const values = currentValues(sessionId);
  return PROVIDER_DEFINITIONS.map(
    (definition): SessionConfigOption => ({
      id: definition.id,
      type: "select",
      name: definition.name,
      category: definition.category,
      currentValue: values.get(definition.id) as string,
      options: definition.values.map((entry) => ({ ...entry })),
    }),
  );
}

export const configOptionsProvidersScenario: Scenario = {
  name: "config-options-providers",

  newSession(_request, sessionId) {
    return { configOptions: buildOptions(sessionId) };
  },

  setConfigOption(request: SetSessionConfigOptionRequest): SetSessionConfigOptionResponse {
    const definition = PROVIDER_DEFINITIONS.find((entry) => entry.id === request.configId);
    if (!definition) {
      throw RequestError.invalidParams({ configId: request.configId }, "unknown config option");
    }
    if (typeof request.value !== "string" || !definition.values.some((entry) => entry.value === request.value)) {
      throw RequestError.invalidParams(
        { configId: request.configId, value: request.value },
        "unknown value for this config option",
      );
    }
    currentValues(request.sessionId).set(definition.id, request.value);
    return { configOptions: buildOptions(request.sessionId) };
  },

  async prompt(ctx: ScenarioContext): Promise<PromptResponse> {
    const summary = [...currentValues(ctx.sessionId)].map(([id, value]) => `${id}=${value}`).join(" ");
    await ctx.send({
      sessionUpdate: "agent_message_chunk",
      messageId: "config-options-providers-msg",
      content: { type: "text", text: `Current config: ${summary}\n` },
    });
    return { stopReason: "end_turn" };
  },
};
