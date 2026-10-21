// A harness entry's own `additional_directories` (configured-harnesses D8, Marcus, 21 October 2026;
// spec tui-config "Additional directories per harness", tui-sessions "Additional directories sent to
// the harness"): they reach that harness only, through ACP's field when it advertises it, else
// through its `additional_directory_args`, and come before a project file's, the recorded ones and
// `--add-dir`, without repeats and never the session directory. Against fake-agent, whose `--log`
// records what it received; the catalogue, the index and the configuration are injected.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAgentCatalogue, type AgentCatalogue, type AgentEntry } from "../../src/agent/catalogue.ts";
import { launchArgv, resolveLaunch, withDirectories, type LaunchDescription } from "../../src/agent/resolve.ts";
import { openSessionIndex } from "../../src/session/session-index.ts";
import { createSessionSwitcher, type SessionSwitcher } from "../../src/session/switch.ts";
import { fakeAgentCommand } from "../agent/fake-agent-command.ts";

let switcher: SessionSwitcher | null = null;
afterEach(async () => {
  await switcher?.detach();
  switcher = null;
});

interface Received {
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

function tree() {
  const dir = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-harness-dirs-")));
  const [app, lib, docs, api] = ["app", "lib", "docs", "api"].map((name) => join(dir, name)) as [string, string, string, string];
  for (const d of [app, lib, docs, api]) mkdirSync(d);
  return { dir, app, lib, docs, api };
}

const none = { agentName: null, agentCommand: null, directory: null, session: { kind: "new" as const } };

describe("The launch's list", () => {
  test("Order: the entry's, the project file's, then --add-dir; no repeats; never the session directory", () => {
    const t = tree();
    const catalogue = () => buildAgentCatalogue(JSON.stringify({ agent_servers: { a: { command: "a", additional_directories: [t.lib, t.app, t.docs] } } }), join(t.dir, "config.jsonc"));
    const launch = resolveLaunch(
      { ...none, agentName: "a", addDirs: [t.api, t.lib] },
      { cwd: t.app, catalogue, index: () => openSessionIndex({ stateHome: join(t.dir, "state") }), configDirectories: () => ({ directories: [t.docs, t.api], projectDirectories: [t.docs, t.api], projectFile: join(t.app, ".acp-tui.jsonc") }) },
    );
    expect(launch.harnessDirectories).toEqual([t.lib, t.app, t.docs]);
    expect(launch.additionalDirectories).toEqual([t.lib, t.docs, t.api]);
    // Only --add-dir's are recorded with the session.
    expect(launch.addedDirectories).toEqual([t.api, t.lib]);
  });

  test("Through the template: the entry's directories go on the command, before --add-dir's", () => {
    const t = tree();
    const catalogue = () =>
      buildAgentCatalogue(JSON.stringify({ agent_servers: { auggie: { command: "auggie", args: ["--acp"], additional_directory_args: ["--add-workspace", "{dir}"], additional_directories: [t.lib] } } }), join(t.dir, "config.jsonc"));
    const launch = resolveLaunch({ ...none, agentName: "auggie", addDirs: [t.docs] }, { cwd: t.app, catalogue, index: () => openSessionIndex({ stateHome: join(t.dir, "state") }), configDirectories: () => ({ directories: [], projectDirectories: [], projectFile: null }) });
    expect(launchArgv(launch)).toEqual(["auggie", "--acp", "--add-workspace", t.lib, "--add-workspace", t.docs]);
  });

  test("Another harness's launch does not take them", () => {
    const t = tree();
    const catalogue = () => buildAgentCatalogue(JSON.stringify({ agent_servers: { a: { command: "a", additional_directories: [t.lib] }, b: { command: "b" } } }), join(t.dir, "config.jsonc"));
    const launch = resolveLaunch({ ...none, agentName: "b" }, { cwd: t.app, catalogue, index: () => openSessionIndex({ stateHome: join(t.dir, "state") }), configDirectories: () => ({ directories: [t.docs], projectDirectories: [t.docs], projectFile: null }) });
    expect(launch.harnessDirectories).toBeUndefined();
    expect(launch.additionalDirectories).toEqual([t.docs]);
    // Derived again (another session directory), still only the project's.
    expect(withDirectories(launch, { directory: t.api }).additionalDirectories).toEqual([t.docs]);
  });
});

describe("Delivery to the harness", () => {
  /** Two fake harnesses: `a` with its own directories, `b` without; both advertise the ACP field. */
  function setup(options: { readonly aDirectories: (t: ReturnType<typeof tree>) => readonly string[]; readonly projectDirectories?: (t: ReturnType<typeof tree>) => readonly string[] }) {
    const t = tree();
    const logPath = join(t.dir, "agent.log");
    const [command, ...base] = fakeAgentCommand({ scenario: "basic", logPath });
    const args = [...base, "--additional-directories"];
    const a: AgentEntry = { name: "a", command: command!, args, env: {}, harnessDirectories: options.aDirectories(t) };
    const b: AgentEntry = { name: "b", command: command!, args, env: { ACP_TUI_TEST_HARNESS: "b" } };
    const catalogue: AgentCatalogue = { path: join(t.dir, "config.jsonc"), agents: new Map([["a", a], ["b", b]]), invalid: new Map(), defaultAgent: "a", problems: [] };
    const project = options.projectDirectories?.(t) ?? [];
    const launch: LaunchDescription = withDirectories(
      {
        agentName: "a",
        agentSource: "option",
        command: a.command,
        args: a.args,
        env: {},
        harnessDirectories: a.harnessDirectories!,
        directory: t.app,
        directorySource: "launch",
        launchDirectory: t.app,
        session: { kind: "new" },
        indexed: null,
        indexMatches: 0,
        problems: [],
        configDirectories: project,
      },
      {},
    );
    const notices: string[] = [];
    const using = createSessionSwitcher({
      launch,
      index: openSessionIndex({ stateHome: join(t.dir, "state") }),
      store: { attach: () => {}, replace: () => {} },
      catalogue: () => catalogue,
      configDirectories: () => project,
      notify: (text) => void notices.push(text),
    });
    switcher = using;
    const received = (): Received[] =>
      readFileSync(logPath, "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as Received);
    return { t, switcher: using, received, notices };
  }

  test("Through ACP: session/new carries the entry's directories, then the project's", async () => {
    const w = setup({ aDirectories: (t) => [t.lib], projectDirectories: (t) => [t.docs, t.lib] });
    await w.switcher.start();
    const created = w.received().filter((e) => e.method === "session/new");
    expect(created).toHaveLength(1);
    expect(created[0]!.params).toMatchObject({ cwd: w.t.app, additionalDirectories: [w.t.lib, w.t.docs] });
    expect(w.notices.some((n) => n.includes("ignores additional directories"))).toBe(false);
  });

  test("Not sent to another harness: a new session with b carries only the project's directories, and none when there are none", async () => {
    const w = setup({ aDirectories: (t) => [t.lib] });
    await w.switcher.start();
    expect(await w.switcher.choose({ kind: "new", agent: "b", current: false })).toBeNull();
    const created = w.received().filter((e) => e.method === "session/new");
    expect(created).toHaveLength(2);
    expect(created[0]!.params).toMatchObject({ additionalDirectories: [w.t.lib] });
    expect(created[1]!.params).not.toHaveProperty("additionalDirectories");
    expect(w.switcher.current()!.launch.additionalDirectories).toEqual([]);
  });
});
