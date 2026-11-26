// The densities of the windowed list (spike S3, task 12.5) through the real CLI
// on fake-agent's long-session: `v`
// with the conversation focused cycles compact, verbose, focus and back to
// compact, a notice naming each; the reader's item (the cursor) stays on its
// screen row every time. Verbose expands every card and shows no group line;
// focus shows no tool line, only messages, markers and one line per gap.
//
// The timing tests of this file are in density.pty.timing.test.ts (parallel-tests: they run in the serial pass).
import { afterEach, describe, expect, test } from "bun:test";
import { lineWithoutBar, promptText } from "../../pty/regions.ts";
import { sendPrompt, settle, startCli, type CliRun } from "../cli.ts";
import { TOOL_LINE, GROUP_LINE, TURN_LINE, CARD_ROW, conversationRows, cursorRow, press, density, cursorOnto } from "./density-helpers.ts";

let run: CliRun | undefined;
afterEach(async () => {
  run?.session.kill("SIGTERM");
  await run?.session.dispose();
  run = undefined;
});

describe("densities switched by v (task 12.5)", () => {
  test("compact, verbose, focus, compact: the cursor's agent message keeps its row; each density looks as defined", async () => {
    run = startCli({ scenario: "long-session", cols: 100, rows: 30 });
    const s = run.session;
    await sendPrompt(s, "history");
    await s.waitFor(/end turn/, 20000);
    await settle(s);
    await press(s, "Tab");
    // The cursor on an agent message's first row (shown in every density).
    const y = await cursorOnto(s, (line, row) => /^ {2}(I looked at|Short version|Test summary)/.test(line) && row > 0);
    const line = lineWithoutBar(s, y);
    const compact = conversationRows(s);

    await density(s, "verbose");
    expect(cursorRow(s)).toBe(y);
    expect(lineWithoutBar(s, y)).toBe(line);
    let rows = conversationRows(s);
    expect(rows.some((r) => GROUP_LINE.test(r))).toBe(false);
    // Every tool line on screen is followed by its card.
    for (let i = 0; i < rows.length - 1; i++) if (TOOL_LINE.test(rows[i]!)) expect(rows[i + 1]).toMatch(CARD_ROW);

    await density(s, "focus");
    expect(cursorRow(s)).toBe(y);
    expect(lineWithoutBar(s, y)).toBe(line);
    rows = conversationRows(s);
    expect(rows.some((r) => TOOL_LINE.test(r))).toBe(false);
    expect(rows.some((r) => CARD_ROW.test(r))).toBe(false);

    await density(s, "compact");
    expect(cursorRow(s)).toBe(y);
    expect(lineWithoutBar(s, y)).toBe(line);
    expect(conversationRows(s)).toEqual(compact);

    // A gap's line sits where its first tool call was, near the top of this one-turn
    // history (not on screen when the reader is at the end): focus, then the first item.
    await density(s, "verbose");
    await density(s, "focus");
    await press(s, "Home");
    expect(conversationRows(s).some((r) => TURN_LINE.test(r))).toBe(true);
    expect(run.agentMethods().filter((m) => m === "session/prompt")).toHaveLength(1);
  }, 60000);

  test("a tool call under the cursor: its row is kept in verbose; focus puts the cursor on its gap's line in that row; compact returns to the call", async () => {
    // 35 rows: the 26 conversation rows 100x30 had before the margins and the row budget
    // (mvp-chrome-and-keys tasks 4.1 and 4.2), so the walk finds an edit or execute call.
    run = startCli({ scenario: "long-session", cols: 100, rows: 35 });
    const s = run.session;
    await sendPrompt(s, "history");
    await s.waitFor(/end turn/, 20000);
    await settle(s);
    await press(s, "Tab");
    const y = await cursorOnto(s, (line) => TOOL_LINE.test(line) && / ✓ (edit|execute) /.test(line));
    const line = lineWithoutBar(s, y);

    await density(s, "verbose");
    expect(cursorRow(s)).toBe(y);
    expect(lineWithoutBar(s, y)).toBe(line);
    // The card's top padding row (review C14), then its content.
    expect(lineWithoutBar(s, y + 1)).toMatch(/^ {2}┃ ?$/);
    expect(lineWithoutBar(s, y + 2)).toMatch(CARD_ROW);

    await density(s, "focus");
    expect(cursorRow(s)).toBe(y);
    expect(lineWithoutBar(s, y)).toMatch(TURN_LINE);

    await density(s, "compact");
    expect(cursorRow(s)).toBe(y);
    expect(lineWithoutBar(s, y)).toBe(line);
  }, 60000);

  // Spec tui-conversation "Focus lines" and "Spacing of focus lines": a line per gap, with a blank
  // row on each side.
  test("focus draws one line per gap in its place; a blank row on each side of a line, beside an answer, a user message and a turn-end line", async () => {
    run = startCli({ scenario: "long-session", cols: 100, rows: 60 });
    const s = run.session;
    await sendPrompt(s, "history");
    await s.waitFor(/end turn/, 20000);
    await settle(s);
    await press(s, "Tab");
    await density(s, "verbose");
    await density(s, "focus");
    const rows = conversationRows(s);
    const at = (re: RegExp) => rows.findIndex((r) => re.test(r));
    const lines = rows.filter((r) => TURN_LINE.test(r));
    expect(lines.length).toBeGreaterThanOrEqual(3);
    // A blank row separates the line from the user message above and from the first answer below.
    const first = at(/^ {2}▸ 6 tool calls \(1 failed\) · 1 thought/);
    expect(first).toBeGreaterThan(0);
    expect(rows[first - 1]).toBe("");
    expect(rows[first + 1]).toBe("");
    expect(rows[first + 2]).toMatch(/^ {2}I looked at src\/Http\/Request\.php/);
    // Between two answers the line has a blank row on each side.
    const middle = at(/^ {2}▸ 2 tool calls$/);
    expect(middle).toBeGreaterThan(0);
    expect(rows[middle - 1]).toBe("");
    expect(rows[middle - 2]).toMatch(/^ {2}● callers need no changes/);
    expect(rows[middle + 1]).toBe("");
    expect(rows[middle + 2]).toMatch(/^ {2}I looked at src\/Db\/Connection\.php/);
    // After the last prompt: a blank row on each side before the turn-end line.
    const last = at(/^ {2}▸ 4 tool calls/);
    expect(rows[last - 1]).toBe("");
    expect(rows[last + 1]).toBe("");
    expect(rows[last + 2]).toMatch(/^ {2}end turn/);
  }, 60000);

  test("v in the prompt box is typed, not a density switch", async () => {
    run = startCli({ scenario: "long-session", cols: 100, rows: 30 });
    const s = run.session;
    await sendPrompt(s, "history");
    await s.waitFor(/end turn/, 20000);
    await settle(s);
    await press(s, { text: "v" });
    expect(s.screenText().some((l) => l.includes("density:"))).toBe(false);
    expect(promptText(s)).toEqual(["v"]);
  }, 60000);
});
