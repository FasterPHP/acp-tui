// Additional directories in the configuration (harness-feedback; spec tui-config "Additional
// directories setting" and "Additional directories in a project file"): each file's entries are
// resolved when that file is loaded, so the effective list holds absolute, real paths.
//
// - `~` and `~/` stand for the home directory; a relative path is resolved against the directory of
//   the file that names it (the project root for `.acp-tui.jsonc`, the configuration directory for
//   the user's file); the result is made real (symlinks resolved).
// - An entry that is not an existing directory is a warning and is left out.
// - A project file is a file in a repository the user may have just cloned, and a directory added
//   to a session widens what the agent reads (Auggie indexes it), so its entries are limited: each
//   must lie below the parent of the project root (a sibling of the project, or inside it), must
//   not be the home directory or one of its ancestors, and must have no path component starting
//   with `.` below that parent. The limits are checked on the path as written and again on the real
//   path, so a symlink cannot lead out of them. A refused entry is a problem and is ignored.
import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathWithin, type Platform } from "../platform/paths.ts";
import type { ConfigSourceKind } from "./load.ts";

/** Something wrong with one entry: its index in the file's array, how serious, and the message
 *  (which follows the entry's place, as the other problems do). */
export interface DirectoryProblem {
  readonly index: number;
  readonly severity: "warning" | "error";
  readonly message: string;
}

export interface DirectoryResolution {
  /** The accepted entries as absolute real paths, in order, without repeats. */
  readonly directories: readonly string[];
  readonly problems: readonly DirectoryProblem[];
}

export interface ResolveDirectoriesOptions {
  readonly file: string;
  readonly kind: ConfigSourceKind;
  /** The user's home directory (`~`, and the project-file limit). */
  readonly home: string;
  readonly platform?: Platform;
}

const real = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** `entry` as an absolute path, not yet checked to exist: `~` expanded, a relative path taken from `base`. */
export function absoluteEntry(entry: string, base: string, home: string): string {
  if (entry === "~") return home;
  if (entry.startsWith("~/") || entry.startsWith("~\\")) return join(home, entry.slice(2));
  return isAbsolute(entry) ? resolve(entry) : resolve(base, entry);
}

/** Why a project file may not add `path` (already absolute), or null. `parent` is the parent of
 *  the project root and `home` the home directory, both real paths. */
function projectRefusal(path: string, parent: string, home: string, platform: Platform): string | null {
  if (pathWithin(home, path, platform)) return "is the home directory or one of its ancestors";
  // The parent itself (compared as the platform does: on Windows, whatever the case) is refused too.
  if (!pathWithin(path, parent, platform) || pathWithin(parent, path, platform)) return `is not inside ${parent}, the parent of the project's directory`;
  const hidden = relative(parent, path).split(sep).find((part) => part.startsWith("."));
  if (hidden !== undefined) return `has a component starting with ".": ${hidden}`;
  return null;
}

/** Resolves one file's `additional_directories` entries. */
export function resolveDirectories(entries: readonly string[], options: ResolveDirectoriesOptions): DirectoryResolution {
  const platform = options.platform ?? process.platform;
  const fileDirectory = resolve(dirname(options.file));
  const isProject = options.kind === "project";
  // The parent of the project root, as written and as it really is (the project may be reached
  // through a symlink).
  const writtenParent = dirname(fileDirectory);
  const realParent = dirname(real(fileDirectory));
  const home = real(options.home);
  const directories: string[] = [];
  const problems: DirectoryProblem[] = [];
  entries.forEach((entry, index) => {
    const written = absoluteEntry(entry, fileDirectory, options.home);
    const refuse = (reason: string): void => {
      problems.push({ index, severity: "error", message: `is not allowed in a project file (${reason}) and is ignored` });
    };
    if (isProject) {
      const reason = projectRefusal(written, writtenParent, home, platform);
      if (reason !== null) return refuse(`it ${reason}`);
    }
    if (!existsSync(written) || !isDirectory(written)) {
      problems.push({ index, severity: "warning", message: "is not a directory and is left out" });
      return;
    }
    const target = real(written);
    if (isProject) {
      const reason = projectRefusal(target, realParent, home, platform);
      if (reason !== null) return refuse(`it resolves to ${target}, which ${reason}`);
    }
    if (!directories.includes(target)) directories.push(target);
  });
  return { directories, problems };
}

/** The union of the user's and the project's directories: the user's first, then the project's,
 *  without repeats (the one setting merged this way rather than replaced). */
export function unionDirectories(user: unknown, project: unknown): string[] {
  const out: string[] = [];
  for (const list of [user, project]) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) if (typeof entry === "string" && !out.includes(entry)) out.push(entry);
  }
  return out;
}

/** `directories` without the session directory itself and without repeats. */
export function withoutSessionDirectory(directories: readonly string[], sessionDirectory: string): readonly string[] {
  const session = real(sessionDirectory);
  const out: string[] = [];
  for (const directory of directories) {
    if (directory === sessionDirectory || real(directory) === session || out.includes(directory)) continue;
    out.push(directory);
  }
  return out;
}
