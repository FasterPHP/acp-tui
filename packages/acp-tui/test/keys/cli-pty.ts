// Shared helpers for the keys, prompt box and permission card PTY tests: the
// real CLI, run from a temporary directory, against fake-agent with a log, at
// 80x24 unless given a size. The screen's regions are read with
// test/pty/regions.ts.
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compactEnv } from "../pty/config-home.ts";
import { startPty, type OscColours, type PtySession } from "../pty/harness.ts";
import { homeEnv, WINDOWS } from "../windows.ts";

const ROOT = resolve(import.meta.dir, "../../../..");
const CLI = join(ROOT, "packages/acp-tui/src/cli.ts");
const FAKE_AGENT = join(ROOT, "packages/fake-agent/src/main.ts");

const TEMP_ROOT = process.env.TMPDIR ?? tmpdir();

export function tempDir(): string {
  return mkdtempSync(join(TEMP_ROOT, "acp-tui-keys-"));
}

// On Windows the temporary directory is inside the profile, so the session directory reads
// `~\AppData\Local\Temp\acp-tui-keys-…`, 15 columns longer than `/tmp/acp-tui-keys-…`, and the
// status row drops modules the tests read. With the temporary directory as the home it reads
// `~\acp-tui-keys-…` there, as short as on Linux.
const SHORT_HOME: Record<string, string> = WINDOWS ? homeEnv(TEMP_ROOT) : {};

/** The home directory the CLI started by `startCli` sees, for paths it shows with `~`. */
export function cliHome(): string {
  return WINDOWS ? TEMP_ROOT : process.env.HOME || homedir();
}

export interface LogEntry {
  method: string;
  params: unknown;
}

export interface CliRun {
  s: PtySession;
  log: string;
  entries(): LogEntry[];
  methods(): string[];
}

export interface StartCliOptions {
  cols?: number;
  rows?: number;
  /** Replaces the CLI entry point (a test script that wraps `main`, for example with a layout). */
  entry?: string;
  env?: Record<string, string | undefined>;
  /** acp-tui options before `--` (for example `--mouse off`). */
  args?: string[];
  /** OSC 10 and 11 replies (surfaces derived); default: none (the flat theme). */
  colours?: OscColours;
}

/** Starts `acp-tui -- fake-agent --scenario <scenario> --delay-scale <scale> --log <log>`. */
export function startCli(scenario = "basic", delayScale = 0, opts: StartCliOptions = {}): CliRun {
  const log = join(tempDir(), "agent.log");
  const args = [opts.entry ?? CLI, "--", ...(opts.args ?? []), "--", "bun", FAKE_AGENT, "--scenario", scenario, "--delay-scale", String(delayScale), "--log", log];
  const s = startPty(["bun", ...args], { cols: opts.cols ?? 80, rows: opts.rows ?? 24, cwd: tempDir(), env: { ...compactEnv(), ...SHORT_HOME, ...opts.env }, colours: opts.colours });
  const entries = (): LogEntry[] =>
    existsSync(log)
      ? readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as LogEntry)
      : [];
  return { s, log, entries, methods: () => entries().map((e) => e.method) };
}
