// The "task-messages" scenario (focus-groups, design D10): two turns of plain agent text without
// message IDs, as Auggie sends it, so a turn has several gaps between its messages. Only the two
// notes carry their own `messageId`s.
//
//   Turn 1 (the first prompt): read tm-1 and a thought; "Task 1 started."; execute tm-2
//     (completed), execute tm-3 (failed), read tm-4; "Task 1 done."; the notes tm-note-a and
//     tm-note-b with nothing between; edit tm-5; "Task 2 done."; read tm-6; end_turn.
//   Turn 2 (the second prompt): "Looking again."; read tm-7, a thought and a plan update;
//     "Found it."; execute tm-8 in progress; "Fixed." once tm-8 completes; end_turn.
//     With `--hold`, tm-8 stays in progress until `session/cancel` (awaited itself, not through
//     ctx.sleep, which a delay scale of 0 skips), then the turn ends `cancelled` with tm-8 left
//     in progress.
//   Any later prompt repeats turn 2.
//
// Every tool call starts `in_progress` and then completes (tm-3 fails) with one text block, and
// the next step follows one step's pause after it (`call`). The
// titles hold spaces, so acp-tui draws them as sent, never as a `rawInput` text. Delays are small
// and scaled by --delay-scale, so there are none at 0.
import type { PromptResponse } from "@agentclientprotocol/sdk";
import type { Scenario, ScenarioContext } from "../scenario.ts";

export const TASK_MESSAGES = {
  turn1: {
    started: "Task 1 started.",
    done: "Task 1 done.",
    task2Done: "Task 2 done.",
    thought: "Checking the first task before starting.",
    noteA: { messageId: "tm-note-a", text: "Note A: the cache is warm." },
    noteB: { messageId: "tm-note-b", text: "Note B: the lock was released." },
  },
  turn2: {
    first: "Looking again.",
    thought: "The failure came from the second task.",
    found: "Found it.",
    fixed: "Fixed.",
    plan: ["Reread the log", "Fix the call", "Run the check"],
  },
  /** Tool calls by ID: kind, title, the one text block of its result, and whether it fails. */
  tools: {
    "tm-1": { kind: "read", title: "Read tm-first.txt", output: "first file\n", fails: false },
    "tm-2": { kind: "execute", title: "Run tm-build", output: "build ok\n", fails: false },
    "tm-3": { kind: "execute", title: "Run tm-check", output: "check failed\n", fails: true },
    "tm-4": { kind: "read", title: "Read tm-fourth.txt", output: "fourth file\n", fails: false },
    "tm-5": { kind: "edit", title: "Edit tm-fifth.txt", output: "edited\n", fails: false },
    "tm-6": { kind: "read", title: "Read tm-sixth.txt", output: "sixth file\n", fails: false },
    "tm-7": { kind: "read", title: "Read tm-seventh.txt", output: "seventh file\n", fails: false },
    "tm-8": { kind: "execute", title: "Run tm-final", output: "final ok\n", fails: false },
  },
  /** How long each step waits at --delay-scale 1. */
  stepMs: 20,
} as const;

type ToolId = keyof typeof TASK_MESSAGES.tools;

/** Prompts answered so far, per session (one agent process serves one scenario). */
const turns = new Map<string, number>();

const say = (ctx: ScenarioContext, text: string, messageId?: string) =>
  ctx.send({ sessionUpdate: "agent_message_chunk", content: { type: "text", text }, ...(messageId === undefined ? {} : { messageId }) });

async function start(ctx: ScenarioContext, id: ToolId): Promise<void> {
  const tool = TASK_MESSAGES.tools[id];
  await ctx.send({ sessionUpdate: "tool_call", toolCallId: id, title: tool.title, kind: tool.kind, status: "in_progress" });
}

async function finish(ctx: ScenarioContext, id: ToolId): Promise<void> {
  const tool = TASK_MESSAGES.tools[id];
  await ctx.send({
    sessionUpdate: "tool_call_update",
    toolCallId: id,
    status: tool.fails ? "failed" : "completed",
    content: [{ type: "content", content: { type: "text", text: tool.output } }],
  });
}

async function call(ctx: ScenarioContext, id: ToolId): Promise<void> {
  await start(ctx, id);
  await ctx.sleep(TASK_MESSAGES.stepMs);
  await finish(ctx, id);
  // A pause after the call, so a client's linger on the finished call can be observed.
  await ctx.sleep(TASK_MESSAGES.stepMs);
}

async function turn1(ctx: ScenarioContext): Promise<PromptResponse> {
  const t = TASK_MESSAGES.turn1;
  await call(ctx, "tm-1");
  await ctx.send({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: t.thought } });
  await say(ctx, t.started);
  await call(ctx, "tm-2");
  await call(ctx, "tm-3");
  await call(ctx, "tm-4");
  await say(ctx, t.done);
  await say(ctx, t.noteA.text, t.noteA.messageId);
  await say(ctx, t.noteB.text, t.noteB.messageId);
  await call(ctx, "tm-5");
  await say(ctx, t.task2Done);
  await call(ctx, "tm-6");
  return { stopReason: "end_turn" };
}

async function turn2(ctx: ScenarioContext): Promise<PromptResponse> {
  const t = TASK_MESSAGES.turn2;
  await say(ctx, t.first);
  await call(ctx, "tm-7");
  await ctx.send({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: t.thought } });
  await ctx.send({
    sessionUpdate: "plan",
    entries: t.plan.map((content, i) => ({ content, priority: "medium" as const, status: i === 0 ? ("in_progress" as const) : ("pending" as const) })),
  });
  await say(ctx, t.found);
  await start(ctx, "tm-8");
  if (ctx.hold) {
    // Waits for the cancellation itself, not through ctx.sleep (which a delay scale of 0 would skip).
    await new Promise<void>((resolve) => {
      if (ctx.cancelled.aborted) return resolve();
      ctx.cancelled.addEventListener("abort", () => resolve(), { once: true });
    });
    return { stopReason: "cancelled" };
  }
  await ctx.sleep(TASK_MESSAGES.stepMs);
  await finish(ctx, "tm-8");
  await say(ctx, t.fixed);
  return { stopReason: "end_turn" };
}

export const taskMessagesScenario: Scenario = {
  name: "task-messages",

  async prompt(ctx: ScenarioContext): Promise<PromptResponse> {
    const n = (turns.get(ctx.sessionId) ?? 0) + 1;
    turns.set(ctx.sessionId, n);
    return n === 1 ? turn1(ctx) : turn2(ctx);
  },
};
