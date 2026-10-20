// The "bidi-permission" scenario (task 8.2): one tool call whose title hides
// its real extension behind a right-to-left override (U+202E) and a
// zero-width space, followed by a permission request for it. acp-tui's
// permission prompt must show the title with both removed.
import type { PromptResponse } from "@agentclientprotocol/sdk";
import type { Scenario, ScenarioContext } from "../scenario.ts";

/** Renders as "run invoice.exe" once the override and zero-width space are stripped. */
export const BIDI_TOOL_TITLE = "run invoice\u202Eexe.\u200Bpdf";

export const bidiPermissionScenario: Scenario = {
  name: "bidi-permission",

  async prompt(ctx: ScenarioContext): Promise<PromptResponse> {
    await ctx.send({ sessionUpdate: "tool_call", toolCallId: "b1", title: BIDI_TOOL_TITLE, kind: "execute", status: "pending" });
    const response = await ctx.requestPermission({
      toolCall: { toolCallId: "b1", title: BIDI_TOOL_TITLE },
      options: [
        { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject-once", name: "Reject once", kind: "reject_once" },
      ],
    });
    if (response.outcome.outcome === "cancelled" || ctx.cancelled.aborted) return { stopReason: "cancelled" };
    await ctx.send({ sessionUpdate: "tool_call_update", toolCallId: "b1", status: "completed" });
    return { stopReason: "end_turn" };
  },
};
