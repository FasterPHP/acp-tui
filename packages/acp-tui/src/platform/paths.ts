// Where acp-tui keeps its files on each platform, and a path containment test that compares paths
// the way the platform's file system does (specs tui-config "Configuration file" and
// "Configuration locations on Windows", tui-sessions "Session index" and "State location on
// Windows").
//
// - Configuration (`config.jsonc`, `themes/`): `$XDG_CONFIG_HOME/acp-tui` when XDG_CONFIG_HOME is
//   set and absolute; otherwise `~/.config/acp-tui` on Linux and macOS, and `%APPDATA%\acp-tui`
//   (roaming, so it follows the user between machines) on Windows.
// - State (the session index, the title slots): `$XDG_STATE_HOME/acp-tui` when XDG_STATE_HOME is
//   set and absolute; otherwise `~/.local/state/acp-tui`, and `%LOCALAPPDATA%\acp-tui` (this
//   machine only) on Windows.
//
// Every function takes the environment and the platform, so tests can ask for Windows paths on
// Linux; the paths are built with that platform's rules (`path.win32` or `path.posix`).
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

type PlatformPath = typeof posix;

export type Env = Readonly<Record<string, string | undefined>>;
export type Platform = NodeJS.Platform;

/** acp-tui's own directory below the configuration and state homes. */
export const APP_DIR_NAME = "acp-tui";

/** The path rules of `platform`: `path.win32` on Windows, `path.posix` elsewhere. */
export function pathsFor(platform: Platform = process.platform): PlatformPath {
  return platform === "win32" ? win32 : posix;
}

/** The user's profile on Windows: `USERPROFILE` when it is absolute, else the system's home. */
export function windowsProfile(env: Env = process.env): string {
  const profile = env["USERPROFILE"];
  return profile && win32.isAbsolute(profile) ? profile : homedir();
}

/**
 * The user's home directory, as the chrome shows it with `~`. On Windows the profile
 * (`USERPROFILE`, else the system's home), never `HOME`, which Git Bash and MSYS set to a POSIX
 * path (`/c/Users/u`) that no Windows path starts with; elsewhere `HOME`, else the system's home.
 */
export function userHome(env: Env = process.env, platform: Platform = process.platform): string {
  return platform === "win32" ? windowsProfile(env) : env["HOME"] || homedir();
}

/**
 * The last component of a path (a directory's name, a command's file name), whichever separator
 * it uses on `platform` (`/` and `\` on Windows). A path with no component (a root) comes back as
 * its root, so a name is never empty.
 */
export function baseName(path: string, platform: Platform = process.platform): string {
  const rules = pathsFor(platform);
  return rules.basename(path) || rules.parse(path).root || path;
}

/** A Windows known folder from its variable (`APPDATA`), else its usual place in the profile. */
function windowsFolder(env: Env, variable: string, inProfile: readonly string[]): string {
  const value = env[variable];
  return value && win32.isAbsolute(value) ? value : win32.join(windowsProfile(env), ...inProfile);
}

/** The XDG variable's value when it is set and absolute, else null. */
function xdg(env: Env, variable: string, platform: Platform): string | null {
  const value = env[variable];
  return value && pathsFor(platform).isAbsolute(value) ? value : null;
}

/** `$XDG_CONFIG_HOME`; else `~/.config` (`HOME`, else the system's home), or `%APPDATA%` on Windows. */
export function configHome(env: Env = process.env, platform: Platform = process.platform): string {
  const set = xdg(env, "XDG_CONFIG_HOME", platform);
  if (set !== null) return set;
  if (platform === "win32") return windowsFolder(env, "APPDATA", ["AppData", "Roaming"]);
  return posix.join(env["HOME"] || homedir(), ".config");
}

/** `$XDG_STATE_HOME`; else `~/.local/state`, or `%LOCALAPPDATA%` on Windows. */
export function stateHome(env: Env = process.env, platform: Platform = process.platform): string {
  const set = xdg(env, "XDG_STATE_HOME", platform);
  if (set !== null) return set;
  if (platform === "win32") return windowsFolder(env, "LOCALAPPDATA", ["AppData", "Local"]);
  return posix.join(env["HOME"] || homedir(), ".local", "state");
}

/** acp-tui's configuration directory: `acp-tui` in the configuration home. */
export function configDirectory(env: Env = process.env, platform: Platform = process.platform): string {
  return pathsFor(platform).join(configHome(env, platform), APP_DIR_NAME);
}

/** `%APPDATA%\acp-tui`, the Windows default configuration directory whether or not
 *  XDG_CONFIG_HOME overrides it (corporate folder redirection can put it outside the profile). */
export function appDataConfigDirectory(env: Env = process.env): string {
  return win32.join(windowsFolder(env, "APPDATA", ["AppData", "Roaming"]), APP_DIR_NAME);
}

/** acp-tui's state directory: `acp-tui` in the state home. */
export function stateDirectory(env: Env = process.env, platform: Platform = process.platform): string {
  return pathsFor(platform).join(stateHome(env, platform), APP_DIR_NAME);
}

/** A Windows path for comparison: normalised (either separator), upper case, no trailing
 *  separator except a root's own (`C:\`, `\\server\share\`). */
function windowsKey(path: string): string {
  const normal = win32.normalize(path).toUpperCase();
  const root = win32.parse(normal).root;
  return normal.length > root.length && normal.endsWith("\\") ? normal.slice(0, -1) : normal;
}

/**
 * Whether `path` is `ancestor` or below it; both absolute. On Windows, as its file systems do,
 * case is ignored and `/` and `\` are the same separator; elsewhere the comparison is exact.
 */
export function pathWithin(path: string, ancestor: string, platform: Platform = process.platform): boolean {
  if (platform !== "win32") return path === ancestor || path.startsWith(ancestor.endsWith("/") ? ancestor : `${ancestor}/`);
  const child = windowsKey(path);
  const parent = windowsKey(ancestor);
  return child === parent || child.startsWith(parent.endsWith("\\") ? parent : `${parent}\\`);
}
