// The configuration store (mvp-configuration design D3, D5 and D6): reads the
// user's file and the project file, keeps each file's last good sections,
// merges them with the command line into the effective configuration, and holds
// it in one Solid signal, with the problem list in another. A reload builds a
// complete new effective configuration and swaps it in; sections that did not
// change keep their objects (effective.ts), so a reader that selects one
// section re-runs only when that section changed.
//
// Reading a setting reactively:
//
//   const flat = createMemo(() => store.config().theme.flat);
//
// or, outside a reactive root, `store.onReload(({ config, changed }) => ...)`.
// The configuration is loaded before the renderer is constructed (design D5;
// `app/run.tsx`), so start-up settings never wait for a frame.
//
// Problems found outside the loader (a theme file, a key map check, a layout
// rule run by its consumer) are added under a channel name with `setProblems`;
// `problems()` lists the loader's first, then every channel's.
import { createSignal, type Accessor } from "solid-js";
import { BUILT_IN_HARNESS_NAMES } from "../agent/command.ts";
import { changedSections, effectiveConfig, nextLastGood, pinnedSettings, type ConfigOverrides, type Sections } from "./effective.ts";
import type { ConfigProblem } from "./problems.ts";
import { loadSource } from "./read.ts";
import type { Config, SectionName } from "./schema.ts";
import { dirname, join } from "node:path";
import { CONFIG_FILE_NAME, configDirectory, findProjectFile, homeDirectory, PROJECT_FILE_NAME, readConfigFile, THEMES_DIR_NAME, themesDirectory, userConfigFile, type Env, type FileRead, type ReadOptions } from "./sources.ts";
import { createConfigWatcher, jsoncFiles, type ConfigWatcher, type WatcherOptions } from "./watch.ts";

export interface ConfigStoreOptions {
  /** Where XDG_CONFIG_HOME and HOME come from; default `process.env`. */
  readonly env?: Env;
  /** The session directory, where the project file is looked for (the directory argument, else
   *  the launch directory; `LaunchDescription.directory`). Null: no project file. */
  readonly sessionDirectory: string | null;
  /** Settings the command line gives for this run; never changed by a reload. */
  readonly overrides?: ConfigOverrides;
  /** Agent names that exist without the file, for checking `default_agent`; default the built-in. */
  readonly knownAgents?: readonly string[];
  /** Reads a file (tests); default `readConfigFile`. */
  readonly read?: (path: string, options: ReadOptions) => FileRead;
}

export interface LoadedFiles {
  readonly user: string;
  /** The project file in use, or null when none applies. */
  readonly project: string | null;
  readonly themes: string;
}

export interface ReloadResult {
  readonly config: Config;
  /** Sections whose values changed (empty at start-up and when nothing changed). */
  readonly changed: readonly SectionName[];
  readonly problems: readonly ConfigProblem[];
}

export interface ConfigStore {
  /** The effective configuration: one signal, swapped whole on a reload. */
  readonly config: Accessor<Config>;
  /** Every configuration problem: the loader's, then each channel's. */
  readonly problems: Accessor<readonly ConfigProblem[]>;
  /** `agent_servers` entries of the user's file that cannot be launched, by name: why. */
  readonly invalidAgents: Accessor<Readonly<Record<string, string>>>;
  /** The files in use at the last load. */
  readonly files: Accessor<LoadedFiles>;
  /** Settings the command line pins (`mouse`, `wheel_lines`, `exit.print`, `clipboard`). */
  readonly pinned: readonly string[];
  /** Reads every file again and swaps the result in. */
  reload(): ReloadResult;
  /** Called after every reload (not at start-up). */
  onReload(listener: (result: ReloadResult) => void): () => void;
  /** Makes the next watched save reload even when the files' contents are unchanged (a setting
   *  the last reload could not apply, such as the mouse policy while the terminal was busy). */
  retryOnNextSave(): void;
  /** Replaces the problems of `channel` (a theme file, the key map, ...). */
  setProblems(channel: string, problems: readonly ConfigProblem[]): void;
  /** Starts watching the configuration directory, `themes/` and the project file's directory (or
   *  the session directory while there is none), reloading on a change. */
  watch(options?: Partial<Omit<WatcherOptions, "targets" | "files" | "onChange">>): ConfigWatcher;
  dispose(): void;
}

const load = loadSource;

export function createConfigStore(options: ConfigStoreOptions): ConfigStore {
  const env = options.env ?? process.env;
  const read = options.read ?? readConfigFile;
  const knownAgents = options.knownAgents ?? BUILT_IN_HARNESS_NAMES;
  const overrides = options.overrides ?? {};
  const home = homeDirectory(env);
  const userFile = userConfigFile(env);
  const themes = themesDirectory(env);

  let lastUser: Sections = {};
  let lastProject: Sections = {};
  let lastProjectFile: string | null = null;
  const channels = new Map<string, readonly ConfigProblem[]>();
  let loadProblems: readonly ConfigProblem[] = [];
  const listeners = new Set<(result: ReloadResult) => void>();
  let watcher: ConfigWatcher | null = null;

  const readAll = (previous: Config | undefined) => {
    const user = load(read(userFile, { checkWriters: true, env }), userFile, "user", knownAgents);
    const projectFile = options.sessionDirectory === null ? null : findProjectFile(options.sessionDirectory, { home });
    // A different project file (or none) starts from nothing; its old sections are not kept.
    if (projectFile !== lastProjectFile) lastProject = {};
    lastProjectFile = projectFile;
    const project = projectFile === null ? null : load(read(projectFile, {}), projectFile, "project", knownAgents);
    lastUser = nextLastGood(lastUser, user);
    lastProject = project ? nextLastGood(lastProject, project) : {};
    const config = effectiveConfig({ user: lastUser, project: lastProject, overrides, ...(previous ? { previous } : {}) });
    loadProblems = [...user.problems, ...(project?.problems ?? [])];
    return { config, invalidAgents: user.invalidAgents, files: { user: userFile, project: projectFile, themes } };
  };

  const allProblems = (): readonly ConfigProblem[] => [...loadProblems, ...[...channels.values()].flat()];

  const first = readAll(undefined);
  const [config, setConfig] = createSignal<Config>(first.config, { equals: false });
  const [problems, setProblemsSignal] = createSignal<readonly ConfigProblem[]>(allProblems());
  const [invalidAgents, setInvalidAgents] = createSignal<Readonly<Record<string, string>>>(first.invalidAgents);
  const [files, setFiles] = createSignal<LoadedFiles>(first.files);

  const store: ConfigStore = {
    config,
    problems,
    invalidAgents,
    files,
    pinned: pinnedSettings(overrides),
    reload() {
      const before = config();
      const next = readAll(before);
      const changed = changedSections(before, next.config);
      if (changed.length > 0) setConfig(next.config);
      setProblemsSignal(allProblems());
      setInvalidAgents(next.invalidAgents);
      setFiles(next.files);
      const result: ReloadResult = { config: config(), changed, problems: problems() };
      for (const listener of [...listeners]) listener(result);
      return result;
    },
    onReload(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    retryOnNextSave() {
      watcher?.forget();
    },
    setProblems(channel, list) {
      if (list.length === 0) channels.delete(channel);
      else channels.set(channel, list);
      setProblemsSignal(allProblems());
    },
    watch(watchOptions = {}) {
      watcher?.close();
      const configDir = configDirectory(env);
      // The project file's directory, or the session directory while none applies (so a file
      // created there is seen).
      const projectDir = (): string | null => {
        const { project } = files();
        return project ? dirname(project) : options.sessionDirectory;
      };
      watcher = createConfigWatcher({
        ...watchOptions,
        targets: () => {
          const dir = projectDir();
          return [
            { dir: configDir, accept: (name) => name === null || name === CONFIG_FILE_NAME || name === THEMES_DIR_NAME },
            { dir: themes, accept: (name) => name === null || name.endsWith(".jsonc") },
            ...(dir ? [{ dir, accept: (name: string | null) => name === null || name === PROJECT_FILE_NAME }] : []),
          ];
        },
        files: () => {
          const dir = projectDir();
          return [userFile, ...(dir ? [files().project ?? join(dir, PROJECT_FILE_NAME)] : []), ...jsoncFiles(themes)];
        },
        onChange: () => void store.reload(),
      });
      return watcher;
    },
    dispose() {
      watcher?.close();
      watcher = null;
      listeners.clear();
    },
  };
  return store;
}
