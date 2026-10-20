// mvp-rendering tasks 6.3 and 6.4: links sends two agent messages, one with a single link and one
// with several allowed links, a refused `javascript:` link and a URL that wraps at 100 columns.
import { describe, expect, test } from "bun:test";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { LINKS_LONG_URL, LINKS_MANY_ID, LINKS_MANY_TEXT, LINKS_ONE_ID, LINKS_ONE_TEXT } from "../src/scenarios/links.ts";
import { spawnFakeAgent } from "./helpers.ts";

describe("fake-agent links scenario (mvp-rendering tasks 6.3 and 6.4)", () => {
  test("the fixtures: one link in the first message; several, a refused one and a long URL in the second", () => {
    expect(LINKS_ONE_TEXT.match(/\]\(/g)).toHaveLength(1);
    expect(LINKS_MANY_TEXT).toContain("](javascript:alert(1))");
    expect(LINKS_MANY_TEXT).toContain(LINKS_LONG_URL);
    expect(LINKS_LONG_URL.length).toBeGreaterThan(100);
  });

  test("sends the two messages whole, each under its own message id, and ends the turn", async () => {
    const updates: SessionUpdate[] = [];
    const handle = spawnFakeAgent({
      scenario: "links",
      client: {
        async sessionUpdate(params) {
          updates.push(params.update);
        },
        async requestPermission() {
          throw new Error("links does not request permission");
        },
      },
    });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: "/tmp", mcpServers: [] });
      const result = await handle.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "go" }] });
      expect(result.stopReason).toBe("end_turn");
      const sent = updates.map((update) => {
        if (update.sessionUpdate !== "agent_message_chunk" || update.content.type !== "text") throw new Error("not a text chunk");
        return [update.messageId, update.content.text];
      });
      expect(sent).toEqual([
        [LINKS_ONE_ID, LINKS_ONE_TEXT],
        [LINKS_MANY_ID, LINKS_MANY_TEXT],
      ]);
    } finally {
      handle.stop();
    }
  });
});
