// Solid store adapter (design D2): holds the acp-model session in a Solid
// store for components, plus UI state (focus, the armed two-press state, the
// effective mouse policy, the conversation's scroll position, notices) and a
// clock that ticks once a second while a turn runs (for `turn-state`).
//
// Why not `reconcile` on the whole session: reconcile makes the store's
// current raw values equal to the new ones by mutating them in place, and the
// store's raw values are the reducer's own objects, so an earlier snapshot's
// items would be rewritten (measured: after reconciling v1 then v2 of an item,
// v1.text read v2's text). The reducer already returns a new object for every
// changed item and keeps unchanged ones by reference, so the adapter compares
// references instead and replaces only the changed items, keyed by id. That
// gives per-item granularity without touching the model's snapshots.
import { batch, createEffect, onCleanup as onCleanupRoot, createMemo, createRoot, createSignal, type Accessor } from "solid-js";
import { createStore, produce, type SetStoreFunction } from "solid-js/store";
import { createSession, type Item, type Session } from "acp-model";
import type { ModelListSettings } from "../layout/provider-groups.ts";
import { deriveSessionView, FOLLOWING, type ArmedState, type Focus, type ScrollPosition, type SessionView } from "../layout/view.ts";
import { userHome } from "../platform/paths.ts";
import type { MousePolicy } from "../renderer/options.ts";
import type { TokenName } from "../theme/index.ts";
import { createConversationViewModel, type ConversationViewModel } from "../conversation/view-model.ts";

/** What the store needs from a session source; `SessionController` satisfies it. */
/** The `ui.overlay` name of the session list (the palette's is `palette`). */
export const SESSION_LIST_OVERLAY = "sessions";

export interface SessionSource {
  getSession(): Session;
  subscribe(listener: (session: Session) => void): () => void;
}

/** The session as components read it: acp-model fields, items as a record keyed by id. */
export interface SessionState {
  readonly id: Session["id"];
  readonly cwd: Session["cwd"];
  readonly agent: Session["agent"];
  readonly connection: Session["connection"];
  readonly state: Session["state"];
  readonly stopReason: Session["stopReason"];
  readonly configOptions: Session["configOptions"];
  readonly modes: Session["modes"];
  /** The older model state (`models`), a fallback for the model pill and picker. */
  readonly models: Session["models"];
  readonly usage: Session["usage"];
  /** The agent's commands (the slash menu, mvp-chrome-and-keys task 6.4). */
  readonly commands: Session["commands"];
  readonly plan: Session["plan"];
  /** Per-turn bookkeeping: when the turn started and whether it reported a plan; null while idle. */
  readonly turn: Session["turn"];
  /** Item ids in start order (append-only). */
  readonly order: readonly string[];
  readonly items: Readonly<Record<string, Item>>;
  /** Id of the open permission record (`permission:<toolCallId>`), or null. */
  readonly openPermissionId: string | null;
}

export interface Notice {
  readonly id: number;
  readonly text: string;
  readonly token: TokenName;
  /** Kept whole at the end when the text is cut to the border's width: where to read the rest
   *  (a configuration problem's notice names the `Configuration problems` list). */
  readonly more?: string;
  /** Cut in place of `text` beside `more` (the problem without the `configuration:` that `more`
   *  already says). */
  readonly short?: string;
}

export interface UiState {
  readonly focus: Focus;
  /** The armed two-press state (exit, detach or interrupt), shown by `turn-state`; the key
   *  controller owns the state machine. */
  readonly armed: ArmedState | null;
  readonly promptEmpty: boolean;
  /** The effective mouse policy: the chosen one, or `off` after F2 (task 8.5). */
  readonly mouse: MousePolicy;
  /** Where the conversation is scrolled to (the `position` module). */
  readonly scroll: ScrollPosition;
  /** The conversation's density (`compact`, `verbose`, `focus`; the `density` module marks it
   *  when it differs from `densitySetting`). The conversation owns it and publishes it here. */
  readonly density: string;
  /** The `density` setting in force (the density the status row leaves unmarked), published by
   *  the conversation beside `density`. */
  readonly densitySetting: string;
  /** True until a session source is attached. */
  readonly connecting: boolean;
  /** True once the harness has answered `initialize` (with `--resume` and no ID the list is open
   *  and no session exists yet): the status row says `connected` from then on, while the splash
   *  keeps `connecting…` until the session has started (day-two-feedback task 12.7). */
  readonly harnessReady: boolean;
  /** True once the harness has answered `initialize` in this start (also with a session still to be
   *  opened): the splash and the `connection` module say `opening session` from then on, and
   *  `starting` before. */
  readonly initialized: boolean;
  /** When the start began and, once known, when `initialize` was answered (ms, the store's clock),
   *  for the seconds the splash shows after the fifth. */
  readonly startedAt: number;
  readonly initializedAt: number | null;
  readonly notices: readonly Notice[];
  /** Which overlay holds the `overlay` focus (`sessions`, the session list; `palette`, the
   *  palette or a picker), or null; an overlay closes itself when another one takes it. */
  readonly overlay: string | null;
  /** Counts the sessions attached with `replace` (a switch, mvp-sessions task 7.4): the
   *  conversation region is mounted afresh for each. */
  readonly epoch: number;
}

/** One changed item in a session update. */
export interface ItemChange {
  readonly id: string;
  readonly item: Item;
  /** The previous version, or null when the item is new. */
  readonly previous: Item | null;
  /** True when this update moved the item from `live` to `final` (or it arrived final). */
  readonly becameFinal: boolean;
}

/** Emitted once per reducer step, after the store has been updated. */
export interface SessionChange {
  readonly session: Session;
  readonly previous: Session;
  /** Changed items, in start order. Empty for metadata-only updates. */
  readonly items: readonly ItemChange[];
}

export interface SessionStore {
  readonly session: SessionState;
  readonly ui: UiState;
  /** The bar modules' view-model; recomputed only when metadata or UI state changes. */
  readonly view: Accessor<SessionView>;
  /** The conversation's collapse state, cursor and reading position (design D9). */
  readonly conversation: ConversationViewModel;
  /** The latest immutable acp-model snapshot. */
  snapshot(): Session;
  /** Starts following a source (replacing any previous one) and clears `connecting`. */
  attach(source: SessionSource): void;
  /**
   * Follows another session (switching sessions, mvp-sessions design decision 7): forgets the
   * previous session's items and the conversation's view state (collapse
   * state, cursor, reading position), bumps `ui.epoch` so the conversation region is mounted
   * afresh, then attaches `source`; with null, follows nothing and shows `connecting` again (a
   * switch at start-up that failed, before any session exists).
   */
  replace(source: SessionSource | null): void;
  setOverlay(overlay: string | null): void;
  /** Called after every update with the changed items; returns an unsubscribe function. */
  onChange(listener: (change: SessionChange) => void): () => void;
  setFocus(focus: Focus): void;
  setArmed(armed: ArmedState | null): void;
  setPromptEmpty(empty: boolean): void;
  /** The harness has answered `initialize` (see `ui.harnessReady`). */
  setHarnessReady(ready: boolean): void;
  /** The harness has answered `initialize`: the start moves from `starting` to `opening session`. */
  setHarnessInitialized(): void;
  setMouse(policy: MousePolicy): void;
  setScroll(position: ScrollPosition): void;
  setDensity(density: string): void;
  setDensitySetting(density: string): void;
  /** Adds a transient notice (shown in the prompt box's top border); returns its id. `cut` is
   *  for a text too long for the border: `more` shown at its end and the `short` text cut before it
   *  (`Notice.more`, `Notice.short`). */
  notify(text: string, token?: TokenName, cut?: { readonly more: string; readonly short?: string }): number;
  dismissNotice(id: number): void;
  dispose(): void;
}

export interface SessionStoreOptions {
  /** Home directory for the `cwd` module; default the user's home. */
  home?: string | null;
  /** The mouse policy chosen on the command line; default `full`. */
  mouse?: MousePolicy;
  /** Clock for `turn-state`'s elapsed time; default `Date.now`. */
  now?: () => number;
  /** The `models` settings (read where the view is derived, so a change redraws the pills);
   *  default the built-in ones. */
  models?: () => ModelListSettings;
}

/** How often the clock ticks while a turn runs. */
export const CLOCK_TICK_MS = 1000;

// Solid's setter types reject `readonly` properties; the store holds writable versions and
// hands out the readonly interfaces.
type Writable<T> = { -readonly [K in keyof T]: T[K] };
type SessionStateStore = Writable<Omit<SessionState, "order" | "items">> & { order: string[]; items: Record<string, Item> };
type UiStateStore = Writable<Omit<UiState, "notices">> & { notices: Notice[] };

function sameScroll(a: ScrollPosition, b: ScrollPosition): boolean {
  return a.following === b.following && a.percent === b.percent && a.below === b.below && a.newBelow === b.newBelow;
}

function openPermissionId(session: Session): string | null {
  const toolCallId = session.turn?.openPermissionToolCallId;
  return toolCallId ? `permission:${toolCallId}` : null;
}

function metadataOf(session: Session) {
  return {
    id: session.id,
    cwd: session.cwd,
    agent: session.agent,
    connection: session.connection,
    state: session.state,
    stopReason: session.stopReason,
    configOptions: session.configOptions,
    modes: session.modes,
    models: session.models,
    usage: session.usage,
    commands: session.commands,
    plan: session.plan,
    turn: session.turn,
    openPermissionId: openPermissionId(session),
  };
}

// The fields `deriveSessionView` reads; the view is recomputed only when one changes.
function sameViewInputs(a: Session, b: Session): boolean {
  return (
    a.cwd === b.cwd &&
    a.agent === b.agent &&
    a.connection === b.connection &&
    a.state === b.state &&
    a.opening === b.opening &&
    // `loading N` counts items only while a session is being opened.
    (b.opening === null || a.order.length === b.order.length) &&
    a.turn?.startedAt === b.turn?.startedAt &&
    a.configOptions === b.configOptions &&
    a.modes === b.modes &&
    a.models === b.models &&
    a.usage === b.usage
  );
}

/** Items that differ by reference between two snapshots, in `next.order`. */
export function changedItems(previous: Session, next: Session): ItemChange[] {
  const changes: ItemChange[] = [];
  for (const id of next.order) {
    const item = next.items.get(id);
    const before = previous.items.get(id) ?? null;
    if (!item || item === before) continue;
    changes.push({ id, item, previous: before, becameFinal: item.status === "final" && before?.status !== "final" });
  }
  return changes;
}

function applyUpdate(set: SetStoreFunction<SessionStateStore>, previous: Session, next: Session, changes: readonly ItemChange[]): void {
  batch(() => {
    const meta = metadataOf(next);
    for (const key of Object.keys(meta) as (keyof typeof meta)[]) {
      // Solid skips the write (and notifies nobody) when the value is the same reference.
      set(key, meta[key] as never);
    }
    if (changes.length > 0) {
      const patch: Record<string, Item> = {};
      for (const change of changes) patch[change.id] = change.item;
      // Merging at the `items` level replaces each item reference; it never writes into an item.
      set("items", patch);
    }
    if (next.order !== previous.order) {
      const appended = next.order.length >= previous.order.length && next.order[previous.order.length - 1] === previous.order.at(-1);
      if (appended) {
        for (let i = previous.order.length; i < next.order.length; i++) set("order", i, next.order[i]!);
      } else {
        set("order", [...next.order]);
      }
    }
  });
}

export function createSessionStore(options: SessionStoreOptions = {}): SessionStore {
  const home = options.home === undefined ? userHome() : options.home;
  const clock = options.now ?? Date.now;
  let current = createSession();
  const initial = metadataOf(current);
  const [session, setSession] = createStore<SessionStateStore>({ ...initial, order: [], items: {} });
  const [ui, setUi] = createStore<UiStateStore>({
    focus: "prompt",
    armed: null,
    promptEmpty: true,
    mouse: options.mouse ?? "full",
    // A copy: a store setter merges an object value into the one it holds.
    scroll: { ...FOLLOWING },
    density: "focus",
    densitySetting: "focus",
    connecting: true,
    harnessReady: false,
    initialized: false,
    startedAt: clock(),
    initializedAt: null,
    notices: [],
    overlay: null,
    epoch: 0,
  });
  const [now, setNow] = createSignal(clock());
  const [viewSource, setViewSource] = createSignal(current, { equals: sameViewInputs });
  const listeners = new Set<(change: SessionChange) => void>();
  let unsubscribe: (() => void) | null = null;
  let nextNoticeId = 1;

  // Own root, so the store can be created outside a component and disposed explicitly.
  const [view, disposeRoot] = createRoot((dispose) => {
    // The clock ticks only while a turn runs, so an idle session renders nothing on a timer.
    createEffect(() => {
      if (viewSource().state === "idle") return;
      setNow(clock());
      const timer = setInterval(() => setNow(clock()), CLOCK_TICK_MS);
      (timer as { unref?: () => void }).unref?.();
      onCleanupRoot(() => clearInterval(timer));
    });
    const memo = createMemo(() =>
      deriveSessionView(viewSource(), {
        home,
        connecting: ui.connecting,
        harnessReady: ui.harnessReady,
        initialized: ui.initialized,
        now: now(),
        mouse: ui.mouse,
        scroll: { following: ui.scroll.following, percent: ui.scroll.percent, below: ui.scroll.below, newBelow: ui.scroll.newBelow },
        models: options.models?.(),
        density: ui.density,
        densitySetting: ui.densitySetting,
        ui: {
          focus: ui.focus,
          promptEmpty: ui.promptEmpty,
          armed: ui.armed,
        },
      }),
    );
    return [memo, dispose] as const;
  });

  function update(next: Session): void {
    const previous = current;
    if (next === previous) return;
    current = next;
    const changes = changedItems(previous, next);
    applyUpdate(setSession, previous, next, changes);
    setViewSource(next);
    const change: SessionChange = { session: next, previous, items: changes };
    for (const listener of listeners) listener(change);
  }

  // In the store's own root, like the view, so its store and signal outlive any component.
  const conversation = createRoot(() => createConversationViewModel());

  return {
    session,
    ui,
    view,
    conversation,
    snapshot: () => current,
    attach(source) {
      unsubscribe?.();
      unsubscribe = source.subscribe(update);
      setUi("connecting", false);
      setUi("harnessReady", true);
      update(source.getSession());
    },
    replace(source) {
      unsubscribe?.();
      unsubscribe = null;
      const fresh = createSession();
      batch(() => {
        // Every item of the previous session goes; the next update brings the new session's.
        setSession("items", produce((items) => {
          for (const id of Object.keys(items)) delete items[id];
        }));
        setSession("order", []);
        const meta = metadataOf(fresh);
        for (const key of Object.keys(meta) as (keyof typeof meta)[]) setSession(key, meta[key] as never);
        // The snapshot goes with them, before the batch ends: the conversation block the epoch
        // mounts afresh runs then, and the windowed list builds its entries from `snapshot()`, so
        // it would mount the previous session's items, which are no longer in the store (IDE
        // check 10.2).
        current = fresh;
        setViewSource(fresh);
        conversation.reset();
        setUi("scroll", { ...FOLLOWING });
        setUi("epoch", (n) => n + 1);
      });
      if (source === null) {
        setUi("connecting", true);
        setUi("harnessReady", false);
        return;
      }
      unsubscribe = source.subscribe(update);
      setUi("connecting", false);
      setUi("harnessReady", true);
      update(source.getSession());
    },
    setOverlay: (overlay) => setUi("overlay", overlay),
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setFocus: (focus) => setUi("focus", focus),
    setArmed: (armed) => setUi("armed", armed),
    setPromptEmpty: (empty) => setUi("promptEmpty", empty),
    setHarnessReady: (ready) => setUi("harnessReady", ready),
    setHarnessInitialized: () => {
      if (ui.initialized) return;
      setUi("initialized", true);
      setUi("initializedAt", clock());
    },
    setMouse: (policy) => setUi("mouse", policy),
    setScroll(position) {
      if (!sameScroll(ui.scroll, position)) setUi("scroll", position);
    },
    setDensity: (density) => setUi("density", density),
    setDensitySetting: (density) => setUi("densitySetting", density),
    notify(text, token = "warning", cut) {
      const id = nextNoticeId++;
      setUi("notices", (notices) => [...notices, { id, text, token, ...(cut ? { more: cut.more, ...(cut.short === undefined ? {} : { short: cut.short }) } : {}) }]);
      return id;
    },
    dismissNotice(id) {
      setUi("notices", (notices) => notices.filter((n) => n.id !== id));
    },
    dispose() {
      unsubscribe?.();
      unsubscribe = null;
      listeners.clear();
      disposeRoot();
    },
  };
}
