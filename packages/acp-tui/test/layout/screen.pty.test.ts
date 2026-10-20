// Tasks 6.1, 6.2 and 6.4 verification (spec tui-layout "Declarative screen
// layout", "Bar modules", "Activity bar"): the real CLI against fake-agent
// under the PTY harness at IDE-pane sizes. The default layout at rest in a
// 21-row pane, the header-bar layout (through test/layout/cli-with-layout.ts,
// since layouts are not configurable until the MVP), the status row in a
// narrow pane, the armed exit without a hints module, the `position` module,
// and the activity bar while running and once idle.
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { PtySession } from "../pty/harness.ts";
import { activityRow, CARD_HEADER, cardRows, promptBox, READY, REQUIRES_ACTION, RUNNING, statusRow } from "../pty/regions.ts";
import { startCli, type CliRun } from "../keys/cli-pty.ts";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

const SIZE = { cols: 63, rows: 21 };
const WITH_LAYOUT = join(import.meta.dir, "cli-with-layout.ts");
const responses = (run: CliRun) => run.entries().filter((e) => e.method === "session/request_permission/response");

/** Runs the basic scenario's turn to its end: the conversation then holds far more than a screen. */
async function finishTurn(run: CliRun) {
  await run.s.waitFor(READY, 10000);
  run.s.sendKeys({ text: "go" }, "Enter");
  await run.s.waitFor(CARD_HEADER, 5000);
  await Bun.sleep(400);
  run.s.sendKeys("Enter");
  await run.s.waitFor(() => responses(run).length === 1, 5000);
  await run.s.waitFor(READY, 5000);
  await run.s.waitFor("end turn", 5000);
  await Bun.sleep(200);
  await run.s.flush();
}

describe("default layout (task 6.1)", () => {
  test("default layout at rest in a 21-row pane: row 1 blank, conversation rows 2 to 13, row 14 the activity line (blank at rest), prompt box 15 to 18 with one text row and its padding row, row 19 blank, status row 20, row 21 blank", async () => {
    const run = startCli("basic", 0, SIZE);
    session = run.s;
    await finishTurn(run);
    const screen = run.s.screenText();
    expect(screen).toHaveLength(21);
    // The top margin, then the conversation fills rows 2 to 13 and follows the bottom: its last row
    // is the turn end.
    expect(screen[0]).toBe("");
    expect(screen[12]).toMatch(/^ {2}end turn · /);
    expect(screen.slice(1, 13).every((row) => !/^[╭│╰]/.test(row))).toBe(true);
    expect(screen[1]).not.toBe("");
    // No header row, nothing in the activity bar and no card at rest.
    expect(activityRow(run.s)).toBeNull();
    expect(cardRows(run.s)).toEqual([]);
    // The activity bar's line keeps its row between the conversation and the prompt box for the
    // whole session (day-two-feedback task 13.2), blank at rest; at this height the conversation
    // keeps its floor of 12 rows, so the line's blank row above it is not drawn.
    expect(screen[13]).toBe("");
    expect(screen[14]).toStartWith("╭");
    expect(screen.slice(15, 17).every((row) => row.startsWith("│"))).toBe(true);
    expect(screen[17]).toStartWith("╰");
    expect(promptBox(run.s)).toHaveLength(4);
    // The spacer, the status row, the bottom margin.
    expect(screen[18]).toBe("");
    expect(screen[19]).toBe(statusRow(run.s));
    // `cwd`, `turn-state` and (room permitting; this temporary cwd is long) the hints; `connection`.
    expect(screen[19]).toMatch(/^ \/\S+ {2}idle\s.*connected/);
    expect(screen[20]).toBe("");
  }, 20000);

  test("alternative layout with a header bar: row 1 blank, agent and cwd on row 2, conversation from row 3, turn state and connection on the second-last row, last row blank", async () => {
    const run = startCli("basic", 0, { ...SIZE, entry: WITH_LAYOUT, env: { ACP_TUI_TEST_LAYOUT: "compact" } });
    session = run.s;
    await finishTurn(run);
    const screen = run.s.screenText();
    expect(screen[0]).toBe("");
    expect(screen[1]).toMatch(/^ fake-agent {2}\/\S+$/);
    // The conversation takes rows 3 to 14: the activity line (blank), the prompt box (one text row
    // and its padding row, no spacer in this layout) and the status row follow it.
    expect(screen[2]).not.toBe("");
    expect(screen[2]).not.toMatch(/^[╭│╰]/);
    expect(screen[13]).toMatch(/^ {2}end turn · /);
    expect(screen[14]).toBe("");
    expect(screen[15]).toStartWith("╭");
    expect(screen[18]).toStartWith("╰");
    expect(screen[19]).toMatch(/^ idle\s+connected$/);
    expect(screen[20]).toBe("");
  }, 20000);
});

describe("status row modules (task 6.2)", () => {
  test("narrow pane with a permission request: modules dropped until the row fits; the turn state still reads requires_action", async () => {
    const run = startCli("basic", 0, { cols: 60, rows: 21 });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor(REQUIRES_ACTION, 5000);
    await run.s.flush();
    const row = statusRow(run.s);
    expect(Bun.stringWidth(row)).toBeLessThanOrEqual(60);
    expect(row).toMatch(/ requires_action .*connected$/);
  }, 20000);

  // Since mvp-conversation task 5.6 Ctrl+C no longer arms exit (design D7), so the armed state is
  // the detach confirmation (Ctrl+D during a turn) and the armed interrupt (Esc during a turn).
  test("armed detach without a hints module: the status row shows that a second Ctrl+D detaches", async () => {
    const layout = { margins: { top: 1, bottom: 1 }, screen: ["conversation", "activity", "card", "prompt", { spacer: 1 }, "find", { left: ["cwd", "turn-state"], right: ["connection"] }] };
    const run = startCli("basic", 1000, { ...SIZE, entry: WITH_LAYOUT, env: { ACP_TUI_TEST_LAYOUT: JSON.stringify(layout) } });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    expect(statusRow(run.s)).not.toContain("enter send");
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor(RUNNING, 5000);
    run.s.sendKeys("Ctrl+D");
    await run.s.waitFor((p) => statusRow(p).includes("ctrl+d again to detach"), 5000);
    expect(statusRow(run.s)).toMatch(/ctrl\+d again to detach and stop the turn\s+connected$/);
    // The armed state lapses after 2 s, and the state reads running again.
    await run.s.waitFor((p) => RUNNING.test(statusRow(p)), 4000);
    expect(run.s.exitCode).toBeNull();
    run.s.sendKeys("Ctrl+D");
    await run.s.waitFor((p) => statusRow(p).includes("ctrl+d again to detach"), 5000);
    run.s.sendKeys("Ctrl+D");
    expect(await run.s.wait(10000)).toBe(0);
  }, 20000);

  test("armed interrupt in the default layout: the hints give way to the armed state", async () => {
    const run = startCli("basic", 1000, SIZE);
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor(RUNNING, 5000);
    run.s.sendKeys("Esc");
    await run.s.waitFor((p) => statusRow(p).includes("esc again to interrupt"), 5000);
    expect(statusRow(run.s)).not.toContain("enter send");
  }, 20000);

  test("position while scrolled up: the module appears on PgUp and disappears once the conversation follows the bottom", async () => {
    const run = startCli("basic", 0, SIZE);
    session = run.s;
    await finishTurn(run);
    expect(statusRow(run.s)).not.toContain("scrolled");
    const bottom = run.s.screenText()[12];
    run.s.sendKeys("PageUp");
    await run.s.waitFor((p) => /scrolled \d+%/.test(statusRow(p)), 5000);
    expect(run.s.screenText()[12]).not.toBe(bottom);
    // PgDn back to the bottom: following again, the module is gone and the last row is back.
    for (let i = 0; i < 5; i++) run.s.sendKeys("PageDown");
    await run.s.waitFor((p) => !statusRow(p).includes("scrolled"), 5000);
    expect(run.s.screenText()[12]).toBe(bottom);
  }, 20000);
});

describe("activity bar (task 6.4)", () => {
  test("running: the number of tool calls in progress and the latest one's title (five-tools)", async () => {
    // delay-scale 100: the five tool calls stay in progress for 5 s.
    const run = startCli("five-tools", 100, SIZE);
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor((p) => activityRow(p) === "  5 running: Run check 5", 5000);
    // The activity bar sits directly above the prompt box, after its blank row, in place of the
    // blank row above the prompt box: the conversation gave up a row.
    const screen = run.s.screenText();
    expect(screen[12]).toBe("");
    expect(screen[13]).toBe("  5 running: Run check 5");
    expect(screen[14]).toStartWith("╭");
    expect(statusRow(run.s)).toMatch(RUNNING);
  }, 20000);

  test("running with a plan: 2 running with the latest title, plan 2/5 and the third entry (plan-running)", async () => {
    // delay-scale 100: plan-running holds the state for 10 s, and the test cancels it.
    const run = startCli("plan-running", 100, SIZE);
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "go" }, "Enter");
    const row = "  2 running: Search routes · plan 2/5 ▸ Write the test";
    await run.s.waitFor((p) => activityRow(p) === row, 5000);
    // Both titles and the plan entry fit at 63 columns, so nothing is truncated or dropped; the
    // bar sits directly above the prompt box.
    expect(Bun.stringWidth(row)).toBeLessThanOrEqual(SIZE.cols);
    const screen = run.s.screenText();
    expect(screen[13]).toBe(row);
    expect(screen[14]).toStartWith("╭");
    expect(statusRow(run.s)).toMatch(RUNNING);
    // Esc twice cancels the turn: the bar goes away.
    run.s.sendKeys("Esc");
    await run.s.waitFor((p) => statusRow(p).includes("esc again to interrupt"), 5000);
    run.s.sendKeys("Esc");
    await run.s.waitFor((p) => activityRow(p) === null, 5000);
  }, 20000);

  test("Space above the running action: a blank row between the conversation's last row and the activity line, whose text starts in the column of the tool glyphs (plan-running at 90x24)", async () => {
    // 90x24: the blank row is drawn where the conversation keeps its floor of 12 with it (task 13.2); at 90x12 the conversation would keep fewer than 4 rows, so the blank
    // row gives way there (spec tui-layout "Spacing gives way before content").
    const run = startCli("plan-running", 60, { cols: 90, rows: 24 });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor((p) => activityRow(p) !== null, 5000);
    await run.s.flush();
    const rows = run.s.screenText();
    const line = rows.findIndex((r) => /^ +\d+ running: /.test(r));
    expect(line).toBeGreaterThan(2);
    // The blank row (the conversation need not fill its rows at 90x24; the row counts are
    // covered by test/layout/layout.test.ts "spacing").
    expect(rows[line - 1]).toBe("");
    expect(rows[line + 1]).toStartWith("╭");
    // The tool lines above start their glyph in the activity line's first column.
    const tool = rows.find((r) => /^ +\S .*#\d+( {2}[│█])?$/.test(r) && /(read|search)/.test(r));
    expect(tool).toBeDefined();
    expect(rows[line]!.search(/\S/)).toBe(tool!.search(/\S/));
  }, 20000);

  test("Space above the prompt box when idle: after basic's turn at 63x23 a blank row and the blank activity line separate the conversation's last row from the prompt box, which rests at two text rows (day-one-feedback 13, day-two-feedback 13.2)", async () => {
    const run = startCli("basic", 0, { cols: 63, rows: 23 });
    session = run.s;
    await finishTurn(run);
    const rows = run.s.screenText();
    const box = rows.findIndex((r, y) => r.startsWith("╭") && rows[y + 1]?.startsWith("│") && y > 10);
    expect(box).toBe(1 + 12 + 2);
    expect(rows[box - 1]).toBe("");
    expect(rows[box - 2]).toBe("");
    expect(rows[box - 3]).toMatch(/end turn/);
    // Frame, two text rows and the padding row.
    expect(promptBox(run.s)).toHaveLength(5);
  }, 20000);

  test("awaiting permission, with the running tools (basic)", async () => {
    const run = startCli("basic", 0, SIZE);
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor(CARD_HEADER, 5000);
    expect(activityRow(run.s)).toBe("  2 running: Edit src/index.ts · awaiting permission");
  }, 20000);

  test("idle: when the turn ends the activity line goes blank but keeps its row, so the conversation does not move (day-two-feedback 13.2)", async () => {
    const run = startCli("five-tools", 20, SIZE);
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor((p) => activityRow(p) !== null, 5000);
    expect(run.s.screenText()[13]).toMatch(/running/);
    await run.s.waitFor(READY, 5000);
    await run.s.waitFor((p) => activityRow(p) === null, 5000);
    await run.s.waitFor("end turn", 5000);
    // The short conversation starts below the top margin; row 14 is the blank activity line above
    // the prompt box, which has not moved.
    const screen = run.s.screenText();
    expect(screen[13]).toBe("");
    expect(screen[14]).toStartWith("╭");
    expect(screen.slice(1, 13).filter((r) => /✓ execute .*#\d$/.test(r))).toHaveLength(5);
  }, 20000);
});
