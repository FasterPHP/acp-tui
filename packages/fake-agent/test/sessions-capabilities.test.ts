// mvp-sessions task 2.1: the capability switches (--load, --resume, --list)
// are off by default, so every existing scenario is unchanged, and
// `initialize` advertises exactly the switched capabilities. Also the CLI
// parsing of every session switch and the fixture validation.
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "../src/cli.ts";
import { parseSessionsFixture } from "../src/sessions.ts";
import { SESSIONS_FIXTURE_PATH } from "../src/index.ts";
import { makeTempDir, recordingClient, spawnFakeAgent } from "./helpers.ts";

async function initializeWith(args: readonly string[]) {
  const { client } = recordingClient();
  const handle = spawnFakeAgent({ scenario: "basic", args, client });
  try {
    return { handle, response: await handle.conn.initialize({ protocolVersion: 1 }) };
  } catch (error) {
    handle.stop();
    throw error;
  }
}

describe("fake-agent session capability switches (mvp-sessions task 2.1)", () => {
  test("with no switch, initialize is what it was before: no load, no session capabilities", async () => {
    const { handle, response } = await initializeWith([]);
    try {
      expect(response.agentCapabilities).toEqual({
        loadSession: false,
        promptCapabilities: { image: false, audio: false, embeddedContext: true },
      });
    } finally {
      handle.stop();
    }
  });

  test("--load advertises loadSession and nothing else", async () => {
    const { handle, response } = await initializeWith(["--load"]);
    try {
      expect(response.agentCapabilities?.loadSession).toBe(true);
      expect(response.agentCapabilities?.sessionCapabilities).toBeUndefined();
    } finally {
      handle.stop();
    }
  });

  test("--resume advertises sessionCapabilities.resume only", async () => {
    const { handle, response } = await initializeWith(["--resume"]);
    try {
      expect(response.agentCapabilities?.loadSession).toBe(false);
      expect(response.agentCapabilities?.sessionCapabilities).toEqual({ resume: {} });
    } finally {
      handle.stop();
    }
  });

  test("--list advertises sessionCapabilities.list only", async () => {
    const { handle, response } = await initializeWith(["--list"]);
    try {
      expect(response.agentCapabilities?.loadSession).toBe(false);
      expect(response.agentCapabilities?.sessionCapabilities).toEqual({ list: {} });
    } finally {
      handle.stop();
    }
  });

  test("all three together advertise all three, and never close", async () => {
    const { handle, response } = await initializeWith(["--load", "--resume", "--list"]);
    try {
      expect(response.agentCapabilities?.loadSession).toBe(true);
      expect(response.agentCapabilities?.sessionCapabilities).toEqual({ list: {}, resume: {} });
      expect(response.agentCapabilities?.sessionCapabilities?.close).toBeUndefined();
    } finally {
      handle.stop();
    }
  });

  test("a method whose switch is off is method not found (-32601), though it is logged", async () => {
    const { client } = recordingClient();
    const dir = makeTempDir();
    const logPath = join(dir, "agent.jsonl");
    const handle = spawnFakeAgent({ scenario: "basic", logPath, client });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      await expect(handle.conn.loadSession({ sessionId: "x", cwd: tmpdir(), mcpServers: [] })).rejects.toMatchObject({
        code: -32601,
      });
      await expect(handle.conn.resumeSession({ sessionId: "x", cwd: tmpdir() })).rejects.toMatchObject({ code: -32601 });
      await expect(handle.conn.listSessions({})).rejects.toMatchObject({ code: -32601 });
      const methods = (await Bun.file(logPath).text())
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => (JSON.parse(line) as { method: string }).method);
      expect(methods).toEqual(["initialize", "session/load", "session/resume", "session/list"]);
    } finally {
      handle.stop();
    }
  });
});

describe("fake-agent session CLI switches", () => {
  test("defaults: everything off", () => {
    const options = parseArgs([], {});
    expect(options).toMatchObject({
      load: false,
      resume: false,
      list: false,
      persist: false,
      titleUpdate: false,
      sessionsPath: undefined,
      pageSize: undefined,
      loadErrors: [],
    });
  });

  test("takes every switch, with --load-error repeatable", () => {
    const options = parseArgs(
      [
        "--load", "--resume", "--list", "--title-update",
        "--sessions", join(tmpdir(), "s.json"), "--persist", "--page-size", "2",
        "--load-error", "a", "--load-error", "b",
      ],
      {},
    );
    expect(options).toMatchObject({
      load: true,
      resume: true,
      list: true,
      titleUpdate: true,
      sessionsPath: join(tmpdir(), "s.json"),
      persist: true,
      pageSize: 2,
      loadErrors: ["a", "b"],
    });
  });

  test("rejects a bad page size, missing values and --persist without --sessions", () => {
    for (const bad of ["0", "-1", "1.5", "many"]) {
      expect(() => parseArgs(["--page-size", bad], {})).toThrow("--page-size must be a positive integer");
    }
    expect(() => parseArgs(["--page-size"], {})).toThrow("--page-size requires a value");
    expect(() => parseArgs(["--sessions"], {})).toThrow("--sessions requires a value");
    expect(() => parseArgs(["--load-error"], {})).toThrow("--load-error requires a value");
    expect(() => parseArgs(["--persist"], {})).toThrow("--persist requires --sessions");
  });
});

describe("fake-agent sessions fixture", () => {
  test("the shipped fixture parses: four sessions, authored turns become updates", async () => {
    const sessions = parseSessionsFixture(SESSIONS_FIXTURE_PATH, await Bun.file(SESSIONS_FIXTURE_PATH).text());
    expect(sessions.map((session) => session.sessionId)).toEqual(["sess-alpha", "sess-beta", "sess-gamma", "sess-delta"]);
    expect(sessions.map((session) => session.cwd)).toEqual(["/work/alpha", "/work/alpha", "/work/alpha", "/work/beta"]);
    expect(sessions[2]?.title).toBeUndefined();
    // turn 1 of sess-alpha: user, thought, tool_call + tool_call_update, agent message.
    expect(sessions[0]?.turns[0]?.map((update) => update.sessionUpdate)).toEqual([
      "user_message_chunk",
      "agent_thought_chunk",
      "tool_call",
      "tool_call_update",
      "agent_message_chunk",
    ]);
  });

  test("a missing fixture is an error at start-up", async () => {
    const { client } = recordingClient();
    const handle = spawnFakeAgent({ scenario: "basic", args: ["--sessions", "/nonexistent/sessions.json"], client });
    try {
      const exit = await handle.proc.exited;
      expect(exit).not.toBe(0);
      expect(await new Response(handle.proc.stderr as ReadableStream).text()).toContain("cannot read sessions fixture");
    } finally {
      handle.stop();
    }
  });

  test("validation names the file and the field", () => {
    const parse = (value: unknown) => parseSessionsFixture("f.json", JSON.stringify(value));
    expect(() => parseSessionsFixture("f.json", "{")).toThrow("f.json: file is not valid JSON");
    expect(() => parse({})).toThrow('must be an object with a "sessions" array');
    expect(() => parse({ sessions: [{ cwd: "/x" }] })).toThrow("sessions[0].sessionId must be a non-empty string");
    expect(() => parse({ sessions: [{ sessionId: "a" }] })).toThrow("sessions[0].cwd must be a non-empty string");
    expect(() => parse({ sessions: [{ sessionId: "a", cwd: "/x", updatedAt: "yesterday" }] })).toThrow(
      "sessions[0].updatedAt must be an ISO 8601 timestamp",
    );
    expect(() => parse({ sessions: [{ sessionId: "a", cwd: "/x" }, { sessionId: "a", cwd: "/y" }] })).toThrow(
      "'a' appears twice",
    );
    expect(() => parse({ sessions: [{ sessionId: "a", cwd: "/x", turns: [{ tools: [{ title: "t", kind: "magic" }] }] }] })).toThrow(
      "sessions[0].turns[0].tools[0].kind must be one of",
    );
    expect(() => parse({ sessions: [{ sessionId: "a", cwd: "/x", turns: [{ updates: [{}] }] }] })).toThrow(
      "sessions[0].turns[0].updates[0] must be an object with a sessionUpdate string",
    );
  });

  test("an invalid fixture file stops the agent at start-up", async () => {
    const path = join(makeTempDir(), "bad.json");
    writeFileSync(path, '{"sessions":[{"sessionId":""}]}');
    const { client } = recordingClient();
    const handle = spawnFakeAgent({ scenario: "basic", args: ["--sessions", path], client });
    try {
      expect(await handle.proc.exited).not.toBe(0);
    } finally {
      handle.stop();
    }
  });
});
