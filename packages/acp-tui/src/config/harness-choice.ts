// A choice of harnesses for a new configuration file (install-harness-choice, design D1 and D2):
// which of the default file's agent examples are in effect, and which is `default_agent_server`.
// `bun run install-cli --harness <name>[,<name>...] [--default <name>]` builds one and hands it to
// `commentedDefault` (default-file.ts), which renders the same file as `acp-tui config
// --print-default` with those entries uncommented. Kept apart from install-cli so a later setup
// command (detection on the PATH, a checklist, `acp-tui setup`) can build the same choice its own
// way and render it with the same code.
import { AGENT_EXAMPLES } from "../agent/examples.ts";
import { DEFAULT_HARNESS } from "../agent/command.ts";

/** The harnesses in effect, in the order the default file lists them, and the default among them. */
export interface HarnessChoice {
  readonly enabled: readonly string[];
  readonly defaultName: string;
}

/** The names a choice may hold: every agent example except one whose entry needs editing first. */
export function selectableHarnesses(): string[] {
  return AGENT_EXAMPLES.filter((e) => e.selectable !== false).map((e) => e.name);
}

/** The choice the default file makes without one: the examples marked active (`auggie`), with
 *  `DEFAULT_HARNESS`. */
export function shippedChoice(): HarnessChoice {
  return { enabled: AGENT_EXAMPLES.filter((e) => e.active === true).map((e) => e.name), defaultName: DEFAULT_HARNESS };
}

/** Whether a choice gives exactly the default file (so it renders byte for byte as `--print-default`). */
export function isShippedChoice(choice: HarnessChoice): boolean {
  const shipped = shippedChoice();
  return choice.defaultName === shipped.defaultName && choice.enabled.length === shipped.enabled.length && choice.enabled.every((n, i) => n === shipped.enabled[i]);
}

/** The names in `values`, each a name or a comma-separated list (a repeated `--harness`), trimmed,
 *  first occurrence kept. An empty item (`a,,b`, a trailing comma, an empty value) is an error. */
export function splitHarnessNames(values: readonly string[]): string[] {
  const names: string[] = [];
  for (const value of values) {
    for (const item of value.split(",")) {
      const name = item.trim();
      if (name === "") throw new Error(`--harness needs harness names separated by commas, such as --harness claude,codex (got '${value}')`);
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

/**
 * The choice for `names` (from `splitHarnessNames`) and an optional default, or an error naming what
 * is wrong: a name that is not a selectable example (listing the ones that are), or a default that
 * is not among the names. The default is `defaultName`, else the first name given. `enabled` is
 * returned in the default file's order.
 */
export function harnessChoice(names: readonly string[], defaultName?: string): HarnessChoice {
  const selectable = selectableHarnesses();
  if (names.length === 0) throw new Error("--harness needs at least one harness name");
  const unknown = names.filter((n) => !selectable.includes(n));
  if (unknown.length > 0) {
    const which = unknown.map((n) => `'${n}'`).join(", ");
    throw new Error(`${unknown.length === 1 ? "unknown harness" : "unknown harnesses"} ${which}; --harness takes ${selectable.join(", ")}`);
  }
  const chosenDefault = defaultName ?? names[0]!;
  if (!names.includes(chosenDefault)) throw new Error(`--default ${chosenDefault} is not among the harnesses given with --harness (${names.join(", ")})`);
  return { enabled: selectable.filter((n) => names.includes(n)), defaultName: chosenDefault };
}

/** The choice's harnesses for a message: `claude`, `claude and codex`, `auggie, claude and codex`. */
export function harnessList(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
