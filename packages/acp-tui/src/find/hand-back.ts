// The hand-back exit prints; design of record 6.5 "What is left in the terminal
// after exit"; decision 2, research/full-screen-synthesis.md section 4.
//
// `--exit-print last-answer` and `--exit-print transcript` print, after the
// resume line and one blank line (or at once, when there is no resume line),
// the last agent answer or the whole conversation as plain text: the same
// plain-text projection selection, copy and find use (src/selection/
// projection.ts), items joined with a blank line, turn ends left out. Each
// line has its tabs expanded (8 columns, as the cards draw them) and is
// sanitised in `approval` mode (no escape sequence, control character, bidi
// or zero-width character can reach the main screen), then wrapped at the
// terminal's width when acp-tui exits: at the last space that fits, else
// hard at the width. Nothing addresses the cursor; renderer/exit-text.ts
// writes the lines with `\n` after the terminal is back in cooked mode.
import { sanitise, type Session } from "acp-model";
import { expandTabs } from "../conversation/content.ts";
import { displayWidth, takeWidth } from "../layout/segments.ts";
import { conversationText, lastAnswerText, lookupOf } from "../selection/projection.ts";

export type HandBackMode = "last-answer" | "transcript";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** One line wrapped at `width` columns: at the last space that fits, else hard. */
export function wrapPlain(line: string, width: number): string[] {
  const w = Math.max(1, width);
  const out: string[] = [];
  let rest = line;
  while (displayWidth(rest) > w) {
    let head = takeWidth(rest, w);
    if (head === "") head = graphemes.segment(rest)[Symbol.iterator]().next().value?.segment ?? rest;
    if (rest[head.length] === " ") {
      // The row ends exactly before a space: break there and drop it.
      out.push(head.trimEnd());
      rest = rest.slice(head.length + 1);
      continue;
    }
    const cut = head.lastIndexOf(" ");
    if (cut > 0 && head.slice(0, cut).trim() !== "") {
      out.push(head.slice(0, cut).trimEnd());
      rest = rest.slice(cut + 1);
    } else {
      out.push(head);
      rest = rest.slice(head.length);
    }
  }
  out.push(rest);
  return out;
}

/** The text as it is printed: sanitised lines wrapped at `width`. */
export function plainLines(text: string, width: number): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = sanitise(expandTabs(raw), "approval").replace(/[\t\n\v\f\r]/g, " ").trimEnd();
    if (line === "") out.push("");
    else out.push(...wrapPlain(line, width));
  }
  return out;
}

/** The lines `mode` prints after the resume line, or null when there is nothing to print. */
export function handBackLines(mode: HandBackMode, session: Pick<Session, "order" | "items">, width: number): string[] | null {
  const lookup = lookupOf(session.items);
  const text = mode === "transcript" ? conversationText(session.order, lookup) : lastAnswerText(session.order, lookup);
  if (text === null || text === "") return null;
  return plainLines(text, width);
}
