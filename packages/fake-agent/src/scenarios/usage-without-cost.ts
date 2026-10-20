// The "usage-without-cost" scenario (day-one-feedback task 2.2, design D7): an agent that reports
// its cost once and then sends usage updates without it, as `claude-agent-acp` 0.81.2 does (it
// attaches `cost` only to the update after a `result`, and sends cost-less updates on every
// streamed assistant message). Turn 1 ends with a `usage_update` of 38000 of 200000 at 0.42 USD;
// every later turn streams two `usage_update`s with `used` and `size` only (41000 and 45000 of
// 200000), the second after a pause of 1 s x `--delay-scale`, so a test can look at the status
// row while the turn runs. Cumulative cost is the agent's business: it sends nothing for it.
import type { PromptResponse } from "@agentclientprotocol/sdk";
import type { Scenario, ScenarioContext } from "../scenario.ts";

export const USAGE_WITHOUT_COST_SIZE = 200000;
export const USAGE_WITHOUT_COST_FIRST = { used: 38000, size: USAGE_WITHOUT_COST_SIZE, cost: { amount: 0.42, currency: "USD" } } as const;
export const USAGE_WITHOUT_COST_LATER = [
  { used: 41000, size: USAGE_WITHOUT_COST_SIZE },
  { used: 45000, size: USAGE_WITHOUT_COST_SIZE },
] as const;

/** Prompt turns answered so far, per session (the agent process serves one scenario). */
const turnCounts = new Map<string, number>();

export const usageWithoutCostScenario: Scenario = {
  name: "usage-without-cost",

  sessionLoaded(sessionId, turns) {
    turnCounts.set(sessionId, turns);
  },

  async prompt(ctx: ScenarioContext): Promise<PromptResponse> {
    const turn = (turnCounts.get(ctx.sessionId) ?? 0) + 1;
    turnCounts.set(ctx.sessionId, turn);
    await ctx.send({
      sessionUpdate: "agent_message_chunk",
      messageId: `usage-without-cost-msg-${turn}`,
      content: { type: "text", text: `Turn ${turn}.\n` },
    });
    if (turn === 1) {
      await ctx.send({ sessionUpdate: "usage_update", ...USAGE_WITHOUT_COST_FIRST });
      return { stopReason: "end_turn" };
    }
    await ctx.send({ sessionUpdate: "usage_update", ...USAGE_WITHOUT_COST_LATER[0] });
    await ctx.sleep(1000);
    if (ctx.cancelled.aborted) return { stopReason: "cancelled" };
    await ctx.send({ sessionUpdate: "usage_update", ...USAGE_WITHOUT_COST_LATER[1] });
    return { stopReason: "end_turn" };
  },
};
