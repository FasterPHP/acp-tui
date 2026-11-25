// focus-groups (spec tui-conversation "Focus lines", "Spacing of focus lines" and "Turn totals in
// the turn-end line"; spec tui-layout "Activity line contents") end to end: the real acp-tui under
// the PTY harness against fake-agent's `task-messages`, whose turn 1 has four gaps between plain
// agent messages and two notes with nothing between, and whose turn 2 can be held on a running call.
//
// The screen of turn 1 in `focus` is held as a golden (`golden/screen/focus-groups-turn-1.txt`,
// format: gallery-screen.ts); `UPDATE_GOLDEN=1` rewrites it. The turn's duration is the only
// variable text and is replaced by `<duration>`.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TASK_MESSAGES } from "fake-agent";
import { currentHit, findBar, openAndType } from "../find/find-helpers.ts";
import { configHome } from "../pty/config-home.ts";
import type { PtySession } from "../pty/harness.ts";
import { INTERRUPT_ARMED, READY, withoutBar } from "../pty/regions.ts";
import { localEnv, osc52Payloads } from "../selection/pty.ts";
import { WINDOWS } from "../windows.ts";
import { sendPrompt, settle, startCli, type CliRun } from "./cli.ts";
import { DARK, formatRow, surfaceNames } from "./gallery-screen.ts";
import { cursorOnto, cursorRow, density, press } from "./window/density-helpers.ts";

let run: CliRun | undefined;
afterEach(async () => {
  run?.session.kill("SIGTERM");
  await run?.session.dispose();
  run = undefined;
});

const T1 = TASK_MESSAGES.turn1;
const TOOLS = TASK_MESSAGES.tools;
const DURATION = String.raw`\d+(?:\.\d)?(?:ms|s)`;
const END_TOTALS = "6 tool calls \\(1 failed\\) · 1 thought";
const END_LINE = new RegExp(String.raw`^ {2}end turn · ${END_TOTALS} · ${DURATION}$`);
const GAP = /^ {2}[▸▾] \d+ tool calls?/;

const rowsOf = (s: PtySession) => withoutBar(s.screenText());
const rowOf = (s: PtySession, re: RegExp | string) => {
  const y = rowsOf(s).findIndex((r) => (typeof re === "string" ? r === re : re.test(r)));
  if (y < 0) throw new Error(`no row ${re}\n${rowsOf(s).join("\n")}`);
  return y;
};

/** Turn 1 to its end, in `focus` unless `settings` say otherwise. */
async function turn1(opts: { rows?: number; cols?: number; agentArgs?: string[]; env?: Record<string, string | undefined>; density?: string; colours?: typeof DARK } = {}): Promise<PtySession> {
  run = startCli({
    scenario: "task-messages",
    cols: opts.cols ?? 90,
    rows: opts.rows ?? 40,
    ...(opts.agentArgs ? { agentArgs: opts.agentArgs } : {}),
    ...(opts.colours ? { colours: opts.colours } : {}),
    env: { ...configHome({ density: opts.density ?? "focus" }).env, ...opts.env },
  });
  const s = run.session;
  await sendPrompt(s, "go");
  await s.waitFor((p) => rowsOf(p).some((r) => END_LINE.test(r)), 15000);
  await settle(s);
  return s;
}

describe("turn 1 in focus (specs Focus lines, Spacing of focus lines)", () => {
  test("four lines in their places, none between the notes, the middle gap's `3 tool calls (1 failed)`", async () => {
    const s = await turn1();
    const rows = rowsOf(s);
    const at = (text: string) => rows.indexOf(`  ${text}`);
    const lines = rows.map((r, y) => ({ r, y })).filter(({ r }) => GAP.test(r));
    expect(lines.map(({ r }) => r)).toEqual([
      "  ▸ 1 tool call · 1 thought",
      "  ▸ 3 tool calls (1 failed)",
      "  ▸ 1 tool call",
      "  ▸ 1 tool call",
    ]);
    const [first, middle, third, last] = lines.map(({ y }) => y) as [number, number, number, number];
    // The first sits before the first message, the middle between the first two messages, the third
    // between the second note and the last message, the fourth after it and before the end line.
    expect(first).toBeLessThan(at(T1.started));
    expect(middle).toBe(at(T1.started) + 1);
    expect(at(T1.done)).toBe(middle + 1);
    expect(third).toBe(at(T1.noteB.text) + 1);
    expect(at(T1.task2Done)).toBe(third + 1);
    expect(last).toBe(at(T1.task2Done) + 1);
    // None between the notes: only a blank row (their own spacing).
    expect(rows.slice(at(T1.noteA.text) + 1, at(T1.noteB.text))).toEqual([""]);
    // No tool line in focus.
    expect(rows.some((r) => /Run tm-|Read tm-|Edit tm-/.test(r))).toBe(false);
    expect(rows.some((r) => END_LINE.test(r))).toBe(true);
  }, 60000);

  test("Spacing: the closed line takes no row between its two messages; opened, the members follow it and one blank row precedes the next message", async () => {
    const s = await turn1();
    const started = rowOf(s, `  ${T1.started}`);
    // Consecutive rows: the message, the closed line, the next message.
    expect(rowsOf(s)[started + 1]).toBe("  ▸ 3 tool calls (1 failed)");
    expect(rowsOf(s)[started + 2]).toBe(`  ${T1.done}`);

    s.mouseClick(10, started + 1);
    await s.waitFor((p) => rowsOf(p)[started + 1] === "  ▾ 3 tool calls (1 failed)", 5000);
    await settle(s, 100);
    const rows = rowsOf(s);
    expect(rows[started]).toBe(`  ${T1.started}`);
    expect(rows[started + 1]).toBe("  ▾ 3 tool calls (1 failed)");
    // The three members on consecutive rows, then one blank row, then the next message.
    for (const [i, id] of (["tm-2", "tm-3", "tm-4"] as const).entries()) expect(rows[started + 2 + i]).toContain(TOOLS[id].title);
    expect(rows[started + 5]).toBe("");
    expect(rows[started + 6]).toBe(`  ${T1.done}`);
  }, 60000);

  test("Opening one line: the other three lines stay closed", async () => {
    const s = await turn1();
    const middle = rowOf(s, /^ {2}▸ 3 tool calls \(1 failed\)$/);
    const before = rowsOf(s).filter((r) => GAP.test(r) && !r.includes("3 tool calls"));
    s.mouseClick(10, middle);
    await s.waitFor((p) => rowsOf(p)[middle]?.startsWith("  ▾ ") === true, 5000);
    await settle(s, 100);
    const rows = rowsOf(s);
    expect(rows.filter((r) => /^ {2}▾ /.test(r))).toEqual(["  ▾ 3 tool calls (1 failed)"]);
    expect(rows.filter((r) => GAP.test(r) && r.includes("▸"))).toEqual(before);
    // The members are directly below the line, between the two messages.
    expect(rows[middle - 1]).toBe(`  ${T1.started}`);
    expect(rows[middle + 1]).toContain(TOOLS["tm-2"].title);
    // Nothing of the closed lines' calls is drawn.
    expect(rows.some((r) => r.includes(TOOLS["tm-1"].title) || r.includes(TOOLS["tm-5"].title) || r.includes(TOOLS["tm-6"].title))).toBe(false);
    // Click again: closed, and the screen is as it was.
    await Bun.sleep(450);
    s.mouseClick(10, middle);
    await s.waitFor((p) => rowsOf(p)[middle] === "  ▸ 3 tool calls (1 failed)", 5000);
  }, 60000);

  test("Copy across a closed line: the three calls' title lines, none of the line's counts", async () => {
    const s = await turn1({ env: localEnv() });
    const from = rowOf(s, `  ${T1.started}`);
    const to = rowOf(s, `  ${T1.done}`);
    s.mousePress(2, from);
    for (const [x, y] of [[10, from + 1], [10, to], [12, to]] as const) {
      s.mouseMove(x, y, "left");
      await Bun.sleep(15);
    }
    // The cell under the pointer at release is the selection's last character.
    s.mouseMove(2 + T1.done.length - 1, to, "left");
    await Bun.sleep(15);
    s.mouseRelease(2 + T1.done.length - 1, to);
    await s.waitFor((p) => osc52Payloads(p.rawOutput()).length > 0, 5000);
    const copied = osc52Payloads(s.rawOutput()).at(-1)!;
    const titles = (["tm-2", "tm-3", "tm-4"] as const).map((id) => TOOLS[id].title);
    expect(copied).toBe([T1.started, ...titles, T1.done].join("\n\n"));
    expect(copied).not.toMatch(/tool calls?|\(1 failed\)|▸|▾/);
  }, 60000);

  test("A find hit behind a line: the middle line opens, the call expands and the hit is shown", async () => {
    const s = await turn1();
    const hit = TOOLS["tm-3"].output.trim();
    expect(hit).toBe("check failed");
    expect(rowsOf(s).some((r) => r.includes(hit))).toBe(false);
    await openAndType(s, hit, /\b1 hit\b/);
    s.sendKeys("Enter");
    await s.waitFor((p) => currentHit(p, hit), 5000);
    const rows = rowsOf(s);
    expect(rows.filter((r) => /^ {2}▾ /.test(r))).toEqual(["  ▾ 3 tool calls (1 failed)"]);
    // Its failed call is expanded: the title row, then the output holding the hit.
    const title = rows.findIndex((r) => r.includes(TOOLS["tm-3"].title));
    expect(title).toBeGreaterThan(0);
    expect(rows.slice(title + 1, title + 4).some((r) => r.includes(hit))).toBe(true);
    expect(rows.some((r) => r.includes(TOOLS["tm-2"].output.trim()))).toBe(false);
    expect(findBar(s)).toContain("1 of 1");
  }, 60000);
});

describe("densities (spec Turn totals in the turn-end line: `focus`, `compact` and `verbose` alike)", () => {
  test("v to compact and verbose and back: every item in place, the end line's totals in all three, the focus screen as it was", async () => {
    const s = await turn1({ rows: 70 });
    const focus = rowsOf(s).slice(0, rowOf(s, END_LINE) + 1);
    const total = (name: string) => expect(rowsOf(s).filter((r) => END_LINE.test(r)), name).toHaveLength(1);
    total("focus");

    await press(s, "Tab");
    await density(s, "compact");
    total("compact");
    let rows = rowsOf(s);
    const order = (...texts: string[]) => {
      const ys = texts.map((t) => rows.findIndex((r) => r.includes(t)));
      expect(ys.every((y) => y >= 0), `${texts.join(", ")}\n${rows.join("\n")}`).toBe(true);
      expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    };
    // Compact: the execute, edit and (alone after an answer) read calls as their own lines.
    order(T1.started, TOOLS["tm-2"].title, TOOLS["tm-3"].title, TOOLS["tm-4"].title, T1.done, T1.noteA.text, T1.noteB.text, TOOLS["tm-5"].title, T1.task2Done, TOOLS["tm-6"].title, "end turn");
    expect(rows.some((r) => GAP.test(r) && /3 tool calls/.test(r))).toBe(false);

    await density(s, "verbose");
    total("verbose");
    rows = rowsOf(s);
    order(TOOLS["tm-1"].title, T1.thought, T1.started, TOOLS["tm-2"].title, TOOLS["tm-3"].title, TOOLS["tm-4"].title, T1.done, T1.noteA.text, T1.noteB.text, TOOLS["tm-5"].title, T1.task2Done, TOOLS["tm-6"].title, "end turn");

    await density(s, "focus");
    total("focus again");
    expect(rowsOf(s).slice(0, rowOf(s, END_LINE) + 1)).toEqual(focus);
  }, 90000);

  test("the cursor's message keeps its row through compact, verbose and back (a pane the conversation overflows)", async () => {
    const s = await turn1({ rows: 20 });
    await press(s, "Tab");
    const y = await cursorOnto(s, (line) => line === `  ${T1.done}`);
    for (const name of ["compact", "verbose", "focus"]) {
      await density(s, name);
      expect(cursorRow(s), name).toBe(y);
      expect(rowsOf(s)[y]).toBe(`  ${T1.done}`);
    }
  }, 60000);
});

describe("turn 2 (spec Turn totals: `interrupted`; tui-layout Activity line contents)", () => {
  /** The activity row: the count at the right of a row above the prompt box. */
  const activity = (s: PtySession) => rowsOf(s).find((r) => /^ {2}\S.* {2,}\d+ tool calls? \(1 running\) · 1 thought$/.test(r));

  test("--hold: the count `2 tool calls (1 running) · 1 thought`, then Esc Esc ends it `interrupted · 2 tool calls (1 stopped) · 1 thought`", async () => {
    const s = await turn1({ agentArgs: ["--hold"] });
    await sendPrompt(s, "second");
    await s.waitFor((p) => activity(p) !== undefined, 10000);
    expect(activity(s)).toContain(TOOLS["tm-8"].title);
    expect(activity(s)).toMatch(/ 2 tool calls \(1 running\) · 1 thought$/);
    s.sendKeys("Esc");
    await s.waitFor(INTERRUPT_ARMED, 5000);
    s.sendKeys("Esc");
    const stopped = new RegExp(String.raw`^ {2}interrupted · 2 tool calls \(1 stopped\) · 1 thought · ${DURATION}$`);
    await s.waitFor((p) => rowsOf(p).some((r) => stopped.test(r)), 10000);
    await settle(s);
    expect(rowsOf(s).filter((r) => stopped.test(r))).toHaveLength(1);
    // The first turn's line is as it was; the running count is gone.
    expect(rowsOf(s).filter((r) => END_LINE.test(r))).toHaveLength(1);
    expect(activity(s)).toBeUndefined();
  }, 60000);

  test("without --hold: `end turn · 2 tool calls · 1 thought`", async () => {
    const s = await turn1();
    await sendPrompt(s, "second");
    const done = new RegExp(String.raw`^ {2}end turn · 2 tool calls · 1 thought · ${DURATION}$`);
    await s.waitFor((p) => rowsOf(p).some((r) => done.test(r)), 15000);
    await s.waitFor(READY, 5000);
    expect(rowsOf(s).filter((r) => END_LINE.test(r))).toHaveLength(1);
  }, 60000);
});

describe("golden screen of turn 1 in focus", () => {
  test.skipIf(WINDOWS)("the screen above the prompt box, cell by cell (a bare ConPTY answers no OSC 10 and 11, so the surfaces differ there)", async () => {
    const s = await turn1({ colours: DARK });
    await s.waitFor((p) => rowsOf(p).some((r) => END_LINE.test(r)), 5000);
    await settle(s, 400);
    const end = rowOf(s, END_LINE);
    const surfaces = surfaceNames(DARK);
    const dump = Array.from({ length: end + 1 }, (_, y) => formatRow(s, y, y + 1, surfaces))
      // The turn's duration is the one varying text: both of its lines read `<duration>`.
      .map((row) => row.replace(new RegExp(String.raw`(end turn.*? · )${DURATION}`, "g"), "$1<duration>"));
    const text = [
      "Turn 1 of task-messages in focus (90x40, OSC 10 and 11 answered dark), the screen cell by cell; see test/conversation/gallery-screen.ts for the format.",
      "The turn's duration is shown as <duration>.",
      "",
      ...dump,
    ].join("\n") + "\n";
    const path = join(import.meta.dir, "golden", "screen", "focus-groups-turn-1.txt");
    if (process.env["UPDATE_GOLDEN"] === "1") {
      mkdirSync(join(import.meta.dir, "golden", "screen"), { recursive: true });
      writeFileSync(path, text);
    }
    if (!existsSync(path)) throw new Error("missing golden file screen/focus-groups-turn-1.txt: run with UPDATE_GOLDEN=1 and review it");
    expect(text).toBe(readFileSync(path, "utf8"));
  }, 60000);
});
