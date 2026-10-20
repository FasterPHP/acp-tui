// The "basic" scenario (design D12, task 4.2): one full turn covering the
// update shapes acp-tui and acp-model need for Phase 0, streamed Markdown
// with and without messageId, a thought, two tools completing out of order
// including an edit diff, one answered permission request, a usage update, a
// plan, an unknown sessionUpdate variant (task 4.4), and honouring
// session/cancel including mid-permission.
import type { ContentBlock, PermissionOption, PromptResponse, SessionUpdate } from "@agentclientprotocol/sdk";
import { editFixture } from "../diff-fixture.ts";
import { HOSTILE_CHUNK_TEXT } from "../hostile.ts";
import type { Scenario, ScenarioContext } from "../scenario.ts";

const PERMISSION_OPTIONS: PermissionOption[] = [
  { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
  { optionId: "allow-always", name: "Allow always", kind: "allow_always" },
  { optionId: "reject-once", name: "Reject once", kind: "reject_once" },
];

/** Sends a sessionUpdate variant the v1 union does not define (task 4.4). */
async function sendUnknownVariant(ctx: ScenarioContext): Promise<void> {
  const unknown = {
    sessionUpdate: "subagent_state_update",
    agentId: "sub-1",
    state: "spawned",
  };
  await ctx.send(unknown as unknown as SessionUpdate);
}

/**
 * The prompt's content block types for the echo line: `text`, `resource_link <uri>` and so on.
 * The fake-agent log keeps only the block count, so this is how a test sees what the client sent.
 */
export function describePromptBlocks(prompt: readonly ContentBlock[]): string {
  return prompt
    .map((block) => {
      if (block.type === "resource_link") return `resource_link ${block.uri}`;
      if (block.type === "resource") return `resource ${block.resource.uri}`;
      return block.type;
    })
    .join(", ");
}

export const basicScenario: Scenario = {
  name: "basic",

  async prompt(ctx: ScenarioContext): Promise<PromptResponse> {
    const cancelledResponse: PromptResponse = { stopReason: "cancelled" };

    // Echo the prompt's block types, but only for a prompt that is not a single text block, so a
    // plain prompt gets the reply it always did.
    if (ctx.prompt.length > 1 || ctx.prompt.some((block) => block.type !== "text")) {
      await ctx.send({
        sessionUpdate: "agent_message_chunk",
        messageId: "prompt-echo",
        content: { type: "text", text: `Prompt blocks: ${describePromptBlocks(ctx.prompt)}\n\n` },
      });
    }

    // Message 1: streamed with a stable messageId across its chunks.
    await ctx.send({
      sessionUpdate: "agent_message_chunk",
      messageId: "msg-1",
      content: { type: "text", text: "# Streamed answer\n\n" },
    });
    await ctx.sleep(5);
    if (ctx.cancelled.aborted) return cancelledResponse;

    await ctx.send({
      sessionUpdate: "agent_message_chunk",
      messageId: "msg-1",
      content: {
        type: "text",
        text: "This is the first paragraph of the answer, explaining the change.\n\n",
      },
    });
    await ctx.send({
      sessionUpdate: "agent_message_chunk",
      messageId: "msg-1",
      content: {
        type: "text",
        text: "This is the second paragraph, with a little more detail and rationale.\n\n",
      },
    });
    await ctx.sleep(5);
    if (ctx.cancelled.aborted) return cancelledResponse;

    // Message 2: a separate contiguous run with no messageId, per the model's
    // "synthesise one per contiguous run" rule. Carries the list, the fenced
    // code block and the hostile chunk.
    await ctx.send({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "- item one\n- item two\n- item three\n\n" },
    });
    await ctx.send({
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "text",
        text: "```ts\nconst answer = 42;\nconsole.log(answer);\n```\n\n",
      },
    });
    await ctx.send({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: HOSTILE_CHUNK_TEXT },
    });
    await ctx.sleep(5);
    if (ctx.cancelled.aborted) return cancelledResponse;

    // A thought, summary-only per design 6.2.
    await ctx.send({
      sessionUpdate: "agent_thought_chunk",
      content: {
        type: "text",
        text: "Considering the safest way to apply the edit before running it.\n",
      },
    });

    // An update the v1 union does not define; the client SDK's own
    // validation is expected to drop this before acp-tui's handler sees it
    // (task 4.4 records the exact behaviour observed).
    await sendUnknownVariant(ctx);
    await ctx.sleep(5);
    if (ctx.cancelled.aborted) return cancelledResponse;

    // Two tool calls, started in order: t1 (read) first, t2 (edit) second.
    await ctx.send({
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      title: "Read src/index.ts",
      kind: "read",
      status: "in_progress",
    });
    await ctx.send({
      sessionUpdate: "tool_call",
      toolCallId: "t2",
      title: "Edit src/index.ts",
      kind: "edit",
      status: "pending",
    });

    // Permission for t2, tied to that tool call, in the required option order.
    const permissionResponse = await ctx.requestPermission({
      toolCall: { toolCallId: "t2" },
      options: PERMISSION_OPTIONS,
    });
    if (permissionResponse.outcome.outcome === "cancelled" || ctx.cancelled.aborted) {
      return cancelledResponse;
    }

    // t2 completes first, out of order relative to t1's start.
    const { oldText, newText } = editFixture();
    await ctx.send({
      sessionUpdate: "tool_call_update",
      toolCallId: "t2",
      status: "completed",
      content: [{ type: "diff", path: "/work/src/index.ts", oldText, newText }],
    });
    await ctx.sleep(10);
    if (ctx.cancelled.aborted) return cancelledResponse;

    // t1 completes last.
    await ctx.send({
      sessionUpdate: "tool_call_update",
      toolCallId: "t1",
      status: "completed",
      content: [
        {
          type: "content",
          content: { type: "text", text: "export const FAKE_AGENT_PACKAGE_NAME = \"fake-agent\";\n" },
        },
      ],
    });

    await ctx.send({
      sessionUpdate: "usage_update",
      used: 38000,
      size: 200000,
      cost: { amount: 0.014, currency: "USD" },
    });

    await ctx.send({
      sessionUpdate: "plan",
      entries: [
        { content: "Read the target file", priority: "medium", status: "completed" },
        { content: "Apply the edit", priority: "high", status: "completed" },
        { content: "Report the result", priority: "low", status: "in_progress" },
      ],
    });

    return { stopReason: "end_turn" };
  },
};
