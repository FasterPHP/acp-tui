// Phase-1a tasks 4.1 to 4.3 (design D3, spec tui-screen "Terminal restored on
// every exit path" and "Exit text below the command line"): the real acp-tui
// CLI against fake-agent under the PTY harness, left by every exit path. Each
// path checks the mode tracker (no mouse mode set, the alternate screen left
// exactly once), that nothing clears the main screen after leaving the
// alternate screen, that the main screen above the command line is as it was,
// and where the cursor is: the start of the row below the command line or
// below the exit text. Since mvp-sessions task 12.2 the exit text is the resume
// line alone, and only for a session that can be resumed and had a prompt.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { shellQuote } from "../../src/renderer/exit-text.ts";
import { FINAL_RESET } from "../../src/renderer/lifecycle.ts";
import { startPty, type PtySession } from "../pty/harness.ts";
import { promptText, READY, REQUIRES_ACTION } from "../pty/regions.ts";
import { WINDOWS } from "../windows.ts";

const ROOT = resolve(import.meta.dir, "../../../..");
const CLI = join(ROOT, "packages/acp-tui/src/cli.ts");
const FAKE_AGENT = join(ROOT, "packages/fake-agent/src/main.ts");
/** The main screen before start: earlier output, then the command line (rows 0 to 2). */
const PREFILL = "BEFORE-ACP-TUI\r\n\x1b[32mgreen line\x1b[0m\r\n$ acp-tui\r\n";
/** The first row below the command line. */
const BELOW = 3;
const F12 = "\x1b[24~";

let session: PtySession | undefined;
afterEach(async () => {
  await session?.dispose();
  session = undefined;
});

interface Started {
  s: PtySession;
  dir: string;
  /** fake-agent's own log: the methods acp-tui sent. */
  agentLog: string;
  /** The agent command acp-tui was given after `--`. */
  agent: string[];
}

/** `agentArgs` are added to fake-agent's (`--load` makes the session resumable). */
function start(opts: { scenario?: string; args?: string[]; agent?: string[]; agentArgs?: string[]; env?: Record<string, string> } = {}): Started {
  const dir = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-exit-")));
  const agentLog = join(dir, "agent.log");
  const agent = opts.agent ?? ["bun", FAKE_AGENT, "--scenario", opts.scenario ?? "basic", "--delay-scale", "0", "--log", agentLog, ...(opts.agentArgs ?? [])];
  const s = startPty(["bun", CLI, "--", ...(opts.args ?? []), "--", ...agent], { cols: 100, rows: 24, cwd: dir, prefill: PREFILL, ...(opts.env ? { env: opts.env } : {}) });
  session = s;
  return { s, dir, agentLog, agent };
}

async function ready(s: PtySession): Promise<void> {
  await s.waitFor(READY, 10000);
  await Bun.sleep(100);
  await s.flush();
  expect(s.term.buffer.active.type).toBe("alternate");
}

function methods(log: string): string[] {
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => (JSON.parse(line) as { method: string }).method);
}

/** Restored, with nothing cleared; returns the rows written below the command line. */
async function expectRestored(s: PtySession): Promise<string[]> {
  const raw = s.rawOutput();
  expect(s.term.buffer.active.type).toBe("normal");
  expect(s.mouseModesSet()).toEqual([]);
  expect(s.modesSet()).not.toContain(1049);
  expect(s.modesSet()).not.toContain(2031);
  // Task 4.2: left once; a second `CSI ? 1049 l` would restore the saved cursor again.
  expect(s.countModeChanges(1049, false)).toBe(1);
  const left = raw.lastIndexOf("\x1b[?1049l");
  expect(raw.slice(left)).not.toContain("\x1b[2J");
  expect(raw).not.toContain("\x1b[3J");
  expect(raw.slice(left)).toContain(FINAL_RESET);
  const before = (await s.mainBefore()).lines;
  const after = s.mainSnapshot().lines;
  expect(after.slice(0, BELOW)).toEqual(before.slice(0, BELOW));
  return after.slice(BELOW).filter((l) => l !== "");
}

/** The cursor at the start of the row after the command line and `rows` more. */
function expectCursorBelow(s: PtySession, rows: number): void {
  expect(s.mainSnapshot().cursor).toEqual({ x: 0, y: BELOW + rows });
}

/** The resume line for fake-agent's first session, started with `agent` after `--` (mvp-sessions
 *  design decision 12). */
function resumeLine(agent: readonly string[]): string {
  return `resume: acp-tui --resume fake-session-1 -- ${agent.map((word) => shellQuote(word)).join(" ")}`;
}

/** Everything written after the final reset: the exit text, then any error. */
function afterReset(s: PtySession): string {
  const raw = s.rawOutput();
  return raw.slice(raw.lastIndexOf(FINAL_RESET) + FINAL_RESET.length);
}

describe("every exit path restores the terminal (task 4.1)", () => {
  // Without a prompt there is no session to resume, so nothing is printed (mvp-sessions design
  // decision 12): the cursor stays on the row below the command line.
  // Skipped on Windows: it compares the main screen and the raw restore sequences of the PTY stream (ConPTY clears, repaints and rewrites them), or sends POSIX signals.
  test.skipIf(WINDOWS)("Ctrl+D: status 0, nothing below the command line", async () => {
    const { s, agentLog } = start();
    await ready(s);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    expect(await expectRestored(s)).toEqual([]);
    expectCursorBelow(s, 0);
    expect(methods(agentLog)).toEqual(["initialize", "session/new"]);
  });

  for (const [signal, code] of [
    ["SIGHUP", 129],
    ["SIGTERM", 143],
    ["SIGINT", 130],
    ["SIGQUIT", 131],
  ] as const) {
    // Skipped on Windows: it compares the main screen and the raw restore sequences of the PTY stream (ConPTY clears, repaints and rewrites them), or sends POSIX signals.
    test.skipIf(WINDOWS)(`${signal}: status ${code}, detached without session/cancel or session/close`, async () => {
      const { s, agentLog } = start();
      await ready(s);
      s.kill(signal);
      expect(await s.wait(10000)).toBe(code);
      expect(await expectRestored(s)).toEqual([]);
      expectCursorBelow(s, 0);
      const sent = methods(agentLog);
      expect(sent).not.toContain("session/cancel");
      expect(sent).not.toContain("session/close");
    });
  }

  // Skipped on Windows: it compares the main screen and the raw restore sequences of the PTY stream (ConPTY clears, repaints and rewrites them), or sends POSIX signals.
  test.skipIf(WINDOWS)("start-up failure: status 1, the error below the command line, no resume line", async () => {
    const { s } = start({ agent: ["--", "acp-tui-no-such-agent"] });
    expect(await s.wait(10000)).toBe(1);
    const rows = await expectRestored(s);
    expect(rows.join("\n")).toContain("acp-tui: could not start ad hoc harness command 'acp-tui-no-such-agent'");
    expect(rows.join("\n")).not.toContain("resume:");
    expectCursorBelow(s, rows.length);
  });

  // Skipped on Windows: it compares the main screen and the raw restore sequences of the PTY stream (ConPTY clears, repaints and rewrites them), or sends POSIX signals.
  test.skipIf(WINDOWS)("uncaught error during a turn (the crash test hook, ACP_TUI_TEST_HOOKS=crash, F12): status 1, the resume line then the error, nothing sent", async () => {
    // `--load`: the session can be resumed, and it had a prompt.
    const { s, agentLog, agent } = start({ env: { ACP_TUI_TEST_HOOKS: "crash" }, agentArgs: ["--load"] });
    await ready(s);
    s.sendKeys({ text: "hello" });
    await s.waitFor((p) => promptText(p)[0] === "hello", 5000);
    s.sendKeys("Enter");
    // The basic scenario stops at its permission request: the turn is still running.
    await s.waitFor(REQUIRES_ACTION, 10000);
    s.sendKeys({ text: F12 });
    expect(await s.wait(10000)).toBe(1);
    const rows = await expectRestored(s);
    // The resume line (wrapped by the terminal at 100 columns), then the error's line.
    // The crash report's line follows the error (its path is in a temporary state directory).
    expect(afterReset(s)).toMatch(new RegExp(`^\\r${resumeLine(agent).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\r\\n\\racp-tui: uncaught error: crash test hook: F12 pressed\\r\\ncrash report: \\S+\\.txt \\(attach it when you report this\\)\\r\\n$`));
    expect(rows.join("")).toStartWith(resumeLine(agent));
    expect(rows.join("")).toContain("acp-tui: uncaught error: crash test hook: F12 pressed");
    expectCursorBelow(s, rows.length);
    const sent = methods(agentLog);
    expect(sent).toContain("session/prompt");
    expect(sent).not.toContain("session/cancel");
    expect(sent).not.toContain("session/close");
  });

  // Spec tui-screen "Crash report".
  describe("crash report", () => {
    const stateEnv = (): { state: string; env: Record<string, string> } => {
      const state = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-state-")));
      return { state, env: { ACP_TUI_TEST_HOOKS: "crash", XDG_STATE_HOME: state } };
    };
    const crashed = async (s: PtySession): Promise<void> => {
      await ready(s);
      s.sendKeys({ text: F12 });
      expect(await s.wait(10000)).toBe(1);
    };
    const reportPath = (s: PtySession): string => /crash report: (\S+\.txt) \(attach it when you report this\)/.exec(s.rawOutput().replace(/\r?\n/g, ""))?.[1] ?? "";

    test.skipIf(WINDOWS)("Crash with a report: the exit text names the file, which holds the version, the error, a stack and the launch event", async () => {
      const { state, env } = stateEnv();
      const { s } = start({ env });
      await crashed(s);
      const path = reportPath(s);
      expect(path.startsWith(join(state, "acp-tui", "crashes") + "/")).toBe(true);
      expect(path).toMatch(/\/\d{8}T\d{6}Z\.txt$/);
      const text = readFileSync(path, "utf8");
      expect(text).toMatch(/^acp-tui 0\.1\.0/);
      expect(text).toContain("error: crash test hook: F12 pressed");
      expect(text).toMatch(/\n\s+at /);
      expect(text).toContain('"event":"launch"');
      expect(statSync(path).mode & 0o777).toBe(0o600);
    });

    test.skipIf(WINDOWS)("No conversation text: a prompt and an answer holding zebra-secret stay out of the report", async () => {
      const { env } = stateEnv();
      const { s } = start({ env, scenario: "secret-echo" });
      await ready(s);
      s.sendKeys({ text: "zebra-secret" });
      await s.waitFor((p) => promptText(p)[0] === "zebra-secret", 5000);
      s.sendKeys("Enter");
      await s.waitFor("The answer holds zebra-secret.", 10000);
      s.sendKeys({ text: F12 });
      expect(await s.wait(10000)).toBe(1);
      const path = reportPath(s);
      expect(path).not.toBe("");
      const text = readFileSync(path, "utf8");
      expect(text).toContain('"event":"launch"');
      expect(text).not.toContain("zebra-secret");
    });

    test.skipIf(WINDOWS)("State directory not writable: the exit text holds the message and the stack", async () => {
      const { state, env } = stateEnv();
      // `acp-tui` is a file, so `crashes/` cannot be created below it.
      writeFileSync(join(state, "acp-tui"), "not a directory");
      const { s } = start({ env });
      await crashed(s);
      const out = s.rawOutput();
      expect(out).toContain("acp-tui: uncaught error: crash test hook: F12 pressed");
      expect(out).not.toContain("crash report:");
      expect(out).toMatch(/\n\s+at /);
    });

    test.skipIf(WINDOWS)("Start-up failure is not a crash: a harness that does not exist writes no report", async () => {
      const { state, env } = stateEnv();
      const { s } = start({ env, agent: ["acp-tui-no-such-harness-command"] });
      expect(await s.wait(15000)).toBe(1);
      expect(existsSync(join(state, "acp-tui", "crashes"))).toBe(false);
      expect(s.rawOutput()).not.toContain("crash report:");
    });
  });

  // Spec tui-config "Spike switch retired": the forced error is reached only by the test hook, never
  // from the command line (the old `--spike crash`), the configuration or the retired ACP_TUI_SPIKES.
  const unreachable: [string, Parameters<typeof start>[0]][] = [
    ["a normal session", {}],
    ["the old --spike crash", { args: ["--spike", "crash"] }],
    ["ACP_TUI_SPIKES=crash", { env: { ACP_TUI_SPIKES: "crash" } }],
  ];
  for (const [what, opts] of unreachable) {
    test(`Crash hook unreachable: F12 in ${what} throws nothing and acp-tui keeps running`, async () => {
      const { s } = start(opts);
      await ready(s);
      s.sendKeys({ text: F12 });
      await Bun.sleep(300);
      expect(s.exitCode).toBeNull();
      expect(s.screenText().join("\n")).not.toContain("crash test hook");
      s.sendKeys("Ctrl+D");
      expect(await s.wait(10000)).toBe(0);
      expect(s.rawOutput()).not.toContain("uncaught error");
    });
  }
});

// Skipped on Windows: every test compares the main screen and the raw restore sequences of the PTY stream (ConPTY rewrites them) or sends POSIX signals.
describe.skipIf(WINDOWS)("exit text below the command line (task 4.3)", () => {
  test("Summary in the main screen: after a prompt, the resume line alone on the rows after the command line", async () => {
    const { s, agent } = start({ scenario: "copy-fixtures", agentArgs: ["--load"] });
    await ready(s);
    s.sendKeys({ text: "hello" });
    await s.waitFor((p) => promptText(p)[0] === "hello", 5000);
    s.sendKeys("Enter");
    await s.waitFor("end turn", 10000);
    await s.waitFor(READY, 10000);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    const rows = await expectRestored(s);
    const after = s.mainSnapshot().lines;
    expect(after.slice(0, BELOW)).toEqual(["BEFORE-ACP-TUI", "green line", "$ acp-tui"]);
    // One line, which the terminal wraps at 100 columns; no summary line.
    expect(rows.join("")).toBe(resumeLine(agent));
    expect(rows.join("")).not.toContain("acp-tui: session");
    expectCursorBelow(s, rows.length);
    // Plain text: nothing between the final reset and the end of the output but the line itself.
    expect(afterReset(s)).toBe(`\r${resumeLine(agent)}\r\n`);
  });

  test("Nothing without a prompt: the main screen exactly as before, even for an agent that can load", async () => {
    const { s } = start({ agentArgs: ["--load"] });
    await ready(s);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    expect(await expectRestored(s)).toEqual([]);
    expect(afterReset(s)).toBe("");
    expect(await s.mainDiff()).toEqual([]);
    expectCursorBelow(s, 0);
  });

  test("Nothing for an agent that cannot resume, after a prompt", async () => {
    const { s } = start({ scenario: "copy-fixtures" });
    await ready(s);
    s.sendKeys({ text: "hello" });
    await s.waitFor((p) => promptText(p)[0] === "hello", 5000);
    s.sendKeys("Enter");
    await s.waitFor("end turn", 10000);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    expect(await expectRestored(s)).toEqual([]);
    expect(afterReset(s)).toBe("");
  });

  test("--exit-print none: the main screen exactly as before, the cursor below the command line", async () => {
    const { s } = start({ args: ["--exit-print", "none"] });
    await ready(s);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    expect(await expectRestored(s)).toEqual([]);
    expect(await s.mainDiff()).toEqual([]);
    expectCursorBelow(s, 0);
  });

  test("hostile agent name: never printed; the exit text names no agent and holds no ESC byte", async () => {
    // `--load` with no prompt: the session cannot be resumed, so nothing at all is printed, and
    // the agent's name (the hostile corpus) is never part of the exit text (design decision 12).
    const { s } = start({ scenario: "hostile", agentArgs: ["--load"] });
    await ready(s);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    await expectRestored(s);
    const text = afterReset(s);
    expect(text).toBe("");
    expect(await s.mainDiff()).toEqual([]);
  });
});
