// SPIKE (phase-1a, S4): test helpers for the plain-text projection. Runs a
// fake-agent scenario's prompt in-process (its `prompt(ctx)` with a context
// that records every `session/update`), then drives the updates through the
// acp-model reducer, as fake-agent's own reducer tests do with the child
// process. The same strings reach the model as in a PTY run, without one.
import { join } from "node:path";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { createSession, reduce, type Item, type Session } from "acp-model";

interface ScenarioLike {
  prompt(ctx: unknown): Promise<{ stopReason: string }>;
}

// Imported by a computed path: acp-tui does not depend on the fake-agent package.
const FAKE_AGENT = join(import.meta.dir, "../../../fake-agent/src");
const { SCENARIOS } = (await import(join(FAKE_AGENT, "scenarios/index.ts"))) as { SCENARIOS: Record<string, ScenarioLike> };

export interface CopyFixtures {
  readonly paragraphs: string;
  readonly phpBlock: string;
  readonly phpCode: string;
  readonly table: string;
  readonly list: string;
  readonly diff: { readonly path: string; readonly oldText: string; readonly newText: string };
}

export const { COPY_FIXTURES, COPY_FIXTURES_MESSAGE_IDS, COPY_FIXTURES_TOOL_CALL_ID, MARKDOWN_GALLERY } = (await import(join(FAKE_AGENT, "index.ts"))) as {
  COPY_FIXTURES: CopyFixtures;
  COPY_FIXTURES_MESSAGE_IDS: { paragraphs: string; phpBlock: string; table: string; list: string };
  COPY_FIXTURES_TOOL_CALL_ID: string;
  MARKDOWN_GALLERY: string;
};

export const COPY_PROMPT = "give me things to copy";

/** The model after one prompt turn of `scenario` (no permission requests or elicitation). */
export async function runScenario(scenario: string, prompt: string): Promise<Session> {
  const updates: SessionUpdate[] = [];
  const ctx = {
    sessionId: "s",
    items: 200,
    cancelled: new AbortController().signal,
    async send(update: SessionUpdate) {
      updates.push(update);
    },
    async sleep() {},
    async requestPermission() {
      throw new Error(`${scenario} requested permission`);
    },
    async createElicitation() {
      throw new Error(`${scenario} requested elicitation`);
    },
    async completeElicitation() {},
  };
  const response = await SCENARIOS[scenario]!.prompt(ctx);
  return runUpdates(updates, prompt, response.stopReason);
}

/** The model after one prompt turn whose agent sent `updates`. */
export function runUpdates(updates: readonly SessionUpdate[], prompt: string, stopReason = "end_turn"): Session {
  let at = 0;
  let model = reduce(createSession(), {
    type: "session_created",
    response: { sessionId: "s" },
    cwd: "/work",
    agentInfo: { name: "fake-agent", version: "1" },
    at: at++,
  });
  model = reduce(model, { type: "prompt_sent", text: prompt, at: at++ });
  for (const update of updates) model = reduce(model, { type: "session_update", update, at: at++ });
  return reduce(model, { type: "prompt_response", stopReason: stopReason as "end_turn", at: at++ });
}

export function itemsOf(model: Session): Item[] {
  return model.order.map((id) => model.items.get(id)!);
}
