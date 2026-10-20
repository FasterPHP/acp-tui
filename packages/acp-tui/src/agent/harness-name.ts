// How an ad hoc harness command is named where a name is displayed (the splash's identity row, the
// "is still starting" notices, the session list's footer): the command's last path component. On
// Windows both separators split it, and a `.cmd`, `.bat` or `.exe` extension (any case) is dropped,
// since a colleague types `auggie` and the file is `auggie.cmd` (windows-support "Decisions during
// apply"). Elsewhere the name is what it always was: the part after the last `/`.
import type { Platform } from "../platform/paths.ts";

const WINDOWS_EXECUTABLE = /\.(?:cmd|bat|exe)$/i;

/** The display name of an ad hoc harness `command` (its first word, a path or a bare name). */
export function commandDisplayName(command: string, platform: Platform = process.platform): string {
  if (platform !== "win32") return command.split("/").filter((part) => part !== "").at(-1) ?? command;
  const last = command.split(/[\\/]/).filter((part) => part !== "").at(-1) ?? command;
  const bare = last.replace(WINDOWS_EXECUTABLE, "");
  return bare === "" ? last : bare;
}
