// Phase-1a task 1.5: permission-diff requests permission for an edit with a
// 60-line diff and the four option kinds, in a fixed order.
import { describe, expect, test } from "bun:test";
import type { RequestPermissionRequest, ToolCallContent } from "@agentclientprotocol/sdk";
import { PERMISSION_DIFF_LINE_COUNT } from "../src/scenarios/permission-diff.ts";
import { spawnFakeAgent } from "./helpers.ts";

/** Lines shown by a line diff: shared head and tail once, plus removals and additions. */
function displayedDiffLines(oldText: string, newText: string): number {
  const oldLines = oldText.replace(/\n$/, "").split("\n");
  const newLines = newText.replace(/\n$/, "").split("\n");
  let head = 0;
  while (head < oldLines.length && oldLines[head] === newLines[head]) head += 1;
  let tail = 0;
  while (
    tail < oldLines.length - head &&
    tail < newLines.length - head &&
    oldLines.at(-1 - tail) === newLines.at(-1 - tail)
  ) {
    tail += 1;
  }
  return head + (oldLines.length - head - tail) + (newLines.length - head - tail) + tail;
}

describe("fake-agent permission-diff scenario (phase-1a task 1.5)", () => {
  test("asks for permission with four options in order and a 60-line diff", async () => {
    const requests: RequestPermissionRequest[] = [];
    const handle = spawnFakeAgent({
      scenario: "permission-diff",
      client: {
        async sessionUpdate() {},
        async requestPermission(params) {
          requests.push(params);
          return { outcome: { outcome: "selected", optionId: "allow-once" } };
        },
      },
    });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: "/tmp", mcpServers: [] });
      const result = await handle.conn.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "edit the router" }],
      });
      expect(result.stopReason).toBe("end_turn");

      expect(requests).toHaveLength(1);
      const request = requests[0] as RequestPermissionRequest;
      expect(request.options.map((option) => option.kind)).toEqual([
        "allow_once",
        "allow_always",
        "reject_once",
        "reject_always",
      ]);
      expect(request.toolCall.kind).toBe("edit");

      const content = request.toolCall.content as ToolCallContent[];
      const diff = content.find((entry) => entry.type === "diff");
      if (diff?.type !== "diff") throw new Error("the request carries no diff");
      expect(PERMISSION_DIFF_LINE_COUNT).toBe(60);
      expect(displayedDiffLines(diff.oldText ?? "", diff.newText)).toBe(60);
    } finally {
      handle.stop();
    }
  });

  test("a rejection fails the tool call", async () => {
    const statuses: (string | null | undefined)[] = [];
    const handle = spawnFakeAgent({
      scenario: "permission-diff",
      client: {
        async sessionUpdate(params) {
          if (params.update.sessionUpdate === "tool_call_update") statuses.push(params.update.status);
        },
        async requestPermission() {
          return { outcome: { outcome: "selected", optionId: "reject-once" } };
        },
      },
    });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: "/tmp", mcpServers: [] });
      const result = await handle.conn.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "edit the router" }],
      });
      expect(result.stopReason).toBe("end_turn");
      expect(statuses).toEqual(["failed"]);
    } finally {
      handle.stop();
    }
  });
});
