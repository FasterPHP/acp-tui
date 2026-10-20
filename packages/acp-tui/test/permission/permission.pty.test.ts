// Tasks 6.5 and 6.6 verification (spec tui-layout "Permission card",
// "Permission card focus and typing guard"; spec tui-agent-session
// "Permission requests"): the real CLI against fake-agent under the PTY
// harness at 63x21, PhpStorm reworked's pane size. The docked card's fill,
// frame and marker, three options on one row and four stacked, the bidi title,
// agent text imitating the card, typing ahead within 300 ms, focus with a
// draft, and Esc with the card open. The answer the agent received is read
// from fake-agent's --log.
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { deriveSurfaces } from "../../src/theme/index.ts";
import type { OscColours, PtySession } from "../pty/harness.ts";
import { activityRow, CARD_HEADER, cardBody, cardRows, promptText, READY, REQUIRES_ACTION, statusRow } from "../pty/regions.ts";

import { startCli, type CliRun } from "../keys/cli-pty.ts";

// The fixture is imported by a computed path: acp-tui does not depend on the fake-agent package.
const { CARD_IMITATION_TEXT } = (await import(join(import.meta.dir, "../../../fake-agent/src/hostile.ts"))) as { CARD_IMITATION_TEXT: string };

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

const SIZE = { cols: 63, rows: 21 };
const DARK = { foreground: "#bcbec4", background: "#191a1c" } satisfies OscColours;
const PERMISSION_FG = 3; // the `permission` token: ANSI yellow
const ACCENT_FG = 4; // the `accent` token: ANSI blue
const MUTED_FG = 8; // the `muted` token: ANSI bright black

/** The card imitation `hostile` sends, as its four lines; the real card's header starts like the first. */
const IMITATION = CARD_IMITATION_TEXT.trimEnd().split("\n");
/** Characters only the imitation draws in the conversation: its frame corners and marker. */
const IMITATION_GLYPHS = ["◊", "╭", "╮", "╰", "╯"];
const HEADER_PREFIX = IMITATION[0]!.slice(0, IMITATION[0]!.indexOf("#1 ") + 3);

const responses = (run: CliRun) => run.entries().filter((e) => e.method === "session/request_permission/response").map((e) => e.params);

async function openCard(run: CliRun, delayScale = 0) {
  await run.s.waitFor(READY, 10000);
  run.s.sendKeys({ text: "go" }, "Enter");
  if (delayScale === 0) await run.s.waitFor(CARD_HEADER, 5000);
}

/** Past the 300 ms guard. */
const afterGuard = () => Bun.sleep(400);

/** The prompt box frame's colour: accent while it has focus, muted otherwise. */
const promptFrameOf = (s: PtySession) => {
  const rows = s.screenText();
  let y = rows.length - 1;
  while (y > 0 && !rows[y]!.startsWith("╰")) y--;
  return s.cell(s.term.buffer.active.baseY + y, 0)?.getFgColor();
};
const promptFrame = promptFrameOf;

/** Whether the card has focus: its option numbers are in the accent colour (muted without it). */
function cardFocused(s: PtySession): boolean {
  const rows = s.screenText();
  const top = rows.findIndex((r) => r.includes(CARD_HEADER));
  if (top < 0) return false;
  for (let y = top + 1; y < rows.length && !rows[y]!.startsWith("╰"); y++) {
    const x = rows[y]!.indexOf("1 allow once");
    if (x >= 0) return s.cell(s.term.buffer.active.baseY + y, x)?.getFgColor() === ACCENT_FG;
  }
  return false;
}

function bgHex(s: PtySession, y: number, x: number): string {
  const cell = s.cell(s.term.buffer.active.baseY + y, x)!;
  if (cell.isBgDefault()) return "default";
  return `#${cell.getBgColor().toString(16).padStart(6, "0")}`;
}

/** Screen row index of `text` (first match), or -1. */
const rowOf = (s: PtySession, text: string) => s.screenText().findIndex((r) => r.includes(text));

describe("permission card (task 6.5)", () => {
  test("three options on one row at 63 columns; filled edge to edge, warning frame and marker; focus on the card", async () => {
    const run = startCli("basic", 0, { ...SIZE, colours: DARK, env: { COLORTERM: "truecolor" } });
    session = run.s;
    await openCard(run);
    // The cards' padding inside the frame: a padding row at the top and the bottom, two columns at
    // each side (day-one-feedback task group 13).
    expect(cardRows(run.s)).toEqual([
      `╭─ ◊ Permission  edit  #2 ${"─".repeat(36)}╮`,
      `│${" ".repeat(61)}│`,
      `│  Edit src/index.ts${" ".repeat(40)}  │`,
      `│  1 allow once   2 allow always   3 reject once${" ".repeat(12)}  │`,
      `│${" ".repeat(61)}│`,
      `╰${"─".repeat(61)}╯`,
    ]);
    // Docked between the activity bar and the prompt box: card rows 9 to 14 at rest, above the
    // one-row prompt box and its padding row (rows 15 to 18), the spacer, the status row and the bottom margin
    // (mvp-chrome-and-keys tasks 4.1 and 4.2). At 63x21 the blank row between the card and the
    // prompt box, the first to give way, has given way; the blank rows above the card and above
    // the activity line are drawn (spec tui-layout "Spacing gives way before content").
    const top = rowOf(run.s, CARD_HEADER);
    expect(top).toBe(8);
    expect(run.s.screenText()[top - 1]).toBe("");
    expect(run.s.screenText()[top - 2]).toBe("  2 running: Edit src/index.ts · awaiting permission");
    expect(activityRow(run.s)).toBe("  2 running: Edit src/index.ts · awaiting permission");
    expect(run.s.screenText()[top + 6]).toStartWith("╭");

    // The fill covers every cell of every card row; the frame and marker use the warning colour.
    const fill = deriveSurfaces(DARK)["surface.permission"];
    const selected = deriveSurfaces(DARK)["surface.permission.selected"];
    for (let y = top; y < top + 6; y++) {
      for (let x = 0; x < 63; x++) {
        const bg = bgHex(run.s, y, x);
        // Option 1 is selected (focus is on the card): its cells carry the selection surface.
        expect(bg === fill || (y === top + 3 && x >= 3 && x < 15 && bg === selected)).toBe(true);
      }
    }
    expect(bgHex(run.s, top + 3, 3)).toBe(selected);
    const at = (y: number, x: number) => run.s.cell(run.s.term.buffer.active.baseY + y, x)!;
    expect(at(top, 0).getFgColor()).toBe(PERMISSION_FG);
    expect(at(top, 3).getChars()).toBe("◊");
    expect(at(top, 3).getFgColor()).toBe(PERMISSION_FG);
    expect(at(top + 1, 0).getFgColor()).toBe(PERMISSION_FG);
    // Outside the card the terminal's own background shows.
    expect(bgHex(run.s, top - 2, 5)).toBe("default");

    // The prompt box was empty, so focus moved to the card: the prompt box's frame is muted.
    // (Its bottom border is row 18.)
    expect(at(17, 0).getFgColor()).toBe(MUTED_FG);

    // Digit then Enter (decision 1 by Marcus): 3 selects reject once, Enter answers.
    await afterGuard();
    run.s.sendKeys("3");
    await run.s.waitFor(() => bgHex(run.s, top + 3, 35) === selected, 5000);
    expect(responses(run)).toEqual([]);
    run.s.sendKeys("Enter");
    await run.s.waitFor(() => responses(run).length === 1, 5000);
    expect(responses(run)).toEqual([{ outcome: { outcome: "selected", optionId: "reject-once" } }]);
    await run.s.waitFor(READY, 5000);
    expect(cardRows(run.s)).toEqual([]);
    // The prompt box (its bottom border on row 18) has focus again.
    expect(at(17, 0).getFgColor()).toBe(ACCENT_FG);
  }, 20000);

  test("four options stack when they do not fit (permission-diff), and the conversation keeps at least 4 rows", async () => {
    const run = startCli("permission-diff", 0, SIZE);
    session = run.s;
    await openCard(run);
    expect(cardBody(run.s)[0]).toBe("Edit src/Http/Router.php");
    expect(cardBody(run.s).slice(-4)).toEqual(["1 allow once", "2 allow always", "3 reject once", "4 reject always"]);
    // Above the card: the conversation's rows and the activity bar.
    const top = run.s.screenText().findIndex((r) => r.startsWith(`╭─ ${CARD_HEADER}`));
    expect(top - (activityRow(run.s) === null ? 0 : 1)).toBeGreaterThanOrEqual(4);
    // Focus is on the preview (its diff does not fit); Tab moves it to the answer row, where Left
    // and Right move the selection and Enter answers with it.
    await afterGuard();
    run.s.sendKeys("Tab", "Right", "Right", "Right", "Left", "Enter");
    await run.s.waitFor(() => responses(run).length === 1, 5000);
    expect(responses(run)).toEqual([{ outcome: { outcome: "selected", optionId: "reject-once" } }]);
  }, 20000);

  test("bidi title: U+202E and the zero-width space are absent from the card's body, in logical order", async () => {
    // fake-agent's BIDI_TOOL_TITLE is "run invoice‮exe.​pdf".
    const run = startCli("bidi-permission", 0, SIZE);
    session = run.s;
    await openCard(run);
    const [header, title] = cardRows(run.s);
    expect(header).toStartWith("╭─ ◊ Permission  execute  #1 ");
    expect(cardBody(run.s)[0]).toBe("run invoiceexe.pdf");
    expect(title).not.toContain("‮");
    expect(title).not.toContain("​");
    await afterGuard();
    run.s.sendKeys("2", "Enter");
    await run.s.waitFor(() => responses(run).length === 1, 5000);
    expect(responses(run)).toEqual([{ outcome: { outcome: "selected", optionId: "reject-once" } }]);
  }, 20000);

  test("imitation in the conversation: agent text drawn like the card stays behind the agent gutter, unfilled; the card region holds only the real card", async () => {
    // Delay scale 20: hostile pauses 2 s between the message (with the card imitation) and the
    // real request, so the imitation is seen with no request open.
    const run = startCli("hostile", 20, { cols: 63, rows: 40, colours: DARK, env: { COLORTERM: "truecolor" } });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "go" }, "Enter");
    // mvp-rendering: the imitation's lines are one paragraph with the hostile text before them,
    // re-wrapped to the pane (a soft break is a space), so it no longer even has the card's
    // shape; its rows are those that hold its frame or marker glyph.
    const imitationRows = () => {
      const screen = run.s.screenText();
      // The conversation ends where the bottom chrome (the docked card, if any, then the prompt
      // box) begins: the last row starting with a frame corner at column 0, or the card's header.
      const cardTop = screen.findIndex((r) => r.startsWith(`╭─ ${CARD_HEADER}`));
      let boxTop = screen.length;
      while (boxTop > 0 && !screen[boxTop - 1]!.startsWith("╭")) boxTop -= 1;
      boxTop -= 1;
      const end = cardTop >= 0 ? cardTop : boxTop;
      return screen
        .slice(0, end)
        .map((row, y) => ({ row, y }))
        .filter(({ row }) => IMITATION_GLYPHS.some((g) => row.includes(g)));
    };
    await run.s.waitFor(() => imitationRows().some(({ row }) => row.includes("◊")) && imitationRows().some(({ row }) => row.includes("╯")), 5000);
    await run.s.flush();

    // Behind the agent gutter, never at column 0, and no cell of its rows carries the permission
    // fill: the plain imitation is on the terminal's own background, the fenced one (task 1.5) on
    // the default background or, once code blocks are filled (task 8.4), on surface.code.
    const fill = deriveSurfaces(DARK)["surface.permission"];
    const selected = deriveSurfaces(DARK)["surface.permission.selected"];
    const check = () => {
      const rows = imitationRows();
      expect(rows.length).toBeGreaterThan(0);
      for (const { row, y } of rows) {
        expect(row.startsWith("  ")).toBe(true);
        for (let x = 0; x < 63; x++) expect([fill, selected]).not.toContain(bgHex(run.s, y, x));
      }
      return rows;
    };
    const first = check()[0]!.y;
    // No request is open yet: the docked card region is empty, and nothing on screen starts like a card.
    expect(cardRows(run.s)).toEqual([]);
    expect(run.s.screenText().filter((r) => r.startsWith("╭─ ◊"))).toEqual([]);
    expect(statusRow(run.s)).not.toMatch(REQUIRES_ACTION);
    expect(activityRow(run.s) ?? "").not.toContain("awaiting permission");

    // The real request arrives: one card region, docked below the conversation, unlike the imitation.
    await run.s.waitFor(() => cardRows(run.s).length > 0, 8000);
    await run.s.flush();
    const screen = run.s.screenText();
    expect(screen.filter((r) => r.startsWith(`╭─ ${CARD_HEADER}`))).toHaveLength(1);
    const card = cardRows(run.s);
    const cardTop = screen.findIndex((r) => r.startsWith(`╭─ ${CARD_HEADER}`));
    expect(screen[cardTop]).toStartWith(HEADER_PREFIX);
    expect(cardTop).toBeGreaterThan(first);
    // The imitation is still behind the gutter and unfilled, and the real card is filled edge to edge.
    check();
    for (let y = cardTop; y < cardTop + card.length; y++) {
      for (let x = 0; x < 63; x++) {
        const bg = bgHex(run.s, y, x);
        expect(bg === fill || bg === selected).toBe(true);
      }
    }

    await afterGuard();
    run.s.sendKeys("Enter");
    await run.s.waitFor(() => responses(run).length === 1, 5000);
    await run.s.waitFor(READY, 5000);
    // Answered: the docked card region is empty; the imitation is still just conversation rows.
    expect(cardRows(run.s)).toEqual([]);
    expect(run.s.screenText().filter((r) => r.startsWith("╭─ ◊"))).toEqual([]);
    check();
  }, 30000);
});

describe("permission card focus and typing guard (task 6.6)", () => {
  test("typing ahead does not answer: 1 then Enter within 300 ms neither select nor confirm", async () => {
    const run = startCli("basic", 0, SIZE);
    session = run.s;
    await openCard(run);
    const seenAt = Date.now();
    run.s.sendKeys("1", "Enter");
    await Bun.sleep(500);
    expect(responses(run)).toEqual([]);
    // The frame, its padding rows, the title and the options: still open.
    expect(cardRows(run.s).length).toBe(6);
    // Nothing reached the prompt box either.
    expect(promptText(run.s)).toEqual([""]);
    expect(Date.now() - seenAt).toBeGreaterThan(300);

  }, 20000);

  test("typing ahead: a digit inside the guard does not select (3 then Enter, then Enter answers option 1)", async () => {
    const run = startCli("basic", 0, SIZE);
    session = run.s;
    await openCard(run);
    run.s.sendKeys("3", "Enter");
    await Bun.sleep(500);
    expect(responses(run)).toEqual([]);
    run.s.sendKeys("Enter");
    await run.s.waitFor(() => responses(run).length === 1, 5000);
    expect(responses(run)).toEqual([{ outcome: { outcome: "selected", optionId: "allow-once" } }]);
  }, 20000);

  test("focus with a draft: the card flashes, keys (including 2 and Enter) edit the draft until Tab reaches the card", async () => {
    // delay-scale 100: about 2 s from the prompt being sent to the permission request.
    const run = startCli("basic", 100, SIZE);
    session = run.s;
    await openCard(run, 100);
    run.s.sendKeys({ text: "draft" });
    await run.s.waitFor((p) => promptText(p)[0] === "draft", 5000);
    await run.s.waitFor(CARD_HEADER, 10000);
    // The frame flashes in the accent colour before settling on the warning colour.
    const frameColour = () => {
      const y = rowOf(run.s, CARD_HEADER);
      return y < 0 ? -1 : run.s.cell(run.s.term.buffer.active.baseY + y, 0)?.getFgColor();
    };
    const seen = new Set<number | undefined>();
    const until = Date.now() + 1500;
    while (Date.now() < until) {
      await run.s.flush();
      seen.add(frameColour());
      await Bun.sleep(20);
    }
    expect(seen.has(ACCENT_FG)).toBe(true);
    expect(frameColour()).toBe(PERMISSION_FG);

    // Focus stayed in the prompt box: its frame is in the accent colour (muted while the card has it).
    const promptFrame = () => promptFrameOf(run.s);
    expect(promptFrame()).toBe(ACCENT_FG);
    run.s.sendKeys("2");
    await run.s.waitFor((p) => promptText(p)[0] === "draft2", 5000);
    await Bun.sleep(200);
    expect(responses(run)).toEqual([]);

    // Tab reaches the card through the conversation (spec tui-keymap "Focus cycle").
    run.s.sendKeys("Tab");
    await run.s.waitFor(() => promptFrame() === MUTED_FG, 5000);
    expect(cardFocused(run.s)).toBe(false);
    run.s.sendKeys("Tab");
    await run.s.waitFor(() => cardFocused(run.s), 5000);
    run.s.sendKeys("2", "Enter");
    await run.s.waitFor(() => responses(run).length === 1, 5000);
    expect(responses(run)).toEqual([{ outcome: { outcome: "selected", optionId: "allow-always" } }]);
    // Focus returns to the prompt box with the draft intact.
    await run.s.waitFor((p) => cardRows(p).length === 0, 5000);
    expect(promptText(run.s)[0]).toBe("draft2");
    expect(promptFrame()).toBe(ACCENT_FG);
  }, 30000);

  test("cancel with the card open: the first Esc returns to the prompt box and arms interrupt, the second answers cancelled, sends session/cancel and dismisses it", async () => {
    const run = startCli("basic", 0, SIZE);
    session = run.s;
    await openCard(run);
    // The card has focus (empty prompt box): the first Esc returns focus to the prompt box and arms
    // interrupt in the same press (mvp-chrome-and-keys task 3.4, design D6).
    await afterGuard();
    run.s.sendKeys("Esc");
    await run.s.waitFor(() => promptFrame(run.s) === ACCENT_FG && statusRow(run.s).includes("esc again to interrupt"), 5000);
    expect(run.methods()).not.toContain("session/cancel");
    run.s.sendKeys("Esc");
    await run.s.waitFor(() => run.methods().includes("session/cancel"), 5000);
    await run.s.waitFor(READY, 5000);
    expect(responses(run)).toEqual([{ outcome: { outcome: "cancelled" } }]);
    expect(cardRows(run.s)).toEqual([]);
  }, 20000);
});
