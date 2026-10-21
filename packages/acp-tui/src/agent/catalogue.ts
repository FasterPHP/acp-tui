// The agent catalogue (mvp-sessions task 3.2, design decision 8, spec tui-sessions "Named agents",
// "Agents are defined only in the user's configuration" and, since configured-harnesses,
// "Configured harnesses only"): the `agent_servers` entries of the user's configuration file,
// `$XDG_CONFIG_HOME/acp-tui/config.jsonc` (`~/.config` when XDG_CONFIG_HOME is unset or not
// absolute, `%APPDATA%` on Windows), in Zed's shape: `command` a string, `args` an array of
// strings, `env` an object of strings. There are no built-in harnesses: when the file does not
// exist, the loader reads it as the default configuration's active lines (the `auggie` entry and
// `default_agent_server` `auggie`, design D1); a file that exists is taken as written.
// `default_agent_server` (once `default_agent`) names the agent launched when neither a harness
// name nor an agent command is given; a name with no entry is kept, and launching by it fails
// (design D3).
//
// The file is read by the configuration loader (src/config/load.ts). A broken file never stops
// acp-tui: a syntax error, an `agent_servers` that is not an object or an invalid entry is a
// problem (shown by the app). An invalid entry is kept by name so that `-a <name>` can say what is
// wrong with it, but it is never launchable. When another user could have written the file (it or
// its directory writable by group or others, or owned by someone else; on Windows owned by someone
// other than the user, Administrators or SYSTEM, or outside the profile and XDG_CONFIG_HOME:
// config/writers.ts), its agents are refused and no harness is available by name.
//
// Install and login hints follow the program an entry runs, whatever it is called
// (src/agent/hints.ts). Agents never come from a per-project `.acp-tui.jsonc` (design 6.10) or from
// the session index: this module reads one file, the user's own.
import { sanitise } from "acp-model";
import { parseConfigText, type ParsedSource } from "../config/load.ts";
import { formatProblem } from "../config/problems.ts";
import { AgentServerSchema } from "../config/schema.ts";
import { readConfigFile, userConfigFile } from "../config/sources.ts";
import { defaultNotConfigured, exampleHarnesses, exampleRefusal } from "./examples.ts";
import { DEFAULT_HARNESS, DEFAULT_STARTUP_TIMEOUT_SECONDS } from "./command.ts";
import { hintsFor } from "./hints.ts";

export { DEFAULT_HARNESS };

/** A launchable agent: its name, the command and its arguments, and environment added to acp-tui's own. */
export interface AgentEntry {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  /** For a program acp-tui knows (src/agent/hints.ts): how to install it (an error for a missing program ends with it). */
  readonly installHint?: string;
  /** For a program with a login command (`auggie login`): what an authentication-required error adds. */
  readonly loginHint?: string;
  /** Seconds of silence a starting harness is allowed: the entry's `startup_timeout_seconds`, else the
   *  user's `agent_startup_timeout_seconds`, else 30. */
  readonly startupTimeoutSeconds?: number;
  /** For an entry that takes directories as arguments: the template with `{dir}` (used when additional directories are delivered). */
  readonly additionalDirectoryArgs?: readonly string[];
  /** The entry's own `additional_directories`, absolute real paths (the loader resolved them):
   *  added to every session of this harness, before a project file's (configured-harnesses D8). */
  readonly harnessDirectories?: readonly string[];
}

export interface AgentCatalogue {
  /** The user's configuration file this catalogue was read from (it need not exist). */
  readonly path: string;
  /** Launchable agents by name: the valid configured entries, in the file's order. */
  readonly agents: ReadonlyMap<string, AgentEntry>;
  /** Configured entries that cannot be launched, by name, with the problem. */
  readonly invalid: ReadonlyMap<string, string>;
  /** The agent launched without a harness name or an agent command: `default_agent_server` (by
   *  default `auggie`), whether or not it names an entry; `findDefaultAgent` says when it does not. */
  readonly defaultAgent: string;
  /** Every problem found in the file, as messages for the user (empty when the file is fine or
   *  absent). */
  readonly problems: readonly string[];
  /** The user's `agent_startup_timeout_seconds` when the file sets it, else null (entries without their own and ad hoc commands use it, else 30). */
  readonly startupTimeoutSetting?: number | null;
  /** Why the file's agents were refused (another user could have written it), else null. */
  readonly refused?: string | null;
  /** The file's first error when it kept `agent_servers` from being read (a syntax error, a
   *  rejected section), formatted with its place, else null. */
  readonly fileProblem?: string | null;
}

/** Thrown for `-a <name>` when no launchable agent has that name; the message names it and
 *  lists the known names, or says what is wrong with a configured entry of that name. */
export class AgentNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentNameError";
  }
}

/** The user's configuration file: `$XDG_CONFIG_HOME/acp-tui/config.jsonc`, or
 *  `~/.config/acp-tui/config.jsonc` when XDG_CONFIG_HOME is unset or not absolute
 *  (`%APPDATA%\acp-tui\config.jsonc` on Windows). */
export function configFilePath(env: Readonly<Record<string, string | undefined>> = process.env, platform: NodeJS.Platform = process.platform): string {
  return userConfigFile(env, platform);
}

/** Printable and on one line, for names and values quoted in messages. */
function quote(text: string): string {
  return `'${sanitise(text, "approval").replace(/\s+/g, " ")}'`;
}

/** The catalogue a loaded user file gives. */
export function catalogueFromSource(source: ParsedSource, options: { refused?: string | null } = {}): AgentCatalogue {
  const path = source.file;
  const agents = new Map<string, AgentEntry>();
  const setting = typeof source.sections.agent_startup_timeout_seconds === "number" ? source.sections.agent_startup_timeout_seconds : null;
  const servers = (source.sections.agent_servers ?? {}) as Record<string, unknown>;
  for (const [name, raw] of Object.entries(servers)) {
    const entry = AgentServerSchema.parse(raw);
    const timeout = entry.startup_timeout_seconds ?? setting ?? DEFAULT_STARTUP_TIMEOUT_SECONDS;
    agents.set(name, {
      name,
      command: entry.command,
      args: entry.args,
      env: { ...entry.env },
      startupTimeoutSeconds: timeout,
      ...hintsFor(entry.command, entry.args),
      ...(entry.additional_directory_args !== undefined ? { additionalDirectoryArgs: entry.additional_directory_args } : {}),
      ...(entry.additional_directories !== undefined && entry.additional_directories.length > 0 ? { harnessDirectories: entry.additional_directories } : {}),
    });
  }
  const invalid = new Map(Object.entries(source.invalidAgents));
  const chosen = source.sections.default_agent_server;
  const defaultAgent = typeof chosen === "string" && chosen !== "" ? chosen : DEFAULT_HARNESS;
  // The error that kept `agent_servers` out, if one did: the whole file, or that section.
  const blocking = source.problems.find((p) => p.severity === "error" && (p.path === "" || p.path === "agent_servers"));
  return {
    path,
    agents,
    invalid,
    defaultAgent,
    startupTimeoutSetting: setting,
    problems: source.problems.map(formatProblem),
    refused: options.refused ?? null,
    fileProblem: blocking ? formatProblem(blocking) : null,
  };
}

/** Parses the configuration text into a catalogue (exported for tests; `loadAgentCatalogue`
 *  reads the file). `text` null means the file does not exist; `refused` says why its agents are
 *  not trusted, when another user could have written it. */
export function buildAgentCatalogue(text: string | null, path: string, options: { refused?: string | null } = {}): AgentCatalogue {
  const source = parseConfigText(text, path, { kind: "user", agentsRefused: options.refused ?? null, knownAgents: [] });
  return catalogueFromSource(source, options);
}

/** Reads the user's configuration file into a catalogue. A missing file gives the default
 *  configuration's `auggie` entry, with no problem. */
export function loadAgentCatalogue(options: { env?: Readonly<Record<string, string | undefined>>; path?: string } = {}): AgentCatalogue {
  const path = options.path ?? configFilePath(options.env);
  const read = readConfigFile(path, { checkWriters: true, ...(options.env ? { env: options.env } : {}) });
  if (read.error !== null) {
    // A file that exists but cannot be read is not an absent one: it gives no harnesses.
    const catalogue = buildAgentCatalogue("", path);
    const problem = `${path}:1:1: could not be read (${read.error}) and is ignored`;
    return { ...catalogue, problems: [problem], fileProblem: problem };
  }
  return buildAgentCatalogue(read.text, path, { refused: read.unsafe });
}

/** The launchable agent named `name`; throws `AgentNameError` naming it and the known agents, or
 *  saying what is wrong with a configured entry of that name, or with the file. */
export function findAgent(catalogue: AgentCatalogue, name: string): AgentEntry {
  const entry = catalogue.agents.get(name);
  if (entry) return entry;
  const problem = catalogue.invalid.get(name);
  if (problem !== undefined) {
    throw new AgentNameError(`harness ${quote(name)} in ${catalogue.path} ${problem}, so it cannot be launched`);
  }
  // Why the file gave no entries, when it did not: added to either message.
  const why = catalogue.refused
    ? `; harness commands are not read from a file other users can write (${catalogue.refused})`
    : catalogue.fileProblem
      ? `; the configuration file has a problem: ${catalogue.fileProblem}`
      : "";
  // The name of an example that is not configured: not run as a command.
  const example = exampleHarnesses([...catalogue.agents.keys(), ...catalogue.invalid.keys()]).find((e) => e.name === name);
  if (example) throw new AgentNameError(`${exampleRefusal(example, catalogue.path)}${why}`);
  const known = [...catalogue.agents.keys()].map(quote).join(", ");
  const list = known === "" ? "no harness is configured" : `known: ${known}`;
  throw new AgentNameError(`${quote(name)} is not a known harness (${list}; harnesses are defined in agent_servers in ${catalogue.path})${why}`);
}

/** The default harness's entry (`default_agent_server`); throws `AgentNameError` with the message of
 *  configured-harnesses design D3 when it names no entry at all, and as `findAgent` does for an
 *  invalid entry or a refused file. */
export function findDefaultAgent(catalogue: AgentCatalogue): AgentEntry {
  const name = catalogue.defaultAgent;
  if (!catalogue.agents.has(name) && !catalogue.invalid.has(name) && !catalogue.refused && !catalogue.fileProblem) {
    throw new AgentNameError(defaultNotConfigured(name, catalogue.path));
  }
  return findAgent(catalogue, name);
}
