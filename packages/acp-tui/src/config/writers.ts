// Whether another user could have written the user's configuration file, in which case its
// harness commands (`agent_servers`) are refused (spec tui-config "Agents in the configuration"
// and "Harness file writers on Windows").
//
// - Linux and macOS: the file or its directory is writable by group or others, or either is
//   owned by another user.
// - Windows, where every writable file reports mode 0666 and the mode says nothing: the file and
//   its directory must lie in the user's profile or in XDG_CONFIG_HOME, and each must be owned by
//   the current user, the Administrators group (the owner of what an elevated user creates) or
//   SYSTEM (the owner of the profile directory itself). The owners come from the Win32 API
//   (platform/windows-owner.ts, loaded on Windows only); tests inject the lookup. When the lookup
//   fails, the file is taken to be the user's own and a `config_owner_unknown` event goes to the
//   debug log: a machine where the call fails is not left without its harnesses.
import { statSync } from "node:fs";
import { dirname, win32 } from "node:path";
import { createDebugLogger, type DebugLogEntry } from "../log.ts";
import { pathWithin, windowsProfile, type Env, type Platform } from "../platform/paths.ts";

/** The Administrators group, `BUILTIN\Administrators`. */
export const ADMINISTRATORS_SID = "S-1-5-32-544";
/** The local system account, `NT AUTHORITY\SYSTEM`. */
export const SYSTEM_SID = "S-1-5-18";

/** Owners read from Windows (platform/windows-owner.ts), or a test's stand-in. */
export interface WindowsOwnerLookup {
  /** The current user's SID as a string (`S-1-5-21-...`); throws when it cannot be read. */
  currentUserSid(): string;
  /** The SID of the owner of a file or directory; throws when it cannot be read. */
  ownerSid(path: string): string;
  /** An account's name (`DOMAIN\user`) for a problem message, or null when unknown. */
  accountName(sid: string): string | null;
}

export interface WriterCheckOptions {
  /** Default `process.platform`. */
  readonly platform?: Platform;
  /** Where USERPROFILE and XDG_CONFIG_HOME come from (Windows); default `process.env`. */
  readonly env?: Env;
  /** Windows: the owner lookup; default the Win32 API, loaded on the first Windows check. */
  readonly ownerLookup?: () => WindowsOwnerLookup;
  /** Windows: where a failed owner lookup is recorded; default the debug log (`ACP_TUI_LOG`). */
  readonly log?: (entry: DebugLogEntry) => void;
  /** Linux and macOS: the user's ID; default `process.getuid()`. */
  readonly uid?: number | null;
}

/** Why `path` (a file or directory) could have been written by another user (POSIX), or null. */
function posixProblem(path: string, what: string, uid: number | null): string | null {
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

let win32Lookup: WindowsOwnerLookup | null = null;

/** The Win32 lookup, required (not imported) so that only Windows loads `bun:ffi`. */
function defaultOwnerLookup(): WindowsOwnerLookup {
  if (win32Lookup === null) {
    const module = require("../platform/windows-owner.ts") as typeof import("../platform/windows-owner.ts");
    win32Lookup = module.windowsOwnerLookup();
  }
  return win32Lookup;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Why the user's file at `file` could have been written by another user (Windows), or null. */
function windowsProblem(file: string, options: WriterCheckOptions): string | null {
  const env = options.env ?? process.env;
  const profile = windowsProfile(env);
  const xdgValue = env["XDG_CONFIG_HOME"];
  const xdg = xdgValue && win32.isAbsolute(xdgValue) ? xdgValue : null;
  const roots = xdg === null ? [profile] : [profile, xdg];
  const paths: readonly (readonly [string, string])[] = [
    [file, "the file"],
    [win32.dirname(file), "the directory"],
  ];
  for (const [path, what] of paths) {
    if (!roots.some((root) => pathWithin(path, root, "win32"))) {
      return `${what} ${path} is outside your profile ${profile}${xdg === null ? "" : ` and XDG_CONFIG_HOME ${xdg}`}`;
    }
  }
  const log = options.log ?? ((entry: DebugLogEntry) => createDebugLogger(process.env["ACP_TUI_LOG"]).log(entry));
  let lookup: WindowsOwnerLookup;
  let user: string;
  try {
    lookup = (options.ownerLookup ?? defaultOwnerLookup)();
    user = lookup.currentUserSid();
  } catch (error) {
    log({ event: "config_owner_unknown", path: file, step: "user", error: messageOf(error) });
    return null;
  }
  const accepted = new Set([user.toUpperCase(), ADMINISTRATORS_SID, SYSTEM_SID]);
  for (const [path, what] of paths) {
    let owner: string;
    try {
      owner = lookup.ownerSid(path);
    } catch (error) {
      log({ event: "config_owner_unknown", path, step: "owner", error: messageOf(error) });
      continue;
    }
    if (accepted.has(owner.toUpperCase())) continue;
    const name = lookup.accountName(owner);
    return `${what} ${path} is owned by ${name === null ? owner : `${name} (${owner})`}, not by you, Administrators or SYSTEM`;
  }
  return null;
}

/**
 * Why the user's configuration file `file` (which exists) could have been written by another
 * user, so that its harness commands are refused, or null when only the user could have.
 */
export function writersProblem(file: string, options: WriterCheckOptions = {}): string | null {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") return windowsProblem(file, options);
  const uid = options.uid !== undefined ? options.uid : typeof process.getuid === "function" ? process.getuid() : null;
  return posixProblem(file, "the file", uid) ?? posixProblem(dirname(file), "the directory", uid);
}
