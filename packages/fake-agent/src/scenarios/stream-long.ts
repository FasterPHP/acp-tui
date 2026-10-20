// The "stream-long" scenario (design D11, phase-1a task 1.2): one 3000-line
// Markdown answer streamed as 20-character chunks at a fixed chunk rate, for
// spike S3's streaming frame-time measurement. The fixture is plain ASCII, so
// slicing at 20 UTF-16 code units never splits a character.
import type { PromptResponse } from "@agentclientprotocol/sdk";
import type { Scenario, ScenarioContext } from "../scenario.ts";

export const STREAM_LONG_LINE_COUNT = 3000;
export const STREAM_LONG_CHUNK_SIZE = 20;
/** Delay between chunks at --delay-scale 1 (100 chunks per second, 2000 characters per second). */
export const STREAM_LONG_CHUNK_INTERVAL_MS = 10;
export const STREAM_LONG_MESSAGE_ID = "stream-long-msg";

const TOPICS = ["routing", "hydration", "caching", "validation", "migrations", "rendering"] as const;

/** One section: a heading, a paragraph, a list, a fenced code block and a table. */
function section(number: number): string[] {
  const topic = TOPICS[number % TOPICS.length] as string;
  return [
    `## Section ${number}: ${topic}`,
    "",
    `This section covers **${topic}** in the ${number}th pass over the codebase, with \`inline code\` in it.`,
    "",
    `- the first point about ${topic}`,
    `- the second point, which is a little longer so that it wraps at narrow widths when the pane is small`,
    `- the third point`,
    "",
    "```php",
    `public function ${topic}${number}(array $input): array`,
    "{",
    "    $result = [];",
    "    foreach ($input as $key => $value) {",
    `        $result[$key] = $value * ${number};`,
    "    }",
    "",
    "    return $result;",
    "}",
    "```",
    "",
    "| Step | Cost | Notes |",
    "| --- | --- | --- |",
    `| ${topic} | ${number} ms | measured |`,
    `| total | ${number * 2} ms | estimated |`,
    "",
    "",
  ];
}

function buildText(): string {
  const lines: string[] = [];
  for (let number = 1; ; number += 1) {
    const block = section(number);
    if (lines.length + block.length > STREAM_LONG_LINE_COUNT - 3) break;
    lines.push(...block);
  }
  // Pad with plain lines so the answer is exactly STREAM_LONG_LINE_COUNT lines.
  for (let filler = 1; lines.length < STREAM_LONG_LINE_COUNT; filler += 1) {
    lines.push(`Closing note ${filler}.`);
  }
  return `${lines.join("\n")}\n`;
}

/** The whole answer; concatenating every streamed chunk gives exactly this. */
export const STREAM_LONG_TEXT = buildText();

export function streamLongChunks(): string[] {
  const chunks: string[] = [];
  for (let at = 0; at < STREAM_LONG_TEXT.length; at += STREAM_LONG_CHUNK_SIZE) {
    chunks.push(STREAM_LONG_TEXT.slice(at, at + STREAM_LONG_CHUNK_SIZE));
  }
  return chunks;
}

export const streamLongScenario: Scenario = {
  name: "stream-long",

  async prompt(ctx: ScenarioContext): Promise<PromptResponse> {
    for (const chunk of streamLongChunks()) {
      if (ctx.cancelled.aborted) return { stopReason: "cancelled" };
      await ctx.send({
        sessionUpdate: "agent_message_chunk",
        messageId: STREAM_LONG_MESSAGE_ID,
        content: { type: "text", text: chunk },
      });
      await ctx.sleep(STREAM_LONG_CHUNK_INTERVAL_MS);
    }
    return ctx.cancelled.aborted ? { stopReason: "cancelled" } : { stopReason: "end_turn" };
  },
};
