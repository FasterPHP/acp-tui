// Phase-1a task 16.5: markdown-gallery sends the whole gallery as one agent message.
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import * as fakeAgent from "../src/index.ts";
import { MARKDOWN_GALLERY, MARKDOWN_GALLERY_MESSAGE_ID, markdownGalleryChunks } from "../src/scenarios/markdown-gallery.ts";
import { spawnFakeAgent } from "./helpers.ts";

/** The last sample tag before the end marker: M01 to M30 are the audit's, M31 to M36 are mvp-rendering's. */
const GALLERY_TAGS = 36;

describe("fake-agent markdown-gallery scenario (phase-1a task 16.5)", () => {
  test("sends the gallery as one agent message, then ends the turn", async () => {
    const updates: SessionUpdate[] = [];
    const handle = spawnFakeAgent({
      scenario: "markdown-gallery",
      client: {
        async sessionUpdate(params) {
          updates.push(params.update);
        },
        async requestPermission() {
          throw new Error("markdown-gallery does not request permission");
        },
      },
    });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      const result = await handle.conn.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "show me every Markdown element" }],
      });
      expect(result.stopReason).toBe("end_turn");
      expect(updates).toEqual([
        {
          sessionUpdate: "agent_message_chunk",
          messageId: MARKDOWN_GALLERY_MESSAGE_ID,
          content: { type: "text", text: MARKDOWN_GALLERY },
        },
      ]);
    } finally {
      handle.stop();
    }
  });

  test("the gallery has every tag, M01 to M36 in order, then the end marker", () => {
    let from = 0;
    for (let n = 1; n <= GALLERY_TAGS; n++) {
      const tag = `\nM${String(n).padStart(2, "0")} `;
      const at = MARKDOWN_GALLERY.indexOf(tag, from);
      expect(at, tag.trim()).toBeGreaterThanOrEqual(from);
      from = at;
    }
    // No tag appears twice, and none is missing between M01 and the end marker.
    const tags = [...MARKDOWN_GALLERY.matchAll(/^M(\d\d) /gm)].map((match) => Number(match[1]));
    expect(tags).toEqual([...Array.from({ length: GALLERY_TAGS }, (_, index) => index + 1), 99]);
    expect(MARKDOWN_GALLERY.trimEnd().endsWith("M99 end of gallery.")).toBe(true);
    expect(fakeAgent.MARKDOWN_GALLERY).toBe(MARKDOWN_GALLERY);
  });

  test("M31 to M36 hold the link, alert and HTML fixtures (mvp-rendering task 1.4)", () => {
    const sample = (tag: string): string => {
      const start = MARKDOWN_GALLERY.indexOf(`\n${tag} `) + 1;
      const next = MARKDOWN_GALLERY.slice(start + 3).search(/\nM\d\d /);
      return MARKDOWN_GALLERY.slice(start, next < 0 ? undefined : start + 3 + next);
    };
    // Unsafe schemes: javascript:, data: and an absolute file: target.
    expect(sample("M31")).toContain("](javascript:alert(1))");
    expect(sample("M31")).toContain("](data:text/html;base64,");
    expect(sample("M31")).toContain("](file:///etc/passwd)");
    // A deceptive label: the label is a URL of one host, the target another.
    expect(sample("M32")).toContain("[https://bank.example](https://evil.example/login)");
    // A relative link inside the working directory, and one outside it.
    expect(sample("M33")).toContain("](src/index.ts)");
    expect(sample("M33")).toContain("](../../outside/secret.txt)");
    // All five alert kinds, each its own blockquote.
    for (const kind of ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"]) {
      expect(sample("M34")).toContain(`\n> [!${kind}]\n`);
    }
    // HTML: <a href> inline, and <details> with a <summary>.
    expect(sample("M35")).toContain('<a href="https://example.com/html-link">anchor tag</a>');
    expect(sample("M36")).toContain("<details>\n<summary>");
    expect(sample("M36")).toContain("</summary>");
    expect(sample("M36")).toContain("</details>");
  });

  test("--chunk <n> streams the gallery in chunks of n characters under one messageId (mvp-rendering task 1.1)", async () => {
    const updates: SessionUpdate[] = [];
    const handle = spawnFakeAgent({
      scenario: "markdown-gallery",
      args: ["--chunk", "40"],
      client: {
        async sessionUpdate(params) {
          updates.push(params.update);
        },
        async requestPermission() {
          throw new Error("markdown-gallery does not request permission");
        },
      },
    });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      const result = await handle.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "go" }] });
      expect(result.stopReason).toBe("end_turn");
      const texts = updates.map((update) => {
        if (update.sessionUpdate !== "agent_message_chunk" || update.content.type !== "text") throw new Error("not a text chunk");
        expect(update.messageId).toBe(MARKDOWN_GALLERY_MESSAGE_ID);
        return update.content.text;
      });
      expect(texts).toEqual(markdownGalleryChunks(40));
      expect(texts.length).toBeGreaterThan(50);
      for (const text of texts.slice(0, -1)) expect([...text]).toHaveLength(40);
      expect(texts.join("")).toBe(MARKDOWN_GALLERY);
    } finally {
      handle.stop();
    }
  });

  test("the chunks join to the whole gallery byte for byte, at any size, and never split a character", () => {
    for (const size of [1, 7, 20, 63, 1000, MARKDOWN_GALLERY.length * 2]) {
      const chunks = markdownGalleryChunks(size);
      expect(chunks.join("")).toBe(MARKDOWN_GALLERY);
      expect(Buffer.from(chunks.join(""))).toEqual(Buffer.from(MARKDOWN_GALLERY));
      for (const chunk of chunks) expect(chunk).not.toMatch(/[\ud800-\udbff]$|^[\udc00-\udfff]/);
    }
    expect(markdownGalleryChunks(MARKDOWN_GALLERY.length * 2)).toEqual([MARKDOWN_GALLERY]);
    expect(() => markdownGalleryChunks(0)).toThrow("positive integer");
  });
});
