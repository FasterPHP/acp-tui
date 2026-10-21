// mvp-sessions tasks 3.1 and 12.4: `-a`/`--agent`, `--resume [<id>]`,
// `--continue` (`--session` and `--pick` removed, IDE check 10.4, decision D),
// the directory argument and the `--` rule (design decision 9), checked
// through `parseArgs` and through `main` with an injected `startApp`, so that
// "exits non-zero without launching an agent" is observable: the app (which
// launches the agent) is never started. Every scenario of spec tui-sessions
// "Session options on the command line", "Explicit directory argument" and
// "Directory argument and agent command are told apart". The catalogue is
// injected (no user configuration is read); directories are temporary.
import { describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAgentCatalogue } from "../../src/agent/catalogue.ts";
import { launchArgv } from "../../src/agent/resolve.ts";
import { CliArgumentError, main, parseArgs, type CliContext, type StartAppOptions } from "../../src/cli.ts";

const FAKE_COMMAND = ["bun", "packages/fake-agent/src/main.ts", "--scenario", "basic"];

/** A temporary `/work` with `repo-b` and `config` directories and a file `notes.txt`. */
function work(): string {
  const dir = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-session-args-")));
  mkdirSync(join(dir, "repo-b"));
  mkdirSync(join(dir, "config"));
  writeFileSync(join(dir, "notes.txt"), "not a directory\n");
  return dir;
}

/** `main` from `cwd`, with a catalogue that defines `fake`; what it wrote and whether the app started. */
async function run(argv: string[], cwd: string) {
  const stderr: string[] = [];
  const stdout: string[] = [];
  const startApp = mock(async (_options: StartAppOptions) => 0);
  const config = JSON.stringify({ agent_servers: { auggie: { command: "bun", args: ["auggie.ts"] }, fake: { command: "bun", args: FAKE_COMMAND.slice(1) } } });
  const context: CliContext = { cwd, catalogue: () => buildAgentCatalogue(config, "/cfg/acp-tui/config.jsonc") };
  const io = {
    stdout: { isTTY: true, write: (t: string) => stdout.push(t) },
    stderr: { write: (t: string) => stderr.push(t) },
  };
  const code = await main(argv, io, startApp, context);
  const launch = (startApp.mock.calls[0]?.[0] as StartAppOptions | undefined)?.launch;
  return { code, stderr: stderr.join(""), stdout: stdout.join(""), started: startApp.mock.calls.length > 0, launch };
}

describe("Session options on the command line (tui-sessions)", () => {
  test("-a and --agent name the agent, in both value forms", () => {
    expect(parseArgs(["-a", "fake"]).agentName).toBe("fake");
    expect(parseArgs(["--agent", "fake"]).agentName).toBe("fake");
    expect(parseArgs(["--agent=fake"]).agentName).toBe("fake");
    expect(parseArgs(["-a=fake"]).agentName).toBe("fake");
    expect(() => parseArgs(["-a"])).toThrow(new CliArgumentError("-a requires a value"));
    expect(() => parseArgs(["-a", "x", "--agent", "y"])).toThrow(CliArgumentError);
  });

  test("--resume [<id>] and --continue are carried in the parsed options", () => {
    const dir = work();
    expect(parseArgs([], { cwd: dir }).session).toEqual({ kind: "new" });
    expect(parseArgs(["--resume", "0f3c9a2e"], { cwd: dir }).session).toEqual({ kind: "resume", id: "0f3c9a2e" });
    expect(parseArgs(["--resume=0f3c9a2e"], { cwd: dir }).session).toEqual({ kind: "resume", id: "0f3c9a2e" });
    expect(parseArgs(["--resume"], { cwd: dir }).session).toEqual({ kind: "list" });
    expect(parseArgs(["--continue"], { cwd: dir }).session).toEqual({ kind: "continue" });
    expect(() => parseArgs(["--resume="], { cwd: dir })).toThrow(CliArgumentError);
  });

  test("Resume without an ID: an argument that starts with - is an option, not the ID", () => {
    const dir = work();
    expect(parseArgs(["--resume", "-a", "fake"], { cwd: dir })).toMatchObject({ session: { kind: "list" }, agentName: "fake" });
    expect(parseArgs(["--resume", "--mouse", "off"], { cwd: dir })).toMatchObject({ session: { kind: "list" }, screen: { mouse: "off" } });
    expect(parseArgs(["--resume", "--", "my-agent"], { cwd: dir })).toMatchObject({ session: { kind: "list" }, agentCommand: ["my-agent"] });
    // --resume=<id> always gives an ID, even one that starts with `-`.
    expect(parseArgs(["--resume=-x1"], { cwd: dir }).session).toEqual({ kind: "resume", id: "-x1" });
  });

  test("Resume followed by a directory: ./repo-b is the directory argument and --resume opens the list", async () => {
    const dir = work();
    expect(parseArgs(["--resume", "./repo-b"], { cwd: dir })).toMatchObject({ session: { kind: "list" }, directory: join(dir, "repo-b") });
    expect(parseArgs(["--resume", "repo-b", "--", "agent"], { cwd: dir })).toMatchObject({ session: { kind: "list" }, directory: join(dir, "repo-b"), agentCommand: ["agent"] });
    const r = await run(["-a", "fake", "--resume", "./repo-b"], dir);
    expect(r.code).toBe(0);
    expect(r.launch?.session).toEqual({ kind: "list" });
    expect(r.launch?.directory).toBe(join(dir, "repo-b"));
    // A name that is not a directory is the ID: `notes.txt` is a file.
    expect(parseArgs(["--resume", "notes.txt"], { cwd: dir }).session).toEqual({ kind: "resume", id: "notes.txt" });
  });

  test("Two session options: --continue --resume is refused, naming the options, and no agent is launched", async () => {
    const dir = work();
    const r = await run(["--continue", "--resume"], dir);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toBe("acp-tui: --resume and --continue cannot be combined; give at most one of them\n");
    expect(r.started).toBe(false);
  });

  for (const argv of [["--resume", "a", "--continue"], ["--resume", "--resume", "a"], ["--continue", "--resume=a"]]) {
    test(`two session options: ${argv.join(" ")} is refused too`, async () => {
      const r = await run(argv, work());
      expect(r.code).not.toBe(0);
      expect(r.stderr).toContain("--resume and --continue cannot be combined");
      expect(r.started).toBe(false);
    });
  }

  test("two session IDs are refused", async () => {
    const r = await run(["--resume", "a", "--resume", "b"], work());
    expect(r.code).not.toBe(0);
    expect(r.stderr).toBe("acp-tui: --resume takes one session ID, not 'a' and 'b'\n");
    expect(r.started).toBe(false);
  });

  test("the same option twice is harmless", () => {
    const dir = work();
    expect(parseArgs(["--resume", "a", "--resume", "a"], { cwd: dir }).session).toEqual({ kind: "resume", id: "a" });
    expect(parseArgs(["--continue", "--continue"], { cwd: dir }).session).toEqual({ kind: "continue" });
  });

  test("Session with a directory: --resume 0f3c9a2e ./repo-b is refused and no agent is launched", async () => {
    const r = await run(["--resume", "0f3c9a2e", "./repo-b"], work());
    expect(r.code).not.toBe(0);
    expect(r.stderr).toBe("acp-tui: --resume with a session ID opens the session in its own directory and takes no directory argument (got './repo-b')\n");
    expect(r.started).toBe(false);
  });

  test("--resume <id> with a directory before -- is refused the same way", async () => {
    const r = await run(["--resume", "0f3c9a2e", "./repo-b", "--", ...FAKE_COMMAND], work());
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("--resume with a session ID opens the session in its own directory");
    expect(r.started).toBe(false);
  });

  for (const argv of [["--session", "0f3c9a2e"], ["--session=0f3c9a2e"], ["--pick"]]) {
    test(`Removed options: ${argv.join(" ")} is an unknown option and no agent is launched`, async () => {
      const r = await run(argv, work());
      expect(r.code).not.toBe(0);
      expect(r.stderr).toBe(`acp-tui: unknown acp-tui argument '${argv[0]}'\n`);
      expect(r.started).toBe(false);
    });
  }

  test("a session option reaches the app in the launch description", async () => {
    const r = await run(["-a", "fake", "--continue"], work());
    expect(r.code).toBe(0);
    expect(r.launch?.session).toEqual({ kind: "continue" });
    expect(r.launch?.agentName).toBe("fake");
    expect(r.launch?.agentSource).toBe("option");
  });

  test("--resume <id> without -a leaves the agent to the default (the index may choose later)", async () => {
    const r = await run(["--resume", "s-42"], work());
    expect(r.launch?.session).toEqual({ kind: "resume", id: "s-42" });
    expect(r.launch?.agentSource).toBe("default");
  });
});

describe("Explicit directory argument (tui-sessions)", () => {
  test("Directory given: -a fake ./repo-b from /work gives /work/repo-b as the session directory", async () => {
    const dir = work();
    const r = await run(["-a", "fake", "./repo-b"], dir);
    expect(r.code).toBe(0);
    expect(r.launch?.directory).toBe(join(dir, "repo-b"));
    expect(r.launch?.directorySource).toBe("argument");
    expect(r.launch?.launchDirectory).toBe(dir);
    expect(launchArgv(r.launch!)).toEqual(FAKE_COMMAND);
  });

  test("Not a directory: -a fake ./missing -- <agent> is refused and no agent is launched", async () => {
    const r = await run(["-a", "fake", "./missing", "--", ...FAKE_COMMAND], work());
    expect(r.code).not.toBe(0);
    expect(r.stderr).toBe("acp-tui: './missing' is not a directory\n");
    expect(r.started).toBe(false);
  });

  test("a file is not a directory either", async () => {
    const r = await run(["./notes.txt", "--", ...FAKE_COMMAND], work());
    expect(r.stderr).toBe("acp-tui: './notes.txt' is not a directory\n");
    expect(r.started).toBe(false);
  });

  test("the directory is absolute and symlink-resolved", () => {
    const dir = work();
    symlinkSync(join(dir, "repo-b"), join(dir, "link-b"));
    expect(parseArgs(["link-b"], { cwd: dir }).directory).toBe(join(dir, "repo-b"));
    expect(parseArgs([join(dir, "link-b", "..", "repo-b"), "--", "agent"], { cwd: "/" }).directory).toBe(join(dir, "repo-b"));
  });

  test("without a directory argument the session directory is the launch directory", async () => {
    const dir = work();
    const r = await run(["-a", "fake"], dir);
    expect(r.launch?.directory).toBe(dir);
    expect(r.launch?.directorySource).toBe("launch");
  });
});

describe("Directory argument and agent command are told apart (tui-sessions)", () => {
  test("Directory and command: ./repo-b -- <agent command>", async () => {
    const dir = work();
    const r = await run(["./repo-b", "--", ...FAKE_COMMAND], dir);
    expect(r.code).toBe(0);
    expect(launchArgv(r.launch!)).toEqual(FAKE_COMMAND);
    expect(r.launch?.agentName).toBe("ad hoc");
    expect(r.launch?.agentSource).toBe("command");
    expect(r.launch?.directory).toBe(join(dir, "repo-b"));
  });

  test("options may sit between the directory and the --", () => {
    const dir = work();
    const options = parseArgs(["./repo-b", "--mouse", "off", "--", "agent", "--mouse", "x"], { cwd: dir });
    expect(options.directory).toBe(join(dir, "repo-b"));
    expect(options.screen.mouse).toBe("off");
    expect(options.agentCommand).toEqual(["agent", "--mouse", "x"]);
  });

  test("before a -- at most one positional argument is accepted", () => {
    const dir = work();
    expect(() => parseArgs(["repo-b", "config", "--", "agent"], { cwd: dir })).toThrow(
      new CliArgumentError("only one directory argument may come before --, not 'repo-b' and 'config'"),
    );
  });

  test("Subcommand name reserved: config --check is the subcommand, even with a config directory; no agent is launched", async () => {
    const dir = work();
    expect(parseArgs(["config", "--check"], { cwd: dir })).toMatchObject({
      subcommand: { name: "config", args: ["--check"] },
      directory: null,
      agentCommand: null,
    });
    // mvp-configuration task 9.1: the subcommand runs (the test preload's empty configuration).
    const r = await run(["config", "--check"], dir);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("no configuration problems\n");
    expect(r.stderr).toBe("");
    expect(r.started).toBe(false);
  });

  test("glyphs is reserved the same way, and runs its own subcommand (mvp-configuration task 7.3): nothing is launched", async () => {
    const dir = work();
    expect(parseArgs(["glyphs", "--test"], { cwd: dir })).toMatchObject({ subcommand: { name: "glyphs", args: ["--test"] }, directory: null, agentCommand: null });
    // Without --test it says what it needs, and starts nothing.
    const bare = await run(["glyphs"], dir);
    expect(bare.code).toBe(1);
    expect(bare.stderr).toContain("glyphs: nothing to do without --test");
    expect(bare.started).toBe(false);
    const test = await run(["glyphs", "--test", "ascii"], dir);
    expect(test.code).toBe(0);
    expect(test.stdout).toContain("ascii\n");
    expect(test.started).toBe(false);
  });

  test("a reserved name later on is no subcommand", () => {
    const dir = work();
    expect(parseArgs(["-a", "fake", "config"], { cwd: dir })).toMatchObject({ subcommand: null, directory: join(dir, "config") });
  });

  test("Directory named like a subcommand: ./config is the directory", async () => {
    const dir = work();
    const r = await run(["./config"], dir);
    expect(r.code).toBe(0);
    expect(r.launch?.directory).toBe(join(dir, "config"));
    expect(r.launch?.agentName).toBe("auggie");
  });

  test("Dropped separator: the command's words with no -- are refused and nothing starts", async () => {
    const dir = work();
    const r = await run([...FAKE_COMMAND], dir);
    expect(r.code).toBe(1);
    expect(r.started).toBe(false);
    expect(r.stderr).toContain("'bun' is not a configured harness (auggie, fake) or a directory");
  });

  test("Command after the separator: the words after -- are the agent command, the session starts in the launch directory", async () => {
    const dir = work();
    const r = await run(["--", ...FAKE_COMMAND], dir);
    expect(r.code).toBe(0);
    expect(launchArgv(r.launch!)).toEqual(FAKE_COMMAND);
    expect(r.launch?.agentName).toBe("ad hoc");
    expect(r.launch?.directory).toBe(dir);
    expect(r.launch?.directorySource).toBe("launch");
  });

  test("without --, a single existing directory is the directory; any other word is refused, whatever is on the PATH", () => {
    const dir = work();
    expect(parseArgs(["repo-b"], { cwd: dir })).toMatchObject({ directory: join(dir, "repo-b"), agentCommand: null });
    expect(() => parseArgs(["my-agent"], { cwd: dir })).toThrow("'my-agent' is not a configured harness");
    expect(() => parseArgs(["repo-b", "x"], { cwd: dir })).toThrow("'x' is not a configured harness");
  });

  test("an agent command after -- is launched instead of a named agent (spec tui-agent-session, Agent launch)", async () => {
    const r = await run(["-a", "fake", "--", "my-agent"], work());
    expect(launchArgv(r.launch!)).toEqual(["my-agent"]);
    expect(r.launch?.agentName).toBe("ad hoc");
  });
});
