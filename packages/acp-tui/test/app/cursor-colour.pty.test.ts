// The prompt box cursor's colour under the real CLI (prompt-box-feedback group 2 and 3; specs
// tui-layout "Prompt box cursor colour", "Terminal's own cursor colour", "Cursor hidden until its
// colour is known", "Cursor colour kept across reloads", tui-screen "Cursor colour restored"): the
// `OSC 12` and `OSC 112` sequences acp-tui wrote, read from the raw output, against terminals that
// answer `OSC 10`, `11` and `12` as the scenario says. The recording of the original failure is
// test/fixtures/foot-light-cursor.txt; foot's own replies are test/pty/cursor-foot.pty.test.ts.
import { afterEach, describe, expect, test } from "bun:test";
import { startCli, type CliRun } from "../conversation/cli.ts";
import { configHome } from "../pty/config-home.ts";
import { cursorColourProblems, type TerminalReplies } from "../pty/cursor-colour.ts";
import type { OscColours, PtySession } from "../pty/harness.ts";
import { READY } from "../pty/regions.ts";
import { WINDOWS } from "../windows.ts";

let run: CliRun | undefined;
afterEach(async () => {
  run?.session.kill("SIGKILL");
  await run?.session.dispose();
  run = undefined;
});

const GREYS = Array.from({ length: 16 }, (_, i) => `#${(i * 17).toString(16).padStart(2, "0").repeat(3)}`);
const LIGHT: TerminalReplies = { foreground: "#212121", background: "#fafafa", cursor: "#000000" };
const light = (extra: Partial<OscColours> = {}): OscColours => ({ ...LIGHT, palette: GREYS, terminator: "bel", ...extra });

/** Every cursor colour sequence written so far, in order: `set <value>`, `query`, `reset`. */
function sequences(s: PtySession): string[] {
  return [...s.rawOutput().matchAll(/\x1b\](112|12;[^\x07\x1b]*)(?:\x07|\x1b\\)/g)].map((m) => (m[1] === "112" ? "reset" : m[1] === "12;?" ? "query" : `set ${m[1]!.slice(3)}`));
}
const sets = (s: PtySession): string[] => sequences(s).filter((x) => x.startsWith("set "));
const count = (s: PtySession, what: string): number => sequences(s).filter((x) => x === what).length;

function start(colours: OscColours | undefined, extra: { env?: Record<string, string | undefined>; cols?: number; rows?: number } = {}): PtySession {
  run = startCli({ scenario: "basic", ...(colours ? { colours } : {}), cols: extra.cols ?? 101, rows: extra.rows ?? 49, ...(extra.env ? { env: extra.env } : {}) });
  return run.session;
}

/** Ctrl+D, then the run's whole output checked against the rule. */
async function leave(s: PtySession, replies: TerminalReplies): Promise<void> {
  s.sendKeys("Ctrl+D");
  await s.wait();
  expect(cursorColourProblems(s.rawOutput(), replies, { allowTeardownDefault: true })).toEqual([]);
}

// Skipped on Windows: ConPTY answers or swallows the terminal's colour queries itself.
describe.skipIf(WINDOWS)("The cursor's colour comes from the terminal's replies", () => {
  test("Light theme with a dark cursor: the only colour set is the reported black, and the checker finds nothing", async () => {
    const s = start(light({ cursorFollowsSet: true }));
    await s.waitFor(READY, 15000);
    await s.waitFor((p) => sets(p).length > 0, 5000);
    expect(sets(s)).toEqual(["set #000000"]);
    await leave(s, LIGHT);
    // No white and no `default` before the teardown: the one set before leaving is black.
    const live = s.rawOutput().slice(0, s.rawOutput().lastIndexOf("\x1b[?1049l"));
    expect(live).not.toContain("\x1b]12;#ffffff");
    expect(live).not.toContain("\x1b]12;default");
  }, 30000);

  test("Placeholder black on a dark background: the foreground", async () => {
    const replies = { foreground: "#c0caf5", background: "#1a1b26", cursor: "#000000" };
    const s = start(light({ ...replies }));
    await s.waitFor(READY, 15000);
    await s.waitFor((p) => sets(p).length > 0, 5000);
    expect(sets(s)).toEqual(["set #c0caf5"]);
    await leave(s, replies);
  }, 30000);

  test("Configured cursor kept", async () => {
    const replies = { foreground: "#a9b1d6", background: "#1a1b26", cursor: "#c0caf5" };
    const s = start(light({ ...replies }));
    await s.waitFor(READY, 15000);
    await s.waitFor((p) => sets(p).length > 0, 5000);
    expect(sets(s)).toEqual(["set #c0caf5"]);
    await leave(s, replies);
  }, 30000);

  test("No cursor reply (PhpStorm): no OSC 4, 12 never answered, the foreground is the colour and nothing is written before it", async () => {
    const replies = { foreground: "#d4d4d4", background: "#1e1e1e" };
    const s = start({ ...replies, terminator: "bel" });
    await s.waitFor(READY, 15000);
    await s.waitFor((p) => sets(p).length > 0, 5000);
    expect(sets(s)).toEqual(["set #d4d4d4"]);
    // The query went out before anything was set.
    expect(sequences(s)[0]).toBe("query");
    await leave(s, replies);
  }, 30000);

  test("Cursor shown with no background reply: the reported cursor colour as it is", async () => {
    const s = start({ cursor: "#123456", terminator: "bel" });
    await s.waitFor(READY, 15000);
    await s.waitFor((p) => sets(p).length > 0, 5000);
    expect(sets(s)).toEqual(["set #123456"]);
  }, 30000);
});

describe.skipIf(WINDOWS)("The terminal's own colour", () => {
  test("No colour replies at all: nothing is set, and OSC 112 follows the frames that show the cursor (focus away and back, Ctrl+L, a resize)", async () => {
    const s = start(undefined);
    await s.waitFor(READY, 15000);
    // The first frame writes OpenTUI's own OSC 12 with the text colour; OSC 112 follows it.
    const idle = (p: PtySession) => sequences(p).at(-1) === "reset";
    await s.waitFor((p) => count(p, "reset") >= 1 && idle(p), 5000);
    expect(sequences(s)[0]).toBe("query");

    let n = count(s, "reset");
    s.sendKeys("Tab"); // the conversation
    s.sendKeys("Tab"); // the prompt box again
    await s.waitFor((p) => count(p, "reset") > n && idle(p), 5000);

    n = count(s, "reset");
    s.sendKeys("Ctrl+L");
    await s.waitFor((p) => count(p, "reset") > n && idle(p), 5000);

    n = count(s, "reset");
    s.resize(90, 40);
    await s.waitFor((p) => count(p, "reset") > n && idle(p), 5000);

    s.sendKeys("Ctrl+D");
    await s.wait();
    expect(cursorColourProblems(s.rawOutput(), {}, { allowTeardownDefault: true }).filter((p) => p.kind !== "before-replies")).toEqual([]);
  }, 40000);

  test("Nothing written under 'terminal' when a colour is usable: no OSC 112 while running", async () => {
    const s = start(light());
    await s.waitFor(READY, 15000);
    await s.waitFor((p) => sets(p).length > 0, 5000);
    s.sendKeys("Tab", "Tab", "Ctrl+L");
    s.resize(90, 40);
    s.sendKeys("Ctrl+L");
    await s.waitFor(() => run!.events("repaint").length > 1, 5000);
    expect(count(s, "reset")).toBe(0);
  }, 30000);
});

describe.skipIf(WINDOWS)("Kept and chosen again", () => {
  test("Kept after Ctrl+L and a reload: only the one colour is ever set", async () => {
    const cfg = configHome({ density: "compact" });
    const s = start(light(), { env: { XDG_CONFIG_HOME: cfg.home } });
    await s.waitFor(READY, 15000);
    await s.waitFor((p) => sets(p).length > 0, 5000);
    s.sendKeys("Ctrl+L");
    await s.waitFor(() => run!.events("repaint").length > 0, 5000);
    cfg.write({ density: "verbose", theme: { flat: true } });
    await s.waitFor(() => run!.events("config_reload").length > 0, 5000);
    s.sendKeys("Ctrl+L");
    await s.waitFor(() => run!.events("repaint").length > 1, 5000);
    await Bun.sleep(300);
    expect(new Set(sets(s))).toEqual(new Set(["set #000000"]));
    expect(count(s, "reset")).toBe(0);
  }, 40000);

  test("Terminal switched to a dark theme: Ctrl+L chooses the foreground", async () => {
    const s = start(light());
    await s.waitFor(READY, 15000);
    await s.waitFor((p) => sets(p).length > 0, 5000);
    s.setColours(light({ foreground: "#c0caf5", background: "#1a1b26", cursor: "#000000" }));
    s.sendKeys("Ctrl+L");
    await s.waitFor((p) => sets(p).at(-1) === "set #c0caf5", 5000);
    expect(sets(s)).toEqual(["set #000000", "set #c0caf5"]);
  }, 30000);
});
