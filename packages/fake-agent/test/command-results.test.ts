// day-one-feedback task 2.1: command-results sends the shapes in which agents report a shell
// command's result: Auggie 0.36.0's failure (a bare fence around its envelope, and rawOutput),
// its success (rawOutput only), claude-agent-acp's failure and success, and two near misses.
import { describe, expect, test } from "bun:test";
import type { SessionUpdate, ToolCallContent } from "@agentclientprotocol/sdk";
import {
  auggieEnvelope,
  COMMAND_RESULTS_AUGGIE_FAILURE_ENVELOPE,
  COMMAND_RESULTS_AUGGIE_FAILURE_OUTPUT,
  COMMAND_RESULTS_AUGGIE_SUCCESS_ENVELOPE,
  COMMAND_RESULTS_AUGGIE_SUCCESS_OUTPUT,
  COMMAND_RESULTS_CLAUDE_FAILURE_BODY,
  COMMAND_RESULTS_CLAUDE_SUCCESS_LINES,
  COMMAND_RESULTS_ENVELOPE_HEAD,
  COMMAND_RESULTS_IDS,
  COMMAND_RESULTS_NEAR_MISS_ENVELOPE,
  COMMAND_RESULTS_NEAR_MISS_READ_BODY,
  COMMAND_RESULTS_TITLES,
  commandResultsRawOutputs,
  commandResultsTexts,
} from "../src/scenarios/command-results.ts";
import { spawnFakeAgent } from "./helpers.ts";

function textOf(content: ToolCallContent[] | null | undefined): string {
  expect(content).toHaveLength(1);
  const block = content![0]!;
  if (block.type !== "content" || block.content.type !== "text") throw new Error("not a text block");
  return block.content.text;
}

describe("fake-agent command-results scenario (day-one-feedback task 2.1)", () => {
  test("the envelope is Auggie 0.36.0's, byte for byte", () => {
    expect(COMMAND_RESULTS_AUGGIE_FAILURE_ENVELOPE).toBe(
      "Here are the results from executing the command.\n<return-code>\n127\n</return-code>\n<output>\nsh: model-selection: command not found\n\n</output>",
    );
    expect(auggieEnvelope(0, "ok\n")).toBe(`${COMMAND_RESULTS_ENVELOPE_HEAD}\n<return-code>\n0\n</return-code>\n<output>\nok\n\n</output>`);
    expect(COMMAND_RESULTS_AUGGIE_SUCCESS_OUTPUT.trimEnd().split("\n")).toHaveLength(3);
  });

  test("sends six calls in order, with the content and rawOutput of each", async () => {
    const updates: SessionUpdate[] = [];
    const handle = spawnFakeAgent({
      scenario: "command-results",
      client: {
        async sessionUpdate(params) {
          updates.push(params.update);
        },
        async requestPermission() {
          throw new Error("command-results does not request permission");
        },
      },
    });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: "/tmp", mcpServers: [] });
      const result = await handle.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "go" }] });
      expect(result.stopReason).toBe("end_turn");

      const ids = COMMAND_RESULTS_IDS;
      const order: readonly [string, "execute" | "read", "completed" | "failed"][] = [
        [ids.auggieFailure, "execute", "failed"],
        [ids.auggieSuccess, "execute", "completed"],
        [ids.claudeFailure, "execute", "failed"],
        [ids.claudeSuccess, "execute", "completed"],
        [ids.nearMissEnvelope, "execute", "completed"],
        [ids.nearMissRead, "read", "failed"],
      ];
      expect(
        updates.map((u) =>
          u.sessionUpdate === "tool_call" || u.sessionUpdate === "tool_call_update"
            ? `${u.sessionUpdate} ${u.toolCallId} ${u.status}`
            : u.sessionUpdate,
        ),
      ).toEqual(order.flatMap(([id, , status]) => [`tool_call ${id} in_progress`, `tool_call_update ${id} ${status}`]));

      const titles = Object.values(COMMAND_RESULTS_TITLES);
      const started = updates.filter((u) => u.sessionUpdate === "tool_call");
      expect(started.map((u) => u.title)).toEqual(titles);
      expect(started.map((u) => u.kind)).toEqual(order.map(([, kind]) => kind));

      const finished = new Map(
        updates.flatMap((u) => (u.sessionUpdate === "tool_call_update" ? [[u.toolCallId, u] as const] : [])),
      );
      const texts = commandResultsTexts();
      const rawOutputs = commandResultsRawOutputs();

      // 1. Auggie's failure: a bare fence around the envelope, and rawOutput with the same envelope.
      const failure = finished.get(ids.auggieFailure)!;
      expect(textOf(failure.content)).toBe(`\`\`\`\n${COMMAND_RESULTS_AUGGIE_FAILURE_ENVELOPE}\n\`\`\``);
      expect(failure.rawOutput).toEqual({ output: COMMAND_RESULTS_AUGGIE_FAILURE_ENVELOPE });
      expect(COMMAND_RESULTS_AUGGIE_FAILURE_OUTPUT).toBe("sh: model-selection: command not found\n");

      // 2. Auggie's success: no content, only rawOutput.
      const success = finished.get(ids.auggieSuccess)!;
      expect(success.content).toBeUndefined();
      expect(success.rawOutput).toEqual({ output: COMMAND_RESULTS_AUGGIE_SUCCESS_ENVELOPE });

      // 3. claude-agent-acp's failure: Exit code and the output in a bare fence, no rawOutput.
      const claudeFailure = finished.get(ids.claudeFailure)!;
      expect(textOf(claudeFailure.content)).toBe(`\`\`\`\n${COMMAND_RESULTS_CLAUDE_FAILURE_BODY}\n\`\`\``);
      expect(COMMAND_RESULTS_CLAUDE_FAILURE_BODY.split("\n")[0]).toBe("Exit code 127");
      expect(claudeFailure.rawOutput).toBeUndefined();

      // 4. Its success: a console fence, no exit code.
      const claudeSuccess = finished.get(ids.claudeSuccess)!;
      expect(textOf(claudeSuccess.content)).toBe(`\`\`\`console\n${COMMAND_RESULTS_CLAUDE_SUCCESS_LINES.join("\n")}\n\`\`\``);

      // 5. and 6. The near misses: one more line before the envelope; an Exit code fence on a read.
      expect(textOf(finished.get(ids.nearMissEnvelope)!.content)).toBe(`\`\`\`\n${COMMAND_RESULTS_NEAR_MISS_ENVELOPE}\n\`\`\``);
      expect(COMMAND_RESULTS_NEAR_MISS_ENVELOPE.endsWith(COMMAND_RESULTS_AUGGIE_FAILURE_ENVELOPE)).toBe(true);
      expect(COMMAND_RESULTS_NEAR_MISS_ENVELOPE.startsWith(COMMAND_RESULTS_ENVELOPE_HEAD)).toBe(false);
      expect(textOf(finished.get(ids.nearMissRead)!.content)).toBe(`\`\`\`\n${COMMAND_RESULTS_NEAR_MISS_READ_BODY}\n\`\`\``);
      expect(COMMAND_RESULTS_NEAR_MISS_READ_BODY.startsWith("Exit code 1\n")).toBe(true);

      // What was sent is what the package exports.
      for (const [id, text] of Object.entries(texts)) expect(textOf(finished.get(id)!.content)).toBe(text);
      for (const [id, rawOutput] of Object.entries(rawOutputs)) expect(finished.get(id)!.rawOutput).toEqual(rawOutput);
    } finally {
      handle.stop();
    }
  });
});
