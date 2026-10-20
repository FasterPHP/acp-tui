// The "fence-first" scenario (mvp-rendering task 1.2; S7 session E1): one agent
// message that opens with a fenced code block with no text before it, streamed
// in 7-character chunks under one messageId (or `--chunk <n>` characters). The first fence is a `php` file
// with `<?php`; the second is a `php` snippet without the tag, so a highlighter
// that decides the language from the first characters of a still-growing
// block (or that carries state from one block to the next) shows up. The text
// is plain ASCII, so slicing at 7 UTF-16 code units never splits a character.
import type { PromptResponse } from "@agentclientprotocol/sdk";
import type { Scenario, ScenarioContext } from "../scenario.ts";

export const FENCE_FIRST_CHUNK_SIZE = 7;
/** Delay between chunks at --delay-scale 1. */
export const FENCE_FIRST_CHUNK_INTERVAL_MS = 10;
export const FENCE_FIRST_MESSAGE_ID = "fence-first-msg";

/** The whole message; concatenating every streamed chunk gives exactly this. */
export const FENCE_FIRST_TEXT = `\`\`\`php
<?php

declare(strict_types=1);

namespace App\\Billing;

final class Receipt
{
    public function __construct(private readonly int $pence)
    {
    }

    public function format(): string
    {
        // Pounds and pence, two decimal places
        return sprintf('GBP %.2f', $this->pence / 100);
    }
}
\`\`\`

And the same idea without the opening tag:

\`\`\`php
$receipt = new Receipt(1999);
echo $receipt->format() . PHP_EOL;
\`\`\`
`;

/** The message in chunks of `size` characters (7 by default, or `--chunk <n>`, for acp-tui's
 *  streaming checks, mvp-rendering task 10.3). */
export function fenceFirstChunks(size: number = FENCE_FIRST_CHUNK_SIZE): string[] {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`the chunk size must be a positive integer, got ${size}`);
  }
  const chunks: string[] = [];
  for (let at = 0; at < FENCE_FIRST_TEXT.length; at += size) {
    chunks.push(FENCE_FIRST_TEXT.slice(at, at + size));
  }
  return chunks;
}

export const fenceFirstScenario: Scenario = {
  name: "fence-first",

  async prompt(ctx: ScenarioContext): Promise<PromptResponse> {
    for (const [index, text] of fenceFirstChunks(ctx.chunk ?? FENCE_FIRST_CHUNK_SIZE).entries()) {
      if (ctx.cancelled.aborted) return { stopReason: "cancelled" };
      if (index > 0) await ctx.sleep(FENCE_FIRST_CHUNK_INTERVAL_MS);
      await ctx.send({
        sessionUpdate: "agent_message_chunk",
        messageId: FENCE_FIRST_MESSAGE_ID,
        content: { type: "text", text },
      });
    }
    return { stopReason: "end_turn" };
  },
};
