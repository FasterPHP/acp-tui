// The "tail-window" scenario: one `execute` call that streams a moving tail of growing output, as
// Auggie 1.x does (the last lines that fit a byte budget, no `rawOutput`). Lines differ in length,
// so as the window slides its line count falls as well as rises and its first line changes.
//
//   `tw-1`, in progress, `TAIL_WINDOW_UPDATES` updates 20 ms apart (scaled by --delay-scale); update
//   `n` holds the last lines of output lines 1 to `n` that fit `TAIL_WINDOW_BYTES` bytes. The call
//   then stays in progress until `session/cancel` (which ends the turn `cancelled`).
//
// Before each update goes out the log (--log) holds a `tail-window/sent` entry (`{ update, lines,
// first }`: the window's line count and its first line's number).
import type { PromptResponse } from "@agentclientprotocol/sdk";
import type { Scenario, ScenarioContext } from "../scenario.ts";

export const TAIL_WINDOW_UPDATES = 60;
/** The window's size in bytes (lines and their newlines). */
export const TAIL_WINDOW_BYTES = 1500;
export const TAIL_WINDOW_UPDATE_MS = 20;

/** Output line `n` (1 based): its number and a filler whose length varies from 0 to 89 characters. */
export function tailWindowLine(n: number): string {
  return `out ${String(n).padStart(3, "0")} ${"x".repeat((n * 37) % 90)}`;
}

/** The window after output line `n`: the last whole lines that fit the budget (at least one). */
export function tailWindow(n: number): { readonly first: number; readonly lines: readonly string[] } {
  const lines: string[] = [];
  let bytes = 0;
  let first = n;
  for (let i = n; i >= 1; i--) {
    const line = tailWindowLine(i);
    if (lines.length > 0 && bytes + line.length + 1 > TAIL_WINDOW_BYTES) break;
    lines.unshift(line);
    bytes += line.length + 1;
    first = i;
  }
  return { first, lines };
}

export const tailWindowScenario: Scenario = {
  name: "tail-window",

  async prompt(ctx: ScenarioContext): Promise<PromptResponse> {
    const cancelled: PromptResponse = { stopReason: "cancelled" };
    ctx.log("tail-window/sent", { update: 0, lines: 0, first: 0 });
    await ctx.send({ sessionUpdate: "tool_call", toolCallId: "tw-1", title: "Run the long suite", kind: "execute", status: "in_progress" });
    for (let n = 1; n <= TAIL_WINDOW_UPDATES; n++) {
      if (ctx.cancelled.aborted) return cancelled;
      const { first, lines } = tailWindow(n);
      ctx.log("tail-window/sent", { update: n, lines: lines.length, first });
      await ctx.send({
        sessionUpdate: "tool_call_update",
        toolCallId: "tw-1",
        status: "in_progress",
        content: [{ type: "content", content: { type: "text", text: lines.join("\n") } }],
      });
      await ctx.sleep(TAIL_WINDOW_UPDATE_MS);
    }
    // Hold the call open until the turn is cancelled.
    if (!ctx.cancelled.aborted) await new Promise<void>((resolve) => ctx.cancelled.addEventListener("abort", () => resolve(), { once: true }));
    return cancelled;
  },
};
