// Task 6.2 verification (Phase 0), moved to the alternate screen by phase-1a
// task 3.2 and to the screen layout by task 6.1: the real `acp-tui` CLI
// against fake-agent under the PTY harness at 80x24. Reads the status row,
// prompt box and card at the bottom of the alternate screen, drives a turn
// through the prompt box, exits (Ctrl+D or SIGTERM) and checks that the
// main screen is exactly as it was before start and that detach sent neither
// session/cancel nor session/close. Also the start-up failure paths (spec
// tui-agent-session, "Agent fails to start"). Phase-1a task 4.6: the
// full-screen wording of tui-agent-session: the exit text below the command
// line on detach, a prompt error as a line in the conversation, `disconnected`
// in the status row after the agent crashes, with acp-tui still open.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compactEnv } from "../pty/config-home.ts";
import { startPty, type PtySession } from "../pty/harness.ts";
import { CARD_HEADER, promptText, READY, REQUIRES_ACTION, statusRow, withoutBar } from "../pty/regions.ts";
import { WINDOWS } from "../windows.ts";

const ROOT = resolve(import.meta.dir, "../../../..");
const CLI = join(ROOT, "packages/acp-tui/src/cli.ts");
const FAKE_AGENT = join(ROOT, "packages/fake-agent/src/main.ts");
/** The main screen before acp-tui starts: a shell prompt with the command, and a coloured line. */
const PREFILL = "BEFORE-ACP-TUI\r\n\x1b[32mgreen line\x1b[0m\r\n$ acp-tui\r\n";

let session: PtySession | undefined;
afterEach(async () => {
  await session?.dispose();
  session = undefined;
});

function tempDir(): string {
  return realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-app-")));
}

/** The working directory of the last `startCli`: the session's cwd. */
let cwd = "";

/** Starts the CLI with the main screen prefilled, so "left as it was" is checkable. The working
 *  directory is a temporary one, not the repository: the CLI must not depend on finding
 *  bunfig.toml. */
function startCli(agent: string[]): PtySession {
  cwd = tempDir();
  session = startPty(["bun", CLI, "--", "--", ...agent], { cols: 80, rows: 24, cwd, prefill: PREFILL, env: compactEnv() });
  return session;
}

function fakeAgent(log: string, scenario = "basic"): string[] {
  return ["bun", FAKE_AGENT, "--scenario", scenario, "--delay-scale", "0", "--log", log];
}

function methods(log: string): string[] {
  return readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => (JSON.parse(line) as { method: string }).method);
}

/** Index just past the last match of `re` in `text`, or -1. */
function lastIndex(text: string, re: RegExp): number {
  let at = -1;
  for (const m of text.matchAll(new RegExp(re.source, "g"))) at = m.index! + m[0].length;
  return at;
}

/** Back on the main screen with every mode acp-tui set turned off, and nothing cleared after
 *  leaving the alternate screen. */
function expectRestored(s: PtySession) {
  const raw = s.rawOutput();
  expect(s.term.buffer.active.type).toBe("normal");
  expect(s.modesSet()).not.toContain(1049);
  const left = raw.lastIndexOf("\x1b[?1049l");
  if (left >= 0) {
    expect(raw.slice(left)).not.toContain("\x1b[2J");
    expect(raw.slice(left)).not.toContain("\x1b[3J");
  }
  expect(raw).not.toContain("\x1b[3J");
  // Each mode that was turned on is turned off again after its last use (a fast start-up
  // failure can exit before focus reporting was ever enabled).
  for (const [on, off] of [
    [/\x1b\[\?25l/, "\x1b[?25h"],
    [/\x1b\[\?2004h/, "\x1b[?2004l"],
    [/\x1b\[\?1004h/, "\x1b[?1004l"],
    [/\x1b\[>4;1m/, "\x1b[>4;0m"],
  ] as const) {
    const at = lastIndex(raw, on);
    if (at >= 0) expect(raw.indexOf(off, at)).toBeGreaterThan(0);
  }
  expect(raw).toContain("\x1b7\x1b[r\x1b8\x1b[0m\x1b[0 q\x1b[?25h");
  expect(s.mouseModesSet()).toEqual([]);
  const core = (s.term as unknown as { _core: { buffer: { scrollTop: number; scrollBottom: number }; coreService: { isCursorHidden: boolean } } })._core;
  expect(core.buffer.scrollTop).toBe(0);
  expect(core.buffer.scrollBottom).toBe(s.rows - 1);
  expect(core.coreService.isCursorHidden).toBe(false);
  expect(s.term.modes.bracketedPasteMode).toBe(false);
}

/** The main screen after exit: the lines from before start, unchanged, then `extra`. */
async function expectMainScreen(s: PtySession, extra: (lines: string[]) => void = (l) => expect(l).toEqual([])) {
  const before = (await s.mainBefore()).lines;
  const after = s.mainSnapshot().lines;
  const used = before.reduce((last, l, i) => (l !== "" ? i + 1 : last), 0);
  expect(after.slice(0, used)).toEqual(before.slice(0, used));
  extra(after.slice(used).filter((l) => l !== ""));
}

describe("acp-tui against fake-agent at 80x24 (task 6.2; alternate screen, phase-1a task 3.2)", () => {
  // Skipped on Windows: it compares the main screen before and after the run (or the raw restore sequences), and ConPTY rewrites that output.
  test.skipIf(WINDOWS)("the status row shows the cwd, idle, the hints and connected below the prompt box; Ctrl+D detaches", async () => {
    const log = join(tempDir(), "agent.log");
    const s = startCli(fakeAgent(log));
    await s.waitFor(READY, 10000);
    await Bun.sleep(100);
    await s.flush();
    expect(s.term.buffer.active.type).toBe("alternate");
    // The prompt box (three text rows and the padding row at 24 rows), the spacer, the status row
    // and the bottom margin are the bottom of the screen (mvp-chrome-and-keys tasks 4.1 and 4.2).
    const screen = s.screenText();
    const empty = `│${" ".repeat(78)}│`;
    expect(screen.slice(-9)).toEqual([`╭${"─".repeat(78)}╮`, empty, empty, empty, empty, `╰${"─".repeat(78)}╯`, "", statusRow(s), ""]);
    // No send or newline hint (task 4.6); the hints left after the long cwd start with `shift+tab mode`.
    expect(statusRow(s)).toStartWith(` ${cwd}  idle  shift+tab mode`);
    expect(statusRow(s)).toEndWith("connected");

    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    await s.flush();
    expectRestored(s);
    // fake-agent here cannot load or resume, so nothing is printed (mvp-sessions design decision 12).
    await expectMainScreen(s);
    const sent = methods(log);
    expect(sent).toEqual(["initialize", "session/new"]);
  });

  // Skipped on Windows: it compares the main screen before and after the run (or the raw restore sequences), and ConPTY rewrites that output.
  test.skipIf(WINDOWS)("the answer, tool lines and permission prompt show on the alternate screen; Ctrl+D mid-turn detaches without session/cancel or session/close and leaves the main screen unchanged", async () => {
    const log = join(tempDir(), "agent.log");
    const s = startCli(fakeAgent(log));
    await s.waitFor(READY, 10000);
    s.sendKeys({ text: "hello" });
    await s.waitFor((p) => promptText(p)[0] === "hello", 5000);
    s.sendKeys("Enter");
    // The basic scenario stops at its permission request.
    await s.waitFor(REQUIRES_ACTION, 10000);
    await s.waitFor(CARD_HEADER, 5000);
    await Bun.sleep(100);
    await s.flush();
    expect(s.term.buffer.active.type).toBe("alternate");
    const screen = withoutBar(s.screenText());
    // The conversation follows the bottom: the end of the answer and both running tools are in
    // view above the activity bar, the docked permission card and the prompt box.
    expect(screen).toContain("  Before the escape sequence.After it, unharmed. Permission: execute rm -rf /");
    expect(screen).toContain("  ○ Thought · 11 words");
    expect(screen.some((l) => /^ {2}→ [▖▘▝▗] read {5}Read src\/index\.ts +#1$/.test(l))).toBe(true);
    expect(screen.some((l) => /^ {2}← [▖▘▝▗] edit {5}Edit src\/index\.ts +#2$/.test(l))).toBe(true);
    // The activity bar after its blank row; a blank row, the card with its padding rows and two
    // columns of padding, a blank row (day-one-feedback task group 13: a 24-row pane keeps every
    // gap with this card); the prompt box rests at one text row and its padding row with the card
    // open, its top border carrying the busy indicator, standing still while the request waits;
    // then the spacer, the status row and the bottom margin.
    expect(screen.slice(-17)).toEqual([
      "",
      "  2 running: Edit src/index.ts · awaiting permission",
      "",
      `╭─ ◊ Permission  edit  #2 ${"─".repeat(53)}╮`,
      `│${" ".repeat(78)}│`,
      `│  Edit src/index.ts${" ".repeat(59)}│`,
      `│  1 allow once   2 allow always   3 reject once${" ".repeat(31)}│`,
      `│${" ".repeat(78)}│`,
      `╰${"─".repeat(78)}╯`,
      "",
      expect.stringMatching(/^╭─[─━╼╾]{10,}╮$/),
      `│${" ".repeat(78)}│`,
      `│${" ".repeat(78)}│`,
      `╰${"─".repeat(78)}╯`,
      "",
      expect.stringMatching(/ requires_action  1-9 select .*connected$/),
      "",
    ]);
    // None of it reached the main screen.
    expect(await s.mainDiff()).toEqual([]);

    // Task 8.4: with a turn running, the first Ctrl+D asks for confirmation (the status row).
    s.sendKeys("Ctrl+D");
    await s.waitFor((p) => statusRow(p).includes("ctrl+d again to detach and stop the turn"), 5000);
    expect(s.exitCode).toBeNull();
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    await s.flush();
    expectRestored(s);
    // No resume line: fake-agent here cannot load or resume (mvp-sessions design decision 12).
    await expectMainScreen(s);
    const sent = methods(log);
    expect(sent).toContain("session/prompt");
    expect(sent).not.toContain("session/cancel");
    expect(sent).not.toContain("session/close");
  });

  // Skipped on Windows: it sends SIGTERM, which ends a Windows process outright instead of running its handler.
  test.skipIf(WINDOWS)("SIGTERM: exit code 143, terminal restored, main screen unchanged, no session/cancel or session/close", async () => {
    const log = join(tempDir(), "agent.log");
    const s = startCli(fakeAgent(log));
    await s.waitFor(READY, 10000);
    s.kill("SIGTERM");
    expect(await s.wait(10000)).toBe(143);
    await s.flush();
    expectRestored(s);
    // fake-agent here cannot load or resume, so nothing is printed (mvp-sessions design decision 12).
    await expectMainScreen(s);
    const sent = methods(log);
    expect(sent).not.toContain("session/cancel");
    expect(sent).not.toContain("session/close");
  });
});

describe("prompt errors and agent crashes on the full screen (spec tui-agent-session, task 4.6)", () => {
  // Skipped on Windows: it compares the main screen before and after the run (or the raw restore sequences), and ConPTY rewrites that output.
  test.skipIf(WINDOWS)("prompt error: the turn ends, idle again, the error as a line in the conversation", async () => {
    const log = join(tempDir(), "agent.log");
    const s = startCli(fakeAgent(log, "prompt-error"));
    await s.waitFor(READY, 10000);
    s.sendKeys({ text: "fail please" });
    await s.waitFor((p) => promptText(p)[0] === "fail please", 5000);
    s.sendKeys("Enter");
    await s.waitFor(/error: /, 10000);
    await Bun.sleep(100);
    await s.flush();
    const screen = s.screenText();
    const errors = screen.filter((l) => l.includes("error: "));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^ {2}error: .*prompt-error scenario always fails/);
    // In the conversation, above the prompt box; the status row is back to idle and connected.
    expect(screen.indexOf(errors[0]!)).toBeLessThan(screen.length - 4);
    expect(statusRow(s)).toMatch(/ idle .*connected$/);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    expectRestored(s);
  });

  // Skipped on Windows: it compares the main screen before and after the run (or the raw restore sequences), and ConPTY rewrites that output.
  test.skipIf(WINDOWS)("agent crashes mid-turn: the turn ends, `disconnected` in the status row, the exit code in the conversation, acp-tui stays open", async () => {
    const log = join(tempDir(), "agent.log");
    const s = startCli(fakeAgent(log, "crash"));
    await s.waitFor(READY, 10000);
    s.sendKeys({ text: "crash please" });
    await s.waitFor((p) => promptText(p)[0] === "crash please", 5000);
    s.sendKeys("Enter");
    await s.waitFor(/agent exited \(code 3\)/, 10000);
    await s.waitFor((p) => / idle .*disconnected$/.test(statusRow(p)), 5000);
    await Bun.sleep(300);
    await s.flush();
    const screen = s.screenText();
    expect(screen).toContain("  About to crash.");
    expect(screen).toContain("  agent exited (code 3)");
    expect(statusRow(s)).toMatch(/ idle .*disconnected$/);
    // Still open, on the alternate screen, until the user exits.
    expect(s.exitCode).toBeNull();
    expect(s.term.buffer.active.type).toBe("alternate");
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    await s.flush();
    expectRestored(s);
    // No resume line: fake-agent here cannot load or resume (mvp-sessions design decision 12).
    await expectMainScreen(s);
  });
});

describe("agent fails to start (spec tui-agent-session)", () => {
  // Skipped on Windows: it compares the main screen before and after the run (or the raw restore sequences), and ConPTY rewrites that output.
  test.skipIf(WINDOWS)("missing command: terminal restored, error names the command below the earlier lines, exit 1", async () => {
    const s = startCli(["acp-tui-no-such-agent"]); // after the separator the launcher keeps
    expect(await s.wait(10000)).toBe(1);
    await s.flush();
    expectRestored(s);
    await expectMainScreen(s, (extra) => expect(extra.join("\n")).toContain("acp-tui: could not start ad hoc harness command 'acp-tui-no-such-agent'"));
  });

  // Skipped on Windows: it compares the main screen before and after the run (or the raw restore sequences), and ConPTY rewrites that output.
  test.skipIf(WINDOWS)("agent exits before initialize: error names the command and quotes its stderr tail, exit 1", async () => {
    const s = startCli(["bun", "-e", "process.stderr.write('first line\\nlast line\\n'); process.exit(2)"]);
    expect(await s.wait(10000)).toBe(1);
    await s.flush();
    expectRestored(s);
    await expectMainScreen(s, (extra) => {
      const text = extra.join("\n");
      expect(text).toContain("acp-tui: ad hoc harness command 'bun -e");
      expect(text).toContain("exit code 2");
      expect(text).toContain("--- stderr (tail) ---\nfirst line\nlast line");
    });
  });
});
