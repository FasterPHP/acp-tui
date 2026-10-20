// The "big-output" scenario (task 4.2 knobs): a single tool call with 5000
// lines of text output, for acp-tui's viewer scrolling PTY test.
import type { PromptResponse } from "@agentclientprotocol/sdk";
import type { Scenario, ScenarioContext } from "../scenario.ts";

export const BIG_OUTPUT_LINE_COUNT = 5000;

function bigOutputText(): string {
  const lines = Array.from({ length: BIG_OUTPUT_LINE_COUNT }, (_, index) => `output line ${index + 1}`);
  return `${lines.join("\n")}\n`;
}

export const bigOutputScenario: Scenario = {
  name: "big-output",

  async prompt(ctx: ScenarioContext): Promise<PromptResponse> {
    await ctx.send({
      sessionUpdate: "tool_call",
      toolCallId: "big-output-1",
      title: "Run full test suite",
      kind: "execute",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: bigOutputText() } }],
    });

    return { stopReason: "end_turn" };
  },
};
