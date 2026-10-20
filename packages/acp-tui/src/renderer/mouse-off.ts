// The wheel with the mouse off (mvp-chrome-and-keys tasks 7.3 and 7.4, design D14; spec
// tui-screen "Wheel with the mouse off"). With mouse reporting off a terminal turns the wheel
// into cursor keys (alternate scroll, `CSI ? 1007`), which would move the prompt box cursor,
// browse the prompt history or move the conversation cursor.
//
// - Zed (`TERM_PROGRAM=zed`) honours `CSI ? 1007` and starts with it set. At start-up acp-tui asks
//   DECRQM (`CSI ? 1007 $ p`), writes `CSI ? 1007 l` whenever the effective policy becomes
//   `off` (the command line or F2), and writes the original state back when the policy leaves
//   `off` and in the final reset (lifecycle.ts, before the exit text). A reply of "not
//   recognised", or none, counts as set, Zed's default. The reply (`CSI ? 1007 ; Ps $ y`) is
//   taken by an input handler ahead of OpenTUI's parser, so it never reaches the prompt box.
// - PhpStorm ignores 1007, and a notch there is three identical arrow keys in one read (S1,
//   task 10.9). In every terminal, while the policy is `off`, an input chunk of exactly three
//   identical `CSI A`, `CSI B`, `ESC O A` or `ESC O B` is dropped as a notch before the parser.
//   Nothing else is dropped; a held key is not three in a read often enough to matter, and
//   PgUp and PgDn still scroll.
//
// The notch check needs the whole read, and OpenTUI's input handlers see one sequence at a time
// after its parser has split the read, so it wraps `push` on OpenTUI's private stdin parser
// (the third OpenTUI internal after `forceFullRepaintRequested` and `processSingleMouseEvent`;
// the PTY test "PhpStorm notch with a draft" fails if the hook stops working).
import type { CliRenderer } from "@opentui/core";
import type { MousePolicy } from "./options.ts";

/** Asks whether alternate scroll (mode 1007) is set. */
export const ALTERNATE_SCROLL_QUERY = "\x1b[?1007$p";
export const ALTERNATE_SCROLL_OFF = "\x1b[?1007l";
export const ALTERNATE_SCROLL_ON = "\x1b[?1007h";

const NOTCH = /^(?:(?:\x1b\[A){3}|(?:\x1b\[B){3}|(?:\x1bOA){3}|(?:\x1bOB){3})$/;

/** An input chunk of exactly three identical cursor-up or cursor-down sequences: one wheel notch. */
export function isWheelNotch(chunk: string): boolean {
  return NOTCH.test(chunk);
}

const REPLY = /^\x1b\[\?1007;(\d)\$y$/;

/**
 * What a DECRQM reply for mode 1007 says: true (set, permanently set), false (reset, permanently
 * reset), null (the terminal does not recognise the mode), undefined (not a reply to this query).
 */
export function alternateScrollReply(sequence: string): boolean | null | undefined {
  const m = REPLY.exec(sequence);
  if (!m) return undefined;
  switch (m[1]) {
    case "1":
    case "3":
      return true;
    case "2":
    case "4":
      return false;
    default:
      return null;
  }
}

/** The Zed half of the handling: pure state, the escape output through `write`. */
export interface AlternateScroll {
  /** The reply to the start-up query arrived (`undefined` is not a reply to it). */
  reply(sequence: string): boolean;
  /** The effective policy changed (also called once with the policy at start-up). */
  policy(policy: MousePolicy): void;
  /** What the final reset writes to put mode 1007 back as it was found; empty when nothing was changed. */
  restore(): string;
}

export function createAlternateScroll(write: (data: string) => void): AlternateScroll {
  // The mode as the terminal had it: unknown until the reply, then true or false; an unknown
  // answer and no answer are taken as set.
  let original: boolean | null = null;
  // Whether 1007 is off because of us.
  let disabled = false;

  const putBack = (): string => (disabled && original !== false ? ALTERNATE_SCROLL_ON : "");

  return {
    reply(sequence) {
      const answer = alternateScrollReply(sequence);
      if (answer === undefined) return false;
      original = answer;
      return true;
    },
    policy(policy) {
      if (policy === "off" && !disabled) {
        disabled = true;
        write(ALTERNATE_SCROLL_OFF);
      } else if (policy !== "off" && disabled) {
        const back = putBack();
        disabled = false;
        if (back !== "") write(back);
      }
    },
    restore() {
      const back = putBack();
      disabled = false;
      return back;
    },
  };
}

/** The renderer's stdin parser, as far as the notch needs it. */
interface StdinParser {
  push(data: Uint8Array | string): unknown;
}

/**
 * Drops a wheel notch (three identical arrow sequences in one read) while `policy()` is `off`.
 * Returns a function that removes the wrapper.
 */
export function installNotchFilter(renderer: CliRenderer, policy: () => MousePolicy): () => void {
  const parser = (renderer as unknown as { stdinParser?: StdinParser | null }).stdinParser;
  if (!parser || typeof parser.push !== "function") throw new Error("OpenTUI no longer has stdinParser.push (renderer/mouse-off.ts)");
  const original = parser.push;
  parser.push = function (this: StdinParser, data: Uint8Array | string): unknown {
    if (policy() === "off") {
      const text = typeof data === "string" ? data : Buffer.from(data).toString("latin1");
      if (isWheelNotch(text)) return undefined;
    }
    return original.call(this, data);
  };
  return () => {
    parser.push = original;
  };
}
