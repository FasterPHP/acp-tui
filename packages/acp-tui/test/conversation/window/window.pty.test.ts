// The windowed list (spike S3, task 12.3) through the real CLI against
// fake-agent's long-session: PgUp from the
// end reaches the first item, and every page moves the content by exactly a
// page (the height less two rows) while chunks mount above with their real
// heights, so the reading position never jumps; the mounted renderables stay
// bounded throughout. Home, End, the cursor far into unmounted entries and the
// wheel with the window on (the rest of the shell's behaviours are in
// interaction.pty.test.ts here).
import { afterEach, describe, expect, test } from "bun:test";
import { createSession, reduce, type Item, type ModelEvent } from "acp-model";
import { buildEntries } from "../../../src/conversation/window/entries.ts";
import { deriveSurfaces } from "../../../src/theme/index.ts";
import type { OscColours, PtySession } from "../../pty/harness.ts";
import { lineWithoutBar, screenGap, statusRow, withoutBar } from "../../pty/regions.ts";
import { sendPrompt, settle, startCli, type CliRun } from "../cli.ts";
import { longSessionEvents } from "./session.ts";
import { WINDOWS } from "../../windows.ts";

let run: CliRun | undefined;
afterEach(async () => {
  run?.session.kill("SIGTERM");
  await run?.session.dispose();
  run = undefined;
});

const FIRST = "scalebench-first-item";

/** The conversation's first screen row, below the top margin (mvp-chrome-and-keys task 4.1). */
const TOP = 1;

/** The conversation's rows: everything between the top margin and the prompt box. */
function conversationRows(s: PtySession): string[] {
  const lines = withoutBar(s.screenText());
  let end = lines.findIndex((l) => l.startsWith("╭"));
  // Less the activity bar's line, which keeps its row for the whole session (day-two-feedback
  // 13.2), and its blank row above it where that is drawn.
  if (end > 0) end--;
  if (end > 0 && screenGap(s, end - 1)) end--;
  return lines.slice(TOP, end < 0 ? lines.length : end);
}

describe("windowed list: PgUp from the end (task 12.3)", () => {
  test("reaches item 1; each page moves the content by the page step exactly; mounted stays bounded", async () => {
    run = startCli({ scenario: "long-session", cols: 100, rows: 30, agentArgs: ["--items", "600"] });
    const s = run.session;
    await sendPrompt(s, FIRST);
    await s.waitFor(/end turn/, 30000);
    await settle(s);
    const viewport = conversationRows(s).length;
    const step = viewport - 2;
    // 30 rows less the margins, the spacer, the status row, the prompt box at rest (6 rows: its
    // frame, three text rows and the padding row) and the activity bar's blank row and line.
    expect(viewport).toBe(18);

    let pages = 0;
    let compared = 0;
    let before = conversationRows(s);
    while (!conversationRows(s).some((r) => r.includes(FIRST)) && pages < 400) {
      s.sendKeys("PageUp");
      pages++;
      await s.waitFor((p) => conversationRows(p).join("\n") !== before.join("\n"), 5000);
      await settle(s, 40);
      const after = conversationRows(s);
      // Not yet at the top: the old top two rows are now the bottom two (the page step).
      if (!after.some((r) => r.includes(FIRST))) {
        expect(after.slice(step, step + 2)).toEqual(before.slice(0, 2));
        if (before.slice(0, 2).some((r) => r.trim() !== "")) compared++;
      }
      before = after;
    }
    // The first item, the prompt this test sent, is at the top of the conversation.
    // (below the user card's padding row)
    expect(conversationRows(s).findIndex((r) => r.includes(FIRST))).toBe(1);
    expect(statusRow(s)).toMatch(/scrolled 0%|scrolled \d%/);
    expect(pages).toBeGreaterThan(40);
    expect(compared).toBeGreaterThan(pages / 2);

    // Mounted renderables: sampled every 500 ms by the frame log; never near the unwindowed list's
    // (about 3200 at 500 items).
    const counts = run.events("mounted").map((e) => Number(e["count"]));
    expect(Math.max(...counts)).toBeLessThan(1500);
  }, 120000);

  test("Home, End, the cursor far into unmounted entries, and the wheel up and back down", async () => {
    run = startCli({ scenario: "long-session", cols: 100, rows: 30, agentArgs: ["--items", "600"] });
    const s = run.session;
    await sendPrompt(s, FIRST);
    await s.waitFor(/end turn/, 30000);
    await settle(s);
    const atEnd = conversationRows(s);
    // The cursor's gutter (column 0), or the cell beside a user card's accent (column 1), is in
    // inverse video under the flat theme.
    const cursorRow = () => conversationRows(s).findIndex((_, y) => s.cell(TOP + y, 0)!.isInverse() !== 0 || s.cell(TOP + y, 1)!.isInverse() !== 0);

    s.sendKeys("Tab");
    await settle(s, 60);
    expect(cursorRow()).toBe(atEnd.length - 1);
    // Home: the first item at the top, under the cursor (it was unmounted).
    s.sendKeys("Home");
    await s.waitFor((p) => conversationRows(p)[1]!.includes(FIRST), 5000);
    await settle(s, 60);
    // (the beside-the-bar cell is on the text row, below the padding row)
    expect(cursorRow()).toBe(1);
    // End: back to the bottom, following, the cursor on the last item.
    s.sendKeys("End");
    await s.waitFor((p) => !/scrolled/.test(statusRow(p)), 5000);
    await settle(s, 60);
    expect(conversationRows(s)).toEqual(atEnd);
    expect(cursorRow()).toBe(atEnd.length - 1);
    // 300 Ups in one burst: the cursor lands far above the mounted tail, which mounts around it;
    // moving up, it shows on the top row.
    for (let i = 0; i < 300; i++) s.sendKeys("Up");
    // Wait for the burst's outcome, not for a quiet screen: under load the CLI can pause mid-burst
    // for longer than `settle` waits, which then read the cursor on its way up.
    await s.waitFor((p) => cursorRow() === 0 && /scrolled \d+%/.test(statusRow(p)), 15000);
    expect(cursorRow()).toBe(0);
    expect(statusRow(s)).toMatch(/scrolled \d+%/);

    // The wheel from the prompt box: 100 notches up (3 rows each) and 100 down again.
    s.sendKeys("End", "Esc");
    await s.waitFor((p) => !/scrolled/.test(statusRow(p)), 5000);
    await settle(s, 60);
    const before = conversationRows(s);
    for (let i = 0; i < 100; i++) s.mouseWheel(50, 10, 64);
    await settle(s);
    expect(statusRow(s)).toMatch(/scrolled/);
    for (let i = 0; i < 100; i++) s.mouseWheel(50, 10, 65);
    await settle(s);
    expect(statusRow(s)).not.toMatch(/scrolled/);
    expect(conversationRows(s)).toEqual(before);
  }, 120000);
});

// The conversation cursor in a long session (mvp-conversation task 3.2; spec tui-conversation
// "Conversation cursor"), drawn with the truecolour theme so that its drawing is checked as the
// `surface.cursor` bar over the `surface.cursor.faint` fill (review C5).
describe("conversation cursor (task 3.2)", () => {
  const DARK = { foreground: "#bcbec4", background: "#191a1c" } satisfies OscColours;
  const CURSOR_BAR = deriveSurfaces(DARK)["surface.cursor"].toLowerCase();
  const CURSOR_BG = deriveSurfaces(DARK)["surface.cursor.faint"].toLowerCase();
  const bgOf = (s: PtySession, y: number, x: number): string => {
    const cell = s.cell(y, x)!;
    return cell.isBgDefault() ? "default" : cell.isBgPalette() ? `palette:${cell.getBgColor()}` : `#${cell.getBgColor().toString(16).padStart(6, "0")}`;
  };
  /** Whether column 0 of row `y` holds the cursor's `▎` bar in surface.cursor's colour. */
  const barAt = (s: PtySession, y: number): boolean => {
    const cell = s.cell(y, 0)!;
    return cell.getChars() === "▎" && cell.isFgRGB() && `#${cell.getFgColor().toString(16).padStart(6, "0")}` === CURSOR_BAR;
  };
  /** The rows the cursor marks: its bar in column 0, on the faint fill. */
  const cursorRows = (s: PtySession) =>
    conversationRows(s).flatMap((_, i) => {
      const y = TOP + i;
      return barAt(s, y) && bgOf(s, y, 0) === CURSOR_BG ? [y] : [];
    });

  async function open(items: number): Promise<PtySession> {
    run = startCli({ scenario: "long-session", cols: 100, rows: 30, colours: DARK, agentArgs: ["--items", String(items)] });
    const s = run.session;
    await sendPrompt(s, "go");
    await s.waitFor(/end turn/, 60000);
    await settle(s);
    return s;
  }

  function entries(items: number) {
    let session = createSession();
    // The scenario reports plans along the way; the turn commits the last one as an item before
    // the turn-end line, which `longSessionEvents` leaves out.
    const events = longSessionEvents(items);
    const end = events.pop()!;
    const plan = { sessionUpdate: "plan", entries: [{ content: "Write the test", priority: "medium", status: "pending" }] };
    events.push({ type: "session_update", at: 1_000_000, update: plan } as ModelEvent, end);
    for (const event of events) session = reduce(session, event);
    const lookup = (id: string) => session.items.get(id);
    return { lookup, list: buildEntries(session.order, lookup, { density: "compact", open: () => false }) };
  }

  // Scenario "Cursor far back in a long session".
  // Skipped on Windows: it needs the terminal's OSC 10/11 colour replies (derived surfaces, light theme), which ConPTY never passes on (it passes only OSC 4).
  test.skipIf(WINDOWS)("Cursor far back: 1000 items, the conversation focused, Up 150 times: the entry 150 above the last is under the cursor, in view, marked by the cursor's bar", async () => {
    const { lookup, list } = entries(1000);
    const target = list.keys[list.keys.length - 1 - 150]!;
    const item = lookup(target)!;
    const s = await open(1000);
    s.sendKeys("Tab");
    await settle(s, 60);
    expect(cursorRows(s).length).toBeGreaterThan(0);
    for (let i = 0; i < 150; i++) s.sendKeys("Up");
    await settle(s);
    const rows = cursorRows(s);
    expect(rows.length).toBeGreaterThan(0);
    // The highlighted entry is the target: a tool call by its index, a message by its first line.
    const shown = lineWithoutBar(s, rows[0]!).trim();
    if (item.kind === "tool_call") expect(shown).toMatch(new RegExp(`#${item.index}$`));
    else expect(shown).toContain((item as Extract<Item, { kind: "agent_message" }>).text.trim().split("\n")[0]!.trim().slice(0, 24));
    expect(rows).toEqual(Array.from({ length: rows.length }, (_, i) => rows[0]! + i));
    expect(statusRow(s)).toMatch(/scrolled \d+%/);
    expect(run!.events("console")).toEqual([]);
  }, 90000);

  // Scenario "Cursor on a group line".
  // Skipped on Windows: it needs the terminal's OSC 10/11 colour replies (derived surfaces, light theme), which ConPTY never passes on (it passes only OSC 4).
  test.skipIf(WINDOWS)("Cursor on a group line: the line is marked by the cursor's bar on its faint fill; Enter opens the group below it and the cursor stays on the line", async () => {
    const { list } = entries(200);
    expect(list.entries.filter((e) => e.kind === "group").length).toBeGreaterThan(3);
    const s = await open(200);
    s.sendKeys("Tab");
    await settle(s, 60);
    // Up to a group line far enough from the top to show its members below it.
    let y = -1;
    for (let i = 0; i < list.entries.length && y < 0; i++) {
      s.sendKeys("Up");
      await settle(s, 40);
      const rows = cursorRows(s);
      if (rows.length === 1 && /^▎ ▸ \d+ /.test(lineWithoutBar(s, rows[0]!)) && rows[0]! < 14) y = rows[0]!;
    }
    expect(y).toBeGreaterThanOrEqual(0);
    const line = lineWithoutBar(s, y);
    expect(cursorRows(s)).toEqual([y]);
    // The cell colours: the whole line is on the cursor's faint fill, the bar's cell included.
    // The right margin and the scroll bar's column are outside it (spec tui-layout "Conversation
    // right margin").
    expect(Array.from({ length: s.cols - 3 }, (_, x) => bgOf(s, y, x)).every((b) => b === CURSOR_BG)).toBe(true);

    s.sendKeys("Enter");
    await settle(s, 100);
    expect(lineWithoutBar(s, y)).toBe(line.replace("▸", "▾"));
    expect(cursorRows(s)).toEqual([y]);
    // Its members are listed below it, each on its own line.
    for (const row of conversationRows(s).slice(y + 1, y + 3)) expect(row).toMatch(/^ {2}[^\s▸▾]/);
  }, 90000);
});
