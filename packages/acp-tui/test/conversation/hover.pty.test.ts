// Hover feedback (mvp-rendering task 14.5, review C12; spec tui-rendering "Hover feedback"): the
// real CLI under a PTY with the terminal's colours answered (so the derived `surface.cursor` fill
// is drawn), pointer motion injected as SGR reports without a button (all-motion reporting, 1003,
// is on under `--mouse full`). What a click would act on is marked while the pointer is over it:
// a link's label and host hint, a tool card's `here`, a collapsed tool line; movement within one
// target draws no frame; only the cells whose mark changes are written.
import { afterEach, describe, expect, test } from "bun:test";
import type { OscColours, PtySession } from "../pty/harness.ts";
import { READY } from "../pty/regions.ts";
import { deriveSurfaces } from "../../src/theme/derive.ts";
import { localEnv, osc52Payloads } from "../selection/pty.ts";
import { sendPrompt, settle, startCli, type CliRun } from "./cli.ts";

const DARK = { foreground: "#bcbec4", background: "#191a1c" } satisfies OscColours;
const SURFACES = deriveSurfaces(DARK);
const MARK = SURFACES["surface.cursor"].toLowerCase();
const NO_TERMINAL = { TERM_PROGRAM: undefined, TERMINAL_EMULATOR: undefined, ACP_TUI_CAPABILITIES: undefined };

let run: CliRun | undefined;
afterEach(async () => {
  await run?.session.dispose();
  run = undefined;
});

const bgHex = (s: PtySession, y: number, x: number): string => {
  const cell = s.cell(s.term.buffer.active.baseY + y, x)!;
  return cell.isBgDefault() ? "default" : `#${cell.getBgColor().toString(16).padStart(6, "0")}`;
};

/** The columns of row `y` drawn with the hover mark. */
function marked(s: PtySession, y: number): number[] {
  const out: number[] = [];
  for (let x = 0; x < s.cols; x++) if (bgHex(s, y, x) === MARK) out.push(x);
  return out;
}

/** Every marked cell on screen, as `y:x` strings. */
function allMarked(s: PtySession): string[] {
  const out: string[] = [];
  for (let y = 0; y < s.rows; y++) for (const x of marked(s, y)) out.push(`${y}:${x}`);
  return out;
}

/** The cell (column, row) where `text` is first drawn. */
function cellOf(s: PtySession, text: string): [number, number] {
  const rows = s.screenText();
  const y = rows.findIndex((l) => l.includes(text));
  if (y < 0) throw new Error(`no ${JSON.stringify(text)} on screen\n${rows.join("\n")}`);
  return [rows[y]!.indexOf(text), y];
}

const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);

// Everything that is not printed text: CSI, OSC strings, charset designations, other escapes.
const CONTROLS = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-Za-z]|\x1b[=>78]/g;
/** What was printed (text only) in the raw output from `offset` on. */
const printedSince = (s: PtySession, offset: number) => s.rawOutput().slice(offset).replace(CONTROLS, "");

async function start(scenario: string, rows = 30): Promise<PtySession> {
  run = startCli({ scenario, cols: 100, rows, colours: DARK, env: localEnv(NO_TERMINAL) });
  return run.session;
}

describe("hover feedback (C12)", () => {
  test("Hover over a link: its label and host hint are marked while the pointer is on it, and only those cells are written, on and off", async () => {
    const s = await start("links");
    await sendPrompt(s, "show me links");
    await s.waitFor((p) => p.screenText().some((l) => l.includes("A long one:")) && READY.test(p.screenText().join("\n")), 15000);
    await settle(s, 300);
    expect(allMarked(s)).toEqual([]);
    const [x, y] = cellOf(s, "the docs (example.com)");
    await s.flush();
    const before = s.rawOutput().length;
    s.mouseMove(x + 2, y);
    await s.waitFor((p) => marked(p, y).length > 0, 5000);
    await settle(s, 200);
    // `the docs` and `(example.com)`, not the space between them.
    expect(marked(s, y)).toEqual([...range(x, 8), ...range(x + 9, 13)]);
    expect(allMarked(s)).toHaveLength(21);
    expect(printedSince(s, before)).toBe("the docs(example.com)");
    // Off the link (the same row, past the text): the mark goes, the same cells are written back.
    const off = s.rawOutput().length;
    s.mouseMove(90, y);
    await s.waitFor((p) => marked(p, y).length === 0, 5000);
    await settle(s, 200);
    expect(allMarked(s)).toEqual([]);
    expect(printedSince(s, off)).toBe("the docs(example.com)");
    // A drag still selects and copies, and a click still opens nothing it should not: no mark
    // while the button is held.
    const [ix, iy] = cellOf(s, "inline link");
    s.mouseMove(ix, iy);
    await s.waitFor((p) => marked(p, iy).length > 0, 5000);
    s.mousePress(ix, iy);
    s.mouseMove(ix + 3, iy, "left");
    await Bun.sleep(15);
    s.mouseMove(ix + 8, iy, "left");
    await s.waitFor((p) => marked(p, iy).length === 0, 5000);
    s.mouseRelease(ix + 8, iy);
    await s.waitFor((p) => osc52Payloads(p.rawOutput()).length > 0, 5000);
    expect(osc52Payloads(s.rawOutput())[0]).toBe("inline li");
    expect(run!.events("link_open")).toEqual([]);
  }, 30000);

  test("Movement within one target: along one collapsed tool line, no frame is drawn after the first; a click still expands it, and then the card's `here` is the target", async () => {
    const s = await start("tool-content", 40);
    await sendPrompt(s, "tools");
    await s.waitFor((p) => p.screenText().some((l) => l.includes("Run the full test suite")) && READY.test(p.screenText().join("\n")), 15000);
    await settle(s, 300);
    const [, y] = cellOf(s, "Run the full test suite");
    s.mouseMove(10, y);
    await s.waitFor((p) => marked(p, y).length > 0, 5000);
    await settle(s, 200);
    // The line from the end of the gutter to the row's end.
    expect(marked(s, y)[0]).toBe(2);
    expect(allMarked(s).every((c) => c.startsWith(`${y}:`))).toBe(true);
    const frames = run!.events("frame").length;
    expect(frames).toBeGreaterThan(0);
    await s.flush();
    const raw = s.rawOutput().length;
    for (let x = 11; x <= 60; x++) {
      s.mouseMove(x, y);
      await Bun.sleep(4);
    }
    await settle(s, 300);
    expect(run!.events("frame").length).toBe(frames);
    expect(s.rawOutput().length).toBe(raw);
    // A click toggles the line as before; the line is no longer collapsed, so it loses its mark.
    s.mouseClick(30, y);
    await s.waitFor((p) => p.screenText().some((l) => l.includes("here")), 5000);
    await settle(s, 200);
    expect(marked(s, y)).toEqual([]);
    const [hx, hy] = cellOf(s, "here");
    s.mouseMove(hx + 1, hy);
    await s.waitFor((p) => marked(p, hy).length > 0, 5000);
    expect(marked(s, hy)).toEqual(range(hx, 4));
    // Elsewhere on the marker row: no mark.
    s.mouseMove(hx - 6, hy);
    await s.waitFor((p) => marked(p, hy).length === 0, 5000);
    expect(allMarked(s)).toEqual([]);
  }, 30000);

  test("--mouse wheel: no all-motion reporting and no mark", async () => {
    run = startCli({ scenario: "links", cols: 100, rows: 30, colours: DARK, args: ["--mouse", "wheel"], env: localEnv(NO_TERMINAL) });
    const s = run.session;
    await sendPrompt(s, "show me links");
    await s.waitFor((p) => p.screenText().some((l) => l.includes("A long one:")) && READY.test(p.screenText().join("\n")), 15000);
    expect(s.mouseModesSet()).toEqual([1000, 1002, 1006]);
    const [x, y] = cellOf(s, "the docs");
    s.mouseMove(x + 2, y);
    await settle(s, 300);
    expect(allMarked(s)).toEqual([]);
  }, 30000);
});
