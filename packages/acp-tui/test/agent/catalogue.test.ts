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
  buildAgentCatalogue,
  configFilePath,
  findAgent,
  findDefaultAgent,
  loadAgentCatalogue,
} from "../../src/agent/catalogue.ts";
import { auggieInstallHint, auggieLoginCommand, CLAUDE_AGENT_PACKAGE, CLAUDE_EXAMPLE_COMMAND, opencodeInstallHint } from "../../src/agent/command.ts";
import { commentedDefault } from "../../src/config/default-file.ts";
import { launchAgent } from "../../src/agent/launch.ts";
import { launchArgv } from "../../src/agent/resolve.ts";
import { main, type StartAppOptions } from "../../src/cli.ts";
import { WINDOWS } from "../windows.ts";
import { shortenHome } from "../../src/layout/segments.ts";
import { userHome } from "../../src/platform/paths.ts";

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

describe("The claude example's command", () => {
  test("the commented default's claude example writes the pinned package through bunx, the same on every machine", () => {
    expect(CLAUDE_EXAMPLE_COMMAND).toEqual(["bunx", "--bun", CLAUDE_AGENT_PACKAGE]);
  });
});

describe("the configuration file's path", () => {
  test("$XDG_CONFIG_HOME/acp-tui/config.jsonc, else ~/.config when XDG_CONFIG_HOME is unset or not absolute", () => {
    expect(configFilePath({ XDG_CONFIG_HOME: "/x/cfg", HOME: "/home/u" }, "linux")).toBe("/x/cfg/acp-tui/config.jsonc");
    expect(configFilePath({ HOME: "/home/u" }, "linux")).toBe("/home/u/.config/acp-tui/config.jsonc");
    expect(configFilePath({ XDG_CONFIG_HOME: "relative/cfg", HOME: "/home/u" }, "linux")).toBe("/home/u/.config/acp-tui/config.jsonc");
  });

  test("the test run never points at the user's own configuration (test/preload/xdg.ts)", () => {
    expect(process.env.XDG_CONFIG_HOME).toContain("acp-tui-test-xdg-");
    expect(process.env.XDG_STATE_HOME).toContain("acp-tui-test-xdg-");
  });
});

describe("Named agents (tui-sessions)", () => {
  test("Auggie by default: without a configuration file, the default configuration's auggie entry only, no problem", () => {
    const catalogue = loadAgentCatalogue({ env: { XDG_CONFIG_HOME: configHome(null) } });
    expect([...catalogue.agents.keys()]).toEqual(["auggie"]);
    expect(launchArgv(findAgent(catalogue, "auggie"))).toEqual(["auggie", "--acp"]);
    expect(findAgent(catalogue, "auggie")).toMatchObject({ additionalDirectoryArgs: ["--add-workspace", "{dir}"], startupTimeoutSeconds: 30, installHint: auggieInstallHint(), loginHint: auggieLoginCommand() });
    expect(catalogue.defaultAgent).toBe("auggie");
    expect(catalogue.problems).toEqual([]);
    expect(() => findAgent(catalogue, "claude")).toThrow(/harness 'claude' is not configured; uncomment its entry in /);
  });

  test("Existing file without entries: a file with no agent_servers has no harnesses, and starting with no name fails", async () => {
    const home = configHome(`{ "mouse": "off" }`);
    const catalogue = loadAgentCatalogue({ env: { XDG_CONFIG_HOME: home } });
    expect([...catalogue.agents.keys()]).toEqual([]);
    expect(catalogue.problems).toEqual([]);
    const r = await run([], home);
    expect(r.code).not.toBe(0);
    expect(r.started).toBe(false);
    expect(r.stderr).toBe(`acp-tui: default harness 'auggie' is not configured; add its entry to ${shortenHome(join(home, "acp-tui", "config.jsonc"), userHome())} (see config.dist.jsonc or acp-tui config --print-default)\n`);
  });

  test("Old file naming Claude: default_agent claude with no claude entry fails with the default harness message", async () => {
    const home = configHome(`{ "default_agent": "claude" }`);
    const catalogue = loadAgentCatalogue({ env: { XDG_CONFIG_HOME: home } });
    expect(catalogue.defaultAgent).toBe("claude");
    expect(() => findDefaultAgent(catalogue)).toThrow(AgentNameError);
    const r = await run([], home);
    expect(r.code).not.toBe(0);
    expect(r.started).toBe(false);
    expect(r.stderr).toBe(`acp-tui: default harness 'claude' is not configured; add its entry to ${shortenHome(join(home, "acp-tui", "config.jsonc"), userHome())} (see config.dist.jsonc or acp-tui config --print-default)\n`);
  });

  test("Name with no entry: the default name is kept, with no fallback to auggie", () => {
    const catalogue = buildAgentCatalogue(`{ "agent_servers": { "auggie": { "command": "auggie", "args": ["--acp"] } }, "default_agent_server": "claude" }`, "/c.jsonc");
    expect(catalogue.defaultAgent).toBe("claude");
    expect(() => findDefaultAgent(catalogue)).toThrow("default harness 'claude' is not configured; add its entry to /c.jsonc (see config.dist.jsonc or acp-tui config --print-default)");
  });

  test("Named harness still works: a harness named on the command line launches without the default being configured", async () => {
    const home = configHome(FAKE_CONFIG.replace('"mouse": "off",', '"mouse": "off", "default_agent_server": "claude",'));
    const r = await run(["-a", "fake"], home);
    expect(r.code).toBe(0);
    expect(r.launch?.agentName).toBe("fake");
  });

  test("Claude after uncommenting: a claude entry written as the example has the 120 second start-up timeout and no hints", () => {
    const text = `{ "agent_servers": { "claude": { "command": "bunx", "args": ["--bun", "${CLAUDE_AGENT_PACKAGE}"], "startup_timeout_seconds": 120 } }, "default_agent_server": "claude" }`;
    const catalogue = buildAgentCatalogue(text, "/c.jsonc");
    expect(catalogue.problems).toEqual([]);
    expect(launchArgv(findDefaultAgent(catalogue))).toEqual(CLAUDE_EXAMPLE_COMMAND);
    expect(findDefaultAgent(catalogue).startupTimeoutSeconds).toBe(120);
    expect(findDefaultAgent(catalogue).loginHint).toBeUndefined();
  });

  test("Configured agent: -a fake launches its command and arguments, with its env", async () => {
    const r = await run(["-a", "fake"], configHome(FAKE_CONFIG));
    expect(r.code).toBe(0);
    expect(r.launch?.agentName).toBe("fake");
    expect(launchArgv(r.launch!)).toEqual(["bun", "packages/fake-agent/src/main.ts", "--scenario", "basic"]);
    expect(r.launch?.env).toEqual({ ACP_TUI_TEST_AGENT_ENV: "from-config" });
    expect(r.launch?.problems).toEqual([]);
  });

  // Skipped on Windows: the harness is "sh -c".
  test.skipIf(WINDOWS)("Configured agent: the entry's env is added to the agent's environment, not in place of it", async () => {
    const agent = launchAgent(["sh", "-c", 'printf "%s|%s" "$ACP_TUI_TEST_AGENT_ENV" "$PATH"'], { env: { ACP_TUI_TEST_AGENT_ENV: "from-config" } });
    const out = await new Response(agent.stdout).text();
    await agent.exited;
    const [added, path] = out.split("|");
    expect(added).toBe("from-config");
    expect(path).toBe(process.env.PATH);
  });

  test("a configured entry of any name is launched as written", () => {
    const catalogue = buildAgentCatalogue(`{ "agent_servers": { "claude": { "command": "my-claude", "args": ["--acp"] } } }`, "/c.jsonc");
    expect(launchArgv(findAgent(catalogue, "claude"))).toEqual(["my-claude", "--acp"]);
  });

  test("Unknown name: -a nosuch names it, lists the known names, exits non-zero, launches nothing", async () => {
    const home = configHome(FAKE_CONFIG);
    const r = await run(["-a", "nosuch"], home);
    expect(r.code).not.toBe(0);
    expect(r.started).toBe(false);
    expect(r.stderr).toBe(
      `acp-tui: 'nosuch' is not a known harness (known: 'fake'; harnesses are defined in agent_servers in ${join(home, "acp-tui", "config.jsonc")})\n`,
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

  test("no default_agent: auggie is the name, and the file has to hold its entry", async () => {
    const withAuggie = FAKE_CONFIG.replace('"fake": {', '"auggie": { "command": "fake-auggie", "args": ["--acp"] }, "fake": {');
    const r = await run([], configHome(withAuggie));
    expect(r.launch?.agentName).toBe("auggie");
    expect(launchArgv(r.launch!)).toEqual(["fake-auggie", "--acp"]);
    const without = await run([], configHome(FAKE_CONFIG));
    expect(without.code).not.toBe(0);
    expect(without.started).toBe(false);
  });

  test("Names a harness that is not known: a default_agent naming no entry is a problem at the value, the name is kept and launching by it fails", async () => {
    const home = configHome(`{ "default_agent": "ghost" }`);
    const catalogue = loadAgentCatalogue({ env: { XDG_CONFIG_HOME: home } });
    expect(catalogue.defaultAgent).toBe("ghost");
    expect(catalogue.problems).toEqual([`${join(home, "acp-tui", "config.jsonc")}:1:20: default_agent names "ghost", which has no agent_servers entry, so acp-tui without a harness name fails`]);
    const r = await run([], home);
    expect(r.code).not.toBe(0);
    expect(r.started).toBe(false);
  });

  test("an ad hoc harness command takes no harness or problem from the configuration", async () => {
    // A syntax error would be a problem if the file's problems were shown for it.
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
    expect(plain.launch?.agentName).toBe("auggie");
    expect(launchArgv(plain.launch!)).toEqual(["auggie", "--acp"]);
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
    expect([...catalogue.agents.keys()]).toEqual(["ok"]);
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

  test("an invalid claude entry is not launchable, with a problem", () => {
    const catalogue = buildAgentCatalogue(`{ "agent_servers": { "claude": { "command": [] } } }`, "/c.jsonc");
    expect([...catalogue.agents.keys()]).toEqual([]);
    expect(() => findAgent(catalogue, "claude")).toThrow(AgentNameError);
    expect(catalogue.problems).toEqual(["/c.jsonc:1:45: agent_servers.claude.command takes a non-empty string, not an array"]);
  });

  test("Per-harness value: hints follow the program an entry runs, whatever the entry is called", () => {
    const catalogue = buildAgentCatalogue(
      JSON.stringify({
        agent_servers: {
          auggie: { command: "auggie", args: ["--acp"], additional_directory_args: ["--add-workspace", "{dir}"] },
          oc: { command: "opencode", args: ["acp"] },
          "my-auggie": { command: "my-auggie", args: ["--acp"] },
          cl: { command: "bunx", args: ["--bun", CLAUDE_AGENT_PACKAGE] },
          plain: { command: "x" },
        },
      }),
      "/c.jsonc",
    );
    expect(catalogue.agents.get("auggie")).toMatchObject({ installHint: auggieInstallHint(), loginHint: auggieLoginCommand(), additionalDirectoryArgs: ["--add-workspace", "{dir}"] });
    expect(catalogue.agents.get("oc")).toMatchObject({ installHint: opencodeInstallHint(), loginHint: "opencode auth login" });
    expect(catalogue.agents.get("oc")?.additionalDirectoryArgs).toBeUndefined();
    expect(catalogue.agents.get("my-auggie")?.installHint).toBeUndefined();
    expect(catalogue.agents.get("my-auggie")?.loginHint).toBeUndefined();
    expect(catalogue.agents.get("cl")?.installHint).toContain("Bun");
    expect(catalogue.agents.get("cl")?.loginHint).toBeUndefined();
    expect(catalogue.agents.get("plain")?.installHint).toBeUndefined();
  });

  test("a default_agent naming an invalid entry is a problem, the name is kept and starting with it fails", () => {
    const catalogue = buildAgentCatalogue(`{ "agent_servers": { "broken": { "command": 1 } }, "default_agent": "broken" }`, "/c.jsonc");
    expect(catalogue.defaultAgent).toBe("broken");
    expect(catalogue.problems).toContain(
      '/c.jsonc:1:69: default_agent names harness "broken", which has an invalid command: it takes a non-empty string, not 1 (line 1, column 45), so acp-tui without a harness name fails',
    );
    expect(() => findDefaultAgent(catalogue)).toThrow(/has an invalid command/);
  });

  test("a syntax error, a non-object file or a non-object agent_servers: a problem, no entries", () => {
    for (const text of ["{ \"agent_servers\": ", "[1, 2]", `{ "agent_servers": ["fake"] }`]) {
      const catalogue = buildAgentCatalogue(text, "/c.jsonc");
      expect([...catalogue.agents.keys()]).toEqual([]);
      expect(catalogue.problems).toHaveLength(1);
    }
    expect(buildAgentCatalogue("{ oops", "/c.jsonc").problems[0]).toBe("/c.jsonc:1:3: is not valid JSONC here: an unexpected character; the file is ignored until it parses");
  });
});

describe("Start-up timeout setting (harness-feedback tui-config)", () => {
  const timeout = (text: string | null, name: string): number | undefined => buildAgentCatalogue(text, "/c/config.jsonc").agents.get(name)?.startupTimeoutSeconds;

  test("no per-harness defaults: 30 for every entry without a value, the file's absent default included", () => {
    expect(timeout(null, "auggie")).toBe(30);
    expect(timeout(`{ "agent_servers": { "claude": { "command": "x" }, "opencode": { "command": "opencode" } } }`, "claude")).toBe(30);
    expect(timeout(`{ "agent_servers": { "claude": { "command": "x" }, "opencode": { "command": "opencode" } } }`, "opencode")).toBe(30);
    expect(buildAgentCatalogue(null, "/c/config.jsonc").startupTimeoutSetting).toBeNull();
  });

  test("Per-harness value: the entry wins for its harness, the setting is every other harness's", () => {
    const text = `{ "agent_startup_timeout_seconds": 10, "agent_servers": { "slow": { "command": "x", "startup_timeout_seconds": 90 }, "plain": { "command": "y" } } }`;
    const catalogue = buildAgentCatalogue(text, "/c/config.jsonc");
    expect(catalogue.problems).toEqual([]);
    expect(catalogue.agents.get("slow")?.startupTimeoutSeconds).toBe(90);
    expect(catalogue.agents.get("plain")?.startupTimeoutSeconds).toBe(10);
    expect(catalogue.startupTimeoutSetting).toBe(10);
  });

  test("Out of range: 2 is a problem at the value saying a whole number from 5 to 600, and the last good value (30) stays", () => {
    const entries = `"agent_servers": { "plain": { "command": "y" } }`;
    for (const bad of ["2", "601", "7.5", `"30"`]) {
      const catalogue = buildAgentCatalogue(`{ "agent_startup_timeout_seconds": ${bad}, ${entries} }`, "/c/config.jsonc");
      expect(catalogue.problems.join("\n")).toContain("agent_startup_timeout_seconds");
      expect(catalogue.agents.get("plain")?.startupTimeoutSeconds).toBe(30);
    }
    const message = buildAgentCatalogue(`{ "agent_startup_timeout_seconds": 2 }`, "/c/config.jsonc").problems[0]!;
    expect(message).toMatch(/whole number from 5 to 600/);
    const entry = buildAgentCatalogue(`{ "agent_servers": { "x": { "command": "x", "startup_timeout_seconds": 3 } } }`, "/c/config.jsonc");
    expect(entry.invalid.get("x")).toContain("startup_timeout_seconds");
    expect(entry.agents.has("x")).toBe(false);
  });

  test("the commented default prints the setting in effect, and the claude example commented out with 120", () => {
    const text = commentedDefault();
    expect(text).toMatch(/^\s*"agent_startup_timeout_seconds": 30,$/m);
    expect(text).toMatch(/^\s*\/\/ "claude": .*"startup_timeout_seconds": 120 \},$/m);
    expect(timeout(text, "auggie")).toBe(30);
  });
});
