// Code blocks in the real CLI (mvp-rendering tasks 3.7, 8.3, 8.4 and 10.5): the PTY harness
// against fake-agent at 63 columns.
//
// - tui-theme "Code block on its surface": the paragraph's cells on the default background, the
//   code block's on `surface.code` across the content width, with the label `php`.
// - task 8.3: no code cell is drawn with an RGB foreground once highlighting has landed.
// - tui-rendering "Flat theme": with no OSC 10 and 11 answers, the muted left rule and the label,
//   and no fill.
// - task 10.5: `hostile`'s fenced imitation of the permission card stays a code block on
//   `surface.code`, with no warm fill, no warning frame and no marker in the card's colour, while
//   the real card arrives in the docked region.
import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_GLYPHS } from "../../src/conversation/glyphs.ts";
import { deriveSurfaces } from "../../src/theme/index.ts";
import { startCli, type CliRun } from "../keys/cli-pty.ts";
import type { OscColours, PtySession } from "../pty/harness.ts";
import { CARD_HEADER, cardRows, READY, withoutBar } from "../pty/regions.ts";

let run: CliRun | undefined;
afterEach(async () => {
  run?.s.kill("SIGTERM");
  await run?.s.dispose();
  run = undefined;
});

const COLS = 63;
/** The conversation's columns: the pane less its two-column right margin and the scroll bar. */
const TEXT = COLS - 3;
const DARK = { foreground: "#bcbec4", background: "#191a1c" } satisfies OscColours;
const SURFACES = deriveSurfaces(DARK);
const CODE_BG = SURFACES["surface.code"].toLowerCase();
const PERMISSION_FG = 3; // the `permission` token: ANSI yellow
const KEYWORD_FG = 5; // `code.keyword`: ANSI magenta
const RULE = DEFAULT_GLYPHS.markdown.codeRule;

function bgHex(s: PtySession, y: number, x: number): string {
  const cell = s.cell(s.term.buffer.active.baseY + y, x)!;
  if (cell.isBgDefault()) return "default";
  return `#${cell.getBgColor().toString(16).padStart(6, "0")}`;
}

const cellAt = (s: PtySession, y: number, x: number) => s.cell(s.term.buffer.active.baseY + y, x)!;

/** Screen rows from `from` on while their content column (2) is on `surface.code`. */
function codeRowsFrom(s: PtySession, from: number): number[] {
  const out: number[] = [];
  for (let y = from; y < s.term.rows && bgHex(s, y, 2) === CODE_BG; y++) out.push(y);
  return out;
}

describe("code blocks on their surface (tasks 3.7, 8.3, 8.4)", () => {
  test("Code block on its surface: the paragraph on the default background, the code on surface.code across the content width with its label, and no RGB foreground once highlighted", async () => {
    run = startCli("fence-first", 0, { cols: COLS, rows: 21, colours: DARK, env: { COLORTERM: "truecolor" } });
    const s = run.s;
    await s.waitFor(READY, 10000);
    s.sendKeys({ text: "go" }, "Enter");
    await s.waitFor((p) => p.screenText().some((l) => l.includes("$receipt = new Receipt(1999);")) && READY.test(p.screenText().join("\n")), 10000);
    // Highlighting lands after the text: wait until `new` is drawn in code.keyword.
    const newCell = () => {
      const y = s.screenText().findIndex((l) => l.includes("$receipt = new"));
      return { y, x: s.screenText()[y]!.indexOf("new") };
    };
    await s.waitFor(() => {
      const { y, x } = newCell();
      const cell = cellAt(s, y, x);
      return cell.isFgPalette() && cell.getFgColor() === KEYWORD_FG;
    }, 10000);
    await s.flush();
    const screen = s.screenText();

    // The paragraph between the two fences: every cell on the default background.
    const para = screen.findIndex((l) => l.includes("And the same idea without the opening tag:"));
    expect(para).toBeGreaterThan(0);
    for (let x = 0; x < COLS - 1; x++) expect(bgHex(s, para, x)).toBe("default");

    // The second block: its rows on surface.code from the content's first column to the edge,
    // the gutter on the default background; the cards' padding (day-one-feedback task group 13):
    // a padding row above and below, the code two columns in, and the label `php` on the top
    // padding row, two columns before the edge.
    const first = screen.findIndex((l) => l.includes("$receipt = new Receipt(1999);"));
    const rows = codeRowsFrom(s, first - 1);
    expect(rows).toEqual([first - 1, first, first + 1, first + 2]);
    expect(screen[first]!.trimEnd()).toBe("    $receipt = new Receipt(1999);");
    expect(screen[first - 1]!.trimEnd()).toMatch(/^ +php$/);
    expect(screen[first - 1]!.trimEnd().length).toBe(TEXT - 2); // the label ends before the right padding
    expect(screen[first + 1]!.trim()).toBe("echo $receipt->format() . PHP_EOL;");
    expect(screen[first + 2]!.trim()).toBe("");
    for (const y of rows) {
      for (let x = 0; x < 2; x++) expect(bgHex(s, y, x)).toBe("default");
      for (let x = 2; x < TEXT; x++) expect(bgHex(s, y, x), `row ${y} column ${x}`).toBe(CODE_BG);
      // The right margin is never filled.
      for (let x = TEXT; x < COLS - 1; x++) expect(bgHex(s, y, x)).toBe("default");
    }
    // The blank row after the block (before the end of the message) is the terminal's own.
    expect(bgHex(s, rows[rows.length - 1]! + 1, 2)).toBe("default");

    // Task 8.3: every code cell on screen (both blocks) has a palette or default foreground, never RGB.
    const codeCells: string[] = [];
    for (let y = 0; y < s.term.rows; y++) {
      if (bgHex(s, y, 2) !== CODE_BG) continue;
      for (let x = 2; x < TEXT; x++) {
        const cell = cellAt(s, y, x);
        if (cell.isFgRGB()) codeCells.push(`(${x}, ${y}) "${cell.getChars()}"`);
      }
    }
    expect(codeCells).toEqual([]);
    // The label is muted (bright black), the code's variable in the default colour.
    const label = screen[first - 1]!.lastIndexOf("php");
    expect(cellAt(s, first - 1, label).getFgColor()).toBe(8);
    expect(cellAt(s, first, screen[first]!.indexOf("receipt")).isFgDefault()).toBe(true);
  }, 30000);

  test("Flat theme: with no colour replies the block has the muted left rule and its label, and no fill", async () => {
    run = startCli("fence-first", 0, { cols: COLS, rows: 21 });
    const s = run.s;
    await s.waitFor(READY, 10000);
    s.sendKeys({ text: "go" }, "Enter");
    await s.waitFor((p) => p.screenText().some((l) => l.includes("$receipt = new Receipt(1999);")) && READY.test(p.screenText().join("\n")), 10000);
    await s.flush();
    const screen = withoutBar(s.screenText());
    const first = screen.findIndex((l) => l.includes("$receipt = new Receipt(1999);"));
    // The rule in the first padding column of every row, the padding rows too, the label on the
    // top padding row.
    expect(screen[first]!.startsWith(`  ${RULE} $receipt = new Receipt(1999);`)).toBe(true);
    expect(screen[first - 1]!.startsWith(`  ${RULE}`)).toBe(true);
    expect(screen[first - 1]!.trimEnd().endsWith(" php")).toBe(true);
    expect(screen[first + 1]!.startsWith(`  ${RULE} echo $receipt`)).toBe(true);
    expect(screen[first + 2]!.trimEnd()).toBe(`  ${RULE}`);
    expect(cellAt(s, first, 2).getFgColor()).toBe(8);
    for (const y of [first - 1, first, first + 1, first + 2]) for (let x = 0; x < COLS; x++) expect(cellAt(s, y, x).isBgRGB()).toBe(false);
  }, 30000);
});

describe("hostile's fenced card imitation (task 10.5)", () => {
  test("the code block stays on surface.code: no warm fill, no warning frame, no marker in the card's colour; the real card arrives docked", async () => {
    // Delay scale 20: hostile pauses 2 s between its message and the real request. 66 columns:
    // the imitation's 54-column lines fit the code block's room inside its padding unbroken.
    const cols = 66;
    run = startCli("hostile", 20, { cols, rows: 40, colours: DARK, env: { COLORTERM: "truecolor" } });
    const s = run.s;
    await s.waitFor(READY, 10000);
    s.sendKeys({ text: "go" }, "Enter");
    const imitation = () => {
      const screen = s.screenText();
      const intro = screen.findIndex((l) => l.includes("The same card in a code block:"));
      if (intro < 0) return null;
      const top = screen.findIndex((l, y) => y > intro && l.includes("◊ Permission"));
      if (top < 0) return null;
      // The block's rows from the imitation's top border, its bottom padding row left out.
      const rows = codeRowsFrom(s, top).filter((y) => s.screenText()[y]!.trim() !== "");
      return rows.length >= 4 ? rows : null;
    };
    await s.waitFor(() => imitation() !== null, 8000);
    await s.flush();

    const permission = [SURFACES["surface.permission"], SURFACES["surface.permission.selected"]].map((h) => h.toLowerCase());
    const check = () => {
      const rows = imitation()!;
      const screen = s.screenText();
      // The card's four rows, inside the code block behind the gutter and the two padding columns.
      expect(rows.map((y) => screen[y]!.slice(4, 6))).toEqual(["╭─", "│ ", "│ ", "╰─"]);
      for (const y of rows) {
        expect(screen[y]!.startsWith("    ")).toBe(true);
        // Up to the scroll bar, the region's last column.
        for (let x = 0; x < cols - 1; x++) {
          const bg = bgHex(s, y, x);
          expect(permission).not.toContain(bg);
          expect(bg === "default" || bg === CODE_BG, `row ${y} column ${x}: ${bg}`).toBe(true);
          // No frame or marker cell in the permission colour: the imitation is code, in code.default.
          const cell = cellAt(s, y, x);
          if (x >= 3 && cell.getChars().trim() !== "") {
            expect(cell.isFgPalette() && cell.getFgColor() === PERMISSION_FG, `row ${y} column ${x} "${cell.getChars()}"`).toBe(false);
          }
        }
      }
      const marker = screen[rows[0]!]!.indexOf("◊");
      expect(cellAt(s, rows[0]!, marker).isFgDefault()).toBe(true);
      return rows;
    };
    const rows = check();
    // No request yet: nothing docked.
    expect(cardRows(s)).toEqual([]);

    // The real request arrives in the docked region below the conversation, on the permission fill.
    await s.waitFor(() => cardRows(s).length > 0, 8000);
    await s.flush();
    const screen = s.screenText();
    const cardTop = screen.findIndex((r) => r.startsWith(`╭─ ${CARD_HEADER}`));
    expect(cardTop).toBeGreaterThan(rows[rows.length - 1]!);
    for (let x = 0; x < cols; x++) expect(permission).toContain(bgHex(s, cardTop + 1, x));
    expect(cellAt(s, cardTop, 0).getFgColor()).toBe(PERMISSION_FG);
    // The imitation is unchanged.
    if (imitation()) check();
  }, 30000);
});
