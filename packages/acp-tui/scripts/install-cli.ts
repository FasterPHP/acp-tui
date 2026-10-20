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
// The stub part imports only Node and Bun built-ins. The configuration part imports the package's
// configuration modules when it runs, so they need the checkout's dependencies (`bun install`).
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
import { delimiter, dirname, join, resolve } from "node:path";

/** The second line of every stub this script writes; what makes a file "its own". */
export const MARKER = "# acp-tui-install-cli: written by `bun run install-cli`; rerun it to repoint, do not edit.";

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

export type Ownership = "stub" | "phase-1a" | "foreign";

/** Whose file this is, judged from its first two lines. */
export function classify(content: string): Ownership {
  const [first, second] = content.split("\n", 2);
  if (first === "#!/bin/sh" && second === MARKER) return "stub";
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

function parse(argv: readonly string[], home: string): Parsed {
  const parsed: Parsed = { dir: join(home, ".local/bin"), force: false, uninstall: false, help: false };
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

It also creates your configuration file, $XDG_CONFIG_HOME/acp-tui/config.jsonc (else
~/.config/acp-tui/config.jsonc), with every setting commented at its default, when there is
none. An existing configuration is never replaced, not even with --force, and --uninstall
leaves it alone.
`;

function lstatOrNull(path: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

function onPath(dir: string, pathVariable: string | undefined): boolean {
  const wanted = safeRealpath(dir);
  return (pathVariable ?? "")
    .split(delimiter)
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

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

/** Runs the installer; resolves to the process exit code. */
export async function main(
  argv: readonly string[],
  io: Io = { stdout: (t) => void process.stdout.write(t), stderr: (t) => void process.stderr.write(t) },
  env: Record<string, string | undefined> = process.env,
): Promise<number> {
  let parsed: Parsed;
  try {
    parsed = parse(argv, env["HOME"] || homedir());
  } catch (error) {
    io.stderr(`install-cli: ${error instanceof Error ? error.message : String(error)}\n\n${HELP}`);
    return 2;
  }
  if (parsed.help) {
    io.stdout(HELP);
    return 0;
  }

  const target = join(parsed.dir, "acp-tui");
  const existing = lstatOrNull(target);

  if (parsed.uninstall) {
    // The configuration is the user's and stays (tui-config "Installed command"); nothing here
    // reads or names it.
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
  if (!existsSync(join(root, LAUNCHER_RELATIVE))) {
    io.stderr(`install-cli: ${join(root, LAUNCHER_RELATIVE)} does not exist; is this a complete acp-tui checkout?\n`);
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
  writeFileSync(temporary, renderStub(root));
  chmodSync(temporary, 0o755);
  renameSync(temporary, target);

  const what = replaced === "phase-1a" ? " (replacing the phase-1a launcher)" : replaced === "foreign" ? " (forced)" : "";
  io.stdout(`install-cli: installed ${target}${what}, running ${join(root, LAUNCHER_RELATIVE)}\n`);
  if (!onPath(parsed.dir, env["PATH"])) {
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
  return 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
