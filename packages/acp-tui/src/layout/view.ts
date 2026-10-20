// The session view: everything bar modules read (design 6.10, "modules are
// pure functions from the session view-model"). Derived by a pure function from
// the acp-model Session plus agent and UI state, so the session store adapter
// can recompute it on every change and tests can build one directly.
import { sanitise, type ConnectionState, type Session, type SessionOpenMode, type TurnState } from "acp-model";
import type { MousePolicy } from "../renderer/options.ts";
import type { HintRule } from "./modules.ts";

/** Which region has keyboard focus. Task 8.3 adds Tab into the conversation. `overlay` is the
 *  command palette, a picker, key help or the session list; `find` is the find bar. */
export type Focus = "prompt" | "conversation" | "card" | "overlay" | "find";

/** A two-press state waiting for its second press (design D7: shown by `turn-state`). */
export interface ArmedState {
  readonly kind: "detach" | "interrupt";
  /** Label of the key that completes it, from the key map in use (`ctrl+d`). */
  readonly key: string;
}

/** Where the conversation is scrolled to. */
export interface ScrollPosition {
  /** True while the conversation follows the bottom. */
  readonly following: boolean;
  /** Share of the content above the bottom of the viewport, 0 to 100. */
  readonly percent: number;
  /** Rows of content below the viewport. */
  readonly below: number;
  /** Entries added below since the reader left the bottom (the `↓ N new` indicator); 0 while
   *  following. */
  readonly newBelow: number;
}

export const FOLLOWING: ScrollPosition = Object.freeze({ following: true, percent: 100, below: 0, newBelow: 0 });

export interface SessionView {
  /** Agent display name (`agentInfo.title`, else `agentInfo.name`), or null before `initialize`. */
  agent: string | null;
  agentVersion: string | null;
  /** Current model name from the `model` config option, else the legacy model state, if the
   *  agent reported either. */
  model: string | null;
  /** Current mode name from the `mode` config option, else legacy session modes. */
  mode: string | null;
  cwd: string | null;
  /** Home directory, so the `cwd` module can shorten paths to `~`. */
  home: string | null;
  /** The platform whose path rules the `cwd` module applies (tests inject `win32`); absent = this one. */
  platform?: NodeJS.Platform;
  /** `connecting` until `initialize` and `session/new` have completed. */
  connection: ConnectionState | "connecting";
  turnState: TurnState;
  /** How the session is being opened (`load` or `resume`), or null once it is open
   *  (mvp-sessions task 6.2); absent in fixtures built by hand. */
  opening?: SessionOpenMode | null;
  /** Items in the conversation so far, the count `turn-state` shows as `loading N` while a load
   *  replays. */
  loaded?: number;
  /** When the running turn started (`Date.now()` clock), or null while idle. */
  turnStartedAt: number | null;
  /** The clock `turn-state` measures elapsed time against; ticks once a second during a turn. */
  now: number;
  usage: { used: number; size: number } | null;
  cost: { amount: number; currency: string } | null;
  /** The effective mouse policy (the chosen policy, or `off` after F2). */
  mouse: MousePolicy;
  scroll: ScrollPosition;
  /** The conversation's density (`compact`, `verbose`, `focus`); absent in fixtures built by hand. */
  density?: string;
  /** The `density` setting in force, the density the `density` module leaves unmarked; absent
   *  means the setting's default, `focus`. */
  densitySetting?: string;
  /** The config option pills of the prompt box's bottom border (spec tui-layout "Config option
   *  pills"), in the order mode, model, effort; absent in fixtures built by hand. */
  pills?: readonly ConfigPill[];
  /** UI state that key hints and `turn-state` depend on. */
  ui: {
    focus: Focus;
    promptEmpty: boolean;
    permissionOpen: boolean;
    /** A two-press state is armed (Ctrl+D to detach, Esc to interrupt). */
    armed: ArmedState | null;
  };
  /** The hint rules for the key map in use (`hintsForKeyMap`), set by the app; the `hints`
   *  module falls back to the default key map's. */
  hints?: readonly HintRule[];
  /** How many configuration problems there are (the `config` module; mvp-configuration design
   *  D3), set by the app; absent (none) in fixtures built by hand. */
  configProblems?: number;
}

/** The config option categories that get a pill, in their order. */
export const PILL_CATEGORIES = ["mode", "model", "thought_level"] as const;
export type PillCategory = (typeof PILL_CATEGORIES)[number];

/** One config option pill: the option's name and its current value's name, both sanitised. */
export interface ConfigPill {
  readonly category: PillCategory;
  readonly name: string;
  readonly value: string;
}

/** Agent identity from the `initialize` response (`agentInfo`). */
export interface AgentIdentity {
  name: string;
  title?: string | null;
  version?: string | null;
}

export interface ViewInput {
  /** True while the agent is still starting (before `session/new` answered). */
  connecting?: boolean;
  /** True once the harness has answered `initialize`: the connection reads `connected` though no
   *  session has started yet (the session list is open). */
  harnessReady?: boolean;
  /** Overrides the session's own `agent` (from `initialize`); mostly for fixtures. */
  agent?: AgentIdentity | null;
  home?: string | null;
  now?: number;
  mouse?: MousePolicy;
  scroll?: ScrollPosition;
  density?: string;
  densitySetting?: string;
  ui?: Partial<SessionView["ui"]>;
}

export const DEFAULT_UI: SessionView["ui"] = {
  focus: "prompt",
  promptEmpty: true,
  permissionOpen: false,
  armed: null,
};

// acp-model sanitises every agent string on entry; cleaning again here is a
// harmless repeat (the sanitiser is idempotent) that also flattens newlines,
// and keeps fixtures built by hand safe.
function clean(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  const out = sanitise(text).replace(/[\r\n\t]+/g, " ").trim();
  return out === "" ? null : out;
}

function selectedName(session: Session, category: string): string | null | undefined {
  const option = session.configOptions.find((o) => o.category === category);
  if (!option) return undefined;
  if (option.type !== "select") return null;
  for (const entry of option.options) {
    if ("group" in entry) {
      const found = entry.options.find((o) => o.value === option.currentValue);
      if (found) return found.name;
    } else if (entry.value === option.currentValue) {
      return entry.name;
    }
  }
  return option.currentValue;
}

/** The current model of the older model state (`models`): its name, else its ID. Used only while
 *  the session has no `model` config option, which wins outright (session-models D2). */
function legacyModelName(session: Session): string | undefined {
  const models = session.models;
  if (!models) return undefined;
  return models.availableModels.find((m) => m.modelId === models.currentModelId)?.name ?? models.currentModelId;
}

/**
 * The pills: one per config option of category `mode`, `model` and `thought_level` (the first of
 * each), in that order, the legacy session mode (named `Mode`) when there is no `mode` option and
 * the legacy model (named `Model`) when there is no `model` option. An option without a name or
 * value is left out.
 */
export function configPills(session: Session): ConfigPill[] {
  const out: ConfigPill[] = [];
  for (const category of PILL_CATEGORIES) {
    const option = session.configOptions.find((o) => o.category === category);
    let name: string | null = null;
    let value: string | null = null;
    if (option) {
      name = clean(option.name);
      value = clean(selectedName(session, category));
    } else if (category === "mode" && session.modes) {
      const current = session.modes.availableModes.find((m) => m.id === session.modes!.currentModeId);
      name = "Mode";
      value = clean(current?.name ?? session.modes.currentModeId);
    } else if (category === "model" && session.models) {
      name = "Model";
      value = clean(legacyModelName(session));
    }
    if (name !== null && value !== null) out.push({ category, name, value });
  }
  return out;
}

export function deriveSessionView(session: Session, input: ViewInput = {}): SessionView {
  const agent = input.agent !== undefined ? input.agent : session.agent;
  let mode = selectedName(session, "mode");
  if (mode === undefined && session.modes) {
    const current = session.modes.availableModes.find((m) => m.id === session.modes!.currentModeId);
    mode = current?.name ?? session.modes.currentModeId;
  }
  const usage = session.usage;
  return {
    agent: clean(agent?.title) ?? clean(agent?.name),
    agentVersion: clean(agent?.version),
    model: clean(selectedName(session, "model") ?? legacyModelName(session)),
    mode: clean(mode),
    cwd: clean(session.cwd),
    home: input.home ?? null,
    connection: input.connecting && input.harnessReady !== true ? "connecting" : session.connection,
    turnState: session.state,
    opening: session.opening,
    loaded: session.order.length,
    turnStartedAt: session.state === "idle" ? null : (session.turn?.startedAt ?? null),
    now: input.now ?? Date.now(),
    usage: usage ? { used: usage.used, size: usage.size } : null,
    cost: usage?.cost ? { amount: usage.cost.amount, currency: clean(usage.cost.currency) ?? "" } : null,
    mouse: input.mouse ?? "full",
    scroll: input.scroll ?? FOLLOWING,
    density: input.density,
    densitySetting: input.densitySetting,
    pills: configPills(session),
    ui: { ...DEFAULT_UI, permissionOpen: session.state === "requires_action", ...input.ui },
  };
}
