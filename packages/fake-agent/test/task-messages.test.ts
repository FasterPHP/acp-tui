// focus-groups task 1.1: task-messages sends two turns of plain messages (no messageId except the
// two notes), a failure on tm-3 and a plan in turn 2; --hold keeps tm-8 running until session/cancel.
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { parseArgs } from "../src/cli.ts";
import { TASK_MESSAGES } from "../src/index.ts";
import { spawnFakeAgent } from "./helpers.ts";

const T = TASK_MESSAGES;

function step(u: SessionUpdate): string {
  if (u.sessionUpdate === "tool_call") return `call ${u.toolCallId} ${u.kind} ${u.status} ${u.title}`;
  if (u.sessionUpdate === "tool_call_update") return `update ${u.toolCallId} ${u.status}`;
  if (u.sessionUpdate === "agent_message_chunk") return `message ${u.messageId ?? "-"} ${(u.content as { text: string }).text}`;
  if (u.sessionUpdate === "agent_thought_chunk") return `thought ${(u.content as { text: string }).text}`;
  return u.sessionUpdate;
}

const call = (id: keyof typeof T.tools) => [
  `call ${id} ${T.tools[id].kind} in_progress ${T.tools[id].title}`,
  `update ${id} ${T.tools[id].fails ? "failed" : "completed"}`,
];

function start(args: readonly string[] = []) {
  const updates: SessionUpdate[] = [];
  const handle = spawnFakeAgent({
    scenario: "task-messages",
    args,
    client: {
      async sessionUpdate(params) {
        updates.push(params.update);
      },
      async requestPermission() {
        throw new Error("task-messages does not request permission");
      },
    },
  });
  return { updates, handle };
}

async function prompt(handle: ReturnType<typeof start>["handle"], sessionId: string) {
  return handle.conn.prompt({ sessionId, prompt: [{ type: "text", text: "go" }] });
}

describe("fake-agent task-messages scenario (focus-groups task 1.1)", () => {
  test("turn 1 and turn 2 send their updates in order; a third prompt repeats turn 2", async () => {
    const { updates, handle } = start();
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const { sessionId } = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });

      expect((await prompt(handle, sessionId)).stopReason).toBe("end_turn");
      expect(updates.map(step)).toEqual([
        ...call("tm-1"),
        `thought ${T.turn1.thought}`,
        `message - ${T.turn1.started}`,
        ...call("tm-2"),
        ...call("tm-3"),
        ...call("tm-4"),
        `message - ${T.turn1.done}`,
        `message tm-note-a ${T.turn1.noteA.text}`,
        `message tm-note-b ${T.turn1.noteB.text}`,
        ...call("tm-5"),
        `message - ${T.turn1.task2Done}`,
        ...call("tm-6"),
      ]);
      expect(updates.some((u) => u.sessionUpdate === "plan")).toBe(false);
      expect(T.turn1.noteA.messageId).not.toBe(T.turn1.noteB.messageId);

      updates.length = 0;
      const turn2 = [
        `message - ${T.turn2.first}`,
        ...call("tm-7"),
        `thought ${T.turn2.thought}`,
        "plan",
        `message - ${T.turn2.found}`,
        ...call("tm-8"),
        `message - ${T.turn2.fixed}`,
      ];
      expect((await prompt(handle, sessionId)).stopReason).toBe("end_turn");
      expect(updates.map(step)).toEqual(turn2);

      updates.length = 0;
      expect((await prompt(handle, sessionId)).stopReason).toBe("end_turn");
      expect(updates.map(step)).toEqual(turn2);
    } finally {
      handle.stop();
    }
  });

  test("--hold keeps tm-8 in progress until session/cancel, then ends cancelled", async () => {
    const { updates, handle } = start(["--hold"]);
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const { sessionId } = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      await prompt(handle, sessionId);
      updates.length = 0;

      let settled = false;
      const turn = prompt(handle, sessionId).then((r) => {
        settled = true;
        return r;
      });
      const until = async (text: string) => {
        for (let i = 0; i < 500 && !updates.map(step).includes(text); i++) await Bun.sleep(10);
      };
      await until(`call tm-8 execute in_progress ${T.tools["tm-8"].title}`);
      await Bun.sleep(150);
      expect(settled).toBe(false);
      await handle.conn.cancel({ sessionId });
      expect((await turn).stopReason).toBe("cancelled");
      const steps = updates.map(step);
      expect(steps.at(-1)).toBe(`call tm-8 execute in_progress ${T.tools["tm-8"].title}`);
      expect(steps.some((s) => s.startsWith("update tm-8"))).toBe(false);
      expect(steps.some((s) => s.includes(T.turn2.fixed))).toBe(false);
    } finally {
      handle.stop();
    }
  });

  test("--hold is refused with any other scenario, at parsing and at start", async () => {
    expect(() => parseArgs(["--scenario", "basic", "--hold"], {})).toThrow("--hold needs --scenario task-messages");
    expect(parseArgs(["--scenario", "task-messages", "--hold"], {}).hold).toBe(true);
    expect(parseArgs(["--scenario", "task-messages"], {}).hold).toBe(false);
    const proc = Bun.spawn({
      cmd: ["bun", new URL("../src/main.ts", import.meta.url).pathname, "--scenario", "basic", "--hold"],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await proc.exited).not.toBe(0);
    expect(await new Response(proc.stderr).text()).toContain("--hold");
  });
});
