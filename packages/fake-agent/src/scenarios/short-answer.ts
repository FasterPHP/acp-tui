// The "short-answer" scenario (mvp-rendering task 9.4; S7 session D4 and
// rendering issue 6): a turn shaped like the one `claude-agent-acp` 0.81.2
// gave in D4, where the plan the user asked for ended up only in a thought and
// the final answer was one sentence. In order: a `read` of README.md (its
// content fenced), a thought whose body is a summary and a numbered plan, an
// `other` call (the agent looking for TodoWrite), an `execute` of
// `touch s7-probe.txt`, then a one-sentence agent message and the end of the
// turn. acp-tui shows that thought collapsed, like every thought (Marcus's
// review, 9 October 2026, C16); the scenario stays as a fixture.
import type { PromptResponse } from "@agentclientprotocol/sdk";
import type { Scenario, ScenarioContext } from "../scenario.ts";

export const SHORT_ANSWER_IDS = {
  read: "short-answer-read",
  thought: "short-answer-thought",
  search: "short-answer-toolsearch",
  touch: "short-answer-touch",
  answer: "short-answer-msg",
} as const;

/** The thought: a bold title, a summary, then the plan as a numbered list. */
export const SHORT_ANSWER_THOUGHT = `**Planning the S7 steps**

The README describes acp-tui, a terminal client for the Agent Client Protocol, and its paseo bridge.

1. Read README.md and summarise it
2. Record a three-step plan with TodoWrite
3. Run \`touch s7-probe.txt\`
4. Add \`<!-- s7 probe -->\` under the first heading
`;

/** The answer: one sentence. */
export const SHORT_ANSWER_TEXT = "Steps 1 and 3 ran, and step 2 could not because TodoWrite is not available.";

export const SHORT_ANSWER_README = "```markdown\n# acp-tui\n\nA terminal client for the Agent Client Protocol.\n```";

export const shortAnswerScenario: Scenario = {
  name: "short-answer",

  async prompt(ctx: ScenarioContext): Promise<PromptResponse> {
    const tool = async (id: string, title: string, kind: "read" | "other" | "execute", text: string) => {
      await ctx.send({ sessionUpdate: "tool_call", toolCallId: id, title, kind, status: "in_progress" });
      await ctx.send({
        sessionUpdate: "tool_call_update",
        toolCallId: id,
        status: "completed",
        content: [{ type: "content", content: { type: "text", text } }],
      });
    };
    await tool(SHORT_ANSWER_IDS.read, "Read README.md", "read", SHORT_ANSWER_README);
    if (ctx.cancelled.aborted) return { stopReason: "cancelled" };
    await ctx.send({
      sessionUpdate: "agent_thought_chunk",
      messageId: SHORT_ANSWER_IDS.thought,
      content: { type: "text", text: SHORT_ANSWER_THOUGHT },
    });
    await tool(SHORT_ANSWER_IDS.search, "ToolSearch", "other", "```\nNo tool named TodoWrite\n```");
    await tool(SHORT_ANSWER_IDS.touch, "touch s7-probe.txt", "execute", "```console\n```");
    if (ctx.cancelled.aborted) return { stopReason: "cancelled" };
    await ctx.send({
      sessionUpdate: "agent_message_chunk",
      messageId: SHORT_ANSWER_IDS.answer,
      content: { type: "text", text: SHORT_ANSWER_TEXT },
    });
    return { stopReason: "end_turn" };
  },
};
