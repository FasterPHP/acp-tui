// The commented agent examples of `acp-tui config --print-default` (mvp-configuration task 12.7),
// kept apart from the default file's builder so the command line and the catalogue can name them
// without loading the layout and rendering modules ("Example harnesses are not run as commands").
import { AUGGIE_INSTALL_HINT, BUILT_IN_HARNESSES, DEFAULT_AGENT_EXAMPLE_COMMAND, OPENCODE_INSTALL_HINT } from "./command.ts";

/** One commented agent example: what it is and where its command is documented, and its entry. */
export interface AgentExample {
  readonly name: string;
  readonly about: string;
  readonly entry: {
    readonly command: string;
    readonly args: readonly string[];
    readonly env?: Readonly<Record<string, string>>;
    /** For a harness that takes extra directories as arguments (`additional_directory_args`). */
    readonly additionalDirectoryArgs?: readonly string[];
  };
}

/**
 * The agent examples (task 12.7). Each command was checked against the agent's own documentation
 * or the ACP agents list (agentclientprotocol.com/overview/agents) on 13 October 2026, and its
 * comment names the source. DeepSeek has no ACP agent of its own, so it is reached through
 * OpenCode. `claude` repeats the built-in entry (`DEFAULT_AGENT_EXAMPLE_COMMAND`): the same
 * package and arguments acp-tui runs without the entry, through `bunx` from the PATH rather than
 * the Bun running acp-tui, whose path differs from machine to machine.
 */
export const AGENT_EXAMPLES: readonly AgentExample[] = [
  {
    name: "auggie",
    about: `the built-in auggie (the default harness), installed with ${AUGGIE_INSTALL_HINT}, plus two start-up options. --reasoning-effort chooses how hard it thinks (none, low, medium, high, xhigh, max or dynamic). --add-workspace gives its context engine one more directory in every session: the folder that holds all your projects lets it answer about any of them, whichever project you start in; replace /path/to/projects with yours, or remove the two arguments. Auggie indexes that folder in the background, so start-up is not delayed. Its additional_directory_args pass each additional directory (--add-dir, additional_directories) as --add-workspace too. Source: docs.augmentcode.com/cli/acp.`,
    entry: {
      command: "auggie",
      args: ["--acp", "--reasoning-effort", "high", "--add-workspace", "/path/to/projects"],
      additionalDirectoryArgs: BUILT_IN_HARNESSES.find((h) => h.name === "auggie")!.additionalDirectoryArgs!,
    },
  },
  {
    name: "claude",
    about:
      "the built-in claude as acp-tui runs it without an entry (which uses the Bun running acp-tui in place of bunx), plus Claude Code's ANTHROPIC_MODEL to choose the model. Change args to run another version of claude-agent-acp. Sources: npm @agentclientprotocol/claude-agent-acp, and code.claude.com/docs/en/settings for ANTHROPIC_MODEL.",
    entry: { command: DEFAULT_AGENT_EXAMPLE_COMMAND[0]!, args: DEFAULT_AGENT_EXAMPLE_COMMAND.slice(1), env: { ANTHROPIC_MODEL: "opus" } },
  },
  {
    name: "codex",
    about: "OpenAI Codex through codex-acp, installed with npm install -g @agentclientprotocol/codex-acp. Source: github.com/agentclientprotocol/codex-acp.",
    entry: { command: "codex-acp", args: [] },
  },
  {
    name: "opencode",
    about: `the built-in opencode as acp-tui runs it without an entry, installed with ${OPENCODE_INSTALL_HINT} and logged in with opencode auth login. Add an entry only to change its environment or arguments. Source: opencode.ai/docs/acp.`,
    entry: { command: "opencode", args: ["acp"] },
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


/** An example harness a lone word or `--harness` may name, for the refusal "Example harnesses are
 *  not run as commands": its name and, for an example without an environment, the command line
 *  that runs it. */
export interface ExampleHarness {
  readonly name: string;
  readonly commandLine: string | null;
}

/** The examples whose names are neither built in nor configured (`taken`), with their command lines. */
export function exampleHarnesses(taken: readonly string[]): ExampleHarness[] {
  return AGENT_EXAMPLES.filter((e) => !taken.includes(e.name)).map((e) => ({
    name: e.name,
    commandLine: e.entry.env === undefined ? [e.entry.command, ...e.entry.args].join(" ") : null,
  }));
}

/** `~` for the home directory at the start of a path, as messages show the configuration file. */
export function withTilde(path: string, home: string | undefined = process.env["HOME"]): string {
  return home !== undefined && home !== "" && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;
}

/** The refusal for an example's name (design: the entry to uncomment, and for an example without an
 *  environment the `--` command that runs it). */
export function exampleRefusal(example: ExampleHarness, configPath: string): string {
  const alternative = example.commandLine !== null ? `, or run acp-tui -- ${example.commandLine}` : "";
  return `harness '${example.name}' is not configured; uncomment its entry in ${withTilde(configPath)}${alternative}`;
}
