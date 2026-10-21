// Install and login hints by program (configured-harnesses, design D2; spec tui-agent-session
// "Harness program not installed" and "Harness needs a login"). acp-tui has no built-in harnesses:
// every harness is an `agent_servers` entry, and what a harness needs that can be a setting (its
// start-up timeout, its argument template) is one, shown in the default file's examples. Install
// and login hints cannot be settings, so they stay here, keyed by the program the entry (or an ad
// hoc command) runs, whatever the entry is called: the command's base name, or for the Claude
// adapter run through `bunx` or `npx`, the package among the arguments.
import { AUGGIE_INSTALL_HINT, BUN_INSTALL_HINT, OPENCODE_INSTALL_HINT } from "./command.ts";

/** What acp-tui can tell the user about a program it knows. */
export interface ProgramHints {
  /** How to install the program, which an error for a missing program ends with. */
  readonly installHint?: string;
  /** The command that logs in (`auggie login`): an authentication-required error adds
   *  `run <loginHint> in a terminal, then start acp-tui again`. */
  readonly loginHint?: string;
}

/** The Claude adapter's package, recognised among a command's arguments with or without a version. */
export const CLAUDE_ADAPTER_PACKAGE_NAME = "@agentclientprotocol/claude-agent-acp";

/** The programs acp-tui knows, by name. The Claude adapter has no login hint: Claude Code logs in
 *  inside its own interface (`/login`), and the adapter's message says so. */
export const PROGRAM_HINTS: Readonly<Record<string, ProgramHints>> = {
  auggie: { installHint: AUGGIE_INSTALL_HINT, loginHint: "auggie login" },
  opencode: { installHint: OPENCODE_INSTALL_HINT, loginHint: "opencode auth login" },
  "claude-agent-acp": { installHint: BUN_INSTALL_HINT },
};

/** Windows program extensions left out of a base name. */
const WINDOWS_EXTENSIONS = /\.(cmd|bat|exe|ps1)$/i;

/** A command's base name: its last path component (`/` or, on Windows, `\` separated), without a
 *  Windows program extension and lower-cased on Windows, where names are case-insensitive. */
export function commandBaseName(command: string, platform: NodeJS.Platform = process.platform): string {
  const parts = command.split(platform === "win32" ? /[\\/]/ : /\//);
  const base = parts[parts.length - 1] ?? command;
  return platform === "win32" ? base.replace(WINDOWS_EXTENSIONS, "").toLowerCase() : base;
}

/** Whether an argument names the Claude adapter's package (`@agentclientprotocol/claude-agent-acp`,
 *  optionally `@<version>`). */
function namesClaudeAdapter(arg: string): boolean {
  return arg === CLAUDE_ADAPTER_PACKAGE_NAME || arg.startsWith(`${CLAUDE_ADAPTER_PACKAGE_NAME}@`);
}

/** The program a command runs, as the hints table names it: `claude-agent-acp` when an argument
 *  names its package, else the command's base name. */
export function programOf(command: string, args: readonly string[], platform: NodeJS.Platform = process.platform): string {
  if (args.some(namesClaudeAdapter)) return "claude-agent-acp";
  return commandBaseName(command, platform);
}

/** The hints for a command, empty when acp-tui does not know its program. */
export function hintsFor(command: string, args: readonly string[], platform: NodeJS.Platform = process.platform): ProgramHints {
  return PROGRAM_HINTS[programOf(command, args, platform)] ?? {};
}
