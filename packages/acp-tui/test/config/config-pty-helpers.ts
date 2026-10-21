// Shared by config.pty.test.ts and config.pty.timing.test.ts (split by the change parallel-tests, tasks 3.x). Not a test file.
import { mkdirSync, mkdtempSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readEvents } from "../conversation/cli.ts";
import { startPty, type OscColours, type PtySession } from "../pty/harness.ts";

export const ROOT = resolve(import.meta.dir, "../../../..");
export const CLI = join(ROOT, "packages/acp-tui/src/cli.ts");
export const FAKE_AGENT = join(ROOT, "packages/fake-agent/src/main.ts");
export const DARK = { foreground: "#bcbec4", background: "#191a1c" } satisfies OscColours;

export const temp = (prefix: string) => realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), prefix)));

/** A configuration home; `write` saves the user's file as an editor does, by renaming a
 *  temporary file over it. */
export function configHome() {
  const home = temp("acp-tui-cfg-");
  const dir = join(home, "acp-tui");
  mkdirSync(dir);
  const file = join(dir, "config.jsonc");
  return {
    home,
    file,
    write(text: string) {
      const tmp = join(dir, `.config.jsonc.${Date.now()}.tmp`);
      writeFileSync(tmp, text);
      renameSync(tmp, file);
    },
  };
}

export interface Run {
  s: PtySession;
  dir: string;
  log: string;
  agentLog: string;
  events(name?: string): Record<string, unknown>[];
  agentMethods(): string[];
}

/** `acp-tui [args] -- fake-agent --scenario <scenario>` in `dir` (a new temporary directory by
 *  default), with XDG_CONFIG_HOME at `home` and the debug log on. */
export function start(opts: { home: string; scenario?: string; args?: string[]; agentArgs?: string[]; dir?: string; cols?: number; rows?: number; colours?: OscColours; agent?: string[] }): Run {
  const dir = opts.dir ?? temp("acp-tui-session-");
  const logDir = temp("acp-tui-log-");
  const log = join(logDir, "acp-tui.log");
  const agentLog = join(logDir, "agent.log");
  const agent = opts.agent ?? ["--", "bun", FAKE_AGENT, "--scenario", opts.scenario ?? "basic", "--delay-scale", "0", "--log", agentLog, ...(opts.agentArgs ?? [])];
  const s = startPty(["bun", CLI, "--", ...(opts.args ?? []), ...agent], {
    cols: opts.cols ?? 80,
    rows: opts.rows ?? 24,
    cwd: dir,
    env: { XDG_CONFIG_HOME: opts.home, ACP_TUI_LOG: log, ...(opts.colours ? { COLORTERM: "truecolor" } : {}) },
    ...(opts.colours ? { colours: opts.colours } : {}),
  });
  session = s;
  return {
    s,
    dir,
    log,
    agentLog,
    events: (name) => readEvents(log, name),
    agentMethods: () => readEvents(agentLog).map((e) => String(e["method"])),
  };
}

export const problemsLogged = (run: Run) => (run.events("config_loaded")[0]?.["problems"] ?? []) as { path: string; file: string; severity: string }[];

let session: PtySession | undefined;

/** For each test file's `afterEach`. */
export async function disposeSession(): Promise<void> {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
}
