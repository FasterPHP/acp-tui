// The "elicitation" scenario (design D11, phase-1a task 1.7): a three-question
// form (single choice, multiple choice, free text) followed by a URL request,
// for spike S6's elicitation card. @agentclientprotocol/sdk 1.5.0 exposes
// elicitation on both sides (AgentSideConnection.createElicitation and
// completeElicitation; the Client's createElicitation handler), so the
// scenario uses the SDK's own methods. If the client does not implement
// elicitation the request fails; the scenario reports that as a message and
// ends the turn instead of crashing.
import type { CreateElicitationResponse, ElicitationSchema, PromptResponse } from "@agentclientprotocol/sdk";
import type { Scenario, ScenarioContext } from "../scenario.ts";

export const ELICITATION_URL = "https://example.invalid/fake-agent/authorise";
export const ELICITATION_URL_ID = "elicitation-url-1";

export const ELICITATION_FORM_SCHEMA: ElicitationSchema = {
  type: "object",
  title: "Set up the change",
  properties: {
    strategy: {
      type: "string",
      title: "Strategy",
      description: "How should the migration run?",
      oneOf: [
        { const: "in-place", title: "In place" },
        { const: "copy", title: "Copy, then swap" },
      ],
    },
    checks: {
      type: "array",
      title: "Checks",
      description: "Which checks should run afterwards?",
      items: {
        anyOf: [
          { const: "tests", title: "Unit tests" },
          { const: "types", title: "Type check" },
          { const: "lint", title: "Lint" },
        ],
      },
    },
    notes: {
      type: "string",
      title: "Notes",
      description: "Anything else the agent should know?",
    },
  },
  required: ["strategy"],
};

function describe(response: CreateElicitationResponse): string {
  return response.action === "accept" ? `accepted ${JSON.stringify(response.content ?? {})}` : response.action;
}

export const elicitationScenario: Scenario = {
  name: "elicitation",

  async prompt(ctx: ScenarioContext): Promise<PromptResponse> {
    const say = (text: string, id: string) =>
      ctx.send({
        sessionUpdate: "agent_message_chunk",
        messageId: id,
        content: { type: "text", text },
      });

    try {
      const form = await ctx.createElicitation({
        mode: "form",
        sessionId: ctx.sessionId,
        message: "A few questions before I start.",
        requestedSchema: ELICITATION_FORM_SCHEMA,
      });
      if (ctx.cancelled.aborted) return { stopReason: "cancelled" };
      await say(`Form: ${describe(form)}\n`, "elicitation-form-result");

      const url = await ctx.createElicitation({
        mode: "url",
        sessionId: ctx.sessionId,
        elicitationId: ELICITATION_URL_ID,
        url: ELICITATION_URL,
        message: "Sign in to continue.",
      });
      if (ctx.cancelled.aborted) return { stopReason: "cancelled" };
      await say(`URL: ${describe(url)}\n`, "elicitation-url-result");
      await ctx.completeElicitation(ELICITATION_URL_ID);
    } catch (error) {
      await say(`Elicitation failed: ${error instanceof Error ? error.message : String(error)}\n`, "elicitation-error");
    }
    return { stopReason: "end_turn" };
  },
};
