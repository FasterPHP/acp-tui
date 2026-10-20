// Phase-1a task 1.3: copy-fixtures sends the content spike S4 copies from, one
// item per fixture, and exports the fixtures for acp-tui's golden files.
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import * as fakeAgent from "../src/index.ts";
import { COPY_FIXTURES, COPY_FIXTURES_MESSAGE_IDS, COPY_FIXTURES_TOOL_CALL_ID } from "../src/scenarios/copy-fixtures.ts";
import { spawnFakeAgent } from "./helpers.ts";

describe("fake-agent copy-fixtures scenario (phase-1a task 1.3)", () => {
  test("sends code, table, paragraphs, an edit diff and a list, in that order", async () => {
    const updates: SessionUpdate[] = [];
    const handle = spawnFakeAgent({
      scenario: "copy-fixtures",
      client: {
        async sessionUpdate(params) {
          updates.push(params.update);
        },
        async requestPermission() {
          throw new Error("copy-fixtures does not request permission");
        },
      },
    });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      const result = await handle.conn.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "give me things to copy" }],
      });
      expect(result.stopReason).toBe("end_turn");

      const summary = updates.map((u) =>
        u.sessionUpdate === "agent_message_chunk" ? `message:${u.messageId}` : `${u.sessionUpdate}:${"toolCallId" in u ? u.toolCallId : ""}`,
      );
      expect(summary).toEqual([
        `message:${COPY_FIXTURES_MESSAGE_IDS.phpBlock}`,
        `message:${COPY_FIXTURES_MESSAGE_IDS.table}`,
        `message:${COPY_FIXTURES_MESSAGE_IDS.paragraphs}`,
        `tool_call:${COPY_FIXTURES_TOOL_CALL_ID}`,
        `tool_call_update:${COPY_FIXTURES_TOOL_CALL_ID}`,
        `message:${COPY_FIXTURES_MESSAGE_IDS.list}`,
      ]);

      const texts = updates.flatMap((u) =>
        u.sessionUpdate === "agent_message_chunk" && u.content.type === "text" ? [u.content.text] : [],
      );
      expect(texts).toEqual([
        COPY_FIXTURES.phpBlock,
        COPY_FIXTURES.table,
        COPY_FIXTURES.paragraphs,
        COPY_FIXTURES.list,
      ]);

      const diffUpdate = updates.find((u) => u.sessionUpdate === "tool_call_update");
      const diff = diffUpdate?.sessionUpdate === "tool_call_update" ? diffUpdate.content?.[0] : undefined;
      expect(diff).toMatchObject({ type: "diff", ...COPY_FIXTURES.diff });
    } finally {
      handle.stop();
    }
  });

  test("the fixtures have the shapes S4 needs", () => {
    // Fenced PHP code.
    expect(COPY_FIXTURES.phpBlock.startsWith("```php\n")).toBe(true);
    expect(COPY_FIXTURES.phpBlock.endsWith("\n```\n")).toBe(true);
    expect(COPY_FIXTURES.phpBlock).toContain(COPY_FIXTURES.phpCode);

    // A table with three columns on every row.
    const rows = COPY_FIXTURES.table.trimEnd().split("\n");
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const row of rows) {
      expect(row.split("|").length - 2).toBe(3);
    }

    // Three paragraphs, a blank line between each.
    expect(COPY_FIXTURES.paragraphs.trimEnd().split("\n\n")).toHaveLength(3);
    expect(COPY_FIXTURES.paragraphs).not.toContain("\n\n\n");

    // A list of three items.
    expect(COPY_FIXTURES.list.trimEnd().split("\n")).toHaveLength(3);

    // An edit with unchanged context above and below the change.
    const oldLines = COPY_FIXTURES.diff.oldText.split("\n");
    const newLines = COPY_FIXTURES.diff.newText.split("\n");
    let head = 0;
    while (oldLines[head] === newLines[head]) head += 1;
    let tail = 0;
    while (oldLines.at(-1 - tail) === newLines.at(-1 - tail)) tail += 1;
    expect(head).toBeGreaterThanOrEqual(3);
    expect(tail).toBeGreaterThanOrEqual(3);
    expect(COPY_FIXTURES.diff.oldText).not.toBe(COPY_FIXTURES.diff.newText);
  });

  test("the fixtures are exported from the package entry point", () => {
    expect(fakeAgent.COPY_FIXTURES).toBe(COPY_FIXTURES);
    expect(fakeAgent.COPY_PHP_CODE).toBe(COPY_FIXTURES.phpCode);
  });
});
