// The key controller: handlers for the global key context (Esc, `interrupt`,
// Ctrl+D, Tab, Ctrl+O, Ctrl+L, F2, PgUp, PgDn), the two-press state machine's
// timers and its armed state in the store (shown by the status row's
// `turn-state`), and transient notices. Every key label in a notice or an
// armed state comes from the key map in use. No OpenTUI here; `register.ts` binds these
// handlers to keys. A handler returns false when the key is not its business,
// so the key reaches the focused component (for example Ctrl+D deleting
// forward in a non-empty composer).
import type { AppActions } from "../app/context.ts";
import { NULL_LOGGER, type DebugLogger } from "../log.ts";
import type { SessionStore } from "../session/store.ts";
import type { TokenName } from "../theme/index.ts";
import type { ArmedState } from "../layout/view.ts";
import type { Anchor } from "../conversation/view-model.ts";
import { exitStep, INITIAL_EXIT_STATE, type ExitInput, type ExitState } from "./exit-machine.ts";
import { actionLabel, type KeyAction, type KeyMap } from "./keymap.ts";
import { DEFAULT_INTERRUPT, type InterruptSetting } from "./settings.ts";

/** What the global keys need from the prompt box. */
export interface ComposerHandle {
  clear(): void;
  /** Whether the draft is empty at this moment (`/` opens the palette only then).
   *  `store.ui.promptEmpty` follows content changes, which can lag the keys of one read (`src/app`
   *  typed at once). */
  empty?(): boolean;
  /** An agent command chosen in the slash menu: `text` at the cursor, and `hint` shown as a muted
   *  placeholder after it while the draft is exactly that text (tui-palette "Agent commands in the
   *  slash menu"). */
  insertCommand?(text: string, hint: string | null): void;
  /** The screen rows of the prompt box's top and bottom borders, read reactively; null before its
   *  first layout. The palette's overlay replaces the prompt box: its bottom edge is on the bottom
   *  border's row and it covers the box (mvp-chrome-and-keys task 12.7). */
  frame?(): { readonly top: number; readonly bottom: number } | null;
  /** Whether the draft holds a selection (made by keys or a drag; spec tui-selection "Selection
   *  in the prompt box"). */
  hasSelection?(): boolean;
  /** The selected text of the draft, or an empty string. */
  selectedText?(): string;
  /** Clears the draft's selection; false when there was none. */
  clearSelection?(): boolean;
  /** Removes the selection from the draft and returns its text (an empty string, and nothing
   *  removed, when there was none): Ctrl+X. */
  cutSelection?(): string;
}

/** What the global keys need from the conversation. */
export interface ConversationHandle {
  /** Scrolls by a page (the height less two rows): -1 up, 1 down. */
  page(direction: -1 | 1): void;
  /** Scrolls to the bottom and resumes following (a prompt was sent). */
  toBottom(): void;
  /** Home in an empty prompt box: the cursor to the first item, shown at the top. */
  first(): void;
  /** End in an empty prompt box: the cursor to the last item, at the bottom and following. */
  last(): void;
  /** Ctrl+O: toggles the target tool call in place and brings it into view; false when the
   *  session has no tool call. */
  toggleTool(): boolean;
  /** What find needs (src/find/). */
  readonly find?: ConversationFindHandle;
  /** Whether the item `id` shows only its one-liner, or less: collapsed under the density and the
   *  user's toggles, or hidden behind a closed group line (the selection's `rangeText`). */
  collapsed?(id: string): boolean;
}

/** The reading position and item display find drives (src/find/). */
export interface ConversationFindHandle {
  /** The reading position now (the top item and its offset, or following the bottom). */
  position(): ReadingPosition;
  /** Puts a reading position back (Esc in the find bar); applied by the next layout. */
  restore(position: ReadingPosition): void;
  /**
   * Shows the item `id`: with `expand`, expanded when it is collapsible and collapsed (and
   * opens the group line that hides it), then scrolled into view by the next
   * layout (mounting it first when it is outside the window). Returns what puts the collapse
   * state (and the group) back as it was, or null when nothing was changed.
   */
  show(id: string, expand: boolean): (() => void) | null;
  /** Scrolls the conversation by `rows` (negative up), as the wheel would. */
  scrollBy(rows: number): void;
}

export interface ReadingPosition {
  readonly anchor: Anchor | null;
  readonly following: boolean;
}

/** Global actions whose handlers come from another module, not the controller: the palette, the
 *  pickers, the mode and effort cycles (mvp-chrome-and-keys task 3.6) and key help (task 6.8)
 *  (src/overlay/Overlay.tsx); find (src/find/); `sessions` (the session list,
 *  src/overlay/SessionList.tsx; mvp-sessions task 7.2); and the configuration's problems
 *  (`Configuration problems`, src/overlay/Overlay.tsx; mvp-configuration task 8.4). */
export type ModuleGlobalAction =
  | "palette"
  | "pickModel"
  | "pickMode"
  | "pickThoughtLevel"
  | "find"
  | "findNext"
  | "findPrevious"
  | "sessions"
  | "cycleMode"
  | "cycleThoughtLevel"
  | "keyHelp"
  | "configProblems";

export type GlobalHandlers = Record<Exclude<KeyAction<"global">, ModuleGlobalAction>, () => boolean>;

export interface KeyController {
  readonly handlers: GlobalHandlers;
  /** Called for every key press before dispatch; disarms unless the key is an Esc or detach
   *  key. */
  otherKey(): void;
  /** Esc in the conversation or the permission card (their `back` action): focus returns to the
   *  prompt box and, while a turn runs, interrupt is armed (or the turn cancelled) in the same
   *  press (spec tui-keymap "Escape"). */
  back(): void;
  /** The `interrupt` setting in use, read at each Esc (the palette shows `Interrupt the turn`'s route from
   *  it: Esc twice, or once under `single`). */
  readonly interrupt: InterruptSetting;
  setComposer(handle: ComposerHandle | null): void;
  setConversation(handle: ConversationHandle | null): void;
  /** The conversation's handle while it is mounted (find reads `find`). */
  conversation(): ConversationHandle | null;
  /** The prompt box's handle while it is mounted (`/` reads `empty`; the slash menu inserts agent
   *  commands). */
  composer(): ComposerHandle | null;
  /** The palette registers how a sent prompt that is exactly one of acp-tui's slash commands runs
   *  it (tui-palette "Typed acp-tui commands"); `runSlash` is what the prompt box asks first. */
  setSlashRunner(runner: ((text: string) => boolean) | null): void;
  /** Runs `text` as an acp-tui slash command when it is exactly one that can run now (and the agent
   *  does not advertise it); false when it is to be sent as a prompt. */
  runSlash(text: string): boolean;
  /** Another docked card (the elicitation card) is open, so Tab from the conversation goes to the
   *  card, as for a permission request. */
  setCardProbe(probe: (() => boolean) | null): void;
  /** The conversation's selection module says whether it holds a selection (the palette mutes the
   *  entries that act on one when there is none; day-two-feedback task 13.12). */
  setSelectionProbe(probe: (() => boolean) | null): void;
  /** Whether the conversation holds a selection now. */
  hasConversationSelection(): boolean;
  /** The permission card's focus stops (mvp-chrome-and-keys design D6), while it is mounted. */
  setCardStops(stops: CardStops | null): void;
  /** Shows a notice for `ms` (default `NOTICE_MS`). */
  notify(text: string, token?: TokenName, ms?: number): void;
  dispose(): void;
}

/**
 * The permission card's focus stops (spec tui-keymap "Focus cycle"): the preview, while it does
 * not fit, then the answer row.
 */
export interface CardStops {
  /** Focus is entering the card: its first stop takes it. */
  enter(): void;
  /** Tab within the card: from the preview to the answer row (true), or false at the answer row
   *  (focus goes on to the prompt box). */
  advance(): boolean;
}

export const NOTICE_MS = 3000;

/** F2 when the `mouse` setting (or `--mouse`) is `off`: there is no policy to go back to. */
export const MOUSE_OFF_NOTICE = "mouse off (the mouse setting is off)";

/** Ctrl+O with no tool calls in the session (spec tui-conversation "Collapse and expand in place"). */
export const NO_TOOL_CALLS_NOTICE = "no tool call to show";

export interface KeyControllerOptions {
  store: SessionStore;
  actions: AppActions;
  keyMap: KeyMap;
  /** The `interrupt` setting (keys/settings.ts), or a function reading it at each Esc (the
   *  configuration's, live on a reload); default `DEFAULT_INTERRUPT`. */
  interrupt?: InterruptSetting | (() => InterruptSetting);
  /** Debug log (`ACP_TUI_LOG`): `key_action` per handled global action, `exit_state` per
   *  exit-machine transition. Never key text. */
  logger?: DebugLogger;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** The armed state for the store: its kind and the label of the key that completes it. */
export function armedState(keyMap: KeyMap, kind: ArmedState["kind"]): ArmedState {
  const action = kind === "detach" ? "detach" : "escape";
  return { kind, key: actionLabel(keyMap, "global", action) ?? action };
}

export function createKeyController(options: KeyControllerOptions): KeyController {
  const { store, actions, keyMap } = options;
  const given = options.interrupt ?? DEFAULT_INTERRUPT;
  const interrupt = typeof given === "function" ? given : () => given;
  const logger = options.logger ?? NULL_LOGGER;
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let exit: ExitState = INITIAL_EXIT_STATE;
  let armTimer: unknown = null;
  let composer: ComposerHandle | null = null;
  let slashRunner: ((text: string) => boolean) | null = null;
  let conversation: ConversationHandle | null = null;
  let cardProbe: (() => boolean) | null = null;
  let selectionProbe: (() => boolean) | null = null;
  let cardStops: CardStops | null = null;
  const noticeTimers = new Set<unknown>();

  function notify(text: string, token: TokenName = "warning", ms = NOTICE_MS): void {
    const id = store.notify(text, token);
    const timer = setTimer(() => {
      noticeTimers.delete(timer);
      store.dismissNotice(id);
    }, ms);
    noticeTimers.add(timer);
  }

  /** Applies a reducer step and keeps the UI in line with the armed state. */
  function step(input: ExitInput) {
    const before = exit.armed;
    const result = exitStep(exit, input);
    exit = result.state;
    const after = exit.armed;
    if (before !== after) {
      logger.log({ event: "exit_state", from: before?.kind ?? "disarmed", to: after?.kind ?? "disarmed", input: input.type });
      if (armTimer !== null) clearTimer(armTimer);
      armTimer = null;
      store.setArmed(after ? armedState(keyMap, after.kind) : null);
      if (after) {
        armTimer = setTimer(() => {
          armTimer = null;
          step({ type: "tick", now: Math.max(now(), after.until) });
        }, Math.max(0, after.until - now()));
      }
    }
    return result;
  }

  const facts = () => ({
    now: now(),
    composerEmpty: store.ui.promptEmpty,
    turnRunning: store.session.state !== "idle",
    promptFocused: store.ui.focus === "prompt",
  });

  /** Esc, from the global layer or a region's `back` action. */
  function escape(promptFocused: boolean): boolean {
    const f = { ...facts(), promptFocused, interrupt: interrupt() };
    const { effect, focusPrompt } = step({ type: "escape", ...f });
    logger.log({ event: "exit_effect", key: "escape", effect, composerEmpty: f.composerEmpty, turnRunning: f.turnRunning, ...(focusPrompt ? { focusPrompt } : {}) });
    if (focusPrompt || effect === "focus-prompt") store.setFocus("prompt");
    if (effect === "cancel-turn") actions.cancel();
    return effect !== "pass";
  }

  const baseHandlers: GlobalHandlers = {
    // Esc (spec tui-keymap "Escape"): in the conversation or the card, focus returns to the
    // prompt box; while a turn runs the first press (from any of the three) arms interrupt and a
    // second within 2 s cancels, or the first cancels under `interrupt: single`; idle, in the
    // prompt box, the key is not ours.
    escape: () => escape(store.ui.focus === "prompt"),

    // `interrupt` (no default key; the palette's `Interrupt the turn`, tui-palette): cancels a
    // running turn at once and disarms anything armed; idle, there is nothing to interrupt.
    interrupt() {
      if (store.session.state === "idle") return false;
      step({ type: "other-key" });
      actions.cancel();
      return true;
    },

    detach() {
      const f = facts();
      const { effect } = step({ type: "detach", ...f });
      logger.log({ event: "exit_effect", key: "detach", effect, composerEmpty: f.composerEmpty, turnRunning: f.turnRunning });
      if (effect === "detach") actions.exit();
      return effect !== "pass";
    },

    // The focus cycle (spec tui-keymap "Focus cycle"): prompt box, conversation, the card's stops
    // when one is open (its preview while that does not fit, then its answer row; otherwise the
    // prompt box again), prompt box.
    toggleFocus() {
      const card = store.session.openPermissionId !== null || (cardProbe?.() ?? false);
      switch (store.ui.focus) {
        case "prompt":
          store.setFocus("conversation");
          break;
        case "conversation":
          if (card) {
            cardStops?.enter();
            store.setFocus("card");
          } else store.setFocus("prompt");
          break;
        case "card":
          if (!cardStops?.advance()) store.setFocus("prompt");
          break;
        // An overlay (the palette, the session list) keeps focus until Esc or a choice.
        case "overlay":
        // The find bar handles Tab itself (to the conversation at the hit).
        case "find":
          break;
      }
      return true;
    },

    pageUp() {
      if (!conversation) return false;
      conversation.page(-1);
      return true;
    },

    pageDown() {
      if (!conversation) return false;
      conversation.page(1);
      return true;
    },

    // Ctrl+O: the tool call behind the open permission request, else the latest one
    // (conversation/content.ts `viewerTarget`), toggled in place by the conversation.
    toggleTool() {
      if (!conversation?.toggleTool()) notify(NO_TOOL_CALLS_NOTICE, "muted");
      return true;
    },

    repaint() {
      if (actions.repaint) {
        actions.repaint();
        return true;
      }
      notify("repaint not yet available", "muted");
      return true;
    },

    // F2 (spec tui-screen "Live mouse toggle"): between the chosen policy and `off`; the `mouse`
    // module shows the effective policy.
    toggleMouse() {
      if (!actions.toggleMouse?.()) notify(MOUSE_OFF_NOTICE, "muted");
      return true;
    },
  };

  // Every global action, with whether it handled the key (false lets it reach the focused
  // component), for diagnosing lost or misrouted keys from a debug log.
  const handlers = Object.fromEntries(
    (Object.entries(baseHandlers) as [keyof GlobalHandlers, () => boolean][]).map(([action, handler]) => [
      action,
      () => {
        const handled = handler();
        logger.log({ event: "key_action", action, handled });
        return handled;
      },
    ]),
  ) as GlobalHandlers;

  return {
    handlers,
    otherKey: () => void step({ type: "other-key" }),
    back() {
      const handled = escape(false);
      logger.log({ event: "key_action", action: "back", handled });
    },
    get interrupt() {
      return interrupt();
    },
    setComposer(handle) {
      composer = handle;
    },
    setConversation(handle) {
      conversation = handle;
    },
    conversation: () => conversation,
    composer: () => composer,
    setSlashRunner(runner) {
      slashRunner = runner;
    },
    runSlash: (text) => slashRunner?.(text) ?? false,
    setCardProbe(probe) {
      cardProbe = probe;
    },
    setSelectionProbe(probe) {
      selectionProbe = probe;
    },
    hasConversationSelection: () => selectionProbe?.() ?? false,
    setCardStops(stops) {
      cardStops = stops;
    },
    notify,
    dispose() {
      if (armTimer !== null) clearTimer(armTimer);
      armTimer = null;
      for (const timer of noticeTimers) clearTimer(timer);
      noticeTimers.clear();
    },
  };
}
