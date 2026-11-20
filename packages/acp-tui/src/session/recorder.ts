// Recording sessions in acp-tui's own index (mvp-sessions task 4.2, design
// decision 1, spec tui-sessions "Session index" and "Session titles"). The
// recorder watches the session's snapshots (subscribe `observe` to the
// controller) and writes to the index:
//
// - a new session is recorded once the harness has answered its first prompt (its first update
//   for the turn, or the prompt's response with a stop reason, whichever comes first), never at
//   `session/new` and never for a prompt that only a JSON-RPC error answered (Auggie 1.x writes
//   a session at its first prompt, and keeps none for a refused one): the next prompt is then
//   the first again;
// - a session opened by load or resume is recorded at once (`opened`);
// - each later prompt updates the last-activity time;
// - a title the agent reports (`session_info_update`, already sanitised by
//   acp-model) replaces the stored one; until the agent reports one, the
//   title is the first line of the first prompt, cut to 80 columns.
//
// The index sanitises and flattens every title again before it is stored.
import type { Session } from "acp-model";
import { takeWidth } from "../layout/segments.ts";
import { oneLine, type SessionIndex, type SessionKey } from "./session-index.ts";

/** A title made from a prompt is cut to this many columns (spec tui-sessions "Session titles"). */
export const PROMPT_TITLE_COLUMNS = 80;

/** The first non-blank line of `text`, sanitised and cut to 80 columns; null when it is blank. */
export function promptTitle(text: string): string | null {
  for (const line of text.split(/\r\n|\r|\n/)) {
    const clean = oneLine(line);
    if (clean !== "") return takeWidth(clean, PROMPT_TITLE_COLUMNS);
  }
  return null;
}

/** The title made from the first user message a replayed history holds, else null. */
export function replayedPromptTitle(session: Pick<Session, "order" | "items">): string | null {
  for (const id of session.order) {
    const item = session.items.get(id);
    if (item?.kind === "user_message") return promptTitle(item.text);
  }
  return null;
}

/** Whose session this is, as the index records it. */
export interface SessionIdentity {
  /** The agent's name in the catalogue, or `ad hoc`. */
  readonly agent: string;
  /** The agent command, recorded for an `ad hoc` agent only (never run from the index). */
  readonly command?: readonly string[];
  /** The directories added for this session (`--add-dir`, the ones recorded earlier), written
   *  with its index entry; the configuration's are not recorded. */
  readonly addedDirectories?: readonly string[];
}

export interface SessionRecorder {
  /** Feeds one snapshot of the session (subscribe it to the controller). */
  observe(session: Session): void;
  /**
   * Records a session that was just opened by load or resume. `title` is a title known from
   * elsewhere (the agent's `session/list`, the index), used when the agent reported none while
   * opening; without either, the first replayed user message gives it.
   */
  opened(session: Session, known?: { readonly title?: string | null }): void;
  /** The directories added to the session changed (`/add-dir`): written with its entry at once
   *  when it is recorded, else with it once it is. */
  setAddedDirectories(directories: readonly string[]): void;
  /** The title the index holds for the session (the agent's, else the prompt's), or null. */
  readonly title: string | null;
  /** True once the session is in the index. */
  readonly recorded: boolean;
  /** True once the harness has answered a prompt in this run (an update for its turn, or a stop
   *  reason; an error alone does not count). */
  readonly answered: boolean;
}

export interface SessionRecorderOptions {
  readonly now?: () => number;
}

export function createSessionRecorder(index: SessionIndex, identity: SessionIdentity, options: SessionRecorderOptions = {}): SessionRecorder {
  const now = options.now ?? Date.now;
  let addedDirectories = identity.addedDirectories;
  let previous: Session | null = null;
  let key: SessionKey | null = null;
  let answered = false;
  // The turn of a first prompt that the harness has not answered yet: how many items the
  // conversation held once the prompt was in it.
  let waiting: { readonly items: number } | null = null;
  // The title made from the first prompt (or the replayed history): what a cleared agent title
  // falls back to.
  let fallbackTitle: string | null = null;
  let title: string | null = null;

  function record(session: Session, recordTitle: string | null): void {
    if (!session.id) return;
    key = { agent: identity.agent, sessionId: session.id };
    index.record({
      ...key,
      ...(identity.command ? { command: identity.command } : {}),
      directory: session.cwd ?? "",
      title: recordTitle,
      ...(addedDirectories && addedDirectories.length > 0 ? { addedDirectories } : {}),
      at: now(),
    });
  }

  function onPrompt(session: Session, text: string): void {
    if (key === null) {
      // Not recorded yet: a refused first prompt leaves nothing, and the next is the first.
      fallbackTitle = promptTitle(text);
      title = session.title ?? fallbackTitle;
      waiting = { items: session.order.length };
      return;
    }
    fallbackTitle ??= promptTitle(text);
    if (title === null && fallbackTitle !== null) {
      title = fallbackTitle;
      index.updateTitle(key, title);
    }
    index.updateActivity(key, now());
  }

  /** The harness answered the first prompt: record the session. */
  function onAnswered(session: Session): void {
    waiting = null;
    answered = true;
    title = session.title ?? fallbackTitle;
    record(session, title);
  }

  /** Whether the turn that `prev` was running ended with the harness's answer, not an error. */
  function endedAnswered(next: Session): boolean {
    const last = next.items.get(next.order[next.order.length - 1] ?? "");
    return last?.kind === "marker" && last.markerKind === "turn_end";
  }

  /** The text of the prompt that started the turn `next` is running, if one just started. */
  function promptStarted(prev: Session, next: Session): string | null {
    if (next.turn === null || next.turn === prev.turn || next.turn.startedAt === prev.turn?.startedAt) return null;
    for (let i = next.order.length - 1; i >= prev.order.length; i--) {
      const item = next.items.get(next.order[i]!);
      if (item?.kind === "user_message" && item.origin === "self") return item.text;
    }
    return null;
  }

  return {
    get title() {
      return title;
    },
    get recorded() {
      return key !== null;
    },
    get answered() {
      return answered;
    },

    observe(next) {
      const prev = previous;
      previous = next;
      if (prev === null || prev === next || next.opening !== null) return;
      const text = promptStarted(prev, next);
      if (text !== null) onPrompt(next, text);
      else if (waiting !== null && key === null) {
        // The first turn: the first item after the prompt is its first update; a stop reason
        // answers it as well, an error alone does not.
        if (next.turn !== null && next.order.length > waiting.items) onAnswered(next);
        else if (prev.turn !== null && next.turn === null) {
          if (endedAnswered(next)) onAnswered(next);
          else waiting = null;
        }
      } else if (prev.turn !== null && next.turn === null && key !== null) answered = answered || endedAnswered(next);
      if (next.title !== prev.title) {
        const changed = next.title ?? fallbackTitle;
        if (changed !== title) {
          title = changed;
          if (key !== null) index.updateTitle(key, title);
        }
      }
    },

    setAddedDirectories(directories) {
      addedDirectories = directories;
      if (key !== null && previous !== null) record(previous, title);
    },

    opened(session, known = {}) {
      previous = session;
      fallbackTitle = replayedPromptTitle(session);
      title = session.title ?? known.title ?? fallbackTitle;
      record(session, title);
    },
  };
}
