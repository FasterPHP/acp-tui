// Phase-1a S6, IDE session B2 finding 2; tui-theme "Text attributes end with their cells",
// scenario "Card frame edge in the last column". Text that is plain drew bold in the docked
// cards after their rows changed: a line number of the grown permission card, its title row
// after it shrank back, `A few` in question 3 of the elicitation card and the `1` of its first
// review row. OpenTUI up to 0.6.1 wrote no reset after a run that ended in a row's last column
// (#1633), so the bold right edge of the card's frame leaked into the next row's first changed
// cells. acp-tui kept the last column plain until OpenTUI fixed it in 0.6.2 (#1652); the
// workaround (`row-end.ts`) was removed by the change opentui-0-6-6. The real CLI at 63x21: after
// each change, no cell inside a card's frame, no text in its bottom border and no cell of the
// prompt box carries bold SGR, and the frame's right edge, in the last column, is bold on every
// row of the card. The byte test of the reset itself is test/renderer/row-end-reset.test.ts.
import { afterEach, describe, expect, test } from "bun:test";
import type { PtySession } from "../pty/harness.ts";
import { cardRows, promptBox, READY } from "../pty/regions.ts";
import { SIZE, startChrome, type ChromeRun } from "../overlay/cli.ts";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

function start(scenario: string): ChromeRun {
  const run = startChrome({ scenario });
  session = run.s;
  return run;
}

const afterGuard = () => Bun.sleep(400);
/** Lets the frames that follow a change reach the emulator. */
async function settle(s: PtySession) {
  await Bun.sleep(150);
  await s.flush();
}

const cellAt = (s: PtySession, y: number, x: number) => s.cell(s.term.buffer.active.baseY + y, x)!;
const BOX = /^[\s─│╭╮╰╯]$/;

/** The bold cells that should be plain, as `y:x 'c'`: inside the frame of the card whose top
 *  border holds `title`, text in its bottom border, and the prompt box. */
function strayBold(s: PtySession, title: string): string[] {
  const rows = s.screenText();
  const top = rows.findIndex((r) => r.startsWith("╭") && r.includes(title));
  const bottom = rows.findIndex((r, y) => y > top && r.startsWith("╰"));
  expect(top).toBeGreaterThanOrEqual(0);
  expect(bottom).toBeGreaterThan(top);
  const found: string[] = [];
  const check = (y: number, from: number, to: number, skip?: RegExp) => {
    for (let x = from; x < to; x++) {
      const c = cellAt(s, y, x);
      if (c.isBold() && !(skip && skip.test(c.getChars() || " "))) found.push(`${y}:${x} '${c.getChars()}'`);
    }
  };
  // Body rows: `│` is the frame (bold in the `permission` token); the padding columns beside it
  // and the rest are plain.
  for (let y = top + 1; y < bottom; y++) check(y, 2, SIZE.cols - 2);
  // The bottom border's text (`1-5 of 53`, the hints) is plain; its line is the frame.
  check(bottom, 0, SIZE.cols, BOX);
  // The prompt box below the card is never bold.
  const promptTop = rows.length - 1 - promptBox(s).length;
  for (let y = promptTop; y < rows.length - 1; y++) check(y, 0, SIZE.cols);
  return found;
}

/** The rows of the card whose top border holds `title` where the frame's right edge, in the
 *  last column, is not a bold frame glyph, as `y 'c'`. */
function plainRightEdge(s: PtySession, title: string): string[] {
  const rows = s.screenText();
  const top = rows.findIndex((r) => r.startsWith("╭") && r.includes(title));
  const bottom = rows.findIndex((r, y) => y > top && r.startsWith("╰"));
  expect(top).toBeGreaterThanOrEqual(0);
  expect(bottom).toBeGreaterThan(top);
  const found: string[] = [];
  for (let y = top; y <= bottom; y++) {
    const c = cellAt(s, y, SIZE.cols - 1);
    const glyph = y === top ? "╮" : y === bottom ? "╯" : "│";
    if (c.getChars() !== glyph || !c.isBold()) found.push(`${y} '${c.getChars()}'`);
  }
  return found;
}

describe("the docked cards' bold right edge stays in its cells (S6, B2 finding 2)", () => {
  test("permission card: at rest, at the end, grown with Ctrl+O and shrunk back", async () => {
    const run = start("permission-diff");
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor(() => cardRows(run.s).length > 0, 5000);
    await settle(run.s);
    const bottom = () => cardRows(run.s).at(-1) ?? "";
    const state = (label: string) => ({ label, stray: strayBold(run.s, "◊ Permission"), plainEdge: plainRightEdge(run.s, "◊ Permission") });
    const clean = (label: string) => ({ label, stray: [], plainEdge: [] });

    expect(state("rest")).toEqual(clean("rest"));
    run.s.sendKeys("End");
    await run.s.waitFor(() => bottom().includes(" 52-53 of 53 "), 3000);
    await settle(run.s);
    expect(state("end")).toEqual(clean("end"));
    run.s.sendKeys("Ctrl+O");
    await run.s.waitFor(() => bottom().includes(" 49-53 of 53 "), 3000);
    await settle(run.s);
    expect(state("grown")).toEqual(clean("grown"));
    run.s.sendKeys("Ctrl+O");
    await run.s.waitFor(() => bottom().includes(" 52-53 of 53 "), 3000);
    await settle(run.s);
    expect(state("back")).toEqual(clean("back"));
    // The title row is plain text, and the header word keeps its bold.
    const title = run.s.screenText().findIndex((r) => r.includes("Edit src/Http/Router.php") && r.startsWith("│"));
    expect(cellAt(run.s, title, 2).isBold()).toBe(0);
    const header = run.s.screenText().findIndex((r) => r.startsWith("╭─ ◊ Permission"));
    expect(cellAt(run.s, header, 5).getChars()).toBe("P");
    expect(cellAt(run.s, header, 5).isBold()).not.toBe(0);
  }, 30000);

  test("elicitation card: each question and the review", async () => {
    const run = start("elicitation");
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "go" }, "Enter");
    const state = (label: string) => ({ label, stray: strayBold(run.s, "◊ "), plainEdge: plainRightEdge(run.s, "◊ ") });
    const clean = (label: string) => ({ label, stray: [], plainEdge: [] });

    await run.s.waitFor("Question 1 of 3", 5000);
    await settle(run.s);
    expect(state("q1")).toEqual(clean("q1"));
    await afterGuard();
    run.s.sendKeys("2", "Enter");
    await run.s.waitFor("Question 2 of 3", 3000);
    await settle(run.s);
    expect(state("q2")).toEqual(clean("q2"));
    run.s.sendKeys("Space", "2", "Enter");
    await run.s.waitFor("Question 3 of 3", 3000);
    await settle(run.s);
    expect(state("q3")).toEqual(clean("q3"));
    run.s.sendKeys({ text: "be careful" });
    await run.s.waitFor("› be careful", 3000);
    await settle(run.s);
    expect(state("q3 typed")).toEqual(clean("q3 typed"));
    run.s.sendKeys("Enter");
    await run.s.waitFor("Review your answers", 3000);
    await settle(run.s);
    expect(state("review")).toEqual(clean("review"));
    // Back to question 3 by its digit, and on to the review again.
    run.s.sendKeys("3");
    await run.s.waitFor("Question 3 of 3", 3000);
    await settle(run.s);
    expect(state("q3 again")).toEqual(clean("q3 again"));
  }, 30000);
});
