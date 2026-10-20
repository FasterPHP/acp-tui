// The "config-options-models" scenario (session-models task 2.1): an agent of Auggie's kind. The
// session/new and session/load responses carry `modes` and `models` (the older, unstable session
// model state, which `@agentclientprotocol/sdk` 1.5.0 no longer types) and no config options;
// `session/set_model` changes the model (an unknown ID is invalid params) and answers `null`.
// `fake-hostile` carries an OSC 52 sequence in its name and a CSI sequence in its description,
// for the sanitiser. The turn names the current model, so a test can see a change reach the agent.
import type { PromptResponse, SessionModeState } from "@agentclientprotocol/sdk";
import { RequestError } from "@agentclientprotocol/sdk";
import type { Scenario, ScenarioContext, SetSessionModelRequest } from "../scenario.ts";

export const LEGACY_MODELS = [
  { modelId: "fake-small", name: "Fake Small", description: "The small fake model" },
  { modelId: "fake-large", name: "Fake Large", description: "The large fake model" },
  { modelId: "fake-hostile", name: "Fake\u001b]52;c;aGVsbG8=\u0007Hostile", description: "Hostile \u001b[31mred\u001b[0m description" },
] as const;

const INITIAL_MODEL = "fake-small";

const MODES: SessionModeState = {
  currentModeId: "default",
  availableModes: [
    { id: "default", name: "Default" },
    { id: "plan", name: "Plan" },
  ],
};

/** Current model per session (the agent process serves one scenario, so module state is enough). */
const currentModels = new Map<string, string>();

function currentModel(sessionId: string): string {
  return currentModels.get(sessionId) ?? INITIAL_MODEL;
}

export const configOptionsModelsScenario: Scenario = {
  name: "config-options-models",

  newSession(_request, sessionId) {
    // `models` is not in the SDK's NewSessionResponse any more; it travels as an extra field.
    return {
      modes: { ...MODES, availableModes: [...MODES.availableModes] },
      models: {
        currentModelId: currentModel(sessionId),
        availableModels: LEGACY_MODELS.map((model) => ({ ...model })),
      },
    } as ReturnType<NonNullable<Scenario["newSession"]>>;
  },

  setModel(request: SetSessionModelRequest): void {
    if (!LEGACY_MODELS.some((model) => model.modelId === request.modelId)) {
      throw RequestError.invalidParams({ modelId: request.modelId }, "unknown model");
    }
    currentModels.set(request.sessionId, request.modelId);
  },

  async prompt(ctx: ScenarioContext): Promise<PromptResponse> {
    await ctx.send({
      sessionUpdate: "agent_message_chunk",
      messageId: "config-options-models-msg",
      content: { type: "text", text: `Current model: ${currentModel(ctx.sessionId)}\n` },
    });
    return { stopReason: "end_turn" };
  },
};
