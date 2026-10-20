// Watching the configuration for live reload (mvp-configuration design D6; spec
// tui-config "Live reload"). `fs.watch` on the containing directories (the
// user's configuration directory, its `themes/`, the project file's directory),
// not on the files, so a save by rename (write a temporary file, rename it over
// the original) is seen and the watch survives it. Events are debounced by
// 150 ms and filtered by a hash of the watched files' contents, so a save that
// changes nothing does nothing.
//
// A directory that does not exist yet is waited for by watching its nearest
// existing ancestor; a watch that errors, or whose directory has gone, is
// re-established (after `retryMs` when it cannot be at once). The clock and
// `fs.watch` are injectable, so the tests drive both.
import { existsSync, readdirSync, readFileSync, watch as fsWatch, type FSWatcher } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

/** A directory to watch and which entries in it matter (null: the platform gave no name). */
export interface WatchTarget {
  readonly dir: string;
  readonly accept: (filename: string | null) => boolean;
}

export interface Clock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** What `fs.watch` gives: a closeable emitter of change events and errors. */
export interface DirWatcher {
  close(): void;
}

export type WatchFn = (dir: string, onEvent: (filename: string | null) => void, onError: (error: unknown) => void) => DirWatcher;

export interface WatcherOptions {
  /** The directories to watch; read again after every change (a project file may appear). */
  readonly targets: () => readonly WatchTarget[];
  /** The files whose contents decide whether anything changed. */
  readonly files: () => readonly string[];
  /** Called after a debounced change that altered a watched file's content. */
  readonly onChange: () => void;
  /** Default 150 ms (design D6). */
  readonly debounceMs?: number;
  /** Delay before re-establishing a watch that failed; default 1000 ms. */
  readonly retryMs?: number;
  readonly clock?: Clock;
  readonly watch?: WatchFn;
  /** Errors from a watch, for the debug log. */
  readonly onWatchError?: (dir: string, error: unknown) => void;
}

export interface ConfigWatcher {
  /** The content hash in use (for tests). */
  readonly hash: () => string;
  /** Forgets the content hash, so the next event reloads even when nothing changed (a save of the
   *  same file retries what the last reload could not apply: the mouse policy, design D6). */
  forget(): void;
  /** Re-checks the targets and the hash at once, as a debounced event would. */
  check(): void;
  close(): void;
}

export const DEBOUNCE_MS = 150;

const realClock: Clock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const realWatch: WatchFn = (dir, onEvent, onError) => {
  const watcher: FSWatcher = fsWatch(dir, { persistent: false }, (_event, filename) => onEvent(filename === null ? null : String(filename)));
  watcher.on("error", onError);
  return watcher;
};

/** A hash of the files' contents (an absent file counts as absent). */
export function contentHash(files: readonly string[]): string {
  const hasher = new Bun.CryptoHasher("sha256");
  for (const file of [...files].sort()) {
    hasher.update(file);
    hasher.update("\u0000");
    try {
      hasher.update(readFileSync(file));
      hasher.update("\u0001");
    } catch {
      hasher.update("\u0002absent");
    }
    hasher.update("\u0000");
  }
  return hasher.digest("hex");
}

/** The `*.jsonc` files in a directory (none when it does not exist). */
export function jsoncFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".jsonc"))
      .map((name) => join(dir, name));
  } catch {
    return [];
  }
}

/** The nearest existing directory at or above `dir`. */
function nearestExisting(dir: string): string {
  let current = dir;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

interface Active {
  readonly target: WatchTarget;
  /** The directory actually watched: the target's, or an ancestor while it does not exist. */
  readonly watched: string;
  readonly watcher: DirWatcher | null;
}

export function createConfigWatcher(options: WatcherOptions): ConfigWatcher {
  const clock = options.clock ?? realClock;
  const watch = options.watch ?? realWatch;
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS;
  const retryMs = options.retryMs ?? 1000;
  let hash = contentHash(options.files());
  let pending: unknown = null;
  let retry: unknown = null;
  let closed = false;
  let active = new Map<string, Active>();

  const schedule = (): void => {
    if (closed) return;
    if (pending !== null) clock.clearTimeout(pending);
    pending = clock.setTimeout(() => {
      pending = null;
      check();
    }, debounceMs);
  };

  const scheduleRetry = (): void => {
    if (closed || retry !== null) return;
    retry = clock.setTimeout(() => {
      retry = null;
      establish();
      check();
    }, retryMs);
  };

  const open = (target: WatchTarget): Active => {
    const watched = nearestExisting(target.dir);
    const waiting = watched !== target.dir;
    // While waiting for the directory, any event in the ancestor on the way to it matters.
    const next = waiting ? (relative(watched, target.dir).split(sep)[0] ?? null) : null;
    try {
      const watcher = watch(
        watched,
        (filename) => {
          if (waiting ? filename === null || filename === next : target.accept(filename)) schedule();
        },
        (error) => {
          options.onWatchError?.(watched, error);
          const current = active.get(target.dir);
          current?.watcher?.close();
          active.set(target.dir, { target, watched, watcher: null });
          scheduleRetry();
        },
      );
      return { target, watched, watcher };
    } catch (error) {
      options.onWatchError?.(watched, error);
      scheduleRetry();
      return { target, watched, watcher: null };
    }
  };

  /** (Re-)establishes each target's watch where it is missing, failed or on the wrong directory. */
  const establish = (): void => {
    if (closed) return;
    const next = new Map<string, Active>();
    for (const target of options.targets()) {
      const current = active.get(target.dir);
      const wanted = nearestExisting(target.dir);
      if (current && current.watcher && current.watched === wanted && existsSync(current.watched)) {
        next.set(target.dir, { ...current, target });
        active.delete(target.dir);
      } else {
        current?.watcher?.close();
        active.delete(target.dir);
        next.set(target.dir, open(target));
      }
    }
    for (const stale of active.values()) stale.watcher?.close();
    active = next;
  };

  const check = (): void => {
    if (closed) return;
    establish();
    const now = contentHash(options.files());
    if (now === hash) return;
    hash = now;
    options.onChange();
  };

  establish();

  return {
    hash: () => hash,
    forget() {
      hash = "";
    },
    check,
    close() {
      closed = true;
      if (pending !== null) clock.clearTimeout(pending);
      if (retry !== null) clock.clearTimeout(retry);
      for (const a of active.values()) a.watcher?.close();
      active.clear();
    },
  };
}
