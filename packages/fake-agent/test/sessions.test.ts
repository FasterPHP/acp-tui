// mvp-sessions tasks 2.2 and 2.4: session/load, session/resume and
// session/list over the SDK against a real fake-agent child process; sessions
// made by session/new are loadable and listable, and survive into a second
// process with --persist; load errors, title updates, the hostile title, the
// pacing of a load by --delay-scale, and what the log records.
import { describe, expect, test } from "bun:test";
import { copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionInfo, SessionUpdate } from "@agentclientprotocol/sdk";
import { HOSTILE_SESSION_TITLE } from "../src/hostile.ts";
import { LOAD_UPDATE_DELAY_MS } from "../src/agent.ts";
import { SESSIONS_FIXTURE_PATH, SESSIONS_HOSTILE_FIXTURE_PATH } from "../src/index.ts";
import { makeTempDir, readLog, recordingClient, spawnFakeAgent, type SpawnFakeAgentOptions } from "./helpers.ts";

const ALL = ["--load", "--resume", "--list", "--sessions", SESSIONS_FIXTURE_PATH];

function open(extra: Partial<SpawnFakeAgentOptions> & { scenario?: string } = {}) {
  const { client, updates } = recordingClient();
  const handle = spawnFakeAgent({ scenario: "basic", ...extra, client });
  return { handle, updates };
}

function kinds(updates: readonly SessionUpdate[]): string[] {
  return updates.map((update) => update.sessionUpdate);
}

function textOf(update: SessionUpdate | undefined): string {
  return update && "content" in update && !Array.isArray(update.content) && update.content.type === "text"
    ? update.content.text
    : "";
}

async function listAll(
  conn: ReturnType<typeof spawnFakeAgent>["conn"],
  cwd?: string,
): Promise<{ sessions: SessionInfo[]; pages: number }> {
  const sessions: SessionInfo[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await conn.listSessions({ ...(cwd === undefined ? {} : { cwd }), ...(cursor === undefined ? {} : { cursor }) });
    sessions.push(...page.sessions);
    pages += 1;
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return { sessions, pages };
}

describe("session/load (mvp-sessions task 2.2)", () => {
  test("replays the stored turns in order as session/update notifications, then answers", async () => {
    const { handle, updates } = open({ args: ALL });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const response = await handle.conn.loadSession({ sessionId: "sess-alpha", cwd: "/work/alpha", mcpServers: [] });
      expect(response).toEqual({});
      // The three turns of sess-alpha: 5 + 6 + 2 updates (user, thought, tool pair, agent; user, two tool pairs, agent; user, agent).
      expect(kinds(updates)).toEqual([
        "user_message_chunk", "agent_thought_chunk", "tool_call", "tool_call_update", "agent_message_chunk",
        "user_message_chunk", "tool_call", "tool_call_update", "tool_call", "tool_call_update", "agent_message_chunk",
        "user_message_chunk", "agent_message_chunk",
      ]);
      expect(textOf(updates[0])).toBe("Why does the router drop the query string?");
      expect(textOf(updates[12])).toBe("Done: the test now expects the query string to be kept.");
      expect(updates[2]).toMatchObject({ sessionUpdate: "tool_call", title: "Read src/Http/Router.php", kind: "read", status: "in_progress" });
      expect(updates[3]).toMatchObject({ sessionUpdate: "tool_call_update", status: "completed" });
      expect(updates[7]).toMatchObject({ sessionUpdate: "tool_call_update", status: "completed" });
      expect(updates[9]).toMatchObject({ sessionUpdate: "tool_call_update", status: "failed" });
      // Authored messages carry no message ID.
      expect(JSON.stringify(updates)).not.toContain("messageId");
    } finally {
      handle.stop();
    }
  });

  test("every update arrives before the response (the SDK delivers in order)", async () => {
    const { handle, updates } = open({ args: ALL });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      let seenAtResponse = -1;
      const loading = handle.conn.loadSession({ sessionId: "sess-beta", cwd: "/work/alpha", mcpServers: [] }).then(() => {
        seenAtResponse = updates.length;
      });
      await loading;
      expect(seenAtResponse).toBe(2);
    } finally {
      handle.stop();
    }
  });

  test("a load answers with the scenario's config options, as session/new does", async () => {
    const { handle } = open({ scenario: "config-options", args: ALL });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const response = await handle.conn.loadSession({ sessionId: "sess-beta", cwd: "/work/alpha", mcpServers: [] });
      expect(response.configOptions?.map((option) => option.id)).toEqual(["mode", "model", "thought_level"]);
    } finally {
      handle.stop();
    }
  });

  test("prompts on a loaded session work, and the turn is added to its history", async () => {
    const { handle, updates } = open({ args: ALL });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      await handle.conn.loadSession({ sessionId: "sess-beta", cwd: "/work/alpha", mcpServers: [] });
      updates.length = 0;
      const result = await handle.conn.prompt({ sessionId: "sess-beta", prompt: [{ type: "text", text: "continue" }] });
      expect(result.stopReason).toBe("end_turn");
      expect(kinds(updates)).toContain("agent_message_chunk");

      // Loading again now replays the first turn and the new one (with the prompt as its user message).
      updates.length = 0;
      await handle.conn.loadSession({ sessionId: "sess-beta", cwd: "/work/alpha", mcpServers: [] });
      const users = updates.filter((update) => update.sessionUpdate === "user_message_chunk").map(textOf);
      expect(users).toEqual(["Add an Appointment model with a start and an end.", "continue"]);
    } finally {
      handle.stop();
    }
  });

  test("a session made by session/new in this process can be loaded and listed afterwards", async () => {
    const { handle, updates } = open({ args: ["--load", "--list"] });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const created = await handle.conn.newSession({ cwd: "/work/zeta", mcpServers: [] });
      await handle.conn.prompt({ sessionId: created.sessionId, prompt: [{ type: "text", text: "hello there" }] });
      const turnUpdates = updates.slice();
      expect(turnUpdates.length).toBeGreaterThan(5);

      const { sessions } = await listAll(handle.conn, "/work/zeta");
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({ sessionId: created.sessionId, cwd: "/work/zeta" });
      expect(Number.isNaN(Date.parse(sessions[0]?.updatedAt ?? ""))).toBe(false);

      updates.length = 0;
      await handle.conn.loadSession({ sessionId: created.sessionId, cwd: "/work/zeta", mcpServers: [] });
      // The prompt first, then everything the turn sent, in order.
      expect(textOf(updates[0])).toBe("hello there");
      expect(updates.slice(1)).toEqual(turnUpdates);
    } finally {
      handle.stop();
    }
  });

  test("an unknown session ID is -32002 Resource not found", async () => {
    const { handle } = open({ args: ALL });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      await expect(handle.conn.loadSession({ sessionId: "nope", cwd: "/work/alpha", mcpServers: [] })).rejects.toMatchObject({
        code: -32002,
        message: "Resource not found",
      });
    } finally {
      handle.stop();
    }
  });
});

describe("session/resume (mvp-sessions task 2.2)", () => {
  test("answers with no replay, and the session continues", async () => {
    const { handle, updates } = open({ args: ALL });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const response = await handle.conn.resumeSession({ sessionId: "sess-alpha", cwd: "/work/alpha" });
      expect(response).toEqual({});
      expect(updates).toHaveLength(0);
      const result = await handle.conn.prompt({ sessionId: "sess-alpha", prompt: [{ type: "text", text: "next" }] });
      expect(result.stopReason).toBe("end_turn");
      expect(updates.length).toBeGreaterThan(0);
    } finally {
      handle.stop();
    }
  });

  test("works with --resume alone, and an unknown ID is -32002", async () => {
    const { handle } = open({ args: ["--resume", "--sessions", SESSIONS_FIXTURE_PATH] });
    try {
      const init = await handle.conn.initialize({ protocolVersion: 1 });
      expect(init.agentCapabilities?.loadSession).toBe(false);
      await handle.conn.resumeSession({ sessionId: "sess-delta", cwd: "/work/beta" });
      await expect(handle.conn.resumeSession({ sessionId: "nope", cwd: "/work/beta" })).rejects.toMatchObject({ code: -32002 });
    } finally {
      handle.stop();
    }
  });
});

describe("session/list (mvp-sessions task 2.2)", () => {
  test("lists newest first, and filters by cwd", async () => {
    const { handle } = open({ args: ALL });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const all = await handle.conn.listSessions({});
      expect(all.sessions.map((session) => session.sessionId)).toEqual(["sess-alpha", "sess-beta", "sess-gamma", "sess-delta"]);
      expect(all.nextCursor).toBeUndefined();
      expect(all.sessions[0]).toEqual({
        sessionId: "sess-alpha",
        cwd: "/work/alpha",
        title: "Fix the router",
        updatedAt: "2026-10-03T09:12:00.000Z",
      });
      // sess-gamma has no title in the fixture: the key is absent, not null.
      expect(all.sessions[2]).toEqual({ sessionId: "sess-gamma", cwd: "/work/alpha", updatedAt: "2026-10-01T08:00:00.000Z" });

      const beta = await handle.conn.listSessions({ cwd: "/work/beta" });
      expect(beta.sessions.map((session) => session.sessionId)).toEqual(["sess-delta"]);
      const none = await handle.conn.listSessions({ cwd: "/work/none" });
      expect(none.sessions).toEqual([]);
    } finally {
      handle.stop();
    }
  });

  test("--page-size pages by nextCursor, and the pages add up to the unpaged list", async () => {
    const { handle } = open({ args: [...ALL, "--page-size", "3"] });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const first = await handle.conn.listSessions({});
      expect(first.sessions.map((session) => session.sessionId)).toEqual(["sess-alpha", "sess-beta", "sess-gamma"]);
      expect(typeof first.nextCursor).toBe("string");
      const second = await handle.conn.listSessions({ cursor: first.nextCursor ?? "" });
      expect(second.sessions.map((session) => session.sessionId)).toEqual(["sess-delta"]);
      expect(second.nextCursor ?? undefined).toBeUndefined();

      const paged = await listAll(handle.conn);
      expect(paged.pages).toBe(2);
      expect(paged.sessions).toHaveLength(4);

      // With a cwd filter the pages apply to the filtered list.
      const alpha = await listAll(handle.conn, "/work/alpha");
      expect(alpha.pages).toBe(1);
      expect(alpha.sessions).toHaveLength(3);
    } finally {
      handle.stop();
    }
  });

  test("page size 1 gives one page per session; an unknown cursor is invalid params", async () => {
    const { handle } = open({ args: [...ALL, "--page-size", "1"] });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      expect((await listAll(handle.conn)).pages).toBe(4);
      await expect(handle.conn.listSessions({ cursor: "garbage" })).rejects.toMatchObject({ code: -32602 });
    } finally {
      handle.stop();
    }
  });
});

describe("persisting sessions across processes (mvp-sessions task 2.2)", () => {
  test("--persist writes sessions to the fixture; a second process loads, lists and resumes them", async () => {
    const dir = makeTempDir();
    const store = join(dir, "sessions.json");
    const common = ["--load", "--resume", "--list", "--sessions", store, "--persist"];

    // Process one: the file does not exist yet; make a session and prompt it twice.
    const first = open({ args: common });
    let sessionId: string;
    let promptUpdates: SessionUpdate[];
    try {
      await first.handle.conn.initialize({ protocolVersion: 1 });
      const created = await first.handle.conn.newSession({ cwd: "/work/persist", mcpServers: [] });
      sessionId = created.sessionId;
      await first.handle.conn.prompt({ sessionId, prompt: [{ type: "text", text: "first prompt" }] });
      promptUpdates = first.updates.slice();
      await first.handle.conn.prompt({ sessionId, prompt: [{ type: "text", text: "second prompt" }] });
    } finally {
      first.handle.stop();
    }
    const written = JSON.parse(readFileSync(store, "utf8")) as { sessions: { sessionId: string; cwd: string; turns: { updates: unknown[] }[] }[] };
    expect(written.sessions).toHaveLength(1);
    expect(written.sessions[0]).toMatchObject({ sessionId, cwd: "/work/persist" });
    expect(written.sessions[0]?.turns).toHaveLength(2);

    // Process two: a new process, the same file. The session is there with its whole history.
    const second = open({ args: common });
    try {
      await second.handle.conn.initialize({ protocolVersion: 1 });
      const listed = await second.handle.conn.listSessions({ cwd: "/work/persist" });
      expect(listed.sessions.map((session) => session.sessionId)).toEqual([sessionId]);

      await second.handle.conn.loadSession({ sessionId, cwd: "/work/persist", mcpServers: [] });
      const users = second.updates.filter((update) => update.sessionUpdate === "user_message_chunk").map(textOf);
      expect(users).toEqual(["first prompt", "second prompt"]);
      // The first turn is replayed: its prompt as the user message, then what the turn sent.
      expect(second.updates.slice(1, 1 + promptUpdates.length)).toEqual(promptUpdates);

      // A new session in the second process does not collide with the persisted one's ID.
      const fresh = await second.handle.conn.newSession({ cwd: "/work/persist", mcpServers: [] });
      expect(fresh.sessionId).not.toBe(sessionId);
      second.updates.length = 0;
      await second.handle.conn.prompt({ sessionId: fresh.sessionId, prompt: [{ type: "text", text: "third" }] });
    } finally {
      second.handle.stop();
    }

    // Process three: resume sees both sessions.
    const third = open({ args: common });
    try {
      await third.handle.conn.initialize({ protocolVersion: 1 });
      expect((await third.handle.conn.listSessions({})).sessions).toHaveLength(2);
      await third.handle.conn.resumeSession({ sessionId, cwd: "/work/persist" });
      expect(third.updates).toHaveLength(0);
    } finally {
      third.handle.stop();
    }
  });

  test("without --persist the fixture file is never written", async () => {
    const dir = makeTempDir();
    const store = join(dir, "sessions.json");
    copyFileSync(SESSIONS_FIXTURE_PATH, store);
    const before = readFileSync(store, "utf8");
    const { handle } = open({ args: ["--load", "--list", "--sessions", store] });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const created = await handle.conn.newSession({ cwd: "/work/alpha", mcpServers: [] });
      await handle.conn.prompt({ sessionId: created.sessionId, prompt: [{ type: "text", text: "hi" }] });
    } finally {
      handle.stop();
    }
    expect(readFileSync(store, "utf8")).toBe(before);
  });
});

describe("load failures and titles (mvp-sessions task 2.4)", () => {
  test("--load-error <id> makes session/load and session/resume of that ID -32002 Resource not found", async () => {
    const { handle, updates } = open({ args: [...ALL, "--load-error", "sess-beta", "--load-error", "sess-gamma"] });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      for (const sessionId of ["sess-beta", "sess-gamma"]) {
        await expect(handle.conn.loadSession({ sessionId, cwd: "/work/alpha", mcpServers: [] })).rejects.toMatchObject({
          code: -32002,
          message: "Resource not found",
        });
        await expect(handle.conn.resumeSession({ sessionId, cwd: "/work/alpha" })).rejects.toMatchObject({ code: -32002 });
      }
      expect(updates).toHaveLength(0);
      // The session is still listed (the Toad case: listed but not loadable); the others load.
      expect((await handle.conn.listSessions({})).sessions.map((session) => session.sessionId)).toContain("sess-beta");
      await handle.conn.loadSession({ sessionId: "sess-alpha", cwd: "/work/alpha", mcpServers: [] });
      expect(updates.length).toBeGreaterThan(0);
    } finally {
      handle.stop();
    }
  });

  test("--title-update sends session_info_update with a title after the first turn, once", async () => {
    const { handle, updates } = open({ args: ["--load", "--list", "--title-update"] });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const created = await handle.conn.newSession({ cwd: "/work/titled", mcpServers: [] });
      await handle.conn.prompt({ sessionId: created.sessionId, prompt: [{ type: "text", text: "one" }] });
      const info = updates.filter((update) => update.sessionUpdate === "session_info_update");
      expect(info).toHaveLength(1);
      expect(info[0]).toMatchObject({ title: `Fake title for ${created.sessionId}` });
      expect(updates.at(-1)?.sessionUpdate).toBe("session_info_update");

      // Only once per session: a second turn sends none.
      updates.length = 0;
      await handle.conn.prompt({ sessionId: created.sessionId, prompt: [{ type: "text", text: "two" }] });
      expect(kinds(updates)).not.toContain("session_info_update");

      // And the title is what the list now reports.
      const listed = await handle.conn.listSessions({ cwd: "/work/titled" });
      expect(listed.sessions[0]?.title).toBe(`Fake title for ${created.sessionId}`);
    } finally {
      handle.stop();
    }
  });

  test("--title-update sends a fixture session's own title on its first turn", async () => {
    const { handle, updates } = open({ args: [...ALL, "--title-update"] });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      await handle.conn.resumeSession({ sessionId: "sess-alpha", cwd: "/work/alpha" });
      await handle.conn.prompt({ sessionId: "sess-alpha", prompt: [{ type: "text", text: "more" }] });
      const info = updates.find((update) => update.sessionUpdate === "session_info_update");
      expect(info).toMatchObject({ title: "Fix the router" });
    } finally {
      handle.stop();
    }
  });

  test("without --title-update no session_info_update is ever sent (existing scenarios are unchanged)", async () => {
    const { handle, updates } = open({ args: ALL });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const created = await handle.conn.newSession({ cwd: "/work/alpha", mcpServers: [] });
      await handle.conn.prompt({ sessionId: created.sessionId, prompt: [{ type: "text", text: "one" }] });
      expect(kinds(updates)).not.toContain("session_info_update");
    } finally {
      handle.stop();
    }
  });

  test("the hostile fixture lists a title with an OSC 8 link, a bidi override and a newline", async () => {
    const fixture = JSON.parse(readFileSync(SESSIONS_HOSTILE_FIXTURE_PATH, "utf8")) as { sessions: { title: string }[] };
    expect(fixture.sessions[0]?.title).toBe(HOSTILE_SESSION_TITLE);

    const { handle } = open({ args: ["--list", "--sessions", SESSIONS_HOSTILE_FIXTURE_PATH] });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const { sessions } = await handle.conn.listSessions({ cwd: "/work/alpha" });
      const title = sessions.find((session) => session.sessionId === "sess-hostile")?.title ?? "";
      expect(title).toBe(HOSTILE_SESSION_TITLE);
      expect(title).toContain("\u001b]8;;https://evil.example/phish\u0007");
      expect(title).toContain("‮");
      expect(title).toContain("\n");
      expect(sessions.find((session) => session.sessionId === "sess-plain")?.title).toBe("An ordinary session");
    } finally {
      handle.stop();
    }
  });
});

describe("pacing and logging (mvp-sessions task 2.5 support)", () => {
  test("--delay-scale slows a load's replay, and scale 0 does not", async () => {
    const scale = 20;
    const slow = open({ args: ALL, delayScale: scale });
    try {
      await slow.handle.conn.initialize({ protocolVersion: 1 });
      const started = performance.now();
      // sess-beta replays two updates: at least 2 x LOAD_UPDATE_DELAY_MS x scale = 80 ms.
      await slow.handle.conn.loadSession({ sessionId: "sess-beta", cwd: "/work/alpha", mcpServers: [] });
      expect(performance.now() - started).toBeGreaterThanOrEqual(2 * LOAD_UPDATE_DELAY_MS * scale * 0.9);
    } finally {
      slow.handle.stop();
    }

    const slowGate = open({ args: ALL, delayScale: 100 });
    try {
      await slowGate.handle.conn.initialize({ protocolVersion: 1 });
      // sess-alpha replays 13 updates: 2.6 s at this scale. The load is still in progress after 400 ms.
      let done = false;
      const loading = slowGate.handle.conn.loadSession({ sessionId: "sess-alpha", cwd: "/work/alpha", mcpServers: [] }).then(() => {
        done = true;
      });
      await Bun.sleep(400);
      expect(done).toBe(false);
      expect(slowGate.updates.length).toBeGreaterThan(0);
      expect(slowGate.updates.length).toBeLessThan(13);
      await loading;
      expect(slowGate.updates).toHaveLength(13);
    } finally {
      slowGate.handle.stop();
    }
  });

  test("the log records every received method, including session/close and session/cancel, and the load response", async () => {
    const logPath = join(makeTempDir(), "agent.jsonl");
    const { handle } = open({ args: ALL, logPath });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      await handle.conn.listSessions({ cwd: "/work/alpha" });
      await handle.conn.loadSession({ sessionId: "sess-beta", cwd: "/work/alpha", mcpServers: [] });
      await handle.conn.resumeSession({ sessionId: "sess-delta", cwd: "/work/beta" });
      await handle.conn.prompt({ sessionId: "sess-beta", prompt: [{ type: "text", text: "secret prompt text" }] });
      await handle.conn.cancel({ sessionId: "sess-beta" });
      await handle.conn.closeSession({ sessionId: "sess-beta" });
      await Bun.sleep(200);
    } finally {
      handle.stop();
    }
    const log = readLog(logPath);
    expect(log.map((entry) => entry.method)).toEqual([
      "initialize",
      "session/list",
      "session/load",
      "session/load/response",
      "session/resume",
      "session/resume/response",
      "session/prompt",
      "session/request_permission/response",
      "session/cancel",
      "session/close",
    ]);
    expect(log[3]?.params).toEqual({ sessionId: "sess-beta", updates: 2 });
    expect(JSON.stringify(log)).not.toContain("secret prompt text");
  });
});
