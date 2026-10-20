// The "plan-running" scenario (phase-1a task 6.4): the state behind the activity bar's "Running
// turn with a plan" scenario. Two tool calls are in progress and the plan has five entries, two
// completed and the third in progress, so the bar reads
// `2 running: Search routes · plan 2/5 ▸ Write the test`. The state is held for HOLD_MS (scaled
// by --delay-scale, so nothing at 0) or until the client cancels, then both tools complete, the
// plan is finished and the turn ends. The titles are short enough for both to show in full at
// 63 columns.
import type { PromptResponse } from "@agentclientprotocol/sdk";
import type { Scenario, ScenarioContext } from "../scenario.ts";

export const PLAN_RUNNING_TOOL_TITLES = ["Read Router.php", "Search routes"] as const;
export const PLAN_RUNNING_ENTRIES = ["Read the router", "Add the route", "Write the test", "Run the suite", "Report"] as const;
/** How long the running state is held at --delay-scale 1. */
export const PLAN_RUNNING_HOLD_MS = 100;

type PlanStatus = "pending" | "in_progress" | "completed";

function plan(statuses: readonly PlanStatus[]) {
  return PLAN_RUNNING_ENTRIES.map((content, i) => ({ content, priority: "medium" as const, status: statuses[i]! }));
}

export const planRunningScenario: Scenario = {
  name: "plan-running",

  async prompt(ctx: ScenarioContext): Promise<PromptResponse> {
    const cancelled: PromptResponse = { stopReason: "cancelled" };
    const running: PlanStatus[] = ["completed", "completed", "in_progress", "pending", "pending"];

    for (const [i, title] of PLAN_RUNNING_TOOL_TITLES.entries()) {
      await ctx.send({ sessionUpdate: "tool_call", toolCallId: `pr-${i + 1}`, title, kind: i === 0 ? "read" : "search", status: "in_progress" });
    }
    await ctx.send({ sessionUpdate: "plan", entries: plan(running) });

    await ctx.sleep(PLAN_RUNNING_HOLD_MS);
    if (ctx.cancelled.aborted) return cancelled;

    for (let i = 1; i <= PLAN_RUNNING_TOOL_TITLES.length; i++) {
      await ctx.send({
        sessionUpdate: "tool_call_update",
        toolCallId: `pr-${i}`,
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: `step ${i} done\n` } }],
      });
    }
    await ctx.send({ sessionUpdate: "plan", entries: plan(["completed", "completed", "completed", "completed", "completed"]) });
    return { stopReason: "end_turn" };
  },
};
