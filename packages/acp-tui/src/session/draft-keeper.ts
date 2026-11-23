// The draft store's place in the app (spec tui-sessions "Unsent drafts kept per session", "Drafts
// restored when a session is reopened", "Drafts across a session switch"; design D10, D13 to D15):
// when to read the prompt box's draft, when to keep it and when to hand it to the exit text, and
// when to put a kept one back. The prompt box binds a `DraftHandle` for what it can do; the app
// (`app/run.tsx`) and the session switcher call the rest.
//
// A draft is kept exactly for a session the exit text would give a resume line (`canKeep`): the
// harness can load or resume it and it has had an answered prompt or was itself opened from
// history. Any other session's text is not kept: at exit it is printed, on a switch it stays in
// the prompt box.
import type { Draft, DraftKey, DraftStore } from "./drafts.ts";
import type { CurrentSession } from "./switch.ts";
import { sessionExitState } from "./exit-state.ts";

/** What the prompt box gives and takes (the composer handle's draft methods). */
export interface DraftHandle {
  /** The box's draft, or null when it is empty. */
  draft(): Draft | null;
  /** Puts `draft` in the box, after any text already there (spec tui-sessions "Restoring into a prompt box with text"). */
  restore(draft: Draft): void;
  /** Empties the box. */
  clear(): void;
  /** Puts exactly `draft` back, replacing the box's text (a switch that failed). */
  replace(draft: Draft | null): void;
}

/** The session a draft would belong to. */
export interface DraftSession extends DraftKey {
  /** Whether a draft of this session is kept (it can be reopened). */
  readonly canKeep: boolean;
}

/** The session in use as a draft's owner, or null before it has an ID. */
export function draftSessionOf(current: CurrentSession | null): DraftSession | null {
  if (!current?.recorder) return null;
  const id = current.controller.getSession().id;
  if (!id) return null;
  const state = sessionExitState({ controller: current.controller, recorder: current.recorder, opened: current.opened }, current.launch);
  return { harness: current.launch.agentName, sessionId: id, canKeep: state.canReopen && (state.hadPrompt || state.openedFromHistory) };
}

/** What a switch asks of the keeper (src/session/switch.ts). */
export interface SwitchDrafts {
  /** The session left: its draft kept and the box emptied when it can be reopened; returns what to put back should the switch fail. */
  leave(previous: CurrentSession | null): Draft | null;
  /** The session opened by load or resume: its kept draft put in the box. */
  enter(harness: string, sessionId: string): void;
  /** The switch failed after `leave`: the box as it was. */
  rollback(snapshot: Draft | null): void;
}

export interface DraftKeeper extends SwitchDrafts {
  /** The prompt box binds itself; a draft waiting for the box is delivered at once. */
  bind(handle: DraftHandle): () => void;
  /** Exit: keeps the draft of the session in use, or returns the text the exit text must print. */
  leaveForExit(): string | null;
  /** A prompt of the session in use was accepted: its kept draft is no longer wanted. */
  forget(): void;
}

export interface DraftKeeperOptions {
  readonly store: DraftStore;
  /** `prompt.keep_drafts`, read at each use. */
  readonly enabled: () => boolean;
  /** The session in use (the switcher's `current`). */
  readonly current: () => CurrentSession | null;
}

export function createDraftKeeper(options: DraftKeeperOptions): DraftKeeper {
  const { store } = options;
  let handle: DraftHandle | null = null;
  let pending: Draft | null = null;

  /** The draft of a session left, kept when it can be: returns the draft that was not kept (null: nothing to print or keep elsewhere). */
  function keep(session: DraftSession | null, draft: Draft | null): Draft | null {
    if (session?.canKeep && options.enabled()) {
      const key = { harness: session.harness, sessionId: session.sessionId };
      if (draft === null) {
        store.remove(key);
        return null;
      }
      return store.save(key, draft) === "saved" ? null : draft;
    }
    return draft;
  }

  return {
    bind(next) {
      handle = next;
      if (pending) {
        const draft = pending;
        pending = null;
        next.restore(draft);
      }
      return () => {
        if (handle === next) handle = null;
      };
    },

    leaveForExit() {
      const session = draftSessionOf(options.current());
      const draft = handle?.draft() ?? null;
      return keep(session, draft)?.text ?? null;
    },

    forget() {
      const session = draftSessionOf(options.current());
      if (session) store.remove({ harness: session.harness, sessionId: session.sessionId });
    },

    leave(previous) {
      const session = draftSessionOf(previous);
      const draft = handle?.draft() ?? null;
      const rest = keep(session, draft);
      // Kept (or empty) for a session that can be reopened: the box is emptied for the next one;
      // anything else stays, so a switch never drops text.
      if (session?.canKeep && options.enabled() && rest === null) {
        if (draft !== null) handle?.clear();
      }
      return draft;
    },

    enter(harness, sessionId) {
      if (!options.enabled()) return;
      const draft = store.load({ harness, sessionId });
      if (draft === null) return;
      if (handle) handle.restore(draft);
      else pending = draft;
    },

    rollback(snapshot) {
      pending = null;
      handle?.replace(snapshot);
    },
  };
}
