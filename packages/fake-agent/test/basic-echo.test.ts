// mvp-chrome-and-keys task 2.4: `basic` echoes the content block types of a prompt that is not a
// single text block (`text`, `resource_link <uri>`), because the fake-agent log keeps only the
// block count. A plain prompt gets the reply it always did.
import { describe, expect, test } from "bun:test";
import type { ContentBlock, SessionUpdate } from "@agentclientprotocol/sdk";
import { describePromptBlocks } from "../src/scenarios/basic.ts";
import { spawnFakeAgent } from "./helpers.ts";

async function reply(prompt: ContentBlock[]): Promise<SessionUpdate[]> {
  const updates: SessionUpdate[] = [];
  const handle = spawnFakeAgent({
    scenario: "basic",
    client: {
      async sessionUpdate(params) {
        updates.push(params.update);
      },
      async requestPermission(params) {
        return { outcome: { outcome: "selected", optionId: params.options[0]!.optionId } };
      },
    },
  });
  try {
    await handle.conn.initialize({ protocolVersion: 1 });
    const session = await handle.conn.newSession({ cwd: "/tmp", mcpServers: [] });
    await handle.conn.prompt({ sessionId: session.sessionId, prompt });
  } finally {
    handle.stop();
  }
  return updates;
}

const echoOf = (updates: readonly SessionUpdate[]): string | undefined => {
  const first = updates[0];
  return first?.sessionUpdate === "agent_message_chunk" && first.messageId === "prompt-echo" && first.content.type === "text"
    ? first.content.text
    : undefined;
};

describe("fake-agent basic echoes the prompt's content block types (task 2.4)", () => {
  test("a text block and a resource_link are echoed first, with the link's URI", async () => {
    const updates = await reply([
      { type: "text", text: "look at this" },
      { type: "resource_link", name: "Router.php", uri: "file:///work/repo/src/Router.php" },
    ]);
    expect(echoOf(updates)).toBe("Prompt blocks: text, resource_link file:///work/repo/src/Router.php\n\n");
  });

  test("two links after the text are echoed in order", async () => {
    const updates = await reply([
      { type: "text", text: "compare" },
      { type: "resource_link", name: "a", uri: "file:///a.php" },
      { type: "resource_link", name: "b", uri: "file:///b.php" },
    ]);
    expect(echoOf(updates)).toBe("Prompt blocks: text, resource_link file:///a.php, resource_link file:///b.php\n\n");
  });

  test("a plain prompt (one text block) gets no echo and the usual update sequence", async () => {
    const updates = await reply([{ type: "text", text: "hello" }]);
    expect(echoOf(updates)).toBeUndefined();
    expect(updates.map((update) => update.sessionUpdate).slice(0, 3)).toEqual([
      "agent_message_chunk",
      "agent_message_chunk",
      "agent_message_chunk",
    ]);
    expect(updates.filter((update) => update.sessionUpdate === "agent_message_chunk")).toHaveLength(6);
  });

  test("describePromptBlocks names other block types and embedded resources", () => {
    expect(
      describePromptBlocks([
        { type: "text", text: "x" },
        { type: "image", data: "", mimeType: "image/png" },
        { type: "resource", resource: { uri: "file:///c.php", text: "<?php" } },
      ]),
    ).toBe("text, image, resource file:///c.php");
  });
});
