// colleague-preview, debug log: `auth_required` with `phase` and no text, for `session/new` and
// `session/prompt` answered -32000 (the controller's own events, with the controller's errors).
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LoginRequiredError } from "../../src/agent/login.ts";
import type { DebugLogEntry, DebugLogger } from "../../src/log.ts";
import { connectAgent, type ConnectedController } from "../../src/session/controller.ts";
import { fakeAgentCommand } from "./fake-agent-command.ts";
import { waitFor } from "./wait-for.ts";

const controllers: ConnectedController[] = [];
afterEach(async () => {
  while (controllers.length > 0) await controllers.pop()?.detach();
});

function recorder(): { logger: DebugLogger; events: DebugLogEntry[] } {
  const events: DebugLogEntry[] = [];
  return { events, logger: { enabled: true, log: (entry) => void events.push(entry) } };
}

async function connect(args: readonly string[], logger: DebugLogger): Promise<ConnectedController> {
  const cwd = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-auth-log-"));
  const controller = await connectAgent({ command: [...fakeAgentCommand({ scenario: "basic", logPath: join(cwd, "agent.log") }), ...args], cwd, harness: "auggie", logger });
  controllers.push(controller);
  return controller;
}

describe("auth_required debug event", () => {
  test("session/new answered -32000: LoginRequiredError and an event with the phase only", async () => {
    const { logger, events } = recorder();
    const controller = await connect(["--auth-required"], logger);
    const error = await controller.newSession("/work").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LoginRequiredError);
    expect((error as Error).message).toStartWith("harness 'auggie' needs you to log in: Authentication required");
    const logged = events.filter((e) => e.event === "auth_required");
    expect(logged).toEqual([{ event: "auth_required", phase: "new" }]);
  }, 20000);

  test("session/prompt answered -32000: the error line says to log in, the session is idle again, and the event has the phase only", async () => {
    const { logger, events } = recorder();
    const controller = await connect(["--auth-required=prompt"], logger);
    await controller.newSession("/work");
    controller.prompt("hello");
    await waitFor(controller, (session) => session.order.some((id) => session.items.get(id)?.kind === "marker"), 10000);
    expect(controller.getSession().state).toBe("idle");
    expect(JSON.stringify([...controller.getSession().items.values()])).toContain("harness 'auggie' needs you to log in");
    expect(events.filter((e) => e.event === "auth_required")).toEqual([{ event: "auth_required", phase: "prompt" }]);
  }, 20000);
});
