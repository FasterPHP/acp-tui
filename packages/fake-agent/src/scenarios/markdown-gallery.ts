// The "markdown-gallery" scenario (phase-1a task 16.5, the Markdown audit):
// one agent message holding every Markdown element of CommonMark and GitHub
// Flavored Markdown, plus common extensions (footnotes, maths, alerts,
// definition lists, highlight, sub- and superscript, a mermaid fence), each
// tagged M01 to M30 so a screen dump can be matched to its source. Tags M31
// to M36 (mvp-rendering task 1.4) add the link, alert and HTML fixtures:
// unsafe schemes, a deceptive label, relative links, all five alert kinds,
// `<a href>` and `<details>`; M01 to M30 keep their meaning. The text lives in
// markdown-gallery.md beside this file, because it is full of backticks and
// backslashes; it is sent whole, in one chunk, under one messageId, or with
// `--chunk <n>` in chunks of n characters (mvp-rendering task 1.1), one every
// 10 ms x --delay-scale, for streaming tests.
// Findings: docs/phase-1a-notes/markdown-audit.md.
import { readFileSync } from "node:fs";
import type { PromptResponse } from "@agentclientprotocol/sdk";
import type { Scenario, ScenarioContext } from "../scenario.ts";

export const MARKDOWN_GALLERY: string = readFileSync(new URL("./markdown-gallery.md", import.meta.url), "utf8");

export const MARKDOWN_GALLERY_MESSAGE_ID = "markdown-gallery";

/** Delay between chunks at --delay-scale 1 (`--chunk`). */
export const MARKDOWN_GALLERY_CHUNK_INTERVAL_MS = 10;

/**
 * The gallery in chunks of `size` characters (Unicode code points, so an emoji or a surrogate
 * pair is never split); joining them gives exactly `MARKDOWN_GALLERY`.
 */
export function markdownGalleryChunks(size: number): string[] {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`the chunk size must be a positive integer, got ${size}`);
  }
  const characters = Array.from(MARKDOWN_GALLERY);
  const chunks: string[] = [];
  for (let at = 0; at < characters.length; at += size) {
    chunks.push(characters.slice(at, at + size).join(""));
  }
  return chunks;
}

export const markdownGalleryScenario: Scenario = {
  name: "markdown-gallery",

  async prompt(ctx: ScenarioContext): Promise<PromptResponse> {
    const chunks = ctx.chunk === undefined ? [MARKDOWN_GALLERY] : markdownGalleryChunks(ctx.chunk);
    for (const [index, text] of chunks.entries()) {
      if (ctx.cancelled.aborted) return { stopReason: "cancelled" };
      if (index > 0) await ctx.sleep(MARKDOWN_GALLERY_CHUNK_INTERVAL_MS);
      await ctx.send({
        sessionUpdate: "agent_message_chunk",
        messageId: MARKDOWN_GALLERY_MESSAGE_ID,
        content: { type: "text", text },
      });
    }
    return { stopReason: "end_turn" };
  },
};
