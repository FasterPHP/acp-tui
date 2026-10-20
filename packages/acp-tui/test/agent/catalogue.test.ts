// mvp-sessions task 3.2: the agent catalogue (design decision 8). The user's
// configuration is a `config.jsonc` in a temporary XDG_CONFIG_HOME, read
// through `loadAgentCatalogue` and the real `main` with an injected
// `startApp`, so "without launching an agent" means the app never started.
// Spec tui-sessions "Named agents" ("Configured agent", "Unknown name",
// "Default agent from the configuration") and "Agents are defined only in the
// user's configuration" ("Project file names an agent", "Invalid entry").
import { describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import {
  AgentNameError,
  BUILT_IN_AGENTS,
  BUILT_IN_AGENT_NAME,
  buildAgentCatalogue,
  configFilePath,
  findAgent,
  loadAgentCatalogue,
} from "../../src/agent/catalogue.ts";
import { builtInAgentCommand, CLAUDE_AGENT_PACKAGE, DEFAULT_AGENT_COMMAND, DEFAULT_AGENT_EXAMPLE_COMMAND } from "../../src/agent/command.ts";
import { launchAgent } from "../../src/agent/launch.ts";
import { launchArgv } from "../../src/agent/resolve.ts";
import { main, type StartAppOptions } from "../../src/cli.ts";

function temp(prefix: string): string {
  return realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), prefix)));
}

/** A temporary XDG_CONFIG_HOME holding `acp-tui/config.jsonc` with `text` (none when null). */
function configHome(text: string | null): string {
  const home = temp("acp-tui-config-");
  if (text !== null) {
    mkdirSync(join(home, "acp-tui"));
    writeFileSync(join(home, "acp-tui", "config.jsonc"), text);
  }
  return home;
}

/** The real `main` with the catalogue read from `home`, from `cwd`. */
async function run(argv: string[], home: string, cwd = temp("acp-tui-launch-")) {
  const stderr: string[] = [];
  const startApp = mock(async (_options: StartAppOptions) => 0);
  const io = { stdout: { isTTY: true, write: () => true }, stderr: { write: (t: string) => stderr.push(t) } };
  const code = await main(argv, io, startApp, { cwd, catalogue: () => loadAgentCatalogue({ env: { XDG_CONFIG_HOME: home } }) });
  const launch = (startApp.mock.calls[0]?.[0] as StartAppOptions | undefined)?.launch;
  return { code, stderr: stderr.join(""), started: startApp.mock.calls.length > 0, launch };
}

const FAKE_CONFIG = `{
  // Agents in Zed's shape; comments and trailing commas are JSONC.
  "agent_servers": {
    "fake": {
      "command": "bun",
      "args": ["packages/fake-agent/src/main.ts", "--scenario", "basic",],
      "env": { "ACP_TUI_TEST_AGENT_ENV": "from-config" },
    },
  },
  /* Keys this change does not read are ignored. */
  "mouse": "off",
  "theme": { "name": "mine" },
}
`;

describe("The default agent command", () => {
  test("runs claude-agent-acp under Bun, never through the node on the PATH", () => {
    expect(DEFAULT_AGENT_COMMAND).toEqual([process.execPath, "x", "--bun", "@agentclientprotocol/claude-agent-acp@0.81.2"]);
  });

  test("runs the Bun that runs acp-tui, by its absolute path, not a bunx looked up on the PATH (on Windows too)", () => {
    expect(builtInAgentCommand("C:\\Users\\u\\.bun\\bin\\bun.exe")).toEqual(["C:\\Users\\u\\.bun\\bin\\bun.exe", "x", "--bun", CLAUDE_AGENT_PACKAGE]);
    expect(isAbsolute(DEFAULT_AGENT_COMMAND[0]!)).toBe(true);
    expect(BUILT_IN_AGENTS[0]).toMatchObject({ name: "claude", command: process.execPath, args: ["x", "--bun", CLAUDE_AGENT_PACKAGE] });
  });

  test("the commented default's claude example writes the same package and arguments through bunx, the same on every machine", () => {
    expect(DEFAULT_AGENT_EXAMPLE_COMMAND).toEqual(["bunx", "--bun", CLAUDE_AGENT_PACKAGE]);
  });
});

describe("the configuration file's path", () => {
  test("$XDG_CONFIG_HOME/acp-tui/config.jsonc, else ~/.config when XDG_CONFIG_HOME is unset or not absolute", () => {
    expect(configFilePath({ XDG_CONFIG_HOME: "/x/cfg", HOME: "/home/u" })).toBe("/x/cfg/acp-tui/config.jsonc");
    expect(configFilePath({ HOME: "/home/u" })).toBe("/home/u/.config/acp-tui/config.jsonc");
    expect(configFilePath({ XDG_CONFIG_HOME: "relative/cfg", HOME: "/home/u" })).toBe("/home/u/.config/acp-tui/config.jsonc");
  });

  test("the test run never points at the user's own configuration (test/preload/xdg.ts)", () => {
    expect(process.env.XDG_CONFIG_HOME).toContain("acp-tui-test-xdg-");
    expect(process.env.XDG_STATE_HOME).toContain("acp-tui-test-xdg-");
  });
});

describe("Named agents (tui-sessions)", () => {
  test("without a configuration file: the built-in claude entry only, no problem", () => {
    const catalogue = loadAgentCatalogue({ env: { XDG_CONFIG_HOME: configHome(null) } });
    expect([...catalogue.agents.keys()]).toEqual([BUILT_IN_AGENT_NAME]);
    expect(launchArgv(findAgent(catalogue, "claude"))).toEqual(DEFAULT_AGENT_COMMAND);
    expect(catalogue.defaultAgent).toBe("claude");
    expect(catalogue.problems).toEqual([]);
  });

  test("Configured agent: -a fake launches its command and arguments, with its env", async () => {
    const r = await run(["-a", "fake"], configHome(FAKE_CONFIG));
    expect(r.code).toBe(0);
    expect(r.launch?.agentName).toBe("fake");
    expect(launchArgv(r.launch!)).toEqual(["bun", "packages/fake-agent/src/main.ts", "--scenario", "basic"]);
    expect(r.launch?.env).toEqual({ ACP_TUI_TEST_AGENT_ENV: "from-config" });
    expect(r.launch?.problems).toEqual([]);
  });

  test("Configured agent: the entry's env is added to the agent's environment, not in place of it", async () => {
    const agent = launchAgent(["sh", "-c", 'printf "%s|%s" "$ACP_TUI_TEST_AGENT_ENV" "$PATH"'], { env: { ACP_TUI_TEST_AGENT_ENV: "from-config" } });
    const out = await new Response(agent.stdout).text();
    await agent.exited;
    const [added, path] = out.split("|");
    expect(added).toBe("from-config");
    expect(path).toBe(process.env.PATH);
  });

  test("a configured entry overrides a built-in one of the same name", () => {
    const catalogue = buildAgentCatalogue(`{ "agent_servers": { "claude": { "command": "my-claude", "args": ["--acp"] } } }`, "/c.jsonc");
    expect(launchArgv(findAgent(catalogue, "claude"))).toEqual(["my-claude", "--acp"]);
    expect(findAgent(catalogue, "claude").source).toBe("config");
  });

  test("Unknown name: -a nosuch names it, lists the known names, exits non-zero, launches nothing", async () => {
    const home = configHome(FAKE_CONFIG);
    const r = await run(["-a", "nosuch"], home);
    expect(r.code).not.toBe(0);
    expect(r.started).toBe(false);
    expect(r.stderr).toBe(
      `acp-tui: 'nosuch' is not a known harness (known: 'claude', 'fake'; harnesses are defined in agent_servers in ${join(home, "acp-tui", "config.jsonc")})\n`,
    );
  });

  test("Default agent from the configuration: default_agent fake and no arguments launch fake", async () => {
    const r = await run([], configHome(FAKE_CONFIG.replace('"mouse": "off",', '"mouse": "off", "default_agent": "fake",')));
    expect(r.code).toBe(0);
    expect(r.launch?.agentName).toBe("fake");
    expect(r.launch?.agentSource).toBe("default");
    expect(launchArgv(r.launch!)[0]).toBe("bun");
  });

  test("Default agent from the configuration under its new name (day-two-feedback task 13.5): default_agent_server fake and no arguments launch fake", async () => {
    const r = await run([], configHome(FAKE_CONFIG.replace('"mouse": "off",', '"mouse": "off", "default_agent_server": "fake",')));
    expect(r.code).toBe(0);
    expect(r.launch?.agentName).toBe("fake");
    expect(r.launch?.agentSource).toBe("default");
    expect(r.launch?.problems).toEqual([]);
  });

  test("no default_agent: claude", async () => {
    const r = await run([], configHome(FAKE_CONFIG));
    expect(r.launch?.agentName).toBe("claude");
    expect(launchArgv(r.launch!)).toEqual(DEFAULT_AGENT_COMMAND);
  });

  test("a default_agent that names no agent is a problem, and claude is launched (a broken file never stops acp-tui)", async () => {
    const r = await run([], configHome(`{ "default_agent": "ghost" }`));
    expect(r.code).toBe(0);
    expect(r.launch?.agentName).toBe("claude");
    expect(r.launch?.problems).toHaveLength(1);
    expect(r.launch?.problems[0]).toContain("default_agent");
    // Since mvp-configuration the problem carries its place (task 1.5).
    expect(r.launch?.problems[0]).toContain(`config.jsonc:1:20: default_agent names "ghost", which is not a known harness; "claude" is used`);
  });

  test("an ad hoc harness command never reads the configuration", async () => {
    // A syntax error would be a problem if the file were read.
    const r = await run(["--", "my-agent"], configHome("{ not json"));
    expect(r.launch?.problems).toEqual([]);
    expect(r.launch?.agentName).toBe("ad hoc");
  });
});

describe("Agents are defined only in the user's configuration (tui-sessions)", () => {
  test("Project file names an agent: -a evil with evil in ./.acp-tui.jsonc is not a known harness; nothing is launched", async () => {
    const project = temp("acp-tui-project-");
    writeFileSync(join(project, ".acp-tui.jsonc"), `{ "agent_servers": { "evil": { "command": "/tmp/x" } }, "default_agent": "evil" }`);
    const home = configHome(null);
    const r = await run(["-a", "evil"], home, project);
    expect(r.code).not.toBe(0);
    expect(r.started).toBe(false);
    expect(r.stderr).toContain("'evil' is not a known harness");
    // Nor does the project file choose the default.
    const plain = await run([], home, project);
    expect(plain.launch?.agentName).toBe("claude");
  });

  test("Invalid entry: a numeric command is reported with the entry's name and the problem; nothing is launched", async () => {
    const home = configHome(`{ "agent_servers": { "broken": { "command": 42 } } }`);
    const r = await run(["-a", "broken"], home);
    expect(r.code).not.toBe(0);
    expect(r.started).toBe(false);
    expect(r.stderr).toBe(
      `acp-tui: harness 'broken' in ${join(home, "acp-tui", "config.jsonc")} has an invalid command: it takes a non-empty string, not 42 (line 1, column 45), so it cannot be launched\n`,
    );
  });

  test("every kind of invalid entry is kept out of the launchable agents, with its problem", () => {
    const catalogue = buildAgentCatalogue(
      JSON.stringify({
        agent_servers: {
          ok: { command: "a" },
          empty: { command: "" },
          args: { command: "a", args: "--x" },
          argItems: { command: "a", args: ["--x", 1] },
          env: { command: "a", env: { X: 1 } },
          envArray: { command: "a", env: ["X=1"] },
          notObject: "a",
          "bad\u001bname": { command: "a" },
        },
      }),
      "/c.jsonc",
    );
    expect([...catalogue.agents.keys()]).toEqual(["claude", "ok"]);
    // Since mvp-configuration (task 1.5) each reason is written from the schema, with its place.
    expect(Object.fromEntries(catalogue.invalid)).toEqual({
      empty: 'has an invalid command: it takes a non-empty string, not "" (line 1, column 59)',
      args: 'has invalid args: it takes an array of strings, not "--x" (line 1, column 92)',
      argItems: "has invalid args: args.1 takes a string, not 1 (line 1, column 139)",
      env: "has an invalid env: env.X takes a string, not 1 (line 1, column 175)",
      envArray: "has an invalid env: it takes an object of strings, not an array (line 1, column 211)",
      notObject: 'is invalid: it takes an object, not "a" (line 1, column 232)',
      "bad\u001bname": "has an invalid name (line 1, column 236)",
    });
    expect(catalogue.problems).toHaveLength(7);
    // Every problem is printable: the control character in the name is not echoed.
    for (const problem of catalogue.problems) expect(problem).not.toContain("\u001b");
    expect(() => findAgent(catalogue, "args")).toThrow(AgentNameError);
  });

  test("an invalid override of claude leaves the built-in entry launchable, with a problem", () => {
    const catalogue = buildAgentCatalogue(`{ "agent_servers": { "claude": { "command": [] } } }`, "/c.jsonc");
    expect(launchArgv(findAgent(catalogue, "claude"))).toEqual(DEFAULT_AGENT_COMMAND);
    expect(catalogue.problems).toEqual(["/c.jsonc:1:45: agent_servers.claude.command takes a non-empty string, not an array"]);
  });

  test("a default_agent naming an invalid entry is a problem; claude is the default", () => {
    const catalogue = buildAgentCatalogue(`{ "agent_servers": { "broken": { "command": 1 } }, "default_agent": "broken" }`, "/c.jsonc");
    expect(catalogue.defaultAgent).toBe("claude");
    expect(catalogue.problems).toContain(
      '/c.jsonc:1:69: default_agent names harness "broken", which has an invalid command: it takes a non-empty string, not 1 (line 1, column 45); "claude" is used',
    );
  });

  test("a syntax error, a non-object file or a non-object agent_servers: a problem, the built-in entry only", () => {
    for (const text of ["{ \"agent_servers\": ", "[1, 2]", `{ "agent_servers": ["fake"] }`]) {
      const catalogue = buildAgentCatalogue(text, "/c.jsonc");
      expect([...catalogue.agents.keys()]).toEqual(["claude"]);
      expect(catalogue.problems).toHaveLength(1);
    }
    expect(buildAgentCatalogue("{ oops", "/c.jsonc").problems[0]).toBe("/c.jsonc:1:3: is not valid JSONC here: an unexpected character; the file is ignored until it parses");
  });
});
