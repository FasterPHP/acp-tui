// Task 6.3 verification (spec tui-layout "Prompt box"; Phase 0 task 8.1's
// composer tests carried over): the real CLI against fake-agent under the PTY
// harness at 63x21, PhpStorm reworked's pane size. Multiline paste, the growth
// limit (`floor(rows / 3)` text rows, then scrolling with the cursor line in
// view), the bottom border's values, and submit while running (spec
// tui-agent-session "Submit while running"). What fake-agent received is read
// from its --log.
import { afterEach, describe, expect, test } from "bun:test";
import { bracketedPaste, type PtySession } from "../pty/harness.ts";
import { blankAbovePrompt, promptBox, promptRows, promptText, READY, RUNNING, statusRow } from "../pty/regions.ts";
import { startCli } from "../keys/cli-pty.ts";
import { configEnv } from "../pty/config-home.ts";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

const SIZE = { cols: 63, rows: 21 };

describe("prompt box (task 6.3)", () => {
  test("at rest: a rounded frame around one empty text row and the padding row (the row budget at 21 rows, with the blank row above the prompt box), above the spacer and the status row", async () => {
    const run = startCli("basic", 0, SIZE);
    session = run.s;
    await run.s.waitFor(READY, 10000);
    const empty = `│${" ".repeat(61)}│`;
    expect(promptBox(run.s)).toEqual([`╭${"─".repeat(61)}╮`, empty, empty, `╰${"─".repeat(61)}╯`]);
    expect(blankAbovePrompt(run.s)).toBe(true);
  }, 20000);

  test("Padding below a multi-line draft: the row under the third line inside the frame is blank and the pills are on the row below it (90x40)", async () => {
    const run = startCli("config-options", 0, { cols: 90, rows: 40 });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    await run.s.waitFor((p) => (promptBox(p).at(-1) ?? "").includes("Fake Aurora"), 5000);
    run.s.write(bracketedPaste("one\rtwo\rthree"));
    await run.s.waitFor((p) => promptText(p).join("|") === "one|two|three", 5000);
    await run.s.flush();
    const box = promptBox(run.s);
    // Frame, three text rows, the padding row, the border with the pills.
    expect(box).toHaveLength(6);
    expect(box[3]).toMatch(/^│ three +│$/);
    expect(box[4]).toBe(`│${" ".repeat(88)}│`);
    expect(box[5]).toContain("Fake Aurora");
    expect(box[5]!.startsWith("╰")).toBe(true);
  }, 20000);

  test("multiline paste: three lines shown, nothing sent (CR and LF line breaks)", async () => {
    const run = startCli("basic", 0, SIZE);
    session = run.s;
    await run.s.waitFor(READY, 10000);
    // Terminals send pasted line breaks as CR.
    run.s.write(bracketedPaste("one\rtwo\rthree"));
    await run.s.waitFor((p) => promptText(p).join("|") === "one|two|three", 5000);
    expect(promptText(run.s)).toEqual(["one", "two", "three"]);
    // Give a wrongly sent prompt time to arrive.
    await Bun.sleep(300);
    expect(run.methods()).toEqual(["initialize", "session/new"]);

    // Cleared by Backspace: Ctrl+C no longer clears the prompt box (mvp-conversation design D7).
    run.s.sendKeys(...Array.from({ length: "one\ntwo\nthree".length }, () => "Backspace" as const));
    await run.s.waitFor((p) => promptText(p).join("|") === "", 5000);
    run.s.write(bracketedPaste("alpha\nbeta\r\ngamma"));
    await run.s.waitFor((p) => promptText(p).join("|") === "alpha|beta|gamma", 5000);
    expect(promptText(run.s)).toEqual(["alpha", "beta", "gamma"]);
    await Bun.sleep(300);
    expect(run.methods()).toEqual(["initialize", "session/new"]);
  }, 20000);

  test("growth limit in a 21-row pane: 20 lines show 7 text rows and the cursor line stays visible", async () => {
    const run = startCli("basic", 0, SIZE);
    session = run.s;
    await run.s.waitFor(READY, 10000);
    expect(promptText(run.s)).toEqual([""]);
    expect(promptRows(run.s)).toBe(1);

    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    run.s.write(bracketedPaste(lines.join("\r")));
    await run.s.waitFor((p) => promptText(p).at(-1) === "line 20", 5000);
    let rows = promptText(run.s);
    expect(rows).toEqual(lines.slice(13));
    // Frame, 7 text rows, the padding row, frame (rows 9 to 18), then the spacer, the status row
    // and the margin; the blank row above the prompt box stays (the conversation keeps 6 rows).
    const screen = run.s.screenText();
    expect(screen[8]!.startsWith("╭")).toBe(true);
    expect(screen[16]).toMatch(/^│ +│$/);
    expect(screen[17]!.startsWith("╰")).toBe(true);

    // The terminal cursor sits on the cursor line, at its end (behind the frame's `│ `).
    const cursorRow = () => run.s.lineText(run.s.term.buffer.active.baseY + run.s.term.buffer.active.cursorY);
    expect(unframeCursor(cursorRow())).toBe("line 20");
    expect(run.s.term.buffer.active.cursorX).toBe("│ line 20".length);

    // Moving up past the top of the visible rows scrolls the input; the cursor line stays visible.
    for (let i = 0; i < 12; i++) run.s.sendKeys("Up");
    await run.s.waitFor(() => unframeCursor(cursorRow()) === "line 8", 5000);
    rows = promptText(run.s);
    expect(rows.length).toBe(7);
    expect(rows).toContain("line 8");
    expect(rows.at(-1)).not.toBe("line 20");
    await Bun.sleep(200);
    expect(run.methods()).toEqual(["initialize", "session/new"]);
  }, 20000);

  test("border values: the agent's mode, model and effort as pills in the bottom border (fake-agent config-options)", async () => {
    const run = startCli("config-options", 0, SIZE);
    session = run.s;
    await run.s.waitFor(READY, 10000);
    await run.s.waitFor((p) => (promptBox(p).at(-1) ?? "").includes("Fake Aurora"), 5000);
    expect(promptBox(run.s).at(-1)).toBe(`╰─ Mode Ask ─ Model Fake Aurora ─ Thinking Medium ${"─".repeat(12)}╯`);
  }, 20000);

  test("border values: the context used and size after a usage update (fake-agent basic)", async () => {
    const run = startCli("basic", 0, SIZE);
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor("◊ Permission", 5000);
    await Bun.sleep(400);
    run.s.sendKeys("Enter");
    await run.s.waitFor((p) => (promptBox(p).at(-1) ?? "").includes("38k/200k"), 5000);
    expect(promptBox(run.s).at(-1)).toBe(`╰${"─".repeat(50)} 38k/200k ─╯`);
  }, 20000);

  test("submit while running: no second session/prompt, text kept, the status row and a notice say a turn is running", async () => {
    // delay-scale 1000: the basic scenario's first step waits 5 s, so the turn stays running.
    // The busy track at 25 per cent (the default before 15 October 2026): at 40 per cent of 63
    // columns the whole notice no longer fits beside it, and this test is about the notice.
    const run = startCli("basic", 1000, { ...SIZE, env: configEnv({ density: "compact", busy: { track_percent: 25 } }) });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "first" }, "Enter");
    await run.s.waitFor(RUNNING, 5000);
    expect(promptText(run.s)).toEqual([""]);

    run.s.sendKeys({ text: "second" });
    await run.s.waitFor((p) => promptText(p)[0] === "second", 5000);
    run.s.sendKeys("Enter");
    await run.s.waitFor("a turn is running: esc twice to cancel it", 5000);
    expect(statusRow(run.s)).toMatch(/ running \d+s\b.*connected$/);
    // The notice sits in the middle of the prompt box's top border, after the busy indicator's track.
    expect(promptBox(run.s)[0]).toMatch(/^╭[─━╼╾╴╶ ]{11,} a turn is running: esc twice to cancel it ─+╮$/);
    expect(promptText(run.s)).toEqual(["second"]);
    await Bun.sleep(300);
    expect(run.methods().filter((m) => m === "session/prompt")).toHaveLength(1);
  }, 20000);
});

function unframeCursor(row: string): string {
  return row.replace(/^│ /, "").replace(/ *│$/, "").trimEnd();
}
