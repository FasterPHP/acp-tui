// Shared set-up for the conversation PTY tests: the real acp-tui CLI against
// fake-agent, run from a temporary directory, with the debug log enabled. The
// main screen is prefilled, so `mainDiff()` can show that acp-tui left it as
// it was.
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compactEnv } from "../pty/config-home.ts";
import { startPty, type OscColours, type PtySession } from "../pty/harness.ts";
import { promptText, READY, REQUIRES_ACTION, withoutBar } from "../pty/regions.ts";

const ROOT = resolve(import.meta.dir, "../../../..");
export const CLI = join(ROOT, "packages/acp-tui/src/cli.ts");
export const FAKE_AGENT = join(ROOT, "packages/fake-agent/src/main.ts");
/** On the main screen before acp-tui starts. */
export const PREFILL = "$ acp-tui\r\n";

export interface CliRun {
  session: PtySession;
  /** The acp-tui debug log (ACP_TUI_LOG). */
  logPath: string;
  events(name?: string): Record<string, unknown>[];
  /** Methods fake-agent received, from its --log. */
  agentMethods(): string[];
}

export interface StartOptions {
  scenario: string;
  delayScale?: number;
  cols?: number;
  rows?: number;
  /** Extra acp-tui arguments (before `--`). */
  args?: string[];
  /** Extra fake-agent arguments (for example `--items 200`). */
  agentArgs?: string[];
  /** OSC 10 and 11 replies, for truecolour surfaces; without them the theme is flat. */
  colours?: OscColours;
  /** Extra environment (`undefined` removes a variable), for example the terminal's identity. */
  env?: Record<string, string | undefined>;
  /** Replaces the CLI entry point (a test script that wraps `main`). */
  entry?: string;
}

function tempDir(): string {
  return mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-conversation-"));
}

export function readEvents(logPath: string, name?: string): Record<string, unknown>[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((e) => name === undefined || e["event"] === name);
}

export function startCli(opts: StartOptions): CliRun {
  const dir = tempDir();
  const logPath = join(dir, "acp-tui.log");
  const agentLog = join(dir, "fake-agent.log");
  const agent = ["bun", FAKE_AGENT, "--scenario", opts.scenario, "--delay-scale", String(opts.delayScale ?? 0), "--log", agentLog, ...(opts.agentArgs ?? [])];
  const session = startPty(["bun", opts.entry ?? CLI, "--", ...(opts.args ?? []), "--", ...agent], {
    cols: opts.cols ?? 100,
    rows: opts.rows ?? 60,
    cwd: dir,
    env: { ...compactEnv(), ACP_TUI_LOG: logPath, ...(opts.colours ? { COLORTERM: "truecolor" } : {}), ...opts.env },
    colours: opts.colours,
    prefill: PREFILL,
  });
  const agentMethods = () => readEvents(agentLog).map((e) => String(e["method"]));
  return { session, logPath, events: (name) => readEvents(logPath, name), agentMethods };
}

/** Types a prompt and submits it once the session is idle. */
export async function sendPrompt(s: PtySession, text: string): Promise<void> {
  await s.waitFor(READY, 15000);
  s.sendKeys({ text });
  await s.waitFor((p) => (promptText(p)[0] ?? "").startsWith(text.slice(0, 20)), 5000);
  s.sendKeys("Enter");
}

/** Answers the open permission card with option `n`: the digit selects, Enter confirms (after
 *  the card's 300 ms key guard). */
export async function answerPermission(s: PtySession, n: "1" | "2" | "3"): Promise<void> {
  await s.waitFor(REQUIRES_ACTION, 10000);
  await Bun.sleep(450);
  s.sendKeys(n, "Enter");
}

/** Visible rows equal to (or matching) `line`, after trimming the right (and the flat theme's
 *  scroll bar glyph, `withoutBar`). */
export function count(s: PtySession, line: string | RegExp): number {
  return withoutBar(s.screenText()).filter((l) => (typeof line === "string" ? l === line : line.test(l))).length;
}

/** Waits for the renderer to write out, then for the screen to stop changing. */
export async function settle(s: PtySession, ms = 250): Promise<void> {
  let before = "";
  for (let i = 0; i < 40; i++) {
    await Bun.sleep(ms);
    await s.flush();
    const now = s.screenText().join("\n");
    if (now === before) return;
    before = now;
  }
}
