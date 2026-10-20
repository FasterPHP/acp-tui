// Line-based unified diff for expanded tool cards (design D9): Myers' O(ND) algorithm
// on lines, after trimming the common prefix and suffix, grouped into hunks
// with three lines of context. Implemented locally rather than adding a
// dependency. Pathological inputs (more than MAX_EDIT_DISTANCE differing
// lines after trimming) fall back to "remove all, add all" for the middle
// part, which is still a correct diff, only not a minimal one.

export type DiffOp =
  | { readonly kind: "equal"; readonly line: string; readonly oldNo: number; readonly newNo: number }
  | { readonly kind: "remove"; readonly line: string; readonly oldNo: number }
  | { readonly kind: "add"; readonly line: string; readonly newNo: number };

export interface Hunk {
  /** 1-based start lines as printed in the `@@` header (0 when the side is empty). */
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly ops: readonly DiffOp[];
}

/** One line of the printed diff, with its role for styling. */
export interface DiffLine {
  readonly kind: "file" | "hunk" | "equal" | "remove" | "add" | "note";
  readonly text: string;
}

export const DIFF_CONTEXT = 3;
/** Bound on the edit distance searched by Myers (memory grows with its square). */
export const MAX_EDIT_DISTANCE = 2000;

const NO_NEWLINE = "\\ No newline at end of file";

interface Lines {
  readonly lines: string[];
  /** The last line has no terminating newline. */
  readonly noFinalNewline: boolean;
}

function splitLines(text: string | null): Lines {
  if (text === null || text === "") return { lines: [], noFinalNewline: false };
  const lines = text.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
    return { lines, noFinalNewline: false };
  }
  return { lines, noFinalNewline: true };
}

/** Comparison keys: the last line without a newline differs from the same text with one. */
function keys(side: Lines): string[] {
  if (!side.noFinalNewline) return side.lines;
  const out = side.lines.slice();
  out[out.length - 1] = `${out.at(-1)}\u0000`;
  return out;
}

/**
 * Myers' greedy forward search over `a[aStart, aEnd)` and `b[bStart, bEnd)`; returns the edit
 * script as ops in order, or null if the distance exceeds `maxD`.
 */
function myers(a: string[], b: string[], maxD: number): ("equal" | "remove" | "add")[] | null {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max;
  const v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  const limit = Math.min(max, maxD);
  for (let d = 0; d <= limit; d++) {
    // Keep only the diagonals reachable at this d.
    trace.push(v.slice(offset - d, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)) x = v[offset + k + 1]!;
      else x = v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, n, m, d);
    }
  }
  return null;
}

function backtrack(trace: Int32Array[], n: number, m: number, dEnd: number): ("equal" | "remove" | "add")[] {
  const out: ("equal" | "remove" | "add")[] = [];
  let x = n;
  let y = m;
  for (let d = dEnd; d > 0; d--) {
    // trace[d] holds v before step d, for diagonals -d .. d+1 (index k + d).
    const row = trace[d]!;
    const at = (k: number) => row[k + d]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      out.push("equal");
      x--;
      y--;
    }
    out.push(x === prevX ? "add" : "remove");
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    out.push("equal");
    x--;
    y--;
  }
  return out.reverse();
}

/** The full line-level edit script from `oldText` to `newText` (null means a new file). */
export function diffLines(oldText: string | null, newText: string): DiffOp[] {
  const before = splitLines(oldText);
  const after = splitLines(newText);
  const a = keys(before);
  const b = keys(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const middleA = a.slice(start, endA);
  const middleB = b.slice(start, endB);
  const script =
    myers(middleA, middleB, MAX_EDIT_DISTANCE) ??
    [...middleA.map(() => "remove" as const), ...middleB.map(() => "add" as const)];

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  const equal = () => {
    ops.push({ kind: "equal", line: before.lines[i]!, oldNo: i + 1, newNo: j + 1 });
    i++;
    j++;
  };
  while (i < start) equal();
  for (const step of script) {
    if (step === "equal") equal();
    else if (step === "remove") ops.push({ kind: "remove", line: before.lines[i]!, oldNo: ++i });
    else ops.push({ kind: "add", line: after.lines[j]!, newNo: ++j });
  }
  while (i < before.lines.length) equal();
  return ops;
}

/** Groups an edit script into hunks with `context` unchanged lines around each change. */
export function toHunks(ops: readonly DiffOp[], context = DIFF_CONTEXT): Hunk[] {
  const changed: number[] = [];
  ops.forEach((op, index) => op.kind !== "equal" && changed.push(index));
  if (changed.length === 0) return [];
  const hunks: Hunk[] = [];
  let from = Math.max(0, changed[0]! - context);
  let to = Math.min(ops.length, changed[0]! + context + 1);
  const flush = () => {
    const slice = ops.slice(from, to);
    let oldLines = 0;
    let newLines = 0;
    let oldStart = 0;
    let newStart = 0;
    for (const op of slice) {
      if (op.kind !== "add") {
        if (oldLines === 0) oldStart = op.oldNo;
        oldLines++;
      }
      if (op.kind !== "remove") {
        if (newLines === 0) newStart = op.newNo;
        newLines++;
      }
    }
    // An empty side is printed as starting at the line before the hunk (unified diff convention).
    if (oldLines === 0) oldStart = lineBefore(ops, from, "old");
    if (newLines === 0) newStart = lineBefore(ops, from, "new");
    hunks.push({ oldStart, oldLines, newStart, newLines, ops: slice });
  };
  for (const index of changed.slice(1)) {
    if (index - context <= to) {
      to = Math.min(ops.length, index + context + 1);
    } else {
      flush();
      from = Math.max(0, index - context);
      to = Math.min(ops.length, index + context + 1);
    }
  }
  flush();
  return hunks;
}

function lineBefore(ops: readonly DiffOp[], index: number, side: "old" | "new"): number {
  for (let k = index - 1; k >= 0; k--) {
    const op = ops[k]!;
    if (side === "old" && op.kind !== "add") return op.oldNo;
    if (side === "new" && op.kind !== "remove") return op.newNo;
  }
  return 0;
}

function range(start: number, count: number): string {
  return count === 1 ? `${start}` : `${start},${count}`;
}

/**
 * The printed unified diff: `---`/`+++` file lines, `@@` hunk headers, then ` `, `-` and `+`
 * lines. `\ No newline at end of file` follows a last line that has none.
 */
export function unifiedDiff(path: string, oldText: string | null, newText: string, context = DIFF_CONTEXT): DiffLine[] {
  const ops = diffLines(oldText, newText);
  const hunks = toHunks(ops, context);
  const oldCount = splitLines(oldText);
  const newCount = splitLines(newText);
  const out: DiffLine[] = [
    { kind: "file", text: oldText === null ? "--- /dev/null" : `--- ${path}` },
    { kind: "file", text: `+++ ${path}` },
  ];
  if (hunks.length === 0) {
    out.push({ kind: "note", text: "(no changes)" });
    return out;
  }
  for (const hunk of hunks) {
    out.push({
      kind: "hunk",
      text: `@@ -${range(hunk.oldStart, hunk.oldLines)} +${range(hunk.newStart, hunk.newLines)} @@`,
    });
    for (const op of hunk.ops) {
      const prefix = op.kind === "equal" ? " " : op.kind === "remove" ? "-" : "+";
      out.push({ kind: op.kind, text: `${prefix}${op.line}` });
      const lastOld = op.kind !== "add" && oldCount.noFinalNewline && op.oldNo === oldCount.lines.length;
      const lastNew = op.kind !== "remove" && newCount.noFinalNewline && op.newNo === newCount.lines.length;
      if (lastOld || lastNew) out.push({ kind: "note", text: NO_NEWLINE });
    }
  }
  return out;
}

/** One row of a diff with line numbers (expanded tool cards, spec tui-conversation "Collapse
 *  and expand in place"): the new line's number for context and added lines, the old line's
 *  number for removed lines, none for hunk headers and notes. */
export interface NumberedDiffLine {
  readonly kind: "hunk" | "equal" | "remove" | "add" | "note";
  readonly number: number | null;
  /** `-`, `+` or a space; empty for hunk headers and notes. */
  readonly sign: string;
  readonly text: string;
}

/** The unified diff of `oldText` to `newText` as numbered rows: `@@` headers, then each line. */
export function numberedDiff(oldText: string | null, newText: string, context = DIFF_CONTEXT): NumberedDiffLine[] {
  const hunks = toHunks(diffLines(oldText, newText), context);
  const oldSide = splitLines(oldText);
  const newSide = splitLines(newText);
  const out: NumberedDiffLine[] = [];
  if (hunks.length === 0) return [{ kind: "note", number: null, sign: "", text: "(no changes)" }];
  for (const hunk of hunks) {
    out.push({
      kind: "hunk",
      number: null,
      sign: "",
      text: `@@ -${range(hunk.oldStart, hunk.oldLines)} +${range(hunk.newStart, hunk.newLines)} @@`,
    });
    for (const op of hunk.ops) {
      if (op.kind === "equal") out.push({ kind: "equal", number: op.newNo, sign: " ", text: op.line });
      else if (op.kind === "remove") out.push({ kind: "remove", number: op.oldNo, sign: "-", text: op.line });
      else out.push({ kind: "add", number: op.newNo, sign: "+", text: op.line });
      const lastOld = op.kind !== "add" && oldSide.noFinalNewline && op.oldNo === oldSide.lines.length;
      const lastNew = op.kind !== "remove" && newSide.noFinalNewline && op.newNo === newSide.lines.length;
      if (lastOld || lastNew) out.push({ kind: "note", number: null, sign: "", text: NO_NEWLINE });
    }
  }
  return out;
}
