// mvp-chrome-and-keys task 2.5: `slow-turn` has a silent gap between two tool calls (3 s, or 45 s
// with --long-gap, both times --delay-scale), checked from the timestamps of fake-agent's log.
//
// parallel-tests task 5.1: renamed to `.timing.test.ts`, since its tests check the gap against an
// upper bound (and the arrival times with a tolerance), so they run in the serial pass; the test of
// the option parsing is in slow-turn.test.ts.
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { SLOW_TURN_GAP_MS, SLOW_TURN_LONG_GAP_MS } from "../src/scenarios/slow-turn.ts";
import { makeTempDir, spawnFakeAgent } from "./helpers.ts";

interface Entry {
  readonly ts: string;
  readonly method: string;
  readonly params: unknown;
}

async function runTurn(delayScale: number, args: readonly string[]): Promise<{ entries: Entry[]; updates: SessionUpdate[]; arrivals: number[] }> {
  const logPath = `${makeTempDir()}/log.jsonl`;
  const updates: SessionUpdate[] = [];
  const arrivals: number[] = [];
  const handle = spawnFakeAgent({
    scenario: "slow-turn",
    delayScale,
    logPath,
    args,
    client: {
      async sessionUpdate(params) {
        updates.push(params.update);
        arrivals.push(performance.now());
      },
      async requestPermission() {
        throw new Error("slow-turn asks for no permission");
      },
    },
  });
  try {
    await handle.conn.initialize({ protocolVersion: 1 });
    const session = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
    const response = await handle.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "go" }] });
    expect(response.stopReason).toBe("end_turn");
  } finally {
    handle.stop();
  }
  const entries = readFileSync(logPath, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Entry);
  return { entries, updates, arrivals };
}

/** Milliseconds between the `st-1` completion and the `st-2` start in the log. */
function gapMs(entries: readonly Entry[]): number {
  const sent = entries.filter((entry) => entry.method === "slow-turn/sent");
  expect(sent.map((entry) => entry.params)).toEqual([
    { toolCallId: "st-1", status: "in_progress" },
    { toolCallId: "st-1", status: "completed" },
    { toolCallId: "st-2", status: "in_progress" },
    { toolCallId: "st-2", status: "completed" },
  ]);
  return Date.parse(sent[2]!.ts) - Date.parse(sent[1]!.ts);
}

describe("fake-agent slow-turn scenario (task 2.5)", () => {
  test("a silent gap of 3 s x delay scale sits between the two tool calls", async () => {
    const scale = 0.1;
    const { entries, updates, arrivals } = await runTurn(scale, []);
    const gap = gapMs(entries);
    expect(gap).toBeGreaterThanOrEqual(SLOW_TURN_GAP_MS * scale - 20);
    expect(gap).toBeLessThan(SLOW_TURN_GAP_MS * scale + 400);

    // The client saw nothing during the gap: the update after the first completion arrives a gap later.
    const kinds = updates.map((update) => update.sessionUpdate);
    expect(kinds).toEqual(["agent_message_chunk", "tool_call", "tool_call_update", "tool_call", "tool_call_update", "agent_message_chunk"]);
    expect(arrivals[3]! - arrivals[2]!).toBeGreaterThanOrEqual(SLOW_TURN_GAP_MS * scale - 30);
  });

  test("--long-gap makes the gap 45 s x delay scale", async () => {
    const scale = 0.01;
    const { entries } = await runTurn(scale, ["--long-gap"]);
    const gap = gapMs(entries);
    expect(gap).toBeGreaterThanOrEqual(SLOW_TURN_LONG_GAP_MS * scale - 20);
    expect(gap).toBeLessThan(SLOW_TURN_LONG_GAP_MS * scale + 400);
  });

  test("at delay scale 0 the gap is skipped", async () => {
    const { entries } = await runTurn(0, []);
    expect(gapMs(entries)).toBeLessThan(200);
  });
});
