// Shared by busy.pty.test.ts and busy.pty.timing.test.ts (split by the change parallel-tests, tasks 3.x). Not a test file.
import { configEnv } from "../pty/config-home.ts";
import type { PtySession } from "../pty/harness.ts";
import { promptBox } from "../pty/regions.ts";

export const SIZE = { cols: 63, rows: 21 };
/** The track's cells at 63 columns (40 per cent of the border, the default). */
export const TRACK = 25;
/** The flat theme's palette indices (no OSC 10 and 11 replies): the busy token's bright blue (not
 *  the focused frame's accent blue, 4), warning yellow. */
export const BUSY = 12;
export const ACCENT = 4;
export const WARNING = 3;

export type Style = "gap" | "colour" | "border";
export const STYLES: readonly Style[] = ["gap", "colour", "border"];

/** The settings of a run: compact density (the helpers' default) and the busy section. */
export const busyEnv = (busy: object) => configEnv({ density: "compact", busy });

/** Index of the prompt box's top border row. */
export function topRow(s: PtySession): number {
  const rows = s.screenText();
  const box = promptBox(s);
  return rows.findIndex((row, y) => row === box[0] && rows[y + box.length - 1] === box.at(-1));
}

export interface Indicator {
  /** The column of its first cell. */
  readonly x: number;
  /** Its position in half cells: twice the cell, plus one when it starts with a half glyph. */
  readonly half: number;
  /** The cells from its first to its last (heavy line or blank, the half glyphs included). */
  readonly cells: string;
}

/** The indicator in a top border row: from the first cell of its track that is not the plain line
 *  to the last, or null when the track is plain. */
export function indicator(line: string, track: number): Indicator | null {
  const cells = [...line].slice(2, 2 + track);
  const first = cells.findIndex((c) => c !== "─");
  if (first < 0) return null;
  const last = cells.length - 1 - [...cells].reverse().findIndex((c) => c !== "─");
  return { x: 2 + first, half: 2 * first + (cells[first] === "╼" || cells[first] === "╴" ? 1 : 0), cells: cells.slice(first, last + 1).join("") };
}

/** The indicator in the screen's top border and the foreground of its first heavy cell (null when it
 *  has none, as a gap has not), or null when the border is plain. */
export function segment(s: PtySession, track = TRACK): (Indicator & { fg: number | null }) | null {
  const y = topRow(s);
  const found = y < 0 ? null : indicator(s.screenText()[y] ?? "", track);
  if (!found) return null;
  const heavy = [...found.cells].findIndex((c) => c === "━" || c === "╼" || c === "╾");
  if (heavy < 0) return { ...found, fg: null };
  const cell = s.cell(s.term.buffer.active.baseY + y, found.x + heavy);
  return { ...found, fg: cell?.isFgPalette() ? cell.getFgColor() : null };
}

/** The foreground of the border's plain line beside the indicator (the first `─` of the track). */
export function lineFg(s: PtySession, track: number): number | null {
  const y = topRow(s);
  const x = [...(s.screenText()[y] ?? "")].slice(2, 2 + track).findIndex((c) => c === "─");
  const cell = x < 0 ? undefined : s.cell(s.term.buffer.active.baseY + y, 2 + x);
  return cell?.isFgPalette() ? cell.getFgColor() : null;
}

/** The rows of two screens that differ, the elapsed time in `running Ns` ignored. */
export function changedRows(a: string[], b: string[]): number[] {
  const norm = (row: string) => row.replace(/running \d+s/, "running Ns");
  return a.flatMap((row, y) => (norm(row) === norm(b[y] ?? "") ? [] : [y]));
}

export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

/** Waits until the first tool call has completed and the silent gap begins. */
export async function inGap(s: PtySession): Promise<void> {
  await s.waitFor((p) => p.screenText().some((row) => row.includes("✓") && row.includes("Router.php")), 5000);
}
