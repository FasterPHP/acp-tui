// Shared by reload-state.pty.test.ts and reload-state.pty.timing.test.ts (split by the change parallel-tests, tasks 3.x). Not a test file.
import { dirname, join } from "node:path";
import { type ConfigHome } from "../pty/config-home.ts";
import type { PtySession } from "../pty/harness.ts";
import { CARD_HEADER, statusRow } from "../pty/regions.ts";
import { readEvents, settle, startCli, type CliRun } from "../conversation/cli.ts";
import { localEnv, osc52Payloads } from "../selection/pty.ts";

export function start(cfg: ConfigHome, scenario: string, cols: number, rows: number, delayScale = 0): CliRun {
  run = startCli({ scenario, cols, rows, delayScale, env: localEnv({ ...cfg.env }) });
  return run;
}

/** Saves `content` as an editor does and waits for the reload it causes, then lets the frame
 *  that follows it settle. Returns the reload's log event. */
export async function reload(r: CliRun, cfg: ConfigHome, content: object, quiet = true): Promise<Record<string, unknown>> {
  const before = r.events("config_reload").length;
  cfg.write(content);
  await r.session.waitFor(() => r.events("config_reload").length > before, 5000);
  // A running turn animates the status row, so a test inside the two-press window cannot wait
  // for the screen to be quiet.
  if (quiet) await settle(r.session, 250);
  return r.events("config_reload").at(-1)!;
}

/** The status row's right-hand end, as the `connection` module's format shows it. */
export const connectionMark = (s: PtySession, text: string) => statusRow(s).trimEnd().endsWith(text);

// -- Selection --------------------------------------------------------------------------------

/** Every Markdown block of `copy-fixtures` is on screen (they lay out over a few frames). */
export const laidOut = (s: PtySession) =>
  ["  │ created_at", "  The third paragraph", "  ● third item"].every((prefix) => s.screenText().some((l) => l.startsWith(prefix))) &&
  // (After the code block's padding columns: the flat rule or the fill, and a second column.)
  s.screenText().some((l) => /^ {2}[ ▎] ?\}\s*$/.test(l));

export function rowOf(s: PtySession, prefix: string): number {
  const y = s.screenText().findIndex((l) => l.startsWith(prefix));
  if (y < 0) throw new Error(`no row starting with ${JSON.stringify(prefix)}\n${s.screenText().join("\n")}`);
  return y;
}

/** A drag with the left button: press, motion through `via`, release. */
export async function drag(s: PtySession, from: [number, number], via: [number, number][], to: [number, number]): Promise<void> {
  s.mousePress(from[0], from[1]);
  for (const [x, y] of via) {
    s.mouseMove(x, y, "left");
    await Bun.sleep(15);
  }
  s.mouseMove(to[0], to[1], "left");
  await Bun.sleep(15);
  s.mouseRelease(to[0], to[1]);
}

/** Whether the cell at `x` on `row` is drawn selected (inverse video under the flat theme). */
export const selected = (s: PtySession, row: number, x: number) => Boolean(s.cell(s.term.buffer.active.baseY + row, x)!.isInverse());

export async function nextPayload(s: PtySession, count: number): Promise<string> {
  await s.waitFor((p) => osc52Payloads(p.rawOutput()).length > count, 5000);
  return osc52Payloads(s.rawOutput())[count]!;
}

// -- The find bar -----------------------------------------------------------------------------

export const CTRL_F = { text: "\x06" };

/** The find bar: the row above the status row (which is above the bottom margin), while it
 *  starts with `find:`; with a status row on top, the row above the prompt box's spacer. */
export function findBar(s: PtySession): string | null {
  const row = s.screenText().find((r) => r.startsWith("find: "));
  return row ?? null;
}

// -- The permission card ------------------------------------------------------------------------

/** The option labels drawn selected (inverse video). */
export function selectedOptions(s: PtySession): string[] {
  const rows = s.screenText();
  const top = rows.findIndex((r) => r.startsWith(`╭─ ${CARD_HEADER}`));
  const out: string[] = [];
  for (let y = top + 1; top >= 0 && y < rows.length && !rows[y]!.startsWith("╰"); y++) {
    for (const m of rows[y]!.matchAll(/(\d) (allow once|allow always|reject once|reject always)/g)) {
      if (s.cell(s.term.buffer.active.baseY + y, m.index!)!.isInverse()) out.push(m[0]);
    }
  }
  return out;
}

/** The prompt box's frame is in the accent colour (ANSI 4) only while it has focus. */
export function promptFocused(s: PtySession): boolean {
  const rows = s.screenText();
  for (let y = rows.length - 1; y >= 0; y--) if (rows[y]!.startsWith("╰")) return s.cell(s.term.buffer.active.baseY + y, 0)!.getFgColor() === 4;
  return false;
}

/** What the client answered to fake-agent's permission requests (the agent's own log). */
export const responses = (r: CliRun) =>
  readEvents(join(dirname(r.logPath), "fake-agent.log"))
    .filter((e) => e["method"] === "session/request_permission/response")
    .map((e) => e["params"]);

let run: CliRun | undefined;

/** For each test file's `afterEach`. */
export async function disposeRun(): Promise<void> {
  run?.session.kill("SIGTERM");
  await run?.session.dispose();
  run = undefined;
}
