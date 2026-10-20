// mvp-chrome-and-keys task 4.2 (spec tui-layout "Margins and row budget";
// design D1): the real CLI against fake-agent under the PTY harness, as screen
// dumps at the measured pane sizes (63x21 PhpStorm, 61x20 Zed) and below. The
// margins are kept at every height; the prompt box rests at the largest of 3,
// 2 or 1 text rows that, with its frame, its padding row (day-one-feedback task 7.1) and the blank
// row above it (task 13.3), leaves the conversation 12 rows (the default of
// `layout.conversation_min_rows`, mvp-configuration task 6.4); where even one text row and the
// blank row do not, the blank row gives way and the rest is as before; with a docked card open
// and an empty prompt box it rests at 1.
import { afterEach, describe, expect, test } from "bun:test";
import type { PtySession } from "../pty/harness.ts";
import { activityRow, blankAbovePrompt, CARD_HEADER, cardRows, promptBox, promptRows, READY, statusRow } from "../pty/regions.ts";
import { startCli } from "../keys/cli-pty.ts";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

/** The screen's rows by region: the margins, the rows between the top margin and the prompt box's
 *  top border (the conversation, and the blank row above the prompt box where it is drawn: at rest
 *  the splash makes it look like the conversation's own, so the tests count it by the budget), the
 *  prompt box's text rows, the spacer, the status row. */
function regions(s: PtySession) {
  const rows = s.screenText();
  const box = promptBox(s);
  const top = rows.findIndex((row, y) => row === box[0] && rows[y + box.length - 1] === box.at(-1));
  return {
    rows,
    topMargin: rows[0],
    aboveBox: rows[top - 1],
    conversationRows: top - 1,
    promptRows: promptRows(s),
    spacer: rows[top + box.length],
    status: rows.at(-2),
    bottomMargin: rows.at(-1),
  };
}

async function atRest(cols: number, rows: number) {
  const run = startCli("basic", 0, { cols, rows });
  session = run.s;
  await run.s.waitFor(READY, 10000);
  await run.s.flush();
  return regions(run.s);
}

describe("margins and row budget (task 4.2)", () => {
  test("21 rows: the prompt box shows 1 text row and its padding row, a blank row above it, and the conversation 12 rows (63x21)", async () => {
    const r = await atRest(63, 21);
    expect(r.topMargin).toBe("");
    // The conversation's 12 rows and the blank row above the prompt box.
    expect(r.conversationRows).toBe(12 + 1);
    expect(r.aboveBox).toBe("");
    expect(r.promptRows).toBe(1);
    expect(promptBox(session!)).toHaveLength(4);
    expect(r.spacer).toBe("");
    expect(r.status).toMatch(READY);
    expect(r.bottomMargin).toBe("");
  }, 20000);

  test("20 rows: the prompt box shows 1 text row and its padding row, and the conversation 12 rows (61x20)", async () => {
    const r = await atRest(61, 20);
    expect(r.topMargin).toBe("");
    expect(r.conversationRows).toBe(12);
    // The blank row would leave the conversation 11: it gives way, so all 12 rows are the
    // conversation's.
    expect(r.promptRows).toBe(1);
    expect(promptBox(session!)).toHaveLength(4);
    expect(r.spacer).toBe("");
    expect(r.status).toMatch(READY);
    expect(r.bottomMargin).toBe("");
  }, 20000);

  test("19 rows: 1 text row, the floor out of reach, so the conversation 11 rows (63x19)", async () => {
    const r = await atRest(63, 19);
    expect(r.conversationRows).toBe(11);
    expect(r.promptRows).toBe(1);
    expect([r.topMargin, r.spacer, r.bottomMargin]).toEqual(["", "", ""]);
  }, 20000);

  test("short pane keeps its margins: rows 1 and 16 blank, 1 text row and its padding row, the conversation 8 rows (63x16)", async () => {
    const r = await atRest(63, 16);
    expect(r.rows).toHaveLength(16);
    expect(r.rows[0]).toBe("");
    expect(r.rows[15]).toBe("");
    expect(r.promptRows).toBe(1);
    expect(r.conversationRows).toBe(8);
    expect(r.status).toMatch(READY);
  }, 20000);

  test("card open: a permission card at 63x21 with an empty prompt box leaves the prompt box 1 text row, and the card takes the rows it gives up", async () => {
    const run = startCli("basic", 0, { cols: 63, rows: 21 });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor(CARD_HEADER, 5000);
    await run.s.waitFor((p) => promptRows(p) === 1, 5000);
    await run.s.flush();
    const open = regions(run.s);
    expect(open.promptRows).toBe(1);
    // The rows between the margins add up: the conversation, the activity bar, the card, their
    // blank rows and the one-row prompt box share what the prompt box, the blank row above it and
    // the conversation had at rest (how tall the card grows from them is the card's own height
    // rule, task 5.1). (`conversationRows` counts every row above the prompt box: the card, the
    // activity bar and their blank rows too.)
    const activity = activityRow(run.s) === null ? 0 : 1;
    expect(open.aboveBox).toStartWith("╰");
    expect(open.conversationRows + open.promptRows).toBe(12 + 1 + 1);
    // Less the activity line, its blank row and the blank row above the card (drawn at 63x21 with
    // basic's card, which has no preview: only the row below the card gives way).
    expect(open.conversationRows - activity - 2 - cardRows(run.s).length).toBeGreaterThanOrEqual(4);
    expect(cardRows(run.s).length).toBeGreaterThan(0);
    expect(open.topMargin).toBe("");
    expect(open.spacer).toBe("");
    expect(open.bottomMargin).toBe("");
    expect(statusRow(run.s)).toContain("requires_action");
    // Answered: the card leaves and the prompt box rests at 1 again, under the blank row.
    await Bun.sleep(400);
    run.s.sendKeys("Enter");
    await run.s.waitFor((p) => cardRows(p).length === 0 && promptRows(p) === 1 && blankAbovePrompt(p), 5000);
  }, 20000);
});
