// Reading the configuration files once (mvp-configuration design D3 to D5): the
// user's file and the project file of a session directory, each loaded on its
// own (load.ts), merged with the command line's settings (effective.ts). The
// store (store.ts) does this at start-up and on every reload, keeping each
// file's last good sections in between; `acp-tui config --check` does it once
// (src/config-command.ts). No Solid and no OpenTUI here: the subcommands never
// start the renderer.
import { effectiveConfig, nextLastGood, type ConfigOverrides } from "./effective.ts";
import { parseConfigText, type ConfigSourceKind, type ParsedSource } from "./load.ts";
import type { ConfigProblem } from "./problems.ts";
import type { Config } from "./schema.ts";
import type { Platform } from "../platform/paths.ts";
import { findProjectFile, homeDirectory, readConfigFile, themesDirectory, userConfigFile, type Env, type FileRead, type ReadOptions } from "./sources.ts";

function readProblem(file: string, error: string): ConfigProblem {
  return { file, line: 1, column: 1, path: "", severity: "error", message: `could not be read (${error}) and is ignored` };
}

/** A file read and loaded; a read error counts as a file that did not parse. */
export function loadSource(read: FileRead, file: string, kind: ConfigSourceKind, knownAgents: readonly string[], platform?: NodeJS.Platform, home?: string): ParsedSource {
  if (read.error !== null) return { file, kind, status: "syntax", sections: {}, rejected: [], invalidAgents: {}, notices: [], problems: [readProblem(file, read.error)] };
  return parseConfigText(read.text, file, { kind, agentsRefused: kind === "user" ? read.unsafe : null, ...(kind === "user" ? { knownAgents } : {}), ...(platform ? { platform } : {}), ...(home !== undefined ? { home } : {}) });
}

export interface ReadConfigurationOptions {
  /** Where XDG_CONFIG_HOME and HOME come from; default `process.env`. */
  readonly env?: Env;
  /** The session directory, where the project file is looked for; null for none. */
  readonly sessionDirectory: string | null;
  readonly overrides?: ConfigOverrides;
  /** Agent names that exist without the file's entries; default none (every harness is an entry). */
  readonly knownAgents?: readonly string[];
  /** Reads a file (tests); default `readConfigFile`. */
  readonly read?: (path: string, options: ReadOptions) => FileRead;
  /** Whose paths and writer rules apply (tests); default `process.platform`. */
  readonly platform?: Platform;
}

export interface ConfigurationRead {
  /** The effective configuration: defaults, the files' valid sections, the command line. */
  readonly config: Config;
  /** The loader's problems: the user's file, then the project file. */
  readonly problems: readonly ConfigProblem[];
  /** What only `config --check` reports: deprecated names that still work (`default_agent`). */
  readonly notices: readonly ConfigProblem[];
  /** The directories only the project file adds (not also in the user's file), for the notice that names them. */
  readonly projectDirectories: readonly string[];
  readonly files: { readonly user: string; readonly project: string | null; readonly themes: string };
  /** Whether each file exists. */
  readonly present: { readonly user: boolean; readonly project: boolean };
}

/** Reads and loads the configuration files once, as acp-tui would at start-up. */
export function readConfiguration(options: ReadConfigurationOptions): ConfigurationRead {
  const env = options.env ?? process.env;
  const read = options.read ?? readConfigFile;
  const knownAgents = options.knownAgents ?? [];
  const platform = options.platform ?? process.platform;
  const userFile = userConfigFile(env, platform);
  const user = loadSource(read(userFile, { checkWriters: true, env, platform }), userFile, "user", knownAgents, platform, homeDirectory(env));
  const projectFile = options.sessionDirectory === null ? null : findProjectFile(options.sessionDirectory, { home: homeDirectory(env) });
  const project = projectFile === null ? null : loadSource(read(projectFile, {}), projectFile, "project", knownAgents, platform, homeDirectory(env));
  const config = effectiveConfig({
    user: nextLastGood({}, user),
    project: project ? nextLastGood({}, project) : {},
    ...(options.overrides ? { overrides: options.overrides } : {}),
  });
  return {
    config,
    projectDirectories: onlyInProject(user, project),
    problems: [...user.problems, ...(project?.problems ?? [])],
    notices: [...user.notices, ...(project?.notices ?? [])],
    files: { user: userFile, project: projectFile, themes: themesDirectory(env, platform) },
    present: { user: user.status !== "absent", project: project !== null && project.status !== "absent" },
  };
}

/** The directories the project file adds that the user's file does not already name. */
export function onlyInProject(user: ParsedSource | null, project: ParsedSource | null): string[] {
  const own = new Set(strings(user?.sections.additional_directories));
  return strings(project?.sections.additional_directories).filter((d) => !own.has(d));
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
