// day-one-feedback task 5 through the real CLI (spec tui-rendering "Card padding", tui-config "Card
// padding setting"): the same inset and the padding rows of a user message, an expanded thought and
// an expanded tool card at 90 columns, the right edge kept, the padding from the setting, a reload
// that widens the sides, and a drag across a user card copying exactly its text. The test's own
// configuration file sets the density, so it holds under either default.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OscColours, PtySession } from "../pty/harness.ts";
import { withoutBar } from "../pty/regions.ts";
import { localEnv, osc52Payloads } from "../selection/pty.ts";
import { sendPrompt, settle, startCli, type CliRun } from "./cli.ts";
import { WINDOWS } from "../windows.ts";

let run: CliRun | undefined;
afterEach(async () => {
  run?.session.kill("SIGTERM");
  await run?.session.dispose();
  run = undefined;
});

const DARK = { foreground: "#bcbec4", background: "#191a1c" } satisfies OscColours;

function configHome(config: unknown) {
  const home = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-padding-")));
  const dir = join(home, "acp-tui");
  mkdirSync(dir);
  const file = join(dir, "config.jsonc");
  writeFileSync(file, JSON.stringify(config));
  // Saved as an editor does: a temporary file renamed over the file.
  const write = (value: unknown) => {
    const tmp = join(dir, `.config.jsonc.${Date.now()}.tmp`);
    writeFileSync(tmp, JSON.stringify(value));
    renameSync(tmp, file);
  };
  return { home, write };
}

/** `short-answer` under `verbose` (a read with a fenced file, a thought, an `execute`), with the
 *  dark colours answered so the cards have their fills. */
async function shortAnswer(config: unknown, opts: { cols?: number; rows?: number } = {}) {
  const cfg = configHome({ density: "verbose", ...(config as object) });
  run = startCli({
    scenario: "short-answer",
    cols: opts.cols ?? 90,
    rows: opts.rows ?? 50,
    colours: DARK,
    env: localEnv({ XDG_CONFIG_HOME: cfg.home }),
  });
  const s = run.session;
  await sendPrompt(s, "go");
  await s.waitFor(/end turn/, 20000);
  await settle(s);
  return { s, cfg };
}

const rowsOf = (s: PtySession) => withoutBar(s.screenText());
/** The column of the first character of `text` on the row that holds it. */
function columnOf(s: PtySession, text: string): { y: number; x: number } {
  const rows = rowsOf(s);
  const y = rows.findIndex((r) => r.includes(text));
  if (y < 0) throw new Error(`${JSON.stringify(text)} is not on screen\n${rows.join("\n")}`);
  return { y, x: rows[y]!.indexOf(text) };
}
const bg = (s: PtySession, y: number, x: number) => {
  const cell = s.cell(y, x)!;
  return `${cell.getBgColorMode()}:${cell.getBgColor()}`;
};

describe("card padding on the screen (tasks 5.2 and 5.4)", () => {
  // Skipped on Windows: it needs the terminal's OSC 10/11 colour replies (derived surfaces, light theme), which ConPTY never passes on (it passes only OSC 4).
  test.skipIf(WINDOWS)("Same left inset everywhere: user text two columns after its bar, thought and tool card text two after the gutter, a blank fill row above and below each", async () => {
    const { s } = await shortAnswer({});
    const rows = rowsOf(s);

    // The user card: the bar is column 0, the text starts in column 3 (two columns of padding, the
    // default since 15 October 2026), between two padding rows.
    const user = columnOf(s, "go");
    expect(user.x).toBe(3);
    expect(rows[user.y - 1]!.trim()).toBe("");
    expect(rows[user.y + 1]!.trim()).toBe("");
    // The padding rows carry the card's fill (the text row's), and the bar runs beside them.
    const userBg = bg(s, user.y, 10);
    expect(bg(s, user.y - 1, 10)).toBe(userBg);
    expect(bg(s, user.y + 1, 10)).toBe(userBg);
    expect(bg(s, user.y - 1, 0)).toBe(bg(s, user.y, 0));
    expect(bg(s, user.y + 1, 0)).toBe(bg(s, user.y, 0));

    // The expanded thought: its card text starts after the gutter (2) and two columns of padding.
    const thought = columnOf(s, "The README describes acp-tui");
    expect(thought.x).toBe(4);
    expect(rows[thought.y - 1]!.trim()).toBe("");
    const thoughtBg = bg(s, thought.y, 10);
    expect(bg(s, thought.y - 1, 10)).toBe(thoughtBg);
    expect(thoughtBg).not.toBe(userBg);

    // The expanded read card: the fenced file's first line starts in the same column, with no pad
    // of the code block's own.
    const code = columnOf(s, "# acp-tui");
    expect(code.x).toBe(4);
    expect(rows[code.y - 1]!.trim()).toBe("");
    expect(bg(s, code.y - 1, 10)).toBe(bg(s, code.y, 10));
  }, 60000);

  test("Right edge kept: a long user message wraps two columns short of the card's last column", async () => {
    const cfg = configHome({ density: "verbose" });
    run = startCli({ scenario: "short-answer", cols: 66, rows: 50, colours: DARK, env: localEnv({ XDG_CONFIG_HOME: cfg.home }) });
    const s = run.session;
    const long = "word ".repeat(60).trim();
    await sendPrompt(s, long);
    await s.waitFor(/end turn/, 20000);
    await settle(s);
    const rows = rowsOf(s).filter((r) => /^ {3}(word )*word\s*$/.test(r));
    expect(rows.length).toBeGreaterThan(3);
    // The conversation is 63 columns: the bar, two columns of padding, 58 columns of text and two
    // columns of padding on the right.
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(61);
    expect(Math.max(...rows.map((r) => r.length))).toBeGreaterThan(55);
  }, 60000);

  // Skipped on Windows: it needs the terminal's OSC 10/11 colour replies (derived surfaces, light theme), which ConPTY never passes on (it passes only OSC 4).
  test.skipIf(WINDOWS)("Padding from the setting: no padding rows and three columns", async () => {
    const { s } = await shortAnswer({ cards: { padding: { rows: 0, columns: 3 } } });
    const rows = rowsOf(s);
    const user = columnOf(s, "go");
    expect(user.x).toBe(4);
    // No padding row above the text: it is the conversation's first row, below the top margin.
    expect(user.y).toBe(1);
    expect(rows[user.y + 1]!.trim()).toBe("");
    const thought = columnOf(s, "The README describes acp-tui");
    expect(thought.x).toBe(5);
    const code = columnOf(s, "# acp-tui");
    expect(code.x).toBe(5);
    // No padding row: the row above the file's first line is the card's header.
    expect(rows[code.y - 1]!).toMatch(/read/);
  }, 60000);

  // Skipped on Windows: it needs the terminal's OSC 10/11 colour replies (derived surfaces, light theme), which ConPTY never passes on (it passes only OSC 4).
  test.skipIf(WINDOWS)("Wider sides on reload: the card's text moves one column and the conversation keeps its top entry", async () => {
    const { s, cfg } = await shortAnswer({});
    const top = rowsOf(s).slice(1, 4);
    expect(columnOf(s, "# acp-tui").x).toBe(4);
    cfg.write({ density: "verbose", cards: { padding: { columns: 3 } } });
    await s.waitFor(() => run!.events("config_reload").length >= 1, 3000);
    await settle(s);
    expect(columnOf(s, "# acp-tui").x).toBe(5);
    expect(columnOf(s, "go").x).toBe(4);
    // The top entry is the same user message (its text moved with the padding).
    expect(rowsOf(s).slice(1, 4).map((r) => r.trim())).toEqual(top.map((r) => r.trim()));
  }, 60000);
});

// Skipped on Windows: it needs the terminal's OSC 10/11 colour replies (derived surfaces, light theme), which ConPTY never passes on (it passes only OSC 4).
describe.skipIf(WINDOWS)("the cursor beside a user card's padding rows (task 5.4)", () => {
  test("a selected user card: its bar and the cursor column run down the padding rows too, over the faint fill", async () => {
    const { s } = await shortAnswer({});
    s.sendKeys("Tab");
    await settle(s, 60);
    s.sendKeys("Home");
    await settle(s, 60);
    const user = columnOf(s, "go");
    const above = user.y - 1;
    const below = user.y + 1;
    // The bar (column 0) and the cell beside it (column 1) have one colour from the top padding
    // row to the bottom one; the beside cell is the cursor's colour, the card the faint fill.
    for (const x of [0, 1]) {
      expect(bg(s, above, x)).toBe(bg(s, user.y, x));
      expect(bg(s, below, x)).toBe(bg(s, user.y, x));
    }
    expect(bg(s, user.y, 1)).not.toBe(bg(s, user.y, 0));
    expect(bg(s, above, 10)).toBe(bg(s, user.y, 10));
    expect(bg(s, below, 10)).toBe(bg(s, user.y, 10));
    expect(rowsOf(s)[above]!.trim()).toBe("");
  }, 60000);
});

describe("padding rows are never copied (task 5.4)", () => {
  test("a drag from the padding row above a user message to the one below copies exactly its text", async () => {
    const { s } = await shortAnswer({});
    const user = columnOf(s, "go");
    s.mousePress(5, user.y - 1);
    s.mouseMove(8, user.y, "left");
    s.mouseMove(8, user.y + 1, "left");
    s.mouseRelease(8, user.y + 1);
    await s.waitFor((p) => osc52Payloads(p.rawOutput()).length > 0, 5000);
    expect(osc52Payloads(s.rawOutput()).at(-1)).toBe("go");
  }, 60000);
});
