// mvp-chrome-and-keys group 7 (tasks 7.1 to 7.4; specs tui-screen "Terminal title", "Attention
// signals", "Wheel with the mouse off"): the real CLI under the PTY harness. The agent is
// `title-agent.ts` (a session title from the environment, a permission request on a prompt that
// contains "ask"), except where the exit text matters (fake-agent with `--load --persist`, so the
// resume line is printed). The terminal's identity is set in every test. "Long turn" needs a
// clock and is in attention.test.ts.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { parseModeChanges, startPty, type PtySession } from "../pty/harness.ts";
import { configEnv } from "../pty/config-home.ts";
import { CARD_HEADER, promptText, READY, REQUIRES_ACTION } from "../pty/regions.ts";
import { OPTION_GUARD_MS } from "../../src/app/permission.ts";
import { WINDOWS } from "../windows.ts";

const ROOT = resolve(import.meta.dir, "../../../..");
const CLI = join(ROOT, "packages/acp-tui/src/cli.ts");
const FAKE_AGENT = join(ROOT, "packages/fake-agent/src/main.ts");
const TITLE_AGENT = join(import.meta.dir, "title-agent.ts");
/** The CLI with the internal attention settings from the environment (cli-with-attention.ts). */
const CLI_WITH_ATTENTION = join(import.meta.dir, "cli-with-attention.ts");
const PLAIN = { TERMINAL_EMULATOR: undefined, TERM_PROGRAM: undefined };
const ZED = { TERMINAL_EMULATOR: undefined, TERM_PROGRAM: "zed" };
const JEDITERM = { TERMINAL_EMULATOR: "JetBrains-JediTerm", TERM_PROGRAM: undefined };
const TIMEOUT = 60000;
const TITLE_POP = "\x1b[23;0t";
const TITLE_PUSH = "\x1b[22;0t";
const FOCUS_IN = "\x1b[I";
const FOCUS_OUT = "\x1b[O";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGKILL");
  await session?.dispose();
  session = undefined;
});

function tempDir(): string {
  return realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-signals-")));
}

interface StartOptions {
  env?: Record<string, string | undefined>;
  args?: string[];
  agent?: string[];
  terminal?: "xterm" | "jediterm";
  rows?: number;
  /** Replaces the CLI entry point. */
  entry?: string;
  /** The directory acp-tui is started in (the session's directory); default a new temporary one. */
  cwd?: string;
}

function start(options: StartOptions = {}): PtySession {
  const agent = options.agent ?? ["bun", TITLE_AGENT];
  session = startPty(["bun", options.entry ?? CLI, "--", ...(options.args ?? []), "--", ...agent], {
    cols: 80,
    rows: options.rows ?? 24,
    cwd: options.cwd ?? tempDir(),
    env: { ...PLAIN, ...options.env },
    ...(options.terminal ? { terminal: options.terminal } : {}),
  });
  return session;
}

/** Every title the output set with OSC 0, in order (OpenTUI's `setTerminalTitle` writes OSC 0). */
function titles(raw: string): string[] {
  return [...raw.matchAll(/\x1b\]0;([^\x07\x1b]*)\x07/g)].map((m) => m[1]!);
}

/** BEL bytes that are not an OSC string's terminator: attention signals. */
function bells(raw: string): number {
  return (raw.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "").match(/\x07/g) ?? []).length;
}

/** The mode 1007 changes in the output from `offset` on, as "l" and "h". */
function alternateScroll(raw: string, offset = 0): string[] {
  return parseModeChanges(raw.slice(offset))
    .filter((c) => c.mode === 1007)
    .map((c) => (c.on ? "h" : "l"));
}

async function ask(s: PtySession): Promise<void> {
  await s.waitFor(READY, 15000);
  s.sendKeys({ text: "ask please" }, "Enter");
  await s.waitFor(CARD_HEADER, 15000);
}

async function answer(s: PtySession): Promise<void> {
  await Bun.sleep(OPTION_GUARD_MS + 100);
  s.sendKeys("1", "Enter");
}

describe("Terminal title (task 7.1; day-one-feedback task 9)", () => {
  // Skipped on Windows: it reads raw bytes of the PTY stream (sequences, modes or titles), which ConPTY rewrites.
  test.skipIf(WINDOWS)("Directory name by default: pushed at start-up, then the session directory's name, which the agent's own title does not change", async () => {
    const cwd = tempDir();
    const name = basename(cwd);
    const s = start({ cwd, env: { TITLE_AGENT_TITLE: "Pool reuse" } });
    await s.waitFor(READY, 15000);
    expect(s.rawOutput()).toContain(TITLE_PUSH);
    await s.waitFor((p) => titles(p.rawOutput()).includes(name), 5000);
    s.sendKeys({ text: "hello" }, "Enter");
    await s.waitFor(/end turn/, 15000);
    await Bun.sleep(300);
    // The agent reported its title, and the tab stays the directory's name.
    expect(titles(s.rawOutput())).toEqual([name]);
    expect(s.rawOutput().indexOf(TITLE_PUSH)).toBeLessThan(s.rawOutput().indexOf(`\x1b]0;${name}`));
  }, TIMEOUT);

  test("Title follows the session: with {title} in title.format the agent's title joins the directory's name", async () => {
    const cwd = tempDir();
    const name = basename(cwd);
    const s = start({ cwd, env: { TITLE_AGENT_TITLE: "Pool reuse", ...configEnv({ title: { format: "{dir}{counter} · {title}" } }) } });
    await s.waitFor(READY, 15000);
    await s.waitFor((p) => titles(p.rawOutput()).includes(name), 5000);
    s.sendKeys({ text: "hello" }, "Enter");
    await s.waitFor((p) => titles(p.rawOutput()).includes(`${name} · Pool reuse`), 15000);
  }, TIMEOUT);

  // Skipped on Windows: it reads raw bytes of the PTY stream (sequences, modes or titles), which ConPTY rewrites.
  test.skipIf(WINDOWS)("Second instance in the same directory: the second is `name 2` for its whole run, and after the first was killed the third takes the free number", async () => {
    const cwd = tempDir();
    const name = basename(cwd);
    const first = start({ cwd });
    await first.waitFor((p) => titles(p.rawOutput()).includes(name), 15000);
    const second = startPty(["bun", CLI, "--", "--", "bun", TITLE_AGENT], { cols: 80, rows: 24, cwd, env: { ...PLAIN } });
    const third: { current?: PtySession } = {};
    try {
      await second.waitFor((p) => titles(p.rawOutput()).includes(`${name} 2`), 15000);
      expect(titles(second.rawOutput())).toEqual([`${name} 2`]);
      // The first is killed (SIGKILL: its slot is left behind and reclaimed), a third starts.
      first.kill("SIGKILL");
      await first.wait(10000);
      third.current = startPty(["bun", CLI, "--", "--", "bun", TITLE_AGENT], { cols: 80, rows: 24, cwd, env: { ...PLAIN } });
      await third.current.waitFor((p) => titles(p.rawOutput()).length > 0, 15000);
      expect(titles(third.current.rawOutput())).toEqual([name]);
      // The second keeps its number.
      expect(titles(second.rawOutput())).toEqual([`${name} 2`]);
    } finally {
      for (const s of [second, third.current]) {
        s?.kill("SIGKILL");
        await s?.dispose();
      }
    }
  }, TIMEOUT);

  test("Waiting for the user: the marker while a permission request is open, gone once answered", async () => {
    const cwd = tempDir();
    const name = basename(cwd);
    const s = start({ cwd, env: { TITLE_AGENT_TITLE: "Pool reuse" } });
    await ask(s);
    await s.waitFor((p) => titles(p.rawOutput()).at(-1) === `◊ ${name}`, 5000);
    await answer(s);
    await s.waitFor((p) => titles(p.rawOutput()).at(-1) === name, 10000);
    await s.waitFor(READY, 10000);
  }, TIMEOUT);

  // Skipped on Windows: it reads raw bytes of the PTY stream (sequences, modes or titles), which ConPTY rewrites.
  test.skipIf(WINDOWS)("Hostile title: one printable line, and no byte of it ends the sequence early", async () => {
    // BEL, an OSC 52 clipboard write, a bare ESC, a newline and a C1 introducer.
    const hostile = "Pool\x07 reuse\x1b]52;c;ZXZpbA==\x07 and\nmore\x1b\\ \x9d52;c;ZXZpbA==\x07 end";
    const s = start({ env: { TITLE_AGENT_TITLE: hostile, ...configEnv({ title: { format: "acp-tui | {title}" } }) } });
    await s.waitFor(READY, 15000);
    s.sendKeys({ text: "hello" }, "Enter");
    await s.waitFor((p) => titles(p.rawOutput()).some((t) => t.includes("Pool")), 15000);
    const raw = s.rawOutput();
    for (const title of titles(raw)) {
      expect(title).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
      expect(title.startsWith("acp-tui")).toBe(true);
    }
    expect(raw).not.toContain("\x1b]52");
    expect(raw).not.toContain("ZXZpbA==");
    expect(bells(raw)).toBe(0);
  }, TIMEOUT);

  describe("Restored on exit", () => {
    test("Ctrl+D: the title-stack restore comes after the last title and before the exit text", async () => {
      const store = join(tempDir(), "sessions.json");
      writeFileSync(store, JSON.stringify({ sessions: [] }));
      const s = start({ agent: ["bun", FAKE_AGENT, "--scenario", "copy-fixtures", "--delay-scale", "0", "--load", "--persist", "--sessions", store] });
      await s.waitFor(READY, 15000);
      s.sendKeys({ text: "hello" }, "Enter");
      await s.waitFor(/end turn/, 15000);
      s.sendKeys("Ctrl+D");
      expect(await s.wait(15000)).toBe(0);
      const raw = s.rawOutput();
      const pop = raw.lastIndexOf(TITLE_POP);
      expect(pop).toBeGreaterThan(raw.lastIndexOf("\x1b]0;"));
      expect(pop).toBeGreaterThan(raw.lastIndexOf("\x1b[?1049l"));
      const resume = raw.indexOf("resume: acp-tui --resume");
      expect(resume).toBeGreaterThan(pop);
      expect(raw.split(TITLE_POP)).toHaveLength(2);
    }, TIMEOUT);

    // Skipped on Windows: it sends SIGTERM with process.kill, which ends a Windows process outright instead of running its handler.
    test.skipIf(WINDOWS)("SIGTERM: restored", async () => {
      const s = start();
      await s.waitFor(READY, 15000);
      s.kill("SIGTERM");
      expect(await s.wait(15000)).toBe(143);
      const raw = s.rawOutput();
      expect(raw.lastIndexOf(TITLE_POP)).toBeGreaterThan(raw.lastIndexOf("\x1b]0;"));
      expect(raw.split(TITLE_POP)).toHaveLength(2);
    }, TIMEOUT);

    test("Crash: restored before the error line", async () => {
      const s = start({ env: { ACP_TUI_TEST_HOOKS: "crash" } });
      await s.waitFor(READY, 15000);
      s.write("\x1b[24~");
      expect(await s.wait(15000)).toBe(1);
      const raw = s.rawOutput();
      const pop = raw.lastIndexOf(TITLE_POP);
      expect(pop).toBeGreaterThan(raw.lastIndexOf("\x1b]0;"));
      expect(raw.indexOf("uncaught error")).toBeGreaterThan(pop);
    }, TIMEOUT);
  });
});

describe("Attention signals (task 7.2)", () => {
  test("Permission while unfocused: one BEL", async () => {
    const s = start();
    await s.waitFor(READY, 15000);
    s.write(FOCUS_OUT);
    await Bun.sleep(100);
    const before = bells(s.rawOutput());
    s.sendKeys({ text: "ask please" }, "Enter");
    await s.waitFor(CARD_HEADER, 15000);
    await s.waitFor(REQUIRES_ACTION, 5000);
    await Bun.sleep(300);
    expect(bells(s.rawOutput()) - before).toBe(1);
    await answer(s);
    await s.waitFor(READY, 10000);
  }, TIMEOUT);

  test("A terminal that never reports focus counts as unfocused", async () => {
    const s = start();
    await ask(s);
    await Bun.sleep(300);
    expect(bells(s.rawOutput())).toBe(1);
  }, TIMEOUT);

  test("Focused pane: no BEL when the last focus report was focus in", async () => {
    const s = start();
    await s.waitFor(READY, 15000);
    s.write(FOCUS_IN);
    await Bun.sleep(100);
    s.sendKeys({ text: "ask please" }, "Enter");
    await s.waitFor(CARD_HEADER, 15000);
    await answer(s);
    await s.waitFor(READY, 10000);
    expect(bells(s.rawOutput())).toBe(0);
  }, TIMEOUT);

  test("Short turn: a turn of a few seconds while unfocused signals nothing", async () => {
    const s = start();
    await s.waitFor(READY, 15000);
    s.write(FOCUS_OUT);
    s.sendKeys({ text: "hello" }, "Enter");
    await s.waitFor(/end turn/, 15000);
    await s.waitFor(READY, 10000);
    await Bun.sleep(300);
    expect(bells(s.rawOutput())).toBe(0);
  }, TIMEOUT);
});

describe("Long turn against fake-agent's slow-turn (task 7.2)", () => {
  // `--long-gap` is a 45 s gap at --delay-scale 1; at 0.05 the turn takes about 2.3 s, which a
  // test threshold of 1 s counts as long and the default 30 s does not.
  const slowTurn = ["bun", FAKE_AGENT, "--scenario", "slow-turn", "--long-gap", "--delay-scale", "0.05"];

  async function runTurn(env: Record<string, string>): Promise<number> {
    const s = start({ entry: CLI_WITH_ATTENTION, agent: slowTurn, env });
    await s.waitFor(READY, 15000);
    s.write(FOCUS_OUT);
    await Bun.sleep(100);
    s.sendKeys({ text: "read both" }, "Enter");
    await s.waitFor(/Both files read/, 20000);
    await s.waitFor(READY, 10000);
    await Bun.sleep(300);
    return bells(s.rawOutput());
  }

  test("Long turn: a turn past the threshold while unfocused signals once, when it ends", async () => {
    expect(await runTurn({ ACP_TUI_TEST_LONG_TURN_SECONDS: "1" })).toBe(1);
  }, TIMEOUT);

  test("Short turn: the same turn under the default 30 s threshold signals nothing", async () => {
    expect(await runTurn({})).toBe(0);
  }, TIMEOUT);

  test("Focused pane: the long turn signals nothing while the pane has focus", async () => {
    const s = start({ entry: CLI_WITH_ATTENTION, agent: slowTurn, env: { ACP_TUI_TEST_LONG_TURN_SECONDS: "1" } });
    await s.waitFor(READY, 15000);
    s.write(FOCUS_IN);
    await Bun.sleep(100);
    s.sendKeys({ text: "read both" }, "Enter");
    await s.waitFor(/Both files read/, 20000);
    await s.waitFor(READY, 10000);
    await Bun.sleep(300);
    expect(bells(s.rawOutput())).toBe(0);
  }, TIMEOUT);

  test("The signal is the one the setting names: osc9 writes a notification and no BEL", async () => {
    const s = start({ entry: CLI_WITH_ATTENTION, agent: slowTurn, env: { ACP_TUI_TEST_LONG_TURN_SECONDS: "1", ACP_TUI_TEST_ATTENTION_SIGNAL: "osc9" } });
    await s.waitFor(READY, 15000);
    s.write(FOCUS_OUT);
    await Bun.sleep(100);
    s.sendKeys({ text: "read both" }, "Enter");
    await s.waitFor(/Both files read/, 20000);
    await s.waitFor((p) => p.rawOutput().includes("\x1b]9;acp-tui: turn finished\x07"), 5000);
    expect(bells(s.rawOutput())).toBe(0);
  }, TIMEOUT);
});

describe("Attention marker in the title (interface-feedback task 6.4)", () => {
  const slowTurn = ["bun", FAKE_AGENT, "--scenario", "slow-turn", "--long-gap", "--delay-scale", "0.05"];
  const DOT = "\u25cf";
  const long = configEnv({ attention: { long_turn_seconds: 1 } });

  // Skipped on Windows: it reads raw bytes of the PTY stream (sequences, modes or titles), which ConPTY rewrites.
  test.skipIf(WINDOWS)("Unfocused pane: the title gains the marker when the turn ends and loses it after one key press", async () => {
    const cwd = tempDir();
    const name = basename(cwd);
    const s = start({ cwd, agent: slowTurn, env: long });
    await s.waitFor(READY, 15000);
    s.write(FOCUS_OUT);
    await Bun.sleep(100);
    s.sendKeys({ text: "read both" }, "Enter");
    await s.waitFor(/Both files read/, 20000);
    await s.waitFor((p) => titles(p.rawOutput()).at(-1) === `${DOT} ${name}`, 10000);
    expect(titles(s.rawOutput())).toEqual([name, `${DOT} ${name}`]);
    s.sendKeys({ text: "x" });
    await s.waitFor((p) => titles(p.rawOutput()).at(-1) === name, 5000);
  }, TIMEOUT);

  test.skipIf(WINDOWS)("Focused pane: no marker", async () => {
    const cwd = tempDir();
    const name = basename(cwd);
    const s = start({ cwd, agent: slowTurn, env: long });
    await s.waitFor(READY, 15000);
    s.write(FOCUS_IN);
    await Bun.sleep(100);
    s.sendKeys({ text: "read both" }, "Enter");
    await s.waitFor(/Both files read/, 20000);
    await s.waitFor(READY, 10000);
    await Bun.sleep(300);
    expect(titles(s.rawOutput())).toEqual([name]);
  }, TIMEOUT);

  test.skipIf(WINDOWS)("Focus in clears the marker where the terminal reports focus", async () => {
    const cwd = tempDir();
    const name = basename(cwd);
    const s = start({ cwd, agent: slowTurn, env: long });
    await s.waitFor(READY, 15000);
    s.write(FOCUS_OUT);
    await Bun.sleep(100);
    s.sendKeys({ text: "read both" }, "Enter");
    await s.waitFor((p) => titles(p.rawOutput()).at(-1) === `${DOT} ${name}`, 20000);
    s.write(FOCUS_IN);
    await s.waitFor((p) => titles(p.rawOutput()).at(-1) === name, 5000);
  }, TIMEOUT);

  test.skipIf(WINDOWS)("attention.title_marker false: the turn signals but the title keeps its text", async () => {
    const cwd = tempDir();
    const name = basename(cwd);
    const s = start({ cwd, agent: slowTurn, env: configEnv({ attention: { long_turn_seconds: 1, title_marker: false } }) });
    await s.waitFor(READY, 15000);
    s.write(FOCUS_OUT);
    await Bun.sleep(100);
    s.sendKeys({ text: "read both" }, "Enter");
    await s.waitFor(/Both files read/, 20000);
    await s.waitFor((p) => bells(p.rawOutput()) === 1, 10000);
    await Bun.sleep(300);
    expect(titles(s.rawOutput())).toEqual([name]);
  }, TIMEOUT);
});

describe("Mouse off in Zed (task 7.3)", () => {
  // Skipped on Windows: ConPTY answers or swallows the terminal queries (CSI 6n, DECRQM) itself, so the harness never sees them.
  test.skipIf(WINDOWS)("Zed mode 1007: l at the first F2, h at the second, set after exit", async () => {
    const s = start({ env: ZED });
    await s.waitFor(READY, 15000);
    expect(s.rawOutput()).toContain("\x1b[?1007$p");
    const mark = s.rawOutput().length;
    expect(alternateScroll(s.rawOutput(), mark)).toEqual([]);
    s.sendKeys("F2");
    await s.waitFor((p) => alternateScroll(p.rawOutput(), mark).length === 1, 5000);
    s.sendKeys("F2");
    await s.waitFor((p) => alternateScroll(p.rawOutput(), mark).length === 2, 5000);
    expect(alternateScroll(s.rawOutput(), mark)).toEqual(["l", "h"]);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(15000)).toBe(0);
    expect(alternateScroll(s.rawOutput())).toEqual(["l", "h"]);
    expect(s.modesSet()).toContain(1007);
  }, TIMEOUT);

  // Skipped on Windows: ConPTY answers or swallows the terminal queries (CSI 6n, DECRQM) itself, so the harness never sees them.
  test.skipIf(WINDOWS)("Zed started with the mouse off: l at start-up, h in the final reset, before the exit text", async () => {
    const store = join(tempDir(), "sessions.json");
    writeFileSync(store, JSON.stringify({ sessions: [] }));
    const s = start({
      env: ZED,
      args: ["--mouse", "off"],
      agent: ["bun", FAKE_AGENT, "--scenario", "copy-fixtures", "--delay-scale", "0", "--load", "--persist", "--sessions", store],
    });
    await s.waitFor(READY, 15000);
    const query = s.rawOutput().indexOf("\x1b[?1007$p");
    expect(query).toBeGreaterThanOrEqual(0);
    expect(alternateScroll(s.rawOutput(), query)).toEqual(["l"]);
    s.sendKeys({ text: "hello" }, "Enter");
    await s.waitFor(/end turn/, 15000);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(15000)).toBe(0);
    const raw = s.rawOutput();
    expect(alternateScroll(raw, query)).toEqual(["l", "h"]);
    expect(raw.lastIndexOf("\x1b[?1007h")).toBeGreaterThan(raw.lastIndexOf("\x1b[?1049l"));
    expect(raw.indexOf("resume: acp-tui --resume")).toBeGreaterThan(raw.lastIndexOf("\x1b[?1007h"));
  }, TIMEOUT);

  test("The DECRQM reply never reaches the prompt box", async () => {
    const s = start({ env: ZED });
    await s.waitFor(READY, 15000);
    s.write("\x1b[?1007;1$y");
    s.write("\x1b[?1007;0$y");
    s.write("\x1b[?1007;2$y");
    await Bun.sleep(300);
    expect(promptText(s)).toEqual([""]);
  }, TIMEOUT);

  test("A terminal that reported mode 1007 reset gets nothing written back", async () => {
    const s = start({ env: ZED, args: ["--mouse", "off"] });
    await s.waitFor(READY, 15000);
    s.write("\x1b[?1007;2$y");
    await Bun.sleep(300);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(15000)).toBe(0);
    expect(alternateScroll(s.rawOutput())).toEqual(["l"]);
  }, TIMEOUT);

  test("No query and no 1007 output outside Zed", async () => {
    const s = start({ args: ["--mouse", "off"] });
    await s.waitFor(READY, 15000);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(15000)).toBe(0);
    expect(s.rawOutput()).not.toContain("1007");
  }, TIMEOUT);
});

describe("The three-arrows notch (task 7.4)", () => {
  /** A two-line draft with the cursor at the end of line two. */
  async function draft(s: PtySession): Promise<void> {
    await s.waitFor(READY, 15000);
    s.sendKeys({ text: "line one" }, "Shift+Enter:esc-cr", { text: "line two" });
    await s.waitFor((p) => promptText(p).join("|") === "line one|line two", 5000);
  }

  test("PhpStorm notch with a draft: three arrows in one read leave the cursor on line two", async () => {
    const s = start({ env: JEDITERM, args: ["--mouse", "off"], terminal: "jediterm" });
    await draft(s);
    s.write("\x1b[A\x1b[A\x1b[A");
    await Bun.sleep(300);
    s.sendKeys({ text: "X" });
    await s.waitFor((p) => promptText(p).join("|").includes("X"), 5000);
    expect(promptText(s)).toEqual(["line one", "line twoX"]);
  }, TIMEOUT);

  test("The SS3 form and the down arrows are dropped as well", async () => {
    const s = start({ env: JEDITERM, args: ["--mouse", "off"], terminal: "jediterm" });
    await draft(s);
    s.write("\x1bOA\x1bOA\x1bOA");
    await Bun.sleep(150);
    s.write("\x1b[B\x1b[B\x1b[B");
    await Bun.sleep(150);
    s.write("\x1bOB\x1bOB\x1bOB");
    await Bun.sleep(300);
    s.sendKeys({ text: "X" });
    await s.waitFor((p) => promptText(p).join("|").includes("X"), 5000);
    expect(promptText(s)).toEqual(["line one", "line twoX"]);
  }, TIMEOUT);

  test("Single arrow still moves: one CSI A in a read puts the cursor on line one", async () => {
    const s = start({ env: JEDITERM, args: ["--mouse", "off"], terminal: "jediterm" });
    await draft(s);
    s.write("\x1b[A");
    await Bun.sleep(300);
    s.sendKeys({ text: "Y" });
    await s.waitFor((p) => promptText(p).join("|").includes("Y"), 5000);
    expect(promptText(s)[0]).toContain("Y");
    expect(promptText(s)[1]).toBe("line two");
  }, TIMEOUT);

  test("The notch is only dropped while the mouse is off: under full, three arrows in a read are three presses", async () => {
    const s = start({ env: JEDITERM, terminal: "jediterm" });
    await draft(s);
    s.write("\x1b[A\x1b[A\x1b[A");
    await Bun.sleep(300);
    s.sendKeys({ text: "Y" });
    await s.waitFor((p) => promptText(p).join("|").includes("Y"), 5000);
    expect(promptText(s)).toEqual(["line oneY", "line two"]);
  }, TIMEOUT);
});
