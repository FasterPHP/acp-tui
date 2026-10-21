// What acp-tui launches and where (mvp-sessions task 3.3, spec tui-agent-session
// "Agent launch" and "New session in the current directory", tui-sessions
// "Named agents"): the parsed command line resolved through the agent
// catalogue into one `LaunchDescription`. An agent command (after `--`) wins;
// else `-a <name>`; else the default agent (`default_agent_server`, else `auggie`).
// The catalogue, and with it the user's configuration file, is read only when
// a name has to be looked up, so an ad hoc command never touches it. The
// session directory is the explicit directory argument (already absolute and
// symlink-resolved by cli.ts), else the launch directory, resolved the same
// way.
//
// `--resume <id>` (tasks 5.2 and 12.5, design decision 2, spec tui-sessions
// "Opening a session by ID") also reads acp-tui's session index: without `-a` and `--`,
// the agent is the named agent the index records for the session (the most
// recently active match), else the default; the index never supplies a
// command, so an `ad hoc` entry is an error that says how to reopen it. The
// directory is the one the index records (for the chosen agent); when the
// index lacks the session it stays the launch directory here, and
// `prepareLaunch` asks the agent's `session/list` before the app starts
// (src/session/start.ts, design decision 13). `--continue` across agents is
// resolved there too: here it is the default (or the narrowed) agent.
//
// The description carries what later work needs: the agent's name (or
// `ad hoc`) for the session index and the resume line, which session option
// was given, and how the agent and directory were chosen.
import { existsSync, realpathSync, statSync } from "node:fs";
import type { CliOptions, SessionOption } from "../cli.ts";
import type { Platform } from "../platform/paths.ts";
import { readConfiguration } from "../config/read.ts";
import { withoutSessionDirectory } from "../config/directories.ts";
import { shortenHome } from "../layout/segments.ts";
import { homeDirectory } from "../config/sources.ts";
import { shellWordFor } from "../platform/shell-quote.ts";
import { AD_HOC_AGENT, openSessionIndex, type SessionIndex, type SessionRecord } from "../session/session-index.ts";
import { AgentNameError, findAgent, loadAgentCatalogue, type AgentCatalogue, type AgentEntry } from "./catalogue.ts";

export { AD_HOC_AGENT };

export interface LaunchDescription {
  /** The agent's name in the catalogue, or `ad hoc` for a command given after `--`. */
  readonly agentName: string;
  /** How the agent was chosen: `-a` (`option`), an agent command (`command`), the session index
   *  for `--resume <id>` or `--continue` (`index`), or none of these (`default`: `default_agent_server`, else `auggie`). */
  readonly agentSource: "option" | "command" | "index" | "default";
  /** The executable and its arguments. */
  readonly command: string;
  readonly args: readonly string[];
  /** Added to acp-tui's own environment for the agent process (a configured entry's `env`). */
  readonly env: Readonly<Record<string, string>>;
  /** For a built-in harness whose program the user installs: how, for the launch error (a configured
   *  entry of the same name gets none, since its command is the user's). */
  readonly installHint?: string;
  /** For a built-in harness with a login command: what an authentication-required error adds. */
  readonly loginHint?: string;
  /** Seconds a starting harness may stay silent before it is stopped (catalogue.ts); 30 when absent. */
  readonly startupTimeoutSeconds?: number;
  /** The session directory: the directory argument, else (for `--resume <id>`) the index's, else
   *  the launch directory; absolute and symlink-resolved. */
  readonly directory: string;
  readonly directorySource: "argument" | "index" | "launch";
  /** The directory acp-tui was started from, absolute and symlink-resolved. */
  readonly launchDirectory: string;
  /** `--resume <id>`, `--continue`, `--resume` (the list), or a new session. */
  readonly session: SessionOption;
  /** For `--resume <id>`: the index's entry for the session and the chosen agent, else null. */
  readonly indexed: SessionRecord | null;
  /** For `--resume <id>` without `-a` or `--`: how many agents the index has the session for (more
   *  than one: the app names the agent it chose in a notice). 0 otherwise. */
  readonly indexMatches: number;
  /** Problems found in the user's configuration file, for the app to show as notices. */
  readonly problems: readonly string[];
  /** For a harness that takes extra directories as arguments: the template, `{dir}` standing for
   *  each directory; then `launchArgv` appends it per directory and ACP's field is not sent. */
  readonly additionalDirectoryArgs?: readonly string[];
  /** The additional directories of this launch, in order and without repeats: the configuration's,
   *  then the ones recorded with the session being reopened, then this run's `--add-dir`; never the
   *  session directory. Absent: none. */
  readonly additionalDirectories?: readonly string[];
  /** The directories kept with the session in the index: the recorded ones that still exist, then
   *  this run's `--add-dir` (not the configuration's). Absent: none. */
  readonly addedDirectories?: readonly string[];
  /** The configuration's directories (user's file, then the project file's), as last read. */
  readonly configDirectories?: readonly string[];
  /** The directories only the project file adds, and the file, for the notice naming them. */
  readonly projectDirectories?: readonly string[];
  readonly projectFile?: string | null;
  /** This run's `--add-dir` directories, absolute. */
  readonly addDirs?: readonly string[];
  /** Notices for the session that starts with this launch (a recorded directory that has gone). */
  readonly directoryNotices?: readonly string[];
}

/** The install and login hints of a built-in catalogue entry, as spreadable properties. */
export function hintOf(entry: Pick<AgentEntry, "installHint" | "loginHint" | "startupTimeoutSeconds" | "additionalDirectoryArgs">): { installHint?: string; loginHint?: string; startupTimeoutSeconds?: number; additionalDirectoryArgs?: readonly string[] } {
  return {
    ...(entry.additionalDirectoryArgs !== undefined ? { additionalDirectoryArgs: entry.additionalDirectoryArgs } : {}),
    ...(entry.startupTimeoutSeconds !== undefined ? { startupTimeoutSeconds: entry.startupTimeoutSeconds } : {}),
    ...(entry.installHint !== undefined ? { installHint: entry.installHint } : {}),
    ...(entry.loginHint !== undefined ? { loginHint: entry.loginHint } : {}),
  };
}

/** The agent process's argument vector: the command, then its arguments, then (for a harness with
 *  an `additional_directory_args` template) the template once per additional directory with `{dir}`
 *  replaced by its absolute path. */
export function launchArgv(launch: Pick<LaunchDescription, "command" | "args" | "additionalDirectoryArgs" | "additionalDirectories">): readonly string[] {
  const template = launch.additionalDirectoryArgs;
  const extra = template === undefined ? [] : (launch.additionalDirectories ?? []).flatMap((dir) => template.map((arg) => arg.replaceAll("{dir}", dir)));
  return [launch.command, ...launch.args, ...extra];
}

function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** The directories of a launch (design: configuration, then recorded, then `--add-dir`): the
 *  effective list, the ones to record with the session, and a notice for each recorded directory
 *  that has gone. */
export interface DerivedDirectories {
  readonly additionalDirectories: readonly string[];
  readonly addedDirectories: readonly string[];
  readonly directoryNotices: readonly string[];
}

export function deriveDirectories(input: {
  readonly config: readonly string[];
  readonly recorded: readonly string[];
  readonly addDirs: readonly string[];
  /** The session directory, left out of the list. */
  readonly directory: string;
  readonly home?: string | null;
}): DerivedDirectories {
  const home = input.home === undefined ? homeDirectory() : input.home;
  const notices: string[] = [];
  const recorded: string[] = [];
  for (const dir of input.recorded) {
    if (isDirectory(dir)) recorded.push(dir);
    else notices.push(`additional directory ${shortenHome(dir, home)} is no longer there and was left out`);
  }
  const added = withoutSessionDirectory([...recorded, ...input.addDirs], input.directory);
  return {
    additionalDirectories: withoutSessionDirectory([...input.config, ...recorded, ...input.addDirs], input.directory),
    addedDirectories: added,
    directoryNotices: notices,
  };
}

/** `launch` with its directories derived again for another session directory and recorded list
 *  (a session chosen from the list, a `--continue` that found a recorded session). */
export function withDirectories(launch: LaunchDescription, input: { readonly directory?: string; readonly recorded?: readonly string[]; readonly config?: readonly string[] }): LaunchDescription {
  const derived = deriveDirectories({
    config: input.config ?? launch.configDirectories ?? [],
    recorded: input.recorded ?? [],
    addDirs: launch.addDirs ?? [],
    directory: input.directory ?? launch.directory,
  });
  return { ...launch, ...(input.config ? { configDirectories: input.config } : {}), ...derived };
}

/** The notice naming the directories a project file adds, shown once at start-up. */
export function projectDirectoriesNotice(file: string, directories: readonly string[], home: string | null = homeDirectory()): string {
  const list = directories.map((d) => shortenHome(d, home)).join(", ");
  return `${shortenHome(file, home)} adds ${directories.length === 1 ? "an additional directory" : `${directories.length} additional directories`}: ${list}`;
}

export interface ResolveContext {
  /** The launch directory; default `process.cwd()`. */
  readonly cwd?: string;
  /** Reads the catalogue; default `loadAgentCatalogue()` over `process.env`. */
  readonly catalogue?: () => AgentCatalogue;
  /** Opens the session index (read for `--resume <id>` only); default `openSessionIndex()`. */
  readonly index?: () => SessionIndex;
  /** Reads the configuration's additional directories for a session directory; default reads the
   *  user's file and the project file (`readConfiguration`). */
  readonly configDirectories?: (directory: string) => ConfigDirectories;
}

/** What the configuration says about additional directories. */
export interface ConfigDirectories {
  /** The union of the user's file and the project file, resolved. */
  readonly directories: readonly string[];
  /** The ones only the project file adds. */
  readonly projectDirectories: readonly string[];
  readonly projectFile: string | null;
}

/** Reads the configuration files for a session directory and returns their additional directories. */
export function readConfigDirectories(directory: string): ConfigDirectories {
  const read = readConfiguration({ sessionDirectory: directory });
  return { directories: read.config.additional_directories, projectDirectories: read.projectDirectories, projectFile: read.files.project };
}

/** One word for the user's shell: as is when it is plain, else single-quoted (for PowerShell on
 *  Windows, `platform` `win32`; for a POSIX shell elsewhere). */
export function shellWord(word: string, platform: Platform = process.platform): string {
  return shellWordFor(word, platform);
}

/** Thrown for `--resume <id>` when the index can name no agent to launch for it. */
export class SessionAgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionAgentError";
  }
}

/** Resolves the parsed options into a launch. Throws `AgentNameError` for an unknown or invalid
 *  `-a` name, and `SessionAgentError` (or `AgentNameError`) when `--resume <id>` names a session the
 *  index records with an `ad hoc` command or an agent that is no longer configured; all before
 *  anything is launched. */
export function resolveLaunch(options: Pick<CliOptions, "agentName" | "agentCommand" | "directory" | "session"> & { readonly addDirs?: readonly string[] }, context: ResolveContext = {}): LaunchDescription {
  const launch = resolveAgentLaunch(options, context);
  // The directories are derived last: the session directory (the index's, for `--resume <id>`) and
  // the session's recorded directories are known only now.
  const configured = (context.configDirectories ?? readConfigDirectories)(launch.directory);
  const addDirs = options.addDirs ?? [];
  return {
    ...launch,
    configDirectories: configured.directories,
    projectDirectories: configured.projectDirectories,
    projectFile: configured.projectFile,
    addDirs,
    ...deriveDirectories({ config: configured.directories, recorded: launch.indexed?.addedDirectories ?? [], addDirs, directory: launch.directory }),
  };
}

function resolveAgentLaunch(options: Pick<CliOptions, "agentName" | "agentCommand" | "directory" | "session">, context: ResolveContext): LaunchDescription {
  const launchDirectory = realpathSync(context.cwd ?? process.cwd());
  const session = options.session;
  const openIndex = context.index ?? (() => openSessionIndex());
  const base = {
    directory: options.directory ?? launchDirectory,
    directorySource: options.directory !== null ? ("argument" as const) : ("launch" as const),
    launchDirectory,
    session,
    indexed: null,
    indexMatches: 0,
  };
  // The index's directory for `--resume <id>`, for the agent chosen (the most recent record).
  const fromIndex = (agent: string, record?: SessionRecord | null) => {
    if (session.kind !== "resume") return {};
    const found = record !== undefined ? record : (openIndex().list({ agent }).find((r) => r.sessionId === session.id) ?? null);
    return found ? { indexed: found, directory: found.directory, directorySource: "index" as const } : {};
  };
  // Spec tui-agent-session "Agent launch": arguments after `--` are the agent command "instead of
  // either" a name or the default.
  if (options.agentCommand !== null) {
    const [command, ...args] = options.agentCommand;
    // The user's timeout setting applies to a command given after `--` too.
    const setting = (context.catalogue ?? (() => loadAgentCatalogue()))().startupTimeoutSetting;
    return { agentName: AD_HOC_AGENT, agentSource: "command", command: command!, args, env: {}, ...(typeof setting === "number" ? { startupTimeoutSeconds: setting } : {}), ...base, ...fromIndex(AD_HOC_AGENT), problems: [] };
  }
  const catalogue = (context.catalogue ?? (() => loadAgentCatalogue()))();
  if (session.kind === "resume" && options.agentName === null) {
    const { record, matches } = openIndex().find(session.id);
    if (record) {
      if (record.agent === AD_HOC_AGENT) throw new SessionAgentError(adHocSessionMessage(session.id, record.command ?? null));
      let entry;
      try {
        entry = findAgent(catalogue, record.agent);
      } catch (error) {
        throw new SessionAgentError(unconfiguredAgentMessage(session.id, record.agent, error));
      }
      return {
        agentName: entry.name,
        agentSource: "index",
        command: entry.command,
        args: entry.args,
        env: entry.env,
        ...hintOf(entry),
        ...base,
        ...fromIndex(entry.name, record),
        indexMatches: matches,
        problems: catalogue.problems,
      };
    }
  }
  const entry = findAgent(catalogue, options.agentName ?? catalogue.defaultAgent);
  return {
    agentName: entry.name,
    agentSource: options.agentName !== null ? "option" : "default",
    command: entry.command,
    args: entry.args,
    env: entry.env,
    ...hintOf(entry),
    ...base,
    ...fromIndex(entry.name),
    problems: catalogue.problems,
  };
}

/** Why a session the index records with an `ad hoc` agent is not reopened from the index (the
 *  index never supplies a command to run, design decision 2), with the command line that does. */
export function adHocSessionMessage(sessionId: string, command: readonly string[] | null, platform: Platform = process.platform): string {
  const rerun = ["acp-tui", sessionId.startsWith("-") ? `--resume=${sessionId}` : "--resume", ...(sessionId.startsWith("-") ? [] : [sessionId]), "--", ...(command ?? ["<command>"])].map((word) => shellWord(word, platform)).join(" ");
  return `session ${sessionId} was started with an ad hoc harness command, which acp-tui never runs from its index; reopen it with: ${rerun}`;
}

/** Why a session recorded with agent `agent` cannot be opened: that name no longer names a
 *  launchable agent (`error`, from `findAgent`, says why). */
export function unconfiguredAgentMessage(sessionId: string, agent: string, error: unknown): string {
  const reason = error instanceof AgentNameError ? error.message : String(error);
  return `session ${sessionId} was recorded with harness '${agent}', which cannot be launched now: ${reason}`;
}
