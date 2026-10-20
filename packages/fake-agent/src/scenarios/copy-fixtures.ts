// The "copy-fixtures" scenario (design D11, phase-1a task 1.3): the content
// spike S4 copies from and compares against golden files. Each fixture is its
// own item so a test can copy one item and know exactly what it should get.
// The fixtures are exported (also from the package index) so acp-tui's golden
// files are derived from the same strings the agent sends.
import type { PromptResponse } from "@agentclientprotocol/sdk";
import type { Scenario, ScenarioContext } from "../scenario.ts";

export const COPY_PHP_CODE = `<?php

declare(strict_types=1);

final class InvoiceTotal
{
    public function __construct(private readonly array $lines)
    {
    }

    public function net(): float
    {
        return array_sum(array_map(fn (array $line): float => $line['qty'] * $line['price'], $this->lines));
    }
}
`;

export const COPY_TABLE = `| Field | Type | Notes |
| --- | --- | --- |
| id | int | primary key |
| name | string | up to 80 characters, indexed |
| created_at | datetime | UTC |
`;

export const COPY_PARAGRAPHS = [
  "The first paragraph explains the change in one or two sentences.",
  "The second paragraph gives the reason, including a `code span` that must survive a copy.",
  "The third paragraph closes with what to check next.",
] as const;

export const COPY_LIST = ["first item", "second item, with **bold** text", "third item"] as const;

const DIFF_PATH = "/work/src/InvoiceTotal.php";
const DIFF_OLD = `<?php

declare(strict_types=1);

final class InvoiceTotal
{
    public function net(): float
    {
        $total = 0.0;
        foreach ($this->lines as $line) {
            $total += $line['qty'] * $line['price'];
        }

        return $total;
    }

    public function count(): int
    {
        return count($this->lines);
    }
}
`;
const DIFF_NEW = `<?php

declare(strict_types=1);

final class InvoiceTotal
{
    public function net(): float
    {
        return array_sum(array_map(fn (array $line): float => $line['qty'] * $line['price'], $this->lines));
    }

    public function count(): int
    {
        return count($this->lines);
    }
}
`;

/** Everything the scenario sends, as Markdown or diff text, keyed by item. */
export const COPY_FIXTURES = {
  /** The three paragraphs as sent: blank lines between them, none after the last. */
  paragraphs: `${COPY_PARAGRAPHS.join("\n\n")}\n`,
  /** The fenced block as sent; its copy text is `phpCode` (no fences, no gutter). */
  phpBlock: `\`\`\`php\n${COPY_PHP_CODE}\`\`\`\n`,
  phpCode: COPY_PHP_CODE,
  table: COPY_TABLE,
  list: `${COPY_LIST.map((entry) => `- ${entry}`).join("\n")}\n`,
  /** An edit with unchanged lines above, between and below the change. */
  diff: { path: DIFF_PATH, oldText: DIFF_OLD, newText: DIFF_NEW },
} as const;

export const COPY_FIXTURES_MESSAGE_IDS = {
  paragraphs: "copy-paragraphs",
  phpBlock: "copy-php",
  table: "copy-table",
  list: "copy-list",
} as const;

export const COPY_FIXTURES_TOOL_CALL_ID = "copy-diff";

export const copyFixturesScenario: Scenario = {
  name: "copy-fixtures",

  async prompt(ctx: ScenarioContext): Promise<PromptResponse> {
    const sendMessage = (key: keyof typeof COPY_FIXTURES_MESSAGE_IDS) =>
      ctx.send({
        sessionUpdate: "agent_message_chunk",
        messageId: COPY_FIXTURES_MESSAGE_IDS[key],
        content: { type: "text", text: COPY_FIXTURES[key] },
      });

    await sendMessage("phpBlock");
    await sendMessage("table");
    await sendMessage("paragraphs");
    await ctx.send({
      sessionUpdate: "tool_call",
      toolCallId: COPY_FIXTURES_TOOL_CALL_ID,
      title: "Edit src/InvoiceTotal.php",
      kind: "edit",
      status: "in_progress",
    });
    await ctx.send({
      sessionUpdate: "tool_call_update",
      toolCallId: COPY_FIXTURES_TOOL_CALL_ID,
      status: "completed",
      content: [{ type: "diff", ...COPY_FIXTURES.diff }],
    });
    await sendMessage("list");
    return { stopReason: "end_turn" };
  },
};
