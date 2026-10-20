// Shared by fast-tools.test.ts and fast-tools.timing.test.ts (split by the change parallel-tests, tasks 3.x). Not a test file.
import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { makeTempDir, spawnFakeAgent } from "./helpers.ts";

export interface Entry {
  readonly ts: string;
  readonly method: string;
  readonly params: { readonly toolCallId?: string; readonly status?: string };
}

export async function run(delayScale: number, cancelAfterMs?: number): Promise<{ stopReason: string; entries: Entry[]; updates: SessionUpdate[]; ended: number }> {
  const logPath = `${makeTempDir()}/log.jsonl`;
  const updates: SessionUpdate[] = [];
  const handle = spawnFakeAgent({
    scenario: "fast-tools",
    delayScale,
    logPath,
    client: {
      async sessionUpdate(params) {
        updates.push(params.update);
      },
      async requestPermission() {
        throw new Error("fast-tools asks for no permission");
      },
    },
  });
  let stopReason = "";
  let ended = 0;
  try {
    await handle.conn.initialize({ protocolVersion: 1 });
    const session = await handle.conn.newSession({ cwd: "/tmp", mcpServers: [] });
    const started = performance.now();
    const pending = handle.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "go" }] });
    if (cancelAfterMs !== undefined) {
      await Bun.sleep(cancelAfterMs);
      await handle.conn.cancel({ sessionId: session.sessionId });
    }
    stopReason = (await pending).stopReason;
    ended = performance.now() - started;
  } finally {
    handle.stop();
  }
  const entries = readFileSync(logPath, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Entry)
    .filter((entry) => entry.method === "fast-tools/sent");
  return { stopReason, entries, updates, ended };
}

export const at = (entries: readonly Entry[], toolCallId: string, status: string): number => {
  const entry = entries.find((candidate) => candidate.params.toolCallId === toolCallId && candidate.params.status === status);
  expect(entry).toBeDefined();
  return Date.parse(entry!.ts);
};
