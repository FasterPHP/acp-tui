// Unit tests for the conversation's view model and list (phase-1a tasks 7.1,
// 7.3 and 7.4; spec tui-conversation "Collapse and expand in place",
// "Conversation cursor"): collapse defaults and the user's toggle, the cursor
// moving by item, and the rows shown and mounted.
import { describe, expect, test } from "bun:test";
import type { Item, ToolCallItem } from "acp-model";
import { listRows } from "../../src/conversation/list.ts";
import { collapsible, createConversationViewModel, expandedByDefault, moveCursor } from "../../src/conversation/view-model.ts";

function tool(overrides: Partial<ToolCallItem> = {}): ToolCallItem {
  return {
    id: "tool:t",
    status: "final",
    origin: "self",
    kind: "tool_call",
    toolCallId: "t",
    index: 1,
    title: "Run",
    toolName: null,
    toolKind: "execute",
    toolStatus: "completed",
    content: [],
    locations: [],
    rawOutputText: null,
    startedAt: null,
    endedAt: null,
    ...overrides,
  };
}

const message = (id: string, kind: "user_message" | "agent_message", text = "hi"): Item => ({ id, status: "final", origin: "self", kind, text });

describe("collapse state", () => {
  test("tool calls, thoughts and plans collapse; messages and markers do not", () => {
    expect(collapsible(tool())).toBe(true);
    expect(collapsible({ id: "th", status: "final", origin: "self", kind: "thought", text: "x" })).toBe(true);
    expect(collapsible({ id: "p", status: "final", origin: "self", kind: "plan", entries: [] })).toBe(true);
    expect(collapsible(message("m", "agent_message"))).toBe(false);
  });

  test("no item expands itself, a failed tool call included; the user's toggle wins before and after it fails (Failure stays collapsed, the user's expansion wins)", () => {
    const vm = createConversationViewModel();
    const running = tool({ status: "live", toolStatus: "in_progress" });
    expect(vm.expanded(running)).toBe(false);
    const failed = tool({ toolStatus: "failed" });
    expect(expandedByDefault(failed)).toBe(false);
    expect(vm.expanded(failed)).toBe(false);
    expect(vm.toggle(failed)).toBe(true);
    expect(vm.expanded(failed)).toBe(true);
    expect(vm.toggled(failed.id)).toBe(true);
    // Toggled open while running, it stays open when it fails, and collapsed stays collapsed.
    const other = createConversationViewModel();
    other.toggle(running);
    expect(other.expanded(failed)).toBe(true);
    other.toggle(failed);
    expect(other.expanded(tool({ toolStatus: "failed" }))).toBe(false);
  });

  test("Collapse restores the snippet: collapsing a card returns its output to the snippet; expanding keeps the choice (review C19)", () => {
    const vm = createConversationViewModel();
    const item = tool();
    vm.toggle(item);
    vm.setOutputShown(item.id, true);
    expect(vm.outputShown(item.id)).toBe(true);
    vm.toggle(item);
    expect(vm.expanded(item)).toBe(false);
    expect(vm.outputShown(item.id)).toBe(false);
    vm.toggle(item);
    expect(vm.outputShown(item.id)).toBe(false);
    // The same through setExpanded (the conversation's toggles, a density's default); expanding
    // never clears it.
    vm.setOutputShown(item.id, true);
    vm.setExpanded(item, true);
    expect(vm.outputShown(item.id)).toBe(true);
    vm.setExpanded(item, false);
    expect(vm.outputShown(item.id)).toBe(false);
  });

  test("toggling something that cannot collapse changes nothing", () => {
    const vm = createConversationViewModel();
    expect(vm.toggle(message("m", "agent_message"))).toBe(false);
    expect(vm.toggled("m")).toBe(false);
  });
});

describe("cursor", () => {
  test("starts on the last item, moves by item and stops at the ends", () => {
    const ids = ["a", "b", "c"];
    expect(moveCursor(ids, null, -1)).toBe("c");
    expect(moveCursor(ids, "c", -1)).toBe("b");
    expect(moveCursor(ids, "a", -1)).toBe("a");
    expect(moveCursor(ids, "b", 5)).toBe("c");
    expect(moveCursor(ids, "gone", 1)).toBe("c");
    expect(moveCursor([], null, 1)).toBeNull();
  });

  test("the view model keeps the cursor between visits", () => {
    const vm = createConversationViewModel();
    expect(vm.cursor()).toBeNull();
    vm.setCursor("b");
    expect(vm.cursor()).toBe("b");
  });
});

describe("list rows", () => {
  test("shown items in model order with spacing; pending permissions hidden; every shown item mounted", () => {
    const items: Record<string, Item> = {
      u: message("u", "user_message"),
      m: message("m", "agent_message"),
      e: message("e", "agent_message", "  "),
      t1: tool({ id: "t1" }),
      t2: tool({ id: "t2" }),
      p: { id: "p", status: "live", origin: "self", kind: "permission_record", toolCallId: "t2", title: "x", options: [], outcome: { type: "pending" } },
    };
    const rows = listRows(["u", "m", "e", "t1", "t2", "p"], items);
    expect(rows.ids).toEqual(["u", "m", "t1", "t2"]);
    expect([...rows.margins.values()]).toEqual([0, 1, 1, 0]);
  });
});
