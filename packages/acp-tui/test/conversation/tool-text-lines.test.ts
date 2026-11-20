// A tool's plain text keeps its lines: output such as `seq 1 3` is "1\n2\n3\n", and a single newline
// is a line break there, not the soft break of prose (Markdown would join the lines as `1 2 3`).
import { describe, expect, test } from "bun:test";
import { toolCardLayout } from "../../src/conversation/card.ts";
import { DEFAULT_GLYPHS } from "../../src/conversation/glyphs.ts";
import { rowText } from "../../src/conversation/markdown/types.ts";
import { itemsOf, runUpdates } from "../selection/fixtures.ts";
import type { ToolCallItem } from "acp-model";
import type { SessionUpdate } from "@agentclientprotocol/sdk";

function call(kind: "execute" | "read", text: string): ToolCallItem {
  const updates: SessionUpdate[] = [
    { sessionUpdate: "tool_call", toolCallId: "t", title: "run", kind, status: "in_progress" },
    { sessionUpdate: "tool_call_update", toolCallId: "t", status: "completed", content: [{ type: "content", content: { type: "text", text } }] } as SessionUpdate,
  ];
  const item = itemsOf(runUpdates(updates, "go")).find((i) => i.kind === "tool_call");
  if (item?.kind !== "tool_call") throw new Error("no tool call");
  return item;
}

const rows = (item: ToolCallItem) => toolCardLayout(item, 60, true, DEFAULT_GLYPHS, false).rows.map(rowText).map((r) => r.trim());

describe("tool text keeps its lines", () => {
  test("multi-line output is one row per line", () => {
    const out = rows(call("execute", "1\n2\n3\n"));
    expect(out).toContain("1");
    expect(out).toContain("2");
    expect(out).toContain("3");
    expect(out.join("\n")).not.toContain("1 2 3");
  });

  test("a paragraph break still separates blocks", () => {
    const out = rows(call("read", "alpha\nbeta\n\ngamma"));
    expect(out).toEqual(expect.arrayContaining(["alpha", "beta", "gamma"]));
  });
});
