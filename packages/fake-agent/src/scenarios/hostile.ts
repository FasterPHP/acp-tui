// The "hostile" scenario (design D11, phase-1a task 1.4): the sanitiser corpus
// (hostile.ts) in every agent-supplied field: the agent's name, a message, a
// thought, a tool's title and output, plan entries, a config option's name
// and values, and a permission request's option names. The message also
// carries the chrome-imitation chunk that `basic` sends, and a full imitation of the
// permission card (frame, marker, options row) before the real request, once as plain
// text and once inside a code fence (mvp-rendering task 1.5). Keeps the turn
// short: one permission request, answered by the client, then end_turn.
import type { PromptResponse, SessionConfigOption } from "@agentclientprotocol/sdk";
import { CARD_IMITATION_TEXT, FENCED_CARD_IMITATION_TEXT, HOSTILE_CHUNK_TEXT, hostileField } from "../hostile.ts";
import type { Scenario, ScenarioContext } from "../scenario.ts";

const TOOL_CALL_ID = "hostile-tool";
/** Between the message (with the card imitation) and the real permission request. */
const REQUEST_DELAY_MS = 100;

function hostileConfigOptions(): SessionConfigOption[] {
  const first = hostileField("config.value");
  return [
    {
      id: "hostile-option",
      type: "select",
      name: hostileField("config.name"),
      category: "model",
      currentValue: first,
      options: [
        { value: first, name: hostileField("config.value.name") },
        { value: `${first} (second)`, name: "Ordinary second choice" },
      ],
    },
  ];
}

export const hostileScenario: Scenario = {
  name: "hostile",

  initialize() {
    return { agentInfo: { name: hostileField("agentInfo.name"), title: hostileField("agentInfo.title"), version: "0.0.0" } };
  },

  newSession() {
    return { configOptions: hostileConfigOptions() };
  },

  async prompt(ctx: ScenarioContext): Promise<PromptResponse> {
    const cancelled: PromptResponse = { stopReason: "cancelled" };

    await ctx.send({
      sessionUpdate: "agent_message_chunk",
      messageId: "hostile-msg",
      content: { type: "text", text: `${hostileField("message")}\n${HOSTILE_CHUNK_TEXT}${CARD_IMITATION_TEXT}\n${FENCED_CARD_IMITATION_TEXT}` },
    });
    // A beat before the real request, so a client can look at the imitation with no card open
    // (scaled by --delay-scale; nothing at 0).
    await ctx.sleep(REQUEST_DELAY_MS);
    await ctx.send({
      sessionUpdate: "agent_thought_chunk",
      messageId: "hostile-thought",
      content: { type: "text", text: hostileField("thought") },
    });
    await ctx.send({
      sessionUpdate: "tool_call",
      toolCallId: TOOL_CALL_ID,
      title: hostileField("tool.title"),
      kind: "execute",
      status: "pending",
    });
    if (ctx.cancelled.aborted) return cancelled;

    const response = await ctx.requestPermission({
      toolCall: { toolCallId: TOOL_CALL_ID, title: hostileField("tool.title") },
      options: [
        { optionId: "allow-once", name: hostileField("permission.option"), kind: "allow_once" },
        { optionId: "reject-once", name: `${hostileField("permission.option")} (reject)`, kind: "reject_once" },
      ],
    });
    if (response.outcome.outcome === "cancelled" || ctx.cancelled.aborted) return cancelled;

    await ctx.send({
      sessionUpdate: "tool_call_update",
      toolCallId: TOOL_CALL_ID,
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: hostileField("tool.output") } }],
    });
    await ctx.send({
      sessionUpdate: "plan",
      entries: [
        { content: hostileField("plan"), priority: "high", status: "in_progress" },
        { content: `${hostileField("plan")} (next)`, priority: "low", status: "pending" },
      ],
    });
    return { stopReason: "end_turn" };
  },
};
