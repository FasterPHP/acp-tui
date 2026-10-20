// `acp-tui config` (mvp-configuration task 9.1, design D3 and D16; spec
// tui-config "Configuration problems are visible", "Commented default
// configuration", "Configuration schema", "Configuration paths" and
// "Configuration subcommands on the command line"). Plain text on the main
// screen: no renderer, no alternate screen and no agent.
//
// - `--check`: loads the user's file and the project file of the current
//   directory as acp-tui would at start-up, then adds what only the effective
//   configuration shows: the theme's problems (theme files, the permission
//   card's distinctness, legibility warnings on the recorded palettes;
//   theme/configured.ts `checkTheme`), the key overrides' problems and the
//   kept-key warnings for PhpStorm's two terminals and Zed
//   (keys/from-config.ts `keyCheckProblems`), and glyph overrides that only
//   the merged files leave invalid. Every problem is one line on stdout; exit
//   1 when any is an error, 0 with warnings only (or none).
// - `--print-default`: the commented default (config/default-file.ts).
// - `--print-schema`: the configuration's JSON Schema.
// - `--path`: the user's file, the themes directory and the project file that
//   applies for the current directory, each present or absent.
//
// Like the glyphs subcommand, nothing here loads Solid (the import graph test
// checks the modules it imports).
import { existsSync } from "node:fs";
import { resolveGlyphs } from "./conversation/glyphs.ts";
import { commentedDefault } from "./config/default-file.ts";
import { configJsonSchemaText } from "./config/json-schema.ts";
import { formatProblemWithSeverity, hasErrors, type ConfigProblem } from "./config/problems.ts";
import { readConfiguration, type ConfigurationRead } from "./config/read.ts";
import { type Env } from "./config/sources.ts";
import { keyCheckProblems } from "./keys/from-config.ts";
import { checkTheme } from "./theme/configured.ts";

export interface ConfigCommandIo {
  readonly stdout: { write(text: string): unknown };
  readonly stderr: { write(text: string): unknown };
}

export interface ConfigCommandContext {
  /** The current directory, the session directory for the project file; default `process.cwd()`. */
  readonly cwd?: string;
  /** Where XDG_CONFIG_HOME and HOME come from; default `process.env`. */
  readonly env?: Env;
}

export const CONFIG_HELP = `Usage: acp-tui config --check | --print-default | --print-schema | --path

  --check          Check the configuration: the user's file, the project file
                   for this directory, the theme files the theme names, the key
                   bindings and the glyph overrides. Prints each problem with
                   its file, line and column; exits 1 if any is an error, 0
                   with warnings only.
  --print-default  Print a complete configuration file with every setting at
                   its default and a comment saying what it does.
  --print-schema   Print the configuration file's JSON Schema, for an editor.
  --path           Print where the configuration is read from.
`;

const ACTIONS = ["--check", "--print-default", "--print-schema", "--path"] as const;
type Action = (typeof ACTIONS)[number];

/** Every problem `--check` reports for a configuration read: the loader's, then the theme's, the
 *  keys' and the merged glyph overrides'. */
export function checkProblems(read: ConfigurationRead): ConfigProblem[] {
  const { config, files } = read;
  const glyphs = resolveGlyphs(config.glyphs).problems.map(
    (p): ConfigProblem => ({
      file: files.project ?? files.user,
      line: 1,
      column: 1,
      path: `glyphs.overrides.${p.name}`,
      severity: "warning",
      message: p.message,
      ...(p.suggestion === undefined ? {} : { suggestion: p.suggestion }),
    }),
  );
  return [...read.problems, ...read.notices, ...checkTheme(config, files), ...keyCheckProblems(config.keys, { user: files.user, project: files.project }), ...glyphs];
}

const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

function runCheck(io: ConfigCommandIo, read: ConfigurationRead): number {
  const problems = checkProblems(read);
  if (problems.length === 0) {
    io.stdout.write("no configuration problems\n");
    return 0;
  }
  const errors = problems.filter((p) => p.severity === "error").length;
  const notices = problems.filter((p) => p.severity === "notice").length;
  const lines = problems.map(formatProblemWithSeverity);
  io.stdout.write(`${lines.join("\n")}\n${count(errors, "error")}, ${count(problems.length - errors - notices, "warning")}\n`);
  return hasErrors(problems) ? 1 : 0;
}

function runPath(io: ConfigCommandIo, read: ConfigurationRead, cwd: string): number {
  const state = (present: boolean) => (present ? "present" : "absent");
  const { files, present } = read;
  const project = files.project === null ? `none applies for ${cwd}` : `${files.project} (${state(present.project)})`;
  io.stdout.write(`user file:    ${files.user} (${state(present.user)})\nthemes:       ${files.themes} (${state(existsSync(files.themes))})\nproject file: ${project}\n`);
  return 0;
}

/** Runs `acp-tui config ...`; returns the exit status. */
export async function runConfigCommand(args: readonly string[], io: ConfigCommandIo, context: ConfigCommandContext = {}): Promise<number> {
  const actions: Action[] = [];
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      io.stdout.write(CONFIG_HELP);
      return 0;
    }
    if ((ACTIONS as readonly string[]).includes(arg)) actions.push(arg as Action);
    else {
      io.stderr.write(`acp-tui: config: unknown argument ${arg}\n${CONFIG_HELP}`);
      return 1;
    }
  }
  const unique = [...new Set(actions)];
  if (unique.length !== 1) {
    io.stderr.write(`acp-tui: config: ${unique.length === 0 ? "give one of" : "give only one of"} ${ACTIONS.join(", ")}\n${CONFIG_HELP}`);
    return 1;
  }
  const action = unique[0]!;
  if (action === "--print-default") {
    io.stdout.write(commentedDefault());
    return 0;
  }
  if (action === "--print-schema") {
    io.stdout.write(configJsonSchemaText());
    return 0;
  }
  // A glyph override is measured with OpenTUI's own width function (conversation/glyphs.ts
  // `openTuiCells`, design D9), which loads @opentui/core with `require` when first used; that
  // works only once the module (which has a top-level await) has been evaluated, as it has in the
  // app. Loaded here, before the files are read; no renderer is created.
  await import("@opentui/core");
  const cwd = context.cwd ?? process.cwd();
  const read = readConfiguration({ env: context.env ?? process.env, sessionDirectory: cwd });
  return action === "--check" ? runCheck(io, read) : runPath(io, read, cwd);
}
