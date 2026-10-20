// The "viewer" scenario (acp-tui task 9.1, 9.2): a permission request for an
// earlier tool call while a later one is the most recent, then two
// completions in the opposite order to their start, spaced by scaled delays
// so a test can open acp-tui's viewer before they land.
import type { PermissionOption, PromptResponse } from "@agentclientprotocol/sdk";
import type { Scenario, ScenarioContext } from "../scenario.ts";

const OPTIONS: PermissionOption[] = [
  { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
  { optionId: "reject-once", name: "Reject once", kind: "reject_once" },
];

/** Milliseconds (before `--delay-scale`) from the answer to each completion. */
export const VIEWER_COMPLETION_DELAY_MS = 100;

export const VIEWER_EARLIER_OUTPUT = "earlier tool output line 1\nearlier tool output line 2\n";
export const VIEWER_LATER_OUTPUT = "later tool output\n";

export const viewerScenario: Scenario = {
  name: "viewer",

  async prompt(ctx: ScenarioContext): Promise<PromptResponse> {
    const cancelled: PromptResponse = { stopReason: "cancelled" };
    await ctx.send({
      sessionUpdate: "tool_call",
      toolCallId: "v1",
      title: "Run earlier check",
      kind: "execute",
      status: "in_progress",
      content: [{ type: "content", content: { type: "text", text: VIEWER_EARLIER_OUTPUT } }],
    });
    await ctx.send({
      sessionUpdate: "tool_call",
      toolCallId: "v2",
      title: "Read later file",
      kind: "read",
      status: "in_progress",
    });

    // Permission for the earlier tool, while the later one is the most recent.
    const answer = await ctx.requestPermission({ toolCall: { toolCallId: "v1" }, options: OPTIONS });
    if (answer.outcome.outcome === "cancelled" || ctx.cancelled.aborted) return cancelled;

    await ctx.sleep(VIEWER_COMPLETION_DELAY_MS);
    if (ctx.cancelled.aborted) return cancelled;
    await ctx.send({
      sessionUpdate: "tool_call_update",
      toolCallId: "v2",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: VIEWER_LATER_OUTPUT } }],
    });

    await ctx.sleep(VIEWER_COMPLETION_DELAY_MS);
    if (ctx.cancelled.aborted) return cancelled;
    await ctx.send({ sessionUpdate: "tool_call_update", toolCallId: "v1", status: "completed" });

    return { stopReason: "end_turn" };
  },
};
