// auggie-1x-support, spec tui-agent-session "Reasons in agent errors" and "Failed session loads in
// the debug log", against fake-agent `auggie-1`: a refused setting, a refused load and the debug
// log's `session_load_failed`.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentErrorText } from "../../src/agent/errors.ts";
import type { DebugLogEntry, DebugLogger } from "../../src/log.ts";
import { connectAgent, type ConnectedController } from "../../src/session/controller.ts";
import { openFailure } from "../../src/session/start.ts";
import { fakeAgentCommand, rejectionOf } from "./fake-agent-command.ts";
import { waitFor } from "./wait-for.ts";

const controllers: ConnectedController[] = [];
afterEach(async () => {
  while (controllers.length > 0) await controllers.pop()?.detach();
});

function recorder(): { logger: DebugLogger; events: DebugLogEntry[] } {
  const events: DebugLogEntry[] = [];
  return { events, logger: { enabled: true, log: (entry) => void events.push(entry) } };
}

async function connect(scenario: string, args: readonly string[], logger: DebugLogger): Promise<ConnectedController> {
  const cwd = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-error-reasons-"));
  const controller = await connectAgent({ command: [...fakeAgentCommand({ scenario, logPath: join(cwd, "agent.log") }), ...args], cwd, harness: "auggie", logger });
  controllers.push(controller);
  return controller;
}

describe("reasons from fake-agent auggie-1", () => {
  test("an unknown config option: the reason follows the message", async () => {
    const { logger } = recorder();
    const controller = await connect("auggie-1", [], logger);
    await controller.newSession("/work");
    const error = await rejectionOf(controller.setConfigOption("probe-nope", "x"));
    expect(agentErrorText(error)).toBe("Internal error: Unknown config option probe-nope");
  }, 20000);

  test("a prompt refused with details: the conversation's error line holds the first line of the reason", async () => {
    const { logger } = recorder();
    const controller = await connect("auggie-1-noauth", ["--offer-models"], logger);
    await controller.newSession("/work");
    controller.prompt("hello");
    await waitFor(controller, (session) => session.order.some((id) => session.items.get(id)?.kind === "marker"), 10000);
    const text = JSON.stringify([...controller.getSession().items.values()]);
    expect(text).toContain("Internal error: No API key found for unknown.");
    expect(text).not.toContain("Use /login");
  }, 20000);

  test("a refused load: the debug log holds session_load_failed with the ID, code and reason, ; openFailure reads the reason", async () => {
    const { logger, events } = recorder();
    const controller = await connect("auggie-1", [], logger);
    const error = await rejectionOf(controller.openSession("s-9", "/work"));
    const failed = events.filter((e) => e.event === "session_load_failed");
    expect(failed).toEqual([{ event: "session_load_failed", sessionId: "s-9", code: -32603, reason: "Internal error: Session s-9 not found" }]);
    const failure = openFailure(error, "s-9", { agentName: "auggie", command: "auggie", args: [] });
    expect(failure.message).toContain("Internal error: Session s-9 not found (-32603)");
  }, 20000);
});
