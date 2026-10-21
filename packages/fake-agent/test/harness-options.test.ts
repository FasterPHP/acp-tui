// harness-feedback task 1.1 to 1.3: --additional-directories, --add-workspace, --print-terminal,
// --session-delay, --session-heartbeat and --session-permission. The test of --no-initialize, which bounds
// a wait, is in harness-options.timing.test.ts.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import type { Client, RequestPermissionRequest, SessionUpdate } from "@agentclientprotocol/sdk";
import { makeTempDir, readLog, recordingClient, spawnFakeAgent } from "./helpers.ts";
import { SLACK_MS, timed } from "./delays-helpers.ts";

const MAIN_TS = fileURLToPath(new URL("../src/main.ts", import.meta.url));

describe("fake-agent --additional-directories and --add-workspace", () => {
  test("initialize advertises the capability only with the flag", async () => {
    const { client } = recordingClient();
    const without = spawnFakeAgent({ scenario: "basic", client });
    const withFlag = spawnFakeAgent({ scenario: "basic", args: ["--additional-directories"], client });
    try {
      const a = await without.conn.initialize({ protocolVersion: 1 });
      const b = await withFlag.conn.initialize({ protocolVersion: 1 });
      expect(a.agentCapabilities?.sessionCapabilities?.additionalDirectories).toBeUndefined();
      expect(b.agentCapabilities?.sessionCapabilities?.additionalDirectories).toEqual({});
    } finally {
      without.stop();
      withFlag.stop();
    }
  });

  test("the log carries the additionalDirectories of session/new, session/load and session/resume", async () => {
    const dir = makeTempDir();
    const logPath = join(dir, "log.jsonl");
    const { client } = recordingClient();
    const handle = spawnFakeAgent({ scenario: "basic", logPath, args: ["--additional-directories", "--load", "--resume"], client });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [], additionalDirectories: ["/one", "/two"] });
      await handle.conn.loadSession({ sessionId: session.sessionId, cwd: tmpdir(), mcpServers: [], additionalDirectories: ["/three"] });
      await handle.conn.resumeSession({ sessionId: session.sessionId, cwd: tmpdir(), additionalDirectories: ["/four"] });
      const entries = readLog(logPath);
      const dirsOf = (method: string) => (entries.find((entry) => entry.method === method)?.params as { additionalDirectories?: string[] }).additionalDirectories;
      expect(dirsOf("session/new")).toEqual(["/one", "/two"]);
      expect(dirsOf("session/load")).toEqual(["/three"]);
      expect(dirsOf("session/resume")).toEqual(["/four"]);
    } finally {
      handle.stop();
    }
  });

  test("--add-workspace is logged once at start with the directories in order", async () => {
    const logPath = join(makeTempDir(), "log.jsonl");
    const { client } = recordingClient();
    const handle = spawnFakeAgent({ scenario: "basic", logPath, args: ["--add-workspace", "/a", "--add-workspace", "/b"], client });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const entries = readLog(logPath).filter((entry) => entry.method === "argv/add-workspace");
      expect(entries).toHaveLength(1);
      expect(entries[0]?.params).toEqual({ directories: ["/a", "/b"] });
    } finally {
      handle.stop();
    }
  });
});

describe("fake-agent --print-terminal", () => {
  async function firstBytes(arg: string): Promise<string> {
    const proc = Bun.spawn({ cmd: ["bun", MAIN_TS, arg], stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    try {
      // No request is sent: whatever it writes first is all there is.
      const reader = proc.stdout.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (total < 20) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
      }
      return Buffer.concat(chunks).toString("utf8");
    } finally {
      proc.stdin.end();
      proc.kill();
    }
  }

  test("the bare flag writes ESC [ ? 1049 h and a line of text first", async () => {
    const out = await firstBytes("--print-terminal");
    expect(out.startsWith("\u001b[?1049h")).toBe(true);
    expect(out).toContain("fake-agent terminal interface\n");
  });

  test("=lines writes three plain lines with no escape byte", async () => {
    const proc = Bun.spawn({ cmd: ["bun", MAIN_TS, "--print-terminal=lines"], stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    try {
      const reader = proc.stdout.getReader();
      let text = "";
      while (text.split("\n").length < 4) {
        const { value, done } = await reader.read();
        if (done) break;
        text += Buffer.from(value).toString("utf8");
      }
      expect(text.split("\n").filter((line) => line !== "")).toHaveLength(3);
      expect(text).not.toContain("\u001b");
    } finally {
      proc.stdin.end();
      proc.kill();
    }
  });
});

describe("fake-agent --session-delay, --session-heartbeat and --session-permission", () => {
  function chunkClient(texts: string[], permissions: RequestPermissionRequest[] = []): Client {
    return {
      async sessionUpdate(params) {
        const update: SessionUpdate = params.update;
        if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") texts.push(update.content.text);
      },
      async requestPermission(params) {
        permissions.push(params);
        return { outcome: { outcome: "selected", optionId: "allow" } };
      },
    };
  }

  test("session/new answers no sooner than --session-delay, and initialize is not held back", async () => {
    const { client } = recordingClient();
    const handle = spawnFakeAgent({ scenario: "basic", args: ["--session-delay", "400"], client });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const { ms } = await timed(() => handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] }));
      expect(ms).toBeGreaterThanOrEqual(400 - SLACK_MS);
    } finally {
      handle.stop();
    }
  });

  test("session/load and session/resume wait too", async () => {
    const { client } = recordingClient();
    const handle = spawnFakeAgent({ scenario: "basic", args: ["--load", "--resume", "--session-delay", "300"], client });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      const load = await timed(() => handle.conn.loadSession({ sessionId: session.sessionId, cwd: tmpdir(), mcpServers: [] }));
      const resume = await timed(() => handle.conn.resumeSession({ sessionId: session.sessionId, cwd: tmpdir() }));
      expect(load.ms).toBeGreaterThanOrEqual(300 - SLACK_MS);
      expect(resume.ms).toBeGreaterThanOrEqual(300 - SLACK_MS);
    } finally {
      handle.stop();
    }
  });

  test("--session-heartbeat sends message chunks while the delay waits", async () => {
    const texts: string[] = [];
    const handle = spawnFakeAgent({ scenario: "basic", args: ["--session-delay", "500", "--session-heartbeat", "100"], client: chunkClient(texts) });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      expect(texts.length).toBeGreaterThanOrEqual(2);
    } finally {
      handle.stop();
    }
  });

  test("without --session-heartbeat the wait is silent", async () => {
    const texts: string[] = [];
    const handle = spawnFakeAgent({ scenario: "basic", args: ["--session-delay", "300"], client: chunkClient(texts) });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      expect(texts).toEqual([]);
    } finally {
      handle.stop();
    }
  });

  test("--session-permission asks first and the delay starts once it is answered", async () => {
    const permissions: RequestPermissionRequest[] = [];
    let answeredAt = 0;
    const client = chunkClient([], permissions);
    const slow: Client = {
      ...client,
      async requestPermission(params) {
        permissions.push(params);
        await new Promise<void>((resolve) => setTimeout(resolve, 300));
        answeredAt = performance.now();
        return { outcome: { outcome: "selected", optionId: "allow" } };
      },
    };
    const handle = spawnFakeAgent({ scenario: "basic", args: ["--session-permission", "--session-delay", "300"], client: slow });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const start = performance.now();
      await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      const end = performance.now();
      expect(permissions).toHaveLength(1);
      expect(answeredAt - start).toBeGreaterThanOrEqual(300 - SLACK_MS);
      expect(end - answeredAt).toBeGreaterThanOrEqual(300 - SLACK_MS);
    } finally {
      handle.stop();
    }
  });

  test("--session-permission without a delay asks once and then answers", async () => {
    const permissions: RequestPermissionRequest[] = [];
    const handle = spawnFakeAgent({ scenario: "basic", args: ["--session-permission"], client: chunkClient([], permissions) });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      expect(session.sessionId).toMatch(/^fake-session-/);
      expect(permissions).toHaveLength(1);
      expect(permissions[0]?.sessionId).toBe(session.sessionId);
    } finally {
      handle.stop();
    }
  });
});
