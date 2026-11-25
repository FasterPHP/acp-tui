// The two states of a tool call that is neither done nor failed, in one place so the status
// glyph (format.ts) and the counts (counts.ts) agree on which call is which.
import type { ToolCallItem } from "acp-model";

const UNFINISHED = new Set<string>(["pending", "in_progress"]);

/** A call the agent is still working on: live, and pending or in progress. */
export function isRunningTool(tool: ToolCallItem): boolean {
  return tool.status === "live" && UNFINISHED.has(tool.toolStatus);
}

/** A call a turn ended on while it was pending or in progress: final, never completed or failed.
 *  Drawn `stop`. */
export function isStoppedTool(tool: ToolCallItem): boolean {
  return tool.status !== "live" && UNFINISHED.has(tool.toolStatus);
}
