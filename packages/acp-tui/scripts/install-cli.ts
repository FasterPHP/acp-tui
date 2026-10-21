// `bun run install-cli`: puts an executable `acp-tui` on the PATH (mvp-configuration D15,
// tui-config "Installed command").
//
// What it writes is a small regular file, not a symlink and not a copy of the launcher: a `sh`
// stub that holds this checkout's absolute path and `exec`s the checkout's launcher
// (packages/acp-tui/bin/acp-tui). Because the stub only points at the checkout, `git pull`
// updates the command and nothing needs reinstalling; it is needed again only if the checkout
// moves. A regular file also satisfies the PhpStorm "AI Agents" plugin's resolver.
//
//   bun run install-cli [--dir <path>] [--force]     install (default ~/.local/bin)
//   bun run install-cli --uninstall [--dir <path>]   remove the stub it wrote
//
// It overwrites a file only if the file carries its own marker or is the phase-1a launcher
// (recognised by its header); any other file is kept unless `--force`. `--uninstall` removes
// only a stub carrying the marker. ACP_TUI_ROOT overrides the checkout path when the stub runs.
//
// The install also creates the user's configuration file when there is none (Marcus, 13 October
// 2026; tui-config "Installed command"): the commented default, `commentedDefault()`, the text
// `acp-tui config --print-default` prints, at the path acp-tui reads (`userConfigFile()`:
// `$XDG_CONFIG_HOME/acp-tui/config.jsonc`, else `~/.config/acp-tui/config.jsonc`). Anything
// already at that path is kept, whatever it is (an exclusive create, so not even a dangling
// symlink is written through), and `--force` does not change that: it is about the stub only.
// `--uninstall` leaves the configuration alone.
//
// Every install also writes `config.dist.jsonc` beside the configuration (interface-feedback D4;
// tui-config "Default configuration beside the user's file"): three `//` header lines naming the
// version (from the package's package.json), then the commented default. acp-tui never reads or
// watches it; it is there to compare with `config.jsonc` (or `acp-tui config --diff-default`). It is
// written through a temporary file and `renameOver`; anything at the path that is not a regular
// file is left alone; a failure is a warning and the install still exits 0. `--uninstall` removes
// it only when its first line starts with the header's first words, and leaves `config.jsonc`.
//
// On Windows (design D1 of windows-support; tui-config "Installed command on Windows") the stub is
// `acp-tui.cmd`, written to `%USERPROFILE%\.bun\bin` (which Bun's installer puts on the PATH): cmd
// and PowerShell cannot run an `sh` script. It runs `src/cli.ts` with the absolute path of the Bun
// that ran the install, and carries the same marker behind `rem`. `--uninstall` there removes only
// `acp-tui.cmd` with that marker, and leaves an old `sh` stub named `acp-tui` alone.
//
// The stub part imports only Node and Bun built-ins (and two small modules of the package that do
// the same: the platform paths and the PATH lookup helpers). The configuration part imports the
// package's configuration modules when it runs, so they need the checkout's dependencies
// (`bun install`).
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { configDirectory, pathsFor, pathWithin, windowsProfile, type Platform } from "../src/platform/paths.ts";
import { envValue } from "../src/agent/which.ts";
import { renameOver } from "../src/platform/replace-file.ts";

const MARKER_TEXT = "acp-tui-install-cli: written by `bun run install-cli`; rerun it to repoint, do not edit.";

/** The second line of every `sh` stub this script writes; what makes a file "its own". */
export const MARKER = `# ${MARKER_TEXT}`;

/** The second line of the Windows `.cmd` stub: the same marker behind `rem`. */
export const CMD_MARKER = `rem ${MARKER_TEXT}`;

const LAUNCHER_RELATIVE = "packages/acp-tui/bin/acp-tui";

/** The phase-1a launcher's second lines (before mvp-configuration, two header versions). */
const PHASE_1A_HEADERS = [
  "# Launcher for acp-tui: the `acp-tui` command on the PATH and the PhpStorm \"AI Agents\" menu",
  "# Launcher for the PhpStorm \"AI Agents\" menu entry (spike S8).",
];

export function shellQuote(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`;
}

export function renderStub(root: string): string {
  return [
    "#!/bin/sh",
    MARKER,
    `root=\${ACP_TUI_ROOT:-${shellQuote(root)}}`,
    `launcher=$root/${LAUNCHER_RELATIVE}`,
    `[ -x "$launcher" ] || { echo "acp-tui: $launcher was not found (did the checkout move?); rerun 'bun run install-cli' in the checkout" >&2; exit 127; }`,
    `exec "$launcher" "$@"`,
    "",
  ].join("\n");
}

const CLI_RELATIVE_WINDOWS = "packages\\acp-tui\\src\\cli.ts";

/** Text for a batch file's `set "..."` or quoted command: `%` is the one character cmd expands
 *  inside quotes (a path can hold it), doubled to stand for itself. */
function batchQuoted(text: string): string {
  return text.replaceAll("%", "%%");
}

/**
 * The Windows stub (CRLF line endings, which cmd.exe reads most reliably). `bun` is the absolute
 * path of the Bun that ran the install, so nothing in the current directory can stand in for it.
 * The check is a `goto`, not a parenthesised block: a root such as `C:\Program Files (x86)\acp-tui`
 * would close the block early when `%root%` expands inside it. The message is built with delayed
 * expansion, which does not re-read `&` or `)` in the value; it is switched on only there, because
 * with it on the `!` in the user's own arguments would be eaten.
 */
export function renderCmdStub(root: string, bun: string): string {
  return [
    "@echo off",
    CMD_MARKER,
    "setlocal",
    'set "root=%ACP_TUI_ROOT%"',
    `if not defined root set "root=${batchQuoted(root)}"`,
    `if not exist "%root%\\${CLI_RELATIVE_WINDOWS}" goto :missing`,
    `"${batchQuoted(bun)}" "%root%\\${CLI_RELATIVE_WINDOWS}" -- %*`,
    "exit /b %ERRORLEVEL%",
    ":missing",
    "setlocal EnableDelayedExpansion",
    `echo acp-tui: !root!\\${CLI_RELATIVE_WINDOWS} was not found ^(did the checkout move?^); rerun 'bun run install-cli' in the checkout 1>&2`,
    "exit /b 127",
    "",
  ].join("\r\n");
}

export type Ownership = "stub" | "phase-1a" | "foreign";

/** Whose file this is, judged from its first two lines (either line ending). */
export function classify(content: string): Ownership {
  const [first, second] = content.split(/\r?\n/, 2);
  if (first === "#!/bin/sh" && second === MARKER) return "stub";
  if (first === "@echo off" && second === CMD_MARKER) return "stub";
  if (first === "#!/usr/bin/env bash" && second !== undefined && PHASE_1A_HEADERS.some((h) => second.startsWith(h))) {
    return "phase-1a";
  }
  return "foreign";
}

interface Parsed {
  dir: string;
  force: boolean;
  uninstall: boolean;
  help: boolean;
}

/**
 * Where the stub goes by default: `~/.local/bin`, or on Windows Bun's own bin directory,
 * `%USERPROFILE%\\.bun\\bin`, which Bun's installer puts on the user's PATH.
 */
export function defaultDirectory(env: Record<string, string | undefined>, platform: Platform = process.platform): string {
  if (platform === "win32") return pathsFor(platform).join(windowsProfile(env), ".bun", "bin");
  return pathsFor(platform).join(env["HOME"] || homedir(), ".local/bin");
}

function parse(argv: readonly string[], dir: string): Parsed {
  const parsed: Parsed = { dir, force: false, uninstall: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--force") parsed.force = true;
    else if (arg === "--uninstall") parsed.uninstall = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--dir") {
      const value = argv[++i];
      if (value === undefined || value === "") throw new Error("--dir needs a directory");
      parsed.dir = resolve(value);
    } else if (arg.startsWith("--dir=")) parsed.dir = resolve(arg.slice("--dir=".length));
    else throw new Error(`unknown argument ${arg}`);
  }
  return parsed;
}

const HELP = `Usage: bun run install-cli [--dir <path>] [--force]
       bun run install-cli --uninstall [--dir <path>]

Installs an \`acp-tui\` command (default directory ~/.local/bin) that runs this checkout's
launcher. Run it once: a git pull updates the command, and it is needed again only if the
checkout moves. A file it did not write is kept unless --force (the phase-1a launcher is
replaced without it). --uninstall removes only a command this script wrote.

On Windows the command is acp-tui.cmd and the default directory is %USERPROFILE%\\.bun\\bin,
where Bun's installer already put a directory on your PATH.

It also creates your configuration file, $XDG_CONFIG_HOME/acp-tui/config.jsonc (else
~/.config/acp-tui/config.jsonc; on Windows %APPDATA%\\acp-tui\\config.jsonc), with every setting
commented at its default, when there is none. An existing configuration is never replaced, not
even with --force, and --uninstall leaves it alone.

Every install also writes config.dist.jsonc beside it: the default configuration of this
version, never read by acp-tui, for comparison with your config.jsonc (or run
\`acp-tui config --diff-default\`). --uninstall removes it, unless it is not the one this
script wrote.
`;

function lstatOrNull(path: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

/** Whether `dir` is one of the PATH's entries; on Windows the comparison ignores case and the
 *  kind of separator, and an entry may be quoted (`"C:\\tools"`). */
export function onPath(dir: string, pathVariable: string | undefined, platform: Platform = process.platform): boolean {
  if (platform === "win32") {
    const rules = pathsFor(platform);
    const wanted = rules.resolve(dir);
    return (pathVariable ?? "")
      .split(rules.delimiter)
      .map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"))
      .filter(Boolean)
      .map((entry) => rules.resolve(entry))
      .some((entry) => pathWithin(entry, wanted, platform) && pathWithin(wanted, entry, platform));
  }
  const wanted = safeRealpath(dir);
  return (pathVariable ?? "")
    .split(pathsFor(platform).delimiter)
    .filter(Boolean)
    .some((entry) => resolve(entry) === resolve(dir) || safeRealpath(entry) === wanted);
}

function safeRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** The package's configuration modules, imported when needed (see the header). */
async function configModules(): Promise<{
  userConfigFile: (env: Record<string, string | undefined>) => string;
  commentedDefault: () => string;
}> {
  const sources = await import("../src/config/sources.ts");
  const defaults = await import("../src/config/default-file.ts");
  return { userConfigFile: sources.userConfigFile, commentedDefault: defaults.commentedDefault };
}

export type ConfigOutcome = { created: true; file: string } | { created: false; file: string };

/**
 * Creates the user's configuration file with the commented default unless something is already
 * at its path. The directories it makes are owner-only (0700) and so is the file (0600), as for
 * acp-tui's session index: an agent entry's `env` may hold a key, and acp-tui refuses the file's
 * agents when it or its directory is writable by group or others.
 */
export async function createConfiguration(env: Record<string, string | undefined>): Promise<ConfigOutcome> {
  const { userConfigFile, commentedDefault } = await configModules();
  const file = userConfigFile(env);
  if (lstatOrNull(file)) return { created: false, file };
  const dir = dirname(file);
  if (!lstatOrNull(dir)) {
    mkdirSync(dirname(dir), { recursive: true });
    mkdirSync(dir, { mode: 0o700 });
  }
  try {
    // "wx": create only, failing on anything already there (a file, a directory, or a symlink,
    // dangling or not), so a configuration that appears in the meantime is not replaced either.
    writeFileSync(file, commentedDefault(), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return { created: false, file };
    throw error;
  }
  return { created: true, file };
}

export const DIST_FILE_NAME = "config.dist.jsonc";

/** The first words of the dist file's first line; what makes the file this script's own. */
export const DIST_HEADER_START = "// The default configuration of acp-tui ";

/** The dist file's path: beside the user's configuration file. */
export function distConfigurationFile(env: Record<string, string | undefined>, platform: Platform = process.platform): string {
  return pathsFor(platform).join(configDirectory(env, platform), DIST_FILE_NAME);
}

function packageVersion(): string {
  const text = readFileSync(join(import.meta.dir, "../package.json"), "utf8");
  return (JSON.parse(text) as { version: string }).version;
}

/** The dist file's whole text: three comment lines naming the version, then the commented default. */
export function distContent(version: string, commentedDefault: string): string {
  return [
    `${DIST_HEADER_START}${version}, written by install-cli on every install.`,
    "// It is never read. Compare it with config.jsonc to see new and changed settings",
    "// (or run acp-tui config --diff-default).",
    "",
  ].join("\n") + commentedDefault;
}

/**
 * Writes the dist file at `file` (design D4): a temporary file beside it (0600), then a rename over
 * the old one. Returns the line to print; anything wrong is a warning line instead, never a throw.
 */
export async function writeDistConfiguration(file: string): Promise<{ stdout?: string; stderr?: string }> {
  const warn = (reason: string) => ({ stderr: `install-cli: warning: could not write ${file}: ${reason}\n` });
  const temporary = join(dirname(file), `.${DIST_FILE_NAME}.${process.pid}.tmp`);
  try {
    const existing = lstatOrNull(file);
    if (existing && !existing.isFile()) return warn("it is not a regular file; left alone");
    const { commentedDefault } = await configModules();
    writeFileSync(temporary, distContent(packageVersion(), commentedDefault()), { flag: "w", mode: 0o600 });
    renameOver(temporary, file);
  } catch (error) {
    rmSync(temporary, { force: true });
    return warn(error instanceof Error ? error.message : String(error));
  }
  return { stdout: `install-cli: wrote ${file}, the default configuration of this version, for comparison with your configuration\n` };
}

/** Removes the dist file when it is the one this script wrote (its first line starts as the header does). */
function removeDistConfiguration(file: string, io: Io): void {
  try {
    const existing = lstatOrNull(file);
    if (!existing || !existing.isFile()) return;
    if (!readFileSync(file, "utf8").split(/\r?\n/, 1)[0]!.startsWith(DIST_HEADER_START)) return;
    rmSync(file);
    io.stdout(`install-cli: removed ${file}\n`);
  } catch (error) {
    io.stderr(`install-cli: warning: could not remove ${file}: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

/** Runs the installer; resolves to the process exit code. */
export async function main(
  argv: readonly string[],
  io: Io = { stdout: (t) => void process.stdout.write(t), stderr: (t) => void process.stderr.write(t) },
  env: Record<string, string | undefined> = process.env,
  platform: Platform = process.platform,
): Promise<number> {
  const windows = platform === "win32";
  let parsed: Parsed;
  try {
    parsed = parse(argv, defaultDirectory(env, platform));
  } catch (error) {
    io.stderr(`install-cli: ${error instanceof Error ? error.message : String(error)}\n\n${HELP}`);
    return 2;
  }
  if (parsed.help) {
    io.stdout(HELP);
    return 0;
  }

  // On Windows an old `sh` stub named `acp-tui` (from before this script wrote `.cmd` files) is a
  // different file and is never touched.
  const target = join(parsed.dir, windows ? "acp-tui.cmd" : "acp-tui");
  const existing = lstatOrNull(target);

  if (parsed.uninstall) {
    // The configuration is the user's and stays (tui-config "Installed command"); nothing here
    // reads or names it. The dist file is this script's own, and goes whatever the command's state.
    // (Like createConfiguration, it follows the running platform: `platform` is for the stub only.)
    removeDistConfiguration(distConfigurationFile(env), io);
    if (!existing) {
      io.stdout(`install-cli: nothing to remove: ${target} does not exist\n`);
      return 0;
    }
    if (!existing.isFile() || classify(readFileSync(target, "utf8")) !== "stub") {
      io.stderr(`install-cli: ${target} was not written by install-cli; leaving it alone\n`);
      return 1;
    }
    rmSync(target);
    io.stdout(`install-cli: removed ${target}\n`);
    return 0;
  }

  const root = safeRealpath(resolve(import.meta.dir, "../../.."));
  const required = join(root, windows ? "packages/acp-tui/src/cli.ts" : LAUNCHER_RELATIVE);
  if (!existsSync(required)) {
    io.stderr(`install-cli: ${required} does not exist; is this a complete acp-tui checkout?\n`);
    return 1;
  }

  let replaced: Ownership | null = null;
  if (existing) {
    replaced = existing.isFile() ? classify(readFileSync(target, "utf8")) : "foreign";
    if (replaced === "foreign" && !parsed.force) {
      io.stderr(
        `install-cli: ${target} exists and was not written by install-cli or the phase-1a launcher; leaving it alone.\n` +
          `Run \`bun run install-cli --force\` to replace it, or \`--dir <path>\` to install elsewhere.\n`,
      );
      return 1;
    }
  }

  mkdirSync(parsed.dir, { recursive: true });
  // Write beside the target and rename over it, so a running copy is never half-written and a
  // forced replacement of a symlink replaces the link rather than its destination.
  const temporary = join(dirname(target), `.acp-tui.${process.pid}.tmp`);
  writeFileSync(temporary, windows ? renderCmdStub(root, process.execPath) : renderStub(root));
  if (!windows) chmodSync(temporary, 0o755);
  renameSync(temporary, target);

  const what = replaced === "phase-1a" ? " (replacing the phase-1a launcher)" : replaced === "foreign" ? " (forced)" : "";
  io.stdout(
    windows
      ? `install-cli: installed ${target}${what}, running ${required} with ${process.execPath}\n`
      : `install-cli: installed ${target}${what}, running ${required}\n`,
  );
  if (!onPath(parsed.dir, envValue(env, "PATH", platform), platform)) {
    io.stderr(`install-cli: warning: ${parsed.dir} is not on your PATH, so \`acp-tui\` will not be found until you add it\n`);
  }

  let outcome: ConfigOutcome;
  try {
    outcome = await createConfiguration(env);
  } catch (error) {
    io.stderr(
      `install-cli: the command is installed, but the configuration file was not created: ${error instanceof Error ? error.message : String(error)}\n` +
        `Rerun \`bun run install-cli\` once that is fixed, or save the output of \`acp-tui config --print-default\` as your configuration file yourself.\n`,
    );
    return 1;
  }
  io.stdout(
    outcome.created
      ? `install-cli: created ${outcome.file}, every setting commented at its default; edit it to add agents (acp-tui config --check checks it)\n`
      : `install-cli: kept the existing configuration ${outcome.file}\n`,
  );
  const dist = await writeDistConfiguration(join(dirname(outcome.file), DIST_FILE_NAME));
  if (dist.stdout) io.stdout(dist.stdout);
  if (dist.stderr) io.stderr(dist.stderr);
  return 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
