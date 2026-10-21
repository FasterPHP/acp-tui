// Task 5.1: argument parsing unit tests, the --help text, and main()'s
// parse -> checks -> start-app flow with an injected io/startApp so these
// run without spawning a real process (test/cli/tty.test.ts covers the real
// `acp-tui | cat` scenario end to end). Phase 1a task 3.4: the retired
// `--replay-limit` and `--no-replay` are unknown options (spec tui-screen,
// "Screen options on the command line", retired option scenario). Task 4.4:
// `--mouse`, `--wheel-lines` and `--exit-print`. mvp-configuration task 9.3:
// `--spike` is obsolete, accepted with or without a value and ignored with a notice.
import { describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAgentCatalogue } from "../../src/agent/catalogue.ts";
import { CLAUDE_AGENT_PACKAGE } from "../../src/agent/command.ts";
import { launchArgv } from "../../src/agent/resolve.ts";
import { CliArgumentError, HELP_TEXT, main, OBSOLETE_SPIKE_NOTICE, parseArgs, type CliContext, type StartAppOptions } from "../../src/cli.ts";
import { SELECTION_HELP } from "../../src/selection/help.ts";
import { NULL_LOGGER } from "../../src/log.ts";
import { DEFAULT_SCREEN_OPTIONS } from "../../src/renderer/options.ts";

/** No configuration file: the built-in agent only (never the user's own file). */
const NO_CONFIG: CliContext = { catalogue: () => buildAgentCatalogue(null, "/nonexistent/acp-tui/config.jsonc") };

function tempDir(): string {
  return mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-args-"));
}

describe("cli parseArgs (task 5.1)", () => {
  test("defaults: no agent named or given (the catalogue chooses), a new session, no help", () => {
    const options = parseArgs([]);
    expect(options).toEqual({
      agentName: null,
      agentCommand: null,
      directory: null,
      session: { kind: "new" },
      addDirs: [],
      subcommand: null,
      help: false,
      version: false,
      screen: DEFAULT_SCREEN_OPTIONS,
      overrides: {},
      notices: [],
    });
  });

  test("the screen options given are recorded as overrides of their settings (mvp-configuration task 2.4); none given, none recorded", () => {
    expect(parseArgs(["--mouse", "wheel", "--exit-print=transcript", "--", "agent"]).overrides).toEqual({ mouse: "wheel", exit_print: "transcript" });
    expect(parseArgs(["--wheel-lines", "2", "--clipboard", "none"]).overrides).toEqual({ wheel_lines: 2, clipboard: "none" });
    expect(parseArgs(["--", "agent"]).overrides).toEqual({});
  });

  test("-- switches to an ad hoc harness command", () => {
    const options = parseArgs(["--", "bun", "packages/fake-agent/src/main.ts", "--scenario", "basic"]);
    expect(options.agentCommand).toEqual(["bun", "packages/fake-agent/src/main.ts", "--scenario", "basic"]);
  });

  test("a leading -- removed by Bun: the first non-option argument starts the agent command", () => {
    // `my-agent` is no directory here, and no `--` reaches acp-tui.
    const cwd = tempDir();
    expect(parseArgs(["my-agent", "--flag"], { cwd }).agentCommand).toEqual(["my-agent", "--flag"]);
    expect(parseArgs(["-h", "my-agent", "-x"], { cwd })).toMatchObject({ agentCommand: ["my-agent", "-x"], help: true, screen: DEFAULT_SCREEN_OPTIONS });
  });

  test("-- with nothing after it is an error", () => {
    expect(() => parseArgs(["--"])).toThrow(CliArgumentError);
  });

  for (const argv of [["--no-replay"], ["--replay-limit", "500"], ["--replay-limit"]]) {
    test(`the retired ${argv.join(" ")} is an unknown option`, () => {
      expect(() => parseArgs(argv)).toThrow(new CliArgumentError(`unknown acp-tui argument '${argv[0]}'`));
    });
  }

  test("--help and -h set help", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  test("an unknown option is an error", () => {
    expect(() => parseArgs(["--nonexistent"])).toThrow(CliArgumentError);
  });

  test("options may precede --", () => {
    const options = parseArgs(["--help", "--", "my-agent"]);
    expect(options).toMatchObject({ agentCommand: ["my-agent"], help: true, screen: DEFAULT_SCREEN_OPTIONS });
  });
});

describe("cli screen options (phase-1a task 4.4)", () => {
  test("defaults: mouse full, per-terminal wheel step, summary on exit, auto clipboard, and nothing else", () => {
    expect(DEFAULT_SCREEN_OPTIONS).toEqual({ mouse: "full", wheelLines: null, exitPrint: "summary", clipboard: "auto" });
  });

  for (const mouse of ["full", "wheel", "off"] as const) {
    test(`--mouse ${mouse} and --mouse=${mouse}`, () => {
      expect(parseArgs(["--mouse", mouse]).screen.mouse).toBe(mouse);
      expect(parseArgs([`--mouse=${mouse}`]).screen.mouse).toBe(mouse);
    });
  }

  test("--wheel-lines takes a positive integer", () => {
    expect(parseArgs(["--wheel-lines", "2"]).screen.wheelLines).toBe(2);
    expect(parseArgs(["--wheel-lines=12"]).screen.wheelLines).toBe(12);
    for (const bad of ["0", "-1", "1.5", "two", ""]) {
      expect(() => parseArgs(["--wheel-lines", bad])).toThrow(new CliArgumentError(`--wheel-lines takes a positive integer, not '${bad}'`));
    }
  });

  test("--exit-print takes summary, none, last-answer or transcript (mvp-conversation task 7.1)", () => {
    for (const mode of ["summary", "none", "last-answer", "transcript"] as const) {
      expect(parseArgs(["--exit-print", mode]).screen.exitPrint).toBe(mode);
      expect(parseArgs([`--exit-print=${mode}`]).screen.exitPrint).toBe(mode);
    }
    expect(() => parseArgs(["--exit-print", "all"])).toThrow(new CliArgumentError("--exit-print takes summary, none, last-answer or transcript, not 'all'"));
  });

  describe("--spike is obsolete (mvp-configuration task 9.3, design D14)", () => {
    test("Old launcher: --spike window,select,find,chrome is accepted and ignored, with the notice naming the reinstall command", () => {
      const options = parseArgs(["--spike", "window,select,find,chrome", "--", "agent"]);
      expect(options.notices).toEqual([OBSOLETE_SPIKE_NOTICE]);
      expect(OBSOLETE_SPIKE_NOTICE).toBe("--spike is obsolete and ignored; reinstall the command with bun run install-cli");
      expect(options.agentCommand).toEqual(["agent"]);
      expect(options.screen).toEqual(DEFAULT_SCREEN_OPTIONS);
      expect(options.overrides).toEqual({});
    });

    test("with or without a value, any value, repeated: one notice, nothing else changes", () => {
      for (const argv of [
        ["--spike"],
        ["--spike", "--", "agent"],
        ["--spike", "--mouse", "off"],
        ["--spike=flat,crash"],
        ["--spike=", "--", "agent"],
        ["--spike", "wobble"],
        ["--spike", "hover", "--spike=find", "--spike"],
      ]) {
        const options = parseArgs(argv);
        expect(options.notices).toEqual([OBSOLETE_SPIKE_NOTICE]);
        expect(options.directory).toBeNull();
      }
      expect(parseArgs(["--spike", "--mouse", "off"]).screen.mouse).toBe("off");
      expect(parseArgs(["--spike", "--", "agent", "--x"]).agentCommand).toEqual(["agent", "--x"]);
      expect(parseArgs(["--spike", "find", "--exit-print", "transcript"]).screen.exitPrint).toBe("transcript");
      // No spike name is known any more: what follows is never checked.
      expect(parseArgs(["--spike", "flat"]).agentCommand).toBeNull();
    });

    test("an existing directory after --spike is the directory argument, not its value", () => {
      const dir = tempDir();
      const options = parseArgs(["--spike", dir], { cwd: "/" });
      expect(options.notices).toEqual([OBSOLETE_SPIKE_NOTICE]);
      expect(options.directory).not.toBeNull();
    });

    test("no notice without --spike", () => {
      expect(parseArgs(["--mouse", "off", "--", "agent"]).notices).toEqual([]);
    });
  });

  test("--clipboard (spike S4; documented since mvp-conversation task 5.8): auto, host, osc52 or none, read on every build", () => {
    for (const mode of ["auto", "host", "osc52", "none"] as const) {
      expect(parseArgs(["--clipboard", mode]).screen.clipboard).toBe(mode);
    }
    expect(parseArgs(["--clipboard=osc52", "--", "agent"]).screen.clipboard).toBe("osc52");
    expect(() => parseArgs(["--clipboard", "wl-copy"])).toThrow(new CliArgumentError("--clipboard takes auto, host, osc52 or none, not 'wl-copy'"));
  });

  test("an option without its value is an error", () => {
    for (const name of ["--mouse", "--wheel-lines", "--exit-print", "--clipboard"]) {
      expect(() => parseArgs([name])).toThrow(new CliArgumentError(`${name} requires a value`));
    }
  });

  test("options before the agent command are parsed; after it they belong to the agent", () => {
    const options = parseArgs(["--mouse", "off", "--exit-print", "none", "--", "agent", "--mouse", "sometimes"]);
    expect(options.screen.mouse).toBe("off");
    expect(options.screen.exitPrint).toBe("none");
    expect(options.agentCommand).toEqual(["agent", "--mouse", "sometimes"]);
  });
});

describe("cli --help text (task 5.1)", () => {
  test("describes the full-screen client and never mentions replay", () => {
    expect(HELP_TEXT).toMatch(/full-screen/);
    expect(HELP_TEXT).toMatch(/alternate screen/);
    expect(HELP_TEXT).not.toMatch(/replay/i);
    expect(HELP_TEXT).not.toMatch(/inline/i);
  });

  test("lists --mouse, --wheel-lines, --exit-print and --clipboard, and not the hidden --spike (task 4.4; mvp-conversation task 5.8)", () => {
    expect(HELP_TEXT).toContain("--mouse full|wheel|off");
    expect(HELP_TEXT).toContain("--wheel-lines <n>");
    expect(HELP_TEXT).toContain("--exit-print summary|none|last-answer|transcript");
    expect(HELP_TEXT).toContain("--clipboard auto|host|osc52|none");
    // mvp-configuration task 2.4: overrides of the settings of the same name, pinned for the run.
    expect(HELP_TEXT).toMatch(/Settings for this run \(each overrides the configuration setting of the\s+same name, and a reload of the configuration never changes it\)/);
    for (const setting of ["The mouse setting", "The clipboard setting", "The wheel_lines setting", "The exit.print setting"]) expect(HELP_TEXT).toContain(setting);
    expect(HELP_TEXT).not.toContain("--spike");
    expect(HELP_TEXT).not.toMatch(/spike/i);
  });

  test("names plain drag, shift+drag and f2 (lower case, task 12.8), and that native selection copies wrapped text (mvp-conversation task 5.9)", () => {
    const paragraph = HELP_TEXT.slice(HELP_TEXT.indexOf("Mouse and selection:"));
    expect(paragraph).toMatch(/Plain drag in the conversation is acp-tui's own selection/);
    expect(paragraph).toMatch(/shift\+drag is the terminal's native selection/);
    expect(paragraph).toMatch(/f2\s+turns acp-tui's mouse reporting off and on/);
    expect(paragraph).toMatch(/native selection copies text\s+wrapped as shown on screen/);
    for (const line of SELECTION_HELP) expect(HELP_TEXT).toContain(`  ${line}\n`);
  });

  test("documents ACP_TUI_LOG and that it never contains prompt or message text", () => {
    expect(HELP_TEXT).toContain("ACP_TUI_LOG");
    expect(HELP_TEXT).toMatch(/never prompt or\s+message text/);
  });

  test("documents the default agent command", () => {
    expect(HELP_TEXT).toContain(`bun x --bun ${CLAUDE_AGENT_PACKAGE}`);
  });

  test("describes the session options, named agents, the directory argument and the -- rule (mvp-sessions tasks 3.4 and 12.8)", () => {
    expect(HELP_TEXT).toContain("acp-tui [harness] [directory] [options] -- <command> [args...]");
    expect(HELP_TEXT).toContain("-a, --agent <name>");
    expect(HELP_TEXT).toMatch(/\n  -r, --resume \[<id>\] +Without an ID, choose an earlier session from a/);
    expect(HELP_TEXT).toContain("--resume=<id>");
    expect(HELP_TEXT).toMatch(/\n  -c, --continue +Open the latest session/);
    expect(HELP_TEXT).toContain("At most one of --resume and --continue.");
    expect(HELP_TEXT).not.toContain("--session");
    expect(HELP_TEXT).not.toContain("--pick");
    expect(HELP_TEXT).toContain("the line\n                          that resumes the session");
    expect(HELP_TEXT).toMatch(/default_agent/);
    expect(HELP_TEXT).toMatch(/agent_servers/);
    expect(HELP_TEXT).toContain("$XDG_CONFIG_HOME/acp-tui/config.jsonc");
    // day-two-feedback task 13.1: the argument-resolution rules are in the guide, not the help.
    expect(HELP_TEXT).not.toContain("Telling the harness, the directory and the command apart");
    expect(HELP_TEXT).not.toMatch(/Bun drops/);
    expect(HELP_TEXT).not.toContain("are reserved for subcommands");
    expect(HELP_TEXT).toContain("docs/configuration.md");
    expect(HELP_TEXT.split("\n").length).toBeLessThanOrEqual(72);
    // Every line fits 78 columns, and no en or em dash.
    for (const line of HELP_TEXT.split("\n")) expect(line.length).toBeLessThanOrEqual(78);
    expect(HELP_TEXT).not.toMatch(new RegExp("[\\u2013\\u2014]"));
  });

  test("Help explains the term: the harness synopsis, --harness with -a and --agent as aliases, -r and -c, and that a harness with a model is the agent (day-two-feedback)", () => {
    expect(HELP_TEXT).toContain("acp-tui [harness] [directory] [options]");
    expect(HELP_TEXT).toContain("\nHarnesses:\n");
    expect(HELP_TEXT).toMatch(/\n  --harness <name> +Launch the named harness/);
    expect(HELP_TEXT).toMatch(/\n  -a, --agent <name> +Aliases of --harness\./);
    expect(HELP_TEXT).toMatch(/harness with a model is the agent you talk to/);
    expect(HELP_TEXT).toMatch(/ACP and Zed call the\s+harness an agent, which is why harnesses are configured under\s+agent_servers/);
    // No `agent command` in the user-facing text.
    expect(HELP_TEXT).not.toContain("agent command");
  });
});

describe("cli main() (task 5.1)", () => {
  function io(isTTY: boolean) {
    const stdoutWrites: string[] = [];
    const stderrWrites: string[] = [];
    return {
      stdoutWrites,
      stderrWrites,
      handle: {
        stdout: { isTTY, write: (t: string) => stdoutWrites.push(t) },
        stderr: { write: (t: string) => stderrWrites.push(t) },
      },
    };
  }

  test("--help prints the help text and exits 0 without starting the app", async () => {
    const { handle, stdoutWrites } = io(false);
    const startApp = mock(async (_options: StartAppOptions) => 0);
    const code = await main(["--help"], handle, startApp);
    expect(code).toBe(0);
    expect(stdoutWrites.join("")).toBe(HELP_TEXT);
    expect(startApp).not.toHaveBeenCalled();
  });

  test("non-TTY stdout refuses to start, on stderr, non-zero exit, agent not launched", async () => {
    const { handle, stderrWrites } = io(false);
    const startApp = mock(async (_options: StartAppOptions) => 0);
    const code = await main([], handle, startApp, NO_CONFIG);
    expect(code).not.toBe(0);
    expect(stderrWrites.join("")).toMatch(/interactive terminal/i);
    expect(startApp).not.toHaveBeenCalled();
  });

  test("a TTY stdout with valid args starts the app with the parsed options", async () => {
    const { handle } = io(true);
    const startApp = mock(async (_options: StartAppOptions) => 0);
    const code = await main(["--", "my-agent", "--flag"], handle, startApp);
    expect(code).toBe(0);
    expect(startApp).toHaveBeenCalledTimes(1);
    const passed = startApp.mock.calls[0]?.[0] as StartAppOptions;
    expect(launchArgv(passed.launch)).toEqual(["my-agent", "--flag"]);
    expect(passed.launch.agentName).toBe("ad hoc");
    expect(passed.logger).toBeDefined();
  });

  test("a bad argument is an error on stderr with non-zero exit, before any TTY check", async () => {
    const { handle, stderrWrites } = io(false);
    const startApp = mock(async (_options: StartAppOptions) => 0);
    const code = await main(["--nonexistent"], handle, startApp);
    expect(code).not.toBe(0);
    expect(stderrWrites.join("")).toContain("--nonexistent");
    expect(startApp).not.toHaveBeenCalled();
  });

  test("invalid --mouse sometimes: names the option and its values, non-zero exit, agent not launched", async () => {
    const { handle, stderrWrites } = io(true);
    const startApp = mock(async (_options: StartAppOptions) => 0);
    const code = await main(["--mouse", "sometimes", "--", "my-agent"], handle, startApp);
    expect(code).not.toBe(0);
    expect(stderrWrites.join("")).toBe("acp-tui: --mouse takes full, wheel or off, not 'sometimes'\n");
    expect(startApp).not.toHaveBeenCalled();
  });

  test("an unknown --clipboard value: error, non-zero exit, agent not launched", async () => {
    const { handle, stderrWrites } = io(true);
    const startApp = mock(async (_options: StartAppOptions) => 0);
    const code = await main(["--clipboard", "xclip", "--", "my-agent"], handle, startApp);
    expect(code).not.toBe(0);
    expect(stderrWrites.join("")).toContain("--clipboard takes auto, host, osc52 or none, not 'xclip'");
    expect(startApp).not.toHaveBeenCalled();
  });

  test("the parsed screen options reach the app and are logged in screen_options", async () => {
    const { handle } = io(true);
    const startApp = mock(async (_options: StartAppOptions) => 0);
    const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-args-"));
    const log = join(dir, "acp-tui.log");
    const previous = process.env["ACP_TUI_LOG"];
    process.env["ACP_TUI_LOG"] = log;
    try {
      const argv = ["--mouse", "wheel", "--wheel-lines", "2", "--exit-print", "none", "--clipboard", "osc52", "--", "my-agent"];
      expect(await main(argv, handle, startApp)).toBe(0);
    } finally {
      if (previous === undefined) delete process.env["ACP_TUI_LOG"];
      else process.env["ACP_TUI_LOG"] = previous;
    }
    const passed = startApp.mock.calls[0]?.[0] as StartAppOptions;
    expect(passed.screen).toEqual({ mouse: "wheel", wheelLines: 2, exitPrint: "none", clipboard: "osc52" });
    expect(passed.notices).toBeUndefined();
    const entries = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    const logged = entries.find((e) => e["event"] === "screen_options");
    expect(logged).toMatchObject({ mouse: "wheel", wheelLines: 2, exitPrint: "none", clipboard: "osc52" });
    expect(logged).not.toHaveProperty("spikes");
  });

  test("Old launcher: --spike window,select,find,chrome starts the app with the defaults and the obsolete notice (mvp-configuration task 9.3)", async () => {
    const { handle, stderrWrites } = io(true);
    const startApp = mock(async (_options: StartAppOptions) => 0);
    expect(await main(["--spike", "window,select,find,chrome", "--", "my-agent"], handle, startApp)).toBe(0);
    const passed = startApp.mock.calls[0]?.[0] as StartAppOptions;
    expect(passed.screen).toEqual(DEFAULT_SCREEN_OPTIONS);
    expect(passed.notices).toEqual([OBSOLETE_SPIKE_NOTICE]);
    expect(launchArgv(passed.launch)).toEqual(["my-agent"]);
    expect(stderrWrites.join("")).toBe("");
  });

  for (const argv of [["--no-replay"], ["--replay-limit", "500"]]) {
    test(`the retired ${argv.join(" ")}: unknown option on stderr, non-zero exit, app (and agent) not started`, async () => {
      const { handle, stderrWrites } = io(true);
      const startApp = mock(async (_options: StartAppOptions) => 0);
      const code = await main([...argv, "--", "my-agent"], handle, startApp);
      expect(code).not.toBe(0);
      expect(stderrWrites.join("")).toBe(`acp-tui: unknown acp-tui argument '${argv[0]}'\n`);
      expect(startApp).not.toHaveBeenCalled();
    });
  }
});

// Sanity: NULL_LOGGER (used implicitly via createDebugLogger(undefined) inside main) never
// writes; imported here just to confirm the export exists for other tests to reuse.
test("log.ts exports a disabled NULL_LOGGER", () => {
  expect(NULL_LOGGER.enabled).toBe(false);
});

// harness-feedback task group 6 (spec tui-sessions "Additional directories on the command line").
describe("--add-dir", () => {
  test("Two directories: resolved against the current directory, in order, given as a separate value or with =", () => {
    const root = realpathSync(tempDir());
    const app = join(root, "app");
    for (const name of ["app", "lib", "docs"]) mkdirSync(join(root, name));
    expect(parseArgs(["--add-dir", "../lib", "--add-dir=" + join(root, "docs")], { cwd: app, harnesses: [] }).addDirs).toEqual([join(root, "lib"), join(root, "docs")]);
  });

  test("The same directory twice is listed once; none given is an empty list", () => {
    const root = realpathSync(tempDir());
    mkdirSync(join(root, "lib"));
    expect(parseArgs(["--add-dir", "lib", "--add-dir", "./lib"], { cwd: root }).addDirs).toEqual([join(root, "lib")]);
    expect(parseArgs([], { cwd: root }).addDirs).toEqual([]);
  });

  test("Missing directory: an error saying it is not a directory, before anything is launched", async () => {
    const root = realpathSync(tempDir());
    expect(() => parseArgs(["--add-dir", "../nosuch"], { cwd: root })).toThrow("--add-dir '../nosuch' is not a directory");
    expect(() => parseArgs(["--add-dir"], { cwd: root })).toThrow("--add-dir requires a value");
    // Through main(): exit 1, nothing launched.
    const stderr: string[] = [];
    const startApp = mock(async (_options: StartAppOptions) => 0);
    const handle = { stdout: { isTTY: true, write: (_t: string) => true }, stderr: { write: (t: string) => stderr.push(t) } };
    const code = await main(["--add-dir", "../nosuch"], handle as never, startApp, { ...NO_CONFIG, cwd: root });
    expect(code).toBe(1);
    expect(startApp).not.toHaveBeenCalled();
    expect(stderr.join("")).toContain("../nosuch");
    expect(stderr.join("")).toContain("is not a directory");
  });

  test("A file is not a directory, and the help line names the option", () => {
    const root = realpathSync(tempDir());
    writeFileSync(join(root, "file"), "x");
    expect(() => parseArgs(["--add-dir", "file"], { cwd: root })).toThrow("is not a directory");
    expect(HELP_TEXT).toContain("--add-dir <path>");
  });
});
