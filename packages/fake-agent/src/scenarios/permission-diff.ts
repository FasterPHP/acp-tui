// The "permission-diff" scenario (design D11, phase-1a task 1.5): an edit tool
// call with a 60-line diff, then a permission request tied to it offering all
// four option kinds, for spike S6's card preview scrolling and its
// three-on-a-row versus four-stacked option layout. The request carries the
// diff in its tool call content, as real agents do.
import type { PermissionOption, PromptResponse, ToolCallContent } from "@agentclientprotocol/sdk";
import type { Scenario, ScenarioContext } from "../scenario.ts";

export const PERMISSION_DIFF_TOOL_CALL_ID = "perm-diff";
export const PERMISSION_DIFF_PATH = "/work/src/Http/Router.php";

/** Unchanged lines above and below the change, and the lines removed and added between. */
const HEAD = 5;
const REMOVED = 15;
const ADDED = 30;
const TAIL = 10;

/** Lines in the diff as displayed: context, removals and additions. */
export const PERMISSION_DIFF_LINE_COUNT = HEAD + REMOVED + ADDED + TAIL;

const numbered = (prefix: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`);

export function permissionDiffFixture(): { oldText: string; newText: string } {
  const head = numbered("    unchanged head line", HEAD);
  const tail = numbered("    unchanged tail line", TAIL);
  const removed = numbered("    removed line", REMOVED);
  const added = numbered("    added line", ADDED);
  return {
    oldText: `${[...head, ...removed, ...tail].join("\n")}\n`,
    newText: `${[...head, ...added, ...tail].join("\n")}\n`,
  };
}

export const PERMISSION_DIFF_OPTIONS: PermissionOption[] = [
  { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
  { optionId: "allow-always", name: "Allow always", kind: "allow_always" },
  { optionId: "reject-once", name: "Reject once", kind: "reject_once" },
  { optionId: "reject-always", name: "Reject always", kind: "reject_always" },
];

export const permissionDiffScenario: Scenario = {
  name: "permission-diff",

  async prompt(ctx: ScenarioContext): Promise<PromptResponse> {
    const { oldText, newText } = permissionDiffFixture();
    const content: ToolCallContent[] = [{ type: "diff", path: PERMISSION_DIFF_PATH, oldText, newText }];

    await ctx.send({
      sessionUpdate: "tool_call",
      toolCallId: PERMISSION_DIFF_TOOL_CALL_ID,
      title: "Edit src/Http/Router.php",
      kind: "edit",
      status: "pending",
      content,
    });
    const response = await ctx.requestPermission({
      toolCall: {
        toolCallId: PERMISSION_DIFF_TOOL_CALL_ID,
        title: "Edit src/Http/Router.php",
        kind: "edit",
        content,
      },
      options: PERMISSION_DIFF_OPTIONS,
    });
    if (response.outcome.outcome === "cancelled" || ctx.cancelled.aborted) {
      return { stopReason: "cancelled" };
    }

    const allowed =
      response.outcome.outcome === "selected" && response.outcome.optionId.startsWith("allow");
    await ctx.send({
      sessionUpdate: "tool_call_update",
      toolCallId: PERMISSION_DIFF_TOOL_CALL_ID,
      status: allowed ? "completed" : "failed",
    });
    return { stopReason: "end_turn" };
  },
};
