// mvp-chrome-and-keys task 12.5 (Marcus's review, 11 October 2026, point 9):
// in PhpStorm reworked (`permission-diff`, a 21x108 pane) a click on a
// permission option started a text selection that painted the card in inverse,
// instead of focusing the answer row with that option selected. The cause:
// the card's rows are OpenTUI text renderables, selectable by default, and a
// press outside the conversation is handed to OpenTUI untouched
// (src/selection/select.tsx), so OpenTUI started its own renderer selection
// there; any motion with the button held (one cell is enough) extended it and
// OpenTUI drew it by swapping the cells' colours. The card's click handler
// also gave the answer row focus with its first option selected, whatever
// option was under the pointer. Spec tui-layout "Permission card", tui-keymap
// "A click keeps keyboard focus".
//
// The real CLI at 108x21 with the terminal's colours answered (derived
// surfaces, so the selected option is a fill and any inverse or swapped cell
// is a selection's), under the JediTerm environment and Zed's, with SGR
// presses, drags and releases at 0-based cells.
import { afterEach, describe, expect, test } from "bun:test";
import { deriveSurfaces } from "../../src/theme/index.ts";
import type { OscColours, PtySession } from "../pty/harness.ts";
import { CARD_HEADER, cardRows, READY } from "../pty/regions.ts";
import { startChrome, type ChromeOptions, type ChromeRun } from "../overlay/cli.ts";
import { WINDOWS } from "../windows.ts";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

const SIZE = { cols: 108, rows: 21 } as const;
const DARK = { foreground: "#bcbec4", background: "#191a1c" } satisfies OscColours;
const SURFACES = deriveSurfaces(DARK);
const ACCENT_FG = 4;

const TERMINALS: [string, Partial<ChromeOptions>][] = [
  ["JediTerm", { terminal: "jediterm" }],
  ["Zed", { env: { TERM_PROGRAM: "zed", TERMINAL_EMULATOR: undefined, TERM_PROGRAM_VERSION: undefined } }],
];

const cellAt = (s: PtySession, y: number, x: number) => s.cell(s.term.buffer.active.baseY + y, x)!;
function bgHex(s: PtySession, y: number, x: number): string {
  const cell = cellAt(s, y, x);
  if (cell.isBgDefault()) return "default";
  return `#${cell.getBgColor().toString(16).padStart(6, "0")}`;
}
const cardTop = (s: PtySession) => s.screenText().findIndex((r) => r.startsWith(`╭─ ${CARD_HEADER}`));
/** Each card cell's background and inverse flag, rows top to bottom border. */
function cardCells(s: PtySession): string[] {
  const top = cardTop(s);
  return cardRows(s).map((_, i) => Array.from({ length: SIZE.cols }, (_, x) => `${bgHex(s, top + i, x)}${cellAt(s, top + i, x).isInverse() ? "!" : ""}`).join(" "));
}
/** Where an option's label is drawn: its number's cell and the label's width. */
function optionAt(s: PtySession, label: string): { x: number; y: number; width: number } {
  const rows = s.screenText();
  const y = rows.findIndex((r, i) => i > cardTop(s) && r.includes(label));
  return { x: rows[y]!.indexOf(label), y, width: label.length };
}
/** The options drawn on `surface.permission.selected`. */
function selectedOptions(s: PtySession): string[] {
  const labels = ["1 allow once", "2 allow always", "3 reject once", "4 reject always"];
  return labels.filter((label) => {
    const at = optionAt(s, label);
    return at.y >= 0 && bgHex(s, at.y, at.x) === SURFACES["surface.permission.selected"];
  });
}
/** The preview's range in the bottom border is in the accent colour only while the preview has focus. */
function previewFocused(s: PtySession): boolean {
  const rows = s.screenText();
  const y = rows.findIndex((r, i) => i > cardTop(s) && r.startsWith("╰"));
  const x = rows[y]!.search(/ \d+-\d+ of \d+ /);
  return x >= 0 && cellAt(s, y, x + 1).getFgColor() === ACCENT_FG;
}
/** Cells above the card painted as a selection: on `surface.selection`, or in inverse video. */
function paintedAbove(s: PtySession): string[] {
  const out: string[] = [];
  for (let y = 0; y < cardTop(s); y++) {
    for (let x = 0; x < SIZE.cols; x++) {
      if (cellAt(s, y, x).isInverse() || bgHex(s, y, x) === SURFACES["surface.selection"]) out.push(`${y}:${x}`);
    }
  }
  return out;
}
const responses = (run: ChromeRun) => run.agent().filter((e) => e.method === "session/request_permission/response");

async function openCard(opts: Partial<ChromeOptions>): Promise<ChromeRun> {
  const run = startChrome({ scenario: "permission-diff", ...SIZE, colours: DARK, ...opts });
  session = run.s;
  await run.s.waitFor(READY, 10000);
  run.s.sendKeys({ text: "go" }, "Enter");
  await run.s.waitFor(() => cardRows(run.s).length > 0, 5000);
  // The prompt box was empty, so the card has focus at its first stop, the preview.
  await run.s.waitFor((p) => previewFocused(p), 3000);
  await Bun.sleep(400); // past the 300 ms guard
  await run.s.flush();
  return run;
}

/** Settles the frames that follow a mouse report. */
async function settle(s: PtySession): Promise<void> {
  await Bun.sleep(250);
  await s.flush();
}

for (const [name, opts] of TERMINALS) {
  // Skipped on Windows: it needs the terminal's OSC 10/11 colour replies (derived surfaces, light theme), which ConPTY never passes on (it passes only OSC 4).
  describe.skipIf(WINDOWS)(`a click on a permission option (task 12.5), ${name}`, () => {
    test("press and release on `3 reject once`: the answer row has focus with that option selected, and nothing in the card is painted", async () => {
      const run = await openCard(opts);
      expect(selectedOptions(run.s)).toEqual([]);
      const before = cardCells(run.s);
      const option = optionAt(run.s, "3 reject once");
      const x = option.x + 4;
      run.s.mousePress(x, option.y);
      run.s.mouseRelease(x, option.y);
      await run.s.waitFor((p) => !previewFocused(p), 3000);
      await settle(run.s);

      expect(selectedOptions(run.s)).toEqual(["3 reject once"]);
      // Every card cell keeps its fill except the selected option's (the bottom border's range
      // changes colour, not fill); none is inverse.
      const after = cardCells(run.s);
      const selectedRow = option.y - cardTop(run.s);
      for (let i = 0; i < after.length; i++) {
        if (i !== selectedRow) {
          expect(after[i]).toBe(before[i]!);
          continue;
        }
        const cells = after[i]!.split(" ");
        const was = before[i]!.split(" ");
        for (let c = 0; c < SIZE.cols; c++) {
          const inOption = c >= option.x && c < option.x + option.width;
          expect(cells[c]).toBe(inOption ? SURFACES["surface.permission.selected"] : was[c]!);
        }
      }
      expect(responses(run)).toEqual([]);

      // Enter answers with the clicked option.
      run.s.sendKeys("Enter");
      await run.s.waitFor(() => responses(run).length === 1, 5000);
      expect(responses(run).map((e) => e.params)).toEqual([{ outcome: { outcome: "selected", optionId: "reject-once" } }]);
    }, 30000);

    test("a drag that starts on the card, over the preview and into the conversation, selects nothing and paints nothing", async () => {
      const run = await openCard(opts);
      const option = optionAt(run.s, "2 allow always");
      run.s.mousePress(option.x + 2, option.y);
      await run.s.waitFor((p) => selectedOptions(p).join() === "2 allow always", 3000);
      await settle(run.s);
      const card = cardCells(run.s);
      const top = cardTop(run.s);
      const conversation = run.s.screenText().findIndex((r) => r.trim() === "go");
      expect(conversation).toBeGreaterThanOrEqual(0);
      expect(conversation).toBeLessThan(top);

      // One cell to the right, up over the preview and the title, then up into the conversation.
      run.s.mouseMove(option.x + 3, option.y, "left");
      for (let y = option.y - 1; y > top; y--) run.s.mouseMove(option.x + 12, y, "left");
      run.s.mouseMove(option.x + 20, top, "left");
      for (let y = top - 1; y >= conversation; y--) run.s.mouseMove(SIZE.cols - 20, y, "left");
      await settle(run.s);
      // While the button is still held: nothing painted.
      expect(cardCells(run.s)).toEqual(card);
      expect(paintedAbove(run.s)).toEqual([]);

      run.s.mouseRelease(SIZE.cols - 20, conversation);
      await settle(run.s);
      expect(cardCells(run.s)).toEqual(card);
      expect(paintedAbove(run.s)).toEqual([]);
      // Nothing was selected, so nothing was copied on release; the request is still open, with
      // the pressed option selected.
      expect(run.events("clipboard")).toEqual([]);
      expect(selectedOptions(run.s)).toEqual(["2 allow always"]);
      expect(responses(run)).toEqual([]);
    }, 30000);
  });
}
