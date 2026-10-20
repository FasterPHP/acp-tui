// Shared by scrollbar-layout.pty.test.ts and scrollbar-layout.pty.timing.test.ts (split by the change parallel-tests, tasks 3.x). Not a test file.
import { expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OscColours, PtySession } from "../pty/harness.ts";
import { conversationEnd, READY } from "../pty/regions.ts";
import { deriveSurfaces } from "../../src/theme/derive.ts";
import { localEnv } from "../selection/pty.ts";
import { settle, startCli, type CliRun } from "./cli.ts";
import { configEnv } from "../pty/config-home.ts";

export const DARK = { foreground: "#bcbec4", background: "#191a1c" } satisfies OscColours;
export const SURFACES = deriveSurfaces(DARK);
/** A user file with `layout.scrollbar` off (mvp-configuration task 6.5). */
export const OFF = configEnv({ layout: { scrollbar: false } });

/** Sixty words of 1 to 9 letters in a fixed, irregular order (lengths from a seeded generator),
 *  chosen so that the greedy wrap differs at 57, 58, 59 and 60 columns, and at 95, 96 and 97. */
export const PARAGRAPH = [..."927496697779855156582981929593149854314547188538922155425934"].map((n) => "abcdefghi".slice(0, Number(n))).join(" ");

/** Greedy word wrap at `width` columns. */
export function wrap(text: string, width: number): string[] {
  const rows: string[] = [];
  let row = "";
  for (const word of text.split(" ")) {
    if (row === "") row = word;
    else if (row.length + 1 + word.length <= width) row += ` ${word}`;
    else {
      rows.push(row);
      row = word;
    }
  }
  if (row !== "") rows.push(row);
  return rows;
}

export type Turn = { user: string; agent: string; tools?: { title: string; kind: string }[] };

/** `turns - 1` short turns (a prompt and a reply each), then one whose agent message is the paragraph. */
export function paragraphTurns(turns: number): Turn[] {
  const list: Turn[] = Array.from({ length: turns - 1 }, (_, i) => ({ user: `prompt ${i + 1}`, agent: `reply ${i + 1}` }));
  list.push({ user: "the paragraph", agent: PARAGRAPH });
  return list;
}

/** A sessions fixture holding one session, `id`. */
export function fixture(id: string, turns: Turn[]): string {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-margin-"));
  const path = join(dir, "sessions.json");
  writeFileSync(path, JSON.stringify({ sessions: [{ sessionId: id, cwd: dir, title: "Margin", turns }] }));
  return path;
}

// A session ID per test: acp-tui's session index (shared by the whole test run) records each
// session opened, and a second open of the same ID elsewhere would add a directory marker.
export let opened = 0;

export async function open(opts: { cols: number; rows: number; turns: number | Turn[]; env?: Record<string, string>; colours?: OscColours | null }): Promise<PtySession> {
  const turns = typeof opts.turns === "number" ? paragraphTurns(opts.turns) : opts.turns;
  const id = `margin-${++opened}-${process.pid}`;
  run = startCli({
    scenario: "basic",
    agentArgs: ["--load", "--sessions", fixture(id, turns)],
    cols: opts.cols,
    rows: opts.rows,
    args: ["--resume", id],
    ...(opts.colours === null ? {} : { colours: opts.colours ?? DARK }),
    env: localEnv(opts.env),
  });
  const s = run.session;
  await s.waitFor(READY, 60000);
  const last = turns.at(-1)!.agent.split(" ")[0]!;
  await s.waitFor((p) => p.screenText().some((l) => l.includes(last)), 30000);
  await settle(s);
  return s;
}

export const bgOf = (s: PtySession, y: number, x: number): string => {
  const cell = s.cell(s.term.buffer.active.baseY + y, x)!;
  return cell.isBgDefault() ? "default" : cell.isBgRGB() ? `#${cell.getBgColor().toString(16).padStart(6, "0")}` : `palette ${cell.getBgColor()}`;
};
export const charOf = (s: PtySession, y: number, x: number): string => s.cell(s.term.buffer.active.baseY + y, x)?.getChars() ?? "";

/** The conversation's first screen row, below the top margin (mvp-chrome-and-keys task 4.1). */
export const TOP = 1;

/** The screen row of the prompt box's top border: the conversation's rows are TOP up to it. */
// Above the prompt box, less the activity bar's line and its blank row (day-two-feedback task 13.2).
export const conversationRows = (s: PtySession): number => conversationEnd(s);

/** Columns `from` to `to` (1-based, inclusive) of every conversation row are blank on the default background. */
export function expectBlank(s: PtySession, from: number, to: number): void {
  const rows = conversationRows(s);
  expect(rows).toBeGreaterThan(0);
  if (process.env.DUMP) console.log(s.screenText().map((l, i) => `${String(i).padStart(2)}|${l}|`).join("\n"));
  for (let y = 0; y < rows; y++) {
    for (let x = from - 1; x < to; x++) {
      expect({ y, x: x + 1, char: charOf(s, y, x) || " ", bg: bgOf(s, y, x) }).toEqual({ y, x: x + 1, char: " ", bg: "default" });
    }
  }
}

/** The paragraph's rows as drawn: the screen rows from its first one, behind the two-column gutter. */
export function paragraphRows(s: PtySession, expected: readonly string[]): string[] {
  const screen = s.screenText();
  const first = screen.findIndex((l) => l.slice(2).trimEnd() === expected[0]);
  expect(first).toBeGreaterThanOrEqual(0);
  return screen.slice(first, first + expected.length).map((l) => l.slice(2).trimEnd());
}

/** Agent text columns: the region less the gutter (2), the right margin (2) and the bar (1, when on). */
export const textWidth = (cols: number, bar: boolean) => cols - 2 - 2 - (bar ? 1 : 0);

export let run: CliRun | undefined;

/** For each test file's `afterEach`. */
export async function disposeRun(): Promise<void> {
  await run?.session.dispose();
  run = undefined;
}
