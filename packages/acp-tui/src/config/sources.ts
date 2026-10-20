// Where the configuration comes from (mvp-configuration design D4; spec
// tui-config "Configuration file", "Per-project file" and "Configuration
// locations on Windows"):
//
// - The user's file: `$XDG_CONFIG_HOME/acp-tui/config.jsonc`, or
//   `~/.config/acp-tui/config.jsonc` when XDG_CONFIG_HOME is unset or not
//   absolute (`%APPDATA%\acp-tui\config.jsonc` on Windows; platform/paths.ts);
//   themes in `themes/` beside it.
// - The project file: the nearest `.acp-tui.jsonc` from the session directory
//   upwards to the root of the git work tree holding it (found by walking for
//   `.git`, a directory or a file, with no `git` process), or only the session
//   directory outside a work tree, and never a directory above the user's home.
//   One file only: files do not stack.
//
// Reading the user's file also says whether another user could have written it
// (config/writers.ts: on Linux and macOS the file or its directory writable by
// group or others, or either owned by someone else; on Windows their owner and
// location), in which case its agent commands are refused (spec tui-config
// "Agents in the configuration", "Harness file writers on Windows").
//
// A UTF-8 byte order mark at the start of a file is dropped when it is read
// (spec tui-config "Byte order mark ignored"), so the user's file, a project
// file and a theme file read the same with or without one.
import { readFileSync, statSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { configDirectory as platformConfigDirectory, pathsFor, pathWithin, userHome, type Env, type Platform } from "../platform/paths.ts";
import { writersProblem, type WriterCheckOptions } from "./writers.ts";

export type { Env };

export const CONFIG_FILE_NAME = "config.jsonc";
export const PROJECT_FILE_NAME = ".acp-tui.jsonc";
export const THEMES_DIR_NAME = "themes";

/** The user's home directory: `HOME`, else the system's (on Windows the profile, never `HOME`). */
export function homeDirectory(env: Env = process.env): string {
  return userHome(env);
}

/** `$XDG_CONFIG_HOME/acp-tui`, or `~/.config/acp-tui` when XDG_CONFIG_HOME is unset or not absolute
 *  (`%APPDATA%\acp-tui` on Windows). */
export function configDirectory(env: Env = process.env, platform: Platform = process.platform): string {
  return platformConfigDirectory(env, platform);
}

/** The user's configuration file. */
export function userConfigFile(env: Env = process.env, platform: Platform = process.platform): string {
  return pathsFor(platform).join(configDirectory(env, platform), CONFIG_FILE_NAME);
}

/** The themes directory, `themes/` in the configuration directory. */
export function themesDirectory(env: Env = process.env, platform: Platform = process.platform): string {
  return pathsFor(platform).join(configDirectory(env, platform), THEMES_DIR_NAME);
}

/** `text` without a leading byte order mark (U+FEFF), which editors on Windows often write. */
export function withoutBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

const exists = (path: string): boolean => {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
};

/** Whether `dir` is `ancestor` or below it (on Windows ignoring case and the kind of separator). */
export function within(dir: string, ancestor: string, platform: Platform = process.platform): boolean {
  return pathWithin(dir, ancestor, platform);
}

/**
 * The project file for a session directory (design D4), or null. `home` bounds the search: no
 * directory that is a proper ancestor of it is read.
 */
export function findProjectFile(sessionDirectory: string, options: { home?: string } = {}): string | null {
  const start = resolve(sessionDirectory);
  const home = resolve(options.home ?? homeDirectory());
  const aboveHome = (dir: string) => within(home, dir) && !within(dir, home);
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

/** How `readConfigFile` reads: `checkWriters` (the user's file) also checks who could write it,
 *  with the writer check's options (tests inject the platform and the owner lookup). */
export interface ReadOptions extends WriterCheckOptions {
  readonly checkWriters?: boolean;
}

/** Reads a configuration file, dropping a leading byte order mark. */
export function readConfigFile(path: string, options: ReadOptions = {}): FileRead {
  let text: string | null;
  let error: string | null = null;
  try {
    text = withoutBom(readFileSync(path, "utf8"));
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    text = null;
    if (code !== "ENOENT" && code !== "ENOTDIR") error = code ?? "error";
  }
  const unsafe = options.checkWriters && text !== null ? writersProblem(path, options) : null;
  return { text, unsafe, error };
}
