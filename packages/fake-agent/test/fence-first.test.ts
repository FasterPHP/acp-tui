// mvp-rendering task 1.2: fence-first sends one message that opens with a `php` fence holding a
// file with `<?php`, then a second `php` fence without the tag, in 7-character chunks.
import { describe, expect, test } from "bun:test";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import {
  FENCE_FIRST_CHUNK_SIZE,
  FENCE_FIRST_MESSAGE_ID,
  FENCE_FIRST_TEXT,
  fenceFirstChunks,
} from "../src/scenarios/fence-first.ts";
import { spawnFakeAgent } from "./helpers.ts";

describe("fake-agent fence-first scenario (mvp-rendering task 1.2)", () => {
  test("the fixture opens with a php fence holding <?php, then a php fence without the tag", () => {
    expect(FENCE_FIRST_TEXT.startsWith("```php\n<?php\n")).toBe(true);
    const fences = FENCE_FIRST_TEXT.split("\n").filter((line) => line.startsWith("```"));
    expect(fences).toEqual(["```php", "```", "```php", "```"]);
    const second = FENCE_FIRST_TEXT.slice(FENCE_FIRST_TEXT.lastIndexOf("```php"));
    expect(second).not.toContain("<?php");
    expect(FENCE_FIRST_TEXT).toMatch(/^[\x20-\x7e\n]*$/);
  });

  test("the joined chunks equal the fixture, in 7-character chunks under one message id", async () => {
    const updates: SessionUpdate[] = [];
    const handle = spawnFakeAgent({
      scenario: "fence-first",
      client: {
        async sessionUpdate(params) {
          updates.push(params.update);
        },
        async requestPermission() {
          throw new Error("fence-first does not request permission");
        },
      },
    });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: "/tmp", mcpServers: [] });
      const result = await handle.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "go" }] });
      expect(result.stopReason).toBe("end_turn");

      const texts = updates.map((update) => {
        if (update.sessionUpdate !== "agent_message_chunk" || update.content.type !== "text") throw new Error("not a text chunk");
        expect(update.messageId).toBe(FENCE_FIRST_MESSAGE_ID);
        return update.content.text;
      });
      expect(texts.join("")).toBe(FENCE_FIRST_TEXT);
      expect(texts).toEqual(fenceFirstChunks());
      for (const text of texts.slice(0, -1)) expect(text).toHaveLength(FENCE_FIRST_CHUNK_SIZE);
      expect(texts.at(-1)!.length).toBeLessThanOrEqual(FENCE_FIRST_CHUNK_SIZE);
      expect(texts[0]).toBe("```php\n");
    } finally {
      handle.stop();
    }
  });

  test("--chunk 64: the same text in 64-character chunks", async () => {
    const updates: SessionUpdate[] = [];
    const handle = spawnFakeAgent({
      scenario: "fence-first",
      args: ["--chunk", "64"],
      client: {
        async sessionUpdate(params) {
          updates.push(params.update);
        },
        async requestPermission() {
          throw new Error("fence-first does not request permission");
        },
      },
    });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: "/tmp", mcpServers: [] });
      await handle.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "go" }] });
      const texts = updates.map((update) => (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text" ? update.content.text : ""));
      expect(texts).toEqual(fenceFirstChunks(64));
      expect(texts.join("")).toBe(FENCE_FIRST_TEXT);
      for (const text of texts.slice(0, -1)) expect(text).toHaveLength(64);
    } finally {
      handle.stop();
    }
  });
});
