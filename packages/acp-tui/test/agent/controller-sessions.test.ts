// mvp-sessions task 5.1: the controller reopens sessions by the agent's
// capabilities, against fake-agent's session store (spec tui-sessions "Load or
// resume by the agent's capabilities"), and task 6.1's batched replay seen
// from the controller: a 5000-item load reaches the listeners in fewer than
// 500 notifications, in order, with nothing counted as another client's
// activity.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Item, Session } from "acp-model";
import { LONG_SESSION_SESSION_ID, SESSIONS_FIXTURE_PATH } from "fake-agent";
import { CannotReopenError, connectAgent, type ConnectedController } from "../../src/session/controller.ts";
import { fakeAgentCommand } from "./fake-agent-command.ts";
import { waitFor } from "./wait-for.ts";

const controllers: ConnectedController[] = [];
afterEach(async () => {
  while (controllers.length > 0) await controllers.pop()?.detach();
});

function temp(): string {
  return mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-controller-sessions-"));
}

interface Logged {
  method: string;
  params?: Record<string, unknown>;
}

function agentLog(path: string): Logged[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Logged);
}

async function connect(scenario: string, args: readonly string[], log: string): Promise<ConnectedController> {
  const controller = await connectAgent({ command: [...fakeAgentCommand({ scenario, logPath: log }), ...args], cwd: temp() });
  controllers.push(controller);
  return controller;
}

function items(session: Session): Item[] {
  return session.order.map((id) => session.items.get(id)!);
}

describe("Load or resume by the agent's capabilities (tui-sessions)", () => {
  test("Load replays the history: session/load is sent, three turns are shown as history and a prompt can be sent", async () => {
    const log = join(temp(), "agent.log");
    const controller = await connect("basic", ["--load", "--sessions", SESSIONS_FIXTURE_PATH], log);
    expect(controller.support).toEqual({ load: true, resume: false, list: false });

    expect(await controller.openSession("sess-alpha", "/work/alpha")).toBe("load");
    const session = controller.getSession();
    expect(session).toMatchObject({ id: "sess-alpha", cwd: "/work/alpha", opening: null, replaying: false, state: "idle" });
    const all = items(session);
    // The three turns: their user messages in order, each item replayed and final.
    expect(all.filter((i) => i.kind === "user_message").map((i) => (i as { text: string }).text)).toEqual([
      "Why does the router drop the query string?",
      "Go ahead.",
      "Update that test too.",
    ]);
    expect(all.every((i) => i.origin === "replay" && i.status === "final")).toBe(true);
    expect(all.filter((i) => i.kind === "tool_call")).toHaveLength(3);

    const load = agentLog(log).find((e) => e.method === "session/load");
    expect(load?.params).toEqual({ sessionId: "sess-alpha", cwd: "/work/alpha", mcpServers: [] });

    // The prompt box is ready: the next prompt is accepted and runs a turn.
    expect(controller.prompt("next step")).toEqual({ accepted: true });
    await waitFor(controller, (s) => s.state !== "idle" || s.stopReason !== null, 10000);
  });

  test("Resume only: session/resume is sent, the first item is the marker, and the next prompt continues the session", async () => {
    const log = join(temp(), "agent.log");
    const controller = await connect("copy-fixtures", ["--resume", "--sessions", SESSIONS_FIXTURE_PATH], log);
    expect(controller.support).toEqual({ load: false, resume: true, list: false });

    expect(await controller.openSession("sess-alpha", "/work/alpha")).toBe("resume");
    const first = items(controller.getSession())[0];
    expect(first).toMatchObject({ kind: "marker", markerKind: "notice", origin: "replay" });
    expect((first as { text: string }).text).toContain("history is not available from this agent");
    expect(controller.getSession().order).toHaveLength(1);

    expect(controller.prompt("carry on")).toEqual({ accepted: true });
    await waitFor(controller, (s) => s.state === "idle" && s.stopReason !== null, 10000);
    const methods = agentLog(log);
    expect(methods.find((e) => e.method === "session/resume")?.params).toEqual({ sessionId: "sess-alpha", cwd: "/work/alpha", mcpServers: [] });
    expect(methods.find((e) => e.method === "session/prompt")?.params?.["sessionId"]).toBe("sess-alpha");
    expect(methods.some((e) => e.method === "session/load" || e.method === "session/new")).toBe(false);
  });

  test("an agent with neither capability: CannotReopenError and nothing sent", async () => {
    const log = join(temp(), "agent.log");
    const controller = await connect("basic", [], log);
    await expect(controller.openSession("s-1", "/work")).rejects.toBeInstanceOf(CannotReopenError);
    expect(agentLog(log).map((e) => e.method)).toEqual(["initialize"]);
  });

  test("a prompt while the load is in progress is refused as opening, and nothing is sent", async () => {
    const log = join(temp(), "agent.log");
    // 13 updates at 2 ms x 100 each: the load takes about 2.6 s.
    const controller = await connect("basic", ["--load", "--sessions", SESSIONS_FIXTURE_PATH, "--delay-scale", "100"], log);
    const opening = controller.openSession("sess-alpha", "/work/alpha");
    await waitFor(controller, (s) => s.opening === "load");
    expect(controller.prompt("next step")).toEqual({ accepted: false, reason: "opening" });
    await opening;
    expect(agentLog(log).some((e) => e.method === "session/prompt")).toBe(false);
  });

  test("Session not found: the agent's -32002 reaches the caller with its code", async () => {
    const log = join(temp(), "agent.log");
    const controller = await connect("basic", ["--load", "--sessions", SESSIONS_FIXTURE_PATH], log);
    const error = await controller.openSession("s-9", "/work").then(
      () => null,
      (e: unknown) => e as { code?: number; message?: string },
    );
    expect(error?.code).toBe(-32002);
    expect(error?.message).toContain("Resource not found");
  });
});

describe("Batched history replay (task 6.1, from the controller)", () => {
  test("a 5000-item load (8303 updates) reaches the listeners in order in fewer than 500 notifications, none as other activity", async () => {
    const log = join(temp(), "agent.log");
    const controller = await connect("long-session", ["--items", "5000", "--load"], log);
    let notifications = 0;
    let lastLength = 0;
    let shrank = false;
    controller.subscribe((s) => {
      notifications += 1;
      if (s.order.length < lastLength) shrank = true;
      lastLength = s.order.length;
    });
    await controller.openSession(LONG_SESSION_SESSION_ID, "/work");
    const session = controller.getSession();
    expect(agentLog(log).find((e) => e.method === "session/load/response")?.params?.["updates"]).toBe(8303);
    expect(notifications).toBeLessThan(500);
    expect(notifications).toBeGreaterThan(1);
    expect(shrank).toBe(false);
    expect(session.opening).toBeNull();
    expect(items(session).some((i) => i.origin !== "replay")).toBe(false);
    // The same items as a one-by-one reduce would make: the tool indexes run 1, 2, 3 ... in order.
    const tools = items(session).filter((i) => i.kind === "tool_call") as { index: number }[];
    expect(tools.map((t) => t.index)).toEqual(tools.map((_, n) => n + 1));
  }, 60000);
});

describe("Switching sessions on one connection (task 7.4, design decision 7)", () => {
  test("reuse: a second session over the same agent process; the first is sent nothing more, and its messages are dropped", async () => {
    const log = join(temp(), "agent.log");
    const first = await connect("copy-fixtures", ["--load", "--sessions", SESSIONS_FIXTURE_PATH], log);
    await first.openSession("sess-alpha", "/work/alpha");
    const alpha = first.getSession();

    const second = first.reuse();
    expect(second.getSession().id).toBeNull();
    await second.openSession("sess-beta", "/work/alpha");
    expect(second.getSession()).toMatchObject({ id: "sess-beta", opening: null });
    expect(items(second.getSession()).filter((i) => i.kind === "user_message").map((i) => (i as { text: string }).text)).toEqual([
      "Add an Appointment model with a start and an end.",
    ]);
    // The first controller kept its last snapshot.
    expect(first.getSession()).toBe(alpha);

    // A turn of the retired session (sent only here, to see the routing): its updates reach no one.
    const betaItems = items(second.getSession()).length;
    expect(first.prompt("for alpha")).toEqual({ accepted: true });
    // The prompt's answer still reaches the controller that sent it; the turn's updates do not.
    const answered = await waitFor(first, (s) => s.state === "idle" && s.stopReason !== null, 10000);
    expect(items(answered).filter((i) => i.kind === "agent_message").length).toBe(items(alpha).filter((i) => i.kind === "agent_message").length);
    expect(items(second.getSession()).length).toBe(betaItems);

    expect(second.prompt("for beta")).toEqual({ accepted: true });
    const done = await waitFor(second, (s) => s.state === "idle" && s.stopReason !== null, 10000);
    expect(items(done).filter((i) => i.kind === "user_message").at(-1)).toMatchObject({ text: "for beta" });

    const methods = agentLog(log).map((e) => e.method);
    expect(methods.filter((m) => m === "initialize")).toHaveLength(1);
    expect(methods.filter((m) => m === "session/close" || m === "session/cancel")).toEqual([]);
    const prompts = agentLog(log).filter((e) => e.method === "session/prompt").map((e) => e.params?.["sessionId"]);
    expect(prompts).toEqual(["sess-alpha", "sess-beta"]);
  }, 30000);

  test("activate: a switch that failed hands the agent's messages back to the controller in use", async () => {
    const log = join(temp(), "agent.log");
    const first = await connect("copy-fixtures", ["--load", "--load-error", "sess-beta", "--sessions", SESSIONS_FIXTURE_PATH], log);
    await first.openSession("sess-alpha", "/work/alpha");
    const before = items(first.getSession()).length;
    const second = first.reuse();
    await expect(second.openSession("sess-beta", "/work/alpha")).rejects.toMatchObject({ code: -32002 });
    first.activate();
    expect(first.prompt("still alpha")).toEqual({ accepted: true });
    const done = await waitFor(first, (s) => s.state === "idle" && s.stopReason !== null, 10000);
    expect(items(done).length).toBeGreaterThan(before);
    expect(items(done).filter((i) => i.kind === "user_message").at(-1)).toMatchObject({ text: "still alpha" });
  }, 30000);

  test("Reply after a switch: session/set_model answered once another session is active changes neither session's model (session-models)", async () => {
    const log = join(temp(), "agent.log");
    const first = await connect("config-options-models", [], log);
    await first.newSession(temp());
    const second = first.reuse();
    // The request goes out, and the user switches before the reply arrives (a reply needs a turn
    // of the event loop, which `reuse` and `newSession` do not wait for).
    const pending = first.setModel("fake-large");
    await second.newSession(temp());
    await pending;
    expect(first.getSession().models?.currentModelId).toBe("fake-small");
    expect(second.getSession().models?.currentModelId).toBe("fake-small");
    expect(agentLog(log).filter((e) => e.method === "session/set_model")).toHaveLength(1);
  }, 30000);
});
