// Phase-1a task 1.2: stream-long sends one 3000-line Markdown answer in
// 20-character chunks at a fixed rate, and stops on session/cancel.
import { describe, expect, test } from "bun:test";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import {
  STREAM_LONG_CHUNK_SIZE,
  STREAM_LONG_LINE_COUNT,
  STREAM_LONG_TEXT,
  streamLongChunks,
} from "../src/scenarios/stream-long.ts";
import { spawnFakeAgent, type FakeAgentHandle } from "./helpers.ts";

function chunkTexts(updates: readonly SessionUpdate[]): string[] {
  return updates.flatMap((update) =>
    update.sessionUpdate === "agent_message_chunk" && update.content.type === "text"
      ? [update.content.text]
      : [],
  );
}

describe("fake-agent stream-long scenario (phase-1a task 1.2)", () => {
  test("the fixture is 3000 lines of Markdown", () => {
    expect(STREAM_LONG_TEXT.split("\n").length - 1).toBe(STREAM_LONG_LINE_COUNT);
    expect(STREAM_LONG_TEXT).toContain("```php");
    expect(STREAM_LONG_TEXT).toContain("| --- | --- | --- |");
    // Every fence is closed.
    expect(STREAM_LONG_TEXT.split("\n").filter((line) => line.startsWith("```")).length % 2).toBe(0);
  });

  test("concatenating the chunks gives the fixture, in 20-character chunks under one message id", async () => {
    const updates: SessionUpdate[] = [];
    const handle = spawnFakeAgent({
      scenario: "stream-long",
      client: {
        async sessionUpdate(params) {
          updates.push(params.update);
        },
        async requestPermission() {
          throw new Error("stream-long does not request permission");
        },
      },
    });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: "/tmp", mcpServers: [] });
      const result = await handle.conn.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "stream it" }],
      });
      expect(result.stopReason).toBe("end_turn");

      const chunks = chunkTexts(updates);
      expect(chunks.join("")).toBe(STREAM_LONG_TEXT);
      expect(chunks).toEqual(streamLongChunks());
      for (const chunk of chunks.slice(0, -1)) {
        expect(chunk).toHaveLength(STREAM_LONG_CHUNK_SIZE);
      }
      const ids = new Set(updates.map((u) => (u.sessionUpdate === "agent_message_chunk" ? u.messageId : null)));
      expect(ids.size).toBe(1);
    } finally {
      handle.stop();
    }
  }, 60000);

  test("honours session/cancel: stops streaming and answers cancelled", async () => {
    const updates: SessionUpdate[] = [];
    const total = streamLongChunks().length;
    let handle: FakeAgentHandle | undefined;
    let sessionId = "";
    let cancelSent = false;
    handle = spawnFakeAgent({
      scenario: "stream-long",
      // A real 10 ms per chunk, so the turn is still running when the cancel lands.
      delayScale: 1,
      client: {
        async sessionUpdate(params) {
          updates.push(params.update);
          if (updates.length === 5 && !cancelSent) {
            cancelSent = true;
            void handle?.conn.cancel({ sessionId });
          }
        },
        async requestPermission() {
          throw new Error("stream-long does not request permission");
        },
      },
    });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: "/tmp", mcpServers: [] });
      sessionId = session.sessionId;
      const result = await handle.conn.prompt({
        sessionId,
        prompt: [{ type: "text", text: "stream it" }],
      });
      expect(result.stopReason).toBe("cancelled");
      const received = chunkTexts(updates).length;
      expect(received).toBeGreaterThanOrEqual(5);
      expect(received).toBeLessThan(total / 10);
      // Nothing more arrives after the turn has been answered.
      await Bun.sleep(100);
      expect(chunkTexts(updates)).toHaveLength(received);
    } finally {
      handle.stop();
    }
  }, 30000);
});
