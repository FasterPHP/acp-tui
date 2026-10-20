// The prompt box's frame and a wrapped draft (spec tui-layout "Prompt box";
// S7, PhpStorm reworked at 64x21 and 63x21). The textarea used to take its
// flex basis from its own measured content width, so a draft that wrapped
// made it wider than the space between the frame's sides: it drew over the
// right side (`│` missing on every text row) and wrapped at a width wider
// than the visible area, so the character at each wrap point fell off the
// row (`README.m`, `--oneline` then `3,`). The real CLI against fake-agent:
// a typed draft over two and five rows, Shift+Enter newlines and a word
// longer than a row, checking the frame on every text row and that the whole
// draft can be read back from the rows.
import { afterEach, describe, expect, test } from "bun:test";
import type { KeyName, PtySession } from "../pty/harness.ts";
import { promptBox, READY } from "../pty/regions.ts";
import { startCli } from "../keys/cli-pty.ts";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

const ROWS = 21;

/** Two rows at 60 and 59 inner columns. */
const TWO_ROWS = "Summarise README.md, make a short plan, run git log --oneline -3, then add a one-line comment to README.md";

/** Five rows at 60 and 59 inner columns. */
const FIVE_ROWS =
  "Read README.md and summarise it in two sentences. Keep a short three-step todo plan for this task. " +
  "Run the shell command git log --oneline -3. Then try a one-line comment edit to README.md with the Edit tool; " +
  "I will approve or reject it in the permission prompt, so wait for it.";

/** A word longer than a row, which has to be broken inside the word. */
const LONG_WORD = `Open packages/acp-tui/src/app/${"PromptBoxWithAVeryLongName".repeat(3)}.tsx and README.md`;

/**
 * Reads `draft` back from the prompt box's text rows: each row's text (trailing spaces dropped)
 * must follow on in the draft, with only white space (the space or newline at a wrap or line
 * break) between rows. Returns the draft text that was found, so a lost character shows in the
 * failure as a difference.
 */
function readBack(rows: readonly string[], draft: string): string {
  let at = 0;
  let found = "";
  for (const row of rows) {
    const text = row.trim();
    while (at < draft.length && /\s/.test(draft[at]!) && !draft.startsWith(text, at)) found += draft[at++];
    if (!draft.startsWith(text, at)) return `${found}[row ${JSON.stringify(text)} does not follow]`;
    found += text;
    at += text.length;
  }
  return found + draft.slice(at).replace(/\S[\s\S]*/, "[missing]");
}

/** The inner text of each text row of the prompt box: the columns between `│ ` and ` │`; the
 *  blank rows below the draft that the resting height adds (mvp-chrome-and-keys task 4.2) are
 *  left out. */
function textRows(s: PtySession): string[] {
  const rows = promptBox(s)
    .slice(1, -2)
    .map((row) => row.slice(2, s.cols - 2));
  while (rows.length > 1 && rows.at(-1)!.trim() === "") rows.pop();
  return rows;
}

/** The prompt box's resting height at 21 rows (mvp-chrome-and-keys task 4.2). */
const REST_ROWS = 2;

/** Checks the frame: rounded corners, and `│` in the first and last column of every text row. */
function expectFrame(s: PtySession, textRowCount: number): void {
  const box = promptBox(s);
  const cols = s.cols;
  // The two borders, the text rows and the padding row below them.
  expect(box.length).toBe(textRowCount + 3);
  expect(box[0]).toBe(`╭${"─".repeat(cols - 2)}╮`);
  expect(box.at(-1)!.startsWith("╰")).toBe(true);
  expect(box.at(-1)!.endsWith("╯")).toBe(true);
  expect(box.at(-1)!.length).toBe(cols);
  // Every text row: `│ `, the text, ` │`; the right side is in the last column.
  for (const row of box.slice(1, -1)) {
    expect({ row, left: row.slice(0, 2), right: row.slice(cols - 2), length: row.length }).toEqual({
      row,
      left: "│ ",
      right: " │",
      length: cols,
    });
  }
}

async function typeDraft(cols: number, keys: (KeyName | { text: string })[], tail: string): Promise<PtySession> {
  const run = startCli("basic", 0, { cols, rows: ROWS });
  session = run.s;
  await run.s.waitFor(READY, 10000);
  run.s.sendKeys(...keys);
  // The draft's last word on the last text row, then a moment for the frame to settle.
  await run.s.waitFor((s) => (textRows(s).at(-1) ?? "").trimEnd().endsWith(tail), 5000);
  await Bun.sleep(150);
  await run.s.flush();
  return run.s;
}

describe.each([64, 63])("prompt box with a wrapped draft at %ix21", (cols) => {
  test("a draft over two rows: the frame on both rows, no character lost at the wrap", async () => {
    const s = await typeDraft(cols, [{ text: TWO_ROWS }], "README.md");
    expect(readBack(textRows(s), TWO_ROWS)).toBe(TWO_ROWS);
    // Two rows of draft in the three-row resting box.
    expect(textRows(s)).toHaveLength(2);
    expectFrame(s, REST_ROWS);
  }, 20000);

  test("a draft over five rows: the frame on every row, no character lost at the wraps", async () => {
    const s = await typeDraft(cols, [{ text: FIVE_ROWS }], "wait for it.");
    expect(readBack(textRows(s), FIVE_ROWS)).toBe(FIVE_ROWS);
    expectFrame(s, 5);
  }, 20000);

  test("Shift+Enter newlines with a wrapped line between them", async () => {
    const lines = ["First line.", TWO_ROWS, "", "Last line."];
    const keys: (KeyName | { text: string })[] = [];
    lines.forEach((line, i) => {
      if (i > 0) keys.push("Shift+Enter");
      if (line !== "") keys.push({ text: line });
    });
    const s = await typeDraft(cols, keys, "Last line.");
    const draft = lines.join("\n");
    const rows = textRows(s);
    expect(readBack(rows, draft)).toBe(draft);
    // One row, two wrapped rows, the empty line, one row.
    expect(rows.map((r) => r.trimEnd())[3]).toBe("");
    expectFrame(s, 5);
  }, 20000);

  test("a word longer than a row is broken inside the word, every character kept", async () => {
    const s = await typeDraft(cols, [{ text: LONG_WORD }], "README.md");
    const rows = textRows(s);
    expect(readBack(rows, LONG_WORD)).toBe(LONG_WORD);
    // The long word fills a whole row: its first row is full to the inner width.
    expect(rows.some((r) => r.length === cols - 4 && !r.includes(" "))).toBe(true);
    expectFrame(s, Math.max(REST_ROWS, rows.length));
  }, 20000);
});
