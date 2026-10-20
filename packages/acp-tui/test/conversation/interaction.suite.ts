// Collapse and expand, the conversation cursor, scrolling and following, and
// the reading position (phase-1a tasks 7.3 to 7.6; spec tui-conversation
// "Collapse and expand in place", "Conversation cursor", "Scrolling and
// following", "Reading position kept") through the real CLI against
// fake-agent under the PTY harness. Focus enters the conversation with Tab
// (the prompt box's next stop, spec tui-keymap "Focus cycle"). Under the flat
// theme (no colour replies) the cursor is the inverse-video gutter; with
// colours it is a `▎` bar in `surface.cursor`'s colour over `surface.cursor.faint` (review C5).
//
// The suite runs against the windowed list (interaction.pty.test.ts).
import { afterEach, describe, expect, test } from "bun:test";
import { deriveSurfaces } from "../../src/theme/index.ts";
import type { OscColours, PtySession } from "../pty/harness.ts";
import { activityRow, CARD_HEADER, INTERRUPT_ARMED, lineWithoutBar, promptBox, promptText, READY, screenGap, statusRow, withoutBar } from "../pty/regions.ts";
import { configEnv } from "../pty/config-home.ts";
import { answerPermission, sendPrompt, settle, startCli, type CliRun, type StartOptions } from "./cli.ts";

export interface SuiteOptions {
  /** Items the cursor moves up (from the end of 200 long-session items) before the resize and
   *  toggle tests look for a tool line at the top; the list groups runs, so it has fewer entries
   *  (about 150) and needs smaller counts to stay clear of the first one. */
  readonly back?: { readonly resize: number; readonly toggle: number };
}

/** Defines the suite. */
export function interactionSuite(options: SuiteOptions = {}): void {
  const back = options.back ?? { resize: 160, toggle: 100 };
  const start = (options: StartOptions): CliRun => startCli(options);

  let run: CliRun | undefined;
  afterEach(async () => {
    run?.session.kill("SIGTERM");
    await run?.session.dispose();
    run = undefined;
  });

  const DARK = { foreground: "#bcbec4", background: "#191a1c" } satisfies OscColours;
  const TOOL_LINE = /#\d+$/;
  /** The conversation's first screen row, below the one-row top margin (mvp-chrome-and-keys task
   *  4.1). */
  const TOP = 1;

  /** The rows above the activity bar, card or prompt box, less the screen's blank row above them
   *  (day-one-feedback task group 13). */
  function conversationRows(s: PtySession): string[] {
    const lines = withoutBar(s.screenText());
    const activity = activityRow(s);
    let end = lines.findIndex((l) => l.startsWith("╭") || (activity !== null && l === activity));
    if (end < 0) return lines;
    // The activity bar's line keeps its row for the whole session (day-two-feedback task 13.2):
    // blank, or a lingering call, above a card or the prompt box.
    if (!(activity !== null && lines[end] === activity)) end--;
    if (screenGap(s, end - 1)) end--;
    return lines.slice(0, end);
  }

  function bgAt(s: PtySession, y: number, x: number): string {
    const cell = s.cell(y, x)!;
    if (cell.isBgDefault()) return "default";
    if (cell.isBgPalette()) return `palette:${cell.getBgColor()}`;
    return `#${cell.getBgColor().toString(16).padStart(6, "0")}`;
  }

  /** The colour of the cursor's bar when column 0 of row `y` holds it (`▎`), else null. */
  function barAt(s: PtySession, y: number): string | null {
    const cell = s.cell(y, 0)!;
    if (cell.getChars() !== "▎" || !cell.isFgRGB()) return null;
    return `#${cell.getFgColor().toString(16).padStart(6, "0")}`;
  }

  /** The row of the cursor under the flat theme: its gutter is in inverse video. */
  function cursorRow(s: PtySession): number {
    return conversationRows(s).findIndex((_, y) => s.cell(y, 0)!.isInverse() !== 0);
  }

  /** Waits until the screen stops changing after `keys`. */
  async function press(s: PtySession, ...keys: Parameters<PtySession["sendKeys"]>): Promise<void> {
    s.sendKeys(...keys);
    await settle(s, 60);
  }

  function settleRepaints(r: CliRun): number {
    return r.events("repaint").filter((e) => e["cause"] === "settle").length;
  }

  async function resizeAndSettle(r: CliRun, cols: number, rows: number): Promise<void> {
    const before = settleRepaints(r);
    r.session.resize(cols, rows);
    await r.session.waitFor(() => settleRepaints(r) > before, 5000);
    await settle(r.session);
  }

  describe("collapse and expand (task 7.3)", () => {
    test("Ctrl+O targets the permission request: #1 (behind the request) expands and shows, not the latest #2", async () => {
      // Delay scale 20: the tools stay running while the card is open.
      run = start({ scenario: "viewer", delayScale: 20 });
      const s = run.session;
      await sendPrompt(s, "viewer");
      await s.waitFor(CARD_HEADER, 10000);
      // The card took focus (the prompt box was empty), and there Ctrl+O grows it
      // (mvp-chrome-and-keys task 5.1), whose preview shows the same output: Esc returns to the
      // prompt box first (arming interrupt, which Ctrl+O disarms), and the conversation's rows
      // are read, never the card's.
      s.sendKeys("Esc");
      await settle(s, 60);
      s.sendKeys("Ctrl+O");
      await s.waitFor((p) => conversationRows(p).some((r) => r.includes("earlier tool output line 1")), 5000);
      const rows = conversationRows(s);
      const one = rows.findIndex((r) => /Run earlier check .*#1$/.test(r));
      expect(one).toBeGreaterThanOrEqual(0);
      // mvp-rendering (tasks 9.1, 9.2; review C13 and C14): the title fits on the line, so the card
      // is a padding row, the output rendered as Markdown (its two lines are one paragraph) and a
      // padding row.
      expect(rows[one + 1]).toMatch(/^ {2}┃$/);
      // The card's rule, then two columns of padding (`cards.padding.columns`, day-one-feedback).
      expect(rows[one + 2]).toMatch(/^ {2}┃ {2}earlier tool output line 1 earlier tool output line 2$/);
      expect(rows[one + 3]).toMatch(/^ {2}┃$/);
      expect(rows[one + 4]).toMatch(/Read later file .*#2$/);
      // Ctrl+O again collapses it.
      s.sendKeys("Ctrl+O");
      await s.waitFor((p) => !conversationRows(p).join("\n").includes("earlier tool output"), 5000);
      expect(run.agentMethods().filter((m) => m === "session/prompt")).toHaveLength(1);
    }, 30000);

    test("Diff in an expanded card: a unified diff with `-` and `+` signs and line numbers", async () => {
      run = start({ scenario: "basic" });
      const s = run.session;
      await sendPrompt(s, "diff");
      await answerPermission(s, "1");
      await s.waitFor(/end turn/, 10000);
      await settle(s);
      // The latest tool call is #2, the edit.
      s.sendKeys("Ctrl+O");
      await s.waitFor("@@ -5,6 +5,15 @@", 5000);
      const rows = conversationRows(s);
      const header = rows.findIndex((r) => /← ✓ edit .*#2$/.test(r));
      // mvp-rendering (task 9.1; review C13 and C14): the title fits on the line, so the card
      // starts with its padding row and then the diff.
      expect(rows[header + 1]).toBe("  ┃");
      expect(rows.slice(header + 2, header + 9)).toEqual([
        "  ┃  /work/src/index.ts",
        "  ┃  @@ -5,6 +5,15 @@",
        "  ┃   5   line 5",
        "  ┃   6   line 6",
        "  ┃   7   line 7",
        "  ┃   8 - line 8",
        "  ┃   9 - line 9",
      ]);
      expect(rows).toContain("  ┃   8 + new line 1");
      expect(rows).toContain("  ┃  19 + new line 12");
    }, 30000);

    test("Failure expands, the user's collapse wins across a resize: in verbose, where every call is expanded", async () => {
      // Tall enough for the whole 60-line diff and its header.
      run = start({ scenario: "permission-diff", rows: 90, env: configEnv({ density: "verbose" }) });
      const s = run.session;
      await sendPrompt(s, "fail it");
      await s.waitFor(CARD_HEADER, 10000);
      await Bun.sleep(450);
      // reject_once: the tool call fails; in verbose it is expanded, as every call is.
      s.sendKeys("3", "Enter");
      await s.waitFor(/end turn/, 10000);
      await settle(s);
      const failed = () => conversationRows(s).findIndex((r) => /✗ edit .*#1$/.test(r));
      expect(failed()).toBeGreaterThanOrEqual(0);
      // The card's top padding row, then its content.
      expect(conversationRows(s)[failed() + 1]).toBe("  ┃");
      expect(conversationRows(s)[failed() + 2]).toMatch(/^ {2}┃ /);
      expect(s.screenText().join("\n")).toContain("@@ ");
      // The user collapses it (Ctrl+O: the latest tool call), then the terminal is resized.
      s.sendKeys("Ctrl+O");
      await s.waitFor((p) => !p.screenText().join("\n").includes("@@ "), 5000);
      await resizeAndSettle(run, 63, 21);
      expect(failed()).toBeGreaterThanOrEqual(0);
      expect(s.screenText().join("\n")).not.toContain("@@ ");
      expect(conversationRows(s)[failed() + 1] ?? "").not.toMatch(/┃/);
    }, 30000);

    test("Failure stays collapsed, the user's expansion wins across a resize: in compact, a failed call keeps its own line", async () => {
      // Tall enough for the whole 60-line diff and its header.
      run = start({ scenario: "permission-diff", rows: 90 });
      const s = run.session;
      await sendPrompt(s, "fail it");
      await s.waitFor(CARD_HEADER, 10000);
      await Bun.sleep(450);
      // reject_once: the tool call fails, and nothing expands it (Marcus, 14 October 2026).
      s.sendKeys("3", "Enter");
      await s.waitFor(/end turn/, 10000);
      await settle(s);
      const failed = () => conversationRows(s).findIndex((r) => /✗ edit .*#1$/.test(r));
      expect(failed()).toBeGreaterThanOrEqual(0);
      expect(s.screenText().join("\n")).not.toContain("@@ ");
      expect(conversationRows(s)[failed() + 1] ?? "").not.toMatch(/┃/);
      // The user expands it (Ctrl+O: the latest tool call), then the terminal is resized.
      s.sendKeys("Ctrl+O");
      await s.waitFor((p) => p.screenText().join("\n").includes("@@ "), 5000);
      await resizeAndSettle(run, 63, 21);
      // Still expanded: the following view shows the end of its diff.
      expect(s.screenText().join("\n")).toMatch(/┃ +\d+ +unchanged tail line/);
    }, 30000);

    test("No tool calls: Ctrl+O shows a notice and the conversation is unchanged", async () => {
      run = start({ scenario: "prompt-error" });
      const s = run.session;
      await sendPrompt(s, "no tools");
      await s.waitFor(/error: /, 10000);
      await settle(s);
      const before = conversationRows(s);
      s.sendKeys("Ctrl+O");
      await s.waitFor("no tool call to show", 5000);
      expect(conversationRows(s)).toEqual(before);
    }, 30000);
  });

  describe("conversation cursor (task 7.4)", () => {
    test("Keyboard toggle of an older item: Tab, up five items onto a collapsed tool call, Enter", async () => {
      run = start({ scenario: "five-tools", colours: DARK });
      const s = run.session;
      await sendPrompt(s, "five tools");
      await s.waitFor(/end turn/, 10000);
      await settle(s);
      // The cursor (review C5): a `▎` bar in surface.cursor's colour in column 0 of every row of the
      // item, over the faint surface.cursor.faint fill.
      const surfaces = deriveSurfaces(DARK);
      const highlighted = () => conversationRows(s).flatMap((row, y) => (barAt(s, y) === surfaces["surface.cursor"] ? [row] : []));
      expect(highlighted()).toEqual([]);

      // The cursor starts on the last item, the turn end.
      await press(s, "Tab");
      expect(highlighted()).toEqual([expect.stringMatching(/^▎ end turn/)]);
      for (let i = 0; i < 5; i++) await press(s, "Up");
      expect(highlighted()).toEqual([expect.stringMatching(/^▎ \$ ✓ execute {2}Run check 1 +#1$/)]);
      const header = conversationRows(s).findIndex((r) => /Run check 1 +#1$/.test(r));
      expect(bgAt(s, header, 0)).toBe(surfaces["surface.cursor.faint"]);
      expect(bgAt(s, header, 5)).toBe(surfaces["surface.cursor.faint"]);

      await press(s, "Enter");
      const rows = conversationRows(s);
      const one = rows.findIndex((r) => /Run check 1 +#1$/.test(r));
      // Expanded on the card fill; the cursor stays on it, its bar beside the card's rows too.
      // mvp-rendering (task 9.1; review C13 and C14): the title fits on the line, so a padding row,
      // the output, a padding row.
      expect(rows[one + 1]).toBe("▎");
      expect(rows[one + 2]).toBe("▎   check 1 passed");
      expect(rows[one + 3]).toBe("▎");
      expect(bgAt(s, one + 1, 5)).toBe(surfaces["surface.card"]);
      expect(bgAt(s, one + 1, 1)).toBe(surfaces["surface.cursor.faint"]);
      expect(highlighted()).toEqual([expect.stringMatching(/Run check 1 +#1$/), "▎", "▎   check 1 passed", "▎"]);
      // Nothing was sent to the agent, and the prompt box is untouched.
      expect(run.agentMethods().filter((m) => m === "session/prompt")).toHaveLength(1);
      expect(promptText(s)).toEqual([""]);

      // Leaving the conversation hides the highlight; the next visit finds the cursor where it was.
      await press(s, "Esc");
      expect(highlighted()).toEqual([]);
      await press(s, "Tab");
      expect(highlighted()).toEqual([expect.stringMatching(/Run check 1 +#1$/), "▎", "▎   check 1 passed", "▎"]);
    }, 30000);
  });

  describe("scrolling and following (task 7.5)", () => {
    const percent = (s: PtySession) => Number(/scrolled (\d+)%/.exec(statusRow(s))?.[1] ?? NaN);

    test("Streaming while scrolled up, then Back to following with PgDn", async () => {
      // Delay scale 5: 400 characters a second, about fifteen rows at this width.
      run = start({ scenario: "stream-long", delayScale: 5, cols: 63, rows: 21 });
      const s = run.session;
      await sendPrompt(s, "stream");
      await s.waitFor(/Section 4:/, 15000);
      s.sendKeys("PageUp", "PageUp");
      await s.waitFor((p) => /scrolled \d+%/.test(statusRow(p)), 5000);
      await s.flush();
      const top = conversationRows(s).slice(0, 5);
      const at = percent(s);
      // New text arrives below (the share above the bottom of the view falls), the view stays.
      await s.waitFor((p) => percent(p) < at - 5, 10000);
      await s.flush();
      expect(conversationRows(s).slice(0, 5)).toEqual(top);
      expect(s.screenText().join("\n")).not.toContain("Section 1:");
      // The answer grows in place: no entry was added below, so no indicator.
      expect(promptBox(s)[0]).not.toContain("↓");

      // PgDn until the last row is visible: following again, and new text moves the view.
      for (let i = 0; i < 200 && /scrolled/.test(statusRow(s)); i++) {
        s.sendKeys("PageDown");
        await Bun.sleep(20);
        await s.flush();
      }
      expect(statusRow(s)).not.toMatch(/scrolled/);
      const last = conversationRows(s).at(-1);
      await s.waitFor((p) => conversationRows(p).at(-1) !== last, 5000);
      await Bun.sleep(300);
      await s.flush();
      expect(statusRow(s)).not.toMatch(/scrolled/);
      expect(s.term.buffer.active.type).toBe("alternate");
    }, 60000);

    // Not in the spec: sending a prompt is a return to the live end, as in OpenCode and most
    // chat UIs (S7 run D3: the new turn ran out of view while the reader was scrolled up).
    test("Sending a prompt while scrolled up jumps to the bottom and follows the new turn", async () => {
      // Delay scale 10: 200 characters a second, about seven rows, so the second answer is still
      // short when the new message is checked.
      run = start({ scenario: "stream-long", delayScale: 10, cols: 63, rows: 21 });
      const s = run.session;
      await sendPrompt(s, "stream");
      await s.waitFor(/Section 3:/, 20000);
      // The double Esc interrupts: the second press must come within the armed window
      // (EXIT_WINDOW_MS, 2 s), so it follows the armed state on the status row rather than a
      // settled screen, which never comes while the answer streams and the busy indicator moves
      // (`settle` then gives up after 40 polls of 60 ms, 2.4 s, and the second Esc armed again).
      s.sendKeys("Esc");
      await s.waitFor((p) => statusRow(p).includes(INTERRUPT_ARMED), 5000);
      s.sendKeys("Esc");
      await s.waitFor(() => run!.agentMethods().includes("session/cancel"), 5000);
      await s.waitFor(READY, 10000);
      await settle(s);

      s.sendKeys("PageUp", "PageUp");
      await s.waitFor((p) => /scrolled \d+%/.test(statusRow(p)), 5000);
      await s.flush();
      const text = "second question please";
      s.sendKeys({ text });
      await s.waitFor((p) => (promptText(p)[0] ?? "").startsWith(text), 5000);
      s.sendKeys("Enter");

      // The user's message is on screen (it only can be at the bottom), and following resumed.
      await s.waitFor((p) => conversationRows(p).some((l) => l.includes(text)), 5000);
      expect(statusRow(s)).not.toMatch(/scrolled/);
      expect(promptBox(s)[0]).not.toContain("↓");
      // The new answer's first lines arrive below it and the view keeps following them.
      await s.waitFor((p) => conversationRows(p).filter((l) => l.includes("Section")).length > 0 && !/scrolled/.test(statusRow(p)), 10000);
      expect(statusRow(s)).not.toMatch(/scrolled/);
    }, 60000);
  });

  describe("reading position kept (task 7.6)", () => {
    /** Tab into the conversation, then Up until the top row is a tool line under the cursor, about
     *  `back` items from the end (moving up, each item comes into view at the top row). */
    async function toolAtTop(s: PtySession, back: number): Promise<string> {
      await press(s, "Tab");
      for (let i = 0; i < back; i++) s.sendKeys("Up");
      await settle(s);
      for (let i = 0; i < 40 && !(TOOL_LINE.test(lineWithoutBar(s, TOP)) && cursorRow(s) === TOP); i++) await press(s, "Up");
      expect(cursorRow(s)).toBe(TOP);
      const index = TOOL_LINE.exec(lineWithoutBar(s, TOP))?.[0];
      expect(index).toBeDefined();
      return index!;
    }

    test("Resize while scrolled up: 100x30 to 63x21 keeps the top item (about item 40 of 200)", async () => {
      run = start({ scenario: "long-session", cols: 100, rows: 30 });
      const s = run.session;
      await sendPrompt(s, "history");
      await s.waitFor(/end turn/, 20000);
      await settle(s);
      const index = await toolAtTop(s, back.resize);
      expect(statusRow(s)).toMatch(/scrolled/);
      await resizeAndSettle(run, 63, 21);
      expect(lineWithoutBar(s, TOP)).toMatch(new RegExp(`${index}$`));
      // The width less the right margin and the scroll bar (spec tui-layout "Conversation right margin").
      expect(lineWithoutBar(s, TOP)).toHaveLength(60);
    }, 60000);

    test("Resize while following: 63x21 to 120x40 keeps the last row directly above the chrome", async () => {
      run = start({ scenario: "long-session", cols: 63, rows: 21 });
      const s = run.session;
      await sendPrompt(s, "history");
      await s.waitFor(/end turn/, 20000);
      await settle(s);
      expect(conversationRows(s).at(-1)).toMatch(/^ {2}end turn · /);
      await resizeAndSettle(run, 120, 40);
      const rows = s.screenText();
      const prompt = rows.findIndex((r) => r.startsWith("╭"));
      // The prompt box (three text rows and the padding row), the spacer, the status row and the bottom margin below it.
      expect(prompt).toBe(31);
      // The activity bar's blank line and the blank row above it (day-two-feedback task 13.2).
      expect(rows[prompt - 1]).toBe("");
      expect(rows[prompt - 2]).toBe("");
      expect(rows[prompt - 3]).toMatch(/^ {2}end turn · /);
    }, 60000);

    test("a toggle keeps the item's first row on the same screen row, expanding and collapsing", async () => {
      // 34 rows: with the code blocks' padding rows (day-one-feedback task group 13) a 30-row pane
      // can hold a single tool line among long answers, which the search below cannot leave room under.
      run = start({ scenario: "long-session", cols: 100, rows: 34 });
      const s = run.session;
      await sendPrompt(s, "history");
      await s.waitFor(/end turn/, 20000);
      await settle(s);
      await toolAtTop(s, back.toggle);
      // Down onto a collapsed tool call in the middle of the view (moving down reveals new items on
      // the last row, so if none is found, back up through the rows now on screen).
      for (let i = 0; i < 65; i++) {
        await press(s, i < 40 ? "Down" : "Up");
        const y = cursorRow(s);
        // Not on the last row, so the expanded card's first row shows below the line.
        if (y >= 5 && y < conversationRows(s).length - 1 && TOOL_LINE.test(lineWithoutBar(s, y)) && !/^ {2}┃/.test(lineWithoutBar(s, y + 1))) break;
      }
      const y = cursorRow(s);
      expect(y).toBeGreaterThanOrEqual(5);
      const line = lineWithoutBar(s, y);
      expect(line).toMatch(TOOL_LINE);

      await press(s, "Enter");
      expect(lineWithoutBar(s, y + 1)).toMatch(/^ {2}┃/);
      expect(lineWithoutBar(s, y)).toBe(line);
      await press(s, "Enter");
      expect(lineWithoutBar(s, y + 1)).not.toMatch(/^ {2}┃/);
      expect(lineWithoutBar(s, y)).toBe(line);
      expect(run.agentMethods().filter((m) => m === "session/prompt")).toHaveLength(1);
    }, 60000);

    test("the reader's position survives a new layout of the list: PgUp from the prompt box, then expanding the latest tool call off screen scrolls it into view", async () => {
      run = start({ scenario: "basic", cols: 80, rows: 20 });
      const s = run.session;
      await sendPrompt(s, "hello");
      await answerPermission(s, "1");
      await s.waitFor(/end turn/, 10000);
      await s.waitFor(READY, 5000);
      await settle(s);
      s.sendKeys("PageUp", "PageUp");
      await s.waitFor((p) => /scrolled/.test(statusRow(p)), 5000);
      await settle(s);
      expect(s.screenText().join("\n")).not.toMatch(/#2$/m);
      s.sendKeys("Ctrl+O");
      await s.waitFor("@@ -5,6 +5,15 @@", 5000);
      await settle(s);
      // The expanded edit is in view, its first row included.
      expect(conversationRows(s).some((r) => /← ✓ edit .*#2$/.test(r))).toBe(true);
    }, 30000);
  });
}
