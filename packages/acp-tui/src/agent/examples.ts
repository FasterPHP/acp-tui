// The agent examples of `acp-tui config --print-default` (mvp-configuration task 12.7;
// configured-harnesses, design D1 and D2), kept apart from the default file's builder so the
// command line, the loader and the catalogue can name them without loading the layout and rendering
// modules. One example is in effect in the default configuration, `auggie` (`DEFAULT_AGENT_SERVERS`,
// also what acp-tui reads when the user has no file); the others are commented out.
import { AUGGIE_INSTALL_HINT, CLAUDE_EXAMPLE_COMMAND, CLAUDE_STARTUP_TIMEOUT_SECONDS, DEFAULT_HARNESS, OPENCODE_INSTALL_HINT } from "./command.ts";

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
  readonly about: string;
  readonly entry: AgentExampleEntry;
  /** In effect in the default configuration (`auggie` only); every other example is commented out. */
  readonly active?: boolean;
  /** A commented alternative written below an active entry, with what it changes. */
  readonly suggestion?: { readonly about: string; readonly entry: AgentExampleEntry };
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
    active: true,
    about: `The default harness, Auggie, installed with ${AUGGIE_INSTALL_HINT}. additional_directory_args is the template acp-tui uses to pass each additional directory to a harness that does not take them through ACP, here as --add-workspace: the entry's additional_directories, a project's, --add-dir and /add-dir. Source: docs.augmentcode.com/cli/acp.`,
    entry: { command: "auggie", args: ["--acp"], additionalDirectoryArgs: AUGGIE_DIRECTORY_ARGS },
    suggestion: {
      about:
        "the same with a start-up option and a directory; to use it, put // in front of the auggie line above and remove it from this one. --reasoning-effort chooses how hard it thinks (none, low, medium, high, xhigh, max or dynamic). additional_directories gives Auggie's context engine one more directory in every session: the folder that holds all your projects lets it answer about any of them, whichever project you start in; replace /path/to/projects with yours (a directory that does not exist is a warning and left out). Auggie indexes that folder in the background, so start-up is not delayed. Writing --add-workspace <dir> in args also works, but bypasses acp-tui: that directory is not shown in the dirs module of the status row (+N dirs) and is not deduplicated with the others.",
      entry: { command: "auggie", args: ["--acp", "--reasoning-effort", "dynamic"], additionalDirectoryArgs: AUGGIE_DIRECTORY_ARGS, additionalDirectories: ["/path/to/projects"] },
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
  },
  {
    name: "pi",
    about: "the pi coding agent through pi-acp, installed with npm install -g pi-acp; pi itself must be on the PATH. Source: github.com/svkozak/pi-acp.",
    entry: { command: "pi-acp", args: [] },
  },
  {
    name: "gemini",
    about: "Google's Gemini CLI. Source: geminicli.com/docs/cli/acp-mode.",
    entry: { command: "gemini", args: ["--acp"] },
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

/** The `agent_servers` entries in effect in the default configuration: `auggie` alone. acp-tui reads
 *  them, with `default_agent_server` `DEFAULT_HARNESS`, when the user has no configuration file
 *  (spec tui-config "Configuration without a file"). A fresh object each call, so no caller can
 *  change another's. */
export function defaultAgentServers(): Record<string, Record<string, unknown>> {
  return Object.fromEntries(AGENT_EXAMPLES.filter((e) => e.active === true).map((e) => [e.name, exampleServerEntry(e.entry)]));
}

/** The active part of the default configuration that concerns harnesses, as loaded sections. */
export function defaultHarnessSections(): { agent_servers: Record<string, Record<string, unknown>>; default_agent_server: string } {
  return { agent_servers: defaultAgentServers(), default_agent_server: DEFAULT_HARNESS };
}

/** An example harness a word or `--harness` may name, for the refusal "Example harnesses are not
 *  run as commands": its name, whether the default configuration has it in effect, and, for an
 *  example whose entry is only a command and arguments, the command line that runs it. */
export interface ExampleHarness {
  readonly name: string;
  readonly commandLine: string | null;
  readonly active?: boolean;
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
    ...(e.active === true ? { active: true } : {}),
  }));
}

/** `~` for the home directory at the start of a path, as messages show the configuration file. */
export function withTilde(path: string, home: string | undefined = process.env["HOME"]): string {
  return home !== undefined && home !== "" && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;
}

/** Where the user finds an entry to copy, named after "add its entry to <file>". */
export const DEFAULT_ENTRIES_HINT = "(see config.dist.jsonc or acp-tui config --print-default)";

/** The refusal for an example's name: the entry to uncomment (for the default's own `auggie`, to
 *  add), and for an example of a command and arguments alone the `--` command that runs it. */
export function exampleRefusal(example: ExampleHarness, configPath: string): string {
  const alternative = example.commandLine !== null ? `, or run acp-tui -- ${example.commandLine}` : "";
  const fix = example.active === true ? `add its entry to ${withTilde(configPath)} ${DEFAULT_ENTRIES_HINT}` : `uncomment its entry in ${withTilde(configPath)}`;
  return `harness '${example.name}' is not configured; ${fix}${alternative}`;
}

/** The error for a default harness with no entry (configured-harnesses, design D3). */
export function defaultNotConfigured(name: string, configPath: string): string {
  return `default harness '${name}' is not configured; add its entry to ${withTilde(configPath)} ${DEFAULT_ENTRIES_HINT}`;
}
