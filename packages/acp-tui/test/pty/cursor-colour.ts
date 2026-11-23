// Checks the cursor colour sequences in a terminal output stream against the rule
// that the prompt box follows the terminal (colours reported by the terminal, WCAG
// contrast of at least 3:1 against its background). Used on a fixture recorded from a
// real terminal and on the output of PTY runs.
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** What the terminal reported to OSC 10, 11 and 12 queries, as `#rrggbb`. */
export interface TerminalReplies {
  foreground?: string;
  background?: string;
  cursor?: string;
}

export type CursorProblemKind =
  /** An `OSC 12` set with anything but `#rrggbb` (`default`, a name, an empty value). */
  | "non-colour"
  /** An `OSC 12` set before the first `OSC 12 ?` query: no reply, and no timeout, can have arrived. */
  | "before-replies"
  /** The last `OSC 12` set before the teardown is not the colour the rule gives for the replies. */
  | "wrong-colour"
  /** Nothing resets the cursor colour (`OSC 112`) after the last `OSC 12` set. */
  | "no-reset";

export interface CursorProblem {
  kind: CursorProblemKind;
  detail: string;
}

export interface CursorCheckOptions {
  /**
   * Tolerate `OSC 12;default` written after the alternate screen was left, when `OSC 112`
   * follows it (OpenTUI's own teardown). Off by default: the recorded failure counts it.
   */
  allowTeardownDefault?: boolean;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

/** WCAG 2 contrast ratio of two `#rrggbb` colours. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/**
 * The colour the cursor rule gives for the replies: the reported cursor colour if it reaches 3:1
 * against the reported background, else the reported foreground if it does, else `terminal` (leave
 * the terminal's own colour). Without a background, the cursor reply, else the foreground, else `terminal`.
 */
export function expectedCursorColour(replies: TerminalReplies): string {
  const { foreground, background, cursor } = replies;
  const ok = (c: string | undefined): c is string => !!c && (!background || contrastRatio(c, background) >= 3);
  if (ok(cursor)) return cursor.toLowerCase();
  if (ok(foreground) && background) return foreground.toLowerCase();
  if (!background && foreground) return foreground.toLowerCase();
  return "terminal";
}

interface Found {
  index: number;
  kind: "set" | "query" | "reset";
  value: string;
}

function cursorSequences(output: string): Found[] {
  const found: Found[] = [];
  for (const m of output.matchAll(/\x1b\](112|12;[^\x07\x1b]*)(?:\x07|\x1b\\)/g)) {
    const body = m[1]!;
    if (body === "112") found.push({ index: m.index, kind: "reset", value: "" });
    else if (body === "12;?") found.push({ index: m.index, kind: "query", value: "?" });
    else found.push({ index: m.index, kind: "set", value: body.slice(3) });
  }
  return found;
}

/** Lists what is wrong with the cursor colour sequences in `output`, given what the terminal replied. */
export function cursorColourProblems(output: string, replies: TerminalReplies, opts: CursorCheckOptions = {}): CursorProblem[] {
  const problems: CursorProblem[] = [];
  const seq = cursorSequences(output);
  const leftAlt = output.lastIndexOf("\x1b[?1049l");
  const afterTeardown = (s: Found) => leftAlt >= 0 && s.index > leftAlt;
  const sets = seq.filter((s) => s.kind === "set");

  for (const s of sets) {
    if (HEX.test(s.value)) continue;
    const tolerated = opts.allowTeardownDefault && afterTeardown(s) && seq.some((r) => r.kind === "reset" && r.index > s.index);
    if (!tolerated) problems.push({ kind: "non-colour", detail: `OSC 12 set to ${JSON.stringify(s.value)} at byte ${s.index}` });
  }

  const firstQuery = seq.find((s) => s.kind === "query");
  const early = sets.find((s) => !firstQuery || s.index < firstQuery.index);
  if (early) {
    problems.push({ kind: "before-replies", detail: `OSC 12;${early.value} at byte ${early.index} before any OSC 12 query${firstQuery ? ` (at ${firstQuery.index})` : ""}` });
  }

  const live = sets.filter((s) => HEX.test(s.value) && !afterTeardown(s));
  const last = live[live.length - 1];
  const expected = expectedCursorColour(replies);
  if (expected === "terminal") {
    if (last && !seq.some((r) => r.kind === "reset" && r.index > last.index)) {
      problems.push({ kind: "wrong-colour", detail: `the terminal's own colour was expected but ${last.value} was written` });
    }
  } else if (!last) {
    problems.push({ kind: "wrong-colour", detail: `${expected} was expected but no colour was written` });
  } else if (last.value.toLowerCase() !== expected) {
    problems.push({ kind: "wrong-colour", detail: `${expected} was expected but the last colour written was ${last.value}` });
  }

  const lastSet = sets[sets.length - 1];
  if (lastSet && !seq.some((r) => r.kind === "reset" && r.index > lastSet.index)) {
    problems.push({ kind: "no-reset", detail: `no OSC 112 after the last OSC 12 set (byte ${lastSet.index})` });
  }
  return problems;
}

/**
 * Turns a fixture of escaped lines (`\x1b`, `\x07`, `\\`; `<n>` for n bytes of text; `#` comment
 * lines) back into the bytes it describes, with `x` for the text.
 */
export function parseEscapedFixture(text: string): string {
  let out = "";
  for (const line of text.split("\n")) {
    if (line === "" || line.startsWith("#")) continue;
    const run = /^<(\d+)>$/.exec(line);
    if (run) out += "x".repeat(Number(run[1]));
    else out += line.replace(/<\d+>|\\x([0-9a-f]{2})|\\\\/g, (m, h?: string) => (h ? String.fromCharCode(parseInt(h, 16)) : m === "\\\\" ? "\\" : "x".repeat(Number(m.slice(1, -1)))));
  }
  return out;
}

export function readFixture(name: string): string {
  return parseEscapedFixture(readFileSync(join(import.meta.dir, "../fixtures", name), "utf8"));
}
