// Default agent command (design D4, task 5.2): kept as a single constant so
// Phase 1's config file can replace it. Run through `bun x` (what `bunx` is) so
// the user need not install the package themselves; it relies on their
// existing Claude Code login. Version checked against the npm registry on
// 27 September 2026: @agentclientprotocol/claude-agent-acp 0.81.2 is the
// "latest" dist-tag.
// `--bun` runs the agent under Bun even though its bin starts with
// `#!/usr/bin/env node`: acp-tui already needs Bun, and the `node` on a user's
// PATH may be a shim that cannot see the package (on Marcus's Mac it runs Node
// in a Docker container, so the agent failed with "Cannot find module",
// 13 October 2026). claude-agent-acp 0.81.2 answers `initialize` under Bun.
//
// The Bun that runs it is the one running acp-tui (`process.execPath`), not a
// `bunx` looked up on the PATH: it is always there, on Windows too, and no
// program of that name in the session directory or elsewhere on the PATH can
// stand in for it (spec tui-agent-session "Programs resolved from the PATH only").

/** The pinned claude-agent-acp package the built-in `claude` runs. */
export const CLAUDE_AGENT_PACKAGE = "@agentclientprotocol/claude-agent-acp@0.81.2";

/** The built-in `claude`'s command as run by the Bun at `bun`. */
export function builtInAgentCommand(bun: string = process.execPath): readonly string[] {
  return [bun, "x", "--bun", CLAUDE_AGENT_PACKAGE];
}

/** The built-in `claude`'s command as acp-tui runs it: the Bun running acp-tui, by its path. */
export const DEFAULT_AGENT_COMMAND: readonly string[] = builtInAgentCommand();

/** The same command as a configuration entry writes it, the same on every machine (the commented
 *  default's `claude` example): `bunx`, found on the PATH when the entry is used. */
export const DEFAULT_AGENT_EXAMPLE_COMMAND: readonly string[] = ["bunx", "--bun", CLAUDE_AGENT_PACKAGE];

/** The name of the built-in agent entry, which is also the default agent (`default_agent`). */
export const BUILT_IN_AGENT_NAME = "claude";
