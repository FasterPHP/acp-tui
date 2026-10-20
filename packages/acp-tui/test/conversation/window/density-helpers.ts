// Shared by density.pty.test.ts and density.pty.timing.test.ts (split by the change parallel-tests, tasks 3.x). Not a test file.
import { expect } from "bun:test";
import type { PtySession } from "../../pty/harness.ts";
import { lineWithoutBar, withoutBar } from "../../pty/regions.ts";
import { settle, type CliRun } from "../cli.ts";

export const TOOL_LINE = /^ {2}. [✓✗] .*#\d+$/;
export const GROUP_LINE = /^ {2}[▸▾] \d+ /;
export const TURN_LINE = /^ {2}[▸▾] \d+ tool calls?\b/;
// A card row, a padding row (the rule alone) included.
export const CARD_ROW = /^ {2}┃/;

export function conversationRows(s: PtySession): string[] {
  const lines = withoutBar(s.screenText());
  const end = lines.findIndex((l) => l.startsWith("╭"));
  return lines.slice(0, end < 0 ? lines.length : end);
}

export function cursorRow(s: PtySession): number {
  return conversationRows(s).findIndex((_, y) => s.cell(y, 0)!.isInverse() !== 0);
}

export async function press(s: PtySession, ...keys: Parameters<PtySession["sendKeys"]>): Promise<void> {
  s.sendKeys(...keys);
  await settle(s, 60);
}

/** `v`, then the density's notice in the prompt box's top border. */
export async function density(s: PtySession, name: string): Promise<void> {
  s.sendKeys({ text: "v" });
  await s.waitFor((p) => p.screenText().some((l) => l.startsWith("╭") && l.includes(`density: ${name}`)), 5000);
  await settle(s, 60);
}

/** The last switch's time from its key to the end of its first frame (the `density` debug-log
 *  event), checked against the spec's 100 ms. */
export function expectFirstFrameWithin100(cli: CliRun, name: string): string {
  const shown = cli.events("density").at(-1);
  expect(shown?.["density"]).toBe(name);
  const ms = Number(shown?.["ms"]);
  expect({ name, ms, within: ms < 100 }).toEqual({ name, ms, within: true });
  return `${name} ${ms}`;
}

/** Puts the cursor on an entry in the rows 3 to 20 for which `accept` holds: up a stretch (the
 *  cursor ends on the top row), then down through the entries on screen; again further up. */
export async function cursorOnto(s: PtySession, accept: (line: string, y: number) => boolean): Promise<number> {
  for (let round = 0; round < 8; round++) {
    for (let i = 0; i < 12; i++) s.sendKeys("Up");
    await settle(s, 60);
    for (let i = 0; i < 12; i++) {
      await press(s, "Down");
      const y = cursorRow(s);
      if (y > 20) break;
      if (y >= 3 && accept(lineWithoutBar(s, y), y)) return y;
    }
    for (let i = 0; i < 12; i++) s.sendKeys("Up");
  }
  throw new Error("no suitable item for the cursor");
}
