// Phase-1a task 1.1: feeds long-session's `--items 5000` stream through
// acp-model's reducer and checks the item count, the needle, the item kinds,
// the failure and plan cadence and the execute output bounds. The old
// row-estimate test (task 4.3, sized for the inline replay budget) is retired.
import { describe, expect, test } from "bun:test";
import { createSession, reduce, type Item, type Session, type ToolCallItem } from "acp-model";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import {
  LONG_SESSION_DEFAULT_ITEMS,
  LONG_SESSION_EXECUTE_MAX_LINES,
  LONG_SESSION_EXECUTE_MIN_LINES,
  LONG_SESSION_NEEDLE,
  generateLongSessionItems,
  longSessionNeedleIndex,
} from "../src/long-session-items.ts";
import { spawnFakeAgent } from "./helpers.ts";

interface Run {
  readonly updates: SessionUpdate[];
  readonly model: Session;
  readonly stopReason: string;
}

async function runLongSession(items?: number): Promise<Run> {
  const updates: SessionUpdate[] = [];
  const handle = spawnFakeAgent({
    scenario: "long-session",
    ...(items === undefined ? {} : { items }),
    client: {
      async sessionUpdate(params) {
        updates.push(params.update);
      },
      async requestPermission() {
        throw new Error("long-session does not request permission");
      },
    },
  });
  try {
    await handle.conn.initialize({ protocolVersion: 1 });
    const session = await handle.conn.newSession({ cwd: "/tmp", mcpServers: [] });
    const result = await handle.conn.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "replay everything" }],
    });
    let model: Session = createSession();
    let at = 0;
    model = reduce(model, { type: "prompt_sent", text: "replay everything", at: at++ });
    for (const update of updates) {
      model = reduce(model, { type: "session_update", update, at: at++ });
    }
    model = reduce(model, { type: "prompt_response", stopReason: result.stopReason, at: at++ });
    return { updates, model, stopReason: result.stopReason };
  } finally {
    handle.stop();
  }
}

function itemsOf(model: Session): Item[] {
  return model.order.map((id) => model.items.get(id) as Item);
}

function toolText(item: ToolCallItem): string {
  return item.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
}

describe("fake-agent long-session --items 5000 through the acp-model reducer (phase-1a task 1.1)", () => {
  test("yields the requested items, the needle once at the expected place, and every item kind", async () => {
    const n = 5000;
    const { model, stopReason } = await runLongSession(n);
    expect(stopReason).toBe("end_turn");

    const items = itemsOf(model);
    // The prompt item, then exactly n emitted items, then the committed plan and the turn-end marker.
    expect(items.length).toBeGreaterThanOrEqual(n);
    expect(items).toHaveLength(1 + n + 2);
    expect(items[0]?.kind).toBe("user_message");
    expect(items.at(-2)?.kind).toBe("plan");
    expect(items.at(-1)).toMatchObject({ kind: "marker", markerKind: "turn_end" });

    // The needle: exactly once, in a tool output, at emitted item n - 500 (zero-based).
    const needleIndex = longSessionNeedleIndex(n);
    expect(needleIndex).toBe(4500);
    const holders = items.filter((item) => JSON.stringify(item).includes(LONG_SESSION_NEEDLE));
    expect(holders).toHaveLength(1);
    const holder = holders[0] as ToolCallItem;
    expect(holder.kind).toBe("tool_call");
    expect(holder.toolKind).toBe("execute");
    expect(toolText(holder).split(LONG_SESSION_NEEDLE)).toHaveLength(2);
    expect(items.indexOf(holder)).toBe(1 + (needleIndex as number));
    expect(n - (needleIndex as number)).toBe(500);

    // Every item kind (a permission record needs a client answer, so long-session has none).
    const kinds = new Set(items.map((item) => item.kind));
    for (const kind of ["user_message", "agent_message", "thought", "tool_call", "plan", "marker"]) {
      expect(kinds).toContain(kind as Item["kind"]);
    }
    const tools = items.filter((item): item is ToolCallItem => item.kind === "tool_call");
    for (const toolKind of ["read", "search", "edit", "execute"]) {
      expect(tools.some((t) => t.toolKind === toolKind)).toBe(true);
    }
    expect(tools.some((t) => t.content.some((c) => c.type === "diff"))).toBe(true);
  }, 120000);

  test("cadence: a failure per 50 items, a plan per 25, execute outputs of 20 to 400 lines, reads and searches in runs", async () => {
    const n = 5000;
    const { model, updates } = await runLongSession(n);
    const tools = itemsOf(model).filter((item): item is ToolCallItem => item.kind === "tool_call");

    expect(tools.filter((t) => t.toolStatus === "failed")).toHaveLength(n / 50);
    expect(updates.filter((u) => u.sessionUpdate === "plan")).toHaveLength(n / 25);

    const executes = tools.filter((t) => t.toolKind === "execute");
    for (const execute of executes) {
      if (execute.toolStatus === "failed") continue;
      // The output is fenced as claude-agent-acp sends it (mvp-rendering task 9.2): the lines
      // inside the fence.
      const lines = toolText(execute).split("\n").length - 2;
      expect(lines).toBeGreaterThanOrEqual(LONG_SESSION_EXECUTE_MIN_LINES);
      expect(lines).toBeLessThanOrEqual(LONG_SESSION_EXECUTE_MAX_LINES);
    }
    expect(Math.max(...executes.map((t) => toolText(t).split("\n").length - 2))).toBeGreaterThan(200);
    for (const tool of tools) if (tool.toolKind !== "edit" && tool.toolStatus !== "failed") expect(toolText(tool)).toMatch(/^```[a-z]*\n[\s\S]*\n```$/);

    // Runs of 3 to 6 consecutive read or search calls (a run can merge with a
    // neighbouring read or search only where the cycle puts them side by side).
    const isLookup = (item: Item): boolean =>
      item.kind === "tool_call" && (item.toolKind === "read" || item.toolKind === "search");
    const runs: number[] = [];
    let current = 0;
    for (const item of itemsOf(model)) {
      if (isLookup(item)) {
        current += 1;
      } else if (current > 0) {
        runs.push(current);
        current = 0;
      }
    }
    expect(runs.length).toBeGreaterThan(100);
    expect(runs.filter((r) => r >= 3 && r <= 6).length / runs.length).toBeGreaterThan(0.95);
  }, 120000);
});

describe("fake-agent long-session content", () => {
  test("defaults to 200 items, with no needle below 500 items", async () => {
    const { model, stopReason } = await runLongSession();
    expect(stopReason).toBe("end_turn");
    expect(LONG_SESSION_DEFAULT_ITEMS).toBe(200);
    expect(itemsOf(model)).toHaveLength(1 + 200 + 2);
    expect(JSON.stringify(itemsOf(model))).not.toContain(LONG_SESSION_NEEDLE);
    expect(longSessionNeedleIndex(499)).toBeNull();
    expect(longSessionNeedleIndex(500)).toBe(0);
  }, 30000);

  test("is deterministic: the same count gives the same items", () => {
    const first = [...generateLongSessionItems(600)];
    const second = [...generateLongSessionItems(600)];
    expect(first).toHaveLength(600);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    // Item content does not depend on the total, away from the special slots.
    const shorter = [...generateLongSessionItems(120)];
    expect(JSON.stringify(shorter.slice(0, 5))).toBe(JSON.stringify(first.slice(0, 5)));
  });

  test("unfenced (`long-session-plain`): the same items, each tool output the lines inside its fence", () => {
    const fenced = [...generateLongSessionItems(600)];
    const plain = [...generateLongSessionItems(600, { fenced: false })];
    expect(plain).toHaveLength(fenced.length);
    let unfenced = 0;
    fenced.forEach((item, i) => {
      const other = plain[i]!;
      if (item.kind !== "tool" || other.kind !== "tool" || item.output === null || item.failed) {
        expect(other).toEqual(item);
        return;
      }
      expect({ ...other, output: null }).toEqual({ ...item, output: null });
      expect(other.output).not.toContain("```");
      expect(item.output).toBe(`\`\`\`${item.output.slice(3, item.output.indexOf("\n"))}\n${other.output}\n\`\`\``);
      unfenced += 1;
    });
    expect(unfenced).toBeGreaterThan(200);
  });

  test("`long-session-plain` sends the history with plain tool output", async () => {
    const updates: SessionUpdate[] = [];
    const handle = spawnFakeAgent({
      scenario: "long-session-plain",
      items: 120,
      client: {
        async sessionUpdate(params) {
          updates.push(params.update);
        },
        async requestPermission() {
          throw new Error("long-session-plain does not request permission");
        },
      },
    });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: "/tmp", mcpServers: [] });
      const result = await handle.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "go" }] });
      expect(result.stopReason).toBe("end_turn");
    } finally {
      handle.stop();
    }
    const texts = updates.flatMap((u) =>
      u.sessionUpdate === "tool_call_update" ? (u.content ?? []).flatMap((c) => (c.type === "content" && c.content.type === "text" ? [c.content.text] : [])) : [],
    );
    expect(texts.length).toBeGreaterThan(20);
    for (const text of texts) expect(text).not.toContain("```");
  }, 30000);
});

describe("fake-agent long-session later prompts", () => {
  test("the history is sent on the first prompt only; a second prompt yields one new item with a new ID", async () => {
    const updates: SessionUpdate[][] = [[], []];
    let turn = 0;
    const handle = spawnFakeAgent({
      scenario: "long-session",
      items: 60,
      client: {
        async sessionUpdate(params) {
          updates[turn]?.push(params.update);
        },
        async requestPermission() {
          throw new Error("long-session does not request permission");
        },
      },
    });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: "/tmp", mcpServers: [] });
      const first = await handle.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "one" }] });
      turn = 1;
      const second = await handle.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "two" }] });
      expect(first.stopReason).toBe("end_turn");
      expect(second.stopReason).toBe("end_turn");

      const idOf = (u: SessionUpdate): string | null | undefined =>
        "toolCallId" in u ? u.toolCallId : "messageId" in u ? u.messageId : undefined;
      const firstIds = new Set(updates[0]!.map(idOf).filter((id) => id != null));
      expect(firstIds.size).toBe(60);
      expect(updates[1]).toHaveLength(1);
      const reply = updates[1]![0]!;
      expect(reply.sessionUpdate).toBe("agent_message_chunk");
      expect(idOf(reply)).toBeTruthy();
      expect(firstIds.has(idOf(reply)!)).toBe(false);

      // Through the reducer: the second turn adds exactly one agent message and leaves the first turn's items alone.
      let model: Session = createSession();
      let at = 0;
      model = reduce(model, { type: "prompt_sent", text: "one", at: at++ });
      for (const update of updates[0]!) model = reduce(model, { type: "session_update", update, at: at++ });
      model = reduce(model, { type: "prompt_response", stopReason: first.stopReason, at: at++ });
      const before = itemsOf(model);
      model = reduce(model, { type: "prompt_sent", text: "two", at: at++ });
      for (const update of updates[1]!) model = reduce(model, { type: "session_update", update, at: at++ });
      model = reduce(model, { type: "prompt_response", stopReason: second.stopReason, at: at++ });
      const after = itemsOf(model);
      expect(after.slice(0, before.length)).toEqual(before);
      expect(after.slice(before.length).map((i) => i.kind)).toEqual(["user_message", "agent_message", "marker"]);
    } finally {
      handle.stop();
    }
  }, 30000);
});
