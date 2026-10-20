// Wheel step per terminal (design D4; spec tui-screen "Wheel step per
// terminal"). Terminals send different numbers of wheel events per notch
// (OpenCode moved about 3 rows per three notches in PhpStorm reworked and
// well over 10 in Zed, synthesis 6), so each wheel event scrolls a number of
// rows from the per-terminal table, `wheelLines` in `capabilities.ts`'s
// `TERMINAL_TABLE` (one table and one detection function since
// mvp-configuration design D12): `TERMINAL_EMULATOR=JetBrains-JediTerm` for
// both PhpStorm terminals 3, `TERM_PROGRAM=zed` 1, any other 3. The
// `terminals` setting overrides a terminal's entry, and the top-level
// `wheel_lines` setting (or `--wheel-lines`) every terminal. Fractional steps
// accumulate, so 0.5 rows per event scrolls one row every second event.
//
// Phase-1a task 10.4 measured events per notch in the IDEs from the `wheel`
// log events and set the values so one notch scrolls about 3 rows (plus or
// minus one); the measurements are in the table's comment.
import { detectTerminal, effectiveTerminal, TERMINAL_TABLE, type TerminalId, type TerminalsSetting } from "./capabilities.ts";

export type WheelTerminal = TerminalId;

/** Rows scrolled per wheel event, by terminal (the table's `wheelLines`). */
export type WheelTable = Readonly<Record<WheelTerminal, number>>;

export const WHEEL_TABLE: WheelTable = Object.freeze(
  Object.fromEntries(Object.entries(TERMINAL_TABLE).map(([id, row]) => [id, row.wheelLines])) as Record<WheelTerminal, number>,
);

/** The terminal's entry in the table, from its environment (`detectTerminal`). */
export function detectWheelTerminal(env: Readonly<Record<string, string | undefined>> = process.env): WheelTerminal {
  return detectTerminal(env);
}

/** The step in use: rows per event, the terminal it was chosen for, and where it came from: the
 *  built-in table, the terminal's `terminals` entry, or the `wheel_lines` setting (the file or
 *  `--wheel-lines`: `option`). */
export interface WheelStep {
  readonly rows: number;
  readonly terminal: WheelTerminal;
  readonly source: "table" | "terminals" | "option";
}

/** The step for this terminal: `override` (`wheel_lines`) wins over the `terminals` entry, which
 *  wins over the built-in table. */
export function wheelStep(
  override: number | null,
  env: Readonly<Record<string, string | undefined>> = process.env,
  terminals: TerminalsSetting = {},
): WheelStep {
  const terminal = effectiveTerminal(env, terminals);
  if (override !== null) return { rows: override, terminal: terminal.id, source: "option" };
  return { rows: terminal.wheelLines, terminal: terminal.id, source: terminal.wheelSource };
}

export const DEFAULT_WHEEL: WheelStep = { rows: WHEEL_TABLE.default, terminal: "default", source: "table" };

/**
 * Turns wheel events into whole rows, carrying the fraction. A change of direction drops the
 * carried fraction, so a reversed wheel responds at once.
 */
export class WheelAccumulator {
  private carry = 0;

  constructor(private readonly rowsPerEvent: number) {}

  /** One wheel event (-1 up, 1 down); returns the whole rows to scroll, signed. */
  add(direction: -1 | 1): number {
    if (this.carry !== 0 && Math.sign(this.carry) !== direction) this.carry = 0;
    this.carry += direction * this.rowsPerEvent;
    // The epsilon absorbs floating-point error (three thirds make one row); `|| 0` avoids -0.
    const rows = Math.trunc(this.carry + direction * 1e-9) || 0;
    this.carry -= rows;
    return rows;
  }

  reset(): void {
    this.carry = 0;
  }
}
