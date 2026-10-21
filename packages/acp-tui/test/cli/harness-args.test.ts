// day-two-feedback task group 4 (design D3 and D5), through `parseArgs` and through `main` with an
// injected `startApp`, so that "exits non-zero without launching anything" is observable: `-r` and
// `-c` as `--resume` and `--continue`, the harness as the first positional argument or `--harness`
// (with `-a` and `--agent` kept as aliases), the order of the positional rules, and the unknown-word
// refusal. Every scenario of spec tui-sessions "Session options on the command line", "Named agents"
// and "Directory argument and agent command are told apart" that this change adds. The catalogue is
// injected (no user configuration is read); directories are temporary.
import { describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAgentCatalogue } from "../../src/agent/catalogue.ts";
import { launchArgv } from "../../src/agent/resolve.ts";
import { CliArgumentError, main, parseArgs, type CliContext, type ParseContext, type StartAppOptions } from "../../src/cli.ts";

const FAKE_COMMAND = ["bun", "packages/fake-agent/src/main.ts", "--scenario", "basic"];
const NAMES = ["auggie", "opencode", "fake", "other"];
const CATALOGUE = JSON.stringify({ agent_servers: { auggie: { command: "bun", args: ["auggie.ts"] }, opencode: { command: "opencode", args: ["acp"] }, fake: { command: "bun", args: FAKE_COMMAND.slice(1) }, other: { command: "bun", args: ["other.ts"] }, config: { command: "bun", args: ["config.ts"] } } });

/** A temporary `/work` with `repo-b` and `fake` directories and a file `notes.txt`. */
function work(): string {
  const dir = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-harness-args-")));
  mkdirSync(join(dir, "repo-b"));
  mkdirSync(join(dir, "fake"));
  writeFileSync(join(dir, "notes.txt"), "not a directory\n");
  return dir;
}

const parse = (argv: string[], cwd: string, extra: Partial<ParseContext> = {}) => parseArgs(argv, { cwd, harnesses: NAMES, ...extra });

/** `main` from `cwd` with the catalogue above; what it wrote and whether the app started. */
async function run(argv: string[], cwd: string, extra: Partial<CliContext> = {}) {
  const stderr: string[] = [];
  const stdout: string[] = [];
  const startApp = mock(async (_options: StartAppOptions) => 0);
  const context: CliContext = { cwd, catalogue: () => buildAgentCatalogue(CATALOGUE, "/cfg/acp-tui/config.jsonc"), ...extra };
  const io = {
    stdout: { isTTY: true, write: (t: string) => stdout.push(t) },
    stderr: { write: (t: string) => stderr.push(t) },
  };
  const code = await main(argv, io, startApp, context);
  const launch = (startApp.mock.calls[0]?.[0] as StartAppOptions | undefined)?.launch;
  return { code, stderr: stderr.join(""), stdout: stdout.join(""), started: startApp.mock.calls.length > 0, launch };
}

describe("-r and -c (tui-sessions 'Session options on the command line')", () => {
  test("Short options: -r s-42, -r and -c do what --resume s-42, --resume and --continue do", () => {
    const dir = work();
    expect(parse(["-r", "s-42"], dir).session).toEqual(parse(["--resume", "s-42"], dir).session);
    expect(parse(["-r", "s-42"], dir).session).toEqual({ kind: "resume", id: "s-42" });
    expect(parse(["-r"], dir).session).toEqual({ kind: "list" });
    expect(parse(["-c"], dir).session).toEqual({ kind: "continue" });
  });

  test("Resume followed by a harness: -r fake opens the list with harness fake, not session `fake`", () => {
    const dir = work();
    expect(parse(["-r", "fake"], dir)).toMatchObject({ session: { kind: "list" }, agentName: "fake" });
    expect(parse(["--resume", "fake"], dir)).toMatchObject({ session: { kind: "list" }, agentName: "fake" });
    // The ID follows when it names no harness; a harness may stand on either side.
    expect(parse(["fake", "-r", "s-1"], dir)).toMatchObject({ session: { kind: "resume", id: "s-1" }, agentName: "fake" });
    expect(parse(["-r", "s-1", "fake"], dir)).toMatchObject({ session: { kind: "resume", id: "s-1" }, agentName: "fake" });
    // `--resume=<id>` always gives an ID, even one that names a harness.
    expect(parse(["--resume=fake"], dir).session).toEqual({ kind: "resume", id: "fake" });
  });

  test("Resume followed by a directory or an option is read as usual", () => {
    const dir = work();
    expect(parse(["-r", "./repo-b"], dir)).toMatchObject({ session: { kind: "list" }, directory: join(dir, "repo-b") });
    expect(parse(["-r", "--mouse", "off"], dir)).toMatchObject({ session: { kind: "list" }, screen: { mouse: "off" } });
  });

  test("Bundled short options: -rc, -cr and -r=<id> are unknown options and nothing is launched", async () => {
    const dir = work();
    for (const bad of ["-rc", "-cr", "-r=s-1", "-c=1"]) {
      expect(() => parse([bad], dir)).toThrow(new CliArgumentError(`unknown acp-tui argument '${bad}'`));
    }
    const r = await run(["-rc"], dir);
    expect(r.code).toBe(1);
    expect(r.stderr).toBe("acp-tui: unknown acp-tui argument '-rc'\n");
    expect(r.started).toBe(false);
  });

  test("-r and -c count as the session options: they cannot be combined with each other or with --resume or --continue", () => {
    const dir = work();
    expect(() => parse(["-r", "-c"], dir)).toThrow("--resume and --continue cannot be combined");
    expect(() => parse(["--continue", "-r", "s-1"], dir)).toThrow("--resume and --continue cannot be combined");
    // The same option in both forms is harmless.
    expect(parse(["-c", "--continue"], dir).session).toEqual({ kind: "continue" });
    // -r s-1 with a directory is the same refusal as --resume s-1.
    expect(() => parse(["-r", "s-1", "./repo-b"], dir)).toThrow("takes no directory argument");
  });
});

describe("the harness (tui-sessions 'Named agents' and 'Directory argument and agent command are told apart')", () => {
  test("Harness by position: fake --resume is the session list with harness fake, as -a fake --resume is", () => {
    const dir = work();
    expect(parse(["fake", "--resume"], dir)).toMatchObject({ agentName: "fake", session: { kind: "list" }, agentCommand: null, directory: null });
    expect(parse(["fake", "--resume"], dir)).toEqual(parse(["-a", "fake", "--resume"], dir));
    // Options before the harness are read too.
    expect(parse(["--resume", "fake"], dir)).toMatchObject({ agentName: "fake", session: { kind: "list" } });
    expect(parse(["--mouse", "off", "fake"], dir)).toMatchObject({ agentName: "fake", screen: { mouse: "off" } });
  });

  test("Harness by option: --harness fake is fake, and -a and --agent stay aliases, in both value forms", () => {
    const dir = work();
    for (const argv of [["--harness", "fake"], ["--harness=fake"], ["-a", "fake"], ["--agent", "fake"], ["--agent=fake"], ["-a=fake"]]) {
      expect([argv, parse(argv, dir).agentName]).toEqual([argv, "fake"]);
    }
    expect(() => parse(["--harness"], dir)).toThrow(new CliArgumentError("--harness requires a value"));
    expect(() => parse(["--harness="], dir)).toThrow(new CliArgumentError("--harness requires a harness name"));
  });

  test("Two names: fake --harness other, and every other pairing of different names, is refused; the same name twice is harmless", async () => {
    const dir = work();
    for (const argv of [["fake", "--harness", "other"], ["--harness", "other", "fake"], ["-a", "fake", "--harness", "other"], ["-a", "x", "--agent", "y"], ["fake", "-a", "other"]]) {
      expect(() => parse(argv, dir)).toThrow(CliArgumentError);
    }
    const r = await run(["fake", "--harness", "other"], dir);
    expect(r.code).toBe(1);
    expect(r.stderr).toBe("acp-tui: one harness may be named, not 'fake' and 'other'\n");
    expect(r.started).toBe(false);
    expect(parse(["fake", "--harness", "fake", "-a", "fake"], dir).agentName).toBe("fake");
  });

  test("Harness and directory: fake ./repo-b is harness fake in /work/repo-b", async () => {
    const dir = work();
    expect(parse(["fake", "./repo-b"], dir)).toMatchObject({ agentName: "fake", directory: join(dir, "repo-b"), agentCommand: null });
    expect(parse(["fake", "repo-b", "-c"], dir)).toMatchObject({ agentName: "fake", directory: join(dir, "repo-b"), session: { kind: "continue" } });
    // The harness comes first: after a directory, `fake` is the second directory (it exists here).
    expect(() => parse(["./repo-b", "fake"], dir)).toThrow("only one directory argument may come before --");
    const r = await run(["fake", "./repo-b"], dir);
    expect(r.code).toBe(0);
    expect(r.launch?.agentName).toBe("fake");
    expect(r.launch?.directory).toBe(join(dir, "repo-b"));
    // Before a `--`, a harness and a directory, then the command.
    expect(parse(["fake", "./repo-b", "--", "agent"], dir)).toMatchObject({ agentName: "fake", directory: join(dir, "repo-b"), agentCommand: ["agent"] });
  });

  test("Harness wins over a directory: with a directory named fake, `fake` is the harness and ./fake the directory", async () => {
    const dir = work();
    expect(parse(["fake"], dir)).toMatchObject({ agentName: "fake", directory: null });
    expect(parse(["./fake"], dir)).toMatchObject({ agentName: null, directory: join(dir, "fake") });
    const r = await run(["fake"], dir);
    expect(r.launch?.agentName).toBe("fake");
    expect(r.launch?.directory).toBe(dir);
    // A directory that names no harness is still the directory.
    expect(parse(["repo-b"], dir)).toMatchObject({ agentName: null, directory: join(dir, "repo-b") });
  });

  test("Options after the harness: fake -c is --continue for the harness, not an argument of a command", () => {
    const dir = work();
    expect(parse(["fake", "-c"], dir)).toMatchObject({ agentName: "fake", session: { kind: "continue" }, agentCommand: null });
    expect(parse(["fake", "--mouse", "wheel", "-r"], dir)).toMatchObject({ agentName: "fake", session: { kind: "list" }, screen: { mouse: "wheel" } });
    expect(parse(["fake", "--help"], dir).help).toBe(true);
    // And after a directory.
    expect(parse(["./repo-b", "-c"], dir)).toMatchObject({ directory: join(dir, "repo-b"), session: { kind: "continue" }, agentCommand: null });
  });

  test("Command after the separator: the words after a -- that reaches acp-tui are the command", async () => {
    const dir = work();
    expect(parse(["--", ...FAKE_COMMAND], dir)).toMatchObject({ agentName: null, agentCommand: FAKE_COMMAND, directory: null });
    const r = await run(["--", ...FAKE_COMMAND], dir);
    expect(launchArgv(r.launch!)).toEqual(FAKE_COMMAND);
    expect(r.launch?.agentName).toBe("ad hoc");
    // Options inside the command are the command's, not acp-tui's.
    expect(parse(["--", "bun", "x.ts", "--resume", "-c"], dir)).toMatchObject({ agentCommand: ["bun", "x.ts", "--resume", "-c"], session: { kind: "new" } });
  });

  test("Dropped separator: the command's words with no -- are refused, bun is no harness even though it is on the PATH", async () => {
    const dir = work();
    expect(() => parse([...FAKE_COMMAND], dir)).toThrow(/^'bun' is not a configured harness \(auggie, opencode, fake, other\) or a directory; an ad hoc command goes after --, as in acp-tui -- bun$/);
    const r = await run([...FAKE_COMMAND], dir);
    expect(r.code).toBe(1);
    expect(r.started).toBe(false);
    expect(r.stderr).toBe("acp-tui: 'bun' is not a configured harness (auggie, opencode, fake, other, config) or a directory; an ad hoc command goes after --, as in acp-tui -- bun\n");
  });

  test("Directory and command: ./repo-b -- command is unchanged", async () => {
    const dir = work();
    const r = await run(["./repo-b", "--", ...FAKE_COMMAND], dir);
    expect(launchArgv(r.launch!)).toEqual(FAKE_COMMAND);
    expect(r.launch?.directory).toBe(join(dir, "repo-b"));
    expect(r.launch?.agentName).toBe("ad hoc");
    expect(() => parse(["./repo-b", "./fake", "--", "agent"], dir)).toThrow("only one directory argument may come before --");
    expect(() => parse(["notes.txt", "--", "agent"], dir)).toThrow("'notes.txt' is not a directory");
  });

  test("A harness and a command after --: the command wins and is recorded as ad hoc, as -a does", async () => {
    const dir = work();
    for (const argv of [["fake", "--", "my-agent"], ["-a", "fake", "--", "my-agent"], ["--harness", "fake", "--", "my-agent"]]) {
      const r = await run(argv, dir);
      expect([argv, r.code]).toEqual([argv, 0]);
      expect(launchArgv(r.launch!)).toEqual(["my-agent"]);
      expect(r.launch?.agentName).toBe("ad hoc");
    }
  });

  test("Subcommands first: config and glyphs are never a harness, a directory or a command; --harness config reaches a harness of that name", async () => {
    const dir = work();
    expect(parse(["config", "--check"], dir)).toMatchObject({ subcommand: { name: "config", args: ["--check"] }, agentName: null });
    const r = await run(["--harness", "config"], dir);
    expect(r.code).toBe(0);
    expect(r.launch?.agentName).toBe("config");
  });
});

describe("the unknown word (tui-sessions 'Directory argument and agent command are told apart', Unknown word)", () => {
  test("Unknown word: augie names no configured harness and no directory, so it is refused with the harnesses and the `--` rule", async () => {
    const dir = work();
    expect(() => parse(["augie"], dir)).toThrow(
      new CliArgumentError("'augie' is not a configured harness (auggie, opencode, fake, other) or a directory; an ad hoc command goes after --, as in acp-tui -- augie"),
    );
    const r = await run(["augie"], dir);
    expect(r.code).toBe(1);
    expect(r.stderr).toBe("acp-tui: 'augie' is not a configured harness (auggie, opencode, fake, other, config) or a directory; an ad hoc command goes after --, as in acp-tui -- augie\n");
    // Nothing launched, so the alternate screen was never entered.
    expect(r.started).toBe(false);
    expect(r.stdout).toBe("");
  });

  test("Unknown word: a command on the PATH, or an executable path, is refused all the same", () => {
    const dir = work();
    expect(() => parse(["bun"], dir)).toThrow("'bun' is not a configured harness");
    expect(() => parse(["./notes.txt"], dir)).toThrow("is not a configured harness");
    expect(() => parse([process.execPath], dir)).toThrow("is not a configured harness");
  });

  test("Stray argument after a harness: any word after the harness and the directory is refused, with or without other words", () => {
    const dir = work();
    expect(() => parse(["fake", "augie"], dir)).toThrow("'augie' is not a configured harness");
    expect(() => parse(["augie", "serve"], dir)).toThrow("'augie' is not a configured harness");
    expect(() => parse(["fake", "./repo-b", "extra"], dir)).toThrow("'extra' is not a configured harness");
    // Before a `--` the word was meant as the directory.
    expect(() => parse(["augie", "--", "x"], dir)).toThrow("'augie' is not a directory");
    // --help is not turned into an error by a word after it.
    expect(() => parse(["--help", "augie"], dir)).toThrow("'augie' is not a configured harness");
  });

  test("No harness configured: the refusal says so, naming the configuration file", () => {
    expect(() => parseArgs(["augie"], { cwd: work(), configPath: "/cfg/acp-tui/config.jsonc" })).toThrow(
      new CliArgumentError("'augie' is not a configured harness or a directory; an ad hoc command goes after --, as in acp-tui -- augie; no harness is configured in /cfg/acp-tui/config.jsonc"),
    );
  });
});

describe("example harnesses are not run as commands (tui-sessions)", () => {
  const ANY_COMMAND = {};
  const GEMINI = "acp-tui: harness 'gemini' is not configured; uncomment its entry in /cfg/acp-tui/config.jsonc, or run acp-tui -- gemini --acp\n";

  test("Gemini not configured: with gemini on the PATH, the lone word is refused with the entry to uncomment and the -- command, and nothing starts", async () => {
    const r = await run(["gemini"], work(), ANY_COMMAND);
    expect(r.code).toBe(1);
    expect(r.stderr).toBe(GEMINI);
    expect(r.started).toBe(false);
    expect(r.stdout).toBe("");
  });

  test("--harness, -a and --agent give the same refusal", async () => {
    for (const argv of [["--harness", "gemini"], ["-a", "gemini"], ["--agent", "gemini"]]) {
      const r = await run(argv, work(), ANY_COMMAND);
      expect([argv, r.code, r.stderr, r.started]).toEqual([argv, 1, GEMINI, false]);
    }
  });

  test("Example with an environment: deepseek is refused without a -- alternative", async () => {
    const r = await run(["--harness", "deepseek"], work(), ANY_COMMAND);
    expect(r.code).toBe(1);
    expect(r.stderr).toBe("acp-tui: harness 'deepseek' is not configured; uncomment its entry in /cfg/acp-tui/config.jsonc\n");
    expect(r.started).toBe(false);
  });

  test("Arguments given: gemini --acp with no -- is refused as the example gemini, and nothing starts", async () => {
    const r = await run(["gemini", "--acp"], work(), ANY_COMMAND);
    expect(r.code).toBe(1);
    expect(r.stderr).toBe(GEMINI);
    expect(r.started).toBe(false);
  });

  test("Example with settings: claude is refused without a -- alternative, since its timeout needs the entry", async () => {
    const r = await run(["claude"], work(), ANY_COMMAND);
    expect(r.code).toBe(1);
    expect(r.stderr).toBe("acp-tui: harness 'claude' is not configured; uncomment its entry in /cfg/acp-tui/config.jsonc\n");
    expect(r.started).toBe(false);
  });

  test("Example with a template: auggie, when its entry is missing, is told to add it and where to find it", async () => {
    const catalogue = () => buildAgentCatalogue(`{ "mouse": "off" }`, "/cfg/acp-tui/config.jsonc");
    const r = await run(["auggie"], work(), { catalogue });
    expect(r.code).toBe(1);
    expect(r.stderr).toBe("acp-tui: harness 'auggie' is not configured; add its entry to /cfg/acp-tui/config.jsonc (see config.dist.jsonc or acp-tui config --print-default)\n");
    expect(r.started).toBe(false);
  });

  test("Directory of an example's name: a directory named goose wins, and the default harness starts there", async () => {
    const dir = work();
    mkdirSync(join(dir, "goose"));
    const r = await run(["goose"], dir, ANY_COMMAND);
    expect(r.code).toBe(0);
    expect(r.launch?.directory).toBe(join(dir, "goose"));
    expect(r.launch?.agentName).toBe("auggie");
  });

  test("a configured harness named like an example is a harness, not refused", async () => {
    const catalogue = () => buildAgentCatalogue(JSON.stringify({ agent_servers: { gemini: { command: "bun", args: ["g.ts"] } } }), "/cfg/acp-tui/config.jsonc");
    const r = await run(["gemini"], work(), { ...ANY_COMMAND, catalogue });
    expect(r.code).toBe(0);
    expect(r.launch?.agentName).toBe("gemini");
  });

  test("a configured entry named like a well-known harness is a harness: opencode is not an example, and the parsed harness is opencode", async () => {
    const r = await run(["opencode"], work(), ANY_COMMAND);
    expect(r.code).toBe(0);
    expect(r.launch?.agentName).toBe("opencode");
    expect(launchArgv(r.launch!)).toEqual(["opencode", "acp"]);
    expect(parse(["opencode"], work()).agentName).toBe("opencode");
  });

  test("Stray argument after a harness: opencode acp is refused and says the harness already runs opencode acp", async () => {
    const r = await run(["opencode", "acp"], work());
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("'acp' is not a configured harness");
    expect(r.stderr).toContain("an ad hoc command goes after --, as in acp-tui -- acp; harness 'opencode' already runs 'opencode acp'\n");
    expect(r.started).toBe(false);
  });

  test("a stray word that is not one of the harness's arguments gets no such explanation", async () => {
    const r = await run(["opencode", "nosuchword"], work());
    expect(r.code).toBe(1);
    expect(r.stderr).not.toContain("already runs");
  });

  test("parseArgs on its own: examples in the context are refused with the configuration file named, home as ~", () => {
    const examples = [{ name: "gemini", commandLine: "gemini --acp" }];
    expect(() => parse(["gemini"], work(), { examples, configPath: `${process.env["HOME"]}/.config/acp-tui/config.jsonc` })).toThrow(
      new CliArgumentError("harness 'gemini' is not configured; uncomment its entry in ~/.config/acp-tui/config.jsonc, or run acp-tui -- gemini --acp"),
    );
  });
});
