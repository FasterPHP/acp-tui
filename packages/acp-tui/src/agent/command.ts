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

/** A built-in harness: its name, the program and arguments it runs, and (for a program the user
 *  must install first) how to install it, which an error for a missing program ends with. */
export interface BuiltInHarness {
  readonly name: string;
  readonly command: readonly string[];
  readonly installHint?: string;
}

/** Auggie 0.36.0 is what the colleagues testing acp-tui run (plan decision 2: pinned in the hint). */
export const AUGGIE_INSTALL_HINT = "npm install -g @augmentcode/auggie@0.36.0 (Node 20 or later), then run auggie login";

/** The built-in harnesses, in the order the messages list them. `auggie` runs from the PATH as an
 *  ordinary executable (a Node bundle, never under Bun); `claude` is the pinned command above. */
export const BUILT_IN_HARNESSES: readonly BuiltInHarness[] = [
  { name: "auggie", command: ["auggie", "--acp"], installHint: AUGGIE_INSTALL_HINT },
  { name: "claude", command: DEFAULT_AGENT_COMMAND },
];

/** The harness launched when no name, command or `default_agent_server` says otherwise: `auggie`
 *  for now (Marcus, 19 October 2026: the colleagues testing acp-tui use Auggie). Switching back is
 *  this one constant plus the tests that name it. */
export const DEFAULT_HARNESS = "auggie";

/** The built-in harnesses' names, in table order. */
export const BUILT_IN_HARNESS_NAMES: readonly string[] = BUILT_IN_HARNESSES.map((h) => h.name);
