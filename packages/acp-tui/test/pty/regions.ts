// Reading acp-tui's screen regions (spec tui-layout) from a PTY session: the
// status row above the bottom margin, the prompt box above it (past the spacer
// and the find bar), the permission card and the activity bar above that. For
// the default layout; a test with another layout reads rows itself.
import type { PtySession } from "./harness.ts";

/** Status-row states, matched on one line of the screen (`waitFor` joins lines with `\n`). */
export const READY = /\bidle\b[^\n]*\bconnected\b/;
export const RUNNING = /\brunning\b[^\n]*\bconnected\b/;
export const REQUIRES_ACTION = /\brequires_action\b[^\n]*\bconnected\b/;
export const CARD_HEADER = "◊ Permission";
/** The `turn-state` module while the first Esc of the double Esc has armed the interrupt. */
export const INTERRUPT_ARMED = "esc again to interrupt";

/** Index of the status row: the last row with anything on it (the bottom margin is blank). */
function statusIndex(rows: readonly string[]): number {
  for (let y = rows.length - 1; y >= 0; y--) if (rows[y]!.trim() !== "") return y;
  return -1;
}

/** The status row: the row above the bottom margin. */
export function statusRow(s: PtySession): string {
  const rows = s.screenText();
  return rows[statusIndex(rows)] ?? "";
}

/** The prompt box's border rows (`╭` and `╰`), found going up from the status row, past the
 *  spacer and the find bar; null if none. */
function promptBounds(rows: readonly string[]): { top: number; bottom: number } | null {
  let bottom = statusIndex(rows) - 1;
  while (bottom >= 0 && !rows[bottom]!.startsWith("╰") && !rows[bottom]!.startsWith("│")) bottom--;
  if (bottom < 0 || !rows[bottom]!.startsWith("╰")) return null;
  for (let y = bottom - 1; y >= 0; y--) if (rows[y]!.startsWith("╭")) return { top: y, bottom };
  return null;
}

/** Index of the prompt box's top border row (`╭`); -1 if none. */
function promptTop(rows: readonly string[]): number {
  return promptBounds(rows)?.top ?? -1;
}

/**
 * Screen rows without the conversation's scroll bar: under the flat theme the bar is drawn as
 * glyphs (`│` track, `█` thumb) in the region's last column, after the two blank columns of its
 * right margin (spec tui-layout "Conversation scrollbar"), so a conversation row reads `text  │`.
 * Framed rows (a card, the prompt box) keep their frame. Right-trimmed.
 */
export function withoutBar(rows: readonly string[]): string[] {
  return rows.map((r) => (/^[│╭╰]/.test(r) ? r : r.replace(/ {2}[│█]$/, "").trimEnd()));
}

/** `s.lineText(absY)` without the conversation's scroll bar (`withoutBar`). */
export function lineWithoutBar(s: PtySession, absY: number): string {
  return withoutBar([s.lineText(absY)])[0]!;
}

/** Strips a framed row (`│ text │`) to its text, right-trimmed. */
export function unframe(row: string): string {
  return row.replace(/^│ ?/, "").replace(/ ?│$/, "").trimEnd();
}

/**
 * Whether the row directly above the prompt box is the blank row the screen draws between the
 * conversation and the prompt box (day-one-feedback task group 13): no text and the default
 * background in every column, so a conversation row (which carries the scroll bar's track, thumb
 * or glyph in its last column while the bar is on) is never taken for it.
 */
export function blankAbovePrompt(s: PtySession): boolean {
  return screenGap(s, promptTop(s.screenText()) - 1);
}

/**
 * The first screen row below the conversation, in the default layout with no card docked: the
 * prompt box's top border less the activity bar's line, which keeps its row for the whole session
 * (day-two-feedback task 13.2), and its blank row above it where that is drawn.
 */
export function conversationEnd(s: PtySession): number {
  const line = promptTop(s.screenText()) - 1;
  return screenGap(s, line - 1) ? line - 1 : line;
}

/** Whether screen row `y` is one of the screen's blank rows (spacing): no text and the default
 *  background in every column, which a conversation row with the scroll bar never is (the splash,
 *  drawn while the session has no items and no scroll bar, has blank rows that look the same). */
export function screenGap(s: PtySession, y: number): boolean {
  const rows = s.screenText();
  if (y < 0 || y >= rows.length || rows[y]!.trim() !== "") return false;
  const abs = s.term.buffer.active.baseY + y;
  for (let x = 0; x < s.cols; x++) if (!s.cell(abs, x)!.isBgDefault()) return false;
  return true;
}

/** The prompt box's rows, borders included. */
export function promptBox(s: PtySession): string[] {
  const rows = s.screenText();
  const bounds = promptBounds(rows);
  return bounds === null ? [] : rows.slice(bounds.top, bounds.bottom + 1);
}

/** The draft's rows inside the prompt box (without the frame), right-trimmed: the blank rows
 *  below the draft that the resting height adds (mvp-chrome-and-keys task 4.2) are left out, so
 *  an empty prompt box reads `[""]`. */
export function promptText(s: PtySession): string[] {
  // Without the frame; the padding row below the text (day-one-feedback), when drawn, is one of
  // the blank rows left out.
  const rows = promptBox(s).slice(1, -1).map(unframe);
  while (rows.length > 1 && rows.at(-1) === "") rows.pop();
  return rows;
}

/** The prompt box's text rows as drawn, blank ones included: its height less the frame and, when
 *  `padded` (the screen draws it unless a short pane gives it way), the padding row below the
 *  text. */
export function promptRows(s: PtySession, padded = true): number {
  return Math.max(0, promptBox(s).length - 2 - (padded ? 1 : 0));
}

/** The permission card's rows, borders included; empty when no card is docked. */
export function cardRows(s: PtySession): string[] {
  const rows = s.screenText();
  const top = rows.findIndex((r) => r.startsWith(`╭─ ${CARD_HEADER}`));
  if (top < 0) return [];
  const bottom = rows.findIndex((r, y) => y > top && r.startsWith("╰"));
  return bottom < 0 ? [] : rows.slice(top, bottom + 1);
}

/** The columns between a docked card's frame and its content (`cards.padding.columns`, 2 by
 *  default). */
export const CARD_COLUMNS = 2;

/** Strips a docked card's framed row (`│  text  │`) to its text, right-trimmed. */
export function uncard(row: string, columns = CARD_COLUMNS): string {
  return row.replace(new RegExp(`^│ {0,${columns}}`), "").replace(new RegExp(` {0,${columns}}│$`), "").trimEnd();
}

/** The card's body rows (title, preview and options) without the frame, its padding rows (blank
 *  rows at the top and the bottom, when drawn) left out. */
export function cardBody(s: PtySession): string[] {
  const rows = cardRows(s).slice(1, -1).map((row) => uncard(row));
  while (rows.length > 0 && rows[0] === "") rows.shift();
  while (rows.length > 0 && rows.at(-1) === "") rows.pop();
  return rows;
}

/** The activity bar: the row above the card, or above the prompt box when no card is docked, past
 *  the blank row between them when there is one (day-one-feedback). */
export function activityRow(s: PtySession): string | null {
  const rows = s.screenText();
  const card = rows.findIndex((r) => r.startsWith(`╭─ ${CARD_HEADER}`));
  let above = card >= 0 ? card - 1 : promptTop(rows) - 1;
  // Past a blank row only to a line that starts as the bar's do (a conversation row above the
  // idle prompt box's blank row may mention `running`).
  const gap = rows[above]?.trim() === "";
  if (gap) above--;
  const row = rows[above];
  const bar = gap ? /^ {2}(\d+ running\b|plan \d+\/\d+|awaiting permission\b)/ : /\b(running|plan \d+\/\d+|awaiting permission)\b/;
  return row !== undefined && bar.test(row) ? row : null;
}
