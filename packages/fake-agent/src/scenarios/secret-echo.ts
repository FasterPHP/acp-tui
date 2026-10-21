// The "secret-echo" scenario (crash report tests): one answer that holds a marker word, so a test
// can check that conversation text never reaches the debug log's events or a crash report.
import type { PromptResponse } from "@agentclientprotocol/sdk";
import type { Scenario, ScenarioContext } from "../scenario.ts";

export const SECRET_ECHO_TEXT = "The answer holds zebra-secret.";

export const secretEchoScenario: Scenario = {
  name: "secret-echo",

  async prompt(ctx: ScenarioContext): Promise<PromptResponse> {
    await ctx.send({ sessionUpdate: "agent_message_chunk", messageId: "secret-echo", content: { type: "text", text: SECRET_ECHO_TEXT } });
    return { stopReason: "end_turn" };
  },
};
