// The "grouping" scenario (mvp-conversation task 1.1): one turn built to
// exercise the conversation's grouping of quiet runs (tui-conversation
// "Grouping of quiet runs" and "Out-of-order completion inside a run"):
//
//   read #1, a quiet `other` call (text content only), a thought, read #2,
//   an `other` call that asks for permission, read #3, then reads #4 and #5
//   started straight after #3 with nothing between, completing in the order
//   #5, #3, #4.
//
// Reads are numbered by their order among the reads (their titles and IDs
// carry the number). The first four items are one run once finished; the
// permission request breaks it; reads #3 to #5 are live together and finish
// out of order. Pauses use ctx.sleep, so they vanish at --delay-scale 0.
import type { PermissionOption, PromptResponse } from "@agentclientprotocol/sdk";
import type { Scenario, ScenarioContext } from "../scenario.ts";

export const GROUPING_QUIET_OTHER_ID = "other-quiet";
export const GROUPING_PERMISSION_OTHER_ID = "other-permission";
export const GROUPING_THOUGHT_ID = "grouping-thought";

/** The order in which reads #3 to #5 complete. */
export const GROUPING_COMPLETION_ORDER: readonly number[] = [5, 3, 4];

export const GROUPING_PERMISSION_OPTIONS: PermissionOption[] = [
  { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
  { optionId: "reject-once", name: "Reject once", kind: "reject_once" },
];

export const groupingReadId = (n: number): string => `read-${n}`;
export const groupingReadTitle = (n: number): string => `Read src/file-${n}.php`;

const PAUSE_MS = 40;

async function finishedRead(ctx: ScenarioContext, n: number): Promise<void> {
  await ctx.send({
    sessionUpdate: "tool_call",
    toolCallId: groupingReadId(n),
    title: groupingReadTitle(n),
    kind: "read",
    status: "in_progress",
    locations: [{ path: `/work/src/file-${n}.php` }],
  });
  await ctx.sleep(PAUSE_MS);
  await completeRead(ctx, n);
}

async function completeRead(ctx: ScenarioContext, n: number): Promise<void> {
  await ctx.send({
    sessionUpdate: "tool_call_update",
    toolCallId: groupingReadId(n),
    status: "completed",
    content: [{ type: "content", content: { type: "text", text: `<?php // file ${n}\n` } }],
  });
}

export const groupingScenario: Scenario = {
  name: "grouping",

  async prompt(ctx: ScenarioContext): Promise<PromptResponse> {
    await finishedRead(ctx, 1);

    // A quiet `other` call: finished, text content only, no permission request.
    await ctx.send({
      sessionUpdate: "tool_call",
      toolCallId: GROUPING_QUIET_OTHER_ID,
      title: "ToolSearch",
      kind: "other",
      status: "in_progress",
    });
    await ctx.sleep(PAUSE_MS);
    await ctx.send({
      sessionUpdate: "tool_call_update",
      toolCallId: GROUPING_QUIET_OTHER_ID,
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "Found 2 matching tools\n" } }],
    });

    await ctx.send({
      sessionUpdate: "agent_thought_chunk",
      messageId: GROUPING_THOUGHT_ID,
      content: { type: "text", text: "**Checking the next file**\n\nThe second read should tell me where the router is wired." },
    });
    await ctx.sleep(PAUSE_MS);

    await finishedRead(ctx, 2);

    // A consequential `other` call: it asks for permission, so it breaks the run.
    await ctx.send({
      sessionUpdate: "tool_call",
      toolCallId: GROUPING_PERMISSION_OTHER_ID,
      title: "Reload configuration",
      kind: "other",
      status: "pending",
    });
    const response = await ctx.requestPermission({
      toolCall: { toolCallId: GROUPING_PERMISSION_OTHER_ID, title: "Reload configuration", kind: "other" },
      options: GROUPING_PERMISSION_OPTIONS,
    });
    if (response.outcome.outcome === "cancelled" || ctx.cancelled.aborted) {
      return { stopReason: "cancelled" };
    }
    const allowed = response.outcome.outcome === "selected" && response.outcome.optionId.startsWith("allow");
    await ctx.send({
      sessionUpdate: "tool_call_update",
      toolCallId: GROUPING_PERMISSION_OTHER_ID,
      status: allowed ? "completed" : "failed",
    });

    // Reads #3 to #5 start one after another with nothing between them.
    for (const n of [3, 4, 5]) {
      await ctx.send({
        sessionUpdate: "tool_call",
        toolCallId: groupingReadId(n),
        title: groupingReadTitle(n),
        kind: "read",
        status: "in_progress",
        locations: [{ path: `/work/src/file-${n}.php` }],
      });
    }
    for (const n of GROUPING_COMPLETION_ORDER) {
      await ctx.sleep(PAUSE_MS);
      if (ctx.cancelled.aborted) return { stopReason: "cancelled" };
      await completeRead(ctx, n);
    }
    return { stopReason: "end_turn" };
  },
};
