// Test helper: builds the command line for fake-agent's entry point, so
// acp-tui's own headless agent tests need neither network nor credentials
// (mirrors fake-agent's own test/helpers.ts, from the client side this
// time: acp-tui's launch.ts spawns this the same way it would spawn a real
// agent).
const FAKE_AGENT_MAIN = new URL("../../../fake-agent/src/main.ts", import.meta.url).pathname;

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
