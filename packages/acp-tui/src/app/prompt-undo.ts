// Undo and redo for the prompt box's draft (day-two-feedback task group 9, design D7; spec
// tui-keymap "Undo and redo in the prompt box"). OpenTUI's edit buffer keeps a history of its own
// with one entry per typed character or backspace (and per paste or insert); this groups those
// entries into the steps a user expects, on top of it, without keeping a second copy of the draft
// that the edit buffer's extmarks would not follow.
//
// How: the draft's text is read at every point where an edit can have happened (`sync`: before
// each key that reaches the textarea, after its content-change event, and around the programmatic
// edits), so the difference from the text last seen is, in practice, one key's edit. A run of
// typed characters is one step up to and including the first space or newline after a word, and
// one that starts by typing over a selection takes the selection's deletion into the same step; a
// run of single deletions is one step; anything else (a paste, a cut, a deleted selection, an
// inserted mention or command, a recalled prompt) is a step of its own. A run ends at a
// cursor move (a key that moves it, or an edit that does not continue where the last one ended),
// and after a pause. A step is a pair of texts, and undoing it asks the edit buffer to undo, once
// per native entry, until the draft is the text before the step; redoing asks it to redo until
// the text after (so the steps never need to know how many entries they hold). The history
// starts afresh with `reset` (a prompt sent, a session switched), which clears the edit buffer's.
//
// Pure apart from the textarea handle it is given (`UndoTarget`); no OpenTUI import.

/** What the draft's undo needs from the textarea. */
export interface UndoTarget {
  /** The draft now (`plainText`). */
  text(): string;
  /** One step of the edit buffer's own history; false when there is none. */
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Forgets the edit buffer's history. */
  clearHistory(): void;
}

export interface PromptUndoOptions {
  /** A pause longer than this ends a run of typing or deletion; default 1000 ms. */
  readonly pauseMs?: number;
  /** The clock; default `Date.now`. */
  readonly now?: () => number;
}

export interface PromptUndo {
  /** Reads the draft and records what changed since the last read. */
  sync(): void;
  /** Runs an edit that is one step whatever it does (a paste, a cut, a mention, a command). */
  atomic(edit: () => void): void;
  /** A key reached the textarea: records the edit before it, and ends the run if it moves the cursor. */
  keyDown(key: { readonly name?: string; readonly ctrl?: boolean; readonly meta?: boolean }): void;
  /** Ends the current run (a click moved the cursor). */
  boundary(): void;
  /** Undoes one step; false when there is none. */
  undo(): boolean;
  /** Redoes one step; false when there is none. */
  redo(): boolean;
  /** The history starts afresh: a prompt was sent, or the session changed. */
  reset(): void;
  /** How many steps can be undone and redone (tests). */
  readonly depth: { readonly undo: number; readonly redo: number };
}

interface Step {
  readonly before: string;
  readonly after: string;
}

interface Run {
  readonly kind: "insert" | "delete";
  readonly before: string;
  after: string;
  /** Where the next edit must be to continue the run: after the last insertion, or where the last
   *  deletion started. */
  at: number;
  /** When the last edit of the run was seen. */
  lastAt: number;
  /** A word and the space after it are in: the run is a whole step. */
  closed: boolean;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function graphemes(text: string): number {
  let n = 0;
  for (const _ of segmenter.segment(text)) n++;
  return n;
}

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;
const isSpace = (char: string) => char === " " || char === "\n" || char === "\t";

/** What changed between two texts: the common start and end are kept, never inside a surrogate pair. */
export function diffText(before: string, after: string): { start: number; removed: string; inserted: string } {
  const limit = Math.min(before.length, after.length);
  let start = 0;
  while (start < limit && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  if (start > 0 && start < limit + 1 && isHigh(before.charCodeAt(start - 1)) && (isLow(before.charCodeAt(start)) || isLow(after.charCodeAt(start)))) start--;
  let end = 0;
  while (end < limit - start && before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)) end++;
  if (end > 0 && isLow(before.charCodeAt(before.length - end)) && isHigh(before.charCodeAt(before.length - end - 1))) end--;
  return { start, removed: before.slice(start, before.length - end), inserted: after.slice(start, after.length - end) };
}

/** Keys that only move the cursor (or the selection's end), whichever way the terminal sends them. */
const MOVES = new Set(["left", "right", "up", "down", "home", "end", "pageup", "pagedown"]);
const EMACS_MOVES = new Set(["a", "e", "b", "f"]);

function movesCursor(key: { readonly name?: string; readonly ctrl?: boolean; readonly meta?: boolean }): boolean {
  const name = key.name ?? "";
  return MOVES.has(name) || ((key.ctrl === true || key.meta === true) && EMACS_MOVES.has(name));
}

export function createPromptUndo(target: UndoTarget, options: PromptUndoOptions = {}): PromptUndo {
  const pauseMs = options.pauseMs ?? 1000;
  const now = options.now ?? Date.now;
  let undoStack: Step[] = [];
  let redoStack: Step[] = [];
  let run: Run | null = null;
  let last = target.text();
  // True while the edit buffer is being walked back or forward: its changes are ours.
  let applying = false;

  /** Moves the open run onto the stack. */
  function closeRun(): void {
    if (!run) return;
    undoStack.push({ before: run.before, after: run.after });
    run = null;
  }

  /** A new edit (not an undo or redo) forgets what could be redone. */
  function edited(): void {
    redoStack = [];
  }

  function record(text: string): void {
    const edit = diffText(last, text);
    const before = last;
    last = text;
    edited();
    const added = graphemes(edit.inserted);
    const gone = graphemes(edit.removed);
    // A typed character that replaces a selection starts a run of typing (task 12.6): the deletion
    // and what is typed after it are one step.
    const replaces = edit.removed !== "" && added === 1;
    const kind = (edit.removed === "" || replaces) && added === 1 ? "insert" : edit.inserted === "" && gone === 1 ? "delete" : null;
    if (kind === null) {
      closeRun();
      undoStack.push({ before, after: text });
      return;
    }
    const at = now();
    const continues =
      run !== null &&
      !replaces &&
      run.kind === kind &&
      !run.closed &&
      at - run.lastAt <= pauseMs &&
      (kind === "insert" ? edit.start === run.at : edit.start === run.at || edit.start + edit.removed.length === run.at);
    if (!continues) {
      closeRun();
      run = { kind, before, after: text, at: 0, lastAt: at, closed: false };
    }
    const open = run!;
    open.after = text;
    open.lastAt = at;
    open.at = kind === "insert" ? edit.start + edit.inserted.length : edit.start;
    // A word and the space or newline after it complete the step.
    if (kind === "insert" && isSpace(edit.inserted) && edit.start > 0 && !isSpace(text.charAt(edit.start - 1))) {
      open.closed = true;
      closeRun();
    }
  }

  function sync(): void {
    if (applying) return;
    const text = target.text();
    if (text !== last) record(text);
  }

  return {
    sync,
    atomic(edit) {
      sync();
      closeRun();
      const before = last;
      edit();
      const after = target.text();
      last = after;
      if (after === before) return;
      edited();
      undoStack.push({ before, after });
    },
    keyDown(key) {
      sync();
      if (movesCursor(key)) closeRun();
    },
    boundary() {
      sync();
      closeRun();
    },
    undo() {
      sync();
      closeRun();
      const step = undoStack.pop();
      if (!step) return false;
      applying = true;
      try {
        for (let i = 0; i < 1000 && target.text() !== step.before && target.canUndo(); i++) target.undo();
      } finally {
        applying = false;
      }
      last = target.text();
      redoStack.push(step);
      return true;
    },
    redo() {
      sync();
      closeRun();
      const step = redoStack.pop();
      if (!step) return false;
      applying = true;
      try {
        for (let i = 0; i < 1000 && target.text() !== step.after && target.canRedo(); i++) target.redo();
      } finally {
        applying = false;
      }
      last = target.text();
      undoStack.push(step);
      return true;
    },
    reset() {
      undoStack = [];
      redoStack = [];
      run = null;
      target.clearHistory();
      last = target.text();
    },
    get depth() {
      return { undo: undoStack.length + (run ? 1 : 0), redo: redoStack.length };
    },
  };
}
