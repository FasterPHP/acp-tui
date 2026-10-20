// SPIKE (phase-1a, S4 and S5): model item factories for the projection and
// find tests.
import type {
  AgentMessageItem,
  Item,
  MarkerItem,
  PermissionRecordItem,
  PlanItem,
  ThoughtItem,
  ToolCallItem,
  UserMessageItem,
} from "acp-model";

const base = { status: "final", origin: "self" } as const;

export const user = (id: string, text: string): UserMessageItem => ({ ...base, id, kind: "user_message", text });
export const agent = (id: string, text: string): AgentMessageItem => ({ ...base, id, kind: "agent_message", text });
export const thought = (id: string, text: string): ThoughtItem => ({ ...base, id, kind: "thought", text });

export function tool(id: string, overrides: Partial<ToolCallItem> = {}): ToolCallItem {
  return {
    ...base,
    id,
    kind: "tool_call",
    toolCallId: id.replace(/^tool:/, ""),
    index: 1,
    title: "Run the tests",
    toolName: null,
    toolKind: "execute",
    toolStatus: "completed",
    content: [],
    locations: [],
    rawOutputText: null,
    startedAt: 0,
    endedAt: 10,
    ...overrides,
  };
}

export const plan = (id: string, entries: PlanItem["entries"]): PlanItem => ({ ...base, id, kind: "plan", entries });

export function permission(id: string, overrides: Partial<PermissionRecordItem> = {}): PermissionRecordItem {
  return {
    ...base,
    id,
    kind: "permission_record",
    toolCallId: "t1",
    title: "Edit src/x.ts",
    options: [],
    outcome: { type: "answered", optionId: "a", optionKind: "allow_once" },
    ...overrides,
  };
}

export const turnEnd = (id: string): MarkerItem => ({
  id,
  status: "final",
  origin: "self",
  kind: "marker",
  markerKind: "turn_end",
  stopReason: "end_turn",
  durationMs: 1200,
  usage: null,
});

export const marker = (id: string, markerKind: "error" | "notice", text: string): MarkerItem => ({
  id,
  status: "final",
  origin: "self",
  kind: "marker",
  markerKind,
  text,
});

/** An order and a lookup over `items`. */
export function conversation(...items: Item[]): { order: string[]; lookup: (id: string) => Item | undefined } {
  const map = new Map(items.map((item) => [item.id, item]));
  return { order: items.map((item) => item.id), lookup: (id) => map.get(id) };
}
