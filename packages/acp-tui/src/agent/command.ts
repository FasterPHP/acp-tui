// Default agent command (design D4, task 5.2): kept as a single constant so
// Phase 1's config file can replace it. Run through `bun x` (what `bunx` is) so
// the user need not install the package themselves; it relies on their
// existing Claude Code login. Version checked against the npm registry on
// 21 October 2026: @agentclientprotocol/claude-agent-acp 0.94.0 is the
// "latest" dist-tag (raised from 0.81.2, which was the latest on 27 September 2026).
// `--bun` runs the agent under Bun even though its bin starts with
// `#!/usr/bin/env node`: acp-tui already needs Bun, and the `node` on a user's
// PATH may be a shim that cannot see the package (on Marcus's Mac it runs Node
// in a Docker container, so the agent failed with "Cannot find module",
// 13 October 2026). claude-agent-acp 0.81.2 answered `initialize` under Bun, and 0.94.0 is checked the same way.
//
// The Bun that runs it is the one running acp-tui (`process.execPath`), not a
// `bunx` looked up on the PATH: it is always there, on Windows too, and no
// program of that name in the session directory or elsewhere on the PATH can
// stand in for it (spec tui-agent-session "Programs resolved from the PATH only").

/** The pinned claude-agent-acp package the built-in `claude` runs. */
export const CLAUDE_AGENT_PACKAGE = "@agentclientprotocol/claude-agent-acp@0.94.0";

/** The built-in `claude`'s command as run by the Bun at `bun`. */
export function builtInAgentCommand(bun: string = process.execPath): readonly string[] {
  return [bun, "x", "--bun", CLAUDE_AGENT_PACKAGE];
}

/** The built-in `claude`'s command as acp-tui runs it: the Bun running acp-tui, by its path. */
export const DEFAULT_AGENT_COMMAND: readonly string[] = builtInAgentCommand();

/** The same command as a configuration entry writes it, the same on every machine (the commented
 *  default's `claude` example): `bunx`, found on the PATH when the entry is used. */
export const DEFAULT_AGENT_EXAMPLE_COMMAND: readonly string[] = ["bunx", "--bun", CLAUDE_AGENT_PACKAGE];

/** A built-in harness: its name and the program and arguments it runs, plus what the messages and
 *  launches around it need. */
export interface BuiltInHarness {
  readonly name: string;
  readonly command: readonly string[];
  /** For a program the user must install first: how, which an error for a missing program ends with. */
  readonly installHint?: string;
  /** The command that logs in to the harness, as the user types it (`auggie login`): an
   *  authentication-required error adds `run <loginHint> in a terminal, then start acp-tui again`. */
  readonly loginHint?: string;
  /** Seconds of silence before a start-up is given up on (the timer comes with the start-up timeout). */
  readonly startupTimeoutSeconds: number;
  /** For a harness that takes extra directories as arguments: the template, `{dir}` standing for
   *  each directory (used when additional directories are delivered). */
  readonly additionalDirectoryArgs?: readonly string[];
}

/** Auggie 0.36.0 is what the colleagues testing acp-tui run (plan decision 2: pinned in the hint). */
export const AUGGIE_INSTALL_HINT = "npm install -g @augmentcode/auggie@0.36.0 (Node 20 or later), then run auggie login";

/** OpenCode's 2.x line is published as `@opencode/cli`; the older `opencode-ai` package stops at 1.19.3. */
export const OPENCODE_INSTALL_HINT = "npm install -g @opencode/cli, or see opencode.ai/docs";

/** Seconds a start-up may stay silent by default, and for `claude`, whose `bunx` may download the adapter first. */
export const DEFAULT_STARTUP_TIMEOUT_SECONDS = 30;
export const CLAUDE_STARTUP_TIMEOUT_SECONDS = 120;

/** The built-in harnesses, in the order the messages list them. `auggie` and `opencode` run from
 *  the PATH as ordinary executables (`auggie` a Node bundle, never under Bun); `claude` is the
 *  pinned command above. */
export const BUILT_IN_HARNESSES: readonly BuiltInHarness[] = [
  {
    name: "auggie",
    command: ["auggie", "--acp"],
    installHint: AUGGIE_INSTALL_HINT,
    loginHint: "auggie login",
    startupTimeoutSeconds: DEFAULT_STARTUP_TIMEOUT_SECONDS,
    additionalDirectoryArgs: ["--add-workspace", "{dir}"],
  },
  { name: "claude", command: DEFAULT_AGENT_COMMAND, startupTimeoutSeconds: CLAUDE_STARTUP_TIMEOUT_SECONDS },
  {
    name: "opencode",
    command: ["opencode", "acp"],
    installHint: OPENCODE_INSTALL_HINT,
    loginHint: "opencode auth login",
    startupTimeoutSeconds: DEFAULT_STARTUP_TIMEOUT_SECONDS,
  },
];

/** The harness launched when no name, command or `default_agent_server` says otherwise: `auggie`
 *  for now (Marcus, 19 October 2026: the colleagues testing acp-tui use Auggie). Switching back is
 *  this one constant plus the tests that name it. */
export const DEFAULT_HARNESS = "auggie";

/** The built-in harnesses' names, in table order. */
export const BUILT_IN_HARNESS_NAMES: readonly string[] = BUILT_IN_HARNESSES.map((h) => h.name);
