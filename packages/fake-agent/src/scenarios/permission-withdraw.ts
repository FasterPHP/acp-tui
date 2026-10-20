// The "permission-withdraw" scenario (mvp-chrome-and-keys task 2.3): the agent withdraws
// permission requests it has sent (`$/cancel_request`), in two phases within one turn.
//
//   1. A request for `pw-1` alone. After HOLD_MS (scaled by --delay-scale, so none at 0) the
//      agent withdraws it. The client answers the request-cancelled error (-32800).
//   2. Requests for `pw-2` and then `pw-3`, both open (the second waits behind the first in the
//      client's queue). After HOLD_MS the agent withdraws the second, `pw-3`; the first stays
//      open until the user answers it (or interrupts), and the turn ends after that.
//
// The hold gives a test or a person time to look at the card (and focus it) before it goes.
// The log (--log) holds the client's error answers as `session/request_permission/error`
// (`{ code, message }`, code -32800 for a withdrawal) and one `permission-withdraw/result` entry
// per request: `{ toolCallId, result }` with `result` one of `withdrawn` (the error answer
// arrived), `selected` (with `optionId`) or `cancelled`.
import type { PermissionOption, PromptResponse, RequestPermissionResponse } from "@agentclientprotocol/sdk";
import type { Scenario, ScenarioContext } from "../scenario.ts";

/** How long a request stays open before the agent withdraws it, at --delay-scale 1. */
export const PERMISSION_WITHDRAW_HOLD_MS = 1500;

/** The code of the error a client answers a withdrawn request with. */
export const REQUEST_CANCELLED_CODE = -32800;

export const PERMISSION_WITHDRAW_OPTIONS: PermissionOption[] = [
  { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
  { optionId: "reject-once", name: "Reject once", kind: "reject_once" },
];

type Result = { readonly result: "withdrawn" } | { readonly result: "cancelled" } | { readonly result: "selected"; readonly optionId: string };

export const permissionWithdrawScenario: Scenario = {
  name: "permission-withdraw",

  async prompt(ctx: ScenarioContext): Promise<PromptResponse> {
    const say = (text: string, id: string) =>
      ctx.send({ sessionUpdate: "agent_message_chunk", messageId: id, content: { type: "text", text } });

    /** Sends a request and settles with how it ended; never rejects, so a withdrawal is not an unhandled rejection. */
    const ask = async (toolCallId: string, signal?: AbortSignal): Promise<Result> => {
      let result: Result;
      try {
        const response: RequestPermissionResponse = await ctx.requestPermission(
          { toolCall: { toolCallId }, options: PERMISSION_WITHDRAW_OPTIONS },
          signal ? { signal } : undefined,
        );
        result =
          response.outcome.outcome === "selected"
            ? { result: "selected", optionId: response.outcome.optionId }
            : { result: "cancelled" };
      } catch (error) {
        if ((error as { code?: unknown }).code !== REQUEST_CANCELLED_CODE) throw error;
        result = { result: "withdrawn" };
      }
      ctx.log("permission-withdraw/result", { toolCallId, ...result });
      return result;
    };
    const tool = (toolCallId: string, title: string) =>
      ctx.send({ sessionUpdate: "tool_call", toolCallId, title, kind: "edit", status: "pending" });

    // Phase 1: one request, withdrawn.
    await tool("pw-1", "Edit src/Router.php");
    const first = new AbortController();
    const firstResult = ask("pw-1", first.signal);
    await ctx.sleep(PERMISSION_WITHDRAW_HOLD_MS);
    if (ctx.cancelled.aborted) return { stopReason: "cancelled" };
    first.abort();
    const withdrawn = await firstResult;
    await ctx.send({ sessionUpdate: "tool_call_update", toolCallId: "pw-1", status: "failed" });
    await say(`pw-1: ${withdrawn.result}\n`, "permission-withdraw-1");

    // Phase 2: two requests open, the second withdrawn.
    await tool("pw-2", "Edit src/Kernel.php");
    await tool("pw-3", "Run vendor/bin/phpunit");
    const second = ask("pw-2");
    const third = new AbortController();
    const thirdResult = ask("pw-3", third.signal);
    await ctx.sleep(PERMISSION_WITHDRAW_HOLD_MS);
    if (!ctx.cancelled.aborted) third.abort();
    const [secondOutcome, thirdOutcome] = await Promise.all([second, thirdResult]);
    if (ctx.cancelled.aborted || secondOutcome.result === "cancelled") return { stopReason: "cancelled" };

    await ctx.send({
      sessionUpdate: "tool_call_update",
      toolCallId: "pw-2",
      status: secondOutcome.result === "selected" && secondOutcome.optionId === "allow-once" ? "completed" : "failed",
    });
    await ctx.send({ sessionUpdate: "tool_call_update", toolCallId: "pw-3", status: "failed" });
    await say(`pw-2: ${secondOutcome.result === "selected" ? secondOutcome.optionId : secondOutcome.result}, pw-3: ${thirdOutcome.result}\n`, "permission-withdraw-2");
    return { stopReason: "end_turn" };
  },
};
