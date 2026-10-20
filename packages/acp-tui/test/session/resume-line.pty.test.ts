// mvp-sessions task 8.2: the exit text's resume line really runs (spec
// tui-screen "Resume line runs"), under a PTY. A session is started in `repo-b`
// against fake-agent with `--load --persist`, one prompt is answered, and
// acp-tui detaches with Ctrl+D. The command after `resume: ` is then run as
// printed, by `sh -c`, from another directory (the only adaptation: an
// `acp-tui` wrapper script on PATH runs the CLI). It must open the same session
// by `session/load` in `repo-b`, with the earlier prompt in the conversation
// and `repo-b` on the status row. Both runs of each test share XDG_CONFIG_HOME
// and XDG_STATE_HOME, so the session index is shared; the store is a temporary
// file, never the shipped fixture. Named agent and ad hoc agent (quoted for a
// POSIX shell) are one test each.
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startPty, type PtySession } from "../pty/harness.ts";
import { READY, statusRow } from "../pty/regions.ts";
import { WINDOWS } from "../windows.ts";

const ROOT = resolve(import.meta.dir, "../../../..");
const CLI = join(ROOT, "packages/acp-tui/src/cli.ts");
const FAKE_AGENT = join(ROOT, "packages/fake-agent/src/main.ts");
const PREFILL = "$ acp-tui\r\n";
const TIMEOUT = 60000;
const PROMPT = "resume me please";
/** Text the `copy-fixtures` scenario answers every prompt with (and which a load replays). */
const ANSWER = "InvoiceTotal";

const sessions: PtySession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.dispose()));
});

interface Received {
  method: string;
  params?: Record<string, unknown>;
}

interface World {
  base: string;
  repoB: string;
  elsewhere: string;
  /** A directory whose name holds a space, so the quoting of paths in the resume line is exercised. */
  spaced: string;
  env: Record<string, string>;
  agentLog: string;
  store: string;
  /** fake-agent's command with the switches both runs need. */
  fake(): string[];
  received(): Received[];
}

function world(): World {
  const base = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-resume-")));
  const make = (name: string) => {
    const path = join(base, name);
    mkdirSync(path, { recursive: true });
    return path;
  };
  const configHome = make("config");
  make("config/acp-tui");
  make("bin");
  const spaced = make("with space");
  // The wrapper: `acp-tui` as the printed command names it.
  const wrapper = join(base, "bin", "acp-tui");
  writeFileSync(wrapper, `#!/bin/sh\nexec bun ${JSON.stringify(CLI)} "$@"\n`);
  chmodSync(wrapper, 0o755);
  const agentLog = join(spaced, "fake-agent.log");
  const store = join(spaced, "sessions.json");
  writeFileSync(store, JSON.stringify({ sessions: [] }));
  return {
    base,
    repoB: make("repo-b"),
    elsewhere: make("elsewhere"),
    spaced,
    env: {
      XDG_CONFIG_HOME: configHome,
      XDG_STATE_HOME: join(base, "state"),
      PATH: `${join(base, "bin")}:${process.env.PATH ?? ""}`,
    },
    agentLog,
    store,
    fake: () => ["bun", FAKE_AGENT, "--scenario", "copy-fixtures", "--load", "--sessions", store, "--persist", "--delay-scale", "0", "--log", agentLog],
    received() {
      if (!existsSync(agentLog)) return [];
      return readFileSync(agentLog, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Received);
    },
  };
}

function launch(cmd: string[], cwd: string, env: Record<string, string>): PtySession {
  const s = startPty(cmd, { cols: 160, rows: 100, cwd, env, prefill: PREFILL });
  sessions.push(s);
  return s;
}

/** The lines written below the command line after the final reset, from the raw
 *  output (so the terminal's wrapping of a long line does not matter; the final reset's escape
 *  sequences precede the first line, so each line is read from its own start). */
function exitLines(s: PtySession): string[] {
  const raw = s.rawOutput();
  return raw
    .slice(raw.lastIndexOf("\x1b[?1049l"))
    .split(/\r?\n/)
    .map((line) => /(acp-tui: |resume: ).*$/.exec(line)?.[0])
    .filter((line): line is string => line !== undefined);
}

/** Sends one prompt and waits until its turn has ended, then detaches; returns the exit lines. */
async function promptAndDetach(s: PtySession): Promise<string[]> {
  await s.waitFor(READY, 15000);
  s.sendKeys({ text: PROMPT });
  await s.waitFor((p) => p.screenText().some((row) => row.includes(PROMPT)), 5000);
  s.sendKeys("Enter");
  await s.waitFor(ANSWER, 10000);
  await s.waitFor(READY, 10000);
  s.sendKeys("Ctrl+D");
  expect(await s.wait(10000)).toBe(0);
  return exitLines(s);
}

/** Runs the printed command from `cwd` exactly as printed: `sh -c <command>`, `acp-tui` on PATH. */
async function runPrinted(w: World, command: string, cwd: string): Promise<PtySession> {
  const s = launch(["sh", "-c", command], cwd, w.env);
  await s.waitFor(READY, 15000);
  return s;
}

/** What the second run must show once it has opened the session. */
async function expectResumed(w: World, s: PtySession, id: string, firstRunLength: number): Promise<void> {
  const second = w.received().slice(firstRunLength);
  const methods = second.map((e) => e.method);
  expect(methods).toContain("session/load");
  expect(methods).not.toContain("session/new");
  // The same session, in repo-b: not the directory the command ran from.
  expect(second.find((e) => e.method === "session/load")?.params).toEqual({ sessionId: id, cwd: w.repoB, mcpServers: [] });
  await s.waitFor(ANSWER, 10000);
  await s.waitFor((p) => p.screenText().some((row) => row.includes(PROMPT)), 5000);
  expect(statusRow(s)).toContain("repo-b");
  expect(statusRow(s)).not.toContain("elsewhere");
  // Opened from another directory: the marker after the history names both (design decision 2).
  await s.waitFor((p) => p.screenText().some((row) => row.includes(`opened in ${w.repoB} (launched from ${w.elsewhere})`)), 5000);
  s.sendKeys("Ctrl+D");
  expect(await s.wait(10000)).toBe(0);
  // Detached from a reopened session: its resume line again, the same ID, and nothing else.
  const lines = exitLines(s);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toStartWith(`resume: acp-tui --resume ${id}`);
  expect(second.map((e) => e.method)).not.toContain("session/prompt");
}

// Skipped on Windows: it runs the printed resume line with "sh -c" and a #!/bin/sh wrapper (Windows prints a PowerShell line; its text is tested in exit-text.test.ts).
describe.skipIf(WINDOWS)("Resume line runs (tui-screen, task 8.2)", () => {
  test("named agent: `resume: acp-tui --resume <id>` run from another directory opens the same session in repo-b", async () => {
    const w = world();
    const [command, ...args] = w.fake();
    writeFileSync(join(w.env.XDG_CONFIG_HOME!, "acp-tui", "config.jsonc"), JSON.stringify({ agent_servers: { fake: { command, args } } }));

    const first = launch(["bun", CLI, "-a", "fake"], w.repoB, w.env);
    // The resume line alone: no summary line (mvp-sessions design decision 12).
    const [resume, ...rest] = await promptAndDetach(first);
    expect(rest).toEqual([]);
    expect(resume).toBe("resume: acp-tui --resume fake-session-1");
    const firstRun = w.received();
    expect(firstRun.map((e) => e.method)).toContain("session/prompt");
    expect(JSON.parse(readFileSync(w.store, "utf8")).sessions).toHaveLength(1);

    const s = await runPrinted(w, resume!.slice("resume: ".length), w.elsewhere);
    await expectResumed(w, s, "fake-session-1", firstRun.length);
  }, TIMEOUT);

  test("ad hoc agent: the resume line repeats ` -- <command>`, quoted for a POSIX shell, and runs from another directory", async () => {
    const w = world();
    const command = w.fake();

    const first = launch(["bun", CLI, "--", ...command], w.repoB, w.env);
    const [resume, ...rest] = await promptAndDetach(first);
    expect(rest).toEqual([]);
    // The store and log live in a directory with a space in its name: those words are quoted.
    expect(w.spaced).toContain(" ");
    expect(resume).toStartWith("resume: acp-tui --resume fake-session-1 -- bun ");
    expect(resume).toContain(`'${w.store}'`);
    expect(resume).toContain(`'${w.agentLog}'`);
    const firstRun = w.received();
    expect(JSON.parse(readFileSync(w.store, "utf8")).sessions).toHaveLength(1);

    const s = await runPrinted(w, resume!.slice("resume: ".length), w.elsewhere);
    await expectResumed(w, s, "fake-session-1", firstRun.length);
  }, TIMEOUT);
});
