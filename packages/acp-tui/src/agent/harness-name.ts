// How an ad hoc harness command is named where a name is displayed (the splash's identity row, the
// "is still starting" notices, the session list's footer): the command's last path component. On
// Windows both separators split it, and a `.cmd`, `.bat` or `.exe` extension (any case) is dropped,
// since a colleague types `auggie` and the file is `auggie.cmd` (windows-support "Decisions during
// apply"). Elsewhere the name is what it always was: the part after the last `/`.
import type { Platform } from "../platform/paths.ts";
import { commandBaseName, programHints, programOf } from "./hints.ts";

const WINDOWS_EXECUTABLE = /\.(?:cmd|bat|exe)$/i;

/** The display name of an ad hoc harness `command` (its first word, a path or a bare name). */
export function commandDisplayName(command: string, platform: Platform = process.platform): string {
  if (platform !== "win32") return command.split("/").filter((part) => part !== "").at(-1) ?? command;
  const last = command.split(/[\\/]/).filter((part) => part !== "").at(-1) ?? command;
  const bare = last.replace(WINDOWS_EXECUTABLE, "");
  return bare === "" ? last : bare;
}

/** Programs that run a script or package named by their arguments. */
const RUNNERS = new Set(["bun", "bunx", "node", "npx", "deno"]);
/** Subcommands a runner takes before the script (`bun run x.ts`, `deno run x.ts`). */
const RUNNER_SUBCOMMANDS = new Set(["run", "x", "exec"]);

/** A script or package argument as a name: its last path component without a version suffix
 *  (`pkg@1.2.3`) and a file extension (`main.ts`). */
function scriptName(argument: string, platform: Platform): string {
  const last = argument.split(platform === "win32" ? /[\\/]/ : /\//).filter((part) => part !== "").at(-1) ?? argument;
  const unversioned = last.replace(/(?<=.)@[^@]*$/, "");
  const bare = unversioned.replace(/\.[A-Za-z0-9]+$/, "");
  return bare === "" ? unversioned : bare;
}

/**
 * The short name of an ad hoc harness `argv` for the session list (auggie-1x-support D15): the
 * program table's short name when acp-tui knows the program (`claude` for the Claude adapter,
 * even through `bunx`), else for a runner the name of its first argument that is not an option,
 * else the command's display name.
 */
export function shortHarnessName(argv: readonly string[], platform: Platform = process.platform): string {
  const command = argv[0];
  if (command === undefined) return "";
  const args = argv.slice(1);
  const known = programHints(platform)[programOf(command, args, platform)]?.shortName;
  if (known !== undefined) return known;
  if (RUNNERS.has(commandBaseName(command, platform))) {
    const operands = args.filter((arg) => !arg.startsWith("-"));
    const script = operands.length > 1 && RUNNER_SUBCOMMANDS.has(operands[0]!) ? operands[1] : operands[0];
    if (script !== undefined) return scriptName(script, platform);
  }
  return commandDisplayName(command, platform);
}
