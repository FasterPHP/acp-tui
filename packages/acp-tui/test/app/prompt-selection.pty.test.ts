// Selection in the prompt box under the real CLI (day-two-feedback task group 8; specs tui-keymap
// "Prompt box selection keys" and "Ctrl+C precedence", tui-selection "Selection in the prompt
// box"): the selecting keys, the cut, the drag, how the selection is drawn (a fill with the
// terminal's colours known, inverse video under the flat theme), Ctrl+C, Esc, and one selection at
// a time. Copies are read back from the OSC 52 the child writes (no display variables), so the
// user's clipboard is never touched (../selection/pty.ts).
import { afterEach, describe, expect, test } from "bun:test";
import type { PtySession, OscColours } from "../pty/harness.ts";
import { configEnv } from "../pty/config-home.ts";
import { promptText, READY, RUNNING } from "../pty/regions.ts";
import { sendPrompt, startCli, type CliRun } from "../conversation/cli.ts";
import { deriveSurfaces } from "../../src/theme/index.ts";
import { localEnv, osc52Payloads } from "../selection/pty.ts";
import { WINDOWS } from "../windows.ts";

let run: CliRun | undefined;
afterEach(async () => {
  run?.session.kill("SIGKILL");
  await run?.session.dispose();
  run = undefined;
});

const SHIFT_LEFT = "\x1b[1;2D";
const SHIFT_HOME = "\x1b[1;2H";
const SHIFT_END = "\x1b[1;2F";
const CTRL_SHIFT_LEFT = "\x1b[1;6D";
const CTRL_SHIFT_RIGHT = "\x1b[1;6C";
const ALT_SHIFT_LEFT = "\x1b[1;4D";
const HOME = "\x1b[H";
const END = "\x1b[F";
const CTRL_X = "\x18";
const CTRL_A = "\x01";
const CTRL_C = "\x03";
const COLOURS = { foreground: "#bcbec4", background: "#191a1c" } satisfies OscColours;

function start(opts: { scenario?: string; delayScale?: number; config?: object; colours?: OscColours; cols?: number; rows?: number } = {}): CliRun {
  run = startCli({
    scenario: opts.scenario ?? "basic",
    ...(opts.delayScale !== undefined ? { delayScale: opts.delayScale } : {}),
    cols: opts.cols ?? 100,
    rows: opts.rows ?? 30,
    env: { ...configEnv({ density: "compact", ...(opts.config ?? {}) }), ...localEnv() },
    ...(opts.colours ? { colours: opts.colours } : {}),
  });
  return run;
}

async function typed(s: PtySession, text: string): Promise<void> {
  await s.waitFor(READY, 10000);
  s.sendKeys({ text });
  await s.waitFor((p) => promptText(p)[0] === text, 5000);
}

/** The screen row and first column of the prompt box's `text` (its first row). */
function where(s: PtySession, text: string): { y: number; x: number } {
  const y = s.screenText().findIndex((l) => l.startsWith("│ ") && l.includes(text));
  if (y < 0) throw new Error(`no prompt row with ${JSON.stringify(text)}\n${s.screenText().join("\n")}`);
  return { y, x: s.screenText()[y]!.indexOf(text) };
}

function cell(s: PtySession, x: number, y: number): { bg: string | null; inverse: boolean } {
  const c = s.cell(s.term.buffer.active.viewportY + y, x)!;
  return { bg: c.isBgRGB() ? `#${c.getBgColor().toString(16).padStart(6, "0")}` : null, inverse: c.isInverse() !== 0 };
}

const payloads = (s: PtySession) => osc52Payloads(s.rawOutput());

describe("Prompt box selection keys (task 8.2)", () => {
  test("Select and delete: Shift+Left five times, then Backspace, leaves the text before it and copies nothing", async () => {
    const s = start().session;
    await typed(s, "hello world");
    s.sendKeys({ text: SHIFT_LEFT.repeat(5) });
    await Bun.sleep(200);
    s.sendKeys("Backspace");
    await s.waitFor((p) => promptText(p)[0] === "hello", 5000);
    expect(payloads(s)).toEqual([]);
  }, 30000);

  // Skipped on Windows: it needs the terminal's OSC 10/11 colour replies (derived surfaces, light theme), which ConPTY never passes on (it passes only OSC 4).
  test.skipIf(WINDOWS)("Select to the line start: Shift+Home selects the draft and it is drawn as selected", async () => {
    const s = start({ colours: COLOURS }).session;
    await typed(s, "fix the router");
    s.sendKeys({ text: SHIFT_HOME });
    const { y, x } = where(s, "fix the router");
    const fill = deriveSurfaces(COLOURS)["surface.selection"].toLowerCase();
    await s.waitFor(() => cell(s, x, y).bg === fill, 5000);
    expect(cell(s, x + 13, y).bg).toBe(fill);
    s.sendKeys("Backspace");
    await s.waitFor((p) => promptText(p).every((r) => r === ""), 5000);
  }, 30000);

  test("Shift+End from the start selects to the end, and Ctrl+Shift+Left and Right, and Alt+Shift+Left, select by word", async () => {
    const s = start().session;
    await typed(s, "one two three");
    // Ctrl+Shift+Left twice selects `two three`; Backspace leaves `one `.
    s.sendKeys({ text: CTRL_SHIFT_LEFT.repeat(2) });
    await Bun.sleep(200);
    s.sendKeys("Backspace");
    await s.waitFor((p) => promptText(p)[0] === "one", 5000);
    s.sendKeys({ text: "two three" });
    await s.waitFor((p) => promptText(p)[0] === "one two three", 5000);
    // Alt+Shift+Left selects one word too.
    s.sendKeys({ text: ALT_SHIFT_LEFT });
    await Bun.sleep(200);
    s.sendKeys("Backspace");
    await s.waitFor((p) => promptText(p)[0] === "one two", 5000);
    // Home, then Ctrl+Shift+Right selects forward by a word (where OpenTUI's word move lands),
    // and Backspace removes that start of the draft.
    s.sendKeys({ text: HOME });
    s.sendKeys({ text: CTRL_SHIFT_RIGHT });
    await Bun.sleep(200);
    s.sendKeys("Backspace");
    await s.waitFor((p) => (promptText(p)[0] ?? "") !== "one two" && "one two".endsWith(promptText(p)[0] ?? "x"), 5000);
    // Shift+End from the start selects the rest.
    s.sendKeys({ text: HOME });
    s.sendKeys({ text: SHIFT_END });
    await Bun.sleep(200);
    s.sendKeys("Backspace");
    await s.waitFor((p) => promptText(p).every((r) => r === ""), 5000);
  }, 30000);

  test("Home and End with a selection clear it and move in one press (task 12.2)", async () => {
    const s = start().session;
    await typed(s, "hello world");
    s.sendKeys({ text: SHIFT_LEFT.repeat(5) });
    await Bun.sleep(200);
    s.sendKeys({ text: HOME });
    await Bun.sleep(200);
    s.sendKeys({ text: "_" });
    await s.waitFor((p) => promptText(p)[0] === "_hello world", 5000);
    // The same from a selection made towards the start: End goes to the end, not to the selection's.
    s.sendKeys({ text: SHIFT_LEFT.repeat(3) });
    await Bun.sleep(200);
    s.sendKeys({ text: END });
    await Bun.sleep(200);
    s.sendKeys({ text: "!" });
    await s.waitFor((p) => promptText(p)[0] === "_hello world!", 5000);
  }, 30000);

  test("Typing replaces: `world` selected in `hello world`, typing `there` leaves `hello there`", async () => {
    const s = start().session;
    await typed(s, "hello world");
    s.sendKeys({ text: SHIFT_LEFT.repeat(5) });
    await Bun.sleep(200);
    s.sendKeys({ text: "there" });
    await s.waitFor((p) => promptText(p)[0] === "hello there", 5000);
  }, 30000);

  test("Cut: `world` goes to the clipboard with the copy toast and the prompt box holds `hello `", async () => {
    const s = start().session;
    await typed(s, "hello world");
    s.sendKeys({ text: SHIFT_LEFT.repeat(5) });
    await Bun.sleep(200);
    s.sendKeys({ text: CTRL_X });
    await s.waitFor(() => payloads(s).length === 1, 5000);
    expect(payloads(s)).toEqual(["world"]);
    await s.waitFor((p) => promptText(p)[0] === "hello", 5000);
    await s.waitFor((p) => p.screenText().some((l) => l.includes("sent 5 chars to the terminal")), 5000);
    // The space is still there: type to see it.
    s.sendKeys({ text: "x" });
    await s.waitFor((p) => promptText(p)[0] === "hello x", 5000);
  }, 30000);

  test("Cut with nothing selected: the draft is unchanged and nothing is written", async () => {
    const s = start().session;
    await typed(s, "hello");
    s.sendKeys({ text: CTRL_X });
    await Bun.sleep(400);
    expect(promptText(s)[0]).toBe("hello");
    expect(payloads(s)).toEqual([]);
  }, 30000);
});

describe("Select all in the prompt box (day-two-feedback task 13.3)", () => {
  test("Ctrl+A then Ctrl+X: all the text, on two lines, is written to the clipboard and the box is empty", async () => {
    const s = start().session;
    await typed(s, "hello");
    s.sendKeys({ text: "\x1b\r" }); // Alt+Enter: a newline
    s.sendKeys({ text: "world" });
    await s.waitFor((p) => promptText(p).join("|") === "hello|world", 5000);
    s.sendKeys({ text: CTRL_A });
    await Bun.sleep(200);
    s.sendKeys({ text: CTRL_X });
    await s.waitFor(() => payloads(s).length === 1, 5000);
    expect(payloads(s)).toEqual(["hello\nworld"]);
    await s.waitFor((p) => promptText(p).join("") === "", 5000);
  }, 30000);

  test("Ctrl+A then typing replaces all the text", async () => {
    const s = start().session;
    await typed(s, "hello world");
    s.sendKeys({ text: CTRL_A });
    await Bun.sleep(200);
    s.sendKeys({ text: "x" });
    await s.waitFor((p) => promptText(p)[0] === "x", 5000);
    expect(payloads(s)).toEqual([]);
  }, 30000);

  test("Ctrl+A is not the line start: Home still is, and Ctrl+A leaves no cursor at the line start", async () => {
    const s = start().session;
    await typed(s, "hello world");
    s.sendKeys({ text: HOME });
    await Bun.sleep(100);
    s.sendKeys({ text: "_" });
    await s.waitFor((p) => promptText(p)[0] === "_hello world", 5000);
    s.sendKeys({ text: CTRL_A });
    await Bun.sleep(200);
    s.sendKeys("Backspace");
    await s.waitFor((p) => promptText(p).join("") === "", 5000);
  }, 30000);

  test("Select all from the palette: the prompt box has focus with all its text selected, and typing replaces it", async () => {
    const s = start().session;
    await typed(s, "hello world");
    s.sendKeys("Ctrl+P");
    await s.waitFor((p) => p.screenText().some((l) => l.includes("↑↓ select")), 5000);
    s.sendKeys({ text: "Select all" });
    await s.waitFor((p) => p.screenText().some((l) => l.includes("Select all") && !l.includes("›  Select all") && l.startsWith("│")), 5000);
    s.sendKeys("Enter");
    await Bun.sleep(300);
    s.sendKeys({ text: "y" });
    await s.waitFor((p) => promptText(p)[0] === "y", 5000);
  }, 30000);

  // Skipped on Windows: it needs the terminal's OSC 10/11 colour replies (derived surfaces, light theme), which ConPTY never passes on (it passes only OSC 4).
  test.skipIf(WINDOWS)("Ctrl+A draws the selection, and with the conversation focused it does nothing", async () => {
    const s = start({ colours: COLOURS }).session;
    await typed(s, "hello world");
    const { y, x } = where(s, "hello world");
    s.sendKeys({ text: CTRL_A });
    const fill = deriveSurfaces(COLOURS)["surface.selection"].toLowerCase();
    await s.waitFor(() => cell(s, x, y).bg === fill, 5000);
    for (let i = 0; i < 11; i++) expect(cell(s, x + i, y).bg).toBe(fill);
    s.sendKeys("Esc");
    await s.waitFor(() => cell(s, x, y).bg === null, 5000);
    // Focus the conversation (Tab) and press Ctrl+A: nothing is selected in the prompt box.
    s.sendKeys("Tab");
    await Bun.sleep(200);
    s.sendKeys({ text: CTRL_A });
    await Bun.sleep(300);
    expect(cell(s, x, y).bg).toBeNull();
    expect(promptText(s)[0]).toBe("hello world");
  }, 30000);
});

describe("Selection in the prompt box (tasks 8.1, 8.3 and 8.4)", () => {
  // Skipped on Windows: it needs the terminal's OSC 10/11 colour replies (derived surfaces, light theme), which ConPTY never passes on (it passes only OSC 4).
  test.skipIf(WINDOWS)("Selection is visible: the five cells of `world` have the surface.selection background and the rest of the draft the prompt box's own", async () => {
    const s = start({ colours: COLOURS }).session;
    await typed(s, "hello world");
    const { y, x } = where(s, "hello world");
    expect(cell(s, x + 6, y).bg).toBeNull();
    const fg = (i: number) => {
      const c = s.cell(s.term.buffer.active.viewportY + y, x + i)!;
      return `${c.getFgColorMode()}:${c.getFgColor()}`;
    };
    const textFg = fg(0);
    s.sendKeys({ text: SHIFT_LEFT.repeat(5) });
    const fill = deriveSurfaces(COLOURS)["surface.selection"].toLowerCase();
    await s.waitFor(() => cell(s, x + 6, y).bg === fill, 5000);
    for (let i = 6; i < 11; i++) expect(cell(s, x + i, y)).toEqual({ bg: fill, inverse: false });
    for (let i = 0; i < 6; i++) expect(cell(s, x + i, y)).toEqual({ bg: null, inverse: false });
    expect(cell(s, x + 11, y).bg).toBeNull();
    // The text colour is kept on the selected cells (never the dark default of OpenTUI's own).
    for (let i = 6; i < 11; i++) expect(fg(i)).toBe(textFg);
  }, 30000);

  test("Flat theme: the five cells of `world` are drawn in inverse video", async () => {
    const s = start({ colours: COLOURS, config: { theme: { flat: true } } }).session;
    await typed(s, "hello world");
    const { y, x } = where(s, "hello world");
    s.sendKeys({ text: SHIFT_LEFT.repeat(5) });
    await s.waitFor(() => cell(s, x + 6, y).inverse, 5000);
    for (let i = 6; i < 11; i++) expect(cell(s, x + i, y)).toEqual({ bg: null, inverse: true });
    for (let i = 0; i < 6; i++) expect(cell(s, x + i, y)).toEqual({ bg: null, inverse: false });
    expect(cell(s, x + 11, y).inverse).toBe(false);
  }, 30000);

  test("Flat theme without the terminal's colours: inverse video too", async () => {
    const s = start().session;
    await typed(s, "hello world");
    const { y, x } = where(s, "hello world");
    s.sendKeys({ text: SHIFT_LEFT.repeat(5) });
    await s.waitFor(() => cell(s, x + 6, y).inverse, 5000);
    expect(cell(s, x + 10, y)).toEqual({ bg: null, inverse: true });
    expect(cell(s, x + 5, y).inverse).toBe(false);
    // Inverse swaps the text colour with the background, so the text colour is the unselected one.
    const fg = (i: number) => {
      const c = s.cell(s.term.buffer.active.viewportY + y, x + i)!;
      return `${c.getFgColorMode()}:${c.getFgColor()}`;
    };
    for (let i = 6; i < 11; i++) expect(fg(i)).toBe(fg(0));
  }, 30000);

  // Skipped on Windows: it needs the terminal's OSC 10/11 colour replies (derived surfaces, light theme), which ConPTY never passes on (it passes only OSC 4).
  test.skipIf(WINDOWS)("Drag in the prompt box: `world` is drawn as selected, nothing is written to the clipboard, and Backspace leaves `hello `", async () => {
    const s = start({ colours: COLOURS }).session;
    await typed(s, "hello world");
    const { y, x } = where(s, "hello world");
    s.mousePress(x + 6, y);
    for (let i = 7; i <= 10; i++) {
      s.mouseMove(x + i, y, "left");
      await Bun.sleep(15);
    }
    s.mouseRelease(x + 10, y);
    const fill = deriveSurfaces(COLOURS)["surface.selection"].toLowerCase();
    await s.waitFor(() => cell(s, x + 6, y).bg === fill, 5000);
    await Bun.sleep(300);
    expect(payloads(s)).toEqual([]);
    s.sendKeys("Backspace");
    await s.waitFor((p) => promptText(p)[0] === "hello", 5000);
    s.sendKeys({ text: "x" });
    await s.waitFor((p) => promptText(p)[0] === "hello x", 5000);
  }, 30000);

  test("A click places the cursor and selects nothing", async () => {
    const s = start({ colours: COLOURS }).session;
    await typed(s, "hello world");
    const { y, x } = where(s, "hello world");
    s.mouseClick(x + 5, y);
    await Bun.sleep(300);
    s.sendKeys({ text: "_" });
    await s.waitFor((p) => promptText(p)[0] === "hello_ world", 5000);
    expect(payloads(s)).toEqual([]);
  }, 30000);

  // Skipped on Windows: it needs the terminal's OSC 10/11 colour replies (derived surfaces, light theme), which ConPTY never passes on (it passes only OSC 4).
  test.skipIf(WINDOWS)("Selection in the prompt box: Ctrl+C copies `world`, with the toast, and leaves the draft and its selection", async () => {
    const s = start({ colours: COLOURS }).session;
    await typed(s, "hello world");
    s.sendKeys({ text: SHIFT_LEFT.repeat(5) });
    await Bun.sleep(200);
    s.sendKeys({ text: CTRL_C });
    await s.waitFor(() => payloads(s).length === 1, 5000);
    expect(payloads(s)).toEqual(["world"]);
    await s.waitFor((p) => p.screenText().some((l) => l.includes("sent 5 chars to the terminal")), 5000);
    expect(promptText(s)[0]).toBe("hello world");
    const { y, x } = where(s, "hello world");
    const fill = deriveSurfaces(COLOURS)["surface.selection"].toLowerCase();
    expect(cell(s, x + 6, y).bg).toBe(fill);
  }, 30000);

  // Skipped on Windows: it needs the terminal's OSC 10/11 colour replies (derived surfaces, light theme), which ConPTY never passes on (it passes only OSC 4).
  test.skipIf(WINDOWS)("Esc clears first: with a turn running, Esc clears the selection, leaves the draft and does not arm the interrupt", async () => {
    const s = start({ scenario: "slow-turn", delayScale: 4, colours: COLOURS }).session;
    await s.waitFor(READY, 10000);
    s.sendKeys({ text: "go" });
    await s.waitFor((p) => promptText(p)[0] === "go", 5000);
    s.sendKeys("Enter");
    await s.waitFor(RUNNING, 10000);
    s.sendKeys({ text: "hello world" });
    await s.waitFor((p) => promptText(p)[0] === "hello world", 5000);
    s.sendKeys({ text: SHIFT_LEFT.repeat(5) });
    const { y, x } = where(s, "hello world");
    const fill = deriveSurfaces(COLOURS)["surface.selection"].toLowerCase();
    await s.waitFor(() => cell(s, x + 6, y).bg === fill, 5000);
    s.sendKeys("Esc");
    await s.waitFor(() => cell(s, x + 6, y).bg === null, 5000);
    expect(promptText(s)[0]).toBe("hello world");
    await Bun.sleep(300);
    expect(s.screenText().join("\n")).not.toMatch(/again|interrupt armed|to interrupt/i);
    // A second Esc is then the first: the turn is still running.
    expect(s.screenText().join("\n")).toMatch(/running/);
  }, 30000);

  // Skipped on Windows: it needs the terminal's OSC 10/11 colour replies (derived surfaces, light theme), which ConPTY never passes on (it passes only OSC 4).
  test.skipIf(WINDOWS)("One selection at a time: a word selected in the prompt box clears the conversation's selection, and Ctrl+C copies the prompt box's word", async () => {
    const r = start({ scenario: "copy-fixtures", colours: COLOURS, config: { density: "compact", cards: { padding: { columns: 1 } } } });
    const s = r.session;
    await sendPrompt(s, "give me things to copy");
    await s.waitFor((p) => p.screenText().some((l) => l.startsWith("  The third paragraph")) && READY.test(p.screenText().join("\n")), 15000);
    const para = s.screenText().findIndex((l) => l.startsWith("  The third paragraph"));
    // A drag in the conversation selects (and copies on release).
    s.mousePress(2, para);
    s.mouseMove(8, para, "left");
    await Bun.sleep(30);
    s.mouseMove(12, para, "left");
    await Bun.sleep(30);
    s.mouseRelease(12, para);
    const fill = deriveSurfaces(COLOURS)["surface.selection"].toLowerCase();
    await s.waitFor(() => cell(s, 5, para).bg === fill, 5000);
    // The release copied it; wait for that copy before counting.
    await s.waitFor(() => payloads(s).length === 1, 5000);
    const before = payloads(s).length;
    s.sendKeys({ text: "hello world" });
    await s.waitFor((p) => promptText(p)[0] === "hello world", 5000);
    s.sendKeys({ text: SHIFT_LEFT.repeat(5) });
    await s.waitFor(() => cell(s, 5, para).bg !== fill, 5000);
    s.sendKeys({ text: CTRL_C });
    await s.waitFor(() => payloads(s).length === before + 1, 5000);
    expect(payloads(s).at(-1)).toBe("world");
  }, 40000);
});
