// Shared by find.pty.test.ts and find.pty.timing.test.ts (split by the change parallel-tests, tasks 3.x). Not a test file.
import { expect } from "bun:test";
import { createSession, reduce, type Session } from "acp-model";
import type { PtySession } from "../pty/harness.ts";
import { settle, type CliRun } from "../conversation/cli.ts";
import { longSessionEvents } from "../conversation/window/session.ts";
import { FindIndex } from "../../src/find/index.ts";

export const FIRST = "scalebench-first-item";
export const NEEDLE = "needle-500-back";
export const CTRL_F = { text: "\x06" };
export const F3 = { text: "\x1bOR" };
/** Shift+F3 in the kitty keyboard protocol form. */
export const SHIFT_F3 = { text: "\x1b[13;2~" };
/** Shift+F3 as xterm sends it: `CSI 1 ; 2 R`, which OpenTUI 0.5.12 takes for a capability reply. */
export const SHIFT_F3_XTERM = { text: "\x1b[1;2R" };

/** The conversation's rows: everything above the prompt box. */
export function conversationRows(s: PtySession): string[] {
  const lines = s.screenText();
  const end = lines.findIndex((l) => l.startsWith("╭"));
  // Below the top margin (mvp-chrome-and-keys task 4.1).
  return lines.slice(1, end < 0 ? lines.length : end);
}

/** The find bar: the row above the status row (which is above the bottom margin), while it starts
 *  with `find:`. */
export function findBar(s: PtySession): string | null {
  const row = s.screenText().at(-3) ?? "";
  return row.startsWith("find: ") ? row : null;
}

/** The screen row showing `text`, and its column; null when it is not on screen. */
export function locate(s: PtySession, text: string): { y: number; x: number } | null {
  const rows = s.screenText();
  const y = rows.findIndex((r) => r.includes(text));
  return y < 0 ? null : { y, x: rows[y]!.indexOf(text) };
}

/** Whether every cell of `text` on screen is drawn as the current hit: bold, in inverse video
 *  (flat theme) or on an RGB fill (`find.current`). */
export function currentHit(s: PtySession, text: string): boolean {
  const at = locate(s, text);
  if (!at) return false;
  const base = s.term.buffer.active.baseY;
  for (let c = 0; c < text.length; c++) {
    const cell = s.cell(base + at.y, at.x + c)!;
    if (!cell.isBold() || (!cell.isInverse() && !cell.isBgRGB())) return false;
  }
  return true;
}

export const bgHex = (s: PtySession, y: number, x: number) => {
  const cell = s.cell(s.term.buffer.active.baseY + y, x)!;
  return cell.isBgDefault() ? "default" : `#${cell.getBgColor().toString(16).padStart(6, "0")}`;
};

export function findEvents(r: CliRun, action: string): Record<string, unknown>[] {
  return r.events("find").filter((e) => e["action"] === action);
}

export async function openAndType(s: PtySession, query: string, counter: RegExp): Promise<void> {
  s.sendKeys(CTRL_F);
  await s.waitFor((p) => findBar(p) !== null, 5000);
  s.sendKeys({ text: query });
  await s.waitFor((p) => (findBar(p) ?? "").includes(query) && counter.test(findBar(p) ?? ""), 5000);
}

export async function closeBar(s: PtySession, key: "Esc" | "Tab"): Promise<void> {
  s.sendKeys(key);
  await s.waitFor((p) => findBar(p) === null, 5000);
  await settle(s, 100);
}

/** Waits until the find's projections (src/find/warm.ts) have caught up with the last update the
 *  agent sent: a `warm` event logged after the last `session_update`. Returns the warm-up's
 *  projecting time (the `ms` of the `warm` events) and the wall time waited. */
export async function warmedUp(r: CliRun): Promise<{ ms: number; waited: number }> {
  const t0 = Date.now();
  const done = () => {
    const events = r.events();
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i]!["event"] === "session_update") return false;
      if (events[i]!["event"] === "find" && events[i]!["action"] === "warm") return true;
    }
    return false;
  };
  await r.session.waitFor(done, 20000);
  const ms = findEvents(r, "warm").reduce((sum, e) => sum + Number(e["ms"]), 0);
  return { ms, waited: Date.now() - t0 };
}

// The long-session scenario's first 200 items as a model (the text fake-agent sends), to pick
// queries and count their hits.
let model: Session | null = null;
export function session200(): Session {
  if (!model) {
    let m = createSession();
    for (const event of longSessionEvents(200)) m = reduce(m, event);
    model = m;
  }
  return model;
}
export function hitCount(query: string): number {
  const m = session200();
  return new FindIndex().search(query, m.order, (id) => m.items.get(id)).hits.length;
}

/** Opens the group line on screen (the final run of a thought, reads and searches), so that its
 *  reads show as collapsed tool lines of their own. */
export async function openGroup(s: PtySession): Promise<void> {
  const y = s.findLine(/^ {2}▸ \d+ /);
  expect(y).toBeGreaterThanOrEqual(0);
  s.mouseClick(10, y);
  await settle(s, 100);
}
