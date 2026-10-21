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
/** The `config-options-models-unset` scenario starts with no current model, as Auggie does right
 *  after a login: `currentModelId` is `""` until `session/set_model` names one. */
const UNSET_MODEL = "";

const MODES: SessionModeState = {
  currentModeId: "default",
  availableModes: [
    { id: "default", name: "Default" },
    { id: "plan", name: "Plan" },
  ],
};

/** Current model per session (the agent process serves one scenario, so module state is enough). */
const currentModels = new Map<string, string>();

function makeScenario(name: string, initialModel: string): Scenario {
  const currentModel = (sessionId: string): string => currentModels.get(sessionId) ?? initialModel;
  return {
    name,

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
      const current = currentModel(ctx.sessionId);
      await ctx.send({
        sessionUpdate: "agent_message_chunk",
        messageId: `${name}-msg`,
        content: { type: "text", text: `Current model: ${current === "" ? "(none)" : current}\n` },
      });
      return { stopReason: "end_turn" };
    },
  };
}

export const configOptionsModelsScenario: Scenario = makeScenario("config-options-models", INITIAL_MODEL);

/** As `config-options-models`, but `currentModelId` is `""` until a model is chosen. */
export const configOptionsModelsUnsetScenario: Scenario = makeScenario("config-options-models-unset", UNSET_MODEL);
