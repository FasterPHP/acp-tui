// mvp-rendering task 1.3: tool-content sends four calls whose text content is Markdown, the way
// claude-agent-acp sends it: a 140-character command with fenced output, a fenced 60-line file,
// 5000 lines of fenced output and a refused call.
import { describe, expect, test } from "bun:test";
import type { SessionUpdate, ToolCallContent } from "@agentclientprotocol/sdk";
import {
  TOOL_CONTENT_BIG_OUTPUT_LINE_COUNT,
  TOOL_CONTENT_BIG_TITLE,
  TOOL_CONTENT_COMMAND,
  TOOL_CONTENT_IDS,
  TOOL_CONTENT_OUTPUT_LINES,
  TOOL_CONTENT_READ_LINE_COUNT,
  TOOL_CONTENT_READ_TITLE,
  TOOL_CONTENT_REFUSAL,
  TOOL_CONTENT_REFUSED_TITLE,
  toolContentTexts,
} from "../src/scenarios/tool-content.ts";
import { spawnFakeAgent } from "./helpers.ts";

function textOf(content: ToolCallContent[] | null | undefined): string {
  expect(content).toHaveLength(1);
  const block = content![0]!;
  if (block.type !== "content" || block.content.type !== "text") throw new Error("not a text block");
  return block.content.text;
}

/** The label and lines of a text block that is exactly one fence. */
function fenceBody(text: string): { label: string; lines: string[] } {
  const lines = text.split("\n");
  expect(lines[0]).toStartWith("```");
  expect(lines.at(-1)).toBe("```");
  return { label: lines[0]!.slice(3), lines: lines.slice(1, -1) };
}

describe("fake-agent tool-content scenario (mvp-rendering task 1.3)", () => {
  test("sends four calls, each started in progress and then finished with one text block", async () => {
    const updates: SessionUpdate[] = [];
    const handle = spawnFakeAgent({
      scenario: "tool-content",
      client: {
        async sessionUpdate(params) {
          updates.push(params.update);
        },
        async requestPermission() {
          throw new Error("tool-content does not request permission");
        },
      },
    });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: "/tmp", mcpServers: [] });
      const result = await handle.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "go" }] });
      expect(result.stopReason).toBe("end_turn");

      const steps = updates.map((u) =>
        u.sessionUpdate === "tool_call" || u.sessionUpdate === "tool_call_update"
          ? `${u.sessionUpdate} ${u.toolCallId} ${u.status}`
          : u.sessionUpdate,
      );
      expect(steps).toEqual([
        `tool_call ${TOOL_CONTENT_IDS.command} in_progress`,
        `tool_call_update ${TOOL_CONTENT_IDS.command} completed`,
        `tool_call ${TOOL_CONTENT_IDS.read} in_progress`,
        `tool_call_update ${TOOL_CONTENT_IDS.read} completed`,
        `tool_call ${TOOL_CONTENT_IDS.big} in_progress`,
        `tool_call_update ${TOOL_CONTENT_IDS.big} completed`,
        `tool_call ${TOOL_CONTENT_IDS.refused} in_progress`,
        `tool_call_update ${TOOL_CONTENT_IDS.refused} failed`,
      ]);

      const started = new Map<string, { title: string; kind: string | undefined }>();
      const finished = new Map<string, string>();
      for (const update of updates) {
        if (update.sessionUpdate === "tool_call") {
          started.set(update.toolCallId, { title: update.title, kind: update.kind });
        } else if (update.sessionUpdate === "tool_call_update") {
          finished.set(update.toolCallId, textOf(update.content));
        }
      }

      // 1. A 140-character command, five lines of console output.
      expect(TOOL_CONTENT_COMMAND).toHaveLength(140);
      expect(started.get(TOOL_CONTENT_IDS.command)).toEqual({ title: TOOL_CONTENT_COMMAND, kind: "execute" });
      const command = fenceBody(finished.get(TOOL_CONTENT_IDS.command)!);
      expect(command.label).toBe("console");
      expect(command.lines).toEqual([...TOOL_CONTENT_OUTPUT_LINES]);
      expect(command.lines).toHaveLength(5);

      // 2. A read whose content is a fenced 60-line file.
      expect(started.get(TOOL_CONTENT_IDS.read)).toEqual({ title: TOOL_CONTENT_READ_TITLE, kind: "read" });
      const read = fenceBody(finished.get(TOOL_CONTENT_IDS.read)!);
      expect(read.label).toBe("php");
      expect(read.lines).toHaveLength(TOOL_CONTENT_READ_LINE_COUNT);
      expect(read.lines[0]).toBe("<?php");
      expect(read.lines.at(-1)).toBe("}");

      // 3. An execute with 5000 output lines.
      expect(started.get(TOOL_CONTENT_IDS.big)).toEqual({ title: TOOL_CONTENT_BIG_TITLE, kind: "execute" });
      const big = fenceBody(finished.get(TOOL_CONTENT_IDS.big)!);
      expect(big.label).toBe("console");
      expect(big.lines).toHaveLength(TOOL_CONTENT_BIG_OUTPUT_LINE_COUNT);
      expect(big.lines[4999]).toBe("test 5000 ... ok");

      // 4. A refused call: failed, the agent's message inside a bare fence.
      expect(started.get(TOOL_CONTENT_IDS.refused)).toEqual({ title: TOOL_CONTENT_REFUSED_TITLE, kind: "edit" });
      expect(fenceBody(finished.get(TOOL_CONTENT_IDS.refused)!)).toEqual({ label: "", lines: [TOOL_CONTENT_REFUSAL] });
      expect(TOOL_CONTENT_REFUSAL).toBe("User refused permission to run tool");

      // What was sent is what the package exports.
      for (const [id, text] of Object.entries(toolContentTexts())) expect(finished.get(id)).toBe(text);
    } finally {
      handle.stop();
    }
  });
});
