// The "five-tools" scenario (task 4.2 knobs): five tool calls in progress at
// once, for acp-tui's "+2 more" activity-region PTY scenario. All five start
// together, stay in progress for a beat, then complete in start order.
import type { PromptResponse } from "@agentclientprotocol/sdk";
import type { Scenario, ScenarioContext } from "../scenario.ts";

const TOOL_COUNT = 5;

export const fiveToolsScenario: Scenario = {
  name: "five-tools",

  async prompt(ctx: ScenarioContext): Promise<PromptResponse> {
    for (let index = 1; index <= TOOL_COUNT; index += 1) {
      await ctx.send({
        sessionUpdate: "tool_call",
        toolCallId: `tool-${index}`,
        title: `Run check ${index}`,
        kind: "execute",
        status: "in_progress",
      });
    }

    await ctx.sleep(50);
    if (ctx.cancelled.aborted) return { stopReason: "cancelled" };

    for (let index = 1; index <= TOOL_COUNT; index += 1) {
      await ctx.send({
        sessionUpdate: "tool_call_update",
        toolCallId: `tool-${index}`,
        status: "completed",
        content: [
          { type: "content", content: { type: "text", text: `check ${index} passed\n` } },
        ],
      });
    }

    return { stopReason: "end_turn" };
  },
};
