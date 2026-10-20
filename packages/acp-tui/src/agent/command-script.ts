// A command script (`.cmd` or `.bat`) whose path holds a space, started on Windows (windows-support
// D5). Bun starts a command script by its path as `cmd.exe /c <path> <arguments>`, quoting the path
// when it holds a space; once any argument is quoted too, cmd.exe drops the first and the last quote
// of the line and reads `C:\Users\First` as the program ("'C:\Users\First' is not recognized"). So a
// harness installed by npm under a profile such as `C:\Users\First Last` failed as soon as one of
// its arguments held a space. Such a script is started here as cmd.exe would want it,
// `cmd.exe /d /v:off /s /c ""<path>" <arguments>"`, with the line passed verbatim. Every other
// program, and every script whose path has no space, is started by Bun as before.
//
// The characters Bun refuses for a command script (`"`, `%`, `&`, `|`, `<`, `>`, `^`, CR and LF:
// cmd.exe would read them) are refused here too, with Bun's own error, so this path is never more
// permissive than Bun's.
import { win32 } from "node:path";
import type { Env } from "./which.ts";

/** What `Bun.spawn` gets: the argument list, and whether it is joined verbatim. */
export interface ScriptSpawn {
  readonly cmd: string[];
  readonly windowsVerbatimArguments?: true;
}

/** The characters Bun 1.4 refuses in the command or an argument of a `.cmd` or `.bat`. */
const REFUSED = /["%&|<>^\r\n]/;

/** Whether `program` names a command script, as Bun decides it (the extension after trailing spaces and dots are trimmed). */
export function isCommandScript(program: string): boolean {
  return /\.(cmd|bat)$/i.test(program.replace(/[ .]+$/, ""));
}

/** One argument as the script's own programs will read it: quoted when it holds a space or a tab
 *  (or is empty), with the backslashes before the closing quote doubled (the C runtime's rule). */
function quote(arg: string): string {
  if (arg !== "" && !/[ \t]/.test(arg)) return arg;
  return `"${arg.replace(/(\\+)$/, "$1$1")}"`;
}

/** The error Bun throws for a refused character, so a message reads the same whichever path started the script. */
function refused(index: number, value: string): Error {
  const message =
    index === 0
      ? `The command name contains a cmd.exe special character and cannot be safely passed to a .bat/.cmd file. Received ${JSON.stringify(value)}`
      : `The argument 'args[${index}]' contains a cmd.exe special character and cannot be safely passed to a .bat/.cmd file. Received ${JSON.stringify(value)}`;
  return Object.assign(new TypeError(message), { code: "ERR_INVALID_ARG_VALUE" });
}

/** The interpreter, from the system directory (never looked up on the `PATH`). */
function commandInterpreter(env: Env): string {
  const root = env["SystemRoot"] ?? env["SYSTEMROOT"] ?? env["windir"] ?? env["WINDIR"] ?? "C:\\Windows";
  return win32.join(root, "System32", "cmd.exe");
}

/** How to start the resolved `argv` (its program an absolute path): as given, except on Windows
 *  for a command script whose path holds a space (above). Throws Bun's `ERR_INVALID_ARG_VALUE`
 *  for a refused character in that case. */
export function scriptSpawn(argv: readonly string[], options: { readonly platform?: NodeJS.Platform; readonly env?: Env } = {}): ScriptSpawn {
  const platform = options.platform ?? process.platform;
  const [program] = argv;
  if (platform !== "win32" || program === undefined || !isCommandScript(program) || !/[ \t]/.test(program)) return { cmd: [...argv] };
  argv.forEach((value, index) => {
    if (REFUSED.test(value)) throw refused(index, value);
  });
  const line = [`"${program}"`, ...argv.slice(1).map(quote)].join(" ");
  return { cmd: [commandInterpreter(options.env ?? process.env), "/d", "/v:off", "/s", "/c", `"${line}"`], windowsVerbatimArguments: true };
}
