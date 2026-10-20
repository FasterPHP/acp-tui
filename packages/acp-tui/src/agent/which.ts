// Programs resolved from the PATH only (spec tui-agent-session "Programs resolved from the PATH
// only"). Every program acp-tui starts by name (a harness, `git` for the `@` picker, the link
// opener, `taskkill`) goes through `resolveProgram` first and is started by the absolute path it
// returns, with an argument list and never a shell.
//
// Why: on Windows `Bun.spawn(["git", ...], { cwd })` runs `git.cmd` from `cwd` before the `PATH`
// (Windows' search order puts the current directory first), so a cloned repository holding
// `git.cmd` would run it as soon as the `@` picker opened; `Bun.which` does not look there. On
// Linux and macOS a relative `PATH` entry (`.`, or an empty one) does the same: it is read against
// the spawn's `cwd`, the session directory. Here the lookup runs with the user's home directory as
// its `cwd`, so neither the session directory nor acp-tui's own working directory is ever searched.
//
// A command written as a path (`./agent`, `/usr/bin/agent`, and on Windows `C:\tools\agent.cmd`,
// `\\server\share\agent.cmd` or `.\agent`) is used as written: the user chose that file.
import { homedir } from "node:os";

export type Env = Readonly<Record<string, string | undefined>>;

/** `Bun.which`'s shape, so tests can inject a lookup for the other platform. */
export type WhichFunction = (name: string, options: { PATH: string; cwd: string }) => string | null;

export interface ResolveOptions {
  /** The environment whose `PATH` is searched (`Path` too on Windows); default `process.env`. */
  readonly env?: Env;
  /** Default `process.platform`. */
  readonly platform?: NodeJS.Platform;
  /** The directory a relative `PATH` entry is read against; default the user's home. */
  readonly home?: string;
  /** Default `Bun.which`. */
  readonly which?: WhichFunction;
}

/** Whether `command` is written as a path rather than a name to look up: it holds a `/`, and on
 *  Windows also a `\` or starts with a drive letter (`C:`). */
export function isPathCommand(command: string, platform: NodeJS.Platform = process.platform): boolean {
  if (command.includes("/")) return true;
  if (platform !== "win32") return false;
  return command.includes("\\") || /^[A-Za-z]:/.test(command);
}

/** The value of the variable `name` in `env`: on Windows matched case-insensitively (Windows keeps
 *  `Path`), the last matching key winning, as a later key would in the child's environment. */
export function envValue(env: Env, name: string, platform: NodeJS.Platform = process.platform): string | undefined {
  if (platform !== "win32") return env[name];
  const upper = name.toUpperCase();
  let value: string | undefined;
  for (const key of Object.keys(env)) if (key.toUpperCase() === upper && env[key] !== undefined) value = env[key];
  return value;
}

/**
 * The program `command` names, as the absolute path to start: a path is returned as written; a
 * name is looked up on the environment's `PATH` only, with the user's home as the lookup's `cwd`
 * (never the session directory), trying `PATHEXT` on Windows as `Bun.which` does. Null when the
 * name is on no `PATH` entry, or there is no `PATH`.
 */
export function resolveProgram(command: string, options: ResolveOptions = {}): string | null {
  if (command === "") return null;
  const platform = options.platform ?? process.platform;
  if (isPathCommand(command, platform)) return command;
  const PATH = envValue(options.env ?? process.env, "PATH", platform);
  if (!PATH) return null;
  const which = options.which ?? ((name, opts) => Bun.which(name, opts));
  return which(command, { PATH, cwd: options.home ?? homedir() });
}

/** A program name found on no `PATH` entry. The message is the one `Bun.spawn` gives for a missing
 *  program, so what the user reads is as before resolution came first. */
export class ProgramNotFoundError extends Error {
  readonly code = "ENOENT";
  constructor(readonly program: string) {
    super(`Executable not found in $PATH: "${program}"`);
    this.name = "ProgramNotFoundError";
  }
}

/** `argv` with its program resolved by `resolveProgram`, ready for `Bun.spawn`. Throws
 *  `ProgramNotFoundError` (before anything is started) when it resolves to nothing. */
export function resolveArgv(argv: readonly string[], options: ResolveOptions = {}): string[] {
  const [program, ...args] = argv;
  if (program === undefined) throw new ProgramNotFoundError("");
  const path = resolveProgram(program, options);
  if (path === null) throw new ProgramNotFoundError(program);
  return [path, ...args];
}

/** `base` with `entries` set over it, as a harness's environment. On Windows a variable's name is
 *  matched case-insensitively, so an entry `PATH` replaces the base's `Path` instead of adding a
 *  second key whose winner the child would pick; elsewhere names are case-sensitive, as today. */
export function mergeEnvironment(base: Env, entries: Readonly<Record<string, string>>, platform: NodeJS.Platform = process.platform): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = { ...base };
  if (platform === "win32") {
    const names = new Set(Object.keys(entries).map((name) => name.toUpperCase()));
    for (const key of Object.keys(merged)) if (names.has(key.toUpperCase())) delete merged[key];
  }
  return Object.assign(merged, entries);
}
