// The `@` file picker's list source (mvp-chrome-and-keys design D9, spec
// tui-palette "File picker"): the files under the session's `cwd`, built off
// the input path when `@` opens and streamed into the list in batches.
//
// In a git work tree the list is `git ls-files --cached --others
// --exclude-standard -z`, run with an argument list (never through a shell) and
// with `git` resolved from the `PATH` first (src/agent/which.ts: never a `git`
// or `git.cmd` in the session directory), so
// it follows exactly Git's own ignore rules, nested `.gitignore` files
// included. Anywhere else (git fails, or is not installed) it is a directory
// walk that skips `.git` and follows each directory's `.gitignore` through the
// built-in matcher (src/overlay/gitignore.ts); symbolic links are listed, never
// followed. Either way the list stops at `FILE_CAP` paths.
//
// The list is kept in alphabetical order (`comparePaths`, `PathList`), whatever order the sources
// produce it in.
//
// The rest is pure: fuzzy matching on the typed text (`rankFiles`), the name
// shown (`displayPath`, sanitised; the real path is never drawn) and the link's
// URI (`fileUri`, percent-encoded from the real path).
import { opendir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sanitise } from "acp-model";
import { resolveProgram, type Env } from "../agent/which.ts";
import { isIgnored, parseGitignore, type IgnoreRule } from "./gitignore.ts";

/** The list holds at most this many paths. */
export const FILE_CAP = 100_000;

/** The walk hands paths over at least this often (a batch per directory otherwise). */
const WALK_BATCH = 500;

export interface FileListSink {
  /** More paths, relative to the `cwd`, `/`-separated. */
  add(paths: readonly string[]): void;
  /** The list is complete: `capped` when it stopped at the cap. Not called once aborted. */
  done(result: { readonly source: "git" | "walk"; readonly capped: boolean }): void;
}

export interface FileListOptions {
  readonly signal?: AbortSignal;
  /** Default `FILE_CAP`. */
  readonly cap?: number;
  /** Skip `git ls-files` and walk (tests). */
  readonly walkOnly?: boolean;
  /** The environment `git` is found on (its `PATH`) and run with; default `process.env` (tests). */
  readonly env?: Env;
}

/** Lists the files under `cwd` into `sink`, in batches, without blocking the input path. */
export async function listFiles(cwd: string, sink: FileListSink, options: FileListOptions = {}): Promise<void> {
  const cap = options.cap ?? FILE_CAP;
  const signal = options.signal;
  if (!options.walkOnly) {
    const git = await gitFiles(cwd, sink, cap, signal, options.env ?? process.env);
    if (git !== null) {
      if (!signal?.aborted) sink.done({ source: "git", capped: git.capped });
      return;
    }
  }
  const walked = await walkFiles(cwd, sink, cap, signal);
  if (!signal?.aborted) sink.done({ source: "walk", capped: walked.capped });
}

/**
 * `git ls-files` in `cwd`; null when git is missing or `cwd` is not in a work tree (it exits with
 * an error before listing anything), so the caller walks instead.
 */
async function gitFiles(cwd: string, sink: FileListSink, cap: number, signal: AbortSignal | undefined, env: Env): Promise<{ capped: boolean } | null> {
  const git = resolveProgram("git", { env });
  if (git === null) return null;
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([git, "ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
      cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
      env: { ...env, GIT_OPTIONAL_LOCKS: "0" },
    });
  } catch {
    return null;
  }
  const stop = () => proc.kill();
  signal?.addEventListener("abort", stop, { once: true });
  const decoder = new TextDecoder();
  let rest = "";
  let count = 0;
  let capped = false;
  try {
    for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
      if (signal?.aborted) break;
      const parts = (rest + decoder.decode(chunk, { stream: true })).split("\0");
      rest = parts.pop() ?? "";
      const batch = parts.filter((p) => p !== "");
      if (count + batch.length >= cap) {
        batch.length = cap - count;
        capped = true;
      }
      count += batch.length;
      if (batch.length > 0) sink.add(batch);
      if (capped) {
        proc.kill();
        break;
      }
    }
  } finally {
    signal?.removeEventListener("abort", stop);
  }
  const code = await proc.exited;
  if (signal?.aborted || capped) return { capped };
  if (code !== 0 && count === 0) return null;
  return { capped };
}

/** The directory walk: breadth first, so the shallow files arrive first. */
async function walkFiles(root: string, sink: FileListSink, cap: number, signal: AbortSignal | undefined): Promise<{ capped: boolean }> {
  // Each directory to visit with the rules that apply in it (its parents' and its own).
  const queue: { dir: string; rules: readonly IgnoreRule[] }[] = [{ dir: "", rules: [] }];
  let pending: string[] = [];
  let count = 0;
  const flush = () => {
    if (pending.length === 0) return;
    sink.add(pending);
    pending = [];
  };
  for (let q = 0; q < queue.length; q++) {
    if (signal?.aborted) return { capped: false };
    const { dir, rules: inherited } = queue[q]!;
    const entries: { name: string; directory: boolean }[] = [];
    try {
      const handle = await opendir(join(root, dir));
      for await (const entry of handle) entries.push({ name: entry.name, directory: entry.isDirectory() });
    } catch {
      continue; // unreadable: left out
    }
    let rules = inherited;
    if (entries.some((e) => e.name === ".gitignore" && !e.directory)) {
      try {
        rules = [...inherited, ...parseGitignore(await readFile(join(root, dir, ".gitignore"), "utf8"), dir)];
      } catch {
        // unreadable: its rules are not applied
      }
    }
    entries.sort((a, b) => comparePaths(a.name, b.name));
    for (const entry of entries) {
      if (entry.directory && entry.name === ".git") continue;
      const path = `${dir}${entry.name}`;
      if (isIgnored(rules, path, entry.directory)) continue;
      if (entry.directory) {
        queue.push({ dir: `${path}/`, rules });
        continue;
      }
      pending.push(path);
      count++;
      if (count >= cap) {
        flush();
        return { capped: true };
      }
      if (pending.length >= WALK_BATCH) flush();
    }
    flush();
    // Drop visited entries so a huge tree's queue does not hold them all.
    if (q > 4096) {
      queue.splice(0, q + 1);
      q = -1;
    }
  }
  flush();
  return { capped: false };
}

/**
 * Compares two paths already lower-cased, by code unit, except that `/` sorts before every other
 * character, so a directory's files stay together (`docs/x` before `docs-old/y`, as in a tree).
 */
export function compareLower(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const ca = a.charCodeAt(i);
    const cb = b.charCodeAt(i);
    if (ca !== cb) return (ca === 47 ? -1 : ca) - (cb === 47 ? -1 : cb);
  }
  return a.length - b.length;
}

/**
 * The list's order: case-insensitive alphabetical on the full path (`compareLower` on the
 * lower-cased paths), the exact path breaking a tie so the order is total. `lowerA` and `lowerB`
 * are the paths lower-cased, when the caller has them.
 */
export function comparePaths(a: string, b: string, lowerA: string = a.toLowerCase(), lowerB: string = b.toLowerCase()): number {
  return compareLower(lowerA, lowerB) || (a < b ? -1 : a > b ? 1 : 0);
}

/** The picker's paths and their lower-cased forms (`paths[i]` and `lower[i]`), kept in
 *  `comparePaths` order as batches are merged in, whatever order each batch arrives in. The arrays
 *  are never changed in place (each batch makes new ones), so indices into an earlier `paths` stay
 *  valid for that array. */
export class PathList {
  paths: readonly string[] = [];
  lower: readonly string[] = [];

  clear(): void {
    this.paths = [];
    this.lower = [];
  }

  add(batch: readonly string[]): void {
    if (batch.length === 0) return;
    const incoming = batch.map((path) => ({ path, lower: path.toLowerCase() }));
    incoming.sort((a, b) => comparePaths(a.path, b.path, a.lower, b.lower));
    const n = this.paths.length;
    // The common case (git's output is nearly in order): everything lands after the end.
    if (n === 0 || comparePaths(this.paths[n - 1]!, incoming[0]!.path, this.lower[n - 1]!, incoming[0]!.lower) <= 0) {
      this.paths = this.paths.concat(incoming.map((e) => e.path));
      this.lower = this.lower.concat(incoming.map((e) => e.lower));
      return;
    }
    const paths: string[] = new Array(n + incoming.length);
    const lower: string[] = new Array(n + incoming.length);
    let i = 0;
    let j = 0;
    let k = 0;
    while (i < n && j < incoming.length) {
      const e = incoming[j]!;
      if (comparePaths(this.paths[i]!, e.path, this.lower[i]!, e.lower) <= 0) {
        paths[k] = this.paths[i]!;
        lower[k++] = this.lower[i++]!;
      } else {
        paths[k] = e.path;
        lower[k++] = e.lower;
        j++;
      }
    }
    while (i < n) {
      paths[k] = this.paths[i]!;
      lower[k++] = this.lower[i++]!;
    }
    while (j < incoming.length) {
      paths[k] = incoming[j]!.path;
      lower[k++] = incoming[j++]!.lower;
    }
    this.paths = paths;
    this.lower = lower;
  }
}

/** A path as the picker draws it: sanitised (approval mode), with every control character left
 *  after that shown as `?`, so a name can neither style the terminal nor break the row. */
export function displayPath(path: string): string {
  return sanitise(path, "approval").replace(/[\u0000-\u001f\u007f-\u009f]/g, "?");
}

/** The `file://` URI of `relative` under `cwd`, percent-encoded from the real path. */
export function fileUri(cwd: string, relative: string): string {
  return pathToFileURL(resolve(cwd, relative)).href;
}

// Fuzzy matching: every character of the query in order (case-insensitive unless the query has
// an upper-case letter, as find's smart case), scored by an alignment that prefers matches at the
// start of a path segment or word, and consecutive matches; ties go to the path in alphabetical
// order (`comparePaths`).
const MATCH = 16;
const CONSECUTIVE = 8;
const GAP = 1;
const BONUS_SEGMENT = 10; // the path's start or after `/`
const BONUS_WORD = 8; // after `-`, `_`, `.` or a space
const BONUS_CAMEL = 7; // an upper-case letter after a lower-case one
const NONE = -1e9;

let previous = new Float64Array(256);
let current = new Float64Array(256);

function bonusAt(target: string, j: number): number {
  if (j === 0) return BONUS_SEGMENT;
  const before = target[j - 1]!;
  if (before === "/") return BONUS_SEGMENT;
  if (before === "-" || before === "_" || before === "." || before === " ") return BONUS_WORD;
  const ch = target[j]!;
  if (ch >= "A" && ch <= "Z" && before >= "a" && before <= "z") return BONUS_CAMEL;
  return 0;
}

/**
 * The score of `query` against `target` (`folded` is `target` as compared: lower-cased unless
 * case matters), or null when it does not match. Higher is better; an empty query scores 0.
 */
export function fuzzyScore(query: string, target: string, folded: string = target): number | null {
  const m = query.length;
  const n = folded.length;
  if (m === 0) return 0;
  // The cheap test first: is the query a subsequence at all?
  let k = 0;
  for (let j = 0; j < n && k < m; j++) if (folded[j] === query[k]) k++;
  if (k < m) return null;
  if (previous.length < n) {
    previous = new Float64Array(n * 2);
    current = new Float64Array(n * 2);
  }
  for (let i = 0; i < m; i++) {
    const q = query[i]!;
    let run = NONE; // the best previous-row score ending before j, less the gap since
    for (let j = 0; j < n; j++) {
      if (i > 0 && j > 0) run = Math.max(run - GAP, previous[j - 1]!);
      if (folded[j] !== q) {
        current[j] = NONE;
        continue;
      }
      const score = MATCH + bonusAt(target, j);
      if (i === 0) current[j] = score;
      else if (j === 0) current[j] = NONE;
      else current[j] = score + Math.max(run, previous[j - 1]! + CONSECUTIVE);
    }
    const swap = previous;
    previous = current;
    current = swap;
  }
  let best = NONE;
  for (let j = 0; j < n; j++) if (previous[j]! > best) best = previous[j]!;
  return best <= NONE / 2 ? null : best;
}

/** Whether `query` makes matching case-sensitive (smart case). */
export const caseSensitive = (query: string) => query !== query.toLowerCase();

/**
 * The paths that match `query`, best first, as indices into `paths` (`lower` holds the same
 * paths lower-cased). With an empty query every path, in the order listed (a `PathList` lists
 * them alphabetically); equal scores go in `comparePaths` order. Only `among` is
 * searched when given (the matches of a shorter query, while the list has not grown since).
 */
export function rankFiles(query: string, paths: readonly string[], lower: readonly string[], among?: readonly number[]): number[] {
  if (query === "") return among ? [...among] : paths.map((_, i) => i);
  const sensitive = caseSensitive(query);
  const q = sensitive ? query : query.toLowerCase();
  const scored: { index: number; score: number }[] = [];
  const visit = (i: number) => {
    const score = fuzzyScore(q, paths[i]!, sensitive ? paths[i]! : lower[i]!);
    if (score !== null) scored.push({ index: i, score });
  };
  if (among) for (const i of among) visit(i);
  else for (let i = 0; i < paths.length; i++) visit(i);
  scored.sort((a, b) => b.score - a.score || comparePaths(paths[a.index]!, paths[b.index]!, lower[a.index], lower[b.index]));
  return scored.map((s) => s.index);
}
