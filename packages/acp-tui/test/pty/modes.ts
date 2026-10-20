// DEC private mode tracker for the PTY harness (phase 1a, task 2.4). Parses a
// whole output stream for `CSI ? Pm h` (set) and `CSI ? Pm l` (reset),
// including multi-parameter forms such as `CSI ? 1000;1006 h`, and reports
// which modes are set at the end of the stream.
//
// Two modes are on in a fresh terminal (DECAWM 7, cursor visible 25); they
// start in the set so that `CSI ? 25 l` without a later `h` is reported as a
// missing 25. Nothing else is assumed. DECRQM queries (`CSI ? n $ p`) and
// resets by `RIS` or `DECSTR` are not interpreted.
export interface ModeChange {
  mode: number;
  on: boolean;
  /** Index of the sequence's ESC in the output string. */
  offset: number;
}

/** Mouse reporting modes: X11 (1000), button-event (1002), any-event (1003), SGR encoding (1006). */
export const MOUSE_MODES = [1000, 1002, 1003, 1006] as const;
/** The alternate screen with saved cursor. */
export const ALT_SCREEN_MODE = 1049;

const DEFAULT_ON = [7, 25];

export function parseModeChanges(output: string): ModeChange[] {
  const changes: ModeChange[] = [];
  const re = /\x1b\[\?([0-9;]*)([hl])/g;
  for (let m = re.exec(output); m !== null; m = re.exec(output)) {
    for (const param of m[1]!.split(";")) {
      if (param === "") continue;
      changes.push({ mode: Number(param), on: m[2] === "h", offset: m.index });
    }
  }
  return changes;
}

/** The modes set after applying `changes` in order, ascending. */
export function modesSet(changes: readonly ModeChange[]): number[] {
  const on = new Set<number>(DEFAULT_ON);
  for (const c of changes) {
    if (c.on) on.add(c.mode);
    else on.delete(c.mode);
  }
  return [...on].sort((a, b) => a - b);
}
