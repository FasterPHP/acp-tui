// A scratch world for the session list's PTY tests (mvp-sessions task group
// 7): its own XDG_CONFIG_HOME (a `config.jsonc` with fake-agent entries in
// `agent_servers`, and `auggie` and `claude` overridden by fake-agent commands, so
// neither real harness is launched and the list's rows never depend on the machine) and XDG_STATE_HOME (the session
// index), fake-agent session fixtures in directories that exist, and one
// fake-agent log per agent name, recording every method each received
// (`session/close` and `session/cancel` included).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openSessionIndex, type RecordInput, type SessionIndex } from "../../src/session/session-index.ts";
import { startPty, type OscColours, type PtySession } from "../pty/harness.ts";

export const ROOT = resolve(import.meta.dir, "../../../..");
export const CLI = join(ROOT, "packages/acp-tui/src/cli.ts");
export const FAKE_AGENT = join(ROOT, "packages/fake-agent/src/main.ts");
export const PREFILL = "$ acp-tui\r\n";

export interface Received {
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export interface ListWorld {
  readonly base: string;
  readonly env: Record<string, string>;
  readonly stateHome: string;
  /** Makes a directory below `base` (absolute, resolved). */
  dir(name: string): string;
  /** Writes a fake-agent session store fixture; returns its path. */
  sessions(name: string, list: unknown[]): string;
  /** fake-agent's command logging to the log of `name`, with these arguments. */
  fake(name: string, args: readonly string[]): string[];
  /** Writes `config.jsonc`: one `agent_servers` entry per name, each fake-agent with its
   *  arguments (absolute paths), and `auggie` and `claude` too unless given, so nothing launches the real
   *  agent. */
  configure(agents: Readonly<Record<string, readonly string[]>>, extra?: Record<string, unknown>): void;
  /** The methods (and parameters) the agent `name` received, in order (every process of it). */
  received(name: string): Received[];
  /** acp-tui's debug log events (`ACP_TUI_LOG`), optionally of one name. */
  events(name?: string): Record<string, unknown>[];
  /** The session index of this world. */
  index(): SessionIndex;
  /** Records sessions in the index. */
  record(...inputs: RecordInput[]): void;
  /** Starts acp-tui under a PTY from `cwd` (default `base`). */
  start(args: readonly string[], options?: { cwd?: string; cols?: number; rows?: number; colours?: OscColours }): PtySession;
}

export function listWorld(): ListWorld {
  const base = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-list-")));
  const configHome = join(base, "config");
  const stateHome = join(base, "state");
  mkdirSync(join(configHome, "acp-tui"), { recursive: true });
  const log = (name: string) => join(base, `agent-${name.replace(/[^a-z0-9]/gi, "_")}.log`);
  const fake = (name: string, args: readonly string[]) => ["bun", FAKE_AGENT, "--delay-scale", "0", "--log", log(name), ...args];
  const world: ListWorld = {
    base,
    env: { XDG_CONFIG_HOME: configHome, XDG_STATE_HOME: stateHome, ACP_TUI_LOG: join(base, "acp-tui.log") },
    stateHome,
    dir(name) {
      const path = join(base, name);
      mkdirSync(path, { recursive: true });
      return path;
    },
    sessions(name, list) {
      const path = join(base, `${name}.json`);
      writeFileSync(path, JSON.stringify({ sessions: list }));
      return path;
    },
    fake,
    configure(agents, extra = {}) {
      const all: Record<string, readonly string[]> = { auggie: ["--scenario", "basic"], claude: ["--scenario", "basic"], ...agents };
      const servers = Object.fromEntries(
        Object.entries(all).map(([name, args]) => {
          const [command, ...rest] = fake(name, args);
          return [name, { command, args: rest }];
        }),
      );
      writeFileSync(join(configHome, "acp-tui", "config.jsonc"), JSON.stringify({ density: "compact", agent_servers: servers, ...extra }));
    },
    received(name) {
      const path = log(name);
      if (!existsSync(path)) return [];
      return readFileSync(path, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Received);
    },
    events(name) {
      const path = join(base, "acp-tui.log");
      if (!existsSync(path)) return [];
      return readFileSync(path, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((e) => name === undefined || e["event"] === name);
    },
    index: () => openSessionIndex({ stateHome }),
    record(...inputs) {
      const index = openSessionIndex({ stateHome });
      for (const input of inputs) index.record(input);
    },
    start(args, options = {}) {
      return startPty(["bun", CLI, ...args], {
        cols: options.cols ?? 100,
        rows: options.rows ?? 30,
        cwd: options.cwd ?? base,
        // With colours, a truecolour terminal, so the surfaces are filled.
        env: { ...world.env, ...(options.colours ? { COLORTERM: "truecolor" } : {}) },
        prefill: PREFILL,
        ...(options.colours ? { colours: options.colours } : {}),
      });
    },
  };
  return world;
}

/** The rows of the session list (borders included), or none while it is closed. */
export function listRows(s: PtySession): string[] {
  const rows = s.screenText();
  const top = rows.findIndex((r) => r.startsWith("╭─ Sessions"));
  if (top < 0) return [];
  const bottom = rows.findIndex((r, y) => y > top && r.startsWith("╰"));
  return bottom < 0 ? [] : rows.slice(top, bottom + 1);
}

/** A framed row's text, without the frame, right-trimmed. */
export const unframe = (row: string) => row.replace(/^│ ?/, "").replace(/ ?│$/, "").trimEnd();

/** The list's body rows (filter field, entries, footer), without the frame. */
export function listBody(s: PtySession): string[] {
  return listRows(s).slice(1, -1).map(unframe);
}

/** The main screen once acp-tui has exited, as text; rows joined without a break, so a message the
 *  terminal wrapped reads whole. */
export function mainText(s: PtySession): string {
  return s.screenText().join("");
}
