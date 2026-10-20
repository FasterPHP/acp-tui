// The find bar's row; design of record 6.3 "Find". Pure: segments from the
// query, the hit count and the key map's labels, fitted to the width.
//
//   find: needle▏  3 of 17  · enter next · shift+enter previous · tab go to · esc back
//
// Before the first Enter the counter shows how many hits the query has
// (`17 hits`); after it, the current one (`3 of 17`). The hints drop from the
// right as the width shrinks; the query keeps its tail (where the typing is).
import { stripAnsiSequences } from "@opentui/core";
import { actionLabel, type KeyMap } from "../keys/keymap.ts";
import { findPreviousLabel, newlineHintState, type NewlineHintState } from "../keys/newline-hint.ts";
import { displayWidth, fitSegments, type Segment } from "../layout/segments.ts";

export const FIND_LABEL = "find: ";

/** The counter: `3 of 17`, `17 hits`, `1 hit`, `no hits`, or nothing for an empty query. */
export function counterText(query: string, hits: number, current: number): string {
  if (query === "") return "";
  if (hits === 0) return "no hits";
  if (current >= 0) return `${current + 1} of ${hits}`;
  return hits === 1 ? "1 hit" : `${hits} hits`;
}

export interface BarSegment extends Segment {
  /** The cell drawn as the input cursor (inverse video). */
  readonly cursor?: boolean;
}

function hint(label: string | null, text: string): Segment[] {
  return label ? [{ text: " · ", token: "muted", breakBefore: true }, { text: `${label} ${text}`, token: "muted" }] : [];
}

/** The keys' hints, from the key map in use; "previous" names `ctrl+enter` only in Windows Terminal
 *  without kitty, as the prompt box's newline hint does (keys/newline-hint.ts). */
export function barHints(keyMap: KeyMap, terminal: NewlineHintState = newlineHintState()): Segment[] {
  return [
    ...hint(actionLabel(keyMap, "find", "next"), "next"),
    ...hint(findPreviousLabel(keyMap, terminal), "previous"),
    ...hint(actionLabel(keyMap, "find", "conversation"), "go to"),
    ...hint(actionLabel(keyMap, "find", "close"), "back"),
  ];
}

/**
 * The row: the label, the query (its tail when it is too long) and the cursor cell, the counter,
 * then the hints as far as they fit. Never wider than `width`.
 */
export function barRow(input: { query: string; hits: number; current: number; width: number; hints: readonly Segment[] }): BarSegment[] {
  const counter = counterText(input.query, input.hits, input.current);
  const tail: BarSegment[] = counter === "" ? [] : [{ text: "  ", token: "muted" as const }, { text: counter, token: input.hits === 0 ? ("warning" as const) : ("muted" as const) }];
  // Room for the query: everything but the label, the cursor cell and the counter.
  const room = Math.max(1, input.width - displayWidth(FIND_LABEL) - 1 - (counter === "" ? 0 : 2 + displayWidth(counter)));
  let query = input.query;
  if (displayWidth(query) > room) {
    const chars = Array.from(query);
    while (chars.length > 0 && displayWidth(chars.join("")) > room - 1) chars.shift();
    query = `…${chars.join("")}`;
  }
  const head: BarSegment[] = [
    { text: FIND_LABEL, token: "accent" },
    { text: query, token: "text" },
    { text: " ", token: "text", cursor: true },
  ];
  const fixed = [...head, ...tail];
  const used = fixed.reduce((w, s) => w + displayWidth(s.text), 0);
  if (used > input.width) return fitSegments(fixed, input.width);
  // Hints are separator and text pairs; whole pairs only.
  const out: BarSegment[] = fixed.filter((s) => s.text !== "" || s.cursor);
  let left = input.width - used;
  for (let i = 0; i + 1 < input.hints.length; i += 2) {
    const pair = [input.hints[i]!, input.hints[i + 1]!];
    const w = displayWidth(pair[0]!.text) + displayWidth(pair[1]!.text);
    if (w > left) break;
    out.push(...pair);
    left -= w;
  }
  return out;
}

/**
 * Pasted text as query text (mvp-conversation design D11): escape sequences removed, each line
 * break (CR, LF or CRLF) and tab a space, any other control character dropped.
 */
export function pasteQuery(text: string): string {
  return stripAnsiSequences(text)
    .replace(/\r\n|[\r\n\t]/g, " ")
    .replace(/[\x00-\x1f\x7f-\x9f]/g, "");
}
