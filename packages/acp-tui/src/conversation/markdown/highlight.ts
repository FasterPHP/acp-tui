// Syntax highlighting of code rows (mvp-rendering design decision 8, tasks
// 8.3 to 8.6; spec tui-rendering "Syntax highlighting").
//
// Highlighting never decides a row: code.ts lays a block out from its text,
// and marks the spans of a block in a language with a grammar with their
// place in the block's source (`Span.code`). Here those spans are recoloured
// with the `code.*` tokens of the captures OpenTUI's tree-sitter worker
// returns (theme/code.ts maps a scope by its first segment). So a highlight
// that arrives after the first frame only recolours: no height, no projection
// and no find result depends on it.
//
// The worker is asynchronous. A block's highlight is kept in a small cache by
// (filetype, text), so a block drawn again (a remount, a resize, a theme
// change) is coloured in its first frame. Requests run one at a time, and a
// request whose renderable is gone by its turn is dropped: while a message
// streams, its trailing block is replaced at every chunk, so only the newest
// text is highlighted. Nothing here runs in the projection or find path.
import { getTreeSitterClient } from "@opentui/core";
import type { SimpleHighlight } from "@opentui/core";
import { createEffect, createSignal, onCleanup, untrack, type Accessor } from "solid-js";
import { codeScopeToken } from "../../theme/code.ts";
import type { TokenName } from "../../theme/index.ts";
import { registerGrammars } from "../grammars.ts";
import type { CodeSource, Row, Span } from "./types.ts";

/** A run of a code block's source in one token (UTF-16 offsets, `[start, end)`). */
export interface HighlightRun {
  readonly start: number;
  readonly end: number;
  readonly token: TokenName;
}

/** A block's highlight: its runs in order, not overlapping; text in no run is `code.default`. */
export type Highlight = readonly HighlightRun[];

/**
 * The runs of `text` from tree-sitter's captures, resolved as OpenTUI resolves styles: where
 * captures overlap, the one with more scope segments wins, then the later one; a capture whose
 * scope names no token (`label`, `spell`) does not take part.
 */
export function highlightRuns(text: string, captures: readonly SimpleHighlight[]): Highlight {
  const n = text.length;
  const token: (TokenName | undefined)[] = new Array(n);
  const rank = new Int16Array(n);
  captures.forEach(([start, end, group]) => {
    const t = codeScopeToken(group);
    if (t === null) return;
    const specificity = group.split(".").length;
    for (let i = Math.max(0, start); i < Math.min(end, n); i++) {
      if (specificity >= rank[i]!) {
        rank[i] = specificity;
        token[i] = t;
      }
    }
  });
  const runs: HighlightRun[] = [];
  let i = 0;
  while (i < n) {
    const t = token[i];
    let j = i + 1;
    while (j < n && token[j] === t) j++;
    if (t !== undefined && t !== "code.default") runs.push({ start: i, end: j, token: t });
    i = j;
  }
  return runs;
}

/** A span's text recoloured by `runs` from its place in the source: split where the token
 *  changes; unchanged when no run touches it. */
function recolour(span: Span, at: number, runs: Highlight): Span[] {
  const end = at + span.text.length;
  // The first run that ends after the span starts (runs are ordered).
  let lo = 0;
  let hi = runs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (runs[mid]!.end <= at) lo = mid + 1;
    else hi = mid;
  }
  if (lo >= runs.length || runs[lo]!.start >= end) return [span];
  const out: Span[] = [];
  let pos = at;
  const piece = (from: number, to: number, token: TokenName) => {
    if (to <= from) return;
    out.push({ ...span, token, text: span.text.slice(from - at, to - at), code: { source: span.code!.source, at: from } });
  };
  for (let k = lo; k < runs.length && runs[k]!.start < end; k++) {
    const run = runs[k]!;
    piece(pos, Math.max(pos, run.start), span.token);
    piece(Math.max(pos, run.start), Math.min(end, run.end), run.token);
    pos = Math.min(end, run.end);
  }
  piece(pos, end, span.token);
  return out;
}

/** `rows` with every highlightable span recoloured by its block's highlight, where `lookup` has
 *  one; the rows' text and count are unchanged. */
export function highlightRows(rows: readonly Row[], lookup: (source: CodeSource) => Highlight | undefined): readonly Row[] {
  let changed = false;
  const out = rows.map((row) => {
    if (!row.spans.some((s) => s.code)) return row;
    const spans: Span[] = [];
    let touched = false;
    for (const span of row.spans) {
      const runs = span.code ? lookup(span.code.source) : undefined;
      if (!runs || runs.length === 0) {
        spans.push(span);
        continue;
      }
      const parts = recolour(span, span.code!.at, runs);
      if (parts.length !== 1 || parts[0] !== span) touched = true;
      spans.push(...parts);
    }
    if (!touched) return row;
    changed = true;
    return { ...row, spans };
  });
  return changed ? out : rows;
}

/** The distinct code sources of `rows`. */
export function codeSources(rows: readonly Row[]): CodeSource[] {
  const out = new Set<CodeSource>();
  for (const row of rows) for (const span of row.spans) if (span.code) out.add(span.code.source);
  return [...out];
}

// -- The cache and the worker ------------------------------------------------------------------

/** Highlights kept (one per block text and filetype; least recently used dropped first). */
const CACHE_SIZE = 512;
const cache = new Map<string, Highlight>();

const keyOf = (source: CodeSource) => `${source.filetype}\u0000${source.text}`;

/** A source's highlight if the worker has given it, else undefined. */
export function cachedHighlight(source: CodeSource): Highlight | undefined {
  const key = keyOf(source);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

function remember(source: CodeSource, highlight: Highlight): void {
  cache.set(keyOf(source), highlight);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
}

/** Forgets every highlight (tests). */
export function clearHighlightCache(): void {
  cache.clear();
}

/** How a highlight is obtained: OpenTUI's tree-sitter worker, or a test's stand-in. */
export type Highlighter = (source: CodeSource) => Promise<readonly SimpleHighlight[] | null>;

const treeSitter: Highlighter = async (source) => {
  registerGrammars();
  const result = await getTreeSitterClient().highlightOnce(source.text, source.filetype);
  return result.error ? null : (result.highlights ?? []);
};

let highlighter: Highlighter = treeSitter;

/** Replaces the highlighter (tests: a stand-in, or one held back to see the first frame);
 *  `undefined` restores tree-sitter. */
export function setHighlighter(next: Highlighter | undefined): void {
  highlighter = next ?? treeSitter;
}

interface Job {
  readonly source: CodeSource;
  readonly wanted: () => boolean;
  readonly done: () => void;
}

const queue: Job[] = [];
let running = false;

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const job = queue.shift();
      if (!job) break;
      if (!job.wanted()) continue;
      if (!cachedHighlight(job.source)) {
        let captures: readonly SimpleHighlight[] | null = null;
        try {
          captures = await highlighter(job.source);
        } catch {
          captures = null;
        }
        // A failed highlight (the worker reset or gone, a grammar that did not load) is not
        // remembered: the block stays in code.default, and the next drawing of it asks again.
        if (!captures) continue;
        remember(job.source, highlightRuns(job.source.text, captures));
      }
      if (job.wanted()) job.done();
    }
  } finally {
    running = false;
  }
}

/**
 * Asks for the highlights of `sources` that are not cached; `done` runs once for each that
 * arrives while `wanted()` still holds. Never synchronous: `done` runs from the worker's answer.
 */
export function requestHighlights(sources: readonly CodeSource[], wanted: () => boolean, done: () => void): void {
  let queued = false;
  for (const source of sources) {
    if (cachedHighlight(source)) continue;
    queue.push({ source, wanted, done });
    queued = true;
  }
  if (queued) void pump();
}

/** `rows` coloured with the highlights cached so far. */
export function highlightNow(rows: readonly Row[]): readonly Row[] {
  return highlightRows(rows, cachedHighlight);
}

/**
 * For a component that draws code rows (an expanded tool card's fenced output): `rows` coloured
 * with what is cached, and coloured again as each missing highlight arrives. The row count never
 * changes.
 */
export function createHighlightedRows(rows: Accessor<readonly Row[]>): Accessor<readonly Row[]> {
  const [version, setVersion] = createSignal(0);
  createEffect(() => {
    const current = rows();
    let alive = true;
    onCleanup(() => (alive = false));
    untrack(() => requestHighlights(codeSources(current), () => alive, () => setVersion((v) => v + 1)));
  });
  return () => {
    version();
    return highlightNow(rows());
  };
}
