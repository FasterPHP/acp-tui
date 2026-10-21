// mvp-sessions tasks 5.2 and 12.5 (design decision 2, spec tui-sessions
// "Opening a session by ID"): `resolveLaunch` for `--resume <id>` reads acp-tui's
// session index. The agent is `-a` or the command after `--`, else the named
// agent the index records (never a command from the index), else the default;
// the directory is the index's for the chosen agent, else the launch
// directory (the app then asks the agent's list). The catalogue and the index
// are injected; directories are temporary.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAgentCatalogue } from "../../src/agent/catalogue.ts";
import { adHocSessionMessage, resolveLaunch, SessionAgentError, shellWord, type ResolveContext } from "../../src/agent/resolve.ts";
import { openSessionIndex, type SessionIndex } from "../../src/session/session-index.ts";

function temp(prefix: string): string {
  return realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), prefix)));
}

const CONFIG = JSON.stringify({
  agent_servers: {
    fake: { command: "bun", args: ["fake.ts"] },
    other: { command: "bun", args: ["other.ts"] },
  },
});

function setup(): { index: SessionIndex; context: ResolveContext; cwd: string } {
  const index = openSessionIndex({ stateHome: temp("acp-tui-resolve-state-") });
  const cwd = temp("acp-tui-resolve-cwd-");
  return { index, cwd, context: { cwd, catalogue: () => buildAgentCatalogue(CONFIG, "/cfg/acp-tui/config.jsonc"), index: () => index } };
}

const session = (id: string) => ({ kind: "resume" as const, id });
const none = { agentName: null, agentCommand: null, directory: null };

describe("resolveLaunch for --resume <id> (tasks 5.2 and 12.5)", () => {
  test("Agent and directory from the index: the named agent and its directory, with one match", () => {
    const { index, context } = setup();
    index.record({ agent: "fake", sessionId: "s-42", directory: "/work/repo-b", title: "t" });
    const launch = resolveLaunch({ ...none, session: session("s-42") }, context);
    expect(launch).toMatchObject({
      agentName: "fake",
      agentSource: "index",
      command: "bun",
      args: ["fake.ts"],
      directory: "/work/repo-b",
      directorySource: "index",
      indexMatches: 1,
    });
    expect(launch.indexed?.sessionId).toBe("s-42");
  });

  test("several agents with the ID: the most recently active one, and the count for the notice", () => {
    const { index, context } = setup();
    index.record({ agent: "fake", sessionId: "s-1", directory: "/work/a", at: Date.parse("2026-10-04T09:00:00Z") });
    index.record({ agent: "other", sessionId: "s-1", directory: "/work/b", at: Date.parse("2026-10-04T10:00:00Z") });
    const launch = resolveLaunch({ ...none, session: session("s-1") }, context);
    expect(launch).toMatchObject({ agentName: "other", directory: "/work/b", indexMatches: 2 });
  });

  test("-a wins over the index's agent; the directory is the index's for that agent", () => {
    const { index, context } = setup();
    index.record({ agent: "other", sessionId: "s-1", directory: "/work/b" });
    index.record({ agent: "fake", sessionId: "s-1", directory: "/work/a", at: Date.now() - 60_000 });
    const launch = resolveLaunch({ ...none, agentName: "fake", session: session("s-1") }, context);
    expect(launch).toMatchObject({ agentName: "fake", agentSource: "option", directory: "/work/a", directorySource: "index", indexMatches: 0 });
  });

  test("-a with no index entry for that agent: the launch directory, for the agent's list to correct", () => {
    const { index, context, cwd } = setup();
    index.record({ agent: "other", sessionId: "s-1", directory: "/work/b" });
    const launch = resolveLaunch({ ...none, agentName: "fake", session: session("s-1") }, context);
    expect(launch).toMatchObject({ agentName: "fake", directory: cwd, directorySource: "launch", indexed: null });
  });

  test("not in the index: the default agent and the launch directory", () => {
    const { context, cwd } = setup();
    const launch = resolveLaunch({ ...none, session: session("s-7") }, context);
    expect(launch).toMatchObject({ agentName: "auggie", agentSource: "default", directory: cwd, directorySource: "launch", indexMatches: 0 });
  });

  test("an ad hoc entry without -a or --: an error with the command to rerun, quoted for a POSIX shell", () => {
    const { index, context } = setup();
    index.record({ agent: "ad hoc", command: ["bun", "my agent.ts", "--x"], sessionId: "s-9", directory: "/work" });
    expect(() => resolveLaunch({ ...none, session: session("s-9") }, context)).toThrow(SessionAgentError);
    expect(() => resolveLaunch({ ...none, session: session("s-9") }, context)).toThrow(
      "session s-9 was started with an ad hoc harness command, which acp-tui never runs from its index; reopen it with: acp-tui --resume s-9 -- bun 'my agent.ts' --x",
    );
  });

  test("an ad hoc entry with the command after --: launched as given, in the index's directory", () => {
    const { index, context } = setup();
    index.record({ agent: "ad hoc", command: ["bun", "a.ts"], sessionId: "s-9", directory: "/work/c" });
    const launch = resolveLaunch({ ...none, agentCommand: ["bun", "a.ts"], session: session("s-9") }, context);
    expect(launch).toMatchObject({ agentName: "ad hoc", agentSource: "command", command: "bun", args: ["a.ts"], directory: "/work/c", directorySource: "index" });
  });

  test("the recorded agent is no longer configured: an error naming it", () => {
    const { index, context } = setup();
    index.record({ agent: "gone", sessionId: "s-3", directory: "/work" });
    expect(() => resolveLaunch({ ...none, session: session("s-3") }, context)).toThrow(
      /^session s-3 was recorded with harness 'gone', which cannot be launched now: 'gone' is not a known harness/,
    );
  });

  test("the index is not read for a new session or --continue", () => {
    const { context } = setup();
    const reads: string[] = [];
    const watched: ResolveContext = { ...context, index: () => (reads.push("read"), context.index!()) };
    resolveLaunch({ ...none, session: { kind: "new" } }, watched);
    resolveLaunch({ ...none, session: { kind: "continue" } }, watched);
    expect(reads).toEqual([]);
  });

  test("shellWord quotes only what needs it, for a POSIX shell", () => {
    expect(shellWord("bun", "linux")).toBe("bun");
    expect(shellWord("/a/b-c.ts", "linux")).toBe("/a/b-c.ts");
    expect(shellWord("my agent", "linux")).toBe("'my agent'");
    expect(shellWord("it's", "linux")).toBe(`'it'\\''s'`);
    expect(shellWord("", "linux")).toBe("''");
  });

  test("shellWord and the rerun message are quoted for PowerShell on Windows", () => {
    expect(shellWord("bun", "win32")).toBe("bun");
    expect(shellWord("C:\\Program Files\\agent.exe", "win32")).toBe("'C:\\Program Files\\agent.exe'");
    expect(shellWord("it's", "win32")).toBe("'it''s'");
    expect(shellWord("", "win32")).toBe("''");
    expect(adHocSessionMessage("s-9", ["C:\\Program Files\\agent\\agent.exe", "--acp", "it's"], "win32")).toBe(
      "session s-9 was started with an ad hoc harness command, which acp-tui never runs from its index; reopen it with: acp-tui --resume s-9 -- 'C:\\Program Files\\agent\\agent.exe' --acp 'it''s'",
    );
    expect(adHocSessionMessage("s-9", ["a b"], "linux")).toContain("-- 'a b'");
    expect(adHocSessionMessage("-s9", ["bun"], "win32")).toContain("acp-tui --resume=-s9 -- bun");
  });
});
