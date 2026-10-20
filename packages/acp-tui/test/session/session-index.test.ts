// mvp-sessions tasks 4.1 and 4.3: the session index (design decision 1, spec
// tui-sessions "Session index"). Module level: the controller's wiring (task
// 4.2) calls this API on the first prompt and on open, so "Recorded on the
// first prompt" and "Recorded with its agent" are tested here as what that
// API does and does not write. Also the permissions, merging, a torn line,
// compaction, two processes appending at once, and an unwritable state
// directory. Every index lives in a temporary state home.
import { describe, expect, test } from "bun:test";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { INDEX_FILE_NAME, openSessionIndex, stateHomeDir, type SessionIndexOptions } from "../../src/session/session-index.ts";

const WRITER = resolve(import.meta.dir, "index-writer.ts");
const T0 = Date.parse("2026-10-04T09:00:00.000Z");

function stateHome(): string {
  return mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-state-"));
}

function open(home: string, options: Omit<SessionIndexOptions, "stateHome"> = {}) {
  return openSessionIndex({ stateHome: home, ...options });
}

function fileLines(path: string): string[] {
  return readFileSync(path, "utf8").split("\n").filter(Boolean);
}

describe("where the index lives", () => {
  test("$XDG_STATE_HOME/acp-tui/sessions.jsonl, else ~/.local/state", () => {
    expect(stateHomeDir({ XDG_STATE_HOME: "/x/state", HOME: "/home/u" })).toBe("/x/state");
    expect(stateHomeDir({ HOME: "/home/u" })).toBe("/home/u/.local/state");
    expect(stateHomeDir({ XDG_STATE_HOME: "rel", HOME: "/home/u" })).toBe("/home/u/.local/state");
    const home = stateHome();
    expect(openSessionIndex({ env: { XDG_STATE_HOME: home } }).path).toBe(join(home, "acp-tui", INDEX_FILE_NAME));
  });
});

describe("Session index (tui-sessions)", () => {
  test("Recorded on the first prompt: opening the index writes nothing, so a session without a prompt has no entry", () => {
    const home = stateHome();
    const index = open(home);
    // What a new session does before its first prompt: nothing but look up.
    expect(index.find("s-1")).toEqual({ record: null, matches: 0 });
    expect(index.listAll()).toEqual([]);
    expect(existsSync(join(home, "acp-tui"))).toBe(false);
  });

  test("Recorded with its agent: ID, agent fake, /work/repo-b, a title, and now as both times", () => {
    const home = stateHome();
    const index = open(home, { now: () => T0 });
    index.record({ agent: "fake", sessionId: "s-1", directory: "/work/repo-b", title: "fix the failing test" });
    const expected = {
      sessionId: "s-1",
      agent: "fake",
      directory: "/work/repo-b",
      title: "fix the failing test",
      createdAt: "2026-10-04T09:00:00.000Z",
      updatedAt: "2026-10-04T09:00:00.000Z",
    };
    expect(index.find("s-1")).toEqual({ record: expected, matches: 1 });
    // Another instance reads the same record from the file.
    expect(open(home).listAll()).toEqual([expected]);
  });

  test("an ad hoc session keeps its command", () => {
    const index = open(stateHome());
    index.record({ agent: "ad hoc", command: ["bun", "fake.ts", "--scenario", "basic"], sessionId: "s-2", directory: "/w" });
    expect(index.find("s-2").record).toMatchObject({ agent: "ad hoc", command: ["bun", "fake.ts", "--scenario", "basic"], title: null });
  });

  test("the directory is 0700 and the file 0600", () => {
    const home = stateHome();
    open(home).record({ agent: "fake", sessionId: "s-1", directory: "/w" });
    expect(statSync(join(home, "acp-tui")).mode & 0o777).toBe(0o700);
    expect(statSync(join(home, "acp-tui", INDEX_FILE_NAME)).mode & 0o777).toBe(0o600);
  });

  test("an existing directory and file open to others are made owner-only", () => {
    const home = stateHome();
    mkdirSync(join(home, "acp-tui"), { mode: 0o755 });
    chmodSync(join(home, "acp-tui"), 0o755);
    writeFileSync(join(home, "acp-tui", INDEX_FILE_NAME), "", { mode: 0o644 });
    chmodSync(join(home, "acp-tui", INDEX_FILE_NAME), 0o644);
    open(home).record({ agent: "fake", sessionId: "s-1", directory: "/w" });
    expect(statSync(join(home, "acp-tui")).mode & 0o777).toBe(0o700);
    expect(statSync(join(home, "acp-tui", INDEX_FILE_NAME)).mode & 0o777).toBe(0o600);
  });

  test("one line per event; the reader keeps the last state per (agent, session ID)", () => {
    const home = stateHome();
    let now = T0;
    const index = open(home, { now: () => now });
    index.record({ agent: "fake", sessionId: "s-1", directory: "/work/repo-b", title: "first prompt" });
    now += 60_000;
    index.updateTitle({ agent: "fake", sessionId: "s-1" }, "Agent title");
    index.updateActivity({ agent: "fake", sessionId: "s-1" });
    expect(fileLines(index.path)).toHaveLength(3);
    expect(index.find("s-1").record).toMatchObject({
      title: "Agent title",
      createdAt: "2026-10-04T09:00:00.000Z",
      updatedAt: "2026-10-04T09:01:00.000Z",
    });
    index.updateTitle({ agent: "fake", sessionId: "s-1" }, null);
    expect(index.find("s-1").record?.title).toBeNull();
    // A change to a session the index never recorded is ignored.
    index.updateTitle({ agent: "fake", sessionId: "s-unknown" }, "x");
    expect(index.find("s-unknown").record).toBeNull();
  });

  test("recorded again (opened later by load): the creation time and the title stay", () => {
    const index = open(stateHome());
    index.record({ agent: "fake", sessionId: "s-1", directory: "/w", title: "kept", at: T0 });
    index.record({ agent: "fake", sessionId: "s-1", directory: "/w", at: T0 + 3_600_000 });
    expect(index.find("s-1").record).toMatchObject({ title: "kept", createdAt: "2026-10-04T09:00:00.000Z", updatedAt: "2026-10-04T10:00:00.000Z" });
  });

  test("look up by ID: the most recent match across agents, and how many agents had it", () => {
    const index = open(stateHome());
    index.record({ agent: "fake", sessionId: "s-1", directory: "/a", at: T0 });
    index.record({ agent: "claude", sessionId: "s-1", directory: "/b", at: T0 + 1000 });
    expect(index.find("s-1")).toMatchObject({ record: { agent: "claude", directory: "/b" }, matches: 2 });
    index.updateActivity({ agent: "fake", sessionId: "s-1" }, T0 + 2000);
    expect(index.find("s-1")).toMatchObject({ record: { agent: "fake" }, matches: 2 });
  });

  test("list by agent and directory, newest first; list all", () => {
    const index = open(stateHome());
    index.record({ agent: "fake", sessionId: "a", directory: "/work/repo-b", at: T0 });
    index.record({ agent: "fake", sessionId: "b", directory: "/work/repo-b", at: T0 + 3_600_000 });
    index.record({ agent: "fake", sessionId: "c", directory: "/work/other", at: T0 + 7_200_000 });
    index.record({ agent: "claude", sessionId: "d", directory: "/work/repo-b", at: T0 + 10_800_000 });
    expect(index.list({ agent: "fake", directory: "/work/repo-b" }).map((r) => r.sessionId)).toEqual(["b", "a"]);
    expect(index.list({ directory: "/work/repo-b" }).map((r) => r.sessionId)).toEqual(["d", "b", "a"]);
    expect(index.list({ agent: "fake" }).map((r) => r.sessionId)).toEqual(["c", "b", "a"]);
    expect(index.listAll().map((r) => r.sessionId)).toEqual(["d", "c", "b", "a"]);
  });

  test("a hostile title, agent or directory is stored and read printable and on one line", () => {
    const home = stateHome();
    const index = open(home);
    const hostile = "Early \u001b]8;;https://evil.example\u0007return\u001b]8;;\u0007 in \u202erender\u202c\nTemplate";
    index.record({ agent: "fa\u001b[31mke", sessionId: "s-1", directory: "/w\nx", title: hostile });
    const raw = readFileSync(index.path, "utf8");
    expect(raw).not.toContain("\u001b");
    expect(raw).not.toContain("\\u001b");
    const record = index.find("s-1").record!;
    expect(record.title).not.toMatch(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/);
    expect(record.title).toContain("render");
    expect(record.agent).not.toContain("\u001b");
    expect(record.directory).not.toContain("\n");
  });

  test("a torn or garbage line is skipped; the rest of the index is read", () => {
    const home = stateHome();
    const index = open(home);
    index.record({ agent: "fake", sessionId: "s-1", directory: "/w", at: T0 });
    appendFileSync(index.path, '{"v":1,"kind":"recorded","record":{"sessionId":"s-torn","age');
    appendFileSync(index.path, "\nnot json at all\n[]\n{\"v\":2,\"kind\":\"recorded\"}\n");
    appendFileSync(index.path, `${JSON.stringify({ v: 1, kind: "recorded", record: { sessionId: "s-bad", agent: "fake", directory: "/w", title: 5, createdAt: "x", updatedAt: "y" } })}\n`);
    index.record({ agent: "fake", sessionId: "s-2", directory: "/w", at: T0 + 1000 });
    expect(open(home).listAll().map((r) => r.sessionId)).toEqual(["s-2", "s-1"]);
  });

  test("compaction: past 2000 records the file is rewritten with the newest record of the 1000 most recent sessions", () => {
    const home = stateHome();
    const index = open(home);
    // 1500 sessions, then 500 later titles for the oldest 500 (which stay the oldest).
    for (let n = 0; n < 1500; n++) index.record({ agent: "fake", sessionId: `s-${n}`, directory: "/w", title: `prompt ${n}`, at: T0 + n * 1000 });
    for (let n = 0; n < 500; n++) index.updateTitle({ agent: "fake", sessionId: `s-${n}` }, `title ${n}`);
    expect(fileLines(index.path)).toHaveLength(2000);
    // Activity for s-10 makes it the most recent session; the 2001st line triggers the rewrite.
    index.updateActivity({ agent: "fake", sessionId: "s-10" }, T0 + 10_000_000);
    const lines = fileLines(index.path);
    expect(lines).toHaveLength(1000);
    for (const line of lines) expect(JSON.parse(line)).toMatchObject({ v: 1, kind: "recorded" });
    const all = open(home).listAll();
    expect(all).toHaveLength(1000);
    expect(all[0]).toMatchObject({ sessionId: "s-10", title: "title 10", updatedAt: new Date(T0 + 10_000_000).toISOString() });
    // The 999 others are the newest: s-501 to s-1499.
    expect(all.at(-1)?.sessionId).toBe("s-501");
    expect(index.find("s-500").record).toBeNull();
    expect(statSync(index.path).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(home, "acp-tui"))).toEqual([INDEX_FILE_NAME]);
    // Appends carry on after the rewrite.
    index.record({ agent: "fake", sessionId: "s-new", directory: "/w" });
    expect(fileLines(index.path)).toHaveLength(1001);
  });

  test(
    "Two instances: two processes appending 500 records each at the same time leave all 1000 readable",
    async () => {
      const home = stateHome();
      const spawn = (prefix: string) => Bun.spawn({ cmd: ["bun", WRITER, home, prefix, "500"], stdout: "ignore", stderr: "pipe" });
      const writers = [spawn("one"), spawn("two")];
      const codes = await Promise.all(writers.map((w) => w.exited));
      const errors = await Promise.all(writers.map((w) => new Response(w.stderr).text()));
      expect(errors).toEqual(["", ""]);
      expect(codes).toEqual([0, 0]);
      const index = open(home);
      // Every line is whole: 500 records and 500 titles from each.
      const lines = fileLines(index.path);
      expect(lines).toHaveLength(2000);
      for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
      const all = index.listAll();
      expect(all).toHaveLength(1000);
      for (const prefix of ["one", "two"]) {
        for (let n = 0; n < 500; n++) expect(index.find(`${prefix}-${n}`).record?.title).toBe(`title ${prefix} ${n}`);
      }
    },
    30_000,
  );
});

describe("an unwritable state directory (task 4.3)", () => {
  test("the index says so once, and every call carries on", () => {
    const home = stateHome();
    const dir = join(home, "acp-tui");
    mkdirSync(dir, { mode: 0o700 });
    const warnings: string[] = [];
    // An index written while it could be, then the directory and file made read-only.
    const before = open(home, { onWarning: (m) => warnings.push(m) });
    before.record({ agent: "fake", sessionId: "s-1", directory: "/w", at: T0 });
    chmodSync(join(dir, INDEX_FILE_NAME), 0o400);
    chmodSync(dir, 0o500);
    try {
      const index = open(home, { onWarning: (m) => warnings.push(m) });
      expect(index.warning).toBeNull();
      expect(() => index.record({ agent: "fake", sessionId: "s-2", directory: "/w" })).not.toThrow();
      expect(() => index.updateTitle({ agent: "fake", sessionId: "s-1" }, "t")).not.toThrow();
      expect(() => index.updateActivity({ agent: "fake", sessionId: "s-1" })).not.toThrow();
      expect(warnings).toHaveLength(1);
      // The reason first, then the directory (cut last in the prompt box's border).
      expect(warnings[0]).toMatch(/^sessions not recorded \(E[A-Z]+\): /);
      expect(warnings[0]).toEndWith(`: ${dir}`);
      expect(index.warning).toBe(warnings[0]!);
      // Reading still works.
      expect(index.listAll().map((r) => r.sessionId)).toEqual(["s-1"]);
      expect(index.find("s-2").record).toBeNull();
    } finally {
      chmodSync(dir, 0o700);
    }
  });

  test("a state home where the directory cannot even be created", () => {
    const home = stateHome();
    chmodSync(home, 0o500);
    try {
      const warnings: string[] = [];
      // HOME is the state home's parent, so the directory reads `~/...` (short enough for the
      // prompt box's border, IDE check 10.1).
      const index = open(home, { onWarning: (m) => warnings.push(m), env: { HOME: dirname(home) } });
      index.record({ agent: "fake", sessionId: "s-1", directory: "/w" });
      index.record({ agent: "fake", sessionId: "s-2", directory: "/w" });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toBe(`sessions not recorded (EACCES): ~/${basename(home)}/acp-tui`);
      expect(index.listAll()).toEqual([]);
    } finally {
      chmodSync(home, 0o700);
    }
  });
});
