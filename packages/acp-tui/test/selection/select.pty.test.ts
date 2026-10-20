// Selection and copy in the real CLI (phase-1a tasks 14.2 and 14.3;
// mvp-conversation task group 5, with no `--spike` argument): acp-tui under a
// PTY against fake-agent's `copy-fixtures`, SGR drags injected across three
// items, `y` and `Y` on the conversation cursor, and the clipboard paths.
//
// These tests never reach the user's clipboard (see ./pty.ts).
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PtySession } from "../pty/harness.ts";
import { promptBox, READY } from "../pty/regions.ts";
import { sendPrompt, startCli, type CliRun } from "../conversation/cli.ts";
import { COPY_FIXTURES, MARKDOWN_GALLERY } from "./fixtures.ts";
import { localEnv, osc52Payloads } from "./pty.ts";
import { configEnv } from "../pty/config-home.ts";
import { alive, makeStubs, type Stubs } from "./clipboard-stub.ts";
import { deriveSurfaces } from "../../src/theme/index.ts";
import type { OscColours } from "../pty/harness.ts";

const GOLDEN = join(import.meta.dir, "golden");
const golden = (name: string) => readFileSync(join(GOLDEN, name), "utf8").replace(/\n$/, "");

let run: CliRun | undefined;
afterEach(async () => {
  await run?.session.dispose();
  run = undefined;
});

const COLS = 60;
const ROWS = 70;

/** Every Markdown block of `copy-fixtures` is on screen (they lay out over a few frames). */
const laidOut = (s: PtySession) =>
  ["  │ created_at", "  The third paragraph", "  ● third item"].every((prefix) => s.screenText().some((l) => l.startsWith(prefix))) &&
  // The code block's last line, after its padding columns (the flat theme's rule, or the fill, and
  // the second column with the default two).
  s.screenText().some((l) => /^ {2}[ ▎] ?\}\s*$/.test(l));

/** These tests are about selection at the column positions they were written for: `compact`, and
 *  one column of card padding (the default before day-one-feedback's task group 13; code blocks
 *  in answers keep their padding rows, which are decorative and never selected). A test that gives
 *  its own `XDG_CONFIG_HOME` replaces it. */
const SELECTION_CONFIG = { density: "compact", cards: { padding: { columns: 1 } } };

async function start(args: string[] = [], env = localEnv(), colours?: OscColours): Promise<CliRun> {
  run = startCli({ scenario: "copy-fixtures", cols: COLS, rows: ROWS, args, env: { ...configEnv(SELECTION_CONFIG), ...env }, ...(colours ? { colours } : {}) });
  const s = run.session;
  await sendPrompt(s, "give me things to copy");
  await s.waitFor((p) => laidOut(p) && READY.test(p.screenText().join("\n")), 15000);
  return run;
}

function rowOf(s: PtySession, prefix: string): number {
  const y = s.screenText().findIndex((l) => l.startsWith(prefix));
  if (y < 0) throw new Error(`no row starting with ${JSON.stringify(prefix)}\n${s.screenText().join("\n")}`);
  return y;
}

/** Expands the edit (Ctrl+O toggles the latest tool call) and waits for its hunk header. */
async function expandTool(s: PtySession): Promise<number> {
  s.sendKeys("Ctrl+O");
  await s.waitFor((p) => p.screenText().some((l) => l.startsWith("  ┃ @@ -6,12 +6,7 @@")), 5000);
  return rowOf(s, "  ┃ @@ -6,12 +6,7 @@");
}

/** A drag with the left button: press, motion through `via`, release. */
async function drag(s: PtySession, from: [number, number], via: [number, number][], to: [number, number]): Promise<void> {
  s.mousePress(from[0], from[1]);
  for (const [x, y] of via) {
    s.mouseMove(x, y, "left");
    await Bun.sleep(15);
  }
  s.mouseMove(to[0], to[1], "left");
  await Bun.sleep(15);
  s.mouseRelease(to[0], to[1]);
}

const toastRow = (s: PtySession) => promptBox(s)[0] ?? "";

async function nextPayload(s: PtySession, count: number): Promise<string> {
  await s.waitFor((p) => osc52Payloads(p.rawOutput()).length > count, 5000);
  return osc52Payloads(s.rawOutput())[count]!;
}

/** The collapsed edit's header row and the column its title starts in. */
function toolHeader(s: PtySession): { y: number; x: number } {
  const y = s.screenText().findIndex((l) => l.includes("Edit src/InvoiceTotal.php") && l.includes("edit"));
  if (y < 0) throw new Error(`no tool header\n${s.screenText().join("\n")}`);
  return { y, x: s.screenText()[y]!.indexOf("Edit src") };
}

const expandedTool = (s: PtySession) => s.screenText().some((l) => l.startsWith("  ┃ @@ -6,12 +6,7 @@"));

describe("plain drag under `full` (mvp-conversation task 5.3)", () => {
  test("A drag is not a click: press on a collapsed tool line, move, release: it stays collapsed and the drag selects and copies", async () => {
    const { session: s, events } = await start();
    const { y, x } = toolHeader(s);
    expect(expandedTool(s)).toBe(false);
    await drag(s, [x, y], [[x + 2, y]], [x + 5, y]);
    // The cell under the pointer at release is the selection's last character.
    expect(await nextPayload(s, 0)).toBe("Edit s");
    expect(events("clipboard")[0]).toMatchObject({ trigger: "release" });
    // Past the double-click interval, so the next press is a first click.
    await Bun.sleep(500);
    expect(expandedTool(s)).toBe(false);
    // A press and release on one cell is still a click: it toggles the line.
    s.mouseClick(x, y);
    await s.waitFor(expandedTool, 5000);
    expect(osc52Payloads(s.rawOutput())).toHaveLength(1);
  }, 30000);

  for (const policy of ["wheel", "off"] as const) {
    test(`Not under wheel or off: with --mouse ${policy} a drag over the conversation selects and copies nothing`, async () => {
      const { session: s, events } = await start(["--mouse", policy]);
      const row = rowOf(s, "  The first paragraph");
      await drag(s, [2, row], [[6, row]], [2 + 8, row]);
      // Ctrl+C after it finds no selection either (and copies no cursor item: the prompt box has focus).
      s.sendKeys("Ctrl+C");
      await Bun.sleep(600);
      expect(osc52Payloads(s.rawOutput())).toEqual([]);
      expect(events("clipboard")).toEqual([]);
    }, 30000);
  }
});

describe("selection and copy (phase-1a tasks 14.2, 14.3)", () => {
  test("a drag across three items copies on release: host path unavailable, so OSC 52, equal to the golden range", async () => {
    const { session: s, events } = await start();
    const hunk = await expandTool(s);
    const name = rowOf(s, "  │ name ");
    // From the end of the hunk header up through the tool's title and the paragraphs to `name`.
    await drag(s, [2 + 2 + 15, hunk], [[20, hunk - 2], [10, name + 6], [4, name + 1]], [2, name]);
    expect(await nextPayload(s, 0)).toBe(golden("range.txt"));
    const chars = Array.from(golden("range.txt")).length;
    await s.waitFor((p) => toastRow(p).includes(`sent ${chars} chars to the terminal (OSC 52, not confirmed)`), 3000);
    const [clip] = events("clipboard");
    expect(clip).toMatchObject({ trigger: "release", mode: "auto", path: "osc52", host: "unsupported", terminal: "attempted", remote: false });
    // The tool call was not toggled by the release on its card.
    expect(s.screenText().some((l) => l.startsWith("  ┃ @@ -6,12 +6,7 @@"))).toBe(true);
  }, 30000);

  test("Inside the cursor's item: with the terminal's colours known, the selection is the surface.selection fill, the rest of the item the cursor's", async () => {
    const colours = { foreground: "#bcbec4", background: "#191a1c" } satisfies OscColours;
    const { session: s } = await start([], localEnv(), colours);
    const para = rowOf(s, "  The third paragraph");
    const list = rowOf(s, "  ● second item");
    // Tab focuses the conversation, so its cursor is drawn (a click keeps keyboard focus where it
    // was, mvp-chrome-and-keys task 3.3).
    s.sendKeys("Tab");
    await Bun.sleep(100);
    // The press puts the conversation cursor on the paragraphs, which fills that item with the
    // cursor's faint surface (surface.cursor.faint) beside a `▎` bar in surface.cursor's colour
    // (review C5; scenario "Cursor inside a selection"); the drag ends inside the list.
    await drag(s, [2, para], [[4, list - 1]], [2 + 7, list]);
    await nextPayload(s, 0);
    const surfaces = deriveSurfaces(colours);
    const selection = surfaces["surface.selection"].toLowerCase();
    const cursor = surfaces["surface.cursor.faint"].toLowerCase();
    expect(selection).not.toBe(cursor);
    const cell = (x: number, y: number) => {
      const c = s.cell(s.term.buffer.active.viewportY + y, x)!;
      return { rgb: c.isBgRGB() ? `#${c.getBgColor().toString(16).padStart(6, "0")}` : null, inverse: c.isInverse() !== 0 };
    };
    const bar = (y: number) => {
      const c = s.cell(s.term.buffer.active.viewportY + y, 0)!;
      return { char: c.getChars(), fg: c.isFgRGB() ? `#${c.getFgColor().toString(16).padStart(6, "0")}` : null };
    };
    await s.waitFor(() => cell(2, list).rgb === selection, 3000);
    // The list (not under the cursor): the fill, no inverse; the rest of the row untouched.
    expect(cell(2, list)).toEqual({ rgb: selection, inverse: false });
    expect(cell(9, list)).toEqual({ rgb: selection, inverse: false });
    expect(cell(10, list)).toEqual({ rgb: null, inverse: false });
    expect(cell(1, list)).toEqual({ rgb: null, inverse: false });
    // The paragraphs under the cursor: the selected text on its own fill, never inverse video;
    // the gutter and the paragraphs above the selection on the cursor's faint fill, the bar in
    // column 0 of each of the item's rows.
    expect(cell(2, para)).toEqual({ rgb: selection, inverse: false });
    expect(cell(1, para)).toEqual({ rgb: cursor, inverse: false });
    const first = rowOf(s, "▎ The first paragraph");
    expect(cell(2, first)).toEqual({ rgb: cursor, inverse: false });
    for (const y of [first, para]) expect(bar(y)).toEqual({ char: "▎", fg: surfaces["surface.cursor"].toLowerCase() });
    expect(bar(list).char).not.toBe("▎");
  }, 30000);

  test("Blank line in a selection: the blank line between two selected paragraphs shows as selected", async () => {
    const colours = { foreground: "#bcbec4", background: "#191a1c" } satisfies OscColours;
    const { session: s } = await start([], localEnv(), colours);
    const first = rowOf(s, "  The first paragraph");
    const second = rowOf(s, "  The second paragraph");
    const blank = second - 1;
    expect(s.screenText()[blank]!.trim()).toBe("");
    await drag(s, [2 + 4, first], [[10, blank]], [2 + 9, second]);
    const copied = await nextPayload(s, 0);
    expect(copied).toContain("sentences.\n\nThe second");
    const selection = deriveSurfaces(colours)["surface.selection"].toLowerCase();
    const bg = (x: number, y: number) => {
      const c = s.cell(s.term.buffer.active.viewportY + y, x)!;
      return c.isBgRGB() ? `#${c.getBgColor().toString(16).padStart(6, "0")}` : null;
    };
    await s.waitFor(() => bg(2, blank) === selection, 3000);
    // One cell, where the line's text would start; the gutter and the rest of the row untouched.
    expect(bg(1, blank)).not.toBe(selection);
    expect(bg(3, blank)).not.toBe(selection);
  }, 30000);

  test("Under an overlay:the palette opened over a selection shows no selection fill; the selection above it stays", async () => {
    const colours = { foreground: "#bcbec4", background: "#191a1c" } satisfies OscColours;
    // 48 rows: the palette (about 37 rows) leaves the conversation's first rows above it (the
    // margins, the row budget and the scrollbar's columns of mvp-chrome-and-keys took rows at 40).
    const rowsTall = 48;
    run = startCli({ scenario: "copy-fixtures", cols: COLS, rows: rowsTall, env: localEnv(), colours });
    const s = run.session;
    await sendPrompt(s, "give me things to copy");
    await s.waitFor((p) => p.screenText().some((l) => l.startsWith("  ● third item")) && READY.test(p.screenText().join("\n")), 15000);
    await Bun.sleep(200);
    const surfaces = deriveSurfaces(colours);
    const selection = surfaces["surface.selection"].toLowerCase();
    const bg = (x: number, y: number) => {
      const c = s.cell(s.term.buffer.active.viewportY + y, x)!;
      return c.isBgRGB() ? `#${c.getBgColor().toString(16).padStart(6, "0")}` : null;
    };
    const filled = () => {
      const out: [number, number][] = [];
      for (let y = 0; y < rowsTall; y++) for (let x = 0; x < COLS; x++) if (bg(x, y) === selection) out.push([x, y]);
      return out;
    };
    // From the first text row at the top to the end of the list at the bottom: the whole
    // conversation on screen.
    const top = s.screenText().findIndex((l) => /^ {2} ?\S/.test(l)); // a code row: after its pad column
    const bottom = rowOf(s, "  ● third item");
    await drag(s, [2, top], [[10, top + 5], [10, bottom - 5]], [2 + 11, bottom]);
    await nextPayload(s, 0);
    await s.waitFor(() => filled().some(([, y]) => y === bottom), 3000);
    const before = new Set(filled().map(([, y]) => y));
    s.sendKeys("Ctrl+P");
    // The palette: in the prompt box's place on the terminal's default background since
    // mvp-chrome-and-keys task 12.7 (until then above the status row on surface.card), its rows
    // found by its frame, from the top border with the title to the bottom border with the hints.
    // Filtered to the item commands, so it is shorter than the screen (unfiltered it now reaches
    // the second row, above the whole selection) and taller than the prompt box it covers.
    await s.waitFor((p) => p.screenText().some((l) => l.includes("Clear the selection")), 5000);
    s.sendKeys({ text: "item" });
    await s.waitFor((p) => p.screenText().some((l) => l.startsWith("│ › item")), 5000);
    await Bun.sleep(150);
    const rows = s.screenText();
    const first = rows.findIndex((l) => /^╭─ Commands \d+/.test(l));
    const last = rows.findIndex((l, y) => y > first && /^╰─ ↑↓ select/.test(l));
    expect(last).toBeGreaterThan(first);
    expect(first).toBeGreaterThan(top);
    // The palette covers rows that showed the selection before it opened.
    expect([...before].some((y) => y >= first && y <= last)).toBe(true);
    expect(filled().filter(([, y]) => y >= first && y <= last)).toEqual([]);
    // The selection is still drawn above the palette.
    expect(filled().some(([, y]) => y < first)).toBe(true);
  }, 30000);

  test("y copies each item as plain text (code, table, paragraphs, diff, list), Y as Markdown", async () => {
    const { session: s } = await start();
    s.sendKeys("Tab"); // the conversation, cursor on the last item
    await Bun.sleep(100);
    s.sendKeys("Home"); // the user's prompt
    const expected = ["code.txt", "table.txt", "paragraphs.txt", "diff.txt", "list.txt"];
    for (let k = 0; k < expected.length; k++) {
      s.sendKeys({ text: "j" });
      await Bun.sleep(50);
      s.sendKeys({ text: "y" });
      expect(await nextPayload(s, k)).toBe(golden(expected[k]!));
    }
    s.sendKeys({ text: "Y" });
    // The `Y` golden: the list's Markdown source, markers and emphasis kept.
    expect(await nextPayload(s, expected.length)).toBe(golden("list.md"));
    expect(golden("list.md")).toBe(COPY_FIXTURES.list.replace(/\n+$/, ""));
  }, 30000);

  test("Rich copy: Ctrl+Shift+C in the kitty encoding (CSI 99;6u) with nothing selected copies the cursor item's Markdown; in the legacy encoding (0x03) it is Ctrl+C", async () => {
    run = startCli({ scenario: "markdown-gallery", cols: 63, rows: 40, env: localEnv() });
    const s = run.session;
    await sendPrompt(s, "show me the gallery");
    await s.waitFor((p) => p.screenText().some((l) => l.includes("M99 end of gallery")) && READY.test(p.screenText().join("\n")), 15000);
    s.sendKeys("Tab"); // the conversation
    await Bun.sleep(100);
    s.sendKeys("Home"); // the user's prompt, then the gallery message
    await Bun.sleep(50);
    s.sendKeys({ text: "j" });
    await Bun.sleep(100);
    s.write("\x1b[99;6u");
    const markdown = await nextPayload(s, 0);
    expect(markdown).toBe(MARKDOWN_GALLERY.replace(/\n+$/, ""));
    // The nested list keeps its markers in the Markdown source.
    expect(markdown).toContain("- Level 1 dash\n  - Level 2 dash\n    - Level 3 dash");
    s.write("\x03");
    const plain = await nextPayload(s, 1);
    // The projection: no heading markers, no emphasis delimiters outside code spans.
    expect(plain).toContain("M01 emphasis: star italic,");
    expect(plain.startsWith("Markdown gallery\n")).toBe(true);
    expect(run.events("clipboard").map((e) => e["trigger"])).toEqual(["ctrl+shift+c", "ctrl+c"]);
  }, 30000);

  test("Rich copy with a selection copies it as plain text", async () => {
    const { session: s, events } = await start();
    const row = rowOf(s, "  ● second item");
    await drag(s, [2, row], [], [2 + 28, row]);
    expect(await nextPayload(s, 0)).toBe("● second item, with bold text");
    s.write("\x1b[99;6u");
    expect(await nextPayload(s, 1)).toBe("● second item, with bold text");
    expect(events("clipboard").map((e) => e["trigger"])).toEqual(["release", "ctrl+shift+c"]);
  }, 30000);

  test("double click copies a word, triple click a line", async () => {
    const { session: s } = await start();
    const row = rowOf(s, "  The second paragraph");
    s.mouseClick(2 + 5, row);
    s.mouseClick(2 + 5, row);
    expect(await nextPayload(s, 0)).toBe("second");
    await Bun.sleep(500);
    // In "reason": the second click is a double click and copies the word, the third the line.
    s.mouseClick(2 + 33, row);
    s.mouseClick(2 + 33, row);
    s.mouseClick(2 + 33, row);
    expect(await nextPayload(s, 1)).toBe("reason");
    expect(await nextPayload(s, 2)).toBe("The second paragraph gives the reason, including a code span that must survive a copy.");
  }, 30000);

  test("Ctrl+C: the selection; once Esc has cleared it, the conversation cursor's item; with the prompt box focused, nothing", async () => {
    const { session: s, events } = await start();
    const row = rowOf(s, "  The first paragraph");
    // Tab focuses the conversation (a click keeps keyboard focus where it was, mvp-chrome-and-keys
    // task 3.3); the press puts the conversation cursor on the paragraphs.
    s.sendKeys("Tab");
    await Bun.sleep(100);
    await drag(s, [2, row], [], [2 + 8, row]);
    expect(await nextPayload(s, 0)).toBe("The first");
    s.sendKeys("Ctrl+C");
    expect(await nextPayload(s, 1)).toBe("The first");
    s.sendKeys("Esc"); // clears the selection
    await Bun.sleep(200);
    s.sendKeys("Ctrl+C");
    expect(await nextPayload(s, 2)).toBe(golden("paragraphs.txt"));
    s.sendKeys("Esc"); // back to the prompt box
    await Bun.sleep(200);
    s.sendKeys("Ctrl+C");
    await Bun.sleep(500);
    expect(osc52Payloads(s.rawOutput())).toHaveLength(3);
    expect(events("clipboard").map((e) => e["trigger"])).toEqual(["release", "ctrl+c", "ctrl+c"]);
    expect(events("exit_state").filter((e) => e["to"] === "exit")).toEqual([]);
  }, 30000);

  test("Ctrl+C on the cursor item: nothing selected, the cursor on an expanded diff card: its title and unified diff", async () => {
    const { session: s } = await start();
    await expandTool(s);
    s.sendKeys("Tab"); // the conversation, cursor on the last item
    await Bun.sleep(100);
    s.sendKeys("Home"); // the user's prompt, then down to the edit
    for (let k = 0; k < 4; k++) {
      await Bun.sleep(50);
      s.sendKeys({ text: "j" });
    }
    await Bun.sleep(100);
    s.sendKeys("Ctrl+C");
    expect(await nextPayload(s, 0)).toBe(golden("diff.txt"));
  }, 30000);

  test("with no host clipboard and OSC 52 off, the toast says nothing was copied and no OSC 52 is written", async () => {
    const { session: s, events } = await start(["--clipboard", "host"]);
    const row = rowOf(s, "  The first paragraph");
    await drag(s, [2, row], [], [2 + 8, row]);
    await s.waitFor((p) => toastRow(p).includes("nothing copied: no clipboard available"), 5000);
    expect(osc52Payloads(s.rawOutput())).toEqual([]);
    expect(events("clipboard")[0]).toMatchObject({ mode: "host", path: "none", host: "unsupported", terminal: "not-attempted" });
  }, 30000);

  test("over SSH (SSH_CONNECTION set) the copy goes straight to OSC 52", async () => {
    const { session: s, events } = await start([], localEnv({ SSH_CONNECTION: "192.0.2.1 50000 192.0.2.2 22" }));
    const row = rowOf(s, "  The first paragraph");
    await drag(s, [2, row], [], [2 + 8, row]);
    expect(await nextPayload(s, 0)).toBe("The first");
    expect(events("clipboard")[0]).toMatchObject({ path: "osc52", host: "not-attempted", terminal: "attempted", remote: true });
  }, 30000);
});

// mvp-configuration tasks 4.3 and 4.4 (spec tui-config "Clipboard and copy settings"): the
// clipboard paths driven from the user's file instead of `--clipboard`, live on a reload, and
// `selection.copy_on_release`.
describe("clipboard and copy settings from the configuration", () => {
  /** A configuration home with the user's file holding `config`; `write` saves it by a rename. */
  function configHome(config: unknown) {
    const home = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-select-config-")));
    const dir = join(home, "acp-tui");
    mkdirSync(dir);
    const file = join(dir, "config.jsonc");
    writeFileSync(file, JSON.stringify(config));
    return {
      home,
      write(value: unknown) {
        const tmp = join(dir, `.config.${Date.now()}.tmp`);
        writeFileSync(tmp, JSON.stringify(value));
        renameSync(tmp, file);
      },
    };
  }

  test("clipboard host from the file: with no host clipboard, the toast says nothing was copied and no OSC 52 is written", async () => {
    const cfg = configHome({ clipboard: "host" });
    const { session: s, events } = await start([], localEnv({ XDG_CONFIG_HOME: cfg.home }));
    const row = rowOf(s, "  The first paragraph");
    await drag(s, [2, row], [], [2 + 8, row]);
    await s.waitFor((p) => toastRow(p).includes("nothing copied: no clipboard available"), 5000);
    expect(osc52Payloads(s.rawOutput())).toEqual([]);
    expect(events("clipboard")[0]).toMatchObject({ mode: "host", path: "none", host: "unsupported", terminal: "not-attempted" });
  }, 30000);

  test("clipboard none from the file copies nothing; a reload to osc52 applies to the next copy", async () => {
    const cfg = configHome({ clipboard: "none" });
    const { session: s, events } = await start([], localEnv({ XDG_CONFIG_HOME: cfg.home }));
    const row = rowOf(s, "  The first paragraph");
    await drag(s, [2, row], [], [2 + 8, row]);
    await s.waitFor((p) => toastRow(p).includes("nothing copied"), 5000);
    expect(events("clipboard")[0]).toMatchObject({ mode: "none", path: "none" });
    cfg.write({ clipboard: "osc52" });
    await s.waitFor(() => events("config_reload").length === 1, 3000);
    // Long enough apart that the next press is not taken for a double click.
    await Bun.sleep(700);
    await drag(s, [2, row], [], [2 + 8, row]);
    expect(await nextPayload(s, 0)).toBe("The first");
    expect(events("clipboard")[1]).toMatchObject({ mode: "osc52", path: "osc52", host: "not-attempted" });
  }, 30000);

  test("--clipboard wins over the file and over a reload", async () => {
    const cfg = configHome({ clipboard: "none" });
    const { session: s, events } = await start(["--clipboard", "osc52"], localEnv({ XDG_CONFIG_HOME: cfg.home }));
    const row = rowOf(s, "  The first paragraph");
    await drag(s, [2, row], [], [2 + 8, row]);
    expect(await nextPayload(s, 0)).toBe("The first");
    expect(events("clipboard")[0]).toMatchObject({ mode: "osc52" });
  }, 30000);

  test("No copy on release: with selection.copy_on_release false nothing is written on release, the selection stays highlighted, and Ctrl+C then copies it", async () => {
    const cfg = configHome({ selection: { copy_on_release: false } });
    const { session: s, events } = await start([], localEnv({ XDG_CONFIG_HOME: cfg.home }));
    const first = rowOf(s, "  The first paragraph");
    const second = rowOf(s, "  The third paragraph");
    await drag(s, [2, first], [[4, first + 1]], [8, second]);
    await Bun.sleep(400);
    await s.flush();
    expect(events("clipboard")).toEqual([]);
    expect(osc52Payloads(s.rawOutput())).toEqual([]);
    // The highlight (inverse video under the flat theme) is still drawn on the selected cells.
    const base = s.term.buffer.active.baseY;
    expect(s.cell(base + first, 3)!.isInverse()).not.toBe(0);
    s.sendKeys("Ctrl+C");
    const copied = await nextPayload(s, 0);
    expect(copied.startsWith("The first paragraph")).toBe(true);
    expect(copied.endsWith("The thi")).toBe(true);
    expect(events("clipboard")[0]).toMatchObject({ trigger: "ctrl+c" });
    expect(s.cell(base + first, 3)!.isInverse()).not.toBe(0);
  }, 30000);
});

describe("copied text kept after exit (mvp-chrome-and-keys task 12.6)", () => {
  // `PATH` is only the stubs' directory (./clipboard-stub.ts, with a `bun` link for the agent), so
  // the real `wl-copy` is never found; `WAYLAND_DISPLAY` names a socket that does not exist in
  // the empty `XDG_RUNTIME_DIR`, so the native backend could reach no compositor either.
  let stubs: Stubs | undefined;
  afterEach(() => {
    stubs?.cleanup();
    stubs = undefined;
  });

  test("Copy survives detach: the drag's text goes to wl-copy on stdin, the notice names it, and acp-tui exits while wl-copy's serving child runs on", async () => {
    stubs = makeStubs(["wl-copy"]);
    const env = localEnv({ PATH: stubs.bin, STUB_LOG: stubs.log, WAYLAND_DISPLAY: "acp-tui-test-no-compositor" });
    const { session: s, events } = await start([], env);
    const row = rowOf(s, "  The first paragraph");
    await drag(s, [2, row], [], [2 + 8, row]);
    await s.waitFor((p) => toastRow(p).includes("copied 9 chars to the Wayland clipboard (wl-copy)"), 5000);
    expect(osc52Payloads(s.rawOutput())).toEqual([]);
    expect(events("clipboard")[0]).toMatchObject({ trigger: "release", path: "host", via: "wl-copy", helper: "written", host: "written", terminal: "not-attempted" });
    const rec = stubs.record("wl-copy")!;
    expect(rec.argv).toEqual(["--type", "text/plain"]);
    expect(rec.stdin).toBe("The first");
    expect(rec.WAYLAND_DISPLAY).toBe("acp-tui-test-no-compositor");
    expect(["sh", "bash", "dash", "zsh", "fish"]).not.toContain(rec.parent);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    expect(alive(rec.servingPid!)).toBe(true);
  }, 30000);
});
