// mvp-sessions task 3.3: the launch routed through the agent catalogue, under
// a PTY. Spec tui-agent-session "Agent launch", "Auggie by default" (command
// resolution only: the app is a stub, so claude-agent-acp is never run) and
// "New session in the current directory", "Explicit directory wins" (the real
// app against fake-agent: `session/new` got the directory, from fake-agent's
// own log, and the status row shows it). Each run has its own empty
// XDG_CONFIG_HOME and XDG_STATE_HOME.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CLAUDE_EXAMPLE_COMMAND } from "../../src/agent/command.ts";
import type { LaunchDescription } from "../../src/agent/resolve.ts";
import { startPty, type PtySession } from "../pty/harness.ts";
import { READY, statusRow } from "../pty/regions.ts";

const ROOT = resolve(import.meta.dir, "../../../..");
const CLI = join(ROOT, "packages/acp-tui/src/cli.ts");
const STUB = join(ROOT, "packages/acp-tui/test/cli/cli-launch-stub.ts");
const FAKE_AGENT = join(ROOT, "packages/fake-agent/src/main.ts");

function temp(prefix: string): string {
  return realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), prefix)));
}

/** A private configuration and state home (empty: no config.jsonc, no index). */
function xdg(): Record<string, string> {
  const base = temp("acp-tui-launch-xdg-");
  return { XDG_CONFIG_HOME: join(base, "config"), XDG_STATE_HOME: join(base, "state") };
}

let session: PtySession | null = null;
afterEach(async () => {
  await session?.dispose();
  session = null;
});

describe("Agent launch (tui-agent-session)", () => {
  test("Auggie by default: no configuration file and no arguments resolve to auggie --acp", async () => {
    const cwd = temp("acp-tui-launch-");
    const out = join(cwd, "launch.json");
    session = startPty(["bun", STUB, "--"], { cols: 80, rows: 24, cwd, env: { ...xdg(), ACP_TUI_TEST_LAUNCH_OUT: out } });
    expect(await session.wait(15000)).toBe(0);
    expect(existsSync(out)).toBe(true);
    const launch = JSON.parse(readFileSync(out, "utf8")) as LaunchDescription;
    expect([launch.command, ...launch.args]).toEqual(["auggie", "--acp"]);
    expect(launch).toMatchObject({
      agentName: "auggie",
      agentSource: "default",
      env: {},
      directory: cwd,
      directorySource: "launch",
      launchDirectory: cwd,
      session: { kind: "new" },
      problems: [],
    });
  });

  test("Claude after uncommenting: acp-tui claude resolves to the entry's pinned claude-agent-acp command and its 120 second timeout", async () => {
    const cwd = temp("acp-tui-launch-");
    const out = join(cwd, "launch.json");
    const env = xdg();
    mkdirSync(join(env["XDG_CONFIG_HOME"]!, "acp-tui"), { recursive: true });
    const [command, ...args] = CLAUDE_EXAMPLE_COMMAND;
    writeFileSync(join(env["XDG_CONFIG_HOME"]!, "acp-tui", "config.jsonc"), JSON.stringify({ agent_servers: { claude: { command, args, startup_timeout_seconds: 120 } } }));
    session = startPty(["bun", STUB, "--", "claude"], { cols: 80, rows: 24, cwd, env: { ...env, ACP_TUI_TEST_LAUNCH_OUT: out } });
    expect(await session.wait(15000)).toBe(0);
    const launch = JSON.parse(readFileSync(out, "utf8")) as LaunchDescription;
    expect([launch.command, ...launch.args]).toEqual([...CLAUDE_EXAMPLE_COMMAND]);
    expect(launch).toMatchObject({ agentName: "claude", agentSource: "option", startupTimeoutSeconds: 120 });
  });
});

describe("New session in the current directory (tui-agent-session)", () => {
  test("Explicit directory wins: acp-tui ./repo-c from /work sends session/new with /work/repo-c and shows it", async () => {
    const work = temp("acp-tui-launch-work-");
    mkdirSync(join(work, "repo-c"));
    const log = join(work, "fake-agent.log");
    session = startPty(["bun", CLI, "--", "./repo-c", "--", "bun", FAKE_AGENT, "--scenario", "basic", "--log", log], {
      cols: 120,
      rows: 24,
      cwd: work,
      env: xdg(),
    });
    await session.waitFor(READY, 15000);
    const entries = readFileSync(log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { method: string; params: { cwd?: string } });
    const created = entries.find((e) => e.method === "session/new");
    expect(created?.params.cwd).toBe(join(work, "repo-c"));
    expect(statusRow(session)).toContain("repo-c");
    session.sendKeys("Ctrl+D");
    expect(await session.wait(10000)).toBe(0);
  });

  test("--resume with a directory (mvp-sessions tasks 7.2 and 12.7): the agent is launched and initialised, the list opens with no session, and Esc starts one in the directory argument", async () => {
    const work = temp("acp-tui-launch-work-");
    mkdirSync(join(work, "repo-c"));
    const log = join(work, "fake-agent.log");
    session = startPty(["bun", CLI, "--", "--resume", "./repo-c", "--", "bun", FAKE_AGENT, "--scenario", "basic", "--log", log], {
      cols: 100,
      rows: 24,
      cwd: work,
      env: xdg(),
    });
    const s = session;
    await s.waitFor(/╭─ Sessions in .*repo-c/, 15000);
    const methods = () =>
      existsSync(log)
        ? readFileSync(log, "utf8")
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line) as { method: string; params: { cwd?: string } })
        : [];
    // The list opens with the first frame, before the agent is up (day-two-feedback D2): wait for it.
    await s.waitFor(() => methods().some((e) => e.method === "initialize"), 15000);
    // An agent without session/list: no list request; the selector's row for the default configuration's auggie only.
    expect(methods().map((e) => e.method)).toEqual(["initialize"]);
    expect(s.screenText().some((r) => r.includes("New session with auggie"))).toBe(true);
    s.sendKeys("Esc");
    // The status row says connected once the agent is initialised, before the session starts.
    await s.waitFor(() => methods().some((e) => e.method === "session/new"), 5000);
    expect(methods().find((e) => e.method === "session/new")?.params.cwd).toBe(join(work, "repo-c"));
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
  });
});
