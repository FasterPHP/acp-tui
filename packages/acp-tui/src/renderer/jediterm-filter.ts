// The JediTerm input filter (design D5; spec tui-screen "JetBrains mouse input
// is harmless"), active only with `TERMINAL_EMULATOR=JetBrains-JediTerm`
// (both PhpStorm terminals). JediTerm has been seen to send cursor-key
// sequences along with wheel reports (JediTerm PR #1210's symptom); reaching
// the prompt box they would move its cursor, and in the conversation they
// would move the conversation cursor. The filter drops a cursor-key sequence
// (`CSI A` to `CSI D`, or their SS3 forms) that arrives within
// JEDITERM_WINDOW_MS of a wheel report.
//
// Task 8.7 added it because its PTY test failed without it. Wheel reports
// never reach `prependInputHandler` while mouse reporting is on (OpenTUI
// dispatches them first), so the mouse input wrapper (mouse.ts) tells the
// filter when one arrived. D5's other half, rewriting codes 68 and 69 to 64
// and 65, is not needed: the conversation's scroll box and OpenTUI's textarea
// scroll vertically on them already (conversation/scroll.ts).
import type { CliRenderer } from "@opentui/core";
import { detectWheelTerminal } from "./wheel.ts";

/** How long after a wheel report a cursor key counts as part of the wheel gesture. */
export const JEDITERM_WINDOW_MS = 30;

const CURSOR_KEY = /^\x1b(?:\[|O)[ABCD]$/;

/** A plain cursor-key sequence (`CSI A` to `CSI D`, `SS3 A` to `SS3 D`). */
export function isCursorKey(sequence: string): boolean {
  return CURSOR_KEY.test(sequence);
}

export interface JediTermFilter {
  /** A wheel report arrived now. */
  noteWheel(): void;
  /** The input handler: true drops the sequence. */
  handle(sequence: string): boolean;
}

export function createJediTermFilter(now: () => number = () => performance.now()): JediTermFilter {
  let lastWheel = Number.NEGATIVE_INFINITY;
  return {
    noteWheel() {
      lastWheel = now();
    },
    handle(sequence) {
      return isCursorKey(sequence) && now() - lastWheel <= JEDITERM_WINDOW_MS;
    },
  };
}

/** Installs the filter in front of the renderer's key input in a JetBrains terminal; null (and
 *  nothing installed) in any other. */
export function installJediTermFilter(
  renderer: CliRenderer,
  env: Readonly<Record<string, string | undefined>> = process.env,
): JediTermFilter | null {
  if (detectWheelTerminal(env) !== "jetbrains") return null;
  const filter = createJediTermFilter();
  renderer.prependInputHandler((sequence) => filter.handle(sequence));
  return filter;
}
