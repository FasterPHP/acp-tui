// Key overrides from the configuration (mvp-configuration design D10; spec
// tui-keymap "Key overrides from the configuration", "Key override validation"
// and "Essential actions keep a key"). The `keys` section is merged per context
// over the built-in map: a configured key replaces that key's default binding in
// its context, `null` removes it, and an action's other default keys stay.
//
// Each entry is checked on its own, so a bad one leaves the bindings it would
// have changed as they were and the rest apply:
//
// - an unknown action (with the closest known one), a key that cannot be parsed,
//   or two spellings of one key in a context (both are rejected): errors;
// - a printable key without Ctrl or Alt in a text-input context (`prompt`,
//   `find`, `overlay`), which would make that character untypeable, except in
//   `prompt` for `palette` and `agentCommands`, which act only at the start of
//   an empty prompt box (as the default `?` and `/` do): an error;
// - then, over the merged map, the essential actions (`submit`, `newline`,
//   `detach`, `palette` in every context that has it together, and the card's
//   `confirm`): an override that would leave one without a key is rejected and
//   the action keeps the keys it had.
//
// Unknown contexts are the loader's (a warning with a suggestion: the `keys`
// section is an object of the contexts). Problems carry the setting's path
// (`keys.<context>.<key as written>`); `locateProblems` (locate.ts) gives them
// their file, line and column. Key labels in messages are lower case
// (`keyLabel`), as everywhere acp-tui draws a key. Pure: no OpenTUI or Solid.
import { suggest } from "../config/problems.ts";
import type { ProblemSeverity } from "../config/problems.ts";
import { DEFAULT_KEY_MAP_INPUT, KEY_ACTIONS, KEY_CONTEXTS, keyLabel, loadKeyMap, normaliseKey, type KeyContext, type KeyMap, type KeyMapInput } from "./keymap.ts";

/** A key problem before it is placed in a file: the setting's path and what is wrong. */
export interface KeyProblem {
  /** `["keys", context, key as written]`. */
  readonly path: readonly string[];
  readonly severity: ProblemSeverity;
  readonly message: string;
  readonly suggestion?: string;
}

/** The `keys` section as the configuration holds it. */
export type KeysSection = { readonly [C in KeyContext]?: Readonly<Record<string, string | null>> | undefined };

/** Contexts where a printable key types text. */
export const TEXT_INPUT_CONTEXTS: readonly KeyContext[] = ["prompt", "find", "overlay"];

/** `prompt` actions that act only at the start of an empty prompt box and leave their character
 *  as text in a draft, so a printable key may open them (Marcus, 11 October 2026). */
const PROMPT_OPENERS: readonly string[] = ["palette", "agentCommands"];

/** Actions that must keep a key, by context (design D10). `palette` is essential across `global`
 *  and `prompt` together. */
export const ESSENTIAL_ACTIONS: readonly { readonly contexts: readonly KeyContext[]; readonly action: string }[] = [
  { contexts: ["prompt"], action: "submit" },
  { contexts: ["prompt"], action: "newline" },
  { contexts: ["global"], action: "detach" },
  { contexts: ["global", "prompt"], action: "palette" },
  { contexts: ["card"], action: "confirm" },
];

/** A key that types a character: no Ctrl, Alt or Super, and one character (or Space) as its name. */
export function isPrintableKey(normalised: string): boolean {
  const parts = normalised.split("+");
  const name = parts.pop()!;
  if (parts.some((m) => m !== "shift")) return false;
  return name === "space" || [...name].length === 1;
}

/** A key as a message names it: its lower-case label (`ctrl+o`, `q`). */
const named = (key: string): string => keyLabel(key);

/** What a printable key types, for the message: `q`, `Q` for `shift+q`, `space`. */
function typedBy(key: string): string {
  if (key === "space" || key === "shift+space") return "space";
  return key.startsWith("shift+") ? key.slice("shift+".length).toUpperCase() : key;
}

export interface ResolvedKeys {
  /** The merged, validated map. */
  readonly map: KeyMap;
  /** The overrides that were applied, normalised (`null` for a removal). */
  readonly applied: KeyMapInput;
  readonly problems: readonly KeyProblem[];
}

/**
 * The key map for a `keys` section over `base` (the built-in map by default), with a problem for
 * each rejected entry. Never throws.
 */
export function resolveKeyOverrides(section: KeysSection | undefined, base: KeyMapInput = DEFAULT_KEY_MAP_INPUT): ResolvedKeys {
  const problems: KeyProblem[] = [];
  const accepted: Record<string, Record<string, { raw: string; action: string | null }>> = {};
  for (const context of KEY_CONTEXTS) {
    const entries = section?.[context];
    if (!entries) continue;
    const actions = KEY_ACTIONS[context] as readonly string[];
    const byKey = new Map<string, { raw: string; action: string | null }[]>();
    for (const [raw, action] of Object.entries(entries)) {
      const path = ["keys", context, raw];
      let key: string;
      try {
        key = normaliseKey(raw);
      } catch (error) {
        problems.push({ path, severity: "error", message: `in the ${context} context: ${(error as Error).message}, so the binding is ignored` });
        continue;
      }
      if (action !== null && !actions.includes(action)) {
        const close = suggest(action, actions);
        problems.push({
          path,
          severity: "error",
          message: `in the ${context} context: ${JSON.stringify(action)} is not an action of the ${context} context, so ${named(key)} keeps its binding`,
          ...(close ? { suggestion: close } : {}),
        });
        continue;
      }
      if (action !== null && TEXT_INPUT_CONTEXTS.includes(context) && isPrintableKey(key) && !(context === "prompt" && PROMPT_OPENERS.includes(action))) {
        const where = context === "prompt" ? "the prompt box" : context === "find" ? "the find bar" : "a list's filter";
        problems.push({
          path,
          severity: "error",
          message: `in the ${context} context: ${typedBy(key)} would no longer type in ${where}, so the binding is ignored; bind a key with ctrl or alt instead`,
        });
        continue;
      }
      byKey.set(key, [...(byKey.get(key) ?? []), { raw, action }]);
    }
    for (const [key, list] of byKey) {
      const spellings = new Set(list.map((e) => e.raw));
      if (list.length > 1 && spellings.size > 1 && new Set(list.map((e) => e.action)).size > 1) {
        const actionsNamed = list.map((e) => (e.action === null ? "null" : e.action)).join(" and ");
        problems.push({
          path: ["keys", context, list[0]!.raw],
          severity: "error",
          message: `in the ${context} context: ${named(key)} is written ${[...spellings].map((s) => JSON.stringify(s)).join(" and ")}, bound to ${actionsNamed}; both are ignored and ${named(key)} keeps its binding`,
        });
        continue;
      }
      (accepted[context] ??= {})[key] = list.at(-1)!;
    }
  }

  // Essential actions: an override that leaves one without a key is rejected (its default keys
  // are put back), checked over the merged map.
  const build = () => {
    const overrides: Record<string, Record<string, string | null>> = {};
    for (const [context, keys] of Object.entries(accepted)) overrides[context] = Object.fromEntries(Object.entries(keys).map(([k, e]) => [k, e.action]));
    return { overrides: overrides as KeyMapInput, map: loadKeyMap(overrides as KeyMapInput, base) };
  };
  let { overrides, map } = build();
  const defaults = loadKeyMap({}, base);
  for (const { contexts, action } of ESSENTIAL_ACTIONS) {
    const bound = (m: KeyMap) => contexts.some((c) => Object.values(m[c]).includes(action as never));
    if (bound(map) || !bound(defaults)) continue;
    // The overrides that removed one of its default keys (a null, or the key given to another action).
    for (const context of contexts) {
      for (const [key, a] of Object.entries(defaults[context])) {
        if (a !== action) continue;
        const entry = accepted[context]?.[key];
        if (!entry) continue;
        delete accepted[context]![key];
        problems.push({
          path: ["keys", context, entry.raw],
          severity: "error",
          message: `would leave ${action === "confirm" ? "the permission card's confirm" : action} with no key, so ${named(key)} keeps it`,
        });
      }
    }
    ({ overrides, map } = build());
  }
  return { map, applied: overrides, problems };
}
