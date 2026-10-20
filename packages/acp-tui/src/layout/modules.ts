// Bar modules (design 6.10, D7; spec tui-layout "Bar modules"). Each module is
// a pure function `(view, settings) -> Segment[] | null`; null means hidden.
// From tokens.ts, not the theme index, so the configuration schema (and with it cli.ts) can
// import the layout engine without loading OpenTUI or Solid before the JSX preload.
import { TOKENS, type TokenName } from "../theme/tokens.ts";
import { shortenHome, truncateMiddle, type Segment } from "./segments.ts";
import { renderTemplate, type Fields } from "./template.ts";
import { hintsForKeyMap } from "../keys/hints.ts";
import { DEFAULT_KEY_MAP } from "../keys/keymap.ts";
import type { ArmedState, Focus, SessionView } from "./view.ts";

export { shortenHome };

export const MODULE_IDS = [
  "agent",
  "model",
  "mode",
  "cwd",
  "connection",
  "turn-state",
  "usage",
  "cost",
  "hints",
  "mouse",
  "density",
  "position",
  "config",
  "text",
] as const;

export type ModuleId = (typeof MODULE_IDS)[number];

/** Settings a layout may give a module entry; anything omitted takes the module's default. */
export interface ModuleSettings {
  format?: string;
  /** Higher numbers are kept longer when a bar does not fit. */
  priority?: number;
  hideWhenEmpty?: boolean;
  /** Foreground token for the module's literal text and plain fields. */
  token?: TokenName;
  /** `cwd` only: longest path shown before middle truncation. */
  maxWidth?: number;
  /** `hints` only: the hint rules, replacing the defaults. */
  hints?: readonly HintRule[];
}

export type ResolvedModuleSettings = Required<Omit<ModuleSettings, "hints" | "maxWidth">> &
  Pick<ModuleSettings, "hints" | "maxWidth">;

export type ModuleFn = (view: SessionView, settings: ResolvedModuleSettings) => Segment[] | null;

export interface ModuleDef {
  render: ModuleFn;
  defaults: ResolvedModuleSettings;
  /** Placeholders the format may use. */
  fields: readonly string[];
  /** When true for the current view, the engine never drops this module. */
  neverDrop?: (view: SessionView) => boolean;
}

/** Shown in place of a missing value when `hideWhenEmpty` is false. */
export const MISSING = "-";

function fromTemplate(settings: ResolvedModuleSettings, fields: Fields): Segment[] | null {
  const out = renderTemplate(settings.format, fields, settings.token, settings.hideWhenEmpty ? "" : MISSING);
  if (out.segments.length === 0) return null;
  if (out.empty && settings.hideWhenEmpty) return null;
  return out.segments;
}

/** 38000 -> `38k`, 1500 -> `1.5k`, 1200000 -> `1.2M`. */
export function formatCount(n: number): string {
  const abs = Math.abs(n);
  const scaled = (value: number, suffix: string) => {
    const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
    return `${rounded}${suffix}`;
  };
  if (abs >= 1_000_000) return scaled(n / 1_000_000, "M");
  if (abs >= 1_000) return scaled(n / 1_000, "k");
  return String(Math.round(n));
}

const CURRENCY_SYMBOLS: Record<string, string> = { USD: "$", GBP: "£", EUR: "€" };

export function formatCost(amount: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency.toUpperCase()];
  const value = amount.toFixed(2);
  return symbol ? `${symbol}${value}` : currency ? `${value} ${currency}` : value;
}

/** Elapsed time: `7s`, `1m05s`, `2h03m`. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

/** What `turn-state` shows while a two-press state is armed; the key comes from the key map. */
export function armedText(armed: ArmedState): string {
  switch (armed.kind) {
    case "detach":
      return `${armed.key} again to detach and stop the turn`;
    case "interrupt":
      return `${armed.key} again to interrupt`;
  }
}

// -- Hints ---------------------------------------------------------------------------------

/** All present conditions must hold for a hint to show. */
export interface HintCondition {
  focus?: Focus;
  /** `running` covers both `running` and `requires_action`. */
  turn?: "idle" | "running";
  permissionOpen?: boolean;
  promptEmpty?: boolean;
}

export interface HintRule {
  key: string;
  label: string;
  when?: HintCondition;
  /** When shown, only exclusive hints are shown. */
  exclusive?: boolean;
  /** Token for both key and label, instead of `accent` and the module token. */
  token?: TokenName;
}

/** Default hints, with key labels taken from the default key map (`src/keys/`). */
export const DEFAULT_HINTS: readonly HintRule[] = hintsForKeyMap(DEFAULT_KEY_MAP);

export function hintApplies(rule: HintRule, view: SessionView): boolean {
  const w = rule.when;
  if (!w) return true;
  if (w.focus !== undefined && w.focus !== view.ui.focus) return false;
  if (w.turn !== undefined && w.turn !== (view.turnState === "idle" ? "idle" : "running")) return false;
  if (w.permissionOpen !== undefined && w.permissionOpen !== view.ui.permissionOpen) return false;
  if (w.promptEmpty !== undefined && w.promptEmpty !== view.ui.promptEmpty) return false;
  return true;
}

const HINT_SEPARATOR = "  ";

// Hidden while a two-press state is armed: `turn-state` then names the key that completes it.
const hintsModule: ModuleFn = (view, settings) => {
  if (view.ui.armed) return null;
  let rules = (settings.hints ?? view.hints ?? DEFAULT_HINTS).filter((r) => hintApplies(r, view));
  if (rules.some((r) => r.exclusive)) rules = rules.filter((r) => r.exclusive);
  const out: Segment[] = [];
  for (const rule of rules) {
    const { segments } = renderTemplate(
      settings.format,
      { key: { text: rule.key, token: rule.token ?? "accent" }, label: { text: rule.label, token: rule.token } },
      rule.token ?? settings.token,
    );
    if (segments.length === 0) continue;
    if (out.length > 0) out.push({ text: HINT_SEPARATOR, token: settings.token });
    out.push({ ...segments[0]!, breakBefore: out.length > 0 }, ...segments.slice(1));
  }
  return out.length > 0 ? out : null;
};

// -- Registry ------------------------------------------------------------------------------

function defaults(format: string, priority: number, token: TokenName, extra: Partial<ResolvedModuleSettings> = {}): ResolvedModuleSettings {
  return { format, priority, token, hideWhenEmpty: true, ...extra };
}

const TURN_TOKENS = { idle: "muted", running: "tool.running", requires_action: "permission" } as const satisfies Record<
  SessionView["turnState"],
  TokenName
>;

export const MODULES: Record<ModuleId, ModuleDef> = {
  agent: {
    fields: ["agent", "version"],
    defaults: defaults("{agent}", 80, "accent"),
    render: (view, s) => fromTemplate(s, { agent: view.agent, version: view.agentVersion }),
  },
  model: {
    fields: ["model"],
    defaults: defaults("{model}", 60, "status.fg"),
    render: (view, s) => fromTemplate(s, { model: view.model }),
  },
  mode: {
    fields: ["mode"],
    defaults: defaults("mode:{mode}", 50, "status.fg"),
    render: (view, s) => fromTemplate(s, { mode: view.mode }),
  },
  cwd: {
    // `cwd` and `path`: the session directory with `~` for home, cut in the middle to `maxWidth`;
    // `basename`: its last component (mvp-configuration design D11).
    fields: ["cwd", "path", "basename"],
    defaults: defaults("{cwd}", 30, "muted", { maxWidth: 40 }),
    render: (view, s) => {
      const path = view.cwd === null ? null : truncateMiddle(shortenHome(view.cwd, view.home), s.maxWidth ?? 40);
      const base = view.cwd === null ? null : view.cwd.replace(/\/+$/, "").split("/").pop() || "/";
      return fromTemplate(s, { cwd: path, path, basename: base === null ? null : truncateMiddle(base, s.maxWidth ?? 40) });
    },
  },
  connection: {
    fields: ["state"],
    defaults: defaults("{state}", 90, "muted"),
    render: (view, s) =>
      fromTemplate(s, { state: { text: view.connection, token: view.connection === "disconnected" ? "danger" : undefined } }),
    neverDrop: (view) => view.connection === "disconnected",
  },
  "turn-state": {
    // `state` is what the row needs to say: the armed two-press state, else `idle`,
    // `running <elapsed>` or `requires_action`; while a session is opened by load, `loading N`
    // (the items so far), and by resume `opening` (mvp-sessions task 6.2). `elapsed` alone serves
    // custom formats.
    fields: ["state", "elapsed"],
    defaults: defaults("{state}", 100, "status.fg"),
    render: (view, s) => {
      const elapsed = view.turnStartedAt === null ? null : formatElapsed(view.now - view.turnStartedAt);
      const armed = view.ui.armed;
      const state = armed
        ? { text: armedText(armed), token: "warning" as const }
        : view.opening
          ? { text: view.opening === "load" ? `loading ${view.loaded ?? 0}` : "opening", token: "tool.running" as const }
          : { text: view.turnState === "running" && elapsed ? `running ${elapsed}` : view.turnState, token: TURN_TOKENS[view.turnState] };
      return fromTemplate(s, { state, elapsed });
    },
    neverDrop: (view) => view.turnState === "requires_action" || view.ui.armed !== null,
  },
  usage: {
    fields: ["used", "size", "percent"],
    defaults: defaults("ctx {used}/{size}", 22, "muted"),
    render: (view, s) => {
      const u = view.usage;
      return fromTemplate(s, {
        used: u ? formatCount(u.used) : null,
        size: u ? formatCount(u.size) : null,
        percent: u && u.size > 0 ? `${Math.round((u.used / u.size) * 100)}%` : null,
      });
    },
  },
  cost: {
    fields: ["cost", "amount", "currency"],
    defaults: defaults("{cost}", 75, "muted"),
    render: (view, s) => {
      const c = view.cost;
      return fromTemplate(s, {
        cost: c ? formatCost(c.amount, c.currency) : null,
        amount: c ? c.amount.toFixed(2) : null,
        currency: c?.currency ?? null,
      });
    },
  },
  hints: {
    // Below `cwd`: in a narrow status row the hints give way first, one hint at a time. The default
    // priorities (mvp-chrome-and-keys design D5): turn-state 100, connection 90, mouse 85, cost 75,
    // position 70, density 65, cwd 30, hints 25, usage 22 (the prompt box shows the context).
    fields: ["key", "label"],
    defaults: defaults("{key} {label}", 25, "hint"),
    render: hintsModule,
  },
  mouse: {
    // Hidden while the effective policy is `full` (spec tui-screen "Mouse toggle").
    fields: ["state", "policy"],
    defaults: defaults("{state}", 85, "status.fg"),
    render: (view, s) => {
      if (view.mouse === "full") return null;
      const state = view.mouse === "off" ? "mouse off" : `mouse: ${view.mouse}`;
      return fromTemplate(s, { state: { text: state, token: "accent" }, policy: view.mouse });
    },
  },
  density: {
    // Hidden while the density is the one the `density` setting names (the rule `mouse`
    // follows; spec tui-conversation "Switching density").
    fields: ["name"],
    defaults: defaults("density: {name}", 65, "muted"),
    render: (view, s) => {
      if (view.density === undefined || view.density === (view.densitySetting ?? "focus")) return null;
      return fromTemplate(s, { name: { text: view.density, token: "accent" } });
    },
  },
  position: {
    // Hidden while the conversation follows the bottom.
    fields: ["percent", "below"],
    defaults: defaults("scrolled {percent}", 70, "muted"),
    render: (view, s) => {
      if (view.scroll.following) return null;
      return fromTemplate(s, {
        percent: { text: `${Math.round(view.scroll.percent)}%`, token: "accent" },
        below: String(view.scroll.below),
      });
    },
  },
  config: {
    // The configuration's problems (mvp-configuration design D3, task 3.4): hidden while there are
    // none; above every module but `turn-state` and `connection` (spec tui-layout "Bar modules").
    fields: ["count"],
    defaults: defaults("config {count}", 88, "warning"),
    render: (view, s) => {
      const count = view.configProblems ?? 0;
      if (count === 0) return null;
      return fromTemplate(s, { count: String(count) });
    },
  },
  text: {
    fields: [],
    defaults: defaults("", 10, "status.fg"),
    render: (_view, s) => fromTemplate(s, {}),
  },
};

export function isModuleId(id: string): id is ModuleId {
  return (MODULE_IDS as readonly string[]).includes(id);
}

export function isForegroundToken(name: string): name is TokenName {
  return name in TOKENS && TOKENS[name as TokenName].role === "fg";
}
