// Shared helpers for the keys, prompt box and permission card PTY tests: the
// real CLI, run from a temporary directory, against fake-agent with a log, at
// 80x24 unless given a size. The screen's regions are read with
// test/pty/regions.ts.
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compactEnv } from "../pty/config-home.ts";
import { startPty, type OscColours, type PtySession } from "../pty/harness.ts";

const ROOT = resolve(import.meta.dir, "../../../..");
const CLI = join(ROOT, "packages/acp-tui/src/cli.ts");
const FAKE_AGENT = join(ROOT, "packages/fake-agent/src/main.ts");

export function tempDir(): string {
  return mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-keys-"));
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
  const args = [opts.entry ?? CLI, ...(opts.args ?? []), "--", "bun", FAKE_AGENT, "--scenario", scenario, "--delay-scale", String(delayScale), "--log", log];
  const s = startPty(["bun", ...args], { cols: opts.cols ?? 80, rows: opts.rows ?? 24, cwd: tempDir(), env: { ...compactEnv(), ...opts.env }, colours: opts.colours });
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
