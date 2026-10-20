// The key map from the configuration's `keys` section, with its problems placed
// in the files (mvp-configuration tasks 8.1 to 8.3): what the app builds at
// start-up and after each reload of `keys` (app/App.tsx, into the store's
// `keys` problem channel), and what `acp-tui config --check` reports
// (`keyCheckProblems`, for all three recorded terminals). Pure apart from
// reading the configuration files to place the problems; no OpenTUI or Solid.
import type { ConfigProblem } from "../config/problems.ts";
import type { KeyMap } from "./keymap.ts";
import { keptKeyCheckWarnings, keptKeyWarnings, keptKeysTerminal, type KeptKeysTerminal } from "./kept.ts";
import { locateProblems, type ProblemFiles, type ReadText } from "./locate.ts";
import { resolveKeyOverrides, type KeysSection } from "./overrides.ts";

/** The store's problem channel for the key map's problems. */
export const KEYS_PROBLEM_CHANNEL = "keys";

export interface KeysFromConfig {
  readonly map: KeyMap;
  readonly problems: readonly ConfigProblem[];
}

export interface KeysFromConfigOptions {
  /** The terminal in use for kept-key warnings; default detected from `process.env`. */
  readonly terminal?: KeptKeysTerminal | null;
  readonly read?: ReadText;
}

/** The key map for the running app, with the override problems and the kept-key warnings for the
 *  terminal in use. */
export function keysFromConfig(section: KeysSection | undefined, files: ProblemFiles, options: KeysFromConfigOptions = {}): KeysFromConfig {
  const resolved = resolveKeyOverrides(section);
  const terminal = options.terminal === undefined ? keptKeysTerminal() : options.terminal;
  const problems = [...resolved.problems, ...keptKeyWarnings(section, resolved.map, terminal)];
  return { map: resolved.map, problems: locateProblems(problems, files, options.read) };
}

/**
 * The key problems `acp-tui config --check` prints (task 9.1 calls this with the effective
 * configuration's `keys` and the files it was loaded from): every rejected override, and the
 * kept-key warnings for PhpStorm's reworked and classic terminals and Zed alike.
 */
export function keyCheckProblems(section: KeysSection | undefined, files: ProblemFiles, read?: ReadText): ConfigProblem[] {
  const resolved = resolveKeyOverrides(section);
  return locateProblems([...resolved.problems, ...keptKeyCheckWarnings(section, resolved.map)], files, read);
}
