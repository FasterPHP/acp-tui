// Phase-1a tasks 8.5 to 8.8 (design D2, D4, D5; spec tui-screen "Mouse
// policy", "Live mouse toggle", "Wheel step per terminal", "JetBrains mouse
// input is harmless"; spec tui-conversation "Click deep in history"): the
// real CLI against fake-agent under the PTY harness, with SGR mouse reports
// injected at 0-based cells. The terminal's identity is set explicitly in
// every test (TERMINAL_EMULATOR, TERM_PROGRAM), so the wheel step does not
// depend on the terminal the tests run in.
import { afterEach, describe, expect, test } from "bun:test";
import { loadFixture, MOUSE_MODES, parseModeChanges, sgrMotion, sgrWheel, type FixtureRecord, type PtySession } from "../pty/harness.ts";
import { lineWithoutBar, promptText, READY, statusRow, withoutBar } from "../pty/regions.ts";
import { sendPrompt, settle, startCli, type CliRun, type StartOptions } from "../conversation/cli.ts";
import { WHEEL_TABLE } from "../../src/renderer/wheel.ts";
import { WINDOWS } from "../windows.ts";

let run: CliRun | undefined;
afterEach(async () => {
  run?.session.kill("SIGTERM");
  await run?.session.dispose();
  run = undefined;
});

const PLAIN_TERMINAL = { TERMINAL_EMULATOR: undefined, TERM_PROGRAM: undefined };
const JEDITERM = { TERMINAL_EMULATOR: "JetBrains-JediTerm", TERM_PROGRAM: undefined };
const SIZE = { cols: 63, rows: 21 };
const TOOL_LINE = /#\d+$/;
/** A closed group line (compact density): the finished reads, searches and thoughts of a run. */
const GROUP_LINE = /^ {2}▸ \d+ /;
const EXPANDED = /^ {2}┃/;

function start(opts: Partial<StartOptions> & { scenario: string }): CliRun {
  run = startCli({ ...SIZE, ...opts, env: { ...PLAIN_TERMINAL, ...opts.env } });
  return run;
}

/** `long-session` with `items` items, idle after its one turn. */
async function history(items: number, opts: Partial<StartOptions> = {}): Promise<PtySession> {
  const r = start({ scenario: "long-session", agentArgs: ["--items", String(items)], ...opts });
  await sendPrompt(r.session, "history");
  await r.session.waitFor(/end turn/, 20000);
  await settle(r.session);
  return r.session;
}

/** The rows above the prompt box (no activity bar or card once the turn has ended), without the
 *  blank row the screen draws between the conversation and the prompt box at rest in these panes
 *  (day-one-feedback task group 13), which does not scroll. */
function conversationRows(s: PtySession): string[] {
  const lines = withoutBar(s.screenText());
  const end = lines.findIndex((l) => l.startsWith("╭"));
  if (end < 0) return lines;
  return lines.slice(0, lines[end - 1] === "" ? end - 1 : end);
}

/** The conversation cursor's row under the flat theme (inverse-video gutter), or -1. */
function cursorRow(s: PtySession): number {
  const base = s.term.buffer.active.baseY;
  return conversationRows(s).findIndex((_, y) => s.cell(base + y, 0)!.isInverse() !== 0 || s.cell(base + y, 1)!.isInverse() !== 0);
}

/** A collapsed tool line at or below row `from` with room below it, or -1. With `groups`, a closed
 *  group line counts too (the finished reads of a long-session are grouped, so a tool line
 *  outside any group may not be on screen). */
function collapsedToolRow(s: PtySession, from = 0, groups = true): number {
  const rows = conversationRows(s);
  for (let y = from; y < rows.length - 4; y++) {
    if ((TOOL_LINE.test(rows[y]!) || (groups && GROUP_LINE.test(rows[y]!))) && !EXPANDED.test(rows[y + 1] ?? "")) return y;
  }
  return -1;
}

/** Mouse modes switched on and off in the output from `offset` on. */
function modeChangesFrom(s: PtySession, offset: number) {
  const changes = parseModeChanges(s.rawOutput().slice(offset)).filter((c) => (MOUSE_MODES as readonly number[]).includes(c.mode));
  const on = new Set(changes.filter((c) => c.on).map((c) => c.mode));
  const off = new Set(changes.filter((c) => !c.on).map((c) => c.mode));
  return { on, off };
}

/** Waits for the conversation's rows to change from `before`, then for the screen to settle. */
async function afterChange(s: PtySession, before: string[]): Promise<string[]> {
  await s.waitFor((p) => conversationRows(p).join("\n") !== before.join("\n"), 5000);
  await settle(s, 100);
  return conversationRows(s);
}

describe("mouse policies (phase-1a task 8.5)", () => {
  // Skipped on Windows: it compares the main screen or the raw stream around exit, which ConPTY clears, repaints and rewrites (mouse modes included).
  test.skipIf(WINDOWS)("Modes enabled under full: 1000, 1002, 1003 (all motion, for the hover feedback, review C12) and 1006 on; all off after exit", async () => {
    const r = start({ scenario: "basic" });
    const s = r.session;
    await s.waitFor(READY, 10000);
    expect(s.mouseModesSet()).toEqual([1000, 1002, 1003, 1006]);
    expect(statusRow(s)).not.toMatch(/mouse/);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    expect(s.mouseModesSet()).toEqual([]);
  }, 30000);

  test("Clicks ignored under wheel: a click on a collapsed tool line leaves it collapsed; the wheel still scrolls", async () => {
    const s = await history(30, { args: ["--mouse", "wheel"] });
    expect(statusRow(s)).toContain("mouse: wheel");
    expect(s.mouseModesSet()).toEqual([1000, 1002, 1006]);
    const y = collapsedToolRow(s, 2);
    expect(y).toBeGreaterThanOrEqual(0);
    const before = conversationRows(s);
    s.mouseClick(20, y);
    // A drag from the line and a right click do nothing either.
    s.mousePress(20, y);
    s.mouseMove(25, y + 1, "left");
    s.mouseRelease(25, y + 1);
    s.mouseClick(20, y, "right");
    await Bun.sleep(300);
    await settle(s, 100);
    expect(conversationRows(s)).toEqual(before);
    expect(cursorRow(s)).toBe(-1);
    expect(promptText(s)).toEqual([""]);

    s.mouseWheel(20, 5, 64);
    await s.waitFor((p) => /scrolled/.test(statusRow(p)), 5000);
  }, 60000);

  test("a right click does nothing under full", async () => {
    const s = await history(30);
    const y = collapsedToolRow(s, 2);
    const before = conversationRows(s);
    s.mouseClick(20, y, "right");
    await Bun.sleep(300);
    await settle(s, 100);
    expect(conversationRows(s)).toEqual(before);
    expect(cursorRow(s)).toBe(-1);
  }, 60000);

  test("Keyboard only: with --mouse off no mouse reporting mode is enabled at any time, F2 included", async () => {
    const r = start({ scenario: "basic", args: ["--mouse", "off"] });
    const s = r.session;
    await s.waitFor(READY, 10000);
    expect(statusRow(s)).toContain("mouse off");
    s.sendKeys("F2");
    await s.waitFor("mouse off (the mouse setting is off)", 5000);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    for (const mode of MOUSE_MODES) expect(s.countModeChanges(mode, true)).toBe(0);
  }, 30000);

  test("Native selection one key away: F2 disables 1000, 1002, 1003 and 1006 and shows `mouse off`; a second F2 re-enables them", async () => {
    const s = await history(30);
    const before = conversationRows(s);
    await s.flush();
    const mark = s.rawOutput().length;
    s.sendKeys("F2");
    await s.waitFor((p) => statusRow(p).includes("mouse off"), 5000);
    await s.flush();
    const first = modeChangesFrom(s, mark);
    expect([...first.off].sort()).toEqual([1000, 1002, 1003, 1006]);
    expect(first.on.size).toBe(0);
    expect(s.mouseModesSet()).toEqual([]);
    expect(conversationRows(s)).toEqual(before);

    const second = s.rawOutput().length;
    s.sendKeys("F2");
    await s.waitFor((p) => !statusRow(p).includes("mouse"), 5000);
    await s.flush();
    const again = modeChangesFrom(s, second);
    expect([...again.on].sort()).toEqual([1000, 1002, 1003, 1006]);
    expect(s.mouseModesSet()).toEqual([1000, 1002, 1003, 1006]);
    expect(conversationRows(s)).toEqual(before);
    expect(promptText(s)).toEqual([""]);
  }, 60000);
});

// opentui-0-6 task 6.1 (design D8): OpenTUI 0.6's `useMouse` setter throws during a terminal
// transition (start-up negotiation); F2 then retries once on the next frame, and a second failure
// leaves the policy as it was with a notice. Whatever the timing, acp-tui must not crash, and the
// status row must agree with the modes the terminal was left with.
describe("F2 during start-up (opentui-0-6 task 6.1)", () => {
  test("F2 pressed from the first moment and through start-up: no crash, and the status row matches the mouse modes", async () => {
    const r = start({ scenario: "basic" });
    const s = r.session;
    let presses = 0;
    while (!READY.test(s.screenText().join("\n")) && presses < 200) {
      s.sendKeys("F2");
      presses += 1;
      await Bun.sleep(15);
      await s.flush();
    }
    await s.waitFor(READY, 10000);
    await settle(s, 300);
    expect(s.exitCode).toBeNull();
    expect(s.screenText().join("\n")).not.toContain("uncaught error");
    const off = statusRow(s).includes("mouse off");
    expect(s.mouseModesSet()).toEqual(off ? [] : [1000, 1002, 1003, 1006]);
    // And F2 still works afterwards, in both directions.
    s.sendKeys("F2");
    await s.waitFor((p) => statusRow(p).includes("mouse off") !== off, 5000);
    await settle(s, 100);
    expect(s.mouseModesSet()).toEqual(off ? [1000, 1002, 1003, 1006] : []);
    expect(r.events("mouse_policy").length).toBeGreaterThan(0);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
  }, 30000);
});

describe("wheel step per terminal (phase-1a task 8.6)", () => {
  /** Scrolls the conversation to its top (cursor to the first item), then back to the prompt box. */
  async function toTop(s: PtySession): Promise<void> {
    s.sendKeys("Tab", "Home");
    // Row 3: the user card's text, below the top margin and the card's padding row, two columns
    // after its bar (`cards.padding`).
    await s.waitFor((p) => lineWithoutBar(p, p.term.buffer.active.baseY + 2) === "   history", 5000);
    s.sendKeys("Esc");
    await s.waitFor((p) => cursorRow(p) === -1, 5000);
    await settle(s, 100);
  }

  test("Override: with --wheel-lines 2, three wheel-down events at the top scroll down 6 rows", async () => {
    const s = await history(200, { args: ["--wheel-lines", "2"], env: JEDITERM });
    await toTop(s);
    const before = conversationRows(s);
    for (let i = 0; i < 3; i++) s.mouseWheel(20, 5, 65);
    await s.waitFor(() => run!.events("wheel").length === 3, 5000);
    const after = await afterChange(s, before);
    // Row 1 is the top margin, which does not scroll.
    expect(after.slice(1, after.length - 6)).toEqual(before.slice(1 + 6));
    expect(run!.events("wheel").map((e) => [e["code"], e["rows"], e["terminal"], e["source"]])).toEqual(Array(3).fill([65, 2, "jetbrains", "option"]));
  }, 60000);

  test("JetBrains default applied: each wheel event scrolls the table's JetBrains rows", async () => {
    const s = await history(200, { env: JEDITERM });
    await toTop(s);
    const step = WHEEL_TABLE.jetbrains;
    const before = conversationRows(s);
    s.mouseWheel(20, 5, 65);
    const after = await afterChange(s, before);
    // Row 1 is the top margin, which does not scroll.
    expect(after.slice(1, after.length - step)).toEqual(before.slice(1 + step));
    expect(run!.events("wheel").map((e) => [e["code"], e["direction"], e["rows"], e["terminal"], e["source"]])).toEqual([[65, "down", step, "jetbrains", "table"]]);

    // And back up by the same step.
    s.mouseWheel(20, 5, 64);
    expect(await afterChange(s, after)).toEqual(before);
  }, 60000);
});

describe("JetBrains mouse input is harmless (phase-1a task 8.7)", () => {
  /** Wheel reports each followed within 5 ms by the cursor key JediTerm may send with it. */
  function wheelWithCursorKeys(code: 68 | 69, times: number, start: number): FixtureRecord[] {
    const key = code === 68 ? "\x1b[A" : "\x1b[B";
    const out: FixtureRecord[] = [];
    for (let i = 0; i < times; i++) {
      const t = start + i * 40;
      out.push({ t_ms: t, data: sgrWheel(20, 5, code) }, { t_ms: t + 3, data: key });
    }
    return out;
  }

  test("synthetic worst case: motion without the button bit, 68 and 69 each followed by CSI A or B within 5 ms", async () => {
    const s = await history(200, { env: JEDITERM });
    // A two-line draft in the prompt box, the cursor at its end.
    s.write("line one");
    s.sendKeys("Shift+Enter");
    s.write("line two");
    await s.waitFor((p) => promptText(p).join("|") === "line one|line two", 5000);
    await settle(s, 100);
    const cursor = () => ({ x: s.term.buffer.active.cursorX, y: s.term.buffer.active.cursorY });
    const draftCursor = cursor();
    const before = conversationRows(s);
    const tool = collapsedToolRow(s, 2);

    // Motion without a pressed button over a tool line, the prompt box and the status row.
    const motion: FixtureRecord[] = [
      { t_ms: 0, data: sgrMotion(20, tool) },
      { t_ms: 5, data: sgrMotion(21, tool) },
      { t_ms: 10, data: sgrMotion(5, 18) },
      { t_ms: 15, data: sgrMotion(5, 20) },
    ];
    // Three reports up, one down, one up: 4 x 3 - 3 = 9 rows up. Had the cursor keys reached the
    // prompt box, four Ups and one Down would leave its cursor on the first line.
    await s.replay([...motion, ...wheelWithCursorKeys(68, 3, 30), ...wheelWithCursorKeys(69, 1, 200), ...wheelWithCursorKeys(68, 1, 300)]);
    await s.waitFor(() => run!.events("wheel").length === 5, 5000);
    await settle(s, 150);

    expect(promptText(s)).toEqual(["line one", "line two"]);
    expect(cursor()).toEqual(draftCursor);
    const after = conversationRows(s);
    // Nothing was expanded by the reports: the only card on screen may be the final turn's last
    // thought, which starts expanded because that turn has no answer (mvp-rendering task 9.4).
    const cardOwner = (y: number) => [...after.slice(0, y)].reverse().find((l) => !EXPANDED.test(l)) ?? "";
    expect(after.flatMap((l, y) => (EXPANDED.test(l) && !/○ Thought/.test(cardOwner(y)) ? [l] : []))).toEqual([]);
    // (row 0 is the top margin, which does not scroll)
    expect(after.slice(1 + 9)).toEqual(before.slice(1, before.length - 9));
    expect(statusRow(s)).toMatch(/scrolled/);
    expect(cursorRow(s)).toBe(-1);
    expect(run!.agentMethods().filter((m) => m === "session/prompt")).toHaveLength(1);

    // With the conversation focused, the cursor keys do not move its cursor either.
    s.sendKeys("Tab", "End");
    await s.waitFor((p) => !/scrolled/.test(statusRow(p)), 5000);
    s.sendKeys("Up", "Up", "Up");
    await settle(s, 100);
    const at = cursorRow(s);
    expect(at).toBeGreaterThanOrEqual(0);
    const item = conversationRows(s)[at];
    expect(item?.trim()).not.toBe("");
    // One report up (the cursor's item moves down three rows, still in view) with its Up.
    await s.replay(wheelWithCursorKeys(68, 1, 0));
    await s.waitFor(() => run!.events("wheel").length === 6, 5000);
    await settle(s, 150);
    expect(cursorRow(s)).toBe(at + 3);
    expect(conversationRows(s)[cursorRow(s)]).toBe(item);
    expect(promptText(s)).toEqual(["line one", "line two"]);
  }, 60000);

  // Recorded with the S1 input probe (task 10.3) in PhpStorm 2026.2.3's two terminal engines: the
  // reworked terminal on 30 September 2026 (the engine menu showed Reworked 2025 a minute later, in
  // the same tab) and the classic one on 2 October 2026. Each: three wheel notches up, three down
  // (one SGR report each, 64 and 65, no cursor keys), then pointer moves over the pane without a
  // button (35). The classic recording also has the motion report that both engines send with the
  // first wheel report after a pointer warp (the reworked one was made without a warp). Replayed at
  // the recorded timing.
  for (const engine of ["reworked", "classic"] as const) {
    test(`recorded JediTerm fixture (${engine}): the draft, its cursor and the reading position are unchanged`, async () => {
      const s = await history(200, { env: JEDITERM });
      s.write("line one");
      s.sendKeys("Shift+Enter");
      s.write("line two");
      await s.waitFor((p) => promptText(p).join("|") === "line one|line two", 5000);
      await settle(s, 100);
      const cursor = () => ({ x: s.term.buffer.active.cursorX, y: s.term.buffer.active.cursorY });
      const draftCursor = cursor();
      const before = conversationRows(s);

      const fixture = await loadFixture(`${import.meta.dir}/../fixtures/jediterm-${engine}-mouse.jsonl`);
      const wheels = fixture.filter((r) => /^\x1b\[<6[4-9];/.test(r.data)).length;
      expect(wheels).toBeGreaterThan(0);
      await s.replay(fixture);
      await s.waitFor(() => run!.events("wheel").length === wheels, 5000);
      await settle(s, 150);

      expect(promptText(s)).toEqual(["line one", "line two"]);
      expect(cursor()).toEqual(draftCursor);
      // As many notches down as up: back where it started, nothing expanded, nothing sent.
      expect(conversationRows(s)).toEqual(before);
      expect(run!.agentMethods().filter((m) => m === "session/prompt")).toHaveLength(1);
    }, 60000);
  }
});

describe("click deep in history (phase-1a task 8.8)", () => {
  test("long-session at 63x21, about 100 to 150 items up: a click expands a collapsed tool line, a second collapses it, the line stays on its row", async () => {
    const s = await history(200);
    s.sendKeys("Tab");
    await s.waitFor((p) => cursorRow(p) >= 0, 5000);
    s.write("\x1b[A".repeat(100));
    await settle(s);
    // Further up until a tool line outside any group is on screen (reads, searches and thoughts
    // are grouped in the default density, and a click on a group line opens the group).
    let y = collapsedToolRow(s, 1, false);
    for (let more = 0; y < 0 && more < 50; more++) {
      s.write("\x1b[A".repeat(2));
      await settle(s, 100);
      y = collapsedToolRow(s, 1, false);
    }
    expect(statusRow(s)).toMatch(/scrolled \d+%/);
    expect(y).toBeGreaterThanOrEqual(0);
    const line = lineWithoutBar(s, s.term.buffer.active.baseY + y);

    s.mouseClick(20, y);
    await s.waitFor((p) => EXPANDED.test(conversationRows(p)[y + 1] ?? ""), 5000);
    await settle(s, 100);
    expect(conversationRows(s)[y]).toBe(line);
    // The click put the conversation cursor on it.
    expect(cursorRow(s)).toBe(y);

    // A second click on the same cell within 400 ms is a double click (the selection takes it).
    await Bun.sleep(450);
    s.mouseClick(20, y);
    await s.waitFor((p) => !EXPANDED.test(conversationRows(p)[y + 1] ?? ""), 5000);
    await settle(s, 100);
    expect(conversationRows(s)[y]).toBe(line);
    expect(run!.agentMethods().filter((m) => m === "session/prompt")).toHaveLength(1);
  }, 60000);
});
