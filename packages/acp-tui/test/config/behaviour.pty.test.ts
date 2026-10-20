// mvp-configuration tasks 3.3 and 4.1 to 4.8 under the PTY harness: the
// behaviour settings read from the user's configuration file, and live on a
// reload (spec tui-config "Screen settings", "Per-terminal table", "Live
// reload", "Reload never touches the running session", "Density setting",
// "Interrupt setting", "Attention settings", "Rendering settings"). The real
// CLI against fake-agent, with a configuration home of its own per test; the
// terminal's identity is set in every test, so nothing depends on the terminal
// the tests run in. The clipboard cases are in test/selection/select.pty.test.ts
// and the exit print in test/find/exit-print.pty.test.ts, beside the cases
// they repeat from the file.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
/** run.tsx `HYPERLINKS_NEXT_START`. */
const HYPERLINKS_NEXT_START = "hyperlinks applies from the next start";
import type { PtySession } from "../pty/harness.ts";
import { promptBox, READY, REQUIRES_ACTION, RUNNING, statusRow, withoutBar } from "../pty/regions.ts";
import { sendPrompt, settle, startCli, type CliRun, type StartOptions } from "../conversation/cli.ts";
import { startCli as startKeysCli, type CliRun as KeysRun } from "../keys/cli-pty.ts";
import { localEnv } from "../selection/pty.ts";
import { listBody, listRows, listWorld, type ListWorld } from "../session/list-world.ts";

let run: CliRun | undefined;
let other: PtySession | undefined;
afterEach(async () => {
  run?.session.kill("SIGTERM");
  await run?.session.dispose();
  run = undefined;
  other?.kill("SIGTERM");
  await other?.dispose();
  other = undefined;
});

const temp = (prefix: string) => realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), prefix)));

/** A configuration home (XDG_CONFIG_HOME) with the user's file holding `config`; `write` saves it
 *  again as an editor does, by renaming a temporary file over it. */
function configHome(config: unknown = {}) {
  const home = temp("acp-tui-behaviour-");
  const dir = join(home, "acp-tui");
  mkdirSync(dir);
  const file = join(dir, "config.jsonc");
  const write = (value: unknown) => {
    const tmp = join(dir, `.config.jsonc.${Date.now()}.tmp`);
    writeFileSync(tmp, JSON.stringify(value, null, 2));
    renameSync(tmp, file);
  };
  writeFileSync(file, JSON.stringify(config, null, 2));
  return { home, file, write };
}

/** Nothing names a terminal unless the test says so. */
const NO_TERMINAL = { TERM_PROGRAM: undefined, TERMINAL_EMULATOR: undefined, ACP_TUI_CAPABILITIES: undefined };

function start(home: string, opts: Partial<StartOptions> & { scenario: string }): CliRun {
  run = startCli({ cols: 80, rows: 24, ...opts, env: localEnv({ ...NO_TERMINAL, ...opts.env, XDG_CONFIG_HOME: home }) });
  return run;
}

/** Waits for the `n`th reload (1-based) in the debug log and returns its event. */
async function reloaded(r: CliRun, n = 1): Promise<Record<string, unknown>> {
  await r.session.waitFor(() => r.events("config_reload").length >= n, 3000);
  return r.events("config_reload")[n - 1]!;
}

/** The rows above the prompt box (no activity bar or card once the turn has ended). */
function conversationRows(s: PtySession): string[] {
  const lines = withoutBar(s.screenText());
  const end = lines.findIndex((l) => l.startsWith("╭"));
  return lines.slice(0, end < 0 ? lines.length : end);
}

const toastRow = (s: PtySession) => promptBox(s)[0] ?? "";

/** `long-session` with `items` items, idle after its one turn. */
async function history(home: string, items: number, opts: Partial<StartOptions> = {}): Promise<PtySession> {
  const r = start(home, { scenario: "long-session", cols: 63, rows: 21, agentArgs: ["--items", String(items)], ...opts });
  await sendPrompt(r.session, "history");
  await r.session.waitFor(/end turn/, 20000);
  await settle(r.session);
  return r.session;
}

describe("screen settings (task 4.1)", () => {
  test("Mouse from the file: with mouse wheel a click on a collapsed tool line leaves it collapsed, and the wheel still scrolls", async () => {
    const cfg = configHome({ mouse: "wheel" });
    const s = await history(cfg.home, 30);
    expect(statusRow(s)).toContain("mouse: wheel");
    expect(s.mouseModesSet()).toEqual([1000, 1002, 1006]);
    const y = conversationRows(s).findIndex((r, i) => i >= 2 && (/#\d+$/.test(r) || /^ {2}▸ \d+ /.test(r)));
    expect(y).toBeGreaterThanOrEqual(0);
    const before = conversationRows(s);
    s.mouseClick(20, y);
    await Bun.sleep(300);
    await settle(s, 100);
    expect(conversationRows(s)).toEqual(before);
    s.mouseWheel(20, 5, 64);
    await s.waitFor((p) => /scrolled/.test(statusRow(p)), 5000);
  }, 60000);

  test("a reload changes the policy at once (all-motion on for full, reporting off for off), and F2 then toggles between the new policy and off", async () => {
    const cfg = configHome({ mouse: "wheel" });
    const r = start(cfg.home, { scenario: "basic" });
    const s = r.session;
    await s.waitFor(READY, 10000);
    expect(s.countModeChanges(1003, true)).toBe(0);
    cfg.write({ mouse: "full" });
    await reloaded(r);
    await s.waitFor(() => s.countModeChanges(1003, true) === 1, 3000);
    await s.waitFor((p) => !/mouse: wheel/.test(statusRow(p)), 3000);
    expect(r.events("mouse_policy").at(-1)).toMatchObject({ policy: "full", cause: "reload" });

    cfg.write({ mouse: "off" });
    await reloaded(r, 2);
    await s.waitFor((p) => /mouse off/.test(statusRow(p)), 3000);
    expect(s.countModeChanges(1000, false)).toBeGreaterThanOrEqual(1);
    const enabled = s.countModeChanges(1000, true);
    // F2 has no policy to go back to while the setting is off.
    s.sendKeys("F2");
    await s.waitFor((p) => toastRow(p).includes("mouse off (the mouse setting is off)"), 3000);
    expect(s.countModeChanges(1000, true)).toBe(enabled);

    cfg.write({ mouse: "wheel" });
    await reloaded(r, 3);
    await s.waitFor((p) => /mouse: wheel/.test(statusRow(p)), 3000);
    expect(s.countModeChanges(1000, true)).toBe(enabled + 1);
    s.sendKeys("F2");
    await s.waitFor((p) => /mouse off/.test(statusRow(p)), 3000);
    s.sendKeys("F2");
    await s.waitFor((p) => /mouse: wheel/.test(statusRow(p)), 3000);
    // Back to wheel, not full: no all-motion reporting again.
    expect(s.countModeChanges(1003, true)).toBe(1);
  }, 30000);

  test("Command line wins on a reload too: with --mouse wheel, a file changed to off leaves reporting on", async () => {
    const cfg = configHome({});
    const r = start(cfg.home, { scenario: "basic", args: ["--mouse", "wheel"] });
    await r.session.waitFor(READY, 10000);
    cfg.write({ mouse: "off" });
    expect((await reloaded(r))["changed"]).toEqual([]);
    await Bun.sleep(200);
    expect(statusRow(r.session)).toContain("mouse: wheel");
    expect(r.session.countModeChanges(1000, false)).toBe(0);
  }, 30000);

  test("One step everywhere: wheel_lines 2 in Zed gives 2 rows per wheel event; a reload to a terminals entry gives its step", async () => {
    const cfg = configHome({ wheel_lines: 2 });
    const s = await history(cfg.home, 200, { env: { TERM_PROGRAM: "zed" } });
    s.mouseWheel(20, 5, 64);
    await s.waitFor(() => run!.events("wheel").length === 1, 5000);
    expect(run!.events("wheel")[0]).toMatchObject({ rows: 2, terminal: "zed", source: "option" });
    cfg.write({ terminals: { zed: { wheel_lines: 4 } } });
    await reloaded(run!);
    s.mouseWheel(20, 5, 64);
    await s.waitFor(() => run!.events("wheel").length === 2, 5000);
    expect(run!.events("wheel")[1]).toMatchObject({ rows: 4, terminal: "zed", source: "terminals" });
  }, 60000);
});

describe("the per-terminal table (task 4.2)", () => {
  test("Wheel table entry: terminals.jetbrains.wheel_lines 5 under TERMINAL_EMULATOR=JetBrains-JediTerm scrolls 5 rows per event", async () => {
    const cfg = configHome({ terminals: { jetbrains: { wheel_lines: 5 } } });
    const s = await history(cfg.home, 200, { env: { TERMINAL_EMULATOR: "JetBrains-JediTerm" } });
    s.mouseWheel(20, 5, 64);
    await s.waitFor(() => run!.events("wheel").length === 1, 5000);
    expect(run!.events("wheel")[0]).toMatchObject({ rows: 5, terminal: "jetbrains", source: "terminals" });
  }, 60000);

  /** Cells drawn struck, and the struck sample's cells (M02's `double tilde`) and whether they are
   *  italic. */
  function strikeCells(s: PtySession): { struck: number; sample: { italic: boolean }[] } {
    const base = s.term.buffer.active.baseY;
    const rows = s.screenText();
    let struck = 0;
    const sample: { italic: boolean }[] = [];
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (s.cell(base + y, x)?.isStrikethrough()) struck += 1;
      const at = row.indexOf("double tilde");
      if (at >= 0) for (let x = at; x < at + "double tilde".length; x++) sample.push({ italic: s.cell(base + y, x)?.isItalic() !== 0 });
    });
    return { struck, sample };
  }

  test("Strikethrough off in Zed: with terminals.zed.strikethrough colour no SGR 9 is drawn and struck text is italic; a reload turns SGR 9 back on", async () => {
    const cfg = configHome({ terminals: { zed: { strikethrough: "colour" } } });
    const r = start(cfg.home, { scenario: "markdown-gallery", cols: 100, rows: 600, env: { TERM_PROGRAM: "zed" } });
    const s = r.session;
    await sendPrompt(s, "gallery");
    await s.waitFor((p) => p.screenText().some((l) => l.includes("M99 end of gallery")) && READY.test(p.screenText().join("\n")), 20000);
    await s.waitFor((p) => p.screenText().some((l) => l.includes("double tilde")), 5000);
    await settle(s);
    let cells = strikeCells(s);
    expect(cells.struck).toBe(0);
    expect(cells.sample.length).toBe("double tilde".length);
    expect(cells.sample.every((c) => c.italic)).toBe(true);

    cfg.write({});
    await reloaded(r);
    await s.waitFor(() => strikeCells(s).struck > 0, 3000);
    cells = strikeCells(s);
    expect(cells.sample.every((c) => !c.italic)).toBe(true);
  }, 60000);

  async function links(cfg: { home: string }, env: Record<string, string | undefined>): Promise<CliRun> {
    const r = start(cfg.home, { scenario: "links", cols: 100, rows: 30, env });
    await sendPrompt(r.session, "show me links");
    await r.session.waitFor((p) => p.screenText().some((l) => l.includes("A long one:")) && READY.test(p.screenText().join("\n")), 15000);
    await Bun.sleep(300);
    return r;
  }

  test("Hyperlinks on for a terminal: terminals.kitty.hyperlinks true under TERM=xterm-kitty writes allowed links with OSC 8", async () => {
    const cfg = configHome({ terminals: { kitty: { hyperlinks: true } } });
    const r = await links(cfg, { TERM: "xterm-kitty" });
    expect(r.session.rawOutput()).toMatch(/\x1b\]8;[^;]*;https:\/\//);
    expect(r.events("hyperlinks")[0]).toMatchObject({ osc8: true });
  }, 30000);

  test("Hyperlinks from the next start: in Zed, a reload turning hyperlinks off and density verbose applies the density, says hyperlinks apply from the next start, keeps writing OSC 8, and the next run writes none", async () => {
    const cfg = configHome({});
    const r = await links(cfg, { TERM_PROGRAM: "zed" });
    const s = r.session;
    expect(s.rawOutput()).toContain("\x1b]8;");
    cfg.write({ terminals: { zed: { hyperlinks: false } }, density: "verbose" });
    expect((await reloaded(r))["changed"]).toEqual(["terminals", "density"]);
    // The setting is verbose now, so the status row marks nothing; the debug log shows the switch.
    await s.waitFor(() => r.events("density").some((e) => e["density"] === "verbose"), 1000);
    await s.waitFor((p) => toastRow(p).includes(HYPERLINKS_NEXT_START), 1000);
    // Every cell drawn again: the links are still written with OSC 8 while this run lasts.
    const before = s.rawOutput().length;
    s.sendKeys("Ctrl+L");
    await s.waitFor((p) => p.rawOutput().slice(before).includes("\x1b]8;"), 3000);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    await s.dispose();
    run = undefined;

    const second = await links(cfg, { TERM_PROGRAM: "zed" });
    expect(second.session.rawOutput()).not.toContain("\x1b]8;");
    expect(second.events("hyperlinks")[0]).toMatchObject({ osc8: false });
  }, 60000);
});

describe("density (tasks 4.5 and 3.3)", () => {
  test("Focus by default: with no density setting each turn's tool calls are behind one line and the status row shows no density mark", async () => {
    const cfg = configHome({});
    const r = start(cfg.home, { scenario: "tool-content", cols: 80, rows: 40 });
    await sendPrompt(r.session, "go");
    await r.session.waitFor(/end turn/, 20000);
    await settle(r.session);
    expect(statusRow(r.session)).not.toContain("density");
    const rows = conversationRows(r.session);
    expect(rows.some((row) => /^ {2}▸ \d+ tool calls/.test(row))).toBe(true);
    expect(rows.some((row) => /#\d+$/.test(row))).toBe(false);
  }, 30000);

  test("Compact from the file: tool calls one line each and no density mark; v marks the switch to another density", async () => {
    const cfg = configHome({ density: "compact" });
    const r = start(cfg.home, { scenario: "tool-content", cols: 80, rows: 40 });
    const s = r.session;
    await sendPrompt(s, "go");
    await s.waitFor(/end turn/, 20000);
    await settle(s);
    expect(statusRow(s)).not.toContain("density");
    expect(conversationRows(s).some((row) => /#\d+$/.test(row))).toBe(true);
    s.sendKeys("Tab");
    await Bun.sleep(100);
    // The `v` cycle is compact, verbose, focus.
    s.sendKeys({ text: "v" }, { text: "v" });
    await s.waitFor((p) => /density: focus/.test(statusRow(p)), 3000);
  }, 30000);

  test("Density chosen by key survives an unrelated reload: v to verbose, then a theme-only save keeps verbose; a changed density setting switches it", async () => {
    const cfg = configHome({});
    const r = start(cfg.home, { scenario: "tool-content", cols: 80, rows: 40 });
    const s = r.session;
    await sendPrompt(s, "go");
    await s.waitFor(/end turn/, 20000);
    await settle(s);
    s.sendKeys("Tab");
    await Bun.sleep(100);
    // From focus, the cycle goes compact, then verbose.
    s.sendKeys({ text: "v" }, { text: "v" });
    await s.waitFor((p) => /density: verbose/.test(statusRow(p)), 3000);
    cfg.write({ theme: { flat: true } });
    expect((await reloaded(r))["changed"]).toEqual(["theme"]);
    await Bun.sleep(300);
    expect(statusRow(s)).toContain("density: verbose");
    cfg.write({ theme: { flat: true }, density: "compact" });
    expect((await reloaded(r, 2))["changed"]).toEqual(["density"]);
    // The setting is compact now, so the compact density carries no mark.
    await s.waitFor((p) => !/density/.test(statusRow(p)) && conversationRows(p).some((row) => /#\d+$/.test(row)), 3000);
  }, 30000);
});

describe("interrupt (task 4.6)", () => {
  let keys: KeysRun | undefined;
  afterEach(async () => {
    keys?.s.kill("SIGTERM");
    await keys?.s.dispose();
    keys = undefined;
  });

  async function runningTurn(config: unknown): Promise<KeysRun> {
    const cfg = configHome(config);
    keys = startKeysCli("basic", 1000, { env: { XDG_CONFIG_HOME: cfg.home } });
    await keys.s.waitFor(READY, 10000);
    keys.s.sendKeys({ text: "go" }, "Enter");
    await keys.s.waitFor(RUNNING, 5000);
    return keys;
  }

  test("the splash and the status row's hint name the presses the setting takes (spec tui-keymap \"Bindings are data\")", async () => {
    const cfg = configHome({ interrupt: "single" });
    keys = startKeysCli("basic", 1000, { env: { XDG_CONFIG_HOME: cfg.home } });
    await keys.s.waitFor(READY, 10000);
    await keys.s.waitFor(/esc interrupt/, 3000);
    expect(keys.s.screenText().join("\n")).not.toContain("esc esc interrupt");
    keys.s.sendKeys({ text: "go" }, "Enter");
    await keys.s.waitFor(RUNNING, 5000);
    await keys.s.waitFor((p) => statusRow(p).includes("esc interrupt"), 3000);
    expect(statusRow(keys.s)).not.toContain("esc esc interrupt");
  }, 20000);

  test("under double (the default) the splash and the running turn's hint say esc esc", async () => {
    const cfg = configHome({});
    keys = startKeysCli("basic", 1000, { env: { XDG_CONFIG_HOME: cfg.home } });
    await keys.s.waitFor(READY, 10000);
    await keys.s.waitFor(/esc esc interrupt/, 3000);
    keys.s.sendKeys({ text: "go" }, "Enter");
    await keys.s.waitFor(RUNNING, 5000);
    await keys.s.waitFor((p) => statusRow(p).includes("esc esc interrupt"), 3000);
  }, 20000);

  test("Single Esc: with interrupt single, a running turn and the prompt box focused, one Esc cancels the turn", async () => {
    const k = await runningTurn({ interrupt: "single" });
    k.s.sendKeys("Esc");
    await k.s.waitFor(() => k.methods().includes("session/cancel"), 5000);
    await k.s.waitFor(READY, 5000);
    expect(statusRow(k.s)).not.toContain("esc again to interrupt");
  }, 20000);

  test("Single Esc closes the palette only: with the palette open, one Esc closes it and the turn keeps running", async () => {
    const k = await runningTurn({ interrupt: "single" });
    k.s.sendKeys("Ctrl+P");
    await k.s.waitFor(/Commands \d+/, 3000);
    k.s.sendKeys("Esc");
    await k.s.waitFor((p) => !/Commands \d+/.test(p.screenText().join("\n")), 3000);
    await Bun.sleep(300);
    expect(k.methods()).not.toContain("session/cancel");
    expect(RUNNING.test(k.s.screenText().join("\n"))).toBe(true);
  }, 20000);

  test("double (the default) arms at the first Esc and cancels at the second", async () => {
    const k = await runningTurn({ interrupt: "double" });
    k.s.sendKeys("Esc");
    await k.s.waitFor((p) => statusRow(p).includes("esc again to interrupt"), 3000);
    expect(k.methods()).not.toContain("session/cancel");
    k.s.sendKeys("Esc");
    await k.s.waitFor(() => k.methods().includes("session/cancel"), 5000);
  }, 20000);
});

/** BEL bytes that are not an OSC string's terminator. */
function bells(raw: string): number {
  return raw.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "").split("\x07").length - 1;
}

describe("attention (task 4.7)", () => {
  // The PTY never reports focus, so the pane counts as unfocused.
  test("Desktop notification: with attention.signal osc9, a permission request writes one OSC 9 of fixed text and no BEL", async () => {
    const cfg = configHome({ attention: { signal: "osc9" } });
    const r = start(cfg.home, { scenario: "basic" });
    await sendPrompt(r.session, "go");
    await r.session.waitFor(REQUIRES_ACTION, 10000);
    await Bun.sleep(200);
    const raw = r.session.rawOutput();
    expect(raw.split("\x1b]9;acp-tui: needs your input\x07").length - 1).toBe(1);
    expect(raw).not.toMatch(/\x1b\]9;(?!acp-tui: needs your input\x07)/);
    expect(bells(raw)).toBe(0);
  }, 30000);

  test("none writes nothing for a permission request", async () => {
    const cfg = configHome({ attention: { signal: "none" } });
    const r = start(cfg.home, { scenario: "basic" });
    await sendPrompt(r.session, "go");
    await r.session.waitFor(REQUIRES_ACTION, 10000);
    await Bun.sleep(200);
    const raw = r.session.rawOutput();
    expect(bells(raw)).toBe(0);
    expect(raw).not.toContain("\x1b]9;");
    expect(raw).not.toContain("\x1b]777;");
  }, 30000);
});

describe("rendering settings (task 4.8)", () => {
  // The card's rule and its two columns of padding (`cards.padding.columns`, day-one-feedback).
  const cardText = (row: string) => row.replace(/^ {2}┃(?: {2})?/, "");

  test("Longer snippets: with tool_output.snippet_rows 20 an execute call's expanded card shows the last 20 lines and a marker row; a reload to 12 shows 12", async () => {
    const cfg = configHome({ density: "compact", tool_output: { snippet_rows: 20 } });
    const r = start(cfg.home, { scenario: "tool-content", cols: 66, rows: 50 });
    const s = r.session;
    await sendPrompt(s, "go");
    await s.waitFor(/end turn/, 20000);
    await settle(s);
    for (const keys of [["Tab"], [{ text: "[" }], [{ text: "[" }], ["Enter"]] as Parameters<PtySession["sendKeys"]>[]) {
      s.sendKeys(...keys);
      await settle(s, 60);
    }
    const marker = () => conversationRows(s).findIndex((row) => /\d+ rows hidden/.test(row));
    // Wait for the expanded card's marker row, not for a quiet screen: under load the CLI can pause
    // after Enter for longer than `settle` waits.
    await s.waitFor(() => marker() >= 0, 15000);
    expect(cardText(conversationRows(s)[marker()]!)).toBe("4980 rows hidden · a or click here to show all");
    const shown = conversationRows(s)
      .slice(marker() + 1, marker() + 21)
      .map((row) => cardText(row).trim());
    expect(shown).toEqual(Array.from({ length: 20 }, (_, i) => `test ${4981 + i} ... ok`));

    cfg.write({ density: "compact", tool_output: { snippet_rows: 12 } });
    await reloaded(r);
    await s.waitFor((p) => conversationRows(p).some((row) => row.includes("4988 rows hidden")), 1000);
  }, 60000);

  test("Heading markers shown live: a reload with markdown.heading_markers true draws `## ` before a level 2 heading", async () => {
    const cfg = configHome({});
    const r = start(cfg.home, { scenario: "markdown-gallery", cols: 100, rows: 600 });
    const s = r.session;
    await sendPrompt(s, "gallery");
    await s.waitFor((p) => p.screenText().some((l) => l.includes("M99 end of gallery")) && READY.test(p.screenText().join("\n")), 20000);
    expect(s.screenText().some((l) => l.includes("Heading level 2"))).toBe(true);
    expect(s.screenText().some((l) => l.includes("## Heading level 2"))).toBe(false);
    cfg.write({ markdown: { heading_markers: true } });
    await reloaded(r);
    await s.waitFor((p) => p.screenText().some((l) => l.includes("## Heading level 2")), 1000);
  }, 60000);
});

describe("agents during a session (task 3.3)", () => {
  let session: PtySession | undefined;
  afterEach(async () => {
    session?.kill("SIGTERM");
    await session?.dispose();
    session = undefined;
  });

  /** Writes the world's user file with `fake`'s arguments (logging to the log of `log`), by a
   *  rename as an editor saves. */
  function configureFake(w: ListWorld, log: string, args: readonly string[]): void {
    const [command, ...rest] = w.fake(log, args);
    const claude = w.fake("claude", ["--scenario", "basic"]);
    const dir = join(w.env["XDG_CONFIG_HOME"]!, "acp-tui");
    const tmp = join(dir, `.config.${Date.now()}.tmp`);
    writeFileSync(tmp, JSON.stringify({ agent_servers: { fake: { command, args: rest }, claude: { command: claude[0], args: claude.slice(1) } } }));
    renameSync(tmp, join(dir, "config.jsonc"));
  }

  test("Agent edited during a session: the running agent process is unchanged, and the next New session with fake launches it with the new arguments", async () => {
    const w = listWorld();
    configureFake(w, "fake", ["--scenario", "basic"]);
    const s = (session = w.start(["-a", "fake"]));
    await s.waitFor(READY, 15000);
    const launched = () => w.events("agent_launched").map((e) => e["pid"] as number);
    expect(launched()).toHaveLength(1);
    const pid = launched()[0]!;

    configureFake(w, "fake-new", ["--scenario", "basic"]);
    await s.waitFor(() => w.events("config_reload").length >= 1, 3000);
    expect(w.events("config_reload")[0]?.["changed"]).toEqual(["agent_servers"]);
    await Bun.sleep(300);
    // The reload launched, cancelled and closed nothing.
    expect(launched()).toEqual([pid]);
    expect(() => process.kill(pid, 0)).not.toThrow();
    expect(w.received("fake").map((e) => e.method)).toEqual(["initialize", "session/new"]);

    // The next session with fake: the new arguments (its log is fake-new's), in a new process.
    s.sendKeys("Ctrl+P");
    await s.waitFor(/Commands \d+/, 3000);
    s.sendKeys({ text: "session list" });
    await s.waitFor(/Commands 1 /, 3000);
    s.sendKeys("Enter");
    await s.waitFor(() => listRows(s).length > 0, 5000);
    s.sendKeys({ text: "with fake" });
    await s.waitFor(() => listBody(s)[1]?.startsWith("New session with fake") ?? false, 3000);
    s.sendKeys("Enter");
    await s.waitFor(() => listRows(s).length === 0, 10000);
    await s.waitFor(READY, 5000);
    expect(w.received("fake-new").map((e) => e.method).slice(0, 2)).toEqual(["initialize", "session/new"]);
    expect(launched()).toHaveLength(2);
    expect(launched()[1]).not.toBe(pid);
    // The old process is closed as on exit once the new session is open.
    await s.waitFor(() => w.events("agent_exited_after_detach").length === 1, 5000);
    expect(w.received("fake").map((e) => e.method)).not.toContain("session/close");
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
  }, 40000);

  test("an unchanged entry keeps the process: New session with fake after an unrelated reload reuses the running agent", async () => {
    const w = listWorld();
    configureFake(w, "fake", ["--scenario", "basic"]);
    const s = (session = w.start(["-a", "fake"]));
    await s.waitFor(READY, 15000);
    s.sendKeys("Ctrl+P");
    await s.waitFor(/Commands \d+/, 3000);
    s.sendKeys({ text: "session list" });
    await s.waitFor(/Commands 1 /, 3000);
    s.sendKeys("Enter");
    await s.waitFor(() => listRows(s).length > 0, 5000);
    s.sendKeys({ text: "with fake" });
    await s.waitFor(() => listBody(s)[1]?.startsWith("New session with fake") ?? false, 3000);
    s.sendKeys("Enter");
    await s.waitFor(() => listRows(s).length === 0, 10000);
    await s.waitFor(READY, 5000);
    expect(w.events("agent_launched")).toHaveLength(1);
    expect(w.received("fake").filter((e) => e.method === "session/new")).toHaveLength(2);
  }, 40000);
});

