// The command palette's entries (spec tui-palette "Every action in the
// palette", "Agent commands in the slash menu"; design 6.4 "Overlays",
// mvp-chrome-and-keys D8 and D16; decision 16; research/full-screen-synthesis.md
// 2.7 and 2.9) and the config option pickers' entries ("Config option
// pickers"; parity 7.2). Pure. The palette lists the key map's command
// catalogue (`commandCatalogue`), grouped by the context that owns each
// command, with the keys bound to it and, where there is one, the current
// value (the model, the mode, the thinking level, the mouse policy). The
// agent's own commands (`available_commands_update`) are a list of their own,
// `agentItems`, which `/` opens; the palette (`?`, Ctrl+P) never lists them
// (Marcus, 11 October 2026; mvp-chrome-and-keys task 12.1). Every action is
// listed except those that only make sense as a keystroke (`KEYSTROKE_ONLY`:
// the double Esc, Tab, the newline key and the prompt box's line moves, the
// palette's own openers, Esc's return to the prompt box, the card preview's
// scrolling, and the keys of the overlay, the find bar and the elicitation card
// themselves); the "Catalogue check" test holds `PALETTE_COMMANDS` and
// `KEYSTROKE_ONLY` together to the whole catalogue.
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { AgentCommand, Session } from "acp-model";
import { approvalText } from "../app/permission.ts";
import type { CatalogueEntry } from "../keys/register.ts";
import { actionLabel, KEY_SCOPES, type KeyContext, type KeyMap } from "../keys/keymap.ts";
import type { InterruptSetting } from "../keys/settings.ts";
import { DEFAULT_MODEL_LABEL, LEGACY_MODEL_ID, legacyModelOption, modelDisplayName, providerGroups, DEFAULT_MODEL_LIST_SETTINGS, type ModelListSettings } from "../layout/provider-groups.ts";
import type { ListItem } from "./list.ts";

/** The group each context's commands are listed under, in the palette's order. */
export const PALETTE_GROUPS: readonly { readonly context: KeyContext; readonly label: string }[] = [
  { context: "global", label: "Session" },
  { context: "conversation", label: "Conversation" },
  { context: "selection", label: "Selection" },
  { context: "card", label: "Permission" },
  { context: "prompt", label: "Prompt" },
];

/** The group the agent's own commands are listed under. */
export const AGENT_GROUP = "Agent commands";

/** The group acp-tui's own slash commands are listed under, after the agent's (day-one-feedback
 *  design D10; spec tui-palette "acp-tui commands in the slash menu"). */
export const ACP_TUI_GROUP = "acp-tui";

// `KEYSTROKE_ONLY` and `isPaletteAction` live in palette-actions.ts, which loads no OpenTUI, so
// the kept-key check (src/keys/kept.ts) and `config --check` can read them.
export { isPaletteAction, KEYSTROKE_ONLY } from "./palette-actions.ts";

/** The commands the palette lists, per context, in order: every action outside `KEYSTROKE_ONLY`.
 *  A command is shown only while it is registered (has a handler). */
export const PALETTE_COMMANDS: { readonly [C in KeyContext]?: readonly string[] } = {
  global: [
    "pickModel",
    "pickMode",
    "pickThoughtLevel",
    "cycleMode",
    "cycleThoughtLevel",
    "sessions",
    "interrupt",
    "find",
    "findNext",
    "findPrevious",
    "toggleTool",
    "toggleMouse",
    "repaint",
    "pageUp",
    "pageDown",
    "keyHelp",
    "configProblems",
    "addDirectory",
    "detach",
  ],
  conversation: [
    "first",
    "last",
    "up",
    "down",
    "toggle",
    "previousPrompt",
    "nextPrompt",
    "previousTool",
    "nextTool",
    "openLink",
    "expandOutput",
    "cycleDensity",
    "copyItem",
    "copyItemMarkdown",
    "export",
  ],
  selection: ["copy", "copyRich", "clear"],
  card: [
    "choose1",
    "choose2",
    "choose3",
    "choose4",
    "choose5",
    "choose6",
    "choose7",
    "choose8",
    "choose9",
    "previous",
    "next",
    "confirm",
    "grow",
  ],
  prompt: ["submit", "paste", "selectAll", "cut", "undo", "redo", "first", "last"],
};

/** Which config option a picker command chooses (by ACP category, else by id). */
export const PICKER_CATEGORIES: Readonly<Record<string, string>> = {
  pickModel: "model",
  pickMode: "mode",
  pickThoughtLevel: "thought_level",
};

/** The notice for a picker or cycle key when the agent offers no option of the category. */
export function noOptionNotice(category: string): string {
  if (category === "mode") return "the harness offers no modes";
  if (category === "model") return "the harness offers no models";
  if (category === "thought_level") return "the harness offers no thinking levels";
  return `the harness offers no ${category.replace("_", " ")} option`;
}

/** The id of the select option acp-tui makes of the agent's legacy modes (`session/set_mode`). */
export const LEGACY_MODE_ID = "acp-tui:legacy-mode";

/**
 * The id of the select option acp-tui makes of the agent's older model state (`models`,
 * `session/set_model`), a compatibility fallback (design 5.5, Models; session-models D4). Never
 * sent to the agent.
 */
export { LEGACY_MODEL_ID };

type SelectOption = Extract<SessionConfigOption, { type: "select" }>;

/**
 * The options the pickers offer: the agent's config options, then, when it offers no `mode`
 * option but legacy modes, those modes as one select option (`LEGACY_MODE_ID`, category `mode`),
 * which is applied with `session/set_mode`, and, when it offers no `model` option but lists at
 * least one legacy model, those as one select option (`LEGACY_MODEL_ID`, category `model`),
 * applied with `session/set_model` (spec tui-palette "Config option pickers").
 */
export function pickerOptions(session: Pick<Session, "configOptions" | "modes" | "models">): readonly SessionConfigOption[] {
  const { configOptions, modes, models } = session;
  const out = [...configOptions];
  if (modes && modes.availableModes.length > 0 && !configOptions.some((o) => o.category === "mode" || o.id === "mode")) {
    out.push({
      type: "select",
      id: LEGACY_MODE_ID,
      name: "Mode",
      category: "mode",
      currentValue: modes.currentModeId,
      options: modes.availableModes.map((mode) => ({ value: mode.id, name: mode.name, description: mode.description ?? null })),
    } satisfies SelectOption);
  }
  if (models && models.availableModels.length > 0 && !configOptions.some((o) => o.category === "model" || o.id === "model")) {
    out.push(legacyModelOption(models));
  }
  return out.length === configOptions.length ? configOptions : out;
}

/** A palette item and what choosing it does. */
export type PaletteAction =
  | { readonly kind: "command"; readonly name: string; readonly context: KeyContext }
  | { readonly kind: "picker"; readonly configId: string }
  | { readonly kind: "switch"; readonly configId: string; readonly value: boolean }
  | { readonly kind: "agent"; readonly name: string; readonly inputHint: string | null };

export interface PaletteItem extends ListItem {
  readonly action: PaletteAction;
}

export interface PaletteState {
  /** The options the pickers offer (`pickerOptions`). */
  readonly configOptions: readonly SessionConfigOption[];
  /** The effective mouse policy (the `toggleMouse` command's value). */
  readonly mouse: string;
  /** The open permission request's option labels, in order (empty when none is open). */
  readonly permissionOptions: readonly string[];
  /** How many additional directories the session has (the `addDirectory` command's value). */
  readonly directories?: number;
  /** Routes for entries no key is bound to, by catalogue name (`paletteRoutes`). */
  readonly routes?: Readonly<Record<string, string>>;
  /** What decides which entries can run now (`unavailable`); absent: every entry can. */
  readonly facts?: PaletteFacts;
}

/**
 * The facts that make an entry unable to act at once (day-two-feedback task 13.12; spec tui-palette
 * "Only entries that can run now are active"), read when the palette opens (and `idle` live).
 * Focus is not among them: choosing an entry first gives focus to the region that owns its command
 * (`focusFor` in Overlay.tsx), so a conversation, card or prompt command acts whatever had focus
 * when the palette was opened.
 */
export interface PaletteFacts {
  /** No turn is running, so there is nothing to interrupt. */
  readonly idle: boolean;
  /** The conversation or the prompt box holds a selection. */
  readonly selection: boolean;
  /** The prompt box holds a selection. */
  readonly promptSelection: boolean;
  /** The conversation had focus when the palette opened (the copy command then copies the item
   *  under the cursor when nothing is selected). */
  readonly fromConversation: boolean;
}

/**
 * Whether choosing the command `name` (`<context>.<action>`) would have nothing to act on, which is
 * exactly when its handler refuses (`Interrupt the turn` while idle, `Clear the selection` with
 * none: the `not available now` notice) or does nothing at all (`Cut the selection` with none,
 * `Copy` with nothing selected and no item under the cursor to copy). Every other entry acts at
 * once, or says why it did not in a notice of its own.
 */
export function unavailable(name: string, facts: PaletteFacts): boolean {
  switch (name) {
    case "global.interrupt":
      return facts.idle;
    case "selection.clear":
      return !facts.selection;
    case "selection.copy":
    case "selection.copyRich":
      return !facts.selection && !facts.fromConversation;
    case "prompt.cut":
      return !facts.promptSelection;
    default:
      return false;
  }
}

/** The pickers' route: a click on their pill (spec tui-layout "Config option pills"). */
export const PILL_CLICK_ROUTE = "click the pill";

/**
 * How to reach the palette's keyless entries other than through the palette, shown in their key
 * column in place of keys: `Interrupt the turn` by the Esc key twice (once under the `single`
 * interrupt setting), and the three pickers by a click on their pill while the mouse reports
 * clicks. A route is something that performs exactly that entry: the cycle keys step to the next
 * value and do not open a picker, so they are shown on their own entries only, and the single
 * densities are gone (day-two-feedback task 13.7; spec tui-palette "Command palette overlay"). The
 * label comes from the key map in use, so a rebinding stays truthful, and a route whose key is
 * unbound is left out. The session list and the configuration's problems have none.
 */
export function paletteRoutes(keyMap: KeyMap, options: { readonly interrupt: InterruptSetting; readonly mouse: string }): Record<string, string> {
  const routes: Record<string, string> = {};
  const esc = actionLabel(keyMap, "global", "escape");
  if (esc) routes["global.interrupt"] = options.interrupt === "single" ? esc : `${esc} ${esc}`;
  if (options.mouse === "full") for (const action of Object.keys(PICKER_CATEGORIES)) routes[`global.${action}`] = PILL_CLICK_ROUTE;
  return routes;
}

/** The config option a picker command chooses: by category, else by id. */
export function configFor(options: readonly SessionConfigOption[], category: string): SessionConfigOption | undefined {
  return options.find((o) => o.category === category) ?? options.find((o) => o.id === category);
}

/** A select option's choices in order, groups flattened (each choice keeps its group's name). */
export function selectChoices(option: SelectOption): { value: string; name: string; description: string | null; group: string | null }[] {
  const out: { value: string; name: string; description: string | null; group: string | null }[] = [];
  for (const entry of option.options ?? []) {
    if ("group" in entry) {
      for (const choice of entry.options) out.push({ value: choice.value, name: choice.name, description: choice.description ?? null, group: entry.name });
    } else {
      out.push({ value: entry.value, name: entry.name, description: entry.description ?? null, group: null });
    }
  }
  return out;
}

/** The display name of an option's current value. */
export function currentName(option: SessionConfigOption, models?: ModelListSettings): string {
  if (option.type === "boolean") return option.currentValue ? "on" : "off";
  if (option.type !== "select") return "";
  const found = selectChoices(option).find((c) => c.value === option.currentValue);
  if (!found && option.category === "model" && option.currentValue === "" && selectChoices(option).length > 0) return DEFAULT_MODEL_LABEL;
  if (found && option.category === "model") return approvalText(modelDisplayName(option, found.value, found.name, models));
  return approvalText(found?.name ?? String(option.currentValue ?? ""));
}

/** The choice after the current one (the first after the last; the first when none is current),
 *  for the cycle keys (spec tui-keymap "Mode and effort keys"); null with fewer than two choices. */
export function nextChoice(option: SelectOption): { value: string; name: string } | null {
  const choices = selectChoices(option);
  if (choices.length < 2) return null;
  const at = choices.findIndex((c) => c.value === option.currentValue);
  const next = choices[(at + 1) % choices.length]!;
  return { value: next.value, name: approvalText(next.name) };
}

const PICKER_ACTIONS = new Set(Object.keys(PICKER_CATEGORIES));

/** The names, without the slash, of the commands the agent advertises, sanitised as the menu
 *  shows them (what `SlashState.agentCommands` takes). */
export function agentCommandNames(commands: readonly AgentCommand[]): string[] {
  return commands.map((command) => approvalText(command.name));
}

/** The agent's commands as the list `/` opens: `/<name>` and the description, in the agent group. */
export function agentItems(commands: readonly AgentCommand[]): PaletteItem[] {
  return commands.map((command) => {
    const name = approvalText(command.name);
    return {
      id: `agent:${name}`,
      group: AGENT_GROUP,
      title: `/${name}`,
      description: approvalText(command.description) || null,
      action: { kind: "agent", name, inputHint: command.inputHint === null ? null : approvalText(command.inputHint) },
    };
  });
}

const SLASH_ID_PREFIX = "slash:";

/** What completing a slash menu entry puts in the prompt box: `/<name> ` and, for an agent
 *  command, its input hint as the placeholder; null for an entry that is not a slash command.
 *  acp-tui's own entries use their slash name, never the catalogue title. */
export function completionOf(item: PaletteItem): { readonly text: string; readonly hint: string | null } | null {
  if (item.action.kind === "agent") return { text: `/${item.action.name} `, hint: item.action.inputHint };
  if (item.id.startsWith(SLASH_ID_PREFIX)) return { text: `/${item.id.slice(SLASH_ID_PREFIX.length)} `, hint: null };
  return null;
}

/** Whether Enter completes the entry into the prompt box (an agent command, and `/add-dir`, which
 *  takes a path) instead of running it. */
export function enterCompletes(item: PaletteItem): boolean {
  return item.action.kind === "agent" || item.id === `${SLASH_ID_PREFIX}add-dir`;
}

/** One of acp-tui's slash commands: `/<name>` runs the catalogue command `command`. */
export interface SlashCommand {
  readonly name: string;
  /** The catalogue name of the action it runs (`global.pickModel`). */
  readonly command: string;
  readonly context: KeyContext;
  /** The config option category the command chooses from, for the pickers: it is available only
   *  while the agent offers a select option of it. */
  readonly picks?: string;
}

/** acp-tui's slash commands, in the order the menu lists them (design D10). Each is only a name
 *  for an action the command palette has; `/exit` is detach (exit is detach). */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: "model", command: "global.pickModel", context: "global", picks: "model" },
  { name: "mode", command: "global.pickMode", context: "global", picks: "mode" },
  { name: "effort", command: "global.pickThoughtLevel", context: "global", picks: "thought_level" },
  { name: "sessions", command: "global.sessions", context: "global" },
  { name: "find", command: "global.find", context: "global" },
  { name: "export", command: "conversation.export", context: "conversation" },
  { name: "add-dir", command: "global.addDirectory", context: "global" },
  { name: "help", command: "global.keyHelp", context: "global" },
  { name: "exit", command: "global.detach", context: "global" },
];

/** What decides which slash commands are offered. */
export interface SlashState {
  /** The options the pickers offer (`pickerOptions`). */
  readonly configOptions: readonly SessionConfigOption[];
  /** The names, without the slash, of the commands the agent advertises (sanitised). */
  readonly agentCommands: readonly string[];
  /** Routes for entries no key is bound to, as in `PaletteState`. */
  readonly routes?: Readonly<Record<string, string>>;
}

/** The slash commands that can run now: their action is registered (`catalogue`), a picker has an
 *  option to choose from, and the agent advertises no command of the same name (its entry wins). */
function availableSlash(catalogue: readonly CatalogueEntry[], state: SlashState): { readonly command: SlashCommand; readonly entry: CatalogueEntry }[] {
  const byName = new Map(catalogue.map((entry) => [entry.name, entry]));
  const advertised = new Set(state.agentCommands);
  const out: { command: SlashCommand; entry: CatalogueEntry }[] = [];
  for (const command of SLASH_COMMANDS) {
    const entry = byName.get(command.command);
    if (!entry || advertised.has(command.name)) continue;
    if (command.picks !== undefined) {
      const option = configFor(state.configOptions, command.picks);
      if (!option || option.type !== "select") continue;
    }
    out.push({ command, entry });
  }
  return out;
}

/** The menu's items for acp-tui's slash commands, under `ACP_TUI_GROUP`: `/<name>`, the action's
 *  title as its description and its keys (or route) in the key column. */
export function slashItems(catalogue: readonly CatalogueEntry[], state: SlashState): PaletteItem[] {
  return availableSlash(catalogue, state).map(({ command, entry }) => ({
    id: `${SLASH_ID_PREFIX}${command.name}`,
    group: ACP_TUI_GROUP,
    title: `/${command.name}`,
    description: entry.title,
    // A key shows only where it works from any focus: the menu's one group mixes contexts, and a
    // heading cannot say where a conversation key works (task 13.11).
    keys: KEY_SCOPES[entry.context] === null ? entry.keys : [],
    route: entry.keys.length === 0 ? (state.routes?.[entry.name] ?? null) : null,
    action: { kind: "command", name: command.command, context: command.context },
  }));
}

/** The slash command a sent prompt is exactly, ignoring white space around it, while it can run
 *  (design D10; spec tui-palette "Typed acp-tui commands": "with white space before and after it
 *  ignored", so a completed `/exit ` runs); null for anything else, such as a
 *  command with arguments or a name the agent advertises. */
export function typedSlashCommand(text: string, catalogue: readonly CatalogueEntry[], state: SlashState): SlashCommand | null {
  const typed = text.trim();
  return availableSlash(catalogue, state).find(({ command }) => typed === `/${command.name}`)?.command ?? null;
}

/** The path of a sent prompt that is `/add-dir` followed by a path (one line; a pair of quotes round
 *  it is dropped), while the command can run and the agent advertises no command of that name
 *  (spec tui-palette "Typed acp-tui commands"); null for anything else, including `/add-dir`
 *  alone, which is the plain command. */
export function typedAddDirectory(text: string, catalogue: readonly CatalogueEntry[], state: SlashState): string | null {
  const match = /^\s*\/add-dir[ \t]+(\S[^\r\n]*?)\s*$/.exec(text);
  if (!match) return null;
  if (!availableSlash(catalogue, state).some(({ command }) => command.name === "add-dir")) return null;
  const path = match[1]!;
  const quoted = /^(["'])(.*)\1$/.exec(path);
  return (quoted ? quoted[2]! : path) || null;
}

/**
 * The palette's items: the catalogue's listed commands, grouped by context; the config pickers
 * only for options the agent reports, with the current value; the agent's other config options
 * (selects as pickers, booleans as switches) after them; the permission card's commands only while
 * a request is open, the option keys one per option; an entry without keys shows its route from
 * `state.routes` instead (task 12.7). The agent's commands are not among them (`agentItems`).
 */
export function paletteItems(catalogue: readonly CatalogueEntry[], state: PaletteState): PaletteItem[] {
  const byName = new Map(catalogue.map((entry) => [entry.name, entry]));
  const items: PaletteItem[] = [];
  const pickedIds = new Set<string>();
  // A route only for an entry without keys (a key bound to `interrupt` replaces `esc esc`).
  const routeOf = (entry: CatalogueEntry): string | null => (entry.keys.length === 0 ? (state.routes?.[entry.name] ?? null) : null);
  for (const { context, label } of PALETTE_GROUPS) {
    for (const action of PALETTE_COMMANDS[context] ?? []) {
      const entry = byName.get(`${context}.${action}`);
      if (!entry) continue;
      if (context === "global" && PICKER_ACTIONS.has(action)) {
        const option = configFor(state.configOptions, PICKER_CATEGORIES[action]!);
        if (!option || option.type !== "select") continue;
        pickedIds.add(option.id);
        items.push({
          id: entry.name,
          group: label,
          title: entry.title,
          value: currentName(option),
          keys: entry.keys,
          groupNote: KEY_SCOPES[context],
          route: routeOf(entry),
          action: { kind: "command", name: entry.name, context },
        });
        continue;
      }
      if (context === "card") {
        if (state.permissionOptions.length === 0) continue;
        const n = /^choose(\d)$/.exec(action);
        if (n) {
          const label = state.permissionOptions[Number(n[1]) - 1];
          if (label === undefined) continue;
          items.push({ id: entry.name, group: "Permission", title: `Select ${label}`, keys: entry.keys, groupNote: KEY_SCOPES[context], action: { kind: "command", name: entry.name, context } });
          continue;
        }
      }
      items.push({
        id: entry.name,
        group: label,
        title: entry.title,
        value: context === "global" && action === "toggleMouse" ? state.mouse : context === "global" && action === "addDirectory" && (state.directories ?? 0) > 0 ? String(state.directories) : null,
        keys: entry.keys,
        groupNote: KEY_SCOPES[context],
        route: routeOf(entry),
        ...(state.facts && unavailable(entry.name, state.facts) ? { muted: true } : {}),
        action: { kind: "command", name: entry.name, context },
      });
    }
    // The agent's other config options, after the session's commands.
    if (context === "global") {
      for (const option of state.configOptions) {
        if (pickedIds.has(option.id)) continue;
        const name = approvalText(option.name);
        if (option.type === "select") {
          items.push({ id: `config:${option.id}`, group: label, title: `Choose ${name}`, value: currentName(option), action: { kind: "picker", configId: option.id } });
        } else if (option.type === "boolean") {
          items.push({
            id: `config:${option.id}`,
            group: label,
            title: `Switch ${name} ${option.currentValue ? "off" : "on"}`,
            value: currentName(option),
            action: { kind: "switch", configId: option.id, value: !option.currentValue },
          });
        }
      }
    }
  }
  return items;
}

/** A picker's items: the option's choices (grouped as the agent groups them, else by provider for
 *  a model list that meets the rule of `providerGroups` while `models.groupByProvider` is on), the
 *  current one marked. The filter matches the full name and the value. */
export function pickerItems(option: SelectOption, models: ModelListSettings = DEFAULT_MODEL_LIST_SETTINGS): ListItem[] {
  const byProvider = models.groupByProvider ? providerGroups(option) : null;
  return selectChoices(option).map((choice) => {
    const split = byProvider?.get(choice.value);
    return {
      id: choice.value,
      group: split ? approvalText(split.provider) : choice.group === null ? null : approvalText(choice.group),
      title: approvalText(split ? split.title : choice.name),
      value: choice.description ? approvalText(choice.description) : null,
      current: choice.value === option.currentValue,
      search: split ? approvalText(`${choice.name} ${choice.value}`) : approvalText(choice.value),
    };
  });
}
