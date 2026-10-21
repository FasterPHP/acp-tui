#!/usr/bin/env bun
// acp-tui CLI entry (task 5.1): argument parsing, the interactive-terminal
// requirement (tui-agent-session spec, "Interactive terminal required"), the
// ACP_TUI_LOG debug log and --help. `--replay-limit` and `--no-replay` are
// retired with the inline renderer (spec tui-screen, "Screen options on the
// command line") and rejected as unknown. Structured as parse -> checks ->
// resolve the launch -> start app: `main` calls an injectable `StartApp`. The
// screen options (`--mouse`, `--wheel-lines`, `--exit-print`, phase-1a task
// 4.4, and `--clipboard`; since mvp-configuration overrides of the settings of
// the same name) are validated here, before the agent is launched, and passed
// to the app in `StartAppOptions.screen` and `overrides`. The retired switch
// of the Phase 1a spikes is accepted and ignored with a notice
// (mvp-configuration design D14: `OBSOLETE_SPIKE_NOTICE`). mvp-sessions (tasks 3.1 to 3.3, 12.4) adds `-a`,
// `--resume [<id>]` (which replaced `--session <id>` and `--pick`, Marcus,
// 5 October 2026, IDE check 10.4, decision D), `--continue`, the directory
// argument with the `--` rule, the subcommands `config` and `glyphs` (mvp-configuration
// design D16: src/config-command.ts and src/glyphs-command.ts, routed before
// the positional rule), and the agent catalogue (src/agent/catalogue.ts): `resolveLaunch`
// (src/agent/resolve.ts) turns the parsed options into the
// `LaunchDescription` the app starts. The default is `startInteractive` (the
// renderer and App, src/app/run.tsx), which finds a `--resume <id>` or
// `--continue` session before the renderer starts (design decision 13);
// `runHeadless` starts the session without a renderer and exits on
// disconnect or a signal, for tests and scripts.
//
// day-two-feedback (design D3 and D5): the program acp-tui launches is called a harness in every
// user-facing text (the code keeps "agent"); the harness is an optional first positional argument
// (`acp-tui auggie`) or `--harness <name>`, with `-a` and `--agent` kept as aliases; `-r` and `-c`
// are `--resume` and `--continue`. The parser takes the catalogue's names (`ParseContext.harnesses`,
// read by `main`), so it stays pure, and refuses a lone word that is neither a harness, a directory
// nor a command on the `PATH` before anything is launched.
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { resolve, win32 } from "node:path";
import { CLAUDE_AGENT_PACKAGE } from "./agent/command.ts";
import { hasWindowsCommandExtension, isPathCommand, resolveProgram, type WhichFunction } from "./agent/which.ts";
import { loadAgentCatalogue, type AgentCatalogue } from "./agent/catalogue.ts";
import { resolveLaunch, type LaunchDescription, type ResolveContext } from "./agent/resolve.ts";
import type { ConfigOverrides } from "./config/effective.ts";
import { createDebugLogger, type DebugLogger } from "./log.ts";
import {
  CLIPBOARD_MODES,
  DEFAULT_SCREEN_OPTIONS,
  EXIT_PRINTS,
  MOUSE_POLICIES,
  type ClipboardMode,
  type ExitPrint,
  type MousePolicy,
  type ScreenOptions,
} from "./renderer/options.ts";
import { openSessionIndex } from "./session/session-index.ts";
import { startLaunch } from "./session/start.ts";
import { SELECTION_HELP } from "./selection/help.ts";

/** Which session to open: `--resume <id>` (`resume`), `--continue`, `--resume` without an ID (the
 *  session list, `list`), or a new one (none given). */
export type SessionOption =
  | { readonly kind: "new" }
  | { readonly kind: "resume"; readonly id: string }
  | { readonly kind: "continue" }
  | { readonly kind: "list" };

/** First arguments that are subcommands (mvp-configuration design D16). */
export const RESERVED_SUBCOMMANDS = ["config", "glyphs"] as const;
export type ReservedSubcommand = (typeof RESERVED_SUBCOMMANDS)[number];

export interface CliOptions {
  /** The harness named by the first positional argument, `--harness <name>`, `-a <name>` or
   *  `--agent <name>`, else null. */
  readonly agentName: string | null;
  /** The ad hoc harness command (after `--`, or the positional arguments when Bun dropped the
   *  `--`), else null. */
  readonly agentCommand: readonly string[] | null;
  /** The explicit directory argument, absolute and symlink-resolved, else null. */
  readonly directory: string | null;
  readonly session: SessionOption;
  /** `config` or `glyphs` as the first argument, with the arguments after it; nothing else is
   *  parsed then. */
  readonly subcommand: { readonly name: ReservedSubcommand; readonly args: readonly string[] } | null;
  readonly help: boolean;
  /** `--version` or `-v`: print the version lines and exit. */
  readonly version: boolean;
  readonly screen: ScreenOptions;
  /** The screen options given on the command line, as overrides of the settings of the same name
   *  for this run (mvp-configuration design D5): only the options given are present. */
  readonly overrides: ConfigOverrides;
  /** Notices for the app to show at start-up (`OBSOLETE_SPIKE_NOTICE`). */
  readonly notices: readonly string[];
}

/** The notice for the retired `--spike` (mvp-configuration design D14): the phase-1a launcher still
 *  passes it until the command is reinstalled. */
export const OBSOLETE_SPIKE_NOTICE = "--spike is obsolete and ignored; reinstall the command with bun run install-cli";

export class CliArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliArgumentError";
  }
}

export const HELP_TEXT = `acp-tui: a full-screen terminal client for the Agent Client Protocol (ACP).

Usage:
  acp-tui [harness] [directory] [options]
  acp-tui [harness] [directory] [options] -- <command> [args...]
  acp-tui config --check|--print-default|--print-schema|--path|--diff-default
  acp-tui glyphs --test [set]

Harnesses:
  A harness is the coding agent program acp-tui launches and talks to over
  ACP: Claude Code through claude-agent-acp, Auggie, OpenCode, Codex. A
  harness with a model is the agent you talk to. ACP and Zed call the
  harness an agent, which is why harnesses are configured under
  agent_servers.
  Name it first ("acp-tui auggie -r") or with --harness. Without one,
  acp-tui launches default_agent_server from the configuration, else the
  built-in "auggie" (auggie --acp, from the PATH). "claude" is built in too:
    bun x --bun ${CLAUDE_AGENT_PACKAGE}
  A command after "--" is launched as given. A new session starts in the
  directory argument, else in the directory acp-tui is started from.

Options:
  --harness <name>        Launch the named harness (built-in or configured).
  -a, --agent <name>      Aliases of --harness.
  -r, --resume [<id>]     Without an ID, choose an earlier session from a
                          list at start-up. With an ID, open that session
                          (write --resume=<id> to be sure).
  -c, --continue          Open the latest session in the session directory
                          (only the named harness's, when one is named).
                          At most one of --resume and --continue.
  --help, -h, --version, -v  Show this help, or the version, and exit.

Settings for this run (each overrides the configuration setting of the
same name, and a reload of the configuration never changes it):
  --mouse full|wheel|off  The mouse setting (default full): full reports
                          the wheel and clicks; wheel reports only the
                          wheel; off leaves the mouse to the terminal
                          (native selection).
  --clipboard auto|host|osc52|none
                          The clipboard setting: where copies go (default
                          auto: the host clipboard, then the terminal by
                          OSC 52; none copies nothing).
  --wheel-lines <n>       The wheel_lines setting: rows scrolled per wheel
                          event, instead of the per-terminal table.
  --exit-print summary|none|last-answer|transcript
                          The exit.print setting: what to print below the
                          command line on exit (default summary: the line
                          that resumes the session).

Configuration:
  $XDG_CONFIG_HOME/acp-tui/config.jsonc (default ${process.platform === "win32" ? "%APPDATA%\\acp-tui\\" : "~/.config/acp-tui/"}), and
  the nearest .acp-tui.jsonc up to the repository's root, both JSONC. Edits
  apply while acp-tui runs. "acp-tui config --print-default" lists every
  setting; "acp-tui config --check" checks the files; "acp-tui config
  --help" lists the rest. How the harness, the directory and "--" are told
  apart is in the user guide, docs/configuration.md.

Environment:
  ACP_TUI_LOG=<path>      Append a JSON-lines debug log (method names, ids,
                          state transitions and timings; never prompt or
                          message text) to <path>.

Mouse and selection:
${SELECTION_HELP.map((line) => `  ${line}`).join("\n")}

acp-tui runs on the terminal's alternate screen. Exiting detaches from the
harness; it never closes the session.
`;

function oneOf<T extends string>(option: string, value: string, allowed: readonly T[]): T {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  const list = allowed.length === 2 ? allowed.join(" or ") : `${allowed.slice(0, -1).join(", ")} or ${allowed.at(-1)}`;
  throw new CliArgumentError(`${option} takes ${list}, not '${value}'`);
}

function positiveInteger(option: string, value: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) throw new CliArgumentError(`${option} takes a positive integer, not '${value}'`);
  return Number(value);
}

/** The absolute, symlink-resolved path of `arg` (relative to `cwd`) when it names an existing
 *  directory, else null. */
function existingDirectory(arg: string, cwd: string): string | null {
  const path = resolve(cwd, arg);
  try {
    return statSync(path).isDirectory() ? realpathSync(path) : null;
  } catch {
    return null;
  }
}

/** Options that take a value, as `--name value` or `--name=value`. */
const VALUE_OPTIONS = new Set(["--mouse", "--wheel-lines", "--exit-print", "--clipboard", "-a", "--agent", "--harness"]);

export interface ParseContext {
  /** The directory a relative directory argument is resolved against; default `process.cwd()`. */
  readonly cwd?: string;
  /** The catalogue's harness names (the built-in `claude` and every `agent_servers` entry, valid or
   *  not), so the parser stays pure; default none. */
  readonly harnesses?: readonly string[];
  /** Whether a word names a command on the `PATH` (or an executable path), for the lone-word check;
   *  default a real lookup from `cwd`. */
  readonly commandExists?: (word: string) => boolean;
}

/** Whether `word` names an executable: a path (`./agent`, `/usr/bin/x`, and on Windows `.\agent`,
 *  `C:\tools\agent.cmd` or `\\server\x`) that is one, else a command on the `PATH` (never one in
 *  `cwd`; src/agent/which.ts). `which` and `platform` are for tests. */
export function realCommandExists(word: string, cwd: string, platform: NodeJS.Platform = process.platform, which?: WhichFunction): boolean {
  if (isPathCommand(word, platform)) {
    try {
      const path = (platform === "win32" ? win32.resolve : resolve)(cwd, word);
      if (!statSync(path).isFile()) return false;
      // Windows has no execute bit (X_OK passes for any file), so the extension decides there.
      if (platform === "win32") return hasWindowsCommandExtension(path);
      accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  return resolveProgram(word, { platform, ...(which ? { which } : {}) }) !== null;
}

/**
 * Parses acp-tui's CLI arguments (task 5.1; mvp-sessions task 3.1; day-two-feedback task group 4).
 * Throws `CliArgumentError` on anything invalid, before anything is launched. The harness, the
 * directory and the command are told apart by spec tui-sessions "Directory argument and agent
 * command are told apart": `config` or `glyphs` as the first argument is a reserved subcommand;
 * options are read wherever they stand before a `--`; the first positional argument is the harness
 * when it names one (`context.harnesses`), winning over a directory of that name; then at most one
 * positional argument, the directory, which must exist; a `--` that reaches acp-tui starts the
 * command; without one (Bun drops a `--` that directly follows the script, also through the
 * shebang) a single remaining argument naming an existing directory is the directory, and
 * otherwise the remaining arguments, from the first on, are the command, a lone word that is no
 * harness, directory or command on the `PATH` being an error.
 */
export function parseArgs(argv: readonly string[], context: ParseContext = {}): CliOptions {
  const cwd = context.cwd ?? process.cwd();
  const harnesses = context.harnesses ?? [];
  const isHarness = (word: string): boolean => harnesses.includes(word);
  const commandExists = context.commandExists ?? ((word: string) => realCommandExists(word, cwd));
  let help = false;
  let version = false;
  let agentName: string | null = null;
  let agentCommand: string[] | null = null;
  let directoryArg: string | null = null;
  let directory: string | null = null;
  const sessionOptions: SessionOption[] = [];
  const overrides: { -readonly [K in keyof ConfigOverrides]: ConfigOverrides[K] } = {};
  let mouse: MousePolicy = DEFAULT_SCREEN_OPTIONS.mouse;
  let wheelLines: number | null = DEFAULT_SCREEN_OPTIONS.wheelLines;
  let exitPrint: ExitPrint = DEFAULT_SCREEN_OPTIONS.exitPrint;
  const notices: string[] = [];
  let clipboard: ClipboardMode = DEFAULT_SCREEN_OPTIONS.clipboard;

  // Checked before every other rule, so no harness, directory or command is ever chosen by these names.
  const first = argv[0];
  if (first !== undefined && (RESERVED_SUBCOMMANDS as readonly string[]).includes(first)) {
    return {
      agentName,
      agentCommand,
      directory,
      session: { kind: "new" },
      subcommand: { name: first as ReservedSubcommand, args: argv.slice(1) },
      help,
      version,
      screen: DEFAULT_SCREEN_OPTIONS,
      overrides,
      notices,
    };
  }

  // Whether an argument after `--resume` or `-r` is its session ID (design D3 and D5 rule 7): not
  // when it starts with `-`, names a harness or names an existing directory.
  const takesId = (next: string | undefined): next is string => next !== undefined && !next.startsWith("-") && !isHarness(next) && existingDirectory(next, cwd) === null;
  const setHarness = (name: string, option: string): void => {
    if (name === "") throw new CliArgumentError(`${option} requires a harness name`);
    if (agentName !== null && agentName !== name) throw new CliArgumentError(`one harness may be named, not '${agentName}' and '${name}'`);
    agentName = name;
  };
  /** How many arguments the option at `at` spans, for looking ahead over options. */
  const optionSpan = (at: number): number => {
    const arg = argv[at]!;
    if (arg === "--resume" || arg === "-r") return takesId(argv[at + 1]) ? 2 : 1;
    if (arg === "--spike") {
      const next = argv[at + 1];
      return next !== undefined && !next.startsWith("-") && existingDirectory(next, cwd) === null ? 2 : 1;
    }
    return VALUE_OPTIONS.has(arg) ? 2 : 1;
  };
  /** Whether a positional argument (not an option or an option's value) stands at or after `from`. */
  const positionalFrom = (from: number): boolean => {
    for (let j = from; j < argv.length; j += optionSpan(j)) if (!argv[j]!.startsWith("-")) return true;
    return false;
  };

  let positionals = 0;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--version" || arg === "-v") {
      version = true;
      continue;
    }
    if (arg === "--") {
      const rest = argv.slice(i + 1);
      if (rest.length === 0) {
        throw new CliArgumentError("-- requires a harness command");
      }
      agentCommand = rest;
      break;
    }
    if (!arg.startsWith("-")) {
      // The first positional argument is the harness when it names one.
      if (positionals === 0 && isHarness(arg)) {
        setHarness(arg, "a harness");
        positionals += 1;
        continue;
      }
      positionals += 1;
      if (argv.indexOf("--", i + 1) !== -1) {
        // A `--` follows, so this is the directory; options may still come before the `--`.
        if (directoryArg !== null) {
          throw new CliArgumentError(`only one directory argument may come before --, not '${directoryArg}' and '${arg}'`);
        }
        directoryArg = arg;
        directory = existingDirectory(arg, cwd);
        if (directory === null) throw new CliArgumentError(`'${arg}' is not a directory`);
        continue;
      }
      // No `--` reached acp-tui: a lone existing directory is the directory (options may still
      // come after it); anything else starts the harness command.
      const existing = directoryArg === null ? existingDirectory(arg, cwd) : null;
      if (existing !== null && !positionalFrom(i + 1)) {
        directory = existing;
        directoryArg = arg;
        continue;
      }
      const rest = argv.slice(i);
      if (rest.length === 1 && !help && !commandExists(arg)) {
        const names = harnesses.length > 0 ? ` (${harnesses.join(", ")})` : "";
        throw new CliArgumentError(`'${arg}' is not a harness${names}, a directory or a command; an ad hoc command goes after --`);
      }
      agentCommand = rest;
      break;
    }
    if (arg === "--continue" || arg === "-c") {
      sessionOptions.push({ kind: "continue" });
      continue;
    }
    // `--resume [<id>]` and `-r [<id>]` (design decision 9): the next argument is the session ID
    // unless it starts with `-`, names a harness or names an existing directory (then it is read as
    // usual, a harness becoming the harness, a directory the directory argument, and `--resume`
    // opens the list); `--resume=<id>` always gives an ID, and `-r=<id>` is an unknown option.
    if (arg === "--resume" || arg === "-r") {
      const next = argv[i + 1];
      if (takesId(next)) {
        sessionOptions.push({ kind: "resume", id: next });
        i += 1;
      } else sessionOptions.push({ kind: "list" });
      continue;
    }
    if (arg.startsWith("--resume=")) {
      const id = arg.slice("--resume=".length);
      if (id === "") throw new CliArgumentError("--resume= requires a session ID (or give --resume alone for the session list)");
      sessionOptions.push({ kind: "resume", id });
      continue;
    }
    // The retired switch (mvp-configuration design D14), with or without a value: ignored, with a
    // notice. Its value is the next argument unless that starts with "-" or names an existing
    // directory (as for --resume), so both `--spike window,select -- agent` and `--spike -- agent`
    // leave the harness command alone.
    if (arg === "--spike" || arg.startsWith("--spike=")) {
      const next = argv[i + 1];
      if (arg === "--spike" && next !== undefined && !next.startsWith("-") && existingDirectory(next, cwd) === null) i += 1;
      if (!notices.includes(OBSOLETE_SPIKE_NOTICE)) notices.push(OBSOLETE_SPIKE_NOTICE);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq > 0 ? arg.slice(0, eq) : arg;
    if (VALUE_OPTIONS.has(name)) {
      let value: string | undefined;
      if (eq > 0) {
        value = arg.slice(eq + 1);
      } else {
        value = argv[i + 1];
        i += 1;
      }
      if (value === undefined) throw new CliArgumentError(`${name} requires a value`);
      if (name === "--mouse") mouse = overrides.mouse = oneOf(name, value, MOUSE_POLICIES);
      else if (name === "--wheel-lines") wheelLines = overrides.wheel_lines = positiveInteger(name, value);
      else if (name === "--exit-print") exitPrint = overrides.exit_print = oneOf(name, value, EXIT_PRINTS);
      else if (name === "--clipboard") clipboard = overrides.clipboard = oneOf(name, value, CLIPBOARD_MODES);
      else if (name === "-a" || name === "--agent" || name === "--harness") setHarness(value, name);
      continue;
    }
    throw new CliArgumentError(`unknown acp-tui argument '${arg}'`);
  }

  // Spec tui-sessions "Session options on the command line". The same option twice (with the same
  // ID) is harmless; two different ones, or two IDs, are not.
  const distinct = new Set(sessionOptions.map((o) => (o.kind === "resume" ? `resume:${o.id}` : o.kind)));
  if (distinct.size > 1) {
    const ids = sessionOptions.flatMap((o) => (o.kind === "resume" ? [o.id] : []));
    if (ids.length === sessionOptions.length) throw new CliArgumentError(`--resume takes one session ID, not '${ids[0]}' and '${ids.find((id) => id !== ids[0])}'`);
    throw new CliArgumentError("--resume and --continue cannot be combined; give at most one of them");
  }
  const session: SessionOption = sessionOptions[0] ?? { kind: "new" };
  if (session.kind === "resume" && directoryArg !== null) {
    throw new CliArgumentError(`--resume with a session ID opens the session in its own directory and takes no directory argument (got '${directoryArg}')`);
  }

  return {
    agentName,
    agentCommand,
    directory,
    session,
    subcommand: null,
    help,
    version,
    screen: { mouse, wheelLines, exitPrint, clipboard },
    overrides,
    notices,
  };
}

export interface StartAppOptions {
  /** What to launch and where (mvp-sessions task 3.3). */
  readonly launch: LaunchDescription;
  readonly logger: DebugLogger;
  /** Screen options (task 4.4); default `DEFAULT_SCREEN_OPTIONS`. Since mvp-configuration the
   *  app takes `mouse`, `wheelLines`, `exitPrint` and `clipboard` from the configuration, with
   *  `overrides` on top; a caller that passes `screen` without `overrides` (tests) pins all four. */
  readonly screen?: ScreenOptions;
  /** The options given on the command line, pinned over the configuration for the run. */
  readonly overrides?: ConfigOverrides;
  /** Notices to show once the app is up (`CliOptions.notices`). */
  readonly notices?: readonly string[];
}

/** The seam the renderer (task group 6) plugs into: given parsed, validated options, run the
 *  app and resolve with the process exit code. */
export type StartApp = (options: StartAppOptions) => Promise<number>;

/**
 * Minimal placeholder `StartApp` (task 5.1: "a headless mode is fine for now"): starts the agent
 * session and keeps the process alive until the agent disconnects or the process receives
 * SIGINT/SIGTERM, at which point it detaches cleanly. This is a Phase 0 stand-in, not the spec's
 * full "acp-tui remains open until the user exits" behaviour (tui-agent-session spec, "Agent
 * disconnect is survivable"), which needs the renderer to have something to keep showing. Used
 * directly by this package's own headless tests. Having no session list, it starts a new session
 * for `--resume` without an ID, as Esc in the list would. A session `--resume <id>` or `--continue`
 * cannot find or open rejects with `SessionOpenFailure` (the caller prints it).
 */
export async function runHeadless(options: StartAppOptions): Promise<number> {
  const { launch } = options;
  const started = await startLaunch({ launch, logger: options.logger, index: openSessionIndex() });
  if (started === null) return 0;
  const { controller } = started;

  return new Promise<number>((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;

    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      unsubscribe?.();
      resolve(code);
    };

    const onSignal = (): void => {
      void controller.detach().then(() => finish(0));
    };

    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    unsubscribe = controller.subscribe((session) => {
      if (session.connection === "disconnected") {
        finish(0);
      }
    });

    // In case the agent had already disconnected by the time we subscribed.
    if (controller.getSession().connection === "disconnected") {
      finish(0);
    }
  });
}

/**
 * The interactive app. Loaded lazily, after registering the Solid JSX transform: Bun reads
 * bunfig.toml (and its preload) only from the working directory, so an installed `acp-tui` run
 * from a project directory would otherwise load the .tsx modules untransformed and the Solid
 * server build. Registering twice is harmless (the plugin checks).
 */
export const startInteractive: StartApp = async (options) => {
  await import("@opentui/solid/preload");
  const { runApp } = await import("./app/run.tsx");
  return runApp(options);
};

export interface CliIo {
  readonly stdout: { readonly isTTY: boolean | undefined; write(text: string): unknown };
  readonly stderr: { write(text: string): unknown };
}

const PROCESS_IO: CliIo = { stdout: process.stdout, stderr: process.stderr };

/** Where `main` resolves relative paths and reads the agent catalogue from (tests inject both). */
export interface CliContext extends ParseContext, ResolveContext {}

/**
 * Runs the CLI end to end: parse -> a reserved subcommand -> --help -> resolve the launch (the
 * agent catalogue) -> the interactive-terminal check -> start the app. `io`, `startApp` and
 * `context` are injectable for tests; production use takes the defaults.
 */
export async function main(
  argv: readonly string[],
  io: CliIo = PROCESS_IO,
  startApp: StartApp = startInteractive,
  context: CliContext = {},
): Promise<number> {
  // The harness names, for the first positional argument: read only when there is one (an
  // option-only command line, and the subcommands, never touch the configuration here), after the
  // glyph measurement's module is loaded, and shared with `resolveLaunch` below.
  let catalogue: (() => AgentCatalogue) | undefined = context.catalogue;
  let harnesses: readonly string[] = [];
  const reserved = argv[0] !== undefined && (RESERVED_SUBCOMMANDS as readonly string[]).includes(argv[0]);
  if (!reserved && argv.some((arg) => !arg.startsWith("-"))) {
    await import("@opentui/core");
    try {
      const loaded = (catalogue ?? (() => loadAgentCatalogue()))();
      catalogue = () => loaded;
      harnesses = [...loaded.agents.keys(), ...loaded.invalid.keys()];
    } catch {
      // Read again by `resolveLaunch`, which reports it.
    }
  }
  let options: CliOptions;
  try {
    options = parseArgs(argv, { ...context, harnesses });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.write(`acp-tui: ${message}\n`);
    return 1;
  }

  if (options.subcommand) {
    // Before the positional rule (spec tui-sessions "Directory argument and agent command are told
    // apart"; mvp-configuration design D16): the main screen, no renderer and no agent (spec
    // tui-config "Configuration subcommands on the command line" and "Glyph test").
    const { name, args } = options.subcommand;
    if (name === "glyphs") return (await import("./glyphs-command.ts")).runGlyphsCommand(args, io);
    return (await import("./config-command.ts")).runConfigCommand(args, io, context.cwd !== undefined ? { cwd: context.cwd } : {});
  }

  if (options.help) {
    io.stdout.write(HELP_TEXT);
    return 0;
  }
  if (options.version) {
    const { gatherVersionInfo, versionLines } = await import("./version.ts");
    io.stdout.write(`${versionLines(gatherVersionInfo()).join("\n")}\n`);
    return 0;
  }

  // Resolving the launch reads the configuration file (the agent catalogue), and a glyph override
  // in it is measured with OpenTUI's width function, which `require`s @opentui/core when first used
  // (conversation/glyphs.ts `openTuiCells`); that works only once the module, which has a top-level
  // await, has been evaluated. The app loads it next anyway; `--help` above never does.
  await import("@opentui/core");
  let launch: LaunchDescription;
  try {
    launch = resolveLaunch(options, catalogue ? { ...context, catalogue } : context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.write(`acp-tui: ${message}\n`);
    return 1;
  }

  if (!io.stdout.isTTY) {
    io.stderr.write("acp-tui: needs an interactive terminal (stdout is not a TTY); refusing to start.\n");
    return 1;
  }

  const logger = createDebugLogger(process.env["ACP_TUI_LOG"]);
  const { screen } = options;
  logger.log({
    event: "screen_options",
    mouse: screen.mouse,
    wheelLines: screen.wheelLines,
    exitPrint: screen.exitPrint,
    clipboard: screen.clipboard,
  });
  // Never the command, its arguments or its environment: only how the agent and directory were
  // chosen.
  logger.log({
    event: "launch",
    agent: launch.agentName,
    agentSource: launch.agentSource,
    directorySource: launch.directorySource,
    session: launch.session.kind,
    problems: launch.problems.length,
  });
  return startApp({ launch, logger, screen, overrides: options.overrides, ...(options.notices.length > 0 ? { notices: options.notices } : {}) });
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`acp-tui: unexpected error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
