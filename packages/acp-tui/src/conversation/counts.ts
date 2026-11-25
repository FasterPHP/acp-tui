// Counting items in one form (design focus-groups D3), shared by the focus lines, the turn-end
// line and the activity line: tool calls first with their states in brackets after them (failed,
// stopped, running, each only when not zero), then thoughts, plans and permissions as plain
// counts: `5 tool calls (1 failed, 1 stopped) · 1 thought · 1 plan · 2 permissions`.
import type { Item, ToolCallItem } from "acp-model";
import type { Segment } from "../layout/segments.ts";
import { isRenderable } from "./list.ts";
import { isRunningTool, isStoppedTool } from "./tool-state.ts";

export { isRunningTool, isStoppedTool };

export interface ItemCounts {
  readonly tools: number;
  readonly thoughts: number;
  readonly plans: number;
  readonly permissions: number;
  /** Of `tools`. */
  readonly failed: number;
  /** Of `tools`: final while pending or in progress (drawn `stop`). */
  readonly stopped: number;
  /** Of `tools`: live while pending or in progress. */
  readonly running: number;
}

export const EMPTY_COUNTS: ItemCounts = { tools: 0, thoughts: 0, plans: 0, permissions: 0, failed: 0, stopped: 0, running: 0 };

/** `counts` with one more item: a tool call, or a thought, plan or permission record that is
 *  renderable (a wordless thought, an empty plan and a pending permission count for nothing).
 *  Any other item leaves `counts` as it is (the same object). */
export function addCounts(counts: ItemCounts, item: Item): ItemCounts {
  switch (item.kind) {
    case "tool_call": {
      const tool = item as ToolCallItem;
      return {
        ...counts,
        tools: counts.tools + 1,
        failed: counts.failed + (tool.toolStatus === "failed" ? 1 : 0),
        stopped: counts.stopped + (isStoppedTool(tool) ? 1 : 0),
        running: counts.running + (isRunningTool(tool) ? 1 : 0),
      };
    }
    case "thought":
      return isRenderable(item) ? { ...counts, thoughts: counts.thoughts + 1 } : counts;
    case "plan":
      return isRenderable(item) ? { ...counts, plans: counts.plans + 1 } : counts;
    case "permission_record":
      return isRenderable(item) ? { ...counts, permissions: counts.permissions + 1 } : counts;
    default:
      return counts;
  }
}

export function countItems(items: Iterable<Item>): ItemCounts {
  let counts = EMPTY_COUNTS;
  for (const item of items) counts = addCounts(counts, item);
  return counts;
}

export interface CountOptions {
  /** The states shown in the brackets, in the order failed, stopped, running (default all). */
  readonly states?: readonly ("failed" | "stopped" | "running")[];
  /** The plain counts shown after the tool calls (default all). */
  readonly kinds?: readonly ("thoughts" | "plans" | "permissions")[];
  /** Between the parts (default ` · `). */
  readonly separator?: string;
}

const ALL_STATES = ["failed", "stopped", "running"] as const;
const ALL_KINDS = ["thoughts", "plans", "permissions"] as const;
const PLAIN: Record<(typeof ALL_KINDS)[number], [one: string, many: string]> = {
  thoughts: ["thought", "thoughts"],
  plans: ["plan", "plans"],
  permissions: ["permission", "permissions"],
};

/** The counts as segments (no duration; a gap line appends its own): `failed` in `tool.fail`,
 *  `running` in `tool.running`, the rest `muted`. Empty when there is nothing to count. */
export function countSegments(counts: ItemCounts, options: CountOptions = {}): Segment[] {
  const separator = options.separator ?? " · ";
  const states = options.states ?? ALL_STATES;
  const kinds = options.kinds ?? ALL_KINDS;
  const out: Segment[] = [];
  const part = (segments: Segment[]) => {
    if (out.length > 0) out.push({ text: separator, token: "muted" });
    out.push(...segments);
  };
  if (counts.tools > 0) {
    const segments: Segment[] = [{ text: `${counts.tools} ${counts.tools === 1 ? "tool call" : "tool calls"}`, token: "muted" }];
    const shown = ALL_STATES.filter((s) => states.includes(s) && counts[s] > 0);
    shown.forEach((state, i) => {
      segments.push({ text: i === 0 ? " (" : ", ", token: "muted" });
      segments.push({ text: `${counts[state]} ${state}`, token: state === "failed" ? "tool.fail" : state === "running" ? "tool.running" : "muted" });
    });
    if (shown.length > 0) segments.push({ text: ")", token: "muted" });
    part(segments);
  }
  for (const kind of ALL_KINDS) {
    const n = counts[kind];
    if (!kinds.includes(kind) || n === 0) continue;
    part([{ text: `${n} ${n === 1 ? PLAIN[kind][0] : PLAIN[kind][1]}`, token: "muted" }]);
  }
  return out;
}
