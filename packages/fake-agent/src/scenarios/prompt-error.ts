// The "prompt-error" scenario (task 4.2 knobs): answers session/prompt with
// a JSON-RPC error, for acp-tui's prompt-error PTY and headless tests.
import { RequestError, type PromptResponse } from "@agentclientprotocol/sdk";
import type { Scenario, ScenarioContext } from "../scenario.ts";

export const promptErrorScenario: Scenario = {
  name: "prompt-error",

  async prompt(_ctx: ScenarioContext): Promise<PromptResponse> {
    throw RequestError.internalError(undefined, "fake-agent: prompt-error scenario always fails");
  },
};
