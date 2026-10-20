// `--exit-print last-answer` and `--exit-print transcript`, with no `--spike`
// switch (phase-1a task 15.4; mvp-conversation task 7; design D3 and D12;
// decision 2). The real CLI against fake-agent's `copy-fixtures`, left with
// Ctrl+D; main-screen snapshots show the command line and what was above it
// intact, then the resume line (mvp-sessions design decision 12; fake-agent
// with `--load`), a blank line and the text as plain lines, wrapped at the
// width (or the text at once, when there is no resume line), and the cursor
// below them. The bytes after the final reset (the exit text)
// hold no escape sequence and no control character but CR and LF. Also under
// the harness's JediTerm emulation (PhpStorm's terminals: `CSI s` and `CSI u`
// ignored), at 60 columns, where the transcript is wrapped by acp-tui and no
// line of it is wrapped again by the terminal.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { shellQuote } from "../../src/renderer/exit-text.ts";
import { FINAL_RESET } from "../../src/renderer/lifecycle.ts";
import { plainLines } from "../../src/find/hand-back.ts";
import { startPty, type PtySession } from "../pty/harness.ts";
import { promptText, READY, REQUIRES_ACTION } from "../pty/regions.ts";

const ROOT = resolve(import.meta.dir, "../../../..");
const CLI = join(ROOT, "packages/acp-tui/src/cli.ts");
const FAKE_AGENT = join(ROOT, "packages/fake-agent/src/main.ts");
const PREFILL = "BEFORE-ACP-TUI\r\n\x1b[32mgreen line\x1b[0m\r\n$ acp-tui\r\n";
/** The first row below the command line. */
const BELOW = 3;
const golden = (name: string) => readFileSync(join(import.meta.dir, "../selection/golden", name), "utf8").replace(/\n$/, "");
const PROMPT = "give me things to copy";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

/** The agent command: fake-agent's `scenario` (default `copy-fixtures`), resumable (`--load`)
 *  unless `resumable` is false. */
function agentCommand(resumable: boolean, scenario = "copy-fixtures"): string[] {
  return ["bun", FAKE_AGENT, "--scenario", scenario, "--delay-scale", "0", ...(resumable ? ["--load"] : [])];
}

function start(args: string[], opts: { cols: number; terminal?: "jediterm"; resumable?: boolean; scenario?: string; env?: Record<string, string | undefined> }): { s: PtySession; dir: string } {
  const dir = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-handback-")));
  const agent = agentCommand(opts.resumable ?? true, opts.scenario);
  const s = startPty(["bun", CLI, ...args, "--", ...agent], { cols: opts.cols, rows: 30, cwd: dir, prefill: PREFILL, ...(opts.terminal ? { terminal: opts.terminal } : {}), ...(opts.env ? { env: opts.env } : {}) });
  session = s;
  return { s, dir };
}

/** Sends the prompt, waits for the answer, then leaves with Ctrl+D. */
async function converseAndExit(s: PtySession): Promise<void> {
  await s.waitFor(READY, 10000);
  s.sendKeys({ text: PROMPT });
  await s.waitFor((p) => (promptText(p)[0] ?? "").startsWith(PROMPT), 5000);
  s.sendKeys("Enter");
  await s.waitFor((p) => /end turn/.test(p.screenText().join("\n")) && READY.test(p.screenText().join("\n")), 15000);
  s.sendKeys("Ctrl+D");
  expect(await s.wait(10000)).toBe(0);
}

/** The main screen's rows below the command line, trailing blank rows dropped. */
async function rowsBelow(s: PtySession): Promise<string[]> {
  const before = (await s.mainBefore()).lines;
  const after = s.mainSnapshot().lines;
  expect(after.slice(0, BELOW)).toEqual(before.slice(0, BELOW));
  const rows = after.slice(BELOW);
  while (rows.length > 0 && rows.at(-1) === "") rows.pop();
  return rows;
}

/** The bytes written after the final reset: the exit text. Checks the reset and the single
 *  `CSI ? 1049 l` first. */
function exitBytes(s: PtySession): string {
  expect(s.term.buffer.active.type).toBe("normal");
  expect(s.mouseModesSet()).toEqual([]);
  expect(s.countModeChanges(1049, false)).toBe(1);
  const raw = s.rawOutput();
  const left = raw.lastIndexOf("\x1b[?1049l");
  const reset = raw.indexOf(FINAL_RESET, left);
  expect(reset).toBeGreaterThan(left);
  return raw.slice(reset + FINAL_RESET.length);
}

function expectPlain(bytes: string): void {
  expect(bytes).not.toContain("\x1b");
  // eslint-disable-next-line no-control-regex
  expect(/[\x00-\x09\x0b\x0c\x0e-\x1f\x7f\x80-\x9f]/.test(bytes)).toBe(false);
}

/** The resume line of the session every test here starts (an ad hoc agent: its command after `--`). */
const RESUME = `resume: acp-tui --resume fake-session-1 -- ${agentCommand(true).map(shellQuote).join(" ")}`;

/** `line` as the terminal wraps it at `cols` columns, each row without trailing spaces as the
 *  snapshot gives it (where a row ends at a space depends on the checkout's path). */
function wrapped(line: string, cols: number): string[] {
  return Array.from({ length: Math.ceil(line.length / cols) }, (_, k) => line.slice(k * cols, (k + 1) * cols).trimEnd());
}

describe("--exit-print last-answer and transcript (tasks 15.4, 7.2)", () => {
  test("transcript: the resume line, a blank line, then the conversation's plain text below the command line", async () => {
    const { s } = start(["--exit-print", "transcript"], { cols: 120 });
    await converseAndExit(s);
    const bytes = exitBytes(s);
    expectPlain(bytes);
    const lines = golden("conversation.txt").split("\n").map((l) => l.trimEnd());
    expect(await rowsBelow(s)).toEqual([...wrapped(RESUME, 120), "", ...lines]);
    // The cursor is at the start of the row after the text.
    expect(s.mainSnapshot().cursor.x).toBe(0);
    expect(bytes.replace(/\r/g, "")).toBe(`${RESUME}\n\n${lines.join("\n")}\n`);
  }, 60000);

  test("Transcript by default (mvp-configuration task 4.3): exit.print transcript in the user's file prints the resume line, a blank line and the transcript, with no option", async () => {
    const home = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-handback-config-")));
    mkdirSync(join(home, "acp-tui"));
    writeFileSync(join(home, "acp-tui", "config.jsonc"), `{ "exit": { "print": "transcript" } }`);
    const { s } = start([], { cols: 120, env: { XDG_CONFIG_HOME: home } });
    await converseAndExit(s);
    const bytes = exitBytes(s);
    const lines = golden("conversation.txt").split("\n").map((l) => l.trimEnd());
    expect(bytes.replace(/\r/g, "")).toBe(`${RESUME}\n\n${lines.join("\n")}\n`);
  }, 60000);

  test("last-answer: the resume line, a blank line, then the last agent answer", async () => {
    const { s } = start(["--exit-print", "last-answer"], { cols: 120 });
    await converseAndExit(s);
    expectPlain(exitBytes(s));
    expect(await rowsBelow(s)).toEqual([...wrapped(RESUME, 120), "", ...golden("list.txt").split("\n")]);
  }, 60000);

  test("last-answer without a resume line (an agent that cannot load): the answer at once, on the row below the command line", async () => {
    const { s } = start(["--exit-print", "last-answer"], { cols: 120, resumable: false });
    await converseAndExit(s);
    const bytes = exitBytes(s);
    expectPlain(bytes);
    const answer = golden("list.txt").split("\n");
    expect(await rowsBelow(s)).toEqual(answer);
    expect(bytes.replace(/\r/g, "")).toBe(`${answer.join("\n")}\n`);
  }, 60000);

  test("JediTerm emulation at 60 columns: the transcript is wrapped by acp-tui, below the command line", async () => {
    const cols = 60;
    const { s } = start(["--exit-print", "transcript"], { cols, terminal: "jediterm" });
    await converseAndExit(s);
    expectPlain(exitBytes(s));
    const text = plainLines(golden("conversation.txt"), cols);
    // The code's long line is wrapped at a space, within the width.
    expect(text.some((l) => l.startsWith("        return array_sum("))).toBe(true);
    expect(Math.max(...text.map((l) => l.length))).toBeLessThanOrEqual(cols);
    // The resume line is one line that the terminal wraps; the text's lines fit.
    const summaryRows = wrapped(RESUME, cols);
    const rows = await rowsBelow(s);
    expect(rows).toEqual([...summaryRows, "", ...text.map((l) => l.trimEnd())]);
    // No row of the text is a terminal soft wrap.
    const buffer = s.term.buffer.normal;
    const first = buffer.length - (s.mainSnapshot().lines.length - BELOW - summaryRows.length);
    for (let y = first; y < buffer.length; y++) expect(buffer.getLine(y)?.isWrapped ?? false).toBe(false);
  }, 60000);

  test("the default summary prints the resume line alone, no conversation text", async () => {
    const { s } = start([], { cols: 120 });
    await converseAndExit(s);
    expect(await rowsBelow(s)).toEqual(wrapped(RESUME, 120));
  }, 60000);

  test("No answer yet: last-answer before any agent message prints what summary would (here nothing: no prompt, so no resume line)", async () => {
    const { s } = start(["--exit-print", "last-answer"], { cols: 120 });
    await s.waitFor(READY, 10000);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    expect(exitBytes(s)).toBe("");
    expect(await rowsBelow(s)).toEqual([]);
  }, 60000);

  test("Hostile transcript: tool output with OSC 52 and bidi controls prints no ESC byte and no bidi control character", async () => {
    const { s } = start(["--exit-print", "transcript"], { cols: 120, scenario: "hostile" });
    await s.waitFor(READY, 10000);
    s.sendKeys({ text: PROMPT });
    await s.waitFor((p) => (promptText(p)[0] ?? "").startsWith(PROMPT), 5000);
    s.sendKeys("Enter");
    await s.waitFor(REQUIRES_ACTION, 15000);
    await Bun.sleep(450);
    s.sendKeys("1", "Enter");
    await s.waitFor((p) => /end turn/.test(p.screenText().join("\n")) && READY.test(p.screenText().join("\n")), 15000);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    const bytes = exitBytes(s);
    expectPlain(bytes);
    expect(/[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/.test(bytes)).toBe(false);
    // Something was printed after the resume line: the blank line and the conversation.
    const printed = bytes.replace(/\r/g, "");
    expect(printed.startsWith("resume: acp-tui --resume ")).toBe(true);
    expect(printed.split("\n").length).toBeGreaterThan(4);
  }, 60000);
});
