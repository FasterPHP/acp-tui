// mvp-sessions task groups 5 and 12 and tasks 6.2 and 6.4: opening sessions
// from the command line (`--resume <id>`, `--continue`), under a PTY, against fake-agent's session store (spec
// tui-sessions "Opening a session by ID", "Session directory marker", "Honest
// errors when a session cannot be opened", "Continue the latest session", "Input while history loads" and
// "Batched history replay"). Every run has its own XDG_CONFIG_HOME (a
// `config.jsonc` with a `fake` agent where a test needs a named agent) and
// XDG_STATE_HOME (the session index), and fake-agent logs every method it
// receives. Session fixtures are written per test with directories that exist.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HISTORY_LOADING_NOTICE } from "../../src/app/PromptBox.tsx";
import { openSessionIndex } from "../../src/session/session-index.ts";
import { startPty, type PtySession } from "../pty/harness.ts";
import { promptBox, promptText, READY, statusRow } from "../pty/regions.ts";
import { homeEnv, rowsAfterPrefill, WINDOWS } from "../windows.ts";
import { shortenHome } from "../../src/layout/segments.ts";
import { userHome } from "../../src/platform/paths.ts";

const ROOT = resolve(import.meta.dir, "../../../..");
const CLI = join(ROOT, "packages/acp-tui/src/cli.ts");
const FAKE_AGENT = join(ROOT, "packages/fake-agent/src/main.ts");
const PREFILL = "$ acp-tui\r\n";

let session: PtySession | null = null;
afterEach(async () => {
  await session?.dispose();
  session = null;
});

interface World {
  /** A scratch directory holding everything below. */
  base: string;
  env: Record<string, string>;
  stateHome: string;
  agentLog: string;
  /** Makes a directory below `base` (absolute, resolved). */
  dir(name: string): string;
  /** Writes a session store fixture for fake-agent's `--sessions`. */
  sessions(list: unknown[]): string;
  /** Writes `config.jsonc` with one agent `fake`: fake-agent with these arguments. */
  configure(args: readonly string[]): void;
  /** The methods (and parameters) fake-agent received, in order. */
  received(): { method: string; params?: Record<string, unknown> }[];
  /** fake-agent's command for `--` (ad hoc). */
  fake(args: readonly string[]): string[];
}

function world(): World {
  const base = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-sessions-")));
  const configHome = join(base, "config");
  const stateHome = join(base, "state");
  mkdirSync(join(configHome, "acp-tui"), { recursive: true });
  // The tests were written against `compact`, which is no longer the default density.
  writeFileSync(join(configHome, "acp-tui", "config.jsonc"), JSON.stringify({ density: "compact" }));
  const agentLog = join(base, "fake-agent.log");
  const fake = (args: readonly string[]) => ["bun", FAKE_AGENT, "--delay-scale", "0", "--log", agentLog, ...args];
  return {
    base,
    env: { XDG_CONFIG_HOME: configHome, XDG_STATE_HOME: stateHome },
    stateHome,
    agentLog,
    dir(name) {
      const path = join(base, name);
      mkdirSync(path, { recursive: true });
      return path;
    },
    sessions(list) {
      const path = join(base, "sessions.json");
      writeFileSync(path, JSON.stringify({ sessions: list }));
      return path;
    },
    configure(args) {
      const [command, ...rest] = fake(args);
      writeFileSync(join(configHome, "acp-tui", "config.jsonc"), JSON.stringify({ density: "compact", agent_servers: { fake: { command, args: rest } } }));
    },
    received() {
      if (!existsSync(agentLog)) return [];
      return readFileSync(agentLog, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { method: string; params?: Record<string, unknown> });
    },
    fake,
  };
}

function start(w: World, args: readonly string[], cwd: string, size = { cols: 100, rows: 30 }, env: Record<string, string> = {}): PtySession {
  session = startPty(["bun", CLI, ...args], { ...size, cwd, env: { ...w.env, ...env }, prefill: PREFILL });
  return session;
}

/** The main screen once acp-tui has exited, as text; rows are joined without a break, so a
 *  message the terminal wrapped reads whole. */
function mainText(s: PtySession): string {
  return s.screenText().join("");
}

/** A short history: one turn with a tool call and an answer. */
function turn(user: string, agent: string) {
  return { user, tools: [{ title: "Read src/Example.php", kind: "read", output: "<?php" }], agent };
}

/** The conversation's rows: above the prompt box (and the status row below it), right-trimmed,
 *  blank rows dropped. */
/** Rows below the prompt box: the spacer, the status row and the bottom margin
 *  (mvp-chrome-and-keys task 4.1). */
const BELOW_PROMPT = 3;

function conversationRows(s: PtySession): string[] {
  const rows = s.screenText();
  return rows
    .slice(0, rows.length - BELOW_PROMPT - promptBox(s).length)
    .map((r) => r.trimEnd())
    .filter((r) => r.trim() !== "");
}

/** `acp-tui: finding session…` was printed and then removed (carriage return, erase line), before
 *  the app took the alternate screen or any error line (task 12.11): in the raw output, and no
 *  longer on the main screen. */
function findingShownAndGone(s: PtySession): boolean {
  // Not on Windows: ConPTY repaints instead of passing acp-tui's bytes on, so only the main screen is checked.
  if (WINDOWS) return !mainText(s).includes("finding session");
  const raw = s.rawOutput();
  const at = raw.indexOf("acp-tui: finding session…\r\x1b[2K");
  const alternate = raw.indexOf("\x1b[?1049h");
  return at >= 0 && (alternate < 0 || at < alternate) && !mainText(s).includes("finding session");
}

/** The alternate screen was never entered: no `CSI ? 1049 h` in anything acp-tui wrote. */
function neverDrawn(s: PtySession): boolean {
  return !s.rawOutput().includes("\x1b[?1049h");
}

describe("Opening a session by ID (tui-sessions, tasks 5.2 and 12.5)", () => {
  test("Agent and directory from the index: the fake agent is launched once, the session opened in repo-b, and the marker names both directories", async () => {
    const w = world();
    const repoB = w.dir("repo-b");
    const home = w.dir("home");
    const fixture = w.sessions([{ sessionId: "s-42", cwd: repoB, title: "Index test", turns: [turn("earlier question", "earlier answer")] }]);
    w.configure(["--scenario", "copy-fixtures", "--load", "--sessions", fixture]);
    openSessionIndex({ stateHome: w.stateHome }).record({ agent: "fake", sessionId: "s-42", directory: repoB, title: "Index test" });

    // HOME is the scratch directory, so the marker reads `~/repo-b` and `~/home`.
    const s = start(w, ["--resume", "s-42"], home, { cols: 61, rows: 21 }, homeEnv(w.base));
    await s.waitFor(READY, 15000);
    const received = w.received();
    expect(received.find((e) => e.method === "session/load")?.params).toEqual({ sessionId: "s-42", cwd: repoB, mcpServers: [] });
    expect(received.some((e) => e.method === "session/new")).toBe(false);
    // One agent process: one `initialize`.
    expect(received.filter((e) => e.method === "initialize")).toHaveLength(1);
    await s.waitFor("earlier answer", 5000);
    await s.waitFor(() => (conversationRows(s).at(-1) ?? "").includes(`opened in ${join("~", "repo-b")} (launched from ${join("~", "home")})`), 5000);
    // A marker in the conversation, not a notice in the prompt box's border.
    expect(promptBox(s)[0]).toMatch(/^╭─+╮$/);
    expect(statusRow(s)).toContain("repo-b");

    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    expect(mainText(s)).toContain("resume: acp-tui --resume s-42");
    expect(mainText(s)).not.toContain("acp-tui: session");
    // The finding line is gone from the main screen after a successful start.
    expect(findingShownAndGone(s)).toBe(true);
    expect(openSessionIndex({ stateHome: w.stateHome }).find("s-42").record).toMatchObject({ agent: "fake", directory: repoB, title: "Index test" });
  });

  test("Directory from the agent's list: s-7 is not in the index, the agent lists it in repo-c, and it is opened there on the same agent process", async () => {
    const w = world();
    const repoC = w.dir("repo-c");
    const fixture = w.sessions([
      { sessionId: "s-other", cwd: w.dir("elsewhere"), title: "Another one", updatedAt: "2026-10-04T10:00:00.000Z" },
      { sessionId: "s-7", cwd: repoC, title: "Listed by the agent", updatedAt: "2026-10-04T09:00:00.000Z", turns: [turn("listed question", "listed answer")] },
    ]);
    const command = w.fake(["--scenario", "copy-fixtures", "--load", "--list", "--page-size", "1", "--sessions", fixture]);
    const s = start(w, ["--resume", "s-7", "--", ...command], w.base, { cols: 240, rows: 30 });
    await s.waitFor(READY, 15000);
    const received = w.received();
    // Read without a cwd filter, page by page, until the ID was found, before anything was drawn.
    const lists = received.filter((e) => e.method === "session/list");
    expect(lists.length).toBe(2);
    expect(lists.every((e) => e.params?.["cwd"] === undefined)).toBe(true);
    expect(received.filter((e) => e.method === "initialize")).toHaveLength(1);
    expect(received.find((e) => e.method === "session/load")?.params).toEqual({ sessionId: "s-7", cwd: repoC, mcpServers: [] });
    await s.waitFor("listed answer", 5000);
    await s.waitFor(() => (conversationRows(s).at(-1) ?? "").includes(`opened in ${shortenHome(repoC, userHome())} (launched from ${shortenHome(w.base, userHome())})`), 5000);

    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    // Recorded at once when opened: ad hoc, with its command and the agent's title.
    expect(openSessionIndex({ stateHome: w.stateHome }).find("s-7").record).toMatchObject({
      agent: "ad hoc",
      command,
      directory: repoC,
      title: "Listed by the agent",
    });
  });

  test("Unknown session ID: the message below the command line, exit 1, the alternate screen never entered, no session/new", async () => {
    const w = world();
    const fixture = w.sessions([{ sessionId: "s-1", cwd: w.base, title: "Only one" }]);
    w.configure(["--scenario", "copy-fixtures", "--load", "--list", "--sessions", fixture]);
    const s = start(w, ["-a", "fake", "--resume", "nosuch"], w.base, { cols: 300, rows: 30 });
    expect(await s.wait(15000)).toBe(1);
    await s.flush();
    expect(neverDrawn(s)).toBe(true);
    // On Windows ConPTY clears the prefilled command line, so the message is checked after it.
    if (!WINDOWS) expect(s.screenText()[0]).toBe("$ acp-tui");
    expect(rowsAfterPrefill(s.screenText())[0]).toBe("acp-tui: no session nosuch found; to choose a session by title and time: acp-tui --resume");
    // Only the error line is left: the finding line was removed before it was printed.
    expect(findingShownAndGone(s)).toBe(true);
    expect(rowsAfterPrefill(s.screenText())[1]).toBe("");
    const methods = w.received().map((e) => e.method);
    expect(methods).toEqual(["initialize", "session/list"]);
  });

  test("an unknown ID the index lacks, with the default agent: the same, without -a", async () => {
    const w = world();
    const fixture = w.sessions([]);
    w.configure(["--scenario", "basic", "--load", "--list", "--sessions", fixture]);
    writeFileSync(join(w.env.XDG_CONFIG_HOME!, "acp-tui", "config.jsonc"), JSON.stringify({ ...JSON.parse(readFileSync(join(w.env.XDG_CONFIG_HOME!, "acp-tui", "config.jsonc"), "utf8")), default_agent: "fake" }));
    const s = start(w, ["--resume", "0f3c9a2x"], w.base, { cols: 300, rows: 30 });
    expect(await s.wait(15000)).toBe(1);
    expect(neverDrawn(s)).toBe(true);
    expect(mainText(s)).toContain("acp-tui: no session 0f3c9a2x found; to choose a session by title and time: acp-tui --resume");
    expect(w.received().map((e) => e.method)).not.toContain("session/new");
  });

  test("an agent that fails to start for --resume <id>: its error below the command line, nothing drawn", async () => {
    const w = world();
    const s = start(w, ["--resume", "s-1", "--", "acp-tui-no-such-agent"], w.base, { cols: 300, rows: 30 });
    expect(await s.wait(15000)).toBe(1);
    await s.flush();
    expect(neverDrawn(s)).toBe(true);
    expect(rowsAfterPrefill(s.screenText())[0]).toStartWith("acp-tui: could not start ad hoc harness command 'acp-tui-no-such-agent'");
  });

  test("an ad hoc session in the index without -a or --: exit 1 saying how to reopen it, nothing launched", async () => {
    const w = world();
    openSessionIndex({ stateHome: w.stateHome }).record({ agent: "ad hoc", command: ["bun", "my agent.ts"], sessionId: "s-adhoc", directory: w.base });
    const s = start(w, ["--resume", "s-adhoc"], w.base, { cols: 300, rows: 30 });
    expect(await s.wait(15000)).toBe(1);
    expect(neverDrawn(s)).toBe(true);
    const text = mainText(s);
    expect(text).toContain("acp-tui: session s-adhoc was started with an ad hoc harness command");
    expect(text).toContain("acp-tui --resume s-adhoc -- bun 'my agent.ts'");
    expect(existsSync(w.agentLog)).toBe(false);
  });
});

describe("Session directory marker (tui-sessions, task 12.3)", () => {
  test("Wrapped at a narrow width: at 54 columns the marker continues on the next row, both directories whole, the last item", async () => {
    const w = world();
    const project = w.dir("projects/acp-tui-with-a-long-name");
    const launchedFrom = w.dir("projects/gem/gem-portal-two");
    const fixture = w.sessions([{ sessionId: "s-wrap", cwd: project, title: "Wrap", turns: [turn("a question", "an answer")] }]);
    // The agent lists the session, so its directory is known (an agent that cannot list is opened
    // in the launch directory).
    const s = start(w, ["--resume", "s-wrap", "--", ...w.fake(["--scenario", "copy-fixtures", "--load", "--list", "--sessions", fixture])], launchedFrom, { cols: 54, rows: 20 }, homeEnv(w.base));
    await s.waitFor(READY, 15000);
    await s.waitFor("an answer", 5000);
    const marker = `opened in ${join("~", "projects", "acp-tui-with-a-long-name")} (launched from ${join("~", "projects", "gem", "gem-portal-two")})`;
    // Rows joined without whitespace: the wrap may fall at a space or after a `(`.
    const squeezed = (text: string) => text.replace(/\s+/g, "");
    await s.waitFor(() => squeezed(conversationRows(s).join("")).includes(squeezed(marker)), 5000);
    const rows = conversationRows(s);
    const first = rows.findIndex((r) => r.includes("opened in"));
    // At least two rows, ending the conversation, each directory whole on a row.
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(rows.length - 1);
    const markerRows = rows.slice(first);
    expect(markerRows.some((r) => r.includes(join("~", "projects", "acp-tui-with-a-long-name")))).toBe(true);
    expect(markerRows.some((r) => r.includes(`${join("~", "projects", "gem", "gem-portal-two")})`))).toBe(true);
    for (const r of markerRows) expect(r.length).toBeLessThanOrEqual(54);
    // Still there after a resize (a notice used to time out and vanish; IDE check 10.4).
    s.resize(60, 20);
    await Bun.sleep(400);
    await s.flush();
    expect(squeezed(conversationRows(s).join(""))).toContain(squeezed(marker));
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
  }, 30000);

  test("Same directory: no marker", async () => {
    const w = world();
    const fixture = w.sessions([{ sessionId: "s-here", cwd: w.base, turns: [turn("here question", "here answer")] }]);
    const s = start(w, ["--resume", "s-here", "--", ...w.fake(["--scenario", "copy-fixtures", "--load", "--sessions", fixture])], w.base);
    await s.waitFor(READY, 15000);
    await s.waitFor("here answer", 5000);
    await Bun.sleep(300);
    await s.flush();
    expect(s.screenText().join("\n")).not.toContain("opened in");
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
  });
});

describe("Honest errors when a session cannot be opened (tui-sessions, tasks 5.3 and 12.5)", () => {
  test("Agent cannot reopen sessions: the message below the command line, exit 1, no alternate screen, no session/new", async () => {
    const w = world();
    w.configure(["--scenario", "basic"]);
    const s = start(w, ["-a", "fake", "--resume", "s-1"], w.base, { cols: 300, rows: 30 });
    expect(await s.wait(15000)).toBe(1);
    await s.flush();
    expect(s.term.buffer.active.type).toBe("normal");
    expect(neverDrawn(s)).toBe(true);
    const text = mainText(s);
    expect(text).toContain("acp-tui: cannot open session s-1: harness 'fake' cannot reopen sessions (no session/load or session/resume)");
    expect(text).not.toMatch(/install/i);
    expect(text).not.toContain("resume:");
    expect(w.received().map((e) => e.method)).toEqual(["initialize"]);
  });

  test("Session not found: the agent lists s-9 but answers -32002; the line names s-9, the agent and Resource not found (-32002), with the --resume hint only and no install message", async () => {
    const w = world();
    const fixture = w.sessions([{ sessionId: "s-9", cwd: w.base, title: "Never saved" }]);
    w.configure(["--scenario", "copy-fixtures", "--load", "--list", "--load-error", "s-9", "--sessions", fixture]);
    const s = start(w, ["-a", "fake", "--resume", "s-9"], w.base, { cols: 400, rows: 30 });
    expect(await s.wait(15000)).toBe(1);
    await s.flush();
    expect(s.term.buffer.active.type).toBe("normal");
    const text = mainText(s);
    expect(text).toContain(
      "acp-tui: cannot open session s-9 with harness 'fake': the harness answered Resource not found (-32002); to choose a session by title and time: acp-tui --resume",
    );
    expect(text).toContain("; to choose a session by title and time: acp-tui --resume");
    expect(text).not.toMatch(/install/i);
    // No resume line for a session that never opened.
    expect(text).not.toContain("resume: acp-tui");
    const methods = w.received().map((e) => e.method);
    expect(methods).toContain("session/load");
    expect(methods).not.toContain("session/new");
  });

  test("an agent that cannot list, an ID the index lacks: the load decides, and its -32002 ends with the hint", async () => {
    const w = world();
    const fixture = w.sessions([{ sessionId: "s-1", cwd: w.base }]);
    w.configure(["--scenario", "basic", "--load", "--sessions", fixture]);
    const s = start(w, ["-a", "fake", "--resume", "s-9"], w.base, { cols: 400, rows: 30 });
    expect(await s.wait(15000)).toBe(1);
    const text = mainText(s);
    expect(text).toContain("acp-tui: cannot open session s-9 with harness 'fake': the harness answered Resource not found (-32002)");
    expect(text).toContain("to choose a session by title and time: acp-tui --resume");
    expect(w.received().map((e) => e.method)).not.toContain("session/new");
  });
});

describe("Continue the latest session (tui-sessions, tasks 5.4 and 12.6)", () => {
  /** `fake` (the default agent, logging to the world's log) and `other` (logging to its own). */
  function twoAgents(w: World, fakeArgs: readonly string[], otherArgs: readonly string[]): string {
    const otherLog = join(w.base, "other.log");
    const [command, ...rest] = w.fake(fakeArgs);
    const otherArgv = ["bun", FAKE_AGENT, "--delay-scale", "0", "--log", otherLog, ...otherArgs];
    writeFileSync(
      join(w.env.XDG_CONFIG_HOME!, "acp-tui", "config.jsonc"),
      JSON.stringify({ default_agent: "fake", agent_servers: { fake: { command, args: rest }, other: { command: otherArgv[0], args: otherArgv.slice(1) } } }),
    );
    return otherLog;
  }
  const methodsIn = (log: string) =>
    existsSync(log)
      ? readFileSync(log, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l) as { method: string; params?: Record<string, unknown> })
      : [];

  test("Latest of two: the index's session last active at 10:00 is opened, not the 09:00 one", async () => {
    const w = world();
    const repoB = w.dir("repo-b");
    const fixture = w.sessions([
      { sessionId: "s-nine", cwd: repoB, turns: [turn("nine question", "nine answer")] },
      { sessionId: "s-ten", cwd: repoB, turns: [turn("ten question", "ten answer")] },
    ]);
    w.configure(["--scenario", "copy-fixtures", "--load", "--sessions", fixture]);
    const index = openSessionIndex({ stateHome: w.stateHome });
    index.record({ agent: "fake", sessionId: "s-nine", directory: repoB, title: "nine", at: Date.parse("2026-10-04T09:00:00.000Z") });
    index.record({ agent: "fake", sessionId: "s-ten", directory: repoB, title: "ten", at: Date.parse("2026-10-04T10:00:00.000Z") });
    // Another agent's later session in the same directory is not this agent's (-a narrows).
    index.record({ agent: "claude", sessionId: "s-eleven", directory: repoB, title: "eleven", at: Date.parse("2026-10-04T11:00:00.000Z") });

    const s = start(w, ["-a", "fake", "--continue"], repoB);
    await s.waitFor(READY, 15000);
    expect(w.received().find((e) => e.method === "session/load")?.params?.["sessionId"]).toBe("s-ten");
    await s.waitFor("ten answer", 5000);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
  });

  test("the agent's list counts too: its later session wins over the index's", async () => {
    const w = world();
    const repoB = w.dir("repo-b");
    const fixture = w.sessions([
      { sessionId: "s-listed", cwd: repoB, updatedAt: "2026-10-04T12:00:00.000Z", turns: [turn("listed question", "listed answer")] },
      { sessionId: "s-ten", cwd: repoB, turns: [turn("ten question", "ten answer")] },
    ]);
    w.configure(["--scenario", "copy-fixtures", "--load", "--list", "--sessions", fixture]);
    openSessionIndex({ stateHome: w.stateHome }).record({ agent: "fake", sessionId: "s-ten", directory: repoB, at: Date.parse("2026-10-04T10:00:00.000Z") });
    const s = start(w, ["-a", "fake", "--continue"], repoB);
    await s.waitFor(READY, 15000);
    const received = w.received();
    expect(received.find((e) => e.method === "session/list")?.params?.["cwd"]).toBe(repoB);
    expect(received.find((e) => e.method === "session/load")?.params?.["sessionId"]).toBe("s-listed");
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
  });

  test("Across agents: other's index session (11:00) beats the default agent's listed one (10:00); other is launched and the listing agent closed", async () => {
    const w = world();
    const repoB = w.dir("repo-b");
    const fakeStore = w.sessions([{ sessionId: "s-fake", cwd: repoB, updatedAt: "2026-10-04T10:00:00.000Z", turns: [turn("fake question", "fake answer")] }]);
    const otherStore = join(w.base, "other-sessions.json");
    writeFileSync(otherStore, JSON.stringify({ sessions: [{ sessionId: "s-other", cwd: repoB, turns: [turn("other question", "other answer")] }] }));
    const otherLog = twoAgents(w, ["--scenario", "copy-fixtures", "--load", "--list", "--sessions", fakeStore], ["--scenario", "copy-fixtures", "--load", "--sessions", otherStore]);
    openSessionIndex({ stateHome: w.stateHome }).record({ agent: "other", sessionId: "s-other", directory: repoB, title: "other's", at: Date.parse("2026-10-04T11:00:00.000Z") });
    const debugLog = join(w.base, "acp-tui.log");

    const s = start(w, ["--continue"], repoB, { cols: 100, rows: 30 }, { ACP_TUI_LOG: debugLog });
    await s.waitFor(READY, 15000);
    await s.waitFor("other answer", 5000);
    expect(w.received().map((e) => e.method)).toEqual(["initialize", "session/list"]);
    expect(w.received()[1]?.params?.["cwd"]).toBe(repoB);
    expect(methodsIn(otherLog).find((e) => e.method === "session/load")?.params).toEqual({ sessionId: "s-other", cwd: repoB, mcpServers: [] });
    // The listing agent was closed as on exit, before the app started.
    expect(readFileSync(debugLog, "utf8")).toContain('"agent_exited_after_detach"');
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    expect(mainText(s)).toContain("resume: acp-tui --resume s-other");
  }, 30000);

  /** A default agent `gone` whose command does not exist, and `other` (fake-agent) with its own store. */
  function goneDefault(w: World, otherArgs: readonly string[]): void {
    const otherArgv = ["bun", FAKE_AGENT, "--delay-scale", "0", "--log", join(w.base, "other-agent.log"), ...otherArgs];
    writeFileSync(
      join(w.env.XDG_CONFIG_HOME!, "acp-tui", "config.jsonc"),
      JSON.stringify({ default_agent: "gone", agent_servers: { gone: { command: "acp-tui-no-such-agent", args: [] }, other: { command: otherArgv[0], args: otherArgv.slice(1) } } }),
    );
  }

  test("Default agent cannot be started: the index's session opens with its own agent, with a marker saying the list was skipped (task 12.11)", async () => {
    const w = world();
    const repoB = w.dir("repo-b");
    const otherStore = join(w.base, "other-sessions.json");
    writeFileSync(otherStore, JSON.stringify({ sessions: [{ sessionId: "s-other", cwd: repoB, turns: [turn("other question", "other answer")] }] }));
    goneDefault(w, ["--scenario", "copy-fixtures", "--load", "--sessions", otherStore]);
    openSessionIndex({ stateHome: w.stateHome }).record({ agent: "other", sessionId: "s-other", directory: repoB, title: "other's", at: Date.parse("2026-10-04T11:00:00.000Z") });
    const s = start(w, ["--continue"], repoB, { cols: 100, rows: 30 });
    await s.waitFor(READY, 15000);
    await s.waitFor("other answer", 5000);
    // One marker after the history, wrapped like conversation text; no error, the app is up.
    await s.waitFor(() => conversationRows(s).join(" ").includes("could not ask gone for its sessions; continued from acp-tui's record"), 5000);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    expect(mainText(s)).toContain("resume: acp-tui --resume s-other");
    expect(findingShownAndGone(s)).toBe(true);
  }, 30000);

  test("Default agent cannot be started and the index has no session: its reason on a line of its own, then the usual error; nothing drawn, exit 1", async () => {
    const w = world();
    const fresh = w.dir("new");
    goneDefault(w, ["--scenario", "basic", "--load"]);
    const s = start(w, ["--continue"], fresh, { cols: 400, rows: 30 }, homeEnv(w.base));
    expect(await s.wait(15000)).toBe(1);
    await s.flush();
    expect(neverDrawn(s)).toBe(true);
    const rows = rowsAfterPrefill(s.screenText());
    expect(rows[0]).toStartWith("acp-tui: could not ask gone for its sessions (could not start harness 'gone' (command 'acp-tui-no-such-agent')");
    expect(rows[1]).toBe(`acp-tui: no session found for ${join("~", "new")}; to choose a session: acp-tui --resume`);
    expect(findingShownAndGone(s)).toBe(true);
  });

  test("-a gone --continue: the named agent's start-up failure is the error, with no skipping", async () => {
    const w = world();
    const repoB = w.dir("repo-b");
    goneDefault(w, ["--scenario", "basic", "--load"]);
    openSessionIndex({ stateHome: w.stateHome }).record({ agent: "other", sessionId: "s-other", directory: repoB, at: Date.parse("2026-10-04T11:00:00.000Z") });
    const s = start(w, ["-a", "gone", "--continue"], repoB, { cols: 400, rows: 30 });
    expect(await s.wait(15000)).toBe(1);
    await s.flush();
    expect(neverDrawn(s)).toBe(true);
    expect(rowsAfterPrefill(s.screenText())[0]).toStartWith("acp-tui: could not start harness 'gone' (command 'acp-tui-no-such-agent')");
    expect(mainText(s)).not.toContain("could not ask");
  });

  test("Narrowed to one agent: -a fake opens fake's 10:00 session; other is not launched", async () => {
    const w = world();
    const repoB = w.dir("repo-b");
    const fakeStore = w.sessions([{ sessionId: "s-fake", cwd: repoB, turns: [turn("fake question", "fake answer")] }]);
    const otherLog = twoAgents(w, ["--scenario", "copy-fixtures", "--load", "--sessions", fakeStore], ["--scenario", "basic", "--load"]);
    const index = openSessionIndex({ stateHome: w.stateHome });
    index.record({ agent: "fake", sessionId: "s-fake", directory: repoB, at: Date.parse("2026-10-04T10:00:00.000Z") });
    index.record({ agent: "other", sessionId: "s-other", directory: repoB, at: Date.parse("2026-10-04T11:00:00.000Z") });
    const s = start(w, ["-a", "fake", "--continue"], repoB);
    await s.waitFor(READY, 15000);
    await s.waitFor("fake answer", 5000);
    expect(w.received().find((e) => e.method === "session/load")?.params?.["sessionId"]).toBe("s-fake");
    expect(existsSync(otherLog)).toBe(false);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
  });

  test("an agent no longer configured, and an ad hoc entry, do not count across agents", async () => {
    const w = world();
    const repoB = w.dir("repo-b");
    const fixture = w.sessions([{ sessionId: "s-fake", cwd: repoB, turns: [turn("fake question", "fake answer")] }]);
    w.configure(["--scenario", "copy-fixtures", "--load", "--sessions", fixture]);
    writeFileSync(join(w.env.XDG_CONFIG_HOME!, "acp-tui", "config.jsonc"), JSON.stringify({ ...JSON.parse(readFileSync(join(w.env.XDG_CONFIG_HOME!, "acp-tui", "config.jsonc"), "utf8")), default_agent: "fake" }));
    const index = openSessionIndex({ stateHome: w.stateHome });
    index.record({ agent: "fake", sessionId: "s-fake", directory: repoB, at: Date.parse("2026-10-04T09:00:00.000Z") });
    index.record({ agent: "gone", sessionId: "s-gone", directory: repoB, at: Date.parse("2026-10-04T11:00:00.000Z") });
    index.record({ agent: "ad hoc", command: ["bun", "x.ts"], sessionId: "s-adhoc", directory: repoB, at: Date.parse("2026-10-04T12:00:00.000Z") });
    const s = start(w, ["--continue"], repoB);
    await s.waitFor(READY, 15000);
    expect(w.received().find((e) => e.method === "session/load")?.params?.["sessionId"]).toBe("s-fake");
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
  });

  test("No session for the directory: the message below the command line, exit 1, nothing drawn, no session/new", async () => {
    const w = world();
    const fresh = w.dir("new");
    const s = start(w, ["--continue", "--", ...w.fake(["--scenario", "basic", "--load", "--list"])], fresh, { cols: 240, rows: 30 }, homeEnv(w.base));
    expect(await s.wait(15000)).toBe(1);
    await s.flush();
    expect(neverDrawn(s)).toBe(true);
    expect(rowsAfterPrefill(s.screenText())[0]).toBe(`acp-tui: no session found for ${join("~", "new")}; to choose a session: acp-tui --resume`);
    expect(findingShownAndGone(s)).toBe(true);
    const received = w.received();
    expect(received.find((e) => e.method === "session/list")?.params?.["cwd"]).toBe(fresh);
    expect(received.some((e) => e.method === "session/new")).toBe(false);
    expect(received.some((e) => e.method === "session/load")).toBe(false);
  });
});

describe("Input while history loads (tui-sessions, task 5.5)", () => {
  /** sess-slow: 3 turns, 10 updates, at 2 ms x 300 each: a load of about 6 s. */
  function slowLoad(w: World): string[] {
    const fixture = w.sessions([
      { sessionId: "sess-slow", cwd: w.base, turns: [turn("one", "first answer"), turn("two", "second answer"), turn("three", "third answer")] },
    ]);
    return ["--resume", "sess-slow", "--", ...w.fake(["--scenario", "copy-fixtures", "--load", "--sessions", fixture, "--delay-scale", "300"])];
  }

  test("Submit during load: no session/prompt, the text stays, and a notice says the history is still loading", async () => {
    const w = world();
    const s = start(w, slowLoad(w), w.base, { cols: 120, rows: 30 });
    await s.waitFor(() => /\bloading \d+/.test(statusRow(s)), 15000);
    s.sendKeys({ text: "next step" });
    await s.waitFor(() => (promptText(s)[0] ?? "").startsWith("next step"), 5000);
    s.sendKeys("Enter");
    await s.waitFor(() => (promptBox(s)[0] ?? "").includes(HISTORY_LOADING_NOTICE), 5000);
    expect(promptText(s)[0]).toBe("next step");
    // Still loading when the notice showed; then the load completes with the text kept.
    expect(w.received().some((e) => e.method === "session/load/response")).toBe(false);
    await s.waitFor(READY, 20000);
    await s.waitFor("third answer", 5000);
    expect(promptText(s)[0]).toBe("next step");
    expect(w.received().some((e) => e.method === "session/prompt")).toBe(false);
    // Ctrl+D with text in the box is not detach; end the run with a signal.
    s.kill("SIGTERM");
    await s.wait(10000);
  }, 40000);

  test("Detach during load: Ctrl+D with an empty prompt box exits with the exit text and no session/close or session/cancel", async () => {
    const w = world();
    const s = start(w, slowLoad(w), w.base, { cols: 120, rows: 30 });
    await s.waitFor(() => /\bloading \d+/.test(statusRow(s)), 15000);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    expect(mainText(s)).toContain("resume: acp-tui --resume sess-slow");
    const methods = w.received().map((e) => e.method);
    expect(methods).toContain("session/load");
    expect(methods).not.toContain("session/load/response");
    expect(methods).not.toContain("session/close");
    expect(methods).not.toContain("session/cancel");
  }, 30000);
});

describe("Batched history replay (tui-sessions, tasks 6.2 and 6.4)", () => {
  test("loading N rises during a 1000-item load, and the last item is on screen after it", async () => {
    const w = world();
    // About 1660 updates at 2 ms each: a load of about 3.3 s.
    const command = w.fake(["--scenario", "long-session", "--items", "1000", "--load", "--delay-scale", "1"]);
    const s = start(w, ["--resume", "long-session", "--", ...command], w.base, { cols: 100, rows: 30 });
    const counts: number[] = [];
    await s.waitFor(() => {
      const m = /\bloading (\d+)/.exec(statusRow(s));
      if (m) {
        const n = Number(m[1]);
        if (counts.at(-1) !== n) counts.push(n);
      }
      return READY.test(s.screenText().join("\n"));
    }, 60000);
    expect(counts.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < counts.length; i++) expect(counts[i]!).toBeGreaterThan(counts[i - 1]!);
    expect(counts[0]!).toBeLessThan(1000);
    // The last item (a read of src/Config/Loader.php) is behind the conversation's last line, the
    // group line of the final run, and the conversation follows the end.
    await Bun.sleep(300);
    await s.flush();
    const rows = s.screenText();
    // Above the prompt box (and the spacer, the status row and the bottom margin below it).
    const conversation = rows.slice(0, rows.length - BELOW_PROMPT - promptBox(s).length).map((r) => r.trimEnd()).filter((r) => r !== "");
    expect(conversation.at(-1)).toMatch(/^ {2}▸ .*\b1 read\b/);
    expect(statusRow(s)).not.toContain("scrolled");
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
  }, 90000);

  test("Replay is not foreign activity: no frame during or after the load reads `activity from another client`", async () => {
    const w = world();
    const fixture = w.sessions([
      { sessionId: "sess-foreign", cwd: w.base, turns: [turn("first", "an answer with tools"), turn("second", "another answer")] },
    ]);
    const s = start(w, ["--resume", "sess-foreign", "--", ...w.fake(["--scenario", "copy-fixtures", "--load", "--sessions", fixture, "--delay-scale", "50"])], w.base);
    await s.waitFor(() => /\bloading \d+/.test(statusRow(s)), 15000);
    await s.waitFor(READY, 20000);
    await s.waitFor("another answer", 5000);
    await Bun.sleep(500);
    await s.flush();
    // Every byte acp-tui wrote, so every frame drawn, during and after the load.
    expect(s.rawOutput()).not.toContain("another client");
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
  }, 30000);
});
