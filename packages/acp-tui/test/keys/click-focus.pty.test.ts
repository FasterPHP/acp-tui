// mvp-chrome-and-keys task 3.3 (spec tui-keymap "A click keeps keyboard
// focus"; Marcus's checklist (d) 1): a click in the conversation acts on what
// is under the pointer and leaves keyboard focus where it was, while a click
// on the docked card still gives it focus. The real CLI against fake-agent
// under the PTY harness, with SGR clicks injected at 0-based cells; focus is
// read from the screen under the flat theme, as in keys.pty.test.ts.
import { afterEach, describe, expect, test } from "bun:test";
import type { PtySession } from "../pty/harness.ts";
import { CARD_HEADER, promptText, READY, RUNNING } from "../pty/regions.ts";
import { startCli } from "./cli-pty.ts";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

const ACCENT_FG = 4;
const TOOL_LINE = /#\d+$/;
const EXPANDED = /^ {2}┃/;
const PLAIN_TERMINAL = { TERMINAL_EMULATOR: undefined, TERM_PROGRAM: undefined };

function lastRowStarting(s: PtySession, prefix: string): number {
  const rows = s.screenText();
  for (let y = rows.length - 1; y >= 0; y--) if (rows[y]!.startsWith(prefix)) return y;
  return -1;
}
function promptFocused(s: PtySession): boolean {
  const y = lastRowStarting(s, "╰");
  return y >= 0 && s.cell(s.term.buffer.active.baseY + y, 0)?.getFgColor() === ACCENT_FG;
}
/** The rows above the prompt box or the card. */
function conversationRows(s: PtySession): string[] {
  const rows = s.screenText();
  const card = rows.findIndex((r) => r.includes(CARD_HEADER));
  const end = card >= 0 ? card : rows.findIndex((r) => r.startsWith("╭"));
  return rows.slice(0, end < 0 ? rows.length : end);
}
/** The conversation cursor's row (the inverse-video gutter, drawn only while it has focus), or -1. */
function cursorRow(s: PtySession): number {
  const base = s.term.buffer.active.baseY;
  return conversationRows(s).findIndex((_, y) => s.cell(base + y, 0)?.isInverse() || s.cell(base + y, 1)?.isInverse());
}
function cardOption(s: PtySession): { x: number; y: number } | null {
  const rows = s.screenText();
  for (let y = 0; y < rows.length; y++) {
    const x = rows[y]!.indexOf("1 allow once");
    if (x >= 0) return { x, y };
  }
  return null;
}
function cardFocused(s: PtySession): boolean {
  const at = cardOption(s);
  return at !== null && s.cell(s.term.buffer.active.baseY + at.y, at.x)?.getFgColor() === ACCENT_FG;
}

describe("A click keeps keyboard focus (task 3.3)", () => {
  test("Typing after a click: the clicked tool call expands and takes the conversation cursor, and the typed key lands in the draft", async () => {
    const run = startCli("short-answer", 0, { cols: 80, rows: 30, env: PLAIN_TERMINAL });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor(() => run.methods().includes("session/prompt"), 5000);
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "ab" });
    await run.s.waitFor((p) => promptText(p)[0] === "ab" && promptFocused(p), 5000);

    const rows = conversationRows(run.s);
    const y = rows.findIndex((r, i) => TOOL_LINE.test(r) && !EXPANDED.test(rows[i + 1] ?? ""));
    expect(y).toBeGreaterThanOrEqual(0);
    const line = rows[y]!;
    run.s.mouseClick(20, y);
    await run.s.waitFor((p) => EXPANDED.test(conversationRows(p)[y + 1] ?? ""), 5000);
    expect(promptFocused(run.s)).toBe(true);
    expect(cursorRow(run.s)).toBe(-1);

    run.s.sendKeys({ text: "j" });
    await run.s.waitFor((p) => promptText(p)[0] === "abj", 5000);
    expect(promptFocused(run.s)).toBe(true);
    // The click put the conversation cursor on the tool call: Tab shows it there.
    run.s.sendKeys("Tab");
    await run.s.waitFor((p) => cursorRow(p) >= 0, 5000);
    expect(conversationRows(run.s)[cursorRow(run.s)]).toBe(line);
    expect(promptText(run.s)).toEqual(["abj"]);
  }, 30000);

  test("Click on the card: with the prompt box focused, a click on the card's answer row gives the card focus", async () => {
    // delay-scale 100: about 2 s from the prompt being sent to the permission request.
    const run = startCli("basic", 100, { cols: 63, rows: 21, env: PLAIN_TERMINAL });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor(RUNNING, 5000);
    // A draft keeps focus in the prompt box when the card appears.
    run.s.sendKeys({ text: "n" });
    await run.s.waitFor((p) => promptText(p)[0] === "n", 5000);
    await run.s.waitFor((p) => cardOption(p) !== null, 10000);
    expect(promptFocused(run.s)).toBe(true);
    expect(cardFocused(run.s)).toBe(false);

    const at = cardOption(run.s)!;
    run.s.mouseClick(at.x, at.y);
    await run.s.waitFor((p) => cardFocused(p) && !promptFocused(p), 5000);
    expect(promptText(run.s)).toEqual(["n"]);
    expect(run.entries().filter((e) => e.method === "session/request_permission/response")).toEqual([]);
  }, 30000);
});
