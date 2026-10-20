// The "config-options" scenario (design D11, phase-1a task 1.6): session
// config options `mode` (4 values), `model` (20) and `thought_level` (4),
// returned by session/new, with session/set_config_option implemented: the
// response is the full rebuilt list, as the protocol asks. Feeds spike S6's
// model picker and the prompt box's border values (mode, model). The turn
// itself reports the current values, so a test or a PTY run can see a
// change took effect.
//
// mvp-chrome-and-keys (tasks 2.1, 2.2) adds what the agent does on its own:
//   - once session/new has been answered, an `available_commands_update` with
//     `review` (input hint "PR number") and `compact` (no input);
//   - at the end of a session's first turn, a second `available_commands_update`
//     that drops `compact`;
//   - at the end of its second turn, an agent-initiated `config_option_update`
//     that moves thought_level (to `low`, or to `high` when it is `low`).
// Each is logged as `session/update/sent` when --log is given.
import {
  RequestError,
  type AvailableCommand,
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

const MODEL_WORDS = [
  "Aurora", "Basalt", "Cinder", "Dune", "Ember", "Fjord", "Granite", "Harbour", "Iris", "Juniper",
  "Kestrel", "Lantern", "Meadow", "Nimbus", "Orchid", "Pebble", "Quartz", "Ripple", "Sable", "Tundra",
] as const;

export const CONFIG_OPTION_DEFINITIONS: readonly ConfigDefinition[] = [
  {
    id: "mode",
    name: "Mode",
    category: "mode",
    initial: "ask",
    values: [
      { value: "ask", name: "Ask" },
      { value: "plan", name: "Plan" },
      { value: "accept-edits", name: "Accept edits" },
      { value: "auto", name: "Auto" },
    ],
  },
  {
    id: "model",
    name: "Model",
    category: "model",
    initial: "model-01",
    values: MODEL_WORDS.map((word, i) => ({
      value: `model-${String(i + 1).padStart(2, "0")}`,
      name: `Fake ${word}`,
    })),
  },
  {
    id: "thought_level",
    name: "Thinking",
    category: "thought_level",
    initial: "medium",
    values: [
      { value: "off", name: "Off" },
      { value: "low", name: "Low" },
      { value: "medium", name: "Medium" },
      { value: "high", name: "High" },
    ],
  },
];

/** The commands the agent announces after session/new (task 2.1). */
export const CONFIG_OPTIONS_COMMANDS: readonly AvailableCommand[] = [
  { name: "review", description: "Review a pull request", input: { hint: "PR number" } },
  { name: "compact", description: "Compact the conversation" },
];

/** The commands left after the first turn: `compact` is dropped. */
export const CONFIG_OPTIONS_COMMANDS_AFTER_FIRST_TURN: readonly AvailableCommand[] = CONFIG_OPTIONS_COMMANDS.filter(
  (command) => command.name === "review",
);

/** Prompt turns answered so far, per session (the agent process serves one scenario, so module state is enough). */
const turnCounts = new Map<string, number>();

/** Current value per option, per session; the agent process serves one scenario, so module state is enough. */
const sessions = new Map<string, Map<string, string>>();

function currentValues(sessionId: string): Map<string, string> {
  let values = sessions.get(sessionId);
  if (!values) {
    values = new Map(CONFIG_OPTION_DEFINITIONS.map((definition) => [definition.id, definition.initial]));
    sessions.set(sessionId, values);
  }
  return values;
}

function buildOptions(sessionId: string): SessionConfigOption[] {
  const values = currentValues(sessionId);
  return CONFIG_OPTION_DEFINITIONS.map(
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

export const configOptionsScenario: Scenario = {
  name: "config-options",

  newSession(_request, sessionId) {
    return { configOptions: buildOptions(sessionId) };
  },

  setConfigOption(request: SetSessionConfigOptionRequest): SetSessionConfigOptionResponse {
    const definition = CONFIG_OPTION_DEFINITIONS.find((entry) => entry.id === request.configId);
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

  async sessionStarted(session) {
    await session.send({ sessionUpdate: "available_commands_update", availableCommands: [...CONFIG_OPTIONS_COMMANDS] });
  },

  async prompt(ctx: ScenarioContext): Promise<PromptResponse> {
    const turn = (turnCounts.get(ctx.sessionId) ?? 0) + 1;
    turnCounts.set(ctx.sessionId, turn);
    const summary = [...currentValues(ctx.sessionId)].map(([id, value]) => `${id}=${value}`).join(" ");
    await ctx.send({
      sessionUpdate: "agent_message_chunk",
      messageId: "config-options-msg",
      content: { type: "text", text: `Current config: ${summary}\n` },
    });
    if (turn === 1) {
      await ctx.send({
        sessionUpdate: "available_commands_update",
        availableCommands: [...CONFIG_OPTIONS_COMMANDS_AFTER_FIRST_TURN],
      });
    } else if (turn === 2) {
      // The agent changes the effort itself, as it does when it moves out of a mode of its own accord.
      const values = currentValues(ctx.sessionId);
      values.set("thought_level", values.get("thought_level") === "low" ? "high" : "low");
      await ctx.send({ sessionUpdate: "config_option_update", configOptions: buildOptions(ctx.sessionId) });
    }
    return { stopReason: "end_turn" };
  },
};
