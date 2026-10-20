// Test helper: builds the command line for fake-agent's entry point, so
// acp-tui's own headless agent tests need neither network nor credentials
// (mirrors fake-agent's own test/helpers.ts, from the client side this
// time: acp-tui's launch.ts spawns this the same way it would spawn a real
// agent).
import { fileURLToPath } from "node:url";

const FAKE_AGENT_MAIN = fileURLToPath(new URL("../../../fake-agent/src/main.ts", import.meta.url));

export interface FakeAgentCommandOptions {
  readonly scenario: string;
  readonly logPath?: string;
  readonly delayScale?: number;
}

export function fakeAgentCommand(options: FakeAgentCommandOptions): string[] {
  const args = ["bun", FAKE_AGENT_MAIN, "--scenario", options.scenario, "--delay-scale", String(options.delayScale ?? 0)];
  if (options.logPath) {
    args.push("--log", options.logPath);
  }
  return args;
}

/**
 * What `promise` rejects with; fails the test if it resolves. Use this, not
 * `await expect(promise).rejects`, for a promise that settles on a child's output: Bun (1.4.3)
 * waits for a pending promise given to `expect().rejects` in a nested event loop, and on Windows
 * that loop does not read the child's stdout pipe, so the answer never arrives, the test times out
 * and the file never exits. Awaiting the promise here keeps the wait in the test's own loop.
 */
export async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the promise to reject, but it resolved");
}
