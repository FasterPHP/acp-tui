// SGR (mode 1006) mouse report builders and the recorded-fixture format for the
// PTY harness (phase 1a, task 2.3).
//
// Coordinates are 0-BASED CELLS, column then row (x, y), the same convention as
// OpenTUI's `MouseEvent` and xterm's buffer indices. The wire form is 1-based
// (`CSI < code ; x+1 ; y+1 M|m`); the builders add the 1.
//
// Button codes: 0 left, 1 middle, 2 right; motion adds 32 (a drag when the
// button is named, plain motion as code 35, "no button"); wheel is 64 up, 65
// down, 66 left, 67 right, and JediTerm's 68 and 69 (the wheel codes with the
// shift bit set). Modifier bits: shift 4, alt 8, ctrl 16.
//
// Fixture format (JSON Lines, one record per input chunk, e.g.
// `test/fixtures/jediterm-reworked-mouse.jsonl` and
// `test/fixtures/jediterm-classic-mouse.jsonl`):
//
//   {"t_ms":0,"data":"\u001b[<64;10;5M"}
//   {"t_ms":3,"data":"\u001b[A"}
//
// `t_ms` is milliseconds since the first record (non-decreasing, integer or
// fractional); `data` is the exact bytes as one JSON string (keys, mouse
// reports, anything the terminal sent). Blank lines are skipped.
export type MouseButtonName = "left" | "middle" | "right";

export interface MouseModifiers {
  shift?: boolean;
  alt?: boolean;
  ctrl?: boolean;
}

export const WHEEL_CODES = { up: 64, down: 65, left: 66, right: 67, jediTermUp: 68, jediTermDown: 69 } as const;

const BUTTON_BITS: Record<MouseButtonName, number> = { left: 0, middle: 1, right: 2 };

export function modifierBits(mods: MouseModifiers = {}): number {
  return (mods.shift ? 4 : 0) | (mods.alt ? 8 : 0) | (mods.ctrl ? 16 : 0);
}

/** One SGR report for an arbitrary button code; `final` is `M` (press, motion, wheel) or `m` (release). */
export function sgrReport(code: number, x: number, y: number, final: "M" | "m" = "M"): string {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) {
    throw new RangeError(`mouse cell must be non-negative integers (0-based), got ${x},${y}`);
  }
  return `\x1b[<${code};${x + 1};${y + 1}${final}`;
}

export function sgrPress(x: number, y: number, button: MouseButtonName = "left", mods?: MouseModifiers): string {
  return sgrReport(BUTTON_BITS[button] | modifierBits(mods), x, y, "M");
}

export function sgrRelease(x: number, y: number, button: MouseButtonName = "left", mods?: MouseModifiers): string {
  return sgrReport(BUTTON_BITS[button] | modifierBits(mods), x, y, "m");
}

/**
 * Motion. With `button` the button bit is present (a drag: code 32 + button);
 * without it this is plain motion, code 35 (motion bit plus "no button").
 */
export function sgrMotion(x: number, y: number, button?: MouseButtonName, mods?: MouseModifiers): string {
  const base = button === undefined ? 3 : BUTTON_BITS[button];
  return sgrReport(32 | base | modifierBits(mods), x, y, "M");
}

/** Wheel report; `code` is 64, 65, 68 or 69 (66 and 67 for horizontal). */
export function sgrWheel(x: number, y: number, code: number, mods?: MouseModifiers): string {
  if (code < 64 || code > 69) throw new RangeError(`not a wheel code: ${code}`);
  return sgrReport(code | modifierBits(mods), x, y, "M");
}

export interface FixtureRecord {
  t_ms: number;
  data: string;
}

export function parseFixture(text: string): FixtureRecord[] {
  const out: FixtureRecord[] = [];
  let last = 0;
  text.split("\n").forEach((line, i) => {
    if (line.trim() === "") return;
    const rec = JSON.parse(line) as Partial<FixtureRecord>;
    if (typeof rec.t_ms !== "number" || typeof rec.data !== "string") {
      throw new Error(`fixture line ${i + 1}: expected {"t_ms": number, "data": string}`);
    }
    if (rec.t_ms < last) throw new Error(`fixture line ${i + 1}: t_ms goes backwards`);
    last = rec.t_ms;
    out.push({ t_ms: rec.t_ms, data: rec.data });
  });
  return out;
}

export function serialiseFixture(records: readonly FixtureRecord[]): string {
  return records.map((r) => JSON.stringify({ t_ms: r.t_ms, data: r.data })).join("\n") + "\n";
}

export async function loadFixture(path: string): Promise<FixtureRecord[]> {
  return parseFixture(await Bun.file(path).text());
}
