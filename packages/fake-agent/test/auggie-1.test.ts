// auggie-1x-support group 2: the `auggie-1` and `auggie-1-noauth` scenarios, which mimic Auggie 1.2.2
// as check A recorded it (docs/mvp-notes/auggie-1.2-probes/1.2.2-logged-in in the parent repository).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { Client, RequestPermissionRequest, SessionUpdate } from "@agentclientprotocol/sdk";
import { makeTempDir, readLog, rejectionOf, spawnFakeAgent, type FakeAgentHandle } from "./helpers.ts";

interface Rpc {
  readonly code: number;
  readonly message: string;
  readonly data?: { readonly details?: string; readonly method?: string };
}

/** A client that records updates and permission requests and answers each request with `answer(request)`. */
function testClient(answer: (request: RequestPermissionRequest) => string | "cancelled" = () => "0") {
  const updates: SessionUpdate[] = [];
  const requests: RequestPermissionRequest[] = [];
  const client: Client = {
    async sessionUpdate(params) {
      updates.push(params.update);
    },
    async requestPermission(params) {
      requests.push(params);
      const chosen = answer(params);
      return { outcome: chosen === "cancelled" ? { outcome: "cancelled" } : { outcome: "selected", optionId: chosen } };
    },
  };
  return { client, updates, requests };
}

async function started(args: readonly string[], client: Client, scenario = "auggie-1") {
  const handle = spawnFakeAgent({ scenario, args, client });
  const init = await handle.conn.initialize({ protocolVersion: 1 });
  return { handle, init };
}

const cwd = "/work/app";

/** Waits (by outcome) until `updates` holds `count` entries satisfying `predicate`. */
async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 500 && !predicate(); i += 1) await new Promise<void>((resolve) => setTimeout(resolve, 10));
  if (!predicate()) throw new Error("timed out waiting for the outcome");
}

const textOf = (update: SessionUpdate): string => {
  const content = (update as { content?: { type?: string; text?: string } }).content;
  return content?.type === "text" ? (content.text ?? "") : "";
};

async function errorOf(promise: Promise<unknown>): Promise<Rpc> {
  return (await rejectionOf(promise)) as Rpc;
}

async function prompt(handle: FakeAgentHandle, sessionId: string, value: string) {
  return handle.conn.prompt({ sessionId, prompt: [{ type: "text", text: value }] });
}

describe("auggie-1: the start", () => {
  test("initialize reports Auggie 1.2.2's identity and capabilities", async () => {
    const { client } = testClient();
    const { handle, init } = await started([], client);
    try {
      expect(init.agentInfo).toEqual({ name: "auggie", title: "Auggie Coding Agent", version: "1.2.2" });
      expect(init.agentCapabilities).toEqual({
        loadSession: true,
        promptCapabilities: { image: true },
        sessionCapabilities: { resume: {}, close: {}, list: {}, additionalDirectories: {} },
      });
    } finally {
      handle.stop();
    }
  });

  test("session/new offers one model option and no modes, and the indexing line follows", async () => {
    const { client, updates } = testClient();
    const { handle } = await started([], client);
    try {
      const session = await handle.conn.newSession({ cwd, mcpServers: [] });
      expect((session as { modes?: unknown }).modes).toBeUndefined();
      expect(session.configOptions).toHaveLength(1);
      const option = session.configOptions?.[0] as { id: string; category: string; currentValue: string; options: { value: string; name: string }[] };
      expect(option.id).toBe("model");
      expect(option.category).toBe("model");
      expect(option.currentValue).toBe("augment/butler_b");
      expect(option.options).toHaveLength(3);
      expect(option.options.find((o) => o.value === option.currentValue)?.name).toBe("Prism (GPT)");
      await until(() => updates.length > 0);
      expect(updates).toEqual([
        { sessionUpdate: "agent_message_chunk", content: { type: "text", text: 'Indexing disabled for current workspace "/work/app".\n' } },
      ]);
    } finally {
      handle.stop();
    }
  });

  test("session/set_config_option changes the model; set_model and set_mode are -32601; an unknown option is -32603 with details", async () => {
    const { client } = testClient();
    const { handle } = await started([], client);
    try {
      const session = await handle.conn.newSession({ cwd, mcpServers: [] });
      const set = await handle.conn.setSessionConfigOption({ sessionId: session.sessionId, configId: "model", value: "augment/butler_a" });
      expect((set.configOptions[0] as { currentValue: string }).currentValue).toBe("augment/butler_a");

      const mode = await errorOf(handle.conn.setSessionMode({ sessionId: session.sessionId, modeId: "plan" }));
      expect(mode).toMatchObject({ code: -32601, message: '"Method not found": session/set_mode', data: { method: "session/set_mode" } });
      const model = await errorOf(handle.conn.extMethod("session/set_model", { sessionId: session.sessionId, modelId: "x" }));
      expect(model).toMatchObject({ code: -32601, message: '"Method not found": session/set_model', data: { method: "session/set_model" } });
      const unknown = await errorOf(handle.conn.setSessionConfigOption({ sessionId: session.sessionId, configId: "probe-nope", value: "x" }));
      expect(unknown).toMatchObject({ code: -32603, message: "Internal error", data: { details: "Unknown config option probe-nope" } });
    } finally {
      handle.stop();
    }
  });

  test("chunks carry no messageId", async () => {
    const { client, updates } = testClient();
    const { handle } = await started([], client);
    try {
      const session = await handle.conn.newSession({ cwd, mcpServers: [] });
      await prompt(handle, session.sessionId, "hello");
      const chunks = updates.filter((u) => u.sessionUpdate === "agent_message_chunk");
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) expect("messageId" in chunk).toBe(false);
    } finally {
      handle.stop();
    }
  });
});

describe("auggie-1: turns", () => {
  test("tools: bare-titled calls with kind and rawInput, bash output so far, and pi's failure envelope", async () => {
    const { client, updates } = testClient();
    const { handle } = await started([], client);
    try {
      const session = await handle.conn.newSession({ cwd, mcpServers: [] });
      expect((await prompt(handle, session.sessionId, "use your tools")).stopReason).toBe("end_turn");
      const calls = updates.filter((u) => u.sessionUpdate === "tool_call") as unknown as { toolCallId: string; title: string; kind: string; rawInput: unknown; status: string }[];
      expect(calls.map((c) => [c.title, c.kind])).toEqual([
        ["read", "read"],
        ["edit", "edit"],
        ["write", "edit"],
        ["bash", "execute"],
        ["bash", "execute"],
      ]);
      for (const call of calls) {
        expect(call.toolCallId).toMatch(/^call_[0-9a-f]{32}$/);
        expect(call.status).toBe("in_progress");
        expect(call.rawInput).toBeDefined();
      }
      expect(calls[3]?.rawInput).toEqual({ command: "seq 1 3" });
      const outputs = (id: string) =>
        updates
          .filter((u) => u.sessionUpdate === "tool_call_update" && (u as { toolCallId: string }).toolCallId === id)
          .map((u) => {
            const update = u as unknown as { status: string; content: { content: { text: string } }[] };
            return [update.status, update.content?.[0]?.content.text ?? ""];
          });
      expect(outputs(calls[3]!.toolCallId)).toEqual([
        ["in_progress", ""],
        ["in_progress", "1\n"],
        ["in_progress", "1\n2\n"],
        ["in_progress", "1\n2\n3\n"],
        ["completed", "1\n2\n3\n"],
      ]);
      const failing = outputs(calls[4]!.toolCallId);
      expect(failing.at(-1)).toEqual(["failed", "cat: does-not-exist.txt: No such file or directory\n\n\nCommand exited with code 1"]);
    } finally {
      handle.stop();
    }
  });

  test("permission: a fresh UUID, Yes and No both allow_once, then the real call; Yes runs it", async () => {
    const { client, updates, requests } = testClient(() => "0");
    const { handle } = await started([], client);
    try {
      const session = await handle.conn.newSession({ cwd, mcpServers: [] });
      await prompt(handle, session.sessionId, "run it with permission");
      const request = requests[0]!;
      expect(request.toolCall.toolCallId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(request.toolCall.title).toBe('⚠️ Tool "bash" requires approval:\n\n  echo allowed-probe\n\nAllow?');
      expect(request.toolCall.status).toBe("pending");
      expect(request.toolCall.kind).toBeUndefined();
      expect(request.options).toEqual([
        { optionId: "0", name: "Yes", kind: "allow_once" },
        { optionId: "1", name: "No", kind: "allow_once" },
      ]);
      const call = updates.find((u) => u.sessionUpdate === "tool_call") as unknown as { toolCallId: string; title: string };
      expect(call.title).toBe("bash");
      expect(call.toolCallId).not.toBe(request.toolCall.toolCallId);
      expect(call.toolCallId).toMatch(/^call_/);
      const last = updates.filter((u) => u.sessionUpdate === "tool_call_update").at(-1) as unknown as { status: string };
      expect(last.status).toBe("completed");
    } finally {
      handle.stop();
    }
  });

  test.each([["No", "1"], ["a cancelled outcome", "cancelled"]])("permission: %s fails the real call with the denial text", async (_name, choice) => {
    const { client, updates } = testClient(() => choice);
    const { handle } = await started([], client);
    try {
      const session = await handle.conn.newSession({ cwd, mcpServers: [] });
      expect((await prompt(handle, session.sessionId, "permission please")).stopReason).toBe("end_turn");
      const failed = updates.filter((u) => u.sessionUpdate === "tool_call_update").at(-1) as unknown as { status: string; content: { content: { text: string } }[] };
      expect(failed.status).toBe("failed");
      const lines = failed.content[0]!.content.text.split("\n");
      expect(lines[0]).toBe("Tool execution denied: bash");
      expect(lines).toHaveLength(4);
    } finally {
      handle.stop();
    }
  });

  test("held: the real tool_call goes out while the request is open, and cancel does not end the turn", async () => {
    let release: (id: string) => void = () => {};
    const answered = new Promise<string>((resolve) => (release = resolve));
    const updates: SessionUpdate[] = [];
    const requests: RequestPermissionRequest[] = [];
    const client: Client = {
      async sessionUpdate(params) {
        updates.push(params.update);
      },
      async requestPermission(params) {
        requests.push(params);
        const choice = await answered;
        return { outcome: choice === "cancelled" ? { outcome: "cancelled" } : { outcome: "selected", optionId: choice } };
      },
    };
    const { handle } = await started([], client);
    try {
      const session = await handle.conn.newSession({ cwd, mcpServers: [] });
      let result: string | undefined;
      const turn = prompt(handle, session.sessionId, "held write").then((r) => (result = r.stopReason));
      await until(() => requests.length > 0 && updates.some((u) => u.sessionUpdate === "tool_call"));
      expect(requests[0]!.toolCall.title).toBe('⚠️ Tool "write" requires approval:\n\nAllow?');
      await handle.conn.cancel({ sessionId: session.sessionId });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      expect(result).toBeUndefined();
      release("cancelled");
      await turn;
      expect(result).toBe("end_turn");
      const last = updates.filter((u) => u.sessionUpdate === "tool_call_update").at(-1) as unknown as { status: string; content: { content: { text: string } }[] };
      expect(last.status).toBe("failed");
      expect(last.content[0]!.content.text.startsWith("Tool execution denied: write")).toBe(true);
    } finally {
      handle.stop();
    }
  });

  test("slow: runs until session/cancel, fails with Command aborted and answers end_turn", async () => {
    const { client, updates } = testClient();
    const { handle } = await started([], client);
    try {
      const session = await handle.conn.newSession({ cwd, mcpServers: [] });
      let result: string | undefined;
      const turn = prompt(handle, session.sessionId, "run something slow").then((r) => (result = r.stopReason));
      await until(() => updates.filter((u) => u.sessionUpdate === "tool_call_update").length >= 1);
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      expect(result).toBeUndefined();
      await handle.conn.cancel({ sessionId: session.sessionId });
      await turn;
      expect(result).toBe("end_turn");
      const last = updates.filter((u) => u.sessionUpdate === "tool_call_update").at(-1) as unknown as { status: string; content: { content: { text: string } }[] };
      expect(last.status).toBe("failed");
      expect(last.content[0]!.content.text).toBe("Command aborted");
    } finally {
      handle.stop();
    }
  });
});

describe("auggie-1: sessions", () => {
  test("a session is neither listed nor loadable before its first prompt, and then is, titled with it", async () => {
    const { client } = testClient();
    const { handle } = await started([], client);
    try {
      const session = await handle.conn.newSession({ cwd, mcpServers: [] });
      expect((await handle.conn.listSessions({})).sessions).toEqual([]);
      const refused = await errorOf(handle.conn.loadSession({ sessionId: session.sessionId, cwd, mcpServers: [] }));
      expect(refused).toMatchObject({ code: -32603, data: { details: `Session ${session.sessionId} not found` } });

      await prompt(handle, session.sessionId, "What single colour is this image? One word.");
      const listed = await handle.conn.listSessions({});
      expect(listed.sessions).toHaveLength(1);
      expect(listed.sessions[0]).toMatchObject({ sessionId: session.sessionId, cwd, title: "What single colour is this image? One word." });
      expect(listed.nextCursor).toBeUndefined();
      expect((await handle.conn.listSessions({ cwd: "/elsewhere" })).sessions).toEqual([]);
    } finally {
      handle.stop();
    }
  });

  test("titles are the first prompt cut to 50 characters plus ...", async () => {
    const { client } = testClient();
    const { handle } = await started([], client);
    try {
      const session = await handle.conn.newSession({ cwd, mcpServers: [] });
      await prompt(handle, session.sessionId, "Run the shell command `echo reject-by-name`. If it is refused, say so in one line and stop.");
      const [info] = (await handle.conn.listSessions({})).sessions;
      expect(info?.title).toBe("Run the shell command `echo reject-by-name`. If it...");
    } finally {
      handle.stop();
    }
  });

  test("session/load replays user and agent chunks before answering, then the indexing line", async () => {
    const dir = makeTempDir();
    const sessions = join(dir, "sessions.json");
    const first = testClient();
    const one = await started(["--sessions", sessions, "--persist"], first.client);
    let sessionId: string;
    try {
      const session = await one.handle.conn.newSession({ cwd, mcpServers: [] });
      sessionId = session.sessionId;
      await prompt(one.handle, sessionId, "hello there");
    } finally {
      one.handle.stop();
    }
    const second = testClient();
    const two = await started(["--sessions", sessions], second.client);
    try {
      const loaded = await two.handle.conn.loadSession({ sessionId, cwd, mcpServers: [] });
      expect(loaded.configOptions).toHaveLength(1);
      // The replay is in the updates before the response resolved.
      expect(second.updates.map((u) => [u.sessionUpdate, textOf(u)])).toEqual([
        ["user_message_chunk", "hello there"],
        ["agent_message_chunk", "Hello from fake Auggie.\n"],
      ]);
      for (const update of second.updates) expect("messageId" in update).toBe(false);
      await until(() => second.updates.length === 3);
      expect(textOf(second.updates[2]!)).toBe('Indexing disabled for current workspace "/work/app".\n');
      expect((await prompt(two.handle, sessionId, "again")).stopReason).toBe("end_turn");
    } finally {
      two.handle.stop();
    }
  });

  test("an unknown ID is -32603 with Session <id> not found, for load, resume and prompt", async () => {
    const { client } = testClient();
    const { handle } = await started([], client);
    try {
      const id = "00000000-0000-0000-0000-000000000000";
      const details = { details: `Session ${id} not found` };
      expect(await errorOf(handle.conn.loadSession({ sessionId: id, cwd, mcpServers: [] }))).toMatchObject({ code: -32603, message: "Internal error", data: details });
      expect(await errorOf(handle.conn.resumeSession({ sessionId: id, cwd, mcpServers: [] }))).toMatchObject({ code: -32603, data: details });
      expect(await errorOf(prompt(handle, id, "hello?"))).toMatchObject({ code: -32603, data: details });
    } finally {
      handle.stop();
    }
  });

  test("a closed session cannot be prompted, but can be resumed", async () => {
    const { client } = testClient();
    const { handle } = await started([], client);
    try {
      const session = await handle.conn.newSession({ cwd, mcpServers: [] });
      await prompt(handle, session.sessionId, "first");
      await handle.conn.closeSession({ sessionId: session.sessionId });
      expect(await errorOf(prompt(handle, session.sessionId, "hello?"))).toMatchObject({ code: -32603, data: { details: `Session ${session.sessionId} not found` } });
      await handle.conn.resumeSession({ sessionId: session.sessionId, cwd, mcpServers: [] });
      expect((await prompt(handle, session.sessionId, "again")).stopReason).toBe("end_turn");
    } finally {
      handle.stop();
    }
  });
});

describe("auggie-1: indexing", () => {
  async function lines(args: readonly string[], dir = cwd): Promise<{ texts: string[]; log: ReturnType<typeof readLog> }> {
    const logPath = join(makeTempDir(), "log.jsonl");
    const { client, updates } = testClient();
    const handle = spawnFakeAgent({ scenario: "auggie-1", args, logPath, client });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      await handle.conn.newSession({ cwd: dir, mcpServers: [] });
      // The prompt waits for the indexing lines, so they are all in by the time it answers.
      const session = (await handle.conn.newSession({ cwd: dir, mcpServers: [] })).sessionId;
      await prompt(handle, session, "hello");
      const texts = updates.filter((u) => u.sessionUpdate === "agent_message_chunk").map(textOf).filter((t) => t.startsWith("Indexing"));
      return { texts, log: existsSync(logPath) ? readLog(logPath) : [] };
    } finally {
      handle.stop();
    }
  }
  const disabled = (dir: string) => `Indexing disabled for current workspace "${dir}".\n`;

  test("one line per workspace: the session directory and each --add-workspace", async () => {
    const { texts, log } = await lines(["--add-workspace", "/work/lib", "--add-workspace", "/work/docs"]);
    // Two sessions were opened.
    expect(texts).toEqual([disabled(cwd), disabled("/work/lib"), disabled("/work/docs"), disabled(cwd), disabled("/work/lib"), disabled("/work/docs")]);
    expect(log.find((e) => e.method === "argv/add-workspace")?.params).toEqual({ directories: ["/work/lib", "/work/docs"] });
  });

  test("--allow-indexing allows them, and is logged as argv/allow-indexing", async () => {
    const { texts, log } = await lines(["--allow-indexing", "--add-workspace", "/work/lib"]);
    expect(texts).toEqual([]);
    expect(log.some((e) => e.method === "argv/allow-indexing")).toBe(true);
  });

  test("--indexing-deny refuses a directory even with the flag; the others are allowed", async () => {
    const { texts } = await lines(["--allow-indexing", "--indexing-deny", "/work/lib", "--add-workspace", "/work/lib"]);
    expect(texts).toEqual([disabled("/work/lib"), disabled("/work/lib")]);
  });

  test("--indexing-limited sends the file-limit text for that directory", async () => {
    const { texts } = await lines(["--allow-indexing", "--indexing-limited", cwd]);
    const limit = `Indexing limited for "${cwd}": file limit reached. Use a smaller workspace or exclude files with .augmentignore.\n`;
    expect(texts).toEqual([limit, limit]);
    // Without the flag too: the limit replaces the disabled line.
    expect((await lines(["--indexing-limited", cwd])).texts).toEqual([limit, limit]);
  });

  test("--indexing-store keeps what the flag allowed, and a second start reads it", async () => {
    const store = join(makeTempDir(), "settings.json");
    expect((await lines(["--allow-indexing", "--indexing-store", store])).texts).toEqual([]);
    expect(JSON.parse(readFileSync(store, "utf8"))).toEqual({ indexingAllowDirs: [cwd] });
    // A second start without the flag: nothing for the stored directory, a line for another one.
    expect((await lines(["--indexing-store", store])).texts).toEqual([]);
    expect((await lines(["--indexing-store", store, "--add-workspace", "/work/lib"])).texts).toEqual([disabled("/work/lib"), disabled("/work/lib")]);
    // A store file the agent did not write reads the same way.
    const own = join(makeTempDir(), "own.json");
    writeFileSync(own, JSON.stringify({ indexingAllowDirs: ["/work/lib"] }));
    expect((await lines(["--indexing-store", own, "--add-workspace", "/work/lib"])).texts).toEqual([disabled(cwd), disabled(cwd)]);
  });

  test("--indexing-deny beats a stored rule", async () => {
    const own = join(makeTempDir(), "own.json");
    writeFileSync(own, JSON.stringify({ indexingAllowDirs: [cwd] }));
    expect((await lines(["--indexing-store", own, "--indexing-deny", cwd])).texts).toEqual([disabled(cwd), disabled(cwd)]);
  });
});

describe("auggie-1-noauth", () => {
  test("the model option is unknown/unknown with no choices and no indexing line", async () => {
    const { client, updates } = testClient();
    const { handle, init } = await started([], client, "auggie-1-noauth");
    try {
      expect(init.agentInfo).toEqual({ name: "auggie", title: "Auggie Coding Agent", version: "1.2.2" });
      const session = await handle.conn.newSession({ cwd, mcpServers: [] });
      expect(session.configOptions).toEqual([
        { type: "select", id: "model", name: "Model", category: "model", currentValue: "unknown/unknown", options: [] },
      ]);
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      expect(updates).toEqual([]);
    } finally {
      handle.stop();
    }
  });

  test("every prompt is -32603 Internal error with pi's three lines in data.details", async () => {
    const { client } = testClient();
    const { handle } = await started([], client, "auggie-1-noauth");
    try {
      const session = await handle.conn.newSession({ cwd, mcpServers: [] });
      for (let i = 0; i < 2; i += 1) {
        const error = await errorOf(prompt(handle, session.sessionId, "say hello"));
        expect(error.code).toBe(-32603);
        expect(error.message).toBe("Internal error");
        const lines = error.data?.details?.split("\n") ?? [];
        expect(lines).toHaveLength(3);
        expect(lines[0]).toBe("No API key found for unknown.");
        expect(lines[1]).toBe("");
        expect(lines[2]).toStartWith("Use /login or set an API key environment variable. See ");
        expect(lines[2]).toEndWith("docs/providers.md");
      }
    } finally {
      handle.stop();
    }
  });

  test("stored sessions: session/load and session/resume answer the logged-out signature; --resume-only drops loadSession", async () => {
    const { client } = testClient();
    const dir = makeTempDir();
    const store = join(dir, "store.json");
    writeFileSync(store, JSON.stringify({ sessions: [{ sessionId: "s-1", cwd, title: "T", updatedAt: "2026-11-20T09:00:00.000Z", turns: [{ user: "q", agent: "a" }] }] }));
    const signature = [{ type: "select", id: "model", name: "Model", category: "model", currentValue: "unknown/unknown", options: [] }];
    for (const resumeOnly of [false, true]) {
      const { handle, init } = await started(["--sessions", store, ...(resumeOnly ? ["--resume-only"] : [])], client, "auggie-1-noauth");
      try {
        expect(init.agentCapabilities?.loadSession).toBe(!resumeOnly);
        expect((await handle.conn.listSessions({})).sessions.map((s) => s.sessionId)).toEqual(["s-1"]);
        if (resumeOnly) expect((await errorOf(handle.conn.loadSession({ sessionId: "s-1", cwd, mcpServers: [] }))).code).toBe(-32601);
        else expect((await handle.conn.loadSession({ sessionId: "s-1", cwd, mcpServers: [] })).configOptions).toEqual(signature as never);
        expect((await handle.conn.resumeSession({ sessionId: "s-1", cwd })).configOptions).toEqual(signature as never);
      } finally {
        handle.stop();
      }
    }
  });

  test("--offer-models answers auggie-1's model option, so only the prompt fails", async () => {
    const { client } = testClient();
    const { handle } = await started(["--offer-models"], client, "auggie-1-noauth");
    try {
      const session = await handle.conn.newSession({ cwd, mcpServers: [] });
      const option = session.configOptions?.[0] as { currentValue: string; options: unknown[] };
      expect(option.currentValue).toBe("augment/butler_b");
      expect(option.options).toHaveLength(3);
      expect((await errorOf(prompt(handle, session.sessionId, "hi"))).code).toBe(-32603);
    } finally {
      handle.stop();
    }
  });

  test("--offer-models with another scenario is refused at start", async () => {
    const proc = Bun.spawn({ cmd: ["bun", join(import.meta.dir, "../src/main.ts"), "--scenario", "basic", "--offer-models"], stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    const code = await proc.exited;
    expect(code).not.toBe(0);
    expect(await new Response(proc.stderr).text()).toContain("--offer-models needs --scenario auggie-1-noauth");
  });
});
