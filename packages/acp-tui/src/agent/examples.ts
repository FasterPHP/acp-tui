// The agent examples of `acp-tui config --print-default` (mvp-configuration task 12.7;
// configured-harnesses, design D1 and D2), kept apart from the default file's builder so the
// command line, the loader and the catalogue can name them without loading the layout and rendering
// modules. Since install-harness-choice (Marcus, 28 November 2026: "no default") none is in effect in
// the default configuration: every example is commented out, and acp-tui with no file has no
// harness. `bun run install-cli --harness <name>` puts the chosen ones in effect.
import { shortenHome } from "../layout/segments.ts";
import { userHome, type Platform } from "../platform/paths.ts";
import { AUGGIE_INSTALL_HINT, CLAUDE_EXAMPLE_COMMAND, CLAUDE_STARTUP_TIMEOUT_SECONDS, AGY_INSTALL_HINT, OPENCODE_INSTALL_HINT } from "./command.ts";

/** An example's `agent_servers` entry, as the default file writes it (the setting names in camel case). */
export interface AgentExampleEntry {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  /** For a harness that takes extra directories as arguments (`additional_directory_args`). */
  readonly additionalDirectoryArgs?: readonly string[];
  /** Directories for every session of the harness (`additional_directories`). */
  readonly additionalDirectories?: readonly string[];
  /** Seconds a start-up may stay silent (`startup_timeout_seconds`). */
  readonly startupTimeoutSeconds?: number;
}

/** One agent example: what it is and where its command is documented, and its entry. */
export interface AgentExample {
  readonly name: string;
  /** What it is, as a sentence's start that reads after "Example, not active:" and after "The
   *  default harness," (the default file adds whichever applies). */
  readonly about: string;
  readonly entry: AgentExampleEntry;
  /** A commented alternative written below the entry, with what it changes (the default file adds
   *  how to use it instead, which depends on whether the entry above is in effect). */
  readonly suggestion?: { readonly about: string; readonly entry: AgentExampleEntry };
  /** False for an example that cannot be put in effect as written (its entry holds a placeholder to
   *  replace), so `install-cli --harness` does not offer it. */
  readonly selectable?: false;
}

/** Auggie's arguments for additional directories (`additional_directory_args`): `--add-workspace`
 *  once per directory. Inferred from Auggie 0.36.0's bundle (harness-feedback D10). */
export const AUGGIE_DIRECTORY_ARGS: readonly string[] = ["--add-workspace", "{dir}"];

/**
 * The agent examples (task 12.7). Each command was checked against the agent's own documentation
 * or the ACP agents list (agentclientprotocol.com/overview/agents) on 13 October 2026, and its
 * comment names the source. DeepSeek has no ACP agent of its own, so it is reached through
 * OpenCode.
 */
export const AGENT_EXAMPLES: readonly AgentExample[] = [
  {
    name: "auggie",
    about: `Auggie, installed with ${AUGGIE_INSTALL_HINT}. This one entry runs either generation, whichever your npm installed: acp-tui recognises 0.x and 1.x when Auggie starts and logs you in with the matching command (auggie auth login for 1.x, auggie login for 0.x). To choose a thinking effort at start-up, add --thinking <effort> to args for 1.x, or --reasoning-effort <effort> for 0.x. Auggie 1.x asks for no permission unless it is given rules: to be asked before it runs commands or changes files, add "--permission", "bash:ask-user", "--permission", "write:ask-user", "--permission", "edit:ask-user" to args (not checked with 0.x, so keep them out of an entry that may run it). Auggie 1.x indexes a directory only once it is allowed: acp-tui asks, and on your yes restarts Auggie with --allow-indexing, which Auggie saves as a lasting rule. additional_directory_args is the template acp-tui uses to pass each additional directory to a harness that does not take them through ACP, here as --add-workspace: the entry's additional_directories, a project's, --add-dir and /add-dir. Source: docs.augmentcode.com/cli/acp.`,
    entry: { command: "auggie", args: ["--acp"], additionalDirectoryArgs: AUGGIE_DIRECTORY_ARGS },
    suggestion: {
      about:
        "the same with a directory. additional_directories gives Auggie's context engine one more directory in every session: the folder that holds all your projects lets it answer about any of them, whichever project you start in; replace /path/to/projects with yours (a directory that does not exist is a warning and left out). Auggie indexes that folder in the background, so start-up is not delayed. Writing --add-workspace <dir> in args also works, but bypasses acp-tui: that directory is not shown in the dirs module of the status row (+N dirs) and is not deduplicated with the others.",
      entry: { command: "auggie", args: ["--acp"], additionalDirectoryArgs: AUGGIE_DIRECTORY_ARGS, additionalDirectories: ["/path/to/projects"] },
    },
  },
  {
    name: "claude",
    about: `Claude Code through the claude-agent-acp adapter, run by bunx (which comes with Bun) and logged in with your Claude Code login. Its start-up timeout is ${CLAUDE_STARTUP_TIMEOUT_SECONDS} seconds because bunx may download the adapter first. Change args to run another version. To choose the model, add an env entry such as "env": { "ANTHROPIC_MODEL": "opus" }; CLAUDE_CODE_EXECUTABLE there runs your own Claude Code. Sources: npm @agentclientprotocol/claude-agent-acp, and code.claude.com/docs/en/settings for ANTHROPIC_MODEL.`,
    entry: { command: CLAUDE_EXAMPLE_COMMAND[0]!, args: CLAUDE_EXAMPLE_COMMAND.slice(1), startupTimeoutSeconds: CLAUDE_STARTUP_TIMEOUT_SECONDS },
  },
  {
    name: "opencode",
    about: `OpenCode, installed with ${OPENCODE_INSTALL_HINT} and logged in with opencode auth login. Without the acp argument OpenCode starts its own terminal interface. Source: opencode.ai/docs/acp.`,
    entry: { command: "opencode", args: ["acp"] },
  },
  {
    name: "codex",
    about: "OpenAI Codex through codex-acp, installed with npm install -g @agentclientprotocol/codex-acp. Source: github.com/agentclientprotocol/codex-acp.",
    entry: { command: "codex-acp", args: [] },
  },

  {
    name: "deepseek",
    about:
      'DeepSeek has no ACP agent of its own, so reach it through a harness such as OpenCode. Connect DeepSeek in OpenCode with /connect, then give this entry an OpenCode config file that sets "model" to a DeepSeek model, which /models lists. Sources: opencode.ai/docs/providers and opencode.ai/docs/config for OPENCODE_CONFIG.',
    entry: { command: "opencode", args: ["acp"], env: { OPENCODE_CONFIG: "/home/you/.config/opencode/deepseek.json" } },
    selectable: false,
  },
  {
    name: "pi",
    about: "the pi coding agent through pi-acp, installed with npm install -g pi-acp; pi itself must be on the PATH. Source: github.com/svkozak/pi-acp.",
    entry: { command: "pi-acp", args: [] },
  },
  {
    name: "agy",
    about: `Google's Antigravity CLI (agy), installed with ${AGY_INSTALL_HINT} (PowerShell: irm https://antigravity.google/cli/install.ps1 | iex); sign in once with agy or agy acp --login. Not yet checked with acp-tui. Sources: antigravity.google/docs/cli/acp and antigravity.google/docs/getting-started.`,
    entry: { command: "agy", args: ["acp"] },
  },
  {
    name: "qwen",
    about: "Qwen Code. Source: qwenlm.github.io/qwen-code-docs, Zed integration.",
    entry: { command: "qwen", args: ["--acp"] },
  },
  {
    name: "copilot",
    about: "GitHub Copilot CLI. Source: github.blog changelog, ACP support in Copilot CLI, 28 January 2026.",
    entry: { command: "copilot", args: ["--acp"] },
  },
  {
    name: "cursor",
    about: "Cursor's CLI, whose command is named agent. Source: cursor.com/docs/cli/acp.",
    entry: { command: "agent", args: ["acp"] },
  },
  {
    name: "goose",
    about: "Goose. Source: goose-docs.ai/docs/guides/acp-clients.",
    entry: { command: "goose", args: ["acp"] },
  },
];


/** An example's entry as `agent_servers` holds it (snake-case keys). */
export function exampleServerEntry(entry: AgentExampleEntry): Record<string, unknown> {
  return {
    command: entry.command,
    args: [...entry.args],
    ...(entry.env !== undefined ? { env: { ...entry.env } } : {}),
    ...(entry.additionalDirectoryArgs !== undefined ? { additional_directory_args: [...entry.additionalDirectoryArgs] } : {}),
    ...(entry.additionalDirectories !== undefined ? { additional_directories: [...entry.additionalDirectories] } : {}),
    ...(entry.startupTimeoutSeconds !== undefined ? { startup_timeout_seconds: entry.startupTimeoutSeconds } : {}),
  };
}

/** An example harness a word or `--harness` may name, for the refusal "Example harnesses are not
 *  run as commands": its name and, for an example whose entry is only a command and arguments, the
 *  command line that runs it. */
export interface ExampleHarness {
  readonly name: string;
  readonly commandLine: string | null;
}

/** Whether an entry is only a command and its arguments, so `acp-tui -- <command line>` does the same. */
function plainEntry(entry: AgentExampleEntry): boolean {
  return entry.env === undefined && entry.additionalDirectoryArgs === undefined && entry.additionalDirectories === undefined && entry.startupTimeoutSeconds === undefined;
}

/** The examples whose names are not configured (`taken`), with their command lines. */
export function exampleHarnesses(taken: readonly string[]): ExampleHarness[] {
  return AGENT_EXAMPLES.filter((e) => !taken.includes(e.name)).map((e) => ({
    name: e.name,
    commandLine: plainEntry(e.entry) ? [e.entry.command, ...e.entry.args].join(" ") : null,
  }));
}

/** `~` for the home directory at the start of a path, as messages show the configuration file. The
 *  home is the platform's (on Windows the profile, never `HOME`), matched as the platform's file
 *  system compares paths. */
export function withTilde(path: string, home: string | null = userHome(), platform: Platform = process.platform): string {
  return shortenHome(path, home, platform);
}

/** Where the user finds an entry to copy, named after "add its entry to <file>". */
export const DEFAULT_ENTRIES_HINT = "(see config.dist.jsonc or acp-tui config --print-default)";

/** The refusal for an example's name: the entry to uncomment, and for an example of a command and
 *  arguments alone the `--` command that runs it. */
export function exampleRefusal(example: ExampleHarness, configPath: string): string {
  const alternative = example.commandLine !== null ? `, or run acp-tui -- ${example.commandLine}` : "";
  return `harness '${example.name}' is not configured; uncomment its entry in ${withTilde(configPath)}${alternative}`;
}

/** The error for a default harness with no entry (configured-harnesses, design D3). */
export function defaultNotConfigured(name: string, configPath: string): string {
  return `default harness '${name}' is not configured; add its entry to ${withTilde(configPath)} ${DEFAULT_ENTRIES_HINT}`;
}

/** The names `bun run install-cli --harness` takes, in the default file's order: every example
 *  except one whose entry needs editing first (`selectable: false`). */
export function selectableExampleNames(): string[] {
  return AGENT_EXAMPLES.filter((e) => e.selectable !== false).map((e) => e.name);
}

/** How many harnesses the messages name first; the rest are "examples in the file too". */
const MAIN_HARNESS_COUNT = 4;

/** The selectable harnesses in descending order of popularity (Marcus, 28 November 2026), for the
 *  messages that name them. An example not listed here is appended in the file's order, so a new
 *  example is never lost from a message. */
export const HARNESS_POPULARITY: readonly string[] = ["claude", "codex", "opencode", "auggie", "copilot", "cursor", "goose", "qwen", "agy", "pi"];

/** `a`, `a and b`, `a, b and c`. */
function joinNames(names: readonly string[]): string {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The selectable harness names by popularity, split into the main ones and the others. */
export function harnessesByPopularity(): { main: string[]; more: string[] } {
  const selectable = selectableExampleNames();
  const known = HARNESS_POPULARITY.filter((n) => selectable.includes(n));
  const ordered = [...known, ...selectable.filter((n) => !known.includes(n))];
  return { main: ordered.slice(0, MAIN_HARNESS_COUNT), more: ordered.slice(MAIN_HARNESS_COUNT) };
}

/** The lines that name the harnesses, for the no-harness messages: the main list, then (when there
 *  are others) which more are examples in the file. */
function harnessLines(more: "in the file too" | "in the file"): string[] {
  const { main, more: others } = harnessesByPopularity();
  if (more === "in the file") return [`Harnesses: ${main.join(", ")}${others.length > 0 ? " (more examples in the file)" : ""}`];
  return [`Harnesses: ${main.join(", ")}`, ...(others.length > 0 ? [`  (${joinNames(others)} ${others.length === 1 ? "is an example" : "are examples"} in the file too)`] : [])];
}

/**
 * The explanation when no harness is enabled (install-harness-choice, design D7): acp-tui is run
 * with no harness name and no command, and the user's configuration has no `agent_servers` entry
 * (or there is no file). `fileExists` chooses the way to enable one: with no file, `bun run
 * install-cli --harness <name>` writes a new one; with a file, its entry is uncommented there (the
 * install never changes an existing file). The follow-up `harness-setup` change replaces this with
 * an interactive first-launch prompt.
 */
export function noHarnessEnabled(configPath: string, fileExists: boolean): string {
  const how = fileExists
    ? ["To enable one, uncomment its entry under agent_servers in:", `  ${withTilde(configPath)}`]
    : ["To enable one, run this in the acp-tui checkout:", "  bun run install-cli --harness <name>"];
  return ["no harness is enabled yet.", "", ...how, "", ...harnessLines("in the file too"), "", "To run an ACP agent that has no entry:", "  acp-tui -- <command>"].join("\n");
}

/** What the install prints after creating a configuration with no harness enabled (no
 *  `--harness`), in place of its usual "created" line. */
export function installedWithNoHarness(file: string): string {
  return [
    `install-cli: created ${file}`,
    "",
    "No harness is enabled yet. To enable one, either:",
    "  - uncomment its entry under agent_servers in that file, or",
    "  - delete the file and run: bun run install-cli --harness <name>",
    "",
    ...harnessLines("in the file"),
  ].join("\n") + "\n";
}

/** The error when several harnesses are configured and `default_agent_server` names none of them
 *  (install-harness-choice, design D7): which to set, or name one. */
export function noDefaultChosen(names: readonly string[], configPath: string): string {
  return [
    `no default harness is set and ${names.length} harnesses are configured.`,
    "",
    "To choose the one acp-tui starts, set default_agent_server in:",
    `  ${withTilde(configPath)}`,
    "",
    `Harnesses: ${names.join(", ")}`,
    "",
    "Or name one for this run:",
    `  acp-tui ${names[0]}`,
  ].join("\n");
}
