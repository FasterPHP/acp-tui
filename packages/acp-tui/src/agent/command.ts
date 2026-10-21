// What acp-tui knows about the harnesses it suggests (configured-harnesses, design D2 and D7).
// There are no built-in harnesses: a harness works only through an `agent_servers` entry
// (Marcus, 21 October 2026), and the default configuration has one, `auggie`
// (src/agent/examples.ts `DEFAULT_AGENT_SERVERS`), read as if written when the user has no file.
// This module keeps the constants the examples and the hints by program (src/agent/hints.ts) share.
//
// The Claude adapter: version checked against the npm registry on 21 October 2026,
// @agentclientprotocol/claude-agent-acp 0.94.0 is the "latest" dist-tag (raised from 0.81.2).
// The `claude` example runs it as `bunx --bun <package>`: `--bun` runs the adapter under Bun even
// though its bin starts with `#!/usr/bin/env node`, because the `node` on a user's PATH may be a
// shim that cannot see the package (on Marcus's Mac it runs Node in a Docker container, so the
// adapter failed with "Cannot find module", 13 October 2026). The launcher puts `~/.bun/bin` on
// the PATH, so `bunx` is found there.

/** The pinned claude-agent-acp package the `claude` example runs. */
export const CLAUDE_AGENT_PACKAGE = "@agentclientprotocol/claude-agent-acp@0.94.0";

/** The `claude` example's command, the same on every machine: `bunx`, found on the PATH. */
export const CLAUDE_EXAMPLE_COMMAND: readonly string[] = ["bunx", "--bun", CLAUDE_AGENT_PACKAGE];

/** The `claude` example's start-up timeout: its `bunx` may download the adapter first. */
export const CLAUDE_STARTUP_TIMEOUT_SECONDS = 120;

/** Auggie 0.36.0 is what the colleagues testing acp-tui run (plan decision 2: pinned in the hint). */
export const AUGGIE_INSTALL_HINT = "npm install -g @augmentcode/auggie@0.36.0 (Node 20 or later), then run auggie login";

/** OpenCode's 2.x line is published as `@opencode/cli`; the older `opencode-ai` package stops at 1.19.3. */
export const OPENCODE_INSTALL_HINT = "npm install -g @opencode/cli, or see opencode.ai/docs";

/** The Claude adapter runs through `bunx`, which comes with Bun. */
export const BUN_INSTALL_HINT = "Bun from bun.sh, which provides bunx";

/** Seconds a start-up may stay silent unless the entry or `agent_startup_timeout_seconds` says otherwise. */
export const DEFAULT_STARTUP_TIMEOUT_SECONDS = 30;

/** The name `default_agent_server` takes when the file does not set it, and the one entry the
 *  default configuration has: `auggie` (Marcus, 19 October 2026: the colleagues testing acp-tui use
 *  Auggie). It is only a name: nothing is launched by it unless an entry of that name exists. */
export const DEFAULT_HARNESS = "auggie";
