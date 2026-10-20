// The "config-options-legacy" scenario (mvp-chrome-and-keys task 2.2): the legacy-mode variant
// of `config-options`. An agent of the older kind reports modes through `modes` in the
// session/new response (no `mode` config option, no model or effort option) and changes them with
// `session/set_mode`. The turn reports the current mode and, at the end of a session's first turn,
// the agent moves itself to `plan` with a `current_mode_update` (to `default` when it is already
// in `plan`); the update is logged as `session/update/sent` when --log is given.
import type { PromptResponse, SessionModeState, SetSessionModeRequest } from "@agentclientprotocol/sdk";
import { RequestError } from "@agentclientprotocol/sdk";
import type { Scenario, ScenarioContext } from "../scenario.ts";

export const LEGACY_MODES = [
  { id: "default", name: "Default" },
  { id: "plan", name: "Plan" },
  { id: "accept-edits", name: "Accept edits" },
] as const;

const INITIAL_MODE = "default";

/** Current mode per session (the agent process serves one scenario, so module state is enough). */
const currentModes = new Map<string, string>();
const turnCounts = new Map<string, number>();

function currentMode(sessionId: string): string {
  return currentModes.get(sessionId) ?? INITIAL_MODE;
}

function modeState(sessionId: string): SessionModeState {
  return {
    currentModeId: currentMode(sessionId),
    availableModes: LEGACY_MODES.map((mode) => ({ ...mode })),
  };
}

export const configOptionsLegacyScenario: Scenario = {
  name: "config-options-legacy",

  newSession(_request, sessionId) {
    return { modes: modeState(sessionId) };
  },

  setMode(request: SetSessionModeRequest): void {
    if (!LEGACY_MODES.some((mode) => mode.id === request.modeId)) {
      throw RequestError.invalidParams({ modeId: request.modeId }, "unknown mode");
    }
    currentModes.set(request.sessionId, request.modeId);
  },

  async prompt(ctx: ScenarioContext): Promise<PromptResponse> {
    const turn = (turnCounts.get(ctx.sessionId) ?? 0) + 1;
    turnCounts.set(ctx.sessionId, turn);
    await ctx.send({
      sessionUpdate: "agent_message_chunk",
      messageId: "config-options-legacy-msg",
      content: { type: "text", text: `Current mode: ${currentMode(ctx.sessionId)}\n` },
    });
    if (turn === 1) {
      const next = currentMode(ctx.sessionId) === "plan" ? "default" : "plan";
      currentModes.set(ctx.sessionId, next);
      await ctx.send({ sessionUpdate: "current_mode_update", currentModeId: next });
    }
    return { stopReason: "end_turn" };
  },
};
