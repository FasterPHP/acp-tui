// The agent catalogue (mvp-sessions task 3.2, design decision 8, spec
// tui-sessions "Named agents" and "Agents are defined only in the user's
// configuration"): the built-in `claude` entry (DEFAULT_AGENT_COMMAND) and the
// `agent_servers` entries of the user's configuration file,
// `$XDG_CONFIG_HOME/acp-tui/config.jsonc` (`~/.config` when XDG_CONFIG_HOME is
// unset or not absolute, `%APPDATA%` on Windows), in Zed's shape: `command` a
// string, `args` an array of strings, `env` an object of strings. A configured entry overrides a
// built-in one of the same name. `default_agent_server` (once `default_agent`) names the agent launched
// when neither `-a` nor an agent command is given.
//
// Since mvp-configuration (task 1.5) the file is read by the configuration
// loader (src/config/load.ts), which replaced the stopgap reader: the two keys
// keep their meaning, and the problems now carry the file's line and column. A
// broken file never stops acp-tui: a syntax error, an `agent_servers` that is
// not an object, an invalid entry or a `default_agent_server` that names no valid
// agent is a problem (shown by the app), and the built-in entry remains. An
// invalid entry is kept by name so that `-a <name>` can say what is wrong with
// it, but it is never launchable. When another user could have written the
// file (it or its directory writable by group or others, or owned by someone
// else; on Windows owned by someone other than the user, Administrators or
// SYSTEM, or outside the profile and XDG_CONFIG_HOME: config/writers.ts), its
// agents are refused and only the built-in ones are available
// (mvp-configuration task 1.6).
//
// Agents never come from a per-project `.acp-tui.jsonc` (design 6.10) or from
// the session index: this module reads one file, the user's own.
import { sanitise } from "acp-model";
import { parseConfigText, type ParsedSource } from "../config/load.ts";
import { formatProblem } from "../config/problems.ts";
import { AgentServerSchema } from "../config/schema.ts";
import { readConfigFile, userConfigFile } from "../config/sources.ts";
import { BUILT_IN_AGENT_NAME, DEFAULT_AGENT_COMMAND } from "./command.ts";

export { BUILT_IN_AGENT_NAME };

/** A launchable agent: its name, the command and its arguments, and environment added to acp-tui's own. */
export interface AgentEntry {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly source: "built-in" | "config";
}

export interface AgentCatalogue {
  /** The user's configuration file this catalogue was read from (it need not exist). */
  readonly path: string;
  /** Launchable agents by name: the built-in entries, then the valid configured ones. */
  readonly agents: ReadonlyMap<string, AgentEntry>;
  /** Configured entries that cannot be launched, by name, with the problem. An invalid entry with
   *  a built-in name leaves the built-in entry in `agents`. */
  readonly invalid: ReadonlyMap<string, string>;
  /** The agent launched without `-a` or an agent command: `default_agent_server` when it names a
   *  launchable agent, else `claude`. */
  readonly defaultAgent: string;
  /** Every problem found in the file, as messages for the user (empty when the file is fine or
   *  absent). */
  readonly problems: readonly string[];
  /** Why the file's agents were refused (another user could have written it), else null. */
  readonly refused?: string | null;
  /** The file's first error when it kept `agent_servers` from being read (a syntax error, a
   *  rejected section), formatted with its place, else null. */
  readonly fileProblem?: string | null;
}

export const BUILT_IN_AGENTS: readonly AgentEntry[] = [
  {
    name: BUILT_IN_AGENT_NAME,
    command: DEFAULT_AGENT_COMMAND[0]!,
    args: DEFAULT_AGENT_COMMAND.slice(1),
    env: {},
    source: "built-in",
  },
];

const BUILT_IN_NAMES = BUILT_IN_AGENTS.map((a) => a.name);

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
export function configFilePath(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return userConfigFile(env);
}

/** Printable and on one line, for names and values quoted in messages. */
function quote(text: string): string {
  return `'${sanitise(text, "approval").replace(/\s+/g, " ")}'`;
}

/** The catalogue a loaded user file gives. */
export function catalogueFromSource(source: ParsedSource, options: { refused?: string | null } = {}): AgentCatalogue {
  const path = source.file;
  const agents = new Map<string, AgentEntry>(BUILT_IN_AGENTS.map((a) => [a.name, a]));
  const servers = (source.sections.agent_servers ?? {}) as Record<string, unknown>;
  for (const [name, raw] of Object.entries(servers)) {
    const entry = AgentServerSchema.parse(raw);
    agents.set(name, { name, command: entry.command, args: entry.args, env: { ...entry.env }, source: "config" });
  }
  const invalid = new Map(Object.entries(source.invalidAgents));
  const chosen = source.sections.default_agent_server;
  const defaultAgent = typeof chosen === "string" && agents.has(chosen) ? chosen : BUILT_IN_AGENT_NAME;
  // The error that kept `agent_servers` out, if one did: the whole file, or that section.
  const blocking = source.problems.find((p) => p.severity === "error" && (p.path === "" || p.path === "agent_servers"));
  return {
    path,
    agents,
    invalid,
    defaultAgent,
    problems: source.problems.map(formatProblem),
    refused: options.refused ?? null,
    fileProblem: blocking ? formatProblem(blocking) : null,
  };
}

/** Parses the configuration text into a catalogue (exported for tests; `loadAgentCatalogue`
 *  reads the file). `text` null means the file does not exist; `refused` says why its agents are
 *  not trusted, when another user could have written it. */
export function buildAgentCatalogue(text: string | null, path: string, options: { refused?: string | null } = {}): AgentCatalogue {
  const source = parseConfigText(text, path, { kind: "user", agentsRefused: options.refused ?? null, knownAgents: BUILT_IN_NAMES });
  return catalogueFromSource(source, options);
}

/** Reads the user's configuration file into a catalogue. A missing file gives the built-in entry
 *  alone, with no problem. */
export function loadAgentCatalogue(options: { env?: Readonly<Record<string, string | undefined>>; path?: string } = {}): AgentCatalogue {
  const path = options.path ?? configFilePath(options.env);
  const read = readConfigFile(path, { checkWriters: true, ...(options.env ? { env: options.env } : {}) });
  if (read.error !== null) {
    const catalogue = buildAgentCatalogue(null, path);
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
  const known = [...catalogue.agents.keys()].map(quote).join(", ");
  let message = `${quote(name)} is not a known harness (known: ${known}; harnesses are defined in agent_servers in ${catalogue.path})`;
  if (catalogue.refused) message += `; harness commands are not read from a file other users can write (${catalogue.refused})`;
  else if (catalogue.fileProblem) message += `; the configuration file has a problem: ${catalogue.fileProblem}`;
  throw new AgentNameError(message);
}
