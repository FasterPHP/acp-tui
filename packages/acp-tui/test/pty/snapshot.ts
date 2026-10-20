// Screen snapshots for the PTY harness (phase 1a, tasks 2.4 and 2.5): text,
// cell attributes and the cursor, for the main screen before start and after
// exit, and for comparing a resized screen with a fresh instance.
import type { Terminal as XTerm } from "@xterm/headless";

export interface ScreenSnapshot {
  cols: number;
  rows: number;
  /** Which buffer this is: the normal (main) screen, or the alternate screen. */
  buffer: "normal" | "alternate";
  /** Buffer lines, right-trimmed: the whole buffer (scrollback included) or just the viewport. */
  lines: string[];
  /**
   * Cells with non-default attributes, sparse, as `y:x:signature` in reading
   * order; `y` indexes `lines`. The signature is `fg/bg/flags`: colour mode and
   * value for each, then the set of b(old) i(talic) d(im) u(nderline) k(blink)
   * v(inverse) h(idden) s(trike) o(verline).
   */
  attrs: string[];
  /** Cursor cell within the viewport (0-based), and whether it is visible is not tracked. */
  cursor: { x: number; y: number };
}

function signature(cell: import("@xterm/headless").IBufferCell): string {
  const flags =
    (cell.isBold() ? "b" : "") +
    (cell.isItalic() ? "i" : "") +
    (cell.isDim() ? "d" : "") +
    (cell.isUnderline() ? "u" : "") +
    (cell.isBlink() ? "k" : "") +
    (cell.isInverse() ? "v" : "") +
    (cell.isInvisible() ? "h" : "") +
    (cell.isStrikethrough() ? "s" : "") +
    (cell.isOverline() ? "o" : "");
  const fg = cell.isFgDefault() ? "" : `${cell.isFgRGB() ? "rgb" : "p"}${cell.getFgColor()}`;
  const bg = cell.isBgDefault() ? "" : `${cell.isBgRGB() ? "rgb" : "p"}${cell.getBgColor()}`;
  return `${fg}/${bg}/${flags}`;
}

export function snapshotBuffer(
  term: XTerm,
  which: "normal" | "active",
  scope: "all" | "viewport",
): ScreenSnapshot {
  const buf = which === "normal" ? term.buffer.normal : term.buffer.active;
  const first = scope === "all" ? 0 : buf.baseY;
  const lines: string[] = [];
  const attrs: string[] = [];
  const scratch = buf.getNullCell();
  for (let abs = first; abs < buf.length; abs++) {
    const line = buf.getLine(abs);
    const y = abs - first;
    // Visible columns only: after the terminal narrows, xterm keeps the cells beyond the new
    // width in the line (to show them again if it widens), and they are not on screen.
    lines.push((line?.translateToString(true, 0, term.cols) ?? "").trimEnd());
    if (!line) continue;
    for (let x = 0; x < term.cols; x++) {
      const cell = line.getCell(x, scratch);
      if (!cell) continue;
      const sig = signature(cell);
      if (sig !== "//") attrs.push(`${y}:${x}:${sig}`);
    }
  }
  return {
    cols: term.cols,
    rows: term.rows,
    buffer: buf.type,
    lines,
    attrs,
    cursor: { x: buf.cursorX, y: buf.cursorY },
  };
}

export interface DiffOptions {
  /** Compare the cursor cell; default true. */
  cursor?: boolean;
  /** Compare cell attributes; default true. */
  attrs?: boolean;
}

/** Human-readable differences between two snapshots; empty when they are equal. */
export function diffSnapshots(a: ScreenSnapshot, b: ScreenSnapshot, opts: DiffOptions = {}): string[] {
  const out: string[] = [];
  if (a.cols !== b.cols || a.rows !== b.rows) out.push(`size ${a.cols}x${a.rows} vs ${b.cols}x${b.rows}`);
  const n = Math.max(a.lines.length, b.lines.length);
  for (let y = 0; y < n; y++) {
    if ((a.lines[y] ?? "") !== (b.lines[y] ?? "")) {
      out.push(`row ${y}: ${JSON.stringify(a.lines[y] ?? null)} vs ${JSON.stringify(b.lines[y] ?? null)}`);
    }
  }
  if (opts.attrs ?? true) {
    const inA = new Set(a.attrs);
    const inB = new Set(b.attrs);
    for (const s of a.attrs) if (!inB.has(s)) out.push(`attr only in first: ${s}`);
    for (const s of b.attrs) if (!inA.has(s)) out.push(`attr only in second: ${s}`);
  }
  if ((opts.cursor ?? true) && (a.cursor.x !== b.cursor.x || a.cursor.y !== b.cursor.y)) {
    out.push(`cursor ${a.cursor.x},${a.cursor.y} vs ${b.cursor.x},${b.cursor.y}`);
  }
  return out;
}
