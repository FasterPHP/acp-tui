// harness-feedback task group 3 (spec tui-agent-session "Start-up timeout" and "Harness that is not
// an ACP harness"): the stdout watch and the silence timer against fake-agent, under a connection
// made with the start-up watch. The timeouts here are fractions of a second (the setting itself
// takes 5 to 600); the tests whose outcome depends on the timing of messages are in
// startup-watch.timing.test.ts.
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection, initializeAgent, createNewSession, AgentNotAcpError, AgentStartupTimeoutError, AgentStartupError, type AcpClient } from "../../src/agent/connection.ts";
import { launchAgent } from "../../src/agent/launch.ts";
import { StdoutInspector } from "../../src/agent/startup-watch.ts";
import type { DebugLogger } from "../../src/log.ts";
import { fakeAgentCommand, rejectionOf } from "./fake-agent-command.ts";

const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text);
const JSON_RPC = `{"jsonrpc":"2.0","id":0,"result":{}}\n`;

function noopClient(): AcpClient {
  return {
    async requestPermission() {
      return { outcome: { outcome: "cancelled" } };
    },
    async sessionUpdate() {},
  };
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("the stdout watch's verdicts (StdoutInspector)", () => {
  test("a raw escape character fails at once, whatever the chunk", () => {
    expect(new StdoutInspector().feed(bytes("\x1b[?1049h"))).toBe("escape");
    expect(new StdoutInspector().feed(bytes("plain\n\x1b[2J"))).toBe("escape");
  });

  test("an escape byte split across chunks is still seen (the lines are joined, not each chunk looked at alone)", () => {
    const inspector = new StdoutInspector();
    expect(inspector.feed(bytes("hello wor"))).toBeNull();
    expect(inspector.feed(bytes("ld \x1b"))).toBe("escape");
    // A multi-byte character split between chunks does not trip it.
    const split = new StdoutInspector();
    const euro = bytes("€");
    expect(split.feed(euro.slice(0, 1))).toBeNull();
    expect(split.feed(euro.slice(1))).toBeNull();
  });

  test("three non-empty lines that are not JSON fail; one or two, and blank lines, do not", () => {
    const inspector = new StdoutInspector();
    expect(inspector.feed(bytes("banner one\n"))).toBeNull();
    expect(inspector.feed(bytes("\n   \nbanner two\n"))).toBeNull();
    expect(inspector.feed(bytes("banner th"))).toBeNull();
    expect(inspector.feed(bytes("ree\n"))).toBe("lines");
  });

  test("the first JSON-RPC line steps the watch aside; JSON that is not JSON-RPC neither counts nor ends it", () => {
    const inspector = new StdoutInspector();
    expect(inspector.feed(bytes('{"level":"info"}\n{"level":"info"}\n{"level":"info"}\n{"level":"info"}\n'))).toBeNull();
    expect(inspector.feed(bytes(JSON_RPC))).toBe("ok");
  });

  test("a JSON line holding the escaped \\u001b is not a raw escape character", () => {
    expect(new StdoutInspector().feed(bytes('{"jsonrpc":"2.0","method":"x","params":{"text":"\\u001b[2J"}}\n'))).toBe("ok");
  });

  test("banner lines before the first message are let through", () => {
    const inspector = new StdoutInspector();
    expect(inspector.feed(bytes(`welcome\nversion 1\n${JSON_RPC}`))).toBe("ok");
  });
});

describe("connection with the start-up watch", () => {
  const cwd = () => mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-startup-"));

  test("Never answers initialize: the harness is ended and the error names it, initialize and the seconds", async () => {
    const command = [...fakeAgentCommand({ scenario: "basic" }), "--no-initialize"];
    const agent = launchAgent(command, { harness: "fake" });
    const events: Record<string, unknown>[] = [];
    const logger = { enabled: true, log: (e: Record<string, unknown>) => void events.push(e) } as unknown as DebugLogger;
    const conn = createConnection(agent, () => noopClient(), undefined, undefined, { command, timeoutSeconds: 0.3, logger });
    const error = await rejectionOf(initializeAgent(conn, agent, command, { logger }));
    expect(error).toBeInstanceOf(AgentStartupTimeoutError);
    const message = (error as Error).message;
    expect(message).toContain("harness 'fake' (command '");
    expect(message).toContain("did not answer initialize within 0 s and was stopped");
    expect(events).toContainEqual({ event: "startup_timeout", request: "initialize", seconds: 0 });
    await agent.exited;
    expect(running(agent.proc.pid)).toBe(false);
  });

  test("a harness that prints terminal output is ended and refused; the message quotes none of it", async () => {
    for (const mode of ["--print-terminal", "--print-terminal=lines"]) {
      const command = [...fakeAgentCommand({ scenario: "basic" }), mode];
      const agent = launchAgent(command);
      const conn = createConnection(agent, () => noopClient(), undefined, undefined, { command, timeoutSeconds: 30 });
      const error = await rejectionOf(initializeAgent(conn, agent, command));
      expect(error).toBeInstanceOf(AgentNotAcpError);
      const message = (error as Error).message;
      expect(message).toContain("ad hoc harness command '");
      expect(message).toContain("does not look like an ACP harness: it printed terminal output; ACP harnesses usually need an argument such as acp or --acp");
      expect(message).not.toContain("\x1b");
      expect(message).not.toContain("1049");
      await agent.exited;
      expect(running(agent.proc.pid)).toBe(false);
    }
  });

  test("a harness that exits on its own is still reported as exited, not as a timeout", async () => {
    const command = ["bun", "-e", "process.exit(3)"];
    const agent = launchAgent(command);
    const conn = createConnection(agent, () => noopClient(), undefined, undefined, { command, timeoutSeconds: 30 });
    expect(await rejectionOf(initializeAgent(conn, agent, command))).toBeInstanceOf(AgentStartupError);
  });

  test("a harness that answers is not stopped: initialize and session/new, with the watch stepping aside", async () => {
    const command = fakeAgentCommand({ scenario: "basic" });
    const agent = launchAgent(command);
    try {
      const conn = createConnection(agent, () => noopClient(), undefined, undefined, { command, timeoutSeconds: 30 });
      await initializeAgent(conn, agent, command);
      expect((await createNewSession(conn, agent, command, cwd())).sessionId).toBeTruthy();
    } finally {
      agent.proc.kill();
    }
  });
});
