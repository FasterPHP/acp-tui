// PTY helpers for the palette, pickers and cards (phase-1a S6, promoted by
// mvp-chrome-and-keys). The real CLI (with any acp-tui options; no `--spike`
// since task 7.5) against fake-agent at PhpStorm reworked's pane size, 63x21,
// from a temporary directory, with acp-tui's debug log and fake-agent's own
// --log (methods and the answers it received).
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compactEnv } from "../pty/config-home.ts";
import { startPty, type OscColours, type PtySession } from "../pty/harness.ts";

const ROOT = resolve(import.meta.dir, "../../../..");
const CLI = join(ROOT, "packages/acp-tui/src/cli.ts");
const FAKE_AGENT = join(ROOT, "packages/fake-agent/src/main.ts");

export const SIZE = { cols: 63, rows: 21 } as const;

export interface ChromeRun {
  s: PtySession;
  /** fake-agent's log: `{ method, params }` per received method (and the client's answers). */
  agent(): { method: string; params: unknown }[];
  /** acp-tui's debug log events, optionally of one name. */
  events(name?: string): Record<string, unknown>[];
}

export interface ChromeOptions {
  scenario: string;
  delayScale?: number;
  cols?: number;
  rows?: number;
  /** acp-tui options before `--`; default none. */
  args?: string[];
  colours?: OscColours;
  env?: Record<string, string | undefined>;
  /** The terminal the harness imitates (test/pty/jediterm.ts); default `xterm`. */
  terminal?: "xterm" | "jediterm";
  /** The directory acp-tui is started in (the session's `cwd`); default the run's own temporary
   *  directory, which holds the logs either way. */
  cwd?: string;
}

function readLines(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

export function startChrome(opts: ChromeOptions): ChromeRun {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-chrome-"));
  const agentLog = join(dir, "fake-agent.log");
  const appLog = join(dir, "acp-tui.log");
  const args = opts.args ?? [];
  const cmd = ["bun", CLI, ...args, "--", "bun", FAKE_AGENT, "--scenario", opts.scenario, "--delay-scale", String(opts.delayScale ?? 0), "--log", agentLog];
  const s = startPty(cmd, {
    cols: opts.cols ?? SIZE.cols,
    rows: opts.rows ?? SIZE.rows,
    cwd: opts.cwd ?? dir,
    env: { ...compactEnv(), ACP_TUI_LOG: appLog, ...opts.env },
    ...(opts.colours ? { colours: opts.colours } : {}),
    ...(opts.terminal ? { terminal: opts.terminal } : {}),
  });
  return {
    s,
    agent: () => readLines(agentLog) as { method: string; params: unknown }[],
    events: (name) => readLines(appLog).filter((e) => name === undefined || e["event"] === name),
  };
}

/** Screen row index of the first row containing `text`, or -1. */
export const rowOf = (s: PtySession, text: string | RegExp) =>
  s.screenText().findIndex((r) => (typeof text === "string" ? r.includes(text) : text.test(r)));

/** The rows of a framed box whose top border contains `title`, borders included. */
export function boxRows(s: PtySession, title: string | RegExp): string[] {
  const rows = s.screenText();
  const top = rows.findIndex((r) => r.startsWith("╭") && (typeof title === "string" ? r.includes(title) : title.test(r)));
  if (top < 0) return [];
  const bottom = rows.findIndex((r, y) => y > top && r.startsWith("╰"));
  return bottom < 0 ? [] : rows.slice(top, bottom + 1);
}

/** A framed row's text: `│ text │` without the frame, right-trimmed. */
export const inner = (row: string) => row.replace(/^│ ?/, "").replace(/ ?│$/, "").trimEnd();
