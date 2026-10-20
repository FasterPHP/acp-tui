// Tasks 8.3 and 8.4 (Phase 0) and phase-1a tasks 8.1 to 8.3, the real CLI
// against fake-agent under the PTY harness (spec tui-keymap): Shift+Enter in
// every encoding and Ctrl+J insert a newline without sending, Enter sends, Up
// and Down move between prompt lines; Esc arms interrupt and a second Esc
// within 2 s cancels, a single Esc lapses; from the conversation or the
// permission card the first Esc also returns focus, the palette closes first,
// and `interrupt: single` cancels on one press (mvp-chrome-and-keys task 3.4);
// Ctrl+C with nothing selected does nothing (no exit, no cancel, draft kept;
// task 3.1), another key disarms;
// Ctrl+D with a draft and during a turn; the Tab focus cycle with a card
// open; the card's keys; a rebound detach key named in the status row.
// Cancellation and detach are read from fake-agent's --log: detach sends
// neither session/close nor session/cancel. Runs on the alternate screen
// since phase-1a task 3.2; since task 6.2 the armed states show in the status
// row's turn state.
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { PtySession } from "../pty/harness.ts";
import { CARD_HEADER, promptText, READY, REQUIRES_ACTION, RUNNING, statusRow } from "../pty/regions.ts";
import { WINDOWS } from "../windows.ts";
import { startCli, type CliRun } from "./cli-pty.ts";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

const EXIT_HINT = "ctrl+c again to exit";
const DETACH_CONFIRM = "ctrl+d again to detach and stop the turn";
const INTERRUPT_ARMED = "esc again to interrupt";
const hints = statusRow;
const WITH_KEYMAP = join(import.meta.dir, "cli-with-keymap.ts");

/** A running turn (basic at delay scale 1000: its first step waits 5 s), prompt box focused. */
async function runningTurn(run: CliRun): Promise<void> {
  await run.s.waitFor(READY, 10000);
  run.s.sendKeys({ text: "go" }, "Enter");
  await run.s.waitFor(RUNNING, 5000);
}

// Focus, read from the screen under the flat theme (no colour replies): the prompt box's frame
// is in the accent colour (ANSI 4) only while it has focus; the conversation cursor is the
// inverse-video gutter in column 0; the card's option numbers are in the accent colour only
// while it has focus (muted otherwise).
const ACCENT_FG = 4;
function lastRowStarting(s: PtySession, prefix: string): number {
  const rows = s.screenText();
  for (let y = rows.length - 1; y >= 0; y--) if (rows[y]!.startsWith(prefix)) return y;
  return -1;
}
function promptFocused(s: PtySession): boolean {
  const y = lastRowStarting(s, "╰");
  return y >= 0 && s.cell(s.term.buffer.active.baseY + y, 0)?.getFgColor() === ACCENT_FG;
}
function cardTop(s: PtySession): number {
  return s.screenText().findIndex((r) => r.includes(CARD_HEADER));
}
function conversationFocused(s: PtySession): boolean {
  const base = s.term.buffer.active.baseY;
  const end = cardTop(s) >= 0 ? cardTop(s) : s.screenText().findIndex((r) => r.startsWith("╭"));
  for (let y = 0; y < end; y++) if (s.cell(base + y, 0)?.isInverse()) return true;
  return false;
}
function cardFocused(s: PtySession): boolean {
  const rows = s.screenText();
  const top = cardTop(s);
  if (top < 0) return false;
  for (let y = top + 1; y < rows.length && !rows[y]!.startsWith("╰"); y++) {
    const x = rows[y]!.indexOf("1 allow once");
    if (x >= 0) return s.cell(s.term.buffer.active.baseY + y, x)?.getFgColor() === ACCENT_FG;
  }
  return false;
}
/** The option labels drawn selected (inverse video under the flat theme). */
function selectedOptions(s: PtySession): string[] {
  const rows = s.screenText();
  const top = cardTop(s);
  const out: string[] = [];
  for (let y = top + 1; top >= 0 && y < rows.length && !rows[y]!.startsWith("╰"); y++) {
    for (const m of rows[y]!.matchAll(/(\d) (allow once|allow always|reject once|reject always)/g)) {
      if (s.cell(s.term.buffer.active.baseY + y, m.index!)?.isInverse()) out.push(m[0]);
    }
  }
  return out;
}
const responses = (run: CliRun) => run.entries().filter((e) => e.method === "session/request_permission/response").map((e) => e.params);

describe("send and newline (task 8.3)", () => {
  test.each([
    ["Shift+Enter, kitty CSI 13;2u", "\x1b[13;2u"],
    ["Shift+Enter, JetBrains ESC CR", "\x1b\r"],
    ["Shift+Enter, xterm modifyOtherKeys CSI 27;2;13~", "\x1b[27;2;13~"],
    ["Ctrl+J, legacy LF", "\n"],
    ["Ctrl+Enter, legacy LF (Windows Terminal 1.24)", "\n"],
    ["Ctrl+Enter, kitty CSI 13;5u (Windows Terminal 1.25)", "\x1b[13;5u"],
    ["Ctrl+J, kitty CSI 106;5u", "\x1b[106;5u"],
  ])("%s inserts a newline and sends nothing; Enter then sends", async (_name, bytes) => {
    const run = startCli();
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.write("first");
    await run.s.waitFor((p) => promptText(p)[0] === "first", 5000);
    run.s.write(bytes);
    run.s.write("second");
    await run.s.waitFor((p) => promptText(p).length === 2, 5000);
    expect(promptText(run.s)).toEqual(["first", "second"]);
    await Bun.sleep(300);
    expect(run.methods()).toEqual(["initialize", "session/new"]);

    run.s.sendKeys("Enter");
    await run.s.waitFor(() => run.methods().includes("session/prompt"), 5000);
    expect(run.methods().filter((m) => m === "session/prompt")).toHaveLength(1);
  }, 20000);

  test("Up and Down move between the lines of a multiline prompt", async () => {
    const run = startCli();
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.write("first");
    run.s.sendKeys("Shift+Enter");
    run.s.write("second");
    await run.s.waitFor((p) => promptText(p).join("|") === "first|second", 5000);
    run.s.sendKeys("Up");
    run.s.write("X");
    await run.s.waitFor((p) => promptText(p).join("|") === "firstX|second", 5000);
    run.s.sendKeys("Down");
    run.s.write("Y");
    await run.s.waitFor((p) => promptText(p).join("|") === "firstX|secondY", 5000);
    expect(run.methods()).toEqual(["initialize", "session/new"]);
  }, 20000);
});

describe("Escape (phase-1a task 8.2)", () => {
  test("Esc during a turn: the first press shows the armed interrupt in the status row, the second cancels", async () => {
    const run = startCli("basic", 1000);
    session = run.s;
    await runningTurn(run);
    expect(hints(run.s)).toContain("esc esc interrupt");
    run.s.sendKeys("Esc");
    await run.s.waitFor((p) => statusRow(p).includes(INTERRUPT_ARMED), 5000);
    expect(run.methods()).not.toContain("session/cancel");
    run.s.sendKeys("Esc");
    await run.s.waitFor(() => run.methods().includes("session/cancel"), 5000);
    await run.s.waitFor(READY, 5000);
    expect(statusRow(run.s)).not.toContain(INTERRUPT_ARMED);
    expect(run.s.exitCode).toBeNull();
  }, 20000);

  test("Single Esc does not cancel: after 2 s the armed state goes and the turn keeps running", async () => {
    const run = startCli("basic", 1000);
    session = run.s;
    await runningTurn(run);
    run.s.sendKeys("Esc");
    await run.s.waitFor((p) => statusRow(p).includes(INTERRUPT_ARMED), 5000);
    const armedAt = Date.now();
    await run.s.waitFor((p) => !statusRow(p).includes(INTERRUPT_ARMED), 4000);
    expect(Date.now() - armedAt).toBeGreaterThan(1500);
    expect(statusRow(run.s)).toMatch(RUNNING);
    expect(run.methods()).not.toContain("session/cancel");
    // The window passed: the next Esc arms again rather than cancelling.
    run.s.sendKeys("Esc");
    await run.s.waitFor((p) => statusRow(p).includes(INTERRUPT_ARMED), 5000);
    await Bun.sleep(200);
    expect(run.methods()).not.toContain("session/cancel");
    expect(run.s.exitCode).toBeNull();
  }, 20000);

  // mvp-chrome-and-keys task 3.4 (design D6 "Interrupt from the card"): two presses interrupt from
  // the prompt box, the conversation or the permission card; from the conversation or the card the
  // first press also returns focus to the prompt box.
  test("Esc leaves the conversation first: the first press returns focus to the prompt box and arms interrupt, the second cancels", async () => {
    const run = startCli("basic", 1000);
    session = run.s;
    await runningTurn(run);
    await run.s.waitFor((p) => promptFocused(p), 5000);
    run.s.sendKeys("Tab");
    await run.s.waitFor((p) => conversationFocused(p) && !promptFocused(p), 5000);
    run.s.sendKeys("Esc");
    await run.s.waitFor((p) => promptFocused(p) && !conversationFocused(p) && statusRow(p).includes(INTERRUPT_ARMED), 5000);
    expect(run.methods()).not.toContain("session/cancel");
    run.s.sendKeys("Esc");
    await run.s.waitFor(() => run.methods().includes("session/cancel"), 5000);
    await run.s.waitFor(READY, 5000);
    expect(run.s.exitCode).toBeNull();
  }, 20000);

  test("Two presses from a focused card: the first returns focus to the prompt box and arms interrupt, the second cancels the turn and answers the request cancelled", async () => {
    // delay-scale 100: about 2 s from the prompt being sent to the permission request.
    const run = startCli("basic", 100, { cols: 63, rows: 21 });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor(REQUIRES_ACTION, 10000);
    // The prompt box was empty, so the card took focus.
    await run.s.waitFor((p) => cardFocused(p), 5000);
    run.s.sendKeys("Esc");
    await run.s.waitFor((p) => promptFocused(p) && !cardFocused(p) && statusRow(p).includes(INTERRUPT_ARMED), 5000);
    expect(responses(run)).toEqual([]);
    expect(run.methods()).not.toContain("session/cancel");
    run.s.sendKeys("Esc");
    await run.s.waitFor(() => run.methods().includes("session/cancel"), 5000);
    await run.s.waitFor(() => responses(run).length === 1, 5000);
    expect(responses(run)).toEqual([{ outcome: { outcome: "cancelled" } }]);
    await run.s.waitFor(READY, 5000);
    expect(run.s.exitCode).toBeNull();
  }, 30000);

  test("Esc closes the palette first: the first press closes the palette, the second only arms interrupt", async () => {
    const run = startCli("basic", 1000, { cols: 63, rows: 21 });
    session = run.s;
    await runningTurn(run);
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor((p) => p.screenText().some((r) => r.startsWith("╭") && r.includes("Commands")), 5000);
    run.s.sendKeys("Esc");
    await run.s.waitFor((p) => !p.screenText().some((r) => r.includes("Commands")) && promptFocused(p), 5000);
    expect(statusRow(run.s)).not.toContain(INTERRUPT_ARMED);
    run.s.sendKeys("Esc");
    await run.s.waitFor((p) => statusRow(p).includes(INTERRUPT_ARMED), 5000);
    await Bun.sleep(300);
    expect(run.methods()).not.toContain("session/cancel");
    expect(run.s.exitCode).toBeNull();
  }, 20000);

  test("Idle Esc from the conversation: focus returns to the prompt box and nothing is armed", async () => {
    // A finished turn, so the conversation has items and a cursor to show its focus.
    const run = startCli("short-answer");
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor(() => run.methods().includes("session/prompt"), 5000);
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys("Tab");
    await run.s.waitFor((p) => conversationFocused(p) && !promptFocused(p), 5000);
    run.s.sendKeys("Esc");
    await run.s.waitFor((p) => promptFocused(p) && !conversationFocused(p), 5000);
    await Bun.sleep(300);
    await run.s.flush();
    expect(statusRow(run.s)).not.toContain("again to");
    expect(run.methods()).toEqual(["initialize", "session/new", "session/prompt"]);
    expect(run.s.exitCode).toBeNull();
  }, 20000);

  test("Single interrupt setting: with `interrupt` at `single` (set directly), one Esc in the prompt box cancels the turn", async () => {
    const run = startCli("basic", 1000, { entry: WITH_KEYMAP, env: { ACP_TUI_TEST_INTERRUPT: "single" } });
    session = run.s;
    await runningTurn(run);
    run.s.sendKeys("Esc");
    await run.s.waitFor(() => run.methods().includes("session/cancel"), 5000);
    await run.s.waitFor(READY, 5000);
    expect(statusRow(run.s)).not.toContain(INTERRUPT_ARMED);
    expect(run.s.exitCode).toBeNull();
  }, 20000);

  test("Esc while idle does nothing", async () => {
    const run = startCli();
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys("Esc");
    await Bun.sleep(300);
    expect(run.s.exitCode).toBeNull();
    expect(run.methods()).toEqual(["initialize", "session/new"]);
  }, 20000);
});

// Ctrl+C is the selection's `copy` (mvp-conversation design D7, spec tui-selection "Copy on
// release and Ctrl+C"): with nothing selected and the prompt box focused it is consumed and does
// nothing, so it never clears, cancels, arms exit or exits (mvp-chrome-and-keys task 3.1 removed the
// exit machine's Ctrl+C path and the `interrupt` binding; tui-keymap "Ctrl+C precedence", "No
// single keypress exits"). Exit is Ctrl+D and the interrupt the double Esc, tested above and below.
describe("Ctrl+C with nothing selected (mvp-chrome-and-keys task 3.1; mvp-conversation task 5.6)", () => {
  test("Double Ctrl+C while idle: acp-tui remains open and nothing is armed (also: Idle, empty prompt box)", async () => {
    const run = startCli();
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys("Ctrl+C");
    await Bun.sleep(300);
    expect(statusRow(run.s)).not.toContain("again to");
    run.s.sendKeys("Ctrl+C");
    await Bun.sleep(500);
    expect(hints(run.s)).not.toContain(EXIT_HINT);
    expect(statusRow(run.s)).not.toContain("again to");
    expect(run.s.screenText().join("\n")).not.toMatch(/copied|nothing copied/);
    expect(run.s.exitCode).toBeNull();
    expect(run.methods()).toEqual(["initialize", "session/new"]);
  }, 20000);

  test("Running turn, nothing selected: Ctrl+C leaves the turn running (no session/cancel), the draft unchanged and nothing armed", async () => {
    const run = startCli("basic", 1000);
    session = run.s;
    await runningTurn(run);
    run.s.sendKeys({ text: "draft" });
    await run.s.waitFor((p) => promptText(p)[0] === "draft", 5000);
    run.s.sendKeys("Ctrl+C");
    await Bun.sleep(600);
    expect(promptText(run.s)[0]).toBe("draft");
    expect(hints(run.s)).not.toContain(EXIT_HINT);
    expect(statusRow(run.s)).not.toContain("again to");
    expect(RUNNING.test(run.s.screenText().join("\n"))).toBe(true);
    // An empty prompt box too.
    run.s.sendKeys("Backspace", "Backspace", "Backspace", "Backspace", "Backspace");
    await run.s.waitFor((p) => promptText(p).join("|") === "", 5000);
    run.s.sendKeys("Ctrl+C");
    await Bun.sleep(600);
    expect(RUNNING.test(run.s.screenText().join("\n"))).toBe(true);
    expect(run.methods()).not.toContain("session/cancel");
    expect(hints(run.s)).not.toContain(EXIT_HINT);
    expect(run.s.exitCode).toBeNull();
  }, 20000);

  test("another key between two presses of Esc disarms the interrupt (was: between two Ctrl+C)", async () => {
    const run = startCli("basic", 1000);
    session = run.s;
    await runningTurn(run);
    run.s.sendKeys("Esc");
    await run.s.waitFor((p) => hints(p).includes(INTERRUPT_ARMED), 5000);
    run.s.sendKeys("Up");
    await run.s.waitFor((p) => !hints(p).includes(INTERRUPT_ARMED), 5000);
    // The next Esc arms again rather than cancelling.
    run.s.sendKeys("Esc");
    await run.s.waitFor((p) => hints(p).includes(INTERRUPT_ARMED), 5000);
    await Bun.sleep(300);
    expect(run.methods()).not.toContain("session/cancel");
  }, 20000);
});

describe("Ctrl+D (task 8.4)", () => {
  test("with a draft, Ctrl+D edits (deletes forward) and does not exit", async () => {
    const run = startCli();
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "abc" }, "Left", "Left");
    await Bun.sleep(100);
    run.s.sendKeys("Ctrl+D");
    await run.s.waitFor((p) => promptText(p)[0] === "ac", 5000);
    await Bun.sleep(200);
    expect(run.s.exitCode).toBeNull();
  }, 20000);

  test("Detach during a turn: first Ctrl+D asks to confirm in the status row, the confirmation lapses, a confirmed Ctrl+D detaches", async () => {
    const run = startCli("basic", 1000);
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor(RUNNING, 5000);
    const confirm = DETACH_CONFIRM;
    run.s.sendKeys("Ctrl+D");
    await run.s.waitFor((p) => statusRow(p).includes(confirm), 5000);
    expect(run.s.exitCode).toBeNull();
    await run.s.waitFor((p) => !p.screenText().join("\n").includes(confirm), 4000);
    expect(run.s.exitCode).toBeNull();
    run.s.sendKeys("Ctrl+D");
    await run.s.waitFor(confirm, 5000);
    run.s.sendKeys("Ctrl+D");
    expect(await run.s.wait(10000)).toBe(0);
    const sent = run.methods();
    expect(sent).toContain("session/prompt");
    expect(sent).not.toContain("session/cancel");
    expect(sent).not.toContain("session/close");
  }, 20000);
});

describe("detach during a running turn records no failure", () => {
  // A user-requested detach closes the agent's stdin, which rejects the running prompt and ends
  // the agent; neither is a failure, so the conversation gains no `error:` line and no
  // `agent exited` line (spec tui-agent-session "Exit is detach", "Agent disconnect is
  // survivable").
  // The alternate screen is gone after exit, so everything drawn from the detach on is read
  // from the raw output.
  // The signal rows are left out on Windows: a signal sent with process.kill ends a Windows process outright instead of running its handler.
  test.each([
    ["confirmed Ctrl+D", 0],
    ...(WINDOWS ? [] : ([["SIGTERM", 143], ["SIGHUP", 129]] as const)),
  ] as const)("%s", async (how, code) => {
    const run = startCli("basic", 200);
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor(RUNNING, 5000);
    await run.s.waitFor("Streamed answer", 5000);
    await run.s.flush();
    const mark = run.s.rawOutput().length;
    if (how === "confirmed Ctrl+D") {
      run.s.sendKeys("Ctrl+D");
      await run.s.waitFor(DETACH_CONFIRM, 5000);
      run.s.sendKeys("Ctrl+D");
    } else {
      run.s.kill(how);
    }
    expect(await run.s.wait(10000)).toBe(code);
    expect(run.s.term.buffer.active.type).toBe("normal");
    const drawn = run.s.rawOutput().slice(mark);
    expect(drawn).not.toContain("error:");
    expect(drawn).not.toContain("agent exited");
    const sent = run.methods();
    expect(sent).toContain("session/prompt");
    expect(sent).not.toContain("session/cancel");
    expect(sent).not.toContain("session/close");
  }, 20000);
});

describe("Ctrl+O and Ctrl+L hooks (task 8.4; phase-1a task 3.2)", () => {
  test("Ctrl+L repaints through the app's repaint action: no notice, nothing cleared, content unchanged", async () => {
    const run = startCli();
    session = run.s;
    await run.s.waitFor(READY, 10000);
    await Bun.sleep(100);
    await run.s.flush();
    const before = run.s.screenText();
    run.s.sendKeys("Ctrl+L");
    await Bun.sleep(300);
    await run.s.flush();
    expect(run.s.screenText()).toEqual(before);
    expect(run.s.screenText().join("\n")).not.toContain("not yet available");
    expect(run.s.rawOutput()).not.toContain("\x1b[3J");
    expect(run.s.exitCode).toBeNull();
  }, 20000);


  test("Ctrl+O before any tool call shows the no-tool-call notice", async () => {
    const run = startCli();
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys("Ctrl+O");
    await run.s.waitFor("no tool call to show", 5000);
    expect(run.s.exitCode).toBeNull();
  }, 20000);

  test("Ctrl+O with a tool call toggles it in place (task 7.3), nothing sent", async () => {
    const run = startCli();
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor(CARD_HEADER, 5000);
    // The card took focus (the prompt box was empty), and there Ctrl+O grows the card
    // (mvp-chrome-and-keys task 5.1): Esc returns to the prompt box first (arming interrupt,
    // which Ctrl+O disarms).
    run.s.sendKeys("Esc");
    await run.s.waitFor((p) => promptFocused(p), 5000);
    run.s.sendKeys("Ctrl+O");
    // The tool behind the open request (#2, the edit) expands; its diff arrives only when it
    // completes, so the card says it has no content yet.
    await run.s.waitFor("(no content)", 5000);
    expect(run.s.term.buffer.active.type).toBe("alternate");
    expect(run.methods().filter((m) => m !== "session/request_permission")).toEqual(["initialize", "session/new", "session/prompt"]);
    expect(run.s.exitCode).toBeNull();
  }, 20000);
});

describe("focus cycle and card keys (phase-1a task 8.3)", () => {
  test("Cycle with a card open: Tab three times goes to the conversation, the card, and back to the prompt box with the draft unchanged", async () => {
    // delay-scale 100: about 2 s from the prompt being sent to the permission request.
    const run = startCli("basic", 100, { cols: 63, rows: 21 });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor(RUNNING, 5000);
    run.s.sendKeys({ text: "my draft" });
    await run.s.waitFor((p) => promptText(p)[0] === "my draft", 5000);
    await run.s.waitFor(REQUIRES_ACTION, 10000);
    await run.s.waitFor(CARD_HEADER, 5000);
    expect(promptFocused(run.s)).toBe(true);

    run.s.sendKeys("Tab");
    await run.s.waitFor((p) => conversationFocused(p) && !promptFocused(p) && !cardFocused(p), 5000);
    run.s.sendKeys("Tab");
    await run.s.waitFor((p) => cardFocused(p) && !conversationFocused(p) && !promptFocused(p), 5000);
    run.s.sendKeys("Tab");
    await run.s.waitFor((p) => promptFocused(p) && !cardFocused(p) && !conversationFocused(p), 5000);
    expect(promptText(run.s)).toEqual(["my draft"]);
    expect(responses(run)).toEqual([]);
  }, 30000);

  test("Digit then Enter: with the card focused, 3 then Enter answers reject_once", async () => {
    const run = startCli("basic", 0, { cols: 63, rows: 21 });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor((p) => cardFocused(p), 5000);
    await Bun.sleep(400); // past the card's 300 ms guard
    run.s.sendKeys("3");
    await Bun.sleep(100);
    expect(responses(run)).toEqual([]);
    run.s.sendKeys("Enter");
    await run.s.waitFor(() => responses(run).length === 1, 5000);
    expect(responses(run)).toEqual([{ outcome: { outcome: "selected", optionId: "reject-once" } }]);
  }, 20000);

  test("Numbers in the prompt box: with a card open and the prompt box focused, 2 is typed and no option is selected", async () => {
    const run = startCli("basic", 100, { cols: 63, rows: 21 });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor(RUNNING, 5000);
    run.s.sendKeys({ text: "n" });
    await run.s.waitFor((p) => promptText(p)[0] === "n", 5000);
    await run.s.waitFor(CARD_HEADER, 10000);
    await Bun.sleep(400);
    run.s.sendKeys("2");
    await run.s.waitFor((p) => promptText(p)[0] === "n2", 5000);
    await Bun.sleep(200);
    expect(responses(run)).toEqual([]);
    // No option was selected: at the card, Enter answers with the first option.
    run.s.sendKeys("Tab", "Tab");
    await run.s.waitFor((p) => cardFocused(p), 5000);
    run.s.sendKeys("Enter");
    await run.s.waitFor(() => responses(run).length === 1, 5000);
    expect(responses(run)).toEqual([{ outcome: { outcome: "selected", optionId: "allow-once" } }]);
    expect(promptText(run.s)).toEqual(["n2"]);
  }, 30000);

  test("Digit from the conversation: with a card open and the conversation focused, 3 selects reject_once and moves focus to the answer row; Enter answers", async () => {
    // mvp-chrome-and-keys task 12.4 (Marcus, 11 October 2026): the card need not be focused first.
    const run = startCli("basic", 100, { cols: 63, rows: 21 });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor(RUNNING, 5000);
    // A draft keeps focus in the prompt box when the card appears.
    run.s.sendKeys({ text: "n" });
    await run.s.waitFor((p) => promptText(p)[0] === "n", 5000);
    await run.s.waitFor(CARD_HEADER, 10000);
    await Bun.sleep(400); // past the card's 300 ms guard
    run.s.sendKeys("Tab");
    await run.s.waitFor((p) => conversationFocused(p) && !promptFocused(p) && !cardFocused(p), 5000);
    expect(selectedOptions(run.s)).toEqual([]);

    run.s.sendKeys("3");
    await run.s.waitFor((p) => cardFocused(p) && selectedOptions(p).join() === "3 reject once", 5000);
    expect(conversationFocused(run.s)).toBe(false);
    expect(promptFocused(run.s)).toBe(false);
    await Bun.sleep(100);
    expect(responses(run)).toEqual([]);
    run.s.sendKeys("Enter");
    await run.s.waitFor(() => responses(run).length === 1, 5000);
    expect(responses(run)).toEqual([{ outcome: { outcome: "selected", optionId: "reject-once" } }]);
    // The digit was not typed anywhere: the draft is as it was.
    await run.s.waitFor((p) => promptFocused(p), 5000);
    expect(promptText(run.s)).toEqual(["n"]);
  }, 30000);
});

describe("key labels from the key map in use (phase-1a task 8.1)", () => {
  test("Rebound key in a notice: detach bound to Ctrl+Q instead of Ctrl+D; the confirmation names Ctrl+Q", async () => {
    const run = startCli("basic", 1000, { cols: 120, entry: WITH_KEYMAP, env: { ACP_TUI_TEST_KEYMAP: JSON.stringify({ global: { "ctrl+q": "detach", "ctrl+d": null } }) } });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    expect(hints(run.s)).toContain("ctrl+q detach");
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor(RUNNING, 5000);
    run.s.sendKeys("Ctrl+Q");
    await run.s.waitFor((p) => statusRow(p).includes("ctrl+q again to detach and stop the turn"), 5000);
    expect(run.s.screenText().join("\n")).not.toContain("ctrl+d");
    run.s.sendKeys("Ctrl+Q");
    expect(await run.s.wait(10000)).toBe(0);
    const sent = run.methods();
    expect(sent).not.toContain("session/cancel");
    expect(sent).not.toContain("session/close");
  }, 20000);
});
