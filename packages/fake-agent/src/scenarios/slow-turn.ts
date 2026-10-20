// The "slow-turn" scenario (mvp-chrome-and-keys task 2.5): a turn with a silent gap between two
// tool calls, for the busy indicator ("Gap between tool calls") and, with --long-gap, the
// attention signal after a long turn.
//
//   message, tool call st-1 (in progress, then completed), a silent gap, tool call st-2
//   (in progress, then completed), message, end_turn.
//
// The gap is GAP_MS (3 s) or, with --long-gap, LONG_GAP_MS (45 s), each multiplied by
// --delay-scale (so none at 0) and cut short by session/cancel. Nothing is sent during the gap.
// The log (--log) holds a `slow-turn/sent` entry (`{ toolCallId, status }`) as each tool call
// update goes out, so the gap is the time between the `st-1` `completed` entry and the `st-2`
// `in_progress` one.
import type { PromptResponse } from "@agentclientprotocol/sdk";
import type { Scenario, ScenarioContext } from "../scenario.ts";

/** The silent gap between the two tool calls, at --delay-scale 1. */
export const SLOW_TURN_GAP_MS = 3000;
/** The gap with --long-gap, at --delay-scale 1. */
export const SLOW_TURN_LONG_GAP_MS = 45_000;

export const slowTurnScenario: Scenario = {
  name: "slow-turn",

  async prompt(ctx: ScenarioContext): Promise<PromptResponse> {
    const cancelled: PromptResponse = { stopReason: "cancelled" };
    const toolStep = async (toolCallId: string, title: string, status: "in_progress" | "completed"): Promise<void> => {
      ctx.log("slow-turn/sent", { toolCallId, status });
      await ctx.send(
        status === "in_progress"
          ? { sessionUpdate: "tool_call", toolCallId, title, kind: "read", status }
          : {
              sessionUpdate: "tool_call_update",
              toolCallId,
              status,
              content: [{ type: "content", content: { type: "text", text: `${title}: done\n` } }],
            },
      );
    };

    await ctx.send({
      sessionUpdate: "agent_message_chunk",
      messageId: "slow-turn-start",
      content: { type: "text", text: "Looking at the first file.\n" },
    });
    await toolStep("st-1", "Read src/Router.php", "in_progress");
    await toolStep("st-1", "Read src/Router.php", "completed");

    await ctx.sleep(ctx.longGap ? SLOW_TURN_LONG_GAP_MS : SLOW_TURN_GAP_MS);
    if (ctx.cancelled.aborted) return cancelled;

    await toolStep("st-2", "Read src/Kernel.php", "in_progress");
    await toolStep("st-2", "Read src/Kernel.php", "completed");
    await ctx.send({
      sessionUpdate: "agent_message_chunk",
      messageId: "slow-turn-end",
      content: { type: "text", text: "Both files read.\n" },
    });
    return { stopReason: "end_turn" };
  },
};
