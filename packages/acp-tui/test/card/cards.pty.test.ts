// mvp-chrome-and-keys task group 5: the docked permission card as product,
// against fake-agent at 63x21 (PhpStorm reworked's pane size), without any
// `--spike`. Spec tui-layout "Permission card", "Permission card preview",
// "Spacing gives way before content". In this pane every decorative row (the
// blank rows around the card and above the activity line, the card's padding
// rows, the prompt box's padding row) gives way before the card's content
// (day-one-feedback task group 13), so a four-option card keeps the two
// preview rows it had before day-one-feedback; "Padding and gaps in a tall
// pane" below holds the spacing a tall pane keeps.
//
// The conversation's rows are read as the rows above the card less the default
// layout's one-row top margin (task 4.1) and the activity bar. Below the card at
// rest: the prompt box (one text row with a card open and an empty draft, task
// 4.2), the spacer, the status row and the bottom margin.
import { afterEach, describe, expect, test } from "bun:test";
import type { PtySession } from "../pty/harness.ts";
import { activityRow, CARD_HEADER, cardRows, promptBox, promptText, READY, uncard } from "../pty/regions.ts";
import { startChrome, type ChromeRun } from "../overlay/cli.ts";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

function start(scenario: string, opts: Partial<Parameters<typeof startChrome>[0]> = {}): ChromeRun {
  const run = startChrome({ scenario, args: [], ...opts });
  session = run.s;
  return run;
}

async function prompt(run: ChromeRun, text = "go"): Promise<void> {
  await run.s.waitFor(READY, 10000);
  run.s.sendKeys({ text }, "Enter");
}

const cardTop = (s: PtySession) => s.screenText().findIndex((r) => r.startsWith(`╭─ ${CARD_HEADER}`));
/** The default layout's top margin (spec tui-layout "Margins and row budget"). */
const TOP_MARGIN = 1;
/** Rows the conversation shows: those above the card, less the top margin and the activity bar
 *  (its line only: in a 21 or 22-row pane its blank row and the card's have given way). */
const conversationRows = (s: PtySession) => cardTop(s) - TOP_MARGIN - (activityRow(s) === null ? 0 : 1);
const bottom = (s: PtySession) => cardRows(s).at(-1) ?? "";
const responses = (run: ChromeRun, method: string) => run.agent().filter((e) => e.method === method).map((e) => e.params);

describe("permission card height (task 5.1, design D6)", () => {
  test("Conversation keeps four rows: a 60-line diff at 63x21 with an empty prompt box; the preview takes the rest", async () => {
    const run = start("permission-diff");
    await prompt(run);
    await run.s.waitFor(() => cardRows(run.s).length > 0, 5000);
    await run.s.flush();
    expect(conversationRows(run.s)).toBe(4);
    // Card, prompt box (one text row, 3 rows: its padding row has given way), spacer, status row
    // and bottom margin fill the rest of the screen, with no row between.
    const rows = cardRows(run.s);
    expect(cardTop(run.s) + rows.length).toBe(21 - 6);
    // The title, two preview rows and four options: as many preview lines as the rows allow.
    expect(rows.slice(1, -1).map((r) => uncard(r)).slice(-4)).toEqual(["1 allow once", "2 allow always", "3 reject once", "4 reject always"]);
    expect(bottom(run.s)).toContain(" 1-2 of 53 ");
  }, 20000);

  test("Four options in a 21-row pane: every decorative row gives way, so the title, two preview rows and the four options show; the activity line directly above the card, the prompt box directly below it", async () => {
    const run = start("permission-diff");
    await prompt(run);
    await run.s.waitFor(() => cardRows(run.s).length > 0, 5000);
    await run.s.flush();
    const rows = cardRows(run.s);
    // Title, two preview rows (the path and the hunk header), four stacked options: 9 rows with the
    // frame and no padding rows, as before day-one-feedback.
    expect(rows.slice(1, -1).map((r) => uncard(r))).toEqual([
      "Edit src/Http/Router.php",
      "/work/src/Http/Router.php",
      expect.stringMatching(/^@@ /),
      "1 allow once",
      "2 allow always",
      "3 reject once",
      "4 reject always",
    ]);
    expect(bottom(run.s)).toContain(" 1-2 of 53 ");
    expect(conversationRows(run.s)).toBe(4);
    // The row directly above the card is the activity line, the row directly below it the prompt
    // box's top border, and the prompt box has no padding row.
    expect(activityRow(run.s)).toContain("awaiting permission");
    expect(run.s.screenText()[cardTop(run.s) - 1]).toContain("awaiting permission");
    expect(run.s.screenText()[cardTop(run.s) + rows.length]).toStartWith("╭");
    expect(promptBox(run.s)).toHaveLength(3);
    expect(cardTop(run.s) + rows.length).toBe(21 - 6);
  }, 20000);

  test("One row more: at 63x22 the card is the same, and the prompt box's padding row, the last to give way, is back", async () => {
    const run = start("permission-diff", { rows: 22 });
    await prompt(run);
    await run.s.waitFor(() => cardRows(run.s).length > 0, 5000);
    await run.s.flush();
    const rows = cardRows(run.s);
    expect(rows).toHaveLength(9);
    expect(bottom(run.s)).toContain(" 1-2 of 53 ");
    expect(conversationRows(run.s)).toBe(4);
    expect(promptBox(run.s)).toHaveLength(4);
    expect(cardTop(run.s) + rows.length).toBe(22 - 7);
  }, 20000);

  test("Scroll to the last line: End shows the hunk's last row, and the range ends there", async () => {
    const run = start("permission-diff");
    await prompt(run);
    await run.s.waitFor(() => cardRows(run.s).length > 0, 5000);
    run.s.sendKeys("End");
    await run.s.waitFor(() => bottom(run.s).includes(" 52-53 of 53 "), 3000);
    const body = cardRows(run.s).slice(1, -1).map((r) => uncard(r));
    expect(body[2]).toBe("38       unchanged tail line 3");
    expect(responses(run, "session/request_permission/response")).toEqual([]);
  }, 20000);

  test("Grown with a tall draft: a 5-line draft, the card grown, a sixth line; the conversation keeps one row, the card shrinks by one, no stale cell", async () => {
    const run = start("permission-diff");
    await prompt(run);
    await run.s.waitFor(() => cardRows(run.s).length > 0, 5000);
    // The card has focus (the prompt box was empty): grow it, then Esc back to the prompt box.
    run.s.sendKeys("Ctrl+O");
    await run.s.waitFor(() => conversationRows(run.s) === 1, 3000);
    run.s.sendKeys("Esc");
    // On its own: Esc and a letter in one read would be Alt+letter.
    await Bun.sleep(150);
    for (const line of ["one", "two", "three", "four"]) run.s.sendKeys({ text: line }, "Shift+Enter");
    run.s.sendKeys({ text: "five" });
    await run.s.waitFor((p) => promptText(p).length === 5 && promptText(p)[4] === "five", 5000);
    await run.s.flush();
    expect(conversationRows(run.s)).toBe(1);
    const grown = cardRows(run.s).length;

    run.s.sendKeys("Shift+Enter", { text: "six" });
    await run.s.waitFor((p) => promptText(p).length === 6 && promptText(p)[5] === "six", 5000);
    await run.s.flush();
    expect(conversationRows(run.s)).toBe(1);
    expect(cardRows(run.s).length).toBe(grown - 1);
    // Card, prompt box (8 rows: its padding row has given way), spacer, status row and bottom
    // margin fill the screen below it.
    expect(cardTop(run.s) + cardRows(run.s).length + 8 + 3).toBe(21);
    // No stale cell: a full repaint (Ctrl+L) draws the same screen.
    const before = run.s.screenText();
    run.s.sendKeys("Ctrl+L");
    await Bun.sleep(300);
    await run.s.flush();
    expect(run.s.screenText()).toEqual(before);
    expect(responses(run, "session/request_permission/response")).toEqual([]);
  }, 30000);
});

// Focus stops (task 5.2 and 3.9; spec tui-layout "Permission card focus and typing guard",
// tui-keymap "Focus cycle" and "Permission card keys"). Read under the flat theme (no colour
// replies): the selected option is in inverse video, and the preview's range in the bottom border
// is in the accent colour (ANSI 4) only while the preview has focus.
const ACCENT_FG = 4;
const cellOf = (s: PtySession, y: number, x: number) => s.cell(s.term.buffer.active.baseY + y, x)!;
/** The option labels drawn selected (inverse video). */
function selectedOptions(s: PtySession): string[] {
  const rows = s.screenText();
  const top = cardTop(s);
  const out: string[] = [];
  for (let y = top + 1; top >= 0 && y < rows.length && !rows[y]!.startsWith("╰"); y++) {
    for (const m of rows[y]!.matchAll(/(\d) (allow once|allow always|reject once|reject always)/g)) {
      if (cellOf(s, y, m.index!).isInverse()) out.push(m[0]);
    }
  }
  return out;
}
function previewFocused(s: PtySession): boolean {
  const rows = s.screenText();
  const top = cardTop(s);
  if (top < 0) return false;
  const y = rows.findIndex((r, i) => i > top && r.startsWith("╰"));
  const x = rows[y]!.search(/ \d+-\d+ of \d+ /);
  return x >= 0 && cellOf(s, y, x + 1).getFgColor() === ACCENT_FG;
}
/** The prompt box's frame is in the accent colour only while it has focus. */
function promptFocused(s: PtySession): boolean {
  const rows = s.screenText();
  for (let y = rows.length - 1; y >= 0; y--) if (rows[y]!.startsWith("╰")) return cellOf(s, y, 0).getFgColor() === ACCENT_FG;
  return false;
}
async function diffCard(run: ChromeRun): Promise<void> {
  await prompt(run);
  await run.s.waitFor(() => cardRows(run.s).length > 0, 5000);
  await run.s.flush();
}

describe("permission card focus stops (tasks 5.2 and 3.9)", () => {
  test("Nothing selected in the preview: a 60-line diff at 63x21 with an empty prompt box; focus on the preview, no option selected, Down scrolls", async () => {
    const run = start("permission-diff");
    await diffCard(run);
    await run.s.waitFor((p) => previewFocused(p), 3000);
    expect(selectedOptions(run.s)).toEqual([]);
    await Bun.sleep(400); // past the guard: still nothing selected
    run.s.sendKeys("Down");
    await run.s.waitFor(() => bottom(run.s).includes(" 2-3 of 53 "), 3000);
    expect(selectedOptions(run.s)).toEqual([]);
  }, 20000);

  test("Answer row takes focus: from the preview, Tab gives the answer row focus with its first option selected", async () => {
    const run = start("permission-diff");
    await diffCard(run);
    await run.s.waitFor((p) => previewFocused(p), 3000);
    run.s.sendKeys("Tab");
    await run.s.waitFor((p) => selectedOptions(p).length === 1, 3000);
    expect(selectedOptions(run.s)).toEqual(["1 allow once"]);
    expect(previewFocused(run.s)).toBe(false);
    // Tab again: on to the prompt box, nothing selected.
    run.s.sendKeys("Tab");
    await run.s.waitFor((p) => promptFocused(p), 3000);
    expect(selectedOptions(run.s)).toEqual([]);
  }, 20000);

  test("Cycle through a preview: from the conversation, Tab twice goes to the preview, then the answer row with its first option selected", async () => {
    const run = start("permission-diff");
    await diffCard(run);
    await run.s.waitFor((p) => previewFocused(p), 3000);
    // Esc to the prompt box (arming interrupt), Tab to the conversation.
    run.s.sendKeys("Esc");
    await run.s.waitFor((p) => promptFocused(p), 3000);
    run.s.sendKeys("Tab");
    await run.s.waitFor((p) => !promptFocused(p) && !previewFocused(p), 3000);
    run.s.sendKeys("Tab");
    await run.s.waitFor((p) => previewFocused(p), 3000);
    expect(selectedOptions(run.s)).toEqual([]);
    run.s.sendKeys("Tab");
    await run.s.waitFor((p) => selectedOptions(p).length === 1 && !previewFocused(p), 3000);
    expect(selectedOptions(run.s)).toEqual(["1 allow once"]);
    expect(responses(run, "session/request_permission/response")).toEqual([]);
  }, 20000);

  test("Arrows scroll, then select: Down twice in the preview, Tab, Right and Enter answer with the second option", async () => {
    const run = start("permission-diff");
    await diffCard(run);
    await Bun.sleep(400); // past the guard
    run.s.sendKeys("Down", "Down");
    await run.s.waitFor(() => bottom(run.s).includes(" 3-4 of 53 "), 3000);
    expect(selectedOptions(run.s)).toEqual([]);
    run.s.sendKeys("Tab", "Right", "Enter");
    await run.s.waitFor(() => responses(run, "session/request_permission/response").length === 1, 5000);
    expect(responses(run, "session/request_permission/response")).toEqual([{ outcome: { outcome: "selected", optionId: "allow-always" } }]);
  }, 20000);

  test("Enter in the preview: the request stays open and no option is selected", async () => {
    const run = start("permission-diff");
    await diffCard(run);
    await Bun.sleep(400); // past the guard
    run.s.sendKeys("Enter");
    await Bun.sleep(400);
    expect(responses(run, "session/request_permission/response")).toEqual([]);
    expect(cardRows(run.s).length).toBeGreaterThan(0);
    expect(selectedOptions(run.s)).toEqual([]);
    expect(previewFocused(run.s)).toBe(true);
  }, 20000);

  test("a digit from the preview selects that option and moves focus to the answer row; Enter then answers with it", async () => {
    const run = start("permission-diff");
    await diffCard(run);
    await Bun.sleep(400); // past the guard
    run.s.sendKeys("3");
    await run.s.waitFor((p) => selectedOptions(p).join() === "3 reject once" && !previewFocused(p), 3000);
    // In the answer row the stacked options move with Up and Down.
    run.s.sendKeys("Up");
    await run.s.waitFor((p) => selectedOptions(p).join() === "2 allow always", 3000);
    run.s.sendKeys("Down", "Enter");
    await run.s.waitFor(() => responses(run, "session/request_permission/response").length === 1, 5000);
    expect(responses(run, "session/request_permission/response")).toEqual([{ outcome: { outcome: "selected", optionId: "reject-once" } }]);
  }, 20000);

  test("a card whose preview fits has only the answer row: focus enters there with the first option selected", async () => {
    // `basic`'s edit request has no preview content until it completes, so its card fits.
    const run = start("basic");
    await prompt(run);
    await run.s.waitFor(() => cardRows(run.s).length > 0, 5000);
    await run.s.waitFor((p) => selectedOptions(p).length === 1, 3000);
    expect(selectedOptions(run.s)).toEqual(["1 allow once"]);
    expect(previewFocused(run.s)).toBe(false);
  }, 20000);
});

// day-one-feedback task group 13 (Marcus, 15 October 2026; spec tui-layout "Permission card",
// "Activity bar", "Spacing gives way before content"): in a tall pane the docked card keeps the
// cards' padding inside its frame and a blank row above and below it, and the activity bar keeps its
// blank row.
describe("padding and gaps in a tall pane (day-one-feedback 13)", () => {
  const blankFramed = (row: string | undefined) => row !== undefined && /^│ +│$/.test(row);

  test("Padding and gaps in a tall pane: basic's three-option request at 63x40; a padding row inside the frame at the top and the bottom, content two columns in, blank rows around the card and above the activity line", async () => {
    const run = start("basic", { rows: 40 });
    await prompt(run);
    await run.s.waitFor(() => cardRows(run.s).length > 0, 5000);
    await run.s.flush();
    const screen = run.s.screenText();
    const rows = cardRows(run.s);
    const top = cardTop(run.s);
    expect(blankFramed(rows[1])).toBe(true);
    expect(blankFramed(rows.at(-2))).toBe(true);
    expect(rows[2]).toStartWith("│  Edit src/index.ts");
    expect(rows[3]).toStartWith("│  1 allow once   2 allow always   3 reject once");
    expect(rows).toHaveLength(6);
    // Blank row, activity line, blank row, card, blank row, prompt box.
    expect(screen[top - 1]).toBe("");
    expect(screen[top - 2]).toContain("awaiting permission");
    expect(screen[top - 2]).toStartWith("  2 running");
    expect(screen[top - 3]?.trim()).toBe("");
    expect(screen[top + rows.length]).toBe("");
    expect(screen[top + rows.length + 1]).toStartWith("╭");
    // The prompt box keeps its padding row: frame, one text row, padding row.
    expect(promptBox(run.s)).toHaveLength(4);
  }, 20000);

  test("Tall pane keeps every gap: permission-diff at 63x40; every decorative row drawn, the preview takes the rows left and the conversation keeps 4", async () => {
    const run = start("permission-diff", { rows: 40 });
    await prompt(run);
    await run.s.waitFor(() => cardRows(run.s).length > 0, 5000);
    await run.s.flush();
    const screen = run.s.screenText();
    const rows = cardRows(run.s);
    const top = cardTop(run.s);
    expect(blankFramed(rows[1])).toBe(true);
    expect(blankFramed(rows.at(-2))).toBe(true);
    expect(screen[top - 1]).toBe("");
    expect(screen[top - 2]).toContain("awaiting permission");
    expect(screen[top - 3]?.trim()).toBe("");
    expect(screen[top + rows.length]).toBe("");
    expect(promptBox(run.s)).toHaveLength(4);
    // 40 rows: margins 2, spacer 1, status row 1, prompt box 4, the blank row below the card, the
    // activity line and its blank row, the blank row above the card, the conversation's 4 rows: the
    // card takes the 24 left, padding rows included, so 15 preview rows beside the title and options.
    expect(rows).toHaveLength(24);
    expect(bottom(run.s)).toContain(" 1-15 of 53 ");
    expect(top - 3 - TOP_MARGIN).toBe(4);
  }, 20000);

  test("Question card padded alike: the elicitation form at 63x40; a padding row inside the frame at the top and the bottom, content two columns in, and a blank row below the card", async () => {
    const run = start("elicitation", { rows: 40 });
    await prompt(run);
    await run.s.waitFor("Question 1 of 3", 5000);
    await run.s.flush();
    const screen = run.s.screenText();
    const top = screen.findIndex((r) => r.startsWith("╭─ ◊ Question 1 of 3"));
    const end = screen.findIndex((r, y) => y > top && r.startsWith("╰"));
    expect(top).toBeGreaterThan(0);
    expect(blankFramed(screen[top + 1])).toBe(true);
    expect(blankFramed(screen[end - 1])).toBe(true);
    const content = screen.slice(top + 2, end - 1).filter((r) => !blankFramed(r));
    expect(content.length).toBeGreaterThan(0);
    for (const row of content) expect(row).toMatch(/^│ {2}\S/);
    expect(screen[top - 1]).toBe("");
    expect(screen[end + 1]).toBe("");
    expect(screen[end + 2]).toStartWith("╭");
  }, 20000);
});
