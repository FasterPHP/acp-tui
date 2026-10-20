// Where the configuration comes from (mvp-configuration design D4; spec
// tui-config "Configuration file" and "Per-project file"):
//
// - The user's file: `$XDG_CONFIG_HOME/acp-tui/config.jsonc`, or
//   `~/.config/acp-tui/config.jsonc` when XDG_CONFIG_HOME is unset or not
//   absolute; themes in `themes/` beside it.
// - The project file: the nearest `.acp-tui.jsonc` from the session directory
//   upwards to the root of the git work tree holding it (found by walking for
//   `.git`, a directory or a file, with no `git` process), or only the session
//   directory outside a work tree, and never a directory above the user's home.
//   One file only: files do not stack.
//
// Reading the user's file also says whether another user could have written it
// (the file or its directory writable by group or others, or either owned by
// someone else), in which case its agent commands are refused (spec tui-config
// "Agents in the configuration").
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, parse, resolve, sep } from "node:path";

export type Env = Readonly<Record<string, string | undefined>>;

export const CONFIG_FILE_NAME = "config.jsonc";
export const PROJECT_FILE_NAME = ".acp-tui.jsonc";
export const THEMES_DIR_NAME = "themes";

/** The user's home directory, from `HOME`, else the system's. */
export function homeDirectory(env: Env = process.env): string {
  return env["HOME"] || homedir();
}

/** `$XDG_CONFIG_HOME/acp-tui`, or `~/.config/acp-tui` when XDG_CONFIG_HOME is unset or not absolute. */
export function configDirectory(env: Env = process.env): string {
  const xdg = env["XDG_CONFIG_HOME"];
  const base = xdg && isAbsolute(xdg) ? xdg : join(homeDirectory(env), ".config");
  return join(base, "acp-tui");
}

/** The user's configuration file. */
export function userConfigFile(env: Env = process.env): string {
  return join(configDirectory(env), CONFIG_FILE_NAME);
}

/** The themes directory, `themes/` in the configuration directory. */
export function themesDirectory(env: Env = process.env): string {
  return join(configDirectory(env), THEMES_DIR_NAME);
}

const exists = (path: string): boolean => {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
};

/** Whether `dir` is `ancestor` or below it. */
function within(dir: string, ancestor: string): boolean {
  return dir === ancestor || dir.startsWith(ancestor.endsWith(sep) ? ancestor : ancestor + sep);
}

/**
 * The project file for a session directory (design D4), or null. `home` bounds the search: no
 * directory that is a proper ancestor of it is read.
 */
export function findProjectFile(sessionDirectory: string, options: { home?: string } = {}): string | null {
  const start = resolve(sessionDirectory);
  const home = resolve(options.home ?? homeDirectory());
  const aboveHome = (dir: string) => within(home, dir) && dir !== home;
  // The directories from the session directory up to the work tree root, nearest first (the walk
  // for `.git` may pass the home directory; no file above it is read).
  const chain: string[] = [];
  let root: string | null = null;
  for (let dir = start; ; dir = dirname(dir)) {
    chain.push(dir);
    if (exists(join(dir, ".git"))) {
      root = dir;
      break;
    }
    if (dir === parse(dir).root) break;
  }
  const candidates = (root === null ? [start] : chain).filter((dir) => !aboveHome(dir));
  for (const dir of candidates) {
    const file = join(dir, PROJECT_FILE_NAME);
    try {
      if (statSync(file).isFile()) return file;
    } catch {
      // not here
    }
  }
  return null;
}

/** A configuration file read from disk. */
export interface FileRead {
  /** The text, or null when the file does not exist (or could not be read: see `error`). */
  readonly text: string | null;
  /** Why the file is not trusted with agent commands, when another user could have written it. */
  readonly unsafe: string | null;
  /** A read error other than "not found" (`EACCES`, `EISDIR`), when there was one. */
  readonly error: string | null;
}

/** Why `path` (a file or directory) could have been written by another user, or null. */
function writableByOthers(path: string, what: string, uid: number | null): string | null {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return null;
  }
  const mode = (stat.mode & 0o777).toString(8).padStart(4, "0");
  if ((stat.mode & 0o022) !== 0) return `${what} ${path} has mode ${mode}, writable by other users`;
  if (uid !== null && stat.uid !== uid) return `${what} ${path} is owned by another user`;
  return null;
}

/** Reads a configuration file. `checkWriters` (the user's file) also checks who could write it. */
export function readConfigFile(path: string, options: { checkWriters?: boolean } = {}): FileRead {
  let text: string | null;
  let error: string | null = null;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    text = null;
    if (code !== "ENOENT" && code !== "ENOTDIR") error = code ?? "error";
  }
  let unsafe: string | null = null;
  if (options.checkWriters && text !== null) {
    const uid = typeof process.getuid === "function" ? process.getuid() : null;
    unsafe = writableByOthers(path, "the file", uid) ?? writableByOthers(dirname(path), "the directory", uid);
  }
  return { text, unsafe, error };
}
