// Task 5.4: headless tests of the session controller against fake-agent's
// basic, crash and prompt-error scenarios, exercising the full client
// handler + reducer wiring with no renderer involved.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DebugLogger } from "../../src/log.ts";
import { startSession, type SessionController } from "../../src/session/controller.ts";
import { fakeAgentCommand, rejectionOf } from "./fake-agent-command.ts";
import { waitFor } from "./wait-for.ts";

function tmpCwd(): string {
  return mkdtempSync(join(tmpdir(), "acp-tui-controller-"));
}

const controllers: SessionController[] = [];
async function track(controller: SessionController): Promise<SessionController> {
  controllers.push(controller);
  return controller;
}

afterEach(async () => {
  while (controllers.length > 0) {
    const controller = controllers.pop();
    await controller?.detach();
  }
});

describe("session controller (task 5.4) against fake-agent basic", () => {
  test("a full turn streams updates, opens a permission, and finishes at end_turn", async () => {
    const cwd = tmpCwd();
    const controller = await track(await startSession({ command: fakeAgentCommand({ scenario: "basic" }), cwd }));

    const result = controller.prompt("please read and edit the file");
    expect(result).toEqual({ accepted: true });

    // Refusing a second submit while the turn runs (spec "Submit while running").
    const refusal = controller.prompt("a second prompt");
    expect(refusal).toEqual({ accepted: false, reason: "turn_running" });

    const withPermission = await waitFor(controller, (session) => session.state === "requires_action");
    const permissionItem = withPermission.order
      .map((id) => withPermission.items.get(id))
      .find((item) => item?.kind === "permission_record");
    expect(permissionItem?.kind).toBe("permission_record");
    if (permissionItem?.kind !== "permission_record") throw new Error("expected a permission record");
    const allowOnce = permissionItem.options.find((option) => option.kind === "allow_once");
    expect(allowOnce).toBeDefined();
    if (!allowOnce) throw new Error("expected an allow_once option");

    const answered = controller.answerPermission(allowOnce.optionId);
    expect(answered).toBe(true);

    const finished = await waitFor(controller, (session) => session.state === "idle" && session.stopReason !== null);
    expect(finished.stopReason).toBe("end_turn");

    const kinds = finished.order.map((id) => finished.items.get(id)?.kind);
    expect(kinds).toContain("agent_message");
    expect(kinds).toContain("thought");
    expect(kinds).toContain("tool_call");
    expect(kinds).toContain("plan");
    expect(kinds).toContain("marker");

    const permissionRecord = finished.order.map((id) => finished.items.get(id)).find((item) => item?.kind === "permission_record");
    expect(permissionRecord?.kind === "permission_record" && permissionRecord.outcome.type).toBe("answered");

    const turnEndMarker = finished.order
      .map((id) => finished.items.get(id))
      .find((item) => item?.kind === "marker" && item.markerKind === "turn_end");
    expect(turnEndMarker).toBeDefined();
  });

  test("cancelling with a permission request open answers it cancelled, then cancels the turn", async () => {
    const cwd = tmpCwd();
    const controller = await track(await startSession({ command: fakeAgentCommand({ scenario: "basic" }), cwd }));

    controller.prompt("please read and edit the file");
    await waitFor(controller, (session) => session.state === "requires_action");

    controller.cancel();

    const finished = await waitFor(controller, (session) => session.state === "idle" && session.stopReason !== null);
    expect(finished.stopReason).toBe("cancelled");

    const permissionRecord = finished.order.map((id) => finished.items.get(id)).find((item) => item?.kind === "permission_record");
    expect(permissionRecord?.kind === "permission_record" && permissionRecord.outcome.type).toBe("cancelled");

    // Nothing after the permission gate should have arrived (mirrors fake-agent's own
    // basic.test.ts assertion for the same path, at the model level).
    const kinds = finished.order.map((id) => finished.items.get(id)?.kind);
    expect(kinds).not.toContain("plan");
  });

  test("onInitialized is called once, when initialize has been answered, and a hook that throws does not fail the start-up", async () => {
    const calls: number[] = [];
    const controller = await track(
      await startSession({
        command: fakeAgentCommand({ scenario: "basic" }),
        cwd: tmpCwd(),
        onInitialized() {
          calls.push(Date.now());
          throw new Error("a hook failing");
        },
      }),
    );
    expect(calls).toHaveLength(1);
    expect(controller.getSession().id).not.toBeNull();
  });

  test("onActivity reports the session, the tool call that ended and the end of the turn, in order, and a hook that throws breaks nothing", async () => {
    const seen: string[] = [];
    const controller = await track(
      await startSession({
        command: fakeAgentCommand({ scenario: "basic" }),
        cwd: tmpCwd(),
        onActivity(activity) {
          seen.push(activity);
          throw new Error("a hook failing");
        },
      }),
    );
    expect(seen).toEqual(["session"]);
    controller.prompt("please read and edit the file");
    await waitFor(controller, (session) => session.state === "requires_action");
    controller.answerPermission(
      (() => {
        const session = controller.getSession();
        const record = session.order.map((id) => session.items.get(id)).find((item) => item?.kind === "permission_record");
        if (record?.kind !== "permission_record") throw new Error("expected a permission record");
        return record.options.find((option) => option.kind === "allow_once")!.optionId;
      })(),
    );
    await waitFor(controller, (session) => session.state === "idle" && session.stopReason !== null);
    expect(seen[0]).toBe("session");
    expect(seen.at(-1)).toBe("turn_end");
    expect(seen.filter((a) => a === "turn_end")).toHaveLength(1);
  });

  test("detach sends neither session/cancel nor session/close, and the log proves it", async () => {
    const cwd = tmpCwd();
    const logDir = mkdtempSync(join(tmpdir(), "acp-tui-controller-log-"));
    const logPath = join(logDir, "fake-agent.log");
    const controller = await startSession({
      command: fakeAgentCommand({ scenario: "basic", logPath }),
      cwd,
    });

    await controller.detach();

    const lines = readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { method: string });
    const methods = lines.map((entry) => entry.method);
    expect(methods).toContain("initialize");
    expect(methods).toContain("session/new");
    expect(methods).not.toContain("session/cancel");
    expect(methods).not.toContain("session/close");

    rmSync(logDir, { recursive: true, force: true });
  });

  test("detach during a running turn records neither a prompt error nor an agent exit", async () => {
    const cwd = tmpCwd();
    const logDir = mkdtempSync(join(tmpdir(), "acp-tui-controller-log-"));
    const logPath = join(logDir, "fake-agent.log");
    const debugEvents: Record<string, unknown>[] = [];
    const controller = await startSession({
      command: fakeAgentCommand({ scenario: "basic", logPath, delayScale: 200 }),
      cwd,
      logger: { enabled: true, log: (entry) => void debugEvents.push(entry) } satisfies DebugLogger,
    });

    controller.prompt("a slow turn");
    await waitFor(controller, (session) => session.state === "running" && session.order.length > 1);

    await controller.detach();
    // Let the prompt's rejection and the exit listeners run.
    await Bun.sleep(100);

    const session = controller.getSession();
    const markers = session.order
      .map((id) => session.items.get(id))
      .filter((item) => item?.kind === "marker")
      .map((item) => (item?.kind === "marker" ? item.markerKind : null));
    expect(markers).not.toContain("error");
    expect(markers).not.toContain("notice");
    expect(session.connection).not.toBe("disconnected");
    const events = debugEvents.map((entry) => entry["event"]);
    expect(events).not.toContain("prompt_error");
    expect(events).toContain("agent_exited_after_detach");

    const methods = readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => (JSON.parse(line) as { method: string }).method);
    expect(methods).toContain("session/prompt");
    expect(methods).not.toContain("session/cancel");
    expect(methods).not.toContain("session/close");

    rmSync(logDir, { recursive: true, force: true });
  });
});

describe("session controller (task 5.4) against fake-agent crash", () => {
  test("agent exit mid-turn is recorded, connection becomes disconnected, controller stays alive", async () => {
    const cwd = tmpCwd();
    const controller = await track(await startSession({ command: fakeAgentCommand({ scenario: "crash" }), cwd }));

    controller.prompt("trigger the crash");

    const disconnected = await waitFor(controller, (session) => session.connection === "disconnected");
    expect(disconnected.state).toBe("idle");

    const notice = disconnected.order
      .map((id) => disconnected.items.get(id))
      .find((item) => item?.kind === "marker" && item.markerKind === "notice");
    expect(notice?.kind === "marker" && notice.markerKind === "notice" && notice.text).toContain("3");

    // The controller itself is still usable: calling its methods must not throw.
    expect(() => controller.cancel()).not.toThrow();
    expect(controller.answerPermission("nonexistent")).toBe(false);
    expect(controller.getSession().connection).toBe("disconnected");
  });
});

describe("session controller (task 5.4) against fake-agent prompt-error", () => {
  test("a JSON-RPC prompt error returns the session to idle with a visible error line", async () => {
    const cwd = tmpCwd();
    const controller = await track(await startSession({ command: fakeAgentCommand({ scenario: "prompt-error" }), cwd }));

    controller.prompt("this will fail");

    const finished = await waitFor(controller, (session) => session.state === "idle" && session.connection === "connected");
    const errorMarker = finished.order
      .map((id) => finished.items.get(id))
      .find((item) => item?.kind === "marker" && item.markerKind === "error");
    expect(errorMarker).toBeDefined();
  });
});

// mvp-chrome-and-keys task 5.5 (spec tui-agent-session "Permission withdrawal"): the controller
// against fake-agent's permission-withdraw at delay scale 0.1 (150 ms holds).
describe("session controller: permission withdrawal (task 5.5)", () => {
  test("a withdrawn request ends with outcome withdrawn and the session returns to running; the queued one stays open", async () => {
    const cwd = tmpCwd();
    const logPath = join(cwd, "fake-agent.log");
    const controller = await track(await startSession({ command: fakeAgentCommand({ scenario: "permission-withdraw", logPath, delayScale: 0.1 }), cwd }));
    const states: string[] = [];
    controller.subscribe((session) => {
      const record = session.items.get("permission:pw-1");
      if (record?.kind === "permission_record" && record.outcome.type === "withdrawn" && states.length === 0) states.push(session.state);
    });
    expect(controller.prompt("go")).toEqual({ accepted: true });

    // Phase 1: pw-1 withdrawn; the state right after is running (no other request open).
    await waitFor(controller, (session) => {
      const record = session.items.get("permission:pw-1");
      return record?.kind === "permission_record" && record.outcome.type === "withdrawn";
    });
    expect(states).toEqual(["running"]);

    // Phase 2: pw-2 and pw-3 open; pw-3 is withdrawn while pw-2 stays at the head.
    const afterThird = await waitFor(controller, (session) => {
      const record = session.items.get("permission:pw-3");
      return record?.kind === "permission_record" && record.outcome.type === "withdrawn";
    });
    expect(afterThird.state).toBe("requires_action");
    expect(afterThird.turn?.openPermissionToolCallIds).toEqual(["pw-2"]);
    expect(controller.answerPermission("allow-once")).toBe(true);
    const finished = await waitFor(controller, (session) => session.state === "idle");
    expect(finished.stopReason).toBe("end_turn");

    const log = readFileSync(logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { method: string; params: { code?: number } });
    expect(log.filter((e) => e.method === "session/request_permission/error").map((e) => e.params.code)).toEqual([-32800, -32800]);
  }, 20000);
});

describe("session controller: legacy model selection (session-models task 3.2)", () => {
  test("Request sent: session/set_model goes out with both parameters and the current model follows the reply", async () => {
    const dir = mkdtempSync(join(tmpdir(), "acp-tui-controller-log-"));
    const logPath = join(dir, "fake-agent.log");
    const controller = await track(await startSession({ command: fakeAgentCommand({ scenario: "config-options-models", logPath }), cwd: tmpCwd() }));
    const sessionId = controller.getSession().id;
    expect(controller.getSession().models?.currentModelId).toBe("fake-small");

    await controller.setModel("fake-large");

    expect(controller.getSession().models?.currentModelId).toBe("fake-large");
    const sent = readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { method: string; params: unknown })
      .filter((entry) => entry.method === "session/set_model");
    expect(sent.map((entry) => entry.params)).toEqual([{ sessionId, modelId: "fake-large" }]);
  });

  test("an error from the agent rejects and changes nothing", async () => {
    const controller = await track(await startSession({ command: fakeAgentCommand({ scenario: "config-options-models" }), cwd: tmpCwd() }));
    const before = controller.getSession();
    expect(await rejectionOf(controller.setModel("nope"))).toMatchObject({ code: -32602 });
    expect(controller.getSession().models).toBe(before.models);
  });

  test("Method not found: the model is unchanged and the session stays usable for prompts", async () => {
    const controller = await track(await startSession({ command: fakeAgentCommand({ scenario: "basic" }), cwd: tmpCwd() }));
    const before = controller.getSession();
    expect(await rejectionOf(controller.setModel("anything"))).toMatchObject({ code: -32601 });
    expect(controller.getSession().models).toBe(before.models);
    // A later attempt is allowed (decided 14 October 2026): it fails the same way.
    expect(await rejectionOf(controller.setModel("anything"))).toMatchObject({ code: -32601 });
    expect(controller.prompt("still works")).toEqual({ accepted: true });
    const finished = await waitFor(controller, (session) => session.state === "requires_action" || (session.state === "idle" && session.stopReason !== null));
    expect(finished.state).not.toBe("disconnected");
    controller.cancel();
  });

  test("the debug log names the request and the response and no model", async () => {
    const events: Record<string, unknown>[] = [];
    const logger: DebugLogger = { log: (event) => void events.push(event as Record<string, unknown>) } as DebugLogger;
    const controller = await track(await startSession({ command: fakeAgentCommand({ scenario: "config-options-models" }), cwd: tmpCwd(), logger }));
    await controller.setModel("fake-large");
    expect(events.filter((event) => String(event.event).startsWith("set_model"))).toEqual([{ event: "set_model_request" }, { event: "set_model_response" }]);
  });
});
