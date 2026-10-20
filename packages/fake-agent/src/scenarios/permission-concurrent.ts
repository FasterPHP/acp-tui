// The "permission-concurrent" scenario (mvp-chrome-and-keys task 2.3): two tool calls, and a
// permission request for each sent one straight after the other, without waiting for the first
// answer (the agent has two requests open at once). The client keeps both, shows the first and
// queues the second; the turn waits for both answers, completes the tool call of each request
// that was allowed (fails the others), reports both outcomes and ends.
//
// The log (--log) holds the client's response to each request as `session/request_permission/response`,
// in the order they arrive, and, to tell them apart, one `permission-concurrent/answer` entry per
// request: `{ toolCallId, outcome }`.
import type { PermissionOption, PromptResponse, RequestPermissionResponse } from "@agentclientprotocol/sdk";
import type { Scenario, ScenarioContext } from "../scenario.ts";

export const PERMISSION_CONCURRENT_TOOL_CALLS = [
  { toolCallId: "pc-1", title: "Edit src/Router.php", kind: "edit" },
  { toolCallId: "pc-2", title: "Run vendor/bin/phpunit", kind: "execute" },
] as const;

export const PERMISSION_CONCURRENT_OPTIONS: PermissionOption[] = [
  { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
  { optionId: "reject-once", name: "Reject once", kind: "reject_once" },
];

export const permissionConcurrentScenario: Scenario = {
  name: "permission-concurrent",

  async prompt(ctx: ScenarioContext): Promise<PromptResponse> {
    for (const call of PERMISSION_CONCURRENT_TOOL_CALLS) {
      await ctx.send({ sessionUpdate: "tool_call", toolCallId: call.toolCallId, title: call.title, kind: call.kind, status: "pending" });
    }

    const ask = async (toolCallId: string): Promise<RequestPermissionResponse> => {
      const response = await ctx.requestPermission({ toolCall: { toolCallId }, options: PERMISSION_CONCURRENT_OPTIONS });
      ctx.log("permission-concurrent/answer", { toolCallId, outcome: response.outcome });
      return response;
    };
    // Both requests go out before either answer is awaited.
    const answers = await Promise.all(PERMISSION_CONCURRENT_TOOL_CALLS.map((call) => ask(call.toolCallId)));

    if (ctx.cancelled.aborted || answers.some((answer) => answer.outcome.outcome === "cancelled")) {
      return { stopReason: "cancelled" };
    }

    const summary: string[] = [];
    for (const [i, call] of PERMISSION_CONCURRENT_TOOL_CALLS.entries()) {
      const outcome = answers[i]!.outcome;
      const optionId = outcome.outcome === "selected" ? outcome.optionId : "cancelled";
      const allowed = outcome.outcome === "selected" && PERMISSION_CONCURRENT_OPTIONS.find((option) => option.optionId === optionId)?.kind === "allow_once";
      summary.push(`${call.toolCallId}: ${optionId}`);
      await ctx.send({ sessionUpdate: "tool_call_update", toolCallId: call.toolCallId, status: allowed ? "completed" : "failed" });
    }
    await ctx.send({
      sessionUpdate: "agent_message_chunk",
      messageId: "permission-concurrent-msg",
      content: { type: "text", text: `Answers: ${summary.join(", ")}\n` },
    });
    return { stopReason: "end_turn" };
  },
};
