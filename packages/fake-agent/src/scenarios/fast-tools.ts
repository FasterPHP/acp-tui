// The "fast-tools" scenario (day-two-feedback task 1.2, design D8): a turn of six short tool
// calls a few hundred milliseconds apart, then a long silence, for the activity bar's linger
// ("Fast tool calls do not flicker", "Linger ends") and the busy indicator beside it.
//
//   six tool calls (`--tools <n>` for another number, cycling the same kinds and titles) (read, search, read, execute, read, edit), each in progress for 40 ms and
//   then completed, their starts 250 ms apart, a silence of 3 s, a one-line answer, end_turn.
//
// Every time is multiplied by --delay-scale (so none at 0: the order alone) and a wait is cut
// short by session/cancel, which ends the turn at once. The log (--log) holds a
// `fast-tools/sent` entry (`{ toolCallId, status }`) just before each tool call update goes
// out, as `slow-turn/sent` does.
import type { PromptResponse, ToolKind } from "@agentclientprotocol/sdk";
import type { Scenario, ScenarioContext } from "../scenario.ts";

/** How long each call stays in progress, at --delay-scale 1. */
export const FAST_TOOLS_LIVE_MS = 40;
/** The time from one call's start to the next one's, at --delay-scale 1. */
export const FAST_TOOLS_PERIOD_MS = 250;
/** The silence after the last call completes, at --delay-scale 1. */
export const FAST_TOOLS_SILENCE_MS = 3000;

/** The six calls: ID, kind and title. */
export const FAST_TOOLS_CALLS: readonly { readonly toolCallId: string; readonly kind: ToolKind; readonly title: string }[] = [
  { toolCallId: "ft-1", kind: "read", title: "Read src/Pool.php" },
  { toolCallId: "ft-2", kind: "search", title: "Search for \"Pool::acquire\"" },
  { toolCallId: "ft-3", kind: "read", title: "Read src/Connection.php" },
  { toolCallId: "ft-4", kind: "execute", title: "Run vendor/bin/phpunit tests/PoolTest.php" },
  { toolCallId: "ft-5", kind: "read", title: "Read tests/PoolTest.php" },
  { toolCallId: "ft-6", kind: "edit", title: "Edit src/Pool.php" },
];

/** The first `count` calls: the six kinds and titles cycled, IDs `ft-1` to `ft-<count>`. */
export function fastToolsCalls(count: number): { readonly toolCallId: string; readonly kind: ToolKind; readonly title: string }[] {
  return Array.from({ length: count }, (_, index) => {
    const { kind, title } = FAST_TOOLS_CALLS[index % FAST_TOOLS_CALLS.length]!;
    return { toolCallId: `ft-${index + 1}`, kind, title };
  });
}

export const FAST_TOOLS_ANSWER = "Pool now releases its connections.\n";

export const fastToolsScenario: Scenario = {
  name: "fast-tools",

  async prompt(ctx: ScenarioContext): Promise<PromptResponse> {
    const cancelled: PromptResponse = { stopReason: "cancelled" };

    const calls = fastToolsCalls(ctx.tools);
    for (const [index, { toolCallId, kind, title }] of calls.entries()) {
      if (ctx.cancelled.aborted) return cancelled;
      ctx.log("fast-tools/sent", { toolCallId, status: "in_progress" });
      await ctx.send({ sessionUpdate: "tool_call", toolCallId, title, kind, status: "in_progress" });
      await ctx.sleep(FAST_TOOLS_LIVE_MS);
      if (ctx.cancelled.aborted) return cancelled;
      ctx.log("fast-tools/sent", { toolCallId, status: "completed" });
      await ctx.send({
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: `${title}: done\n` } }],
      });
      // The next call starts a period after this one did; after the last, the silence.
      await ctx.sleep(index === calls.length - 1 ? FAST_TOOLS_SILENCE_MS : FAST_TOOLS_PERIOD_MS - FAST_TOOLS_LIVE_MS);
    }

    if (ctx.cancelled.aborted) return cancelled;

    await ctx.send({
      sessionUpdate: "agent_message_chunk",
      messageId: "fast-tools-end",
      content: { type: "text", text: FAST_TOOLS_ANSWER },
    });
    return { stopReason: "end_turn" };
  },
};
