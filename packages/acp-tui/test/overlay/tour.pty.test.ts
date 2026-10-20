// Phase-1a S6 task 13.5, a keyboard-only tour at 63x21 with
// `--mouse off` (no `--spike` since mvp-chrome-and-keys task 7.5) against fake-agent's `basic` scenario: with the
// permission card open, Tab into the conversation, first and last item,
// expand and collapse a thought, pick `First item` from the palette, then Tab
// to the card and answer it with `3` then Enter. No mouse report is sent.
import { afterEach, expect, test } from "bun:test";
import type { PtySession } from "../pty/harness.ts";
import { cardRows, READY, statusRow, withoutBar } from "../pty/regions.ts";
import { boxRows, rowOf, startChrome } from "./cli.ts";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

const THOUGHT_TEXT = "Considering the safest way";
const ACCENT_FG = 4; // the `accent` token: ANSI blue

/** The card has focus: its option numbers are drawn in the accent colour (muted without focus). */
function cardFocused(s: PtySession): boolean {
  const y = rowOf(s, "1 allow once");
  if (y < 0) return false;
  return s.cell(s.term.buffer.active.baseY + y, s.screenText()[y]!.indexOf("1 allow once"))?.getFgColor() === ACCENT_FG;
}

test("keyboard-only tour with --mouse off: expand, collapse, first and last, palette pick, answer with 3 then Enter", async () => {
  const run = startChrome({ scenario: "basic", args: ["--mouse", "off"] });
  session = run.s;
  const s = run.s;
  await s.waitFor(READY, 10000);
  expect(statusRow(s)).toContain("mouse off");
  s.sendKeys({ text: "go" }, "Enter");
  await s.waitFor(() => cardRows(s).length > 0, 5000);
  const cardShownAt = Date.now();
  await s.waitFor("Thought · 11 words", 5000);
  // Row 3: the user card's text, below the top margin and its padding row.
  const conversationTop = () => withoutBar(s.screenText())[2] ?? "";

  // The card took focus (the prompt box was empty). Tab to the prompt box, Tab to the conversation.
  s.sendKeys("Tab", "Tab");
  // First item: the user's prompt at the top; last item: the edit's tool line at the bottom.
  s.sendKeys("Home");
  await s.waitFor(() => conversationTop() === "   go", 3000);
  expect(statusRow(s)).toMatch(/scrolled/);
  s.sendKeys("End");
  // The edit's line is the conversation's last, above the activity bar's blank row (kept at 63x21
  // with this card, which has no preview; day-one-feedback task group 13).
  await s.waitFor(() => rowOf(s, /^ {2}← \S edit {5}Edit src\/index\.ts/) === rowOf(s, /running: Edit src\/index\.ts/) - 2, 3000);

  // Up twice reaches the thought; Enter expands it in place, Enter again collapses it.
  s.sendKeys("Up", "Up", "Enter");
  await s.waitFor(THOUGHT_TEXT, 3000);
  s.sendKeys("Enter");
  await s.waitFor(() => rowOf(s, THOUGHT_TEXT) < 0, 3000);

  // The palette: pick `First item`; it runs in the conversation, which keeps focus.
  s.sendKeys("Ctrl+P");
  await s.waitFor(/Commands \d+/, 3000);
  // The permission card is open, so its commands are listed too (below the first page here).
  s.sendKeys({ text: "select" });
  await s.waitFor(() => boxRows(s, "Commands").some((r) => r.includes("Select reject once")), 3000);
  s.write("\x15"); // Ctrl+U clears the filter
  await s.waitFor(() => boxRows(s, "Commands").some((r) => r.includes("type to filter commands")), 3000);
  s.sendKeys({ text: "first item" });
  // `First item` (the conversation) and `First item of the conversation` (the prompt box), in that order.
  await s.waitFor(/Commands 2 /, 3000);
  s.sendKeys("Enter");
  await s.waitFor(() => boxRows(s, "Commands").length === 0 && conversationTop() === "   go", 3000);
  // Still in the conversation: End goes back to the last item.
  s.sendKeys("End");
  await s.waitFor(() => conversationTop() !== "  go", 3000);

  // Tab from the conversation to the card; 3 then Enter answers option 3. All three in one write:
  // each key reaches the focus the one before it left (mvp-chrome-and-keys task 3.5).
  // The tour runs faster than a person: wait out the card's 300 ms typing guard, which would
  // (rightly) swallow a digit typed this soon after the card appeared.
  await Bun.sleep(Math.max(0, cardShownAt + 400 - Date.now()));
  s.write("\t3\r");
  await s.waitFor(() => run.agent().some((e) => e.method === "session/request_permission/response"), 5000);
  expect(run.agent().filter((e) => e.method === "session/request_permission/response").map((e) => e.params)).toEqual([
    { outcome: { outcome: "selected", optionId: "reject-once" } },
  ]);
  await s.waitFor(READY, 5000);
  expect(cardRows(s)).toEqual([]);
  // Keyboard only: no mouse reporting mode was ever switched on.
  expect(s.mouseModesSet()).toEqual([]);
}, 30000);
