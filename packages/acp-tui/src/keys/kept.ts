// Kept keys (mvp-configuration design D10, task 8.3; spec tui-keymap "Kept keys
// per terminal"): the keys each IDE terminal keeps for itself, recorded in
// ide-keys.json (mvp-chrome-and-keys task 3.8, probed in its task 8.1), read at
// run time. A configured key that the terminal in use keeps is warned about,
// naming the terminal and the action's other routes there, and still bound (the
// user may have freed it in the IDE, design 14.20). Both PhpStorm engines are
// detected alike (`TERMINAL_EMULATOR=JetBrains-JediTerm`), so `jetbrains` takes
// the keys any of them keeps (IntelliJ's terminal on Windows is a third, recorded
// from the Windows VM, windows-support task 9.4; its kept keys are PhpStorm's).
// Windows Terminal (`WT_SESSION`) is the fourth detected terminal. `config --check`
// evaluates all five recorded terminals (`keptKeyCheckWarnings`), and also warns
// when the overrides leave an action that a key reached there by default
// reachable only through the palette. Pure: no OpenTUI or Solid.
import table from "./ide-keys.json";
import { detectTerminal } from "../renderer/capabilities.ts";
import { isPaletteAction } from "../overlay/palette-actions.ts";
import { DEFAULT_KEY_MAP, KEY_CONTEXTS, keyLabel, keysFor, normaliseKey, type KeyContext, type KeyMap } from "./keymap.ts";
import { ESSENTIAL_ACTIONS, type KeyProblem, type KeysSection } from "./overrides.ts";

/** The terminals ide-keys.json records. */
export const RECORDED_TERMINALS = ["phpstorm-reworked", "phpstorm-classic", "zed", "windows-terminal", "intellij-windows"] as const;
export type RecordedTerminal = (typeof RECORDED_TERMINALS)[number];

/** Terminals as acp-tui detects them: both PhpStorm engines are `jetbrains`. */
export type KeptKeysTerminal = "jetbrains" | "zed" | "windows-terminal";

/** How a warning names a terminal. */
const LABELS: Readonly<Record<RecordedTerminal | KeptKeysTerminal, string>> = {
  "phpstorm-reworked": "PhpStorm's reworked terminal",
  "phpstorm-classic": "PhpStorm's classic terminal",
  zed: "Zed",
  "windows-terminal": "Windows Terminal",
  "intellij-windows": "IntelliJ's terminal on Windows",
  jetbrains: "PhpStorm",
};

/** The recorded terminals a detected terminal stands for. */
const RECORDED_FOR: Readonly<Record<KeptKeysTerminal, readonly RecordedTerminal[]>> = {
  jetbrains: ["phpstorm-reworked", "phpstorm-classic", "intellij-windows"],
  zed: ["zed"],
  "windows-terminal": ["windows-terminal"],
};

type Alternative = { key: string; context: string; action: string } | { palette: string } | { outside: string };
interface KeptEntry {
  readonly key: string;
  readonly alternatives: readonly Alternative[];
}
const TERMINALS = table.terminals as unknown as Record<RecordedTerminal, { label: string; kept: KeptEntry[] }>;

/**
 * The terminal in use for the kept-key table, by the per-terminal table's detection
 * (`detectTerminal`, renderer/capabilities.ts; mvp-configuration design D10 and D12): `jetbrains`
 * stands for both PhpStorm engines and IntelliJ's terminal (`TERMINAL_EMULATOR=JetBrains-JediTerm`),
 * `zed` for Zed, `windows-terminal` for Windows Terminal (`WT_SESSION`, after the others, so an IDE
 * started from it is still `jetbrains`), and any other terminal keeps no recorded key (null).
 */
export function keptKeysTerminal(env: Readonly<Record<string, string | undefined>> = process.env): KeptKeysTerminal | null {
  const id = detectTerminal(env);
  return id === "jetbrains" || id === "zed" || id === "windows-terminal" ? id : null;
}

/** The keys the recorded terminals keep, normalised. */
export function keptKeys(terminals: readonly RecordedTerminal[]): Set<string> {
  return new Set(terminals.flatMap((t) => TERMINALS[t].kept.map((k) => normaliseKey(k.key))));
}

/** Every context's action for `key` in `map`, as `context.action`. */
function boundTo(map: KeyMap, key: string): string[] {
  return KEY_CONTEXTS.flatMap((c) => {
    const action = (map[c] as Record<string, string>)[key];
    return action === undefined ? [] : [`${c}.${action}`];
  });
}

/** Routes the table records for an action: for every kept key bound to it by default, its
 *  alternatives that are keys (F3 for find, `?` for the palette), by `context.action`. */
const TABLE_ROUTES: ReadonlyMap<string, readonly { key: string; context: KeyContext; action: string }[]> = (() => {
  const out = new Map<string, { key: string; context: KeyContext; action: string }[]>();
  for (const terminal of RECORDED_TERMINALS) {
    for (const kept of TERMINALS[terminal].kept) {
      for (const name of boundTo(DEFAULT_KEY_MAP, normaliseKey(kept.key))) {
        for (const alt of kept.alternatives) {
          if (!("key" in alt)) continue;
          const route = { key: normaliseKey(alt.key), context: alt.context as KeyContext, action: alt.action };
          const list = out.get(name) ?? [];
          if (!list.some((r) => r.key === route.key && r.context === route.context)) list.push(route);
          out.set(name, list);
        }
      }
    }
  }
  return out;
})();

/** "a", "a and b", "a, b and c". */
function and(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** The routes to `context.action` in a terminal that keeps `kept`, other than `except`: the
 *  table's alternatives, the action's own keys, then the palette. */
function routesTo(map: KeyMap, context: KeyContext, action: string, kept: ReadonlySet<string>, except?: string): string[] {
  const labels: string[] = [];
  const add = (key: string) => {
    if (key === except || kept.has(key)) return;
    const label = keyLabel(key);
    if (!labels.includes(label)) labels.push(label);
  };
  for (const route of TABLE_ROUTES.get(`${context}.${action}`) ?? []) {
    if ((map[route.context] as Record<string, string>)[route.key] === route.action) add(route.key);
  }
  for (const key of keysFor(map, context, action as never)) add(key);
  if (isPaletteAction(context, action)) labels.push("the palette");
  return labels;
}

/** What a warning says about an action's routes in a terminal. */
function routesText(action: string, routes: readonly string[]): string {
  const onlyPalette = routes.length === 1 && routes[0] === "the palette";
  if (routes.length === 0) return `${action} has no other route there`;
  if (onlyPalette) return `${action} is reachable there only through the palette`;
  return routes.length === 1 ? `the route to ${action} there is ${routes[0]}` : `the routes to ${action} there are ${and(routes)}`;
}

interface Draft {
  readonly path: readonly string[];
  /** The message with `{T}` for the terminal's name. */
  readonly text: string;
}

/** Type 1: configured keys the terminal keeps. */
function configuredKept(section: KeysSection | undefined, map: KeyMap, kept: ReadonlySet<string>): Draft[] {
  const out: Draft[] = [];
  for (const context of KEY_CONTEXTS) {
    for (const [raw, action] of Object.entries(section?.[context] ?? {})) {
      if (action === null) continue;
      let key: string;
      try {
        key = normaliseKey(raw);
      } catch {
        continue;
      }
      // Only bindings that were applied (a rejected one is reported by overrides.ts).
      if ((map[context] as Record<string, string>)[key] !== action || !kept.has(key)) continue;
      const routes = routesTo(map, context, action, kept, key);
      out.push({ path: ["keys", context, raw], text: `{T} keeps ${keyLabel(key)}, so it may never reach acp-tui there; ${routesText(action, routes)}` });
    }
  }
  return out;
}

/** The contexts whose keys are routes to the same action: `palette` is one route across `global`
 *  and `prompt` (the essential-action check of overrides.ts treats it so: Ctrl+P and `?` both open
 *  it), every other action is reached in its own context only. */
function routeContexts(context: KeyContext, action: string): readonly KeyContext[] {
  return ESSENTIAL_ACTIONS.find((e) => e.action === action && e.contexts.includes(context))?.contexts ?? [context];
}

/** The first configured entry that took a default key from `context.action` (a null, or the key
 *  given to another action), for a warning's place. */
function takenBy(section: KeysSection | undefined, context: KeyContext, action: string): { context: KeyContext; raw: string } | null {
  for (const c of routeContexts(context, action)) {
    const defaults = keysFor(DEFAULT_KEY_MAP, c, action as never);
    for (const [raw, bound] of Object.entries(section?.[c] ?? {})) {
      try {
        if (defaults.includes(normaliseKey(raw)) && bound !== action) return { context: c, raw };
      } catch {
        continue;
      }
    }
  }
  return null;
}

/**
 * Warnings for the terminal in use: each configured key it keeps (spec tui-keymap "Kept keys per
 * terminal", scenario "Ctrl+P in Zed"). No terminal (null) keeps any recorded key.
 */
export function keptKeyWarnings(section: KeysSection | undefined, map: KeyMap, terminal: KeptKeysTerminal | null): KeyProblem[] {
  if (terminal === null) return [];
  const kept = keptKeys(RECORDED_FOR[terminal]);
  return configuredKept(section, map, kept).map((d) => ({ path: d.path, severity: "warning", message: d.text.replace("{T}", LABELS[terminal]) }));
}

/**
 * Warnings for `config --check`: the three recorded terminals alike (spec tui-keymap "Kept keys per
 * terminal", scenario "Only kept keys"): each configured key a terminal keeps, and each action a
 * key reached there by default that the overrides leave reachable there only through the palette
 * (or by no key at all). A warning that holds for several terminals is given once, naming them; an
 * action left without a key everywhere is named once, without a terminal.
 */
export function keptKeyCheckWarnings(section: KeysSection | undefined, map: KeyMap): KeyProblem[] {
  const drafts = new Map<string, { path: readonly string[]; text: string; terminals: RecordedTerminal[] }>();
  const add = (d: Draft, terminal: RecordedTerminal) => {
    const id = `${d.path.join("\u0000")}\u0001${d.text}`;
    const entry = drafts.get(id) ?? { path: d.path, text: d.text, terminals: [] };
    entry.terminals.push(terminal);
    drafts.set(id, entry);
  };
  const lostEverywhere = new Map<string, Draft>();
  const lostIn = new Map<string, RecordedTerminal[]>();
  for (const terminal of RECORDED_TERMINALS) {
    const kept = keptKeys([terminal]);
    const configured = configuredKept(section, map, kept);
    for (const d of configured) add(d, terminal);
    const covered = new Set(configured.map((d) => `${d.path[1]}.${(section?.[d.path[1] as KeyContext] ?? {})[d.path[2]!]}`));
    for (const context of KEY_CONTEXTS) {
      for (const action of new Set(Object.values(DEFAULT_KEY_MAP[context]) as string[])) {
        // An action with one route across several contexts (the palette: Ctrl+P and `?`) is
        // judged over all of them together, and named once.
        const group = routeContexts(context, action);
        if (group[0] !== context) continue;
        const name = `${context}.${action}`;
        if (group.some((c) => covered.has(`${c}.${action}`))) continue;
        const reaches = (m: KeyMap) => group.some((c) => keysFor(m, c, action as never).some((k) => !kept.has(k)));
        if (!reaches(DEFAULT_KEY_MAP) || reaches(map)) continue;
        const taken = takenBy(section, context, action);
        if (taken === null) continue;
        const via = isPaletteAction(context, action) ? `${action} is reachable only through the palette` : `${action} has no key that reaches acp-tui`;
        lostEverywhere.set(name, { path: ["keys", taken.context, taken.raw], text: via });
        lostIn.set(name, [...(lostIn.get(name) ?? []), terminal]);
      }
    }
  }
  const out: KeyProblem[] = [];
  for (const { path, text, terminals } of drafts.values()) out.push({ path, severity: "warning", message: text.replace("{T}", terminalsLabel(terminals)) });
  for (const [name, d] of lostEverywhere) {
    const terminals = lostIn.get(name)!;
    const message = terminals.length === RECORDED_TERMINALS.length ? `${d.text}, in every terminal` : `in ${terminalsLabel(terminals)}, ${d.text}`;
    out.push({ path: d.path, severity: "warning", message });
  }
  return out;
}

/** "Zed", "PhpStorm" (both engines), "PhpStorm's reworked terminal and Zed". IntelliJ's terminal
 *  on Windows shares PhpStorm's kept keys and is named only when no PhpStorm terminal is. */
function terminalsLabel(terminals: readonly RecordedTerminal[]): string {
  const names: string[] = [];
  const both = terminals.includes("phpstorm-reworked") && terminals.includes("phpstorm-classic");
  const phpstorm = terminals.includes("phpstorm-reworked") || terminals.includes("phpstorm-classic");
  for (const t of terminals) {
    if (t === "intellij-windows" && phpstorm) continue;
    if (both && (t === "phpstorm-reworked" || t === "phpstorm-classic")) {
      if (!names.includes(LABELS.jetbrains)) names.push(LABELS.jetbrains);
    } else names.push(LABELS[t]);
  }
  return and(names);
}
