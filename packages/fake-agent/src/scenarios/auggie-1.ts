// The "auggie-1" scenario (auggie-1x-support group 2): an agent that mimics Auggie 1.2.2 on the wire,
// built from the logged-in transcripts of check A (docs/mvp-notes/auggie-1.2-probes.md in the parent
// repository). What it copies, and what it leaves out:
//
//   - `agentInfo` { auggie, Auggie Coding Agent, 1.2.2 } and the capabilities `loadSession`,
//     `sessionCapabilities` `list`, `resume`, `close` and `additionalDirectories`, `promptCapabilities`
//     with `image` only. The sessions behave as 1.2.2's do (see `HarnessBehaviour`): written at the
//     first prompt, titles cut to 50 characters plus `...`, replayed by `session/load`, `-32603` with the
//     reason in `data.details` for an unknown session; the indexing line after `session/new` and
//     `session/load` (see `../indexing.ts`).
//   - One `model` config option (three of the models 1.2.2 offered, current `augment/butler_b`
//     `Prism (GPT)`), no modes; `session/set_model` and `session/set_mode` are `-32601`; an unknown
//     option is `-32603` with `data.details` `Unknown config option <id>`.
//   - Every chunk without a `messageId`.
//   - The turn is chosen by a word in the prompt: `held`, `slow`, `script`, `permission`, `tools`, else a short reply.
//       tools       read, edit, write, then three `bash` calls (the last two fail or stream), titled with the
//                   bare tool name, with `kind` and `rawInput`; `bash` updates carry the whole output so far;
//                   the failing one ends `\n\n\nCommand exited with code 1`.
//       permission  a request for `bash` with a fresh UUID `toolCallId` (not the real call's), the title
//                   `⚠️ Tool "bash" requires approval:` and `Yes` and `No`, both `allow_once`; then the real
//                   `call_...` call. `No` (or a cancelled outcome) fails it with `Tool execution denied: bash`
//                   and three lines of advice.
//       script      as `permission` for a 30-line command (`echo step 1` to `echo step 30`), each line
//                   indented by two spaces as 1.2.2 indents the command: a question longer than the card.
//       held        as `permission` for `write`, but the real `tool_call` goes out while the request is open,
//                   and `session/cancel` does not end the turn: it waits for the answer.
//       slow        a `bash` call that runs until `session/cancel`, then fails with `Command aborted` and
//                   answers `end_turn` (not `cancelled`), as 1.2.2 does.
import { randomUUID } from "node:crypto";
import { RequestError } from "@agentclientprotocol/sdk";
import type {
  PromptResponse,
  RequestPermissionResponse,
  SessionConfigOption,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
} from "@agentclientprotocol/sdk";
import type { Scenario, ScenarioContext } from "../scenario.ts";

export const AUGGIE_1_INFO = { name: "auggie", title: "Auggie Coding Agent", version: "1.2.2" } as const;

export const AUGGIE_1_MODELS = [
  { value: "augment/butler_a", name: "Prism (Claude)" },
  { value: "augment/butler_b", name: "Prism (GPT)" },
  { value: "augment/claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
] as const;

export const AUGGIE_1_DEFAULT_MODEL = "augment/butler_b";

/** Tool-call IDs of the real calls: `call_` and 32 hex digits, in order. */
let callCounter = 0;
function nextCallId(): string {
  callCounter += 1;
  return `call_${callCounter.toString(16).padStart(32, "0")}`;
}

/** Current model per session (one agent process serves one scenario, so module state is enough). */
const currentModels = new Map<string, string>();

/** The `model` config option as 1.2.2 sends it, with `current` as its value. */
export function auggieModelOption(current: string): SessionConfigOption {
  return {
    type: "select",
    id: "model",
    name: "Model",
    category: "model",
    currentValue: current,
    options: AUGGIE_1_MODELS.map((model) => ({ ...model })),
  } as SessionConfigOption;
}

const DENIED =
  "Tool execution denied: {tool}\n User approval required\n This tool requires manual approval before execution\n Do not attempt to run variations of this command, instead use a different approach.";

const text = (value: string) => [{ type: "content" as const, content: { type: "text" as const, text: value } }];

async function say(ctx: ScenarioContext, value: string): Promise<void> {
  await ctx.send({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: value } });
}

/** A `bash` call: `in_progress` with an empty update, then the whole output so far at each step, then the end. */
async function bash(
  ctx: ScenarioContext,
  command: string,
  steps: readonly string[],
  end: { readonly status: "completed" | "failed"; readonly output: string },
): Promise<void> {
  const toolCallId = nextCallId();
  await ctx.send({
    sessionUpdate: "tool_call",
    toolCallId,
    title: "bash",
    status: "in_progress",
    kind: "execute",
    rawInput: { command },
  });
  await ctx.send({ sessionUpdate: "tool_call_update", toolCallId, status: "in_progress", content: [] });
  let sofar = "";
  for (const step of steps) {
    sofar += step;
    await ctx.send({ sessionUpdate: "tool_call_update", toolCallId, status: "in_progress", content: text(sofar) });
  }
  await ctx.send({ sessionUpdate: "tool_call_update", toolCallId, status: end.status, content: text(end.output) });
}

async function tools(ctx: ScenarioContext): Promise<PromptResponse> {
  await say(ctx, "I'll run the requested steps in order, using one tool call per step.\n");
  const read = nextCallId();
  await ctx.send({ sessionUpdate: "tool_call", toolCallId: read, title: "read", status: "in_progress", kind: "read", rawInput: { path: "README.md" } });
  await ctx.send({ sessionUpdate: "tool_call_update", toolCallId: read, status: "completed", content: text("# probe repo\n\nalpha beta gamma\n") });
  const edit = nextCallId();
  await ctx.send({
    sessionUpdate: "tool_call",
    toolCallId: edit,
    title: "edit",
    status: "in_progress",
    kind: "edit",
    rawInput: { path: "notes.txt", edits: [{ oldText: "old line\n", newText: "probe line\n" }] },
  });
  await ctx.send({ sessionUpdate: "tool_call_update", toolCallId: edit, status: "completed", content: text("Successfully replaced 1 block(s) in notes.txt.") });
  const write = nextCallId();
  await ctx.send({ sessionUpdate: "tool_call", toolCallId: write, title: "write", status: "in_progress", kind: "edit", rawInput: { path: "hello.txt", content: "hi" } });
  await ctx.send({ sessionUpdate: "tool_call_update", toolCallId: write, status: "completed", content: text("Successfully wrote 2 bytes to hello.txt") });
  await bash(ctx, "seq 1 3", ["1\n", "2\n", "3\n"], { status: "completed", output: "1\n2\n3\n" });
  await bash(ctx, "cat does-not-exist.txt", ["cat: does-not-exist.txt: No such file or directory\n"], {
    status: "failed",
    output: "cat: does-not-exist.txt: No such file or directory\n\n\nCommand exited with code 1",
  });
  await say(ctx, "README read, notes edited, hello.txt written, seq succeeded and the expected cat failed.\n");
  return { stopReason: "end_turn" };
}

/** The request 1.2.2 sends: a fresh UUID for `toolCallId` (not the call's own), no `kind`, `Yes` and `No` both `allow_once`. */
function requestApproval(ctx: ScenarioContext, tool: string, detail: string): Promise<RequestPermissionResponse> {
  return ctx.requestPermission({
    toolCall: {
      toolCallId: randomUUID(),
      title: `⚠️ Tool "${tool}" requires approval:\n\n${detail}Allow?`,
      status: "pending",
    },
    options: [
      { optionId: "0", name: "Yes", kind: "allow_once" },
      { optionId: "1", name: "No", kind: "allow_once" },
    ],
  });
}

const approved = (response: RequestPermissionResponse): boolean =>
  response.outcome.outcome === "selected" && response.outcome.optionId === "0";

/** The `script` turn's command: 30 lines, so the question is longer than the card. */
export const AUGGIE_1_SCRIPT = Array.from({ length: 30 }, (_, i) => `echo step ${i + 1}`).join("\n");

async function permission(ctx: ScenarioContext, command = "echo allowed-probe"): Promise<PromptResponse> {
  const indented = command
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
  const answer = await requestApproval(ctx, "bash", `${indented}\n\n`);
  if (approved(answer)) {
    const output = command === "echo allowed-probe" ? "allowed-probe\n" : "done\n";
    await bash(ctx, command, [output], { status: "completed", output });
    await say(ctx, output);
  } else {
    const toolCallId = nextCallId();
    await ctx.send({ sessionUpdate: "tool_call", toolCallId, title: "bash", status: "in_progress", kind: "execute", rawInput: { command } });
    await ctx.send({ sessionUpdate: "tool_call_update", toolCallId, status: "failed", content: text(DENIED.replace("{tool}", "bash")) });
    await say(ctx, "The shell command was refused pending manual approval.\n");
  }
  return { stopReason: "end_turn" };
}

async function held(ctx: ScenarioContext): Promise<PromptResponse> {
  const rawInput = { path: "held.txt", content: "held" };
  // The request is open while the real call goes out; `session/cancel` is not acted on until it is answered.
  const asked = requestApproval(ctx, "write", "");
  const toolCallId = nextCallId();
  await ctx.send({ sessionUpdate: "tool_call", toolCallId, title: "write", status: "in_progress", kind: "edit", rawInput });
  const answer = await asked;
  if (approved(answer)) {
    await ctx.send({ sessionUpdate: "tool_call_update", toolCallId, status: "completed", content: text("Successfully wrote 4 bytes to held.txt") });
    await say(ctx, "held.txt written.\n");
  } else {
    await ctx.send({ sessionUpdate: "tool_call_update", toolCallId, status: "failed", content: text(DENIED.replace("{tool}", "write")) });
    await say(ctx, "The file write was refused pending manual approval.\n");
  }
  return { stopReason: "end_turn" };
}

/** How long the `slow` command runs when nobody cancels it (a real `sleep 30`). */
const SLOW_MS = 30_000;

async function slow(ctx: ScenarioContext): Promise<PromptResponse> {
  const toolCallId = nextCallId();
  await ctx.send({
    sessionUpdate: "tool_call",
    toolCallId,
    title: "bash",
    status: "in_progress",
    kind: "execute",
    rawInput: { command: "sleep 30 && echo slept" },
  });
  await ctx.send({ sessionUpdate: "tool_call_update", toolCallId, status: "in_progress", content: [] });
  // Waits for the cancellation itself, not through ctx.sleep (which a delay scale of 0 would skip).
  const finished = await new Promise<boolean>((resolve) => {
    if (ctx.cancelled.aborted) return resolve(false);
    const timer = setTimeout(() => resolve(true), SLOW_MS);
    ctx.cancelled.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve(false);
    }, { once: true });
  });
  if (finished) {
    await ctx.send({ sessionUpdate: "tool_call_update", toolCallId, status: "completed", content: text("slept\n") });
    await say(ctx, "It finished.\n");
  } else {
    await ctx.send({ sessionUpdate: "tool_call_update", toolCallId, status: "failed", content: text("Command aborted") });
  }
  // 1.2.2 answers end_turn after a cancel (the ACP spec says cancelled).
  return { stopReason: "end_turn" };
}

export const auggie1Scenario: Scenario = {
  name: "auggie-1",
  harness: { sessions: true, indexing: true },

  initialize() {
    return {
      agentInfo: { ...AUGGIE_1_INFO },
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: true },
        sessionCapabilities: { resume: {}, close: {}, list: {}, additionalDirectories: {} },
      },
    } as ReturnType<NonNullable<Scenario["initialize"]>>;
  },

  newSession(_request, sessionId) {
    return { configOptions: [auggieModelOption(currentModels.get(sessionId) ?? AUGGIE_1_DEFAULT_MODEL)] };
  },

  setConfigOption(request: SetSessionConfigOptionRequest): SetSessionConfigOptionResponse {
    if (request.configId !== "model") {
      throw new RequestError(-32603, "Internal error", { details: `Unknown config option ${request.configId}` });
    }
    const value = (request as { value?: unknown }).value;
    if (typeof value !== "string" || !AUGGIE_1_MODELS.some((model) => model.value === value)) {
      throw new RequestError(-32603, "Internal error", { details: `Unknown model ${String(value)}` });
    }
    currentModels.set(request.sessionId, value);
    return { configOptions: [auggieModelOption(value)] };
  },

  async prompt(ctx: ScenarioContext): Promise<PromptResponse> {
    const asked = ctx.prompt.map((block) => (block.type === "text" ? block.text : "")).join("").toLowerCase();
    if (asked.includes("held")) return held(ctx);
    if (asked.includes("slow")) return slow(ctx);
    if (asked.includes("script")) return permission(ctx, AUGGIE_1_SCRIPT);
    if (asked.includes("permission")) return permission(ctx);
    if (asked.includes("tools")) return tools(ctx);
    await say(ctx, "Hello from fake Auggie.\n");
    return { stopReason: "end_turn" };
  },
};
