// The "crash" scenario (task 4.2 knobs): exits the process mid-turn, for
// acp-tui's agent-disconnect PTY and headless tests.
import type { PromptResponse } from "@agentclientprotocol/sdk";
import type { Scenario, ScenarioContext } from "../scenario.ts";

export const CRASH_EXIT_CODE = 3;

export const crashScenario: Scenario = {
  name: "crash",

  async prompt(ctx: ScenarioContext): Promise<PromptResponse> {
    await ctx.send({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "About to crash.\n" },
    });
    await ctx.sleep(10);
    process.exit(CRASH_EXIT_CODE);
  },
};
