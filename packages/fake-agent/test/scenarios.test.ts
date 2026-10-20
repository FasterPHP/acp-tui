// Exercises the remaining scenario knobs (task 4.2's "quick to add" list):
// five-tools, crash, prompt-error and big-output.
import { describe, expect, test } from "bun:test";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { CRASH_EXIT_CODE } from "../src/scenarios/crash.ts";
import { BIG_OUTPUT_LINE_COUNT } from "../src/scenarios/big-output.ts";
import { rejectionOf, spawnFakeAgent } from "./helpers.ts";

describe("fake-agent scenario knobs", () => {
  test("five-tools reports five tool calls in progress at once", async () => {
    const updates: SessionUpdate[] = [];
    const handle = spawnFakeAgent({
      scenario: "five-tools",
      client: {
        async sessionUpdate(params) {
          updates.push(params.update);
        },
        async requestPermission() {
          throw new Error("five-tools does not request permission");
        },
      },
    });

    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: "/tmp", mcpServers: [] });
      const result = await handle.conn.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "run checks" }],
      });

      expect(result.stopReason).toBe("end_turn");
      const starts = updates.filter((u) => u.sessionUpdate === "tool_call");
      const completions = updates.filter((u) => u.sessionUpdate === "tool_call_update");
      expect(starts).toHaveLength(5);
      expect(completions).toHaveLength(5);
      // All five starts happen before any completion.
      const lastStartIndex = updates.lastIndexOf(starts[4]!);
      const firstCompletionIndex = updates.indexOf(completions[0]!);
      expect(lastStartIndex).toBeLessThan(firstCompletionIndex);
    } finally {
      handle.stop();
    }
  });

  test("crash exits the process mid-turn with the documented code", async () => {
    const handle = spawnFakeAgent({
      scenario: "crash",
      client: {
        async sessionUpdate() {},
        async requestPermission() {
          throw new Error("crash does not request permission");
        },
      },
    });

    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: "/tmp", mcpServers: [] });

      expect(await rejectionOf(
        handle.conn.prompt({
          sessionId: session.sessionId,
          prompt: [{ type: "text", text: "go" }],
        }),
      )).toBeDefined();

      const exitCode = await handle.proc.exited;
      expect(exitCode).toBe(CRASH_EXIT_CODE);
    } finally {
      handle.stop();
    }
  });

  test("prompt-error answers session/prompt with a JSON-RPC error", async () => {
    const handle = spawnFakeAgent({
      scenario: "prompt-error",
      client: {
        async sessionUpdate() {},
        async requestPermission() {
          throw new Error("prompt-error does not request permission");
        },
      },
    });

    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: "/tmp", mcpServers: [] });

      let caught: unknown;
      try {
        await handle.conn.prompt({
          sessionId: session.sessionId,
          prompt: [{ type: "text", text: "go" }],
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(String((caught as Error).message)).toContain("Internal error");
    } finally {
      handle.stop();
    }
  });

  test("big-output emits a tool call with 5000 lines of content", async () => {
    const updates: SessionUpdate[] = [];
    const handle = spawnFakeAgent({
      scenario: "big-output",
      client: {
        async sessionUpdate(params) {
          updates.push(params.update);
        },
        async requestPermission() {
          throw new Error("big-output does not request permission");
        },
      },
    });

    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: "/tmp", mcpServers: [] });
      const result = await handle.conn.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "run suite" }],
      });

      expect(result.stopReason).toBe("end_turn");
      const toolCall = updates.find((u) => u.sessionUpdate === "tool_call");
      const content = toolCall?.sessionUpdate === "tool_call" ? toolCall.content?.[0] : undefined;
      const text = content?.type === "content" && content.content.type === "text" ? content.content.text : "";
      expect(text.split("\n").filter((line) => line.length > 0)).toHaveLength(BIG_OUTPUT_LINE_COUNT);
    } finally {
      handle.stop();
    }
  });
});
