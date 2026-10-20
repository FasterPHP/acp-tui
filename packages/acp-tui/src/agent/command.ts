// Default agent command (design D4, task 5.2): kept as a single constant so
// Phase 1's config file can replace it. Run via `bunx` so the user need not
// install the package themselves; it relies on their existing Claude Code
// login. Version checked against the npm registry on 27 September 2026:
// @agentclientprotocol/claude-agent-acp 0.81.2 is the "latest" dist-tag.
// `--bun` runs the agent under Bun even though its bin starts with
// `#!/usr/bin/env node`: acp-tui already needs Bun, and the `node` on a user's
// PATH may be a shim that cannot see the package (on Marcus's Mac it runs Node
// in a Docker container, so the agent failed with "Cannot find module",
// 13 October 2026). claude-agent-acp 0.81.2 answers `initialize` under Bun.
export const DEFAULT_AGENT_COMMAND: readonly string[] = [
  "bunx",
  "--bun",
  "@agentclientprotocol/claude-agent-acp@0.81.2",
];

/** The name of the built-in agent entry, which is also the default agent (`default_agent`). */
export const BUILT_IN_AGENT_NAME = "claude";
