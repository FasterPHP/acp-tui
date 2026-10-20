// Phase-1a task 8.4: the screen keys from any focus and the conversation's
// jump and page keys (spec tui-keymap "Screen keys", "Conversation keys"),
// through the real CLI against fake-agent's `long-session` under the PTY
// harness. Repaint: cells overwritten in the headless terminal behind the
// app's back are put right by Ctrl+L, which also re-queries the terminal's
// colours, and the screen then equals a fresh render brought to the same
// state (draft, scroll position, focus). Ctrl+O and F2 act whichever region
// has focus. Timings in the conversation (`0.0s`) are masked in comparisons.
import { afterEach, describe, expect, test } from "bun:test";
import { dirname } from "node:path";
import { compactEnv } from "../pty/config-home.ts";
import { diffSnapshots, freshRender, type PtySession, type ScreenSnapshot } from "../pty/harness.ts";
import { lineWithoutBar, promptText, screenGap, statusRow, withoutBar } from "../pty/regions.ts";
import { CLI, FAKE_AGENT, readEvents, sendPrompt, settle, startCli, type CliRun } from "../conversation/cli.ts";

let run: CliRun | undefined;
afterEach(async () => {
  run?.session.kill("SIGTERM");
  await run?.session.dispose();
  run = undefined;
});

/** The rows above the prompt box (no activity bar or card once the turn has ended). */
/** The conversation's first screen row, below the top margin (mvp-chrome-and-keys task 4.1). */
const TOP = 1;

function conversationRows(s: PtySession): string[] {
  const lines = withoutBar(s.screenText());
  let end = lines.findIndex((l) => l.startsWith("╭"));
  // Less the activity bar's line, which keeps its row for the whole session (day-two-feedback
  // 13.2), and its blank row above it where that is drawn.
  if (end > 0) end--;
  if (end > 0 && screenGap(s, end - 1)) end--;
  return lines.slice(TOP, end < 0 ? lines.length : end);
}

/** The row of the conversation cursor under the flat theme: its gutter (or, on a user card, the
 *  cell beside the accent) is in inverse video. */
function cursorRow(s: PtySession): number {
  const base = s.term.buffer.active.baseY;
  return conversationRows(s).findIndex((_, y) => s.cell(base + TOP + y, 0)!.isInverse() !== 0 || s.cell(base + TOP + y, 1)!.isInverse() !== 0);
}

/** Compared cell by cell, and the cursor too when it is shown. */
function diff(a: ScreenSnapshot, s: PtySession): string[] {
  const core = (s.term as unknown as { _core: { coreService: { isCursorHidden: boolean } } })._core;
  return diffSnapshots(masked(a), masked(s.screenSnapshot()), { cursor: !core.coreService.isCursorHidden });
}

const TIMING = /\d+\.\ds/g;
const masked = (snapshot: ScreenSnapshot): ScreenSnapshot => ({ ...snapshot, lines: snapshot.lines.map((l) => l.replace(TIMING, "#.#s")) });

/** `long-session` with `items` items, idle after its one turn. */
async function history(items: number, cols = 63, rows = 21): Promise<CliRun> {
  run = startCli({ scenario: "long-session", cols, rows, agentArgs: ["--items", String(items)] });
  await sendPrompt(run.session, "history");
  await run.session.waitFor(/end turn/, 20000);
  await settle(run.session);
  return run;
}

describe("screen keys (phase-1a task 8.4)", () => {
  test("Repaint: overwritten cells are redrawn by Ctrl+L with the conversation cursor focused; draft, scroll position and content unchanged; colours re-queried", async () => {
    const r = await history(30, 80, 24);
    const s = r.session;
    // A draft, the reader scrolled up a page, and focus in the conversation (Ctrl+L from any focus).
    const drive = async (p: PtySession) => {
      if (p !== s) {
        await sendPrompt(p, "history");
        await p.waitFor(/end turn/, 20000);
        await settle(p);
      }
      p.sendKeys({ text: "a draft" });
      await p.waitFor((q) => promptText(q)[0] === "a draft", 5000);
      p.sendKeys("PageUp");
      await p.waitFor((q) => /scrolled/.test(statusRow(q)), 5000);
      p.sendKeys("Tab");
      await p.waitFor((q) => cursorRow(q) >= 0, 5000);
      await settle(p);
    };
    await drive(s);
    const before = s.screenSnapshot();
    const queries = s.oscQueries.length;

    await new Promise<void>((resolve) => s.term.write("\x1b7\x1b[3;5H\x1b[31mSTALE-CELLS\x1b[0m\x1b[22;1HXXXXXXXX\x1b8", resolve));
    expect(s.screenText().join("\n")).toContain("STALE-CELLS");
    s.sendKeys("Ctrl+L");
    await s.waitFor(() => readEvents(r.logPath, "repaint").some((e) => e["cause"] === "key"), 5000);
    await settle(s);
    expect(s.screenText().join("\n")).not.toContain("STALE-CELLS");
    expect(s.screenText().join("\n")).not.toContain("XXXXXXXX");
    expect(diff(before, s)).toEqual([]);
    // The theme's colours were asked for again (OSC 10 and 11).
    expect(s.oscQueries.slice(queries)).toEqual(expect.arrayContaining([10, 11]));

    const command = ["bun", CLI, "--", "bun", FAKE_AGENT, "--scenario", "long-session", "--items", "30", "--delay-scale", "0"];
    const fresh = await freshRender(command, 80, 24, { cwd: dirname(r.logPath), env: compactEnv(), drive, ready: (p) => cursorRow(p) >= 0 });
    expect(diff(fresh, s)).toEqual([]);
  }, 60000);

  test("Ctrl+O and F2 act with the conversation focused, which keeps focus", async () => {
    const r = await history(30);
    const s = r.session;
    s.sendKeys("Tab");
    await s.waitFor((p) => cursorRow(p) >= 0, 5000);
    // Ctrl+O with the conversation focused toggles the latest tool call (expanded: a card row).
    s.sendKeys("Ctrl+O");
    await s.waitFor((p) => p.screenText().some((l) => /^ {2}┃/.test(l)), 5000);
    s.sendKeys("F2");
    await s.waitFor((p) => statusRow(p).includes("mouse off"), 5000);
    s.sendKeys("F2");
    await s.waitFor((p) => !statusRow(p).includes("mouse off"), 5000);
    // Still in the conversation: End brings its cursor back to the last item.
    s.sendKeys("End");
    await s.waitFor((p) => cursorRow(p) === conversationRows(p).length - 1, 5000);
  }, 60000);
});

describe("conversation keys (phase-1a task 8.4)", () => {
  test("First and last: with 200 items, Home puts the cursor on the first item in view, End on the last with the conversation following", async () => {
    const r = await history(200);
    const s = r.session;
    s.sendKeys("Tab");
    await s.waitFor((p) => cursorRow(p) >= 0, 5000);
    s.sendKeys("Home");
    await s.waitFor((p) => cursorRow(p) === 1 && lineWithoutBar(p, p.term.buffer.active.baseY + TOP + 1) === "   history", 5000);
    expect(statusRow(s)).toMatch(/scrolled \d+%/);
    s.sendKeys("End");
    await s.waitFor((p) => !/scrolled/.test(statusRow(p)), 5000);
    await settle(s);
    const rows = conversationRows(s);
    expect(rows.at(-1)).toMatch(/^ {2}end turn · /);
    expect(cursorRow(s)).toBe(rows.length - 1);
  }, 60000);

  test("Page keys from the prompt box: PgUp scrolls by the conversation's height less two rows, the draft unchanged", async () => {
    const r = await history(200);
    const s = r.session;
    s.sendKeys({ text: "keep me" });
    await s.waitFor((p) => promptText(p)[0] === "keep me", 5000);
    await settle(s);
    const before = conversationRows(s);
    const height = before.length;
    s.sendKeys("PageUp");
    await s.waitFor((p) => /scrolled/.test(statusRow(p)), 5000);
    await settle(s);
    const after = conversationRows(s);
    expect(after).toHaveLength(height);
    // The old top two rows are now the bottom two: the view moved up by height - 2.
    expect(after.slice(height - 2)).toEqual(before.slice(0, 2));
    expect(after.slice(0, height - 2)).not.toEqual(before.slice(0, height - 2));
    expect(promptText(s)).toEqual(["keep me"]);
    expect(cursorRow(s)).toBe(-1);
  }, 60000);
});
