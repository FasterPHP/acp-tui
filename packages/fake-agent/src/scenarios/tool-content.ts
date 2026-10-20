// The "tool-content" scenario (mvp-rendering task 1.3; S7 rendering issues 2
// and 4): tool calls whose text content arrives as Markdown, the way
// `claude-agent-acp` sends it, so acp-tui can render a tool's content and show
// an expanded command in full. Four calls, each started `in_progress` and then
// completed (or failed) with one text block:
//
// 1. an `execute` call whose title is a 140-character command (too long for the
//    collapsed line) and whose output is a `console` fence of 5 lines;
// 2. a `read` whose content is a fenced 60-line file;
// 3. an `execute` with 5000 output lines in a `console` fence, which an
//    expanded card must show as a snippet, never all at once;
// 4. a refused `edit`: failed, with the agent's message inside a bare fence.
//
// No permission request is made; the refusal is the failed update that
// follows one, which is all the client sees of it. Each text block is exactly
// one fenced code block, so it is the case "a text block that is exactly one
// fence" in the tui-rendering spec.
import type { PromptResponse } from "@agentclientprotocol/sdk";
import type { Scenario, ScenarioContext } from "../scenario.ts";

export const TOOL_CONTENT_COMMAND =
  "cd /work/app && composer install --no-interaction --prefer-dist --optimize-autoloader && vendor/bin/phpunit --testdox --filter InvoiceTotals";

export const TOOL_CONTENT_OUTPUT_LINES: readonly string[] = [
  "PHPUnit 11.4.3 by Sebastian Bergmann and contributors.",
  "InvoiceTotals",
  " ✔ Net is the sum of the lines",
  " ✔ Count is the number of lines",
  "OK (2 tests, 2 assertions)",
];

export const TOOL_CONTENT_READ_LINE_COUNT = 60;
export const TOOL_CONTENT_BIG_OUTPUT_LINE_COUNT = 5000;
/** The text `claude-agent-acp` reports for a tool call the user refused. */
export const TOOL_CONTENT_REFUSAL = "User refused permission to run tool";

export const TOOL_CONTENT_IDS = {
  command: "tool-content-command",
  read: "tool-content-read",
  big: "tool-content-big",
  refused: "tool-content-refused",
} as const;

export const TOOL_CONTENT_READ_TITLE = "Read src/Billing/Receipt.php";
export const TOOL_CONTENT_BIG_TITLE = "Run the full test suite";
export const TOOL_CONTENT_REFUSED_TITLE = "Edit README.md";

function fence(label: string, lines: readonly string[]): string {
  return `\`\`\`${label}\n${lines.join("\n")}\n\`\`\``;
}

/** A 60-line PHP file: `<?php`, a class, and numbered filler methods. */
export function toolContentReadLines(): string[] {
  const lines = ["<?php", "", "declare(strict_types=1);", "", "final class Receipt", "{"];
  for (let method = 1; lines.length < TOOL_CONTENT_READ_LINE_COUNT - 1; method += 1) {
    const body = [
      `    public function line${method}(): string`,
      "    {",
      `        return 'line ${method}';`,
      "    }",
      "",
    ];
    lines.push(...body.slice(0, TOOL_CONTENT_READ_LINE_COUNT - 1 - lines.length));
  }
  lines.push("}");
  return lines;
}

export function toolContentBigLines(): string[] {
  return Array.from({ length: TOOL_CONTENT_BIG_OUTPUT_LINE_COUNT }, (_, index) => `test ${index + 1} ... ok`);
}

/** The text block of each call, by tool call ID. */
export function toolContentTexts(): Readonly<Record<string, string>> {
  return {
    [TOOL_CONTENT_IDS.command]: fence("console", TOOL_CONTENT_OUTPUT_LINES),
    [TOOL_CONTENT_IDS.read]: fence("php", toolContentReadLines()),
    [TOOL_CONTENT_IDS.big]: fence("console", toolContentBigLines()),
    [TOOL_CONTENT_IDS.refused]: fence("", [TOOL_CONTENT_REFUSAL]),
  };
}

export const toolContentScenario: Scenario = {
  name: "tool-content",

  async prompt(ctx: ScenarioContext): Promise<PromptResponse> {
    const texts = toolContentTexts();
    const calls = [
      { id: TOOL_CONTENT_IDS.command, title: TOOL_CONTENT_COMMAND, kind: "execute", status: "completed" },
      { id: TOOL_CONTENT_IDS.read, title: TOOL_CONTENT_READ_TITLE, kind: "read", status: "completed" },
      { id: TOOL_CONTENT_IDS.big, title: TOOL_CONTENT_BIG_TITLE, kind: "execute", status: "completed" },
      { id: TOOL_CONTENT_IDS.refused, title: TOOL_CONTENT_REFUSED_TITLE, kind: "edit", status: "failed" },
    ] as const;

    for (const call of calls) {
      if (ctx.cancelled.aborted) return { stopReason: "cancelled" };
      await ctx.send({
        sessionUpdate: "tool_call",
        toolCallId: call.id,
        title: call.title,
        kind: call.kind,
        status: "in_progress",
      });
      await ctx.send({
        sessionUpdate: "tool_call_update",
        toolCallId: call.id,
        status: call.status,
        content: [{ type: "content", content: { type: "text", text: texts[call.id] as string } }],
      });
    }
    return { stopReason: "end_turn" };
  },
};
