// One open per click (mvp-rendering task 14.5, review C9 option A; spec tui-rendering "Opening
// links", scenario "One open in PhpStorm"): acp-tui under a PTY against fake-agent's `links`
// scenario with the opener stubbed (`ACP_TUI_OPENER` records its argument vector). In a terminal
// that detects URLs by itself (`TERMINAL_EMULATOR=JetBrains-JediTerm`), a click inside text the
// IDE's URL patterns match on the row opens nothing in acp-tui, since the IDE opens that text; a
// click with a modifier held is the terminal's everywhere; Zed (`TERM_PROGRAM=zed`) is unchanged.
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PtySession } from "../pty/harness.ts";
import { promptBox, READY, withoutBar } from "../pty/regions.ts";
import { sendPrompt, startCli, type CliRun } from "../conversation/cli.ts";
import { LINKS_LONG_URL } from "fake-agent";
import { localEnv, osc52Payloads } from "../selection/pty.ts";
import { WINDOWS } from "../windows.ts";

let run: CliRun | undefined;
afterEach(async () => {
  await run?.session.dispose();
  run = undefined;
});

/** Nothing names a terminal, so that only what a test sets decides. */
const NO_TERMINAL = { TERM_PROGRAM: undefined, TERMINAL_EMULATOR: undefined, ACP_TUI_CAPABILITIES: undefined };
const JETBRAINS = { ...NO_TERMINAL, TERMINAL_EMULATOR: "JetBrains-JediTerm" };
const ZED = { ...NO_TERMINAL, TERM_PROGRAM: "zed" };

async function start(env: Record<string, string | undefined>): Promise<{ s: PtySession; log: string; events: CliRun["events"] }> {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-opener-"));
  const script = join(dir, "opener.sh");
  const log = join(dir, "argv.txt");
  writeFileSync(script, '#!/bin/sh\n{ printf "%s\\n" "$#"; for a in "$@"; do printf "%s\\n" "$a"; done; } >> "$OPENER_LOG"\n');
  chmodSync(script, 0o755);
  run = startCli({ scenario: "links", cols: 100, rows: 30, env: localEnv({ ACP_TUI_OPENER: script, OPENER_LOG: log, ...env }) });
  const s = run.session;
  await sendPrompt(s, "show me links");
  await s.waitFor((p) => p.screenText().some((l) => l.includes("A deceptive one:")) && READY.test(p.screenText().join("\n")), 15000);
  await Bun.sleep(200);
  return { s, log, events: run.events };
}

/** The cell (column, row) where `text` is first drawn. */
function cellOf(s: PtySession, text: string): [number, number] {
  const rows = s.screenText();
  const y = rows.findIndex((l) => l.includes(text));
  if (y < 0) throw new Error(`no ${JSON.stringify(text)} on screen\n${rows.join("\n")}`);
  return [rows[y]!.indexOf(text), y];
}

const toast = (s: PtySession) => promptBox(s)[0] ?? "";
const opened = (log: string) => (existsSync(log) ? readFileSync(log, "utf8").split("\n").slice(0, -1) : []);

describe("one open per click (C9)", () => {
  // Skipped on Windows: the opener is a #!/bin/sh stub that records its arguments (the Windows opener is rundll32, covered by the argv tests in test/links/open.test.ts).
  test.skipIf(WINDOWS)("One open in PhpStorm: a click on the label https://bank.example of a link to evil.example opens nothing in acp-tui, and a toast names evil.example", async () => {
    const { s, log, events } = await start(JETBRAINS);
    expect(s.screenText().some((l) => l.includes("A deceptive one: https://bank.example (evil.example)."))).toBe(true);
    const [x, y] = cellOf(s, "https://bank.example");
    s.mouseClick(x + 9, y);
    await s.waitFor((p) => toast(p).includes("evil.example"), 5000);
    expect(toast(s)).toContain("this link goes to evil.example");
    await Bun.sleep(400);
    expect(opened(log)).toEqual([]);
    expect(events("link_open")).toEqual([expect.objectContaining({ action: "defer", kind: "web", trigger: "click" })]);
  }, 30000);

  // Skipped on Windows: the opener is a #!/bin/sh stub that records its arguments (the Windows opener is rundll32, covered by the argv tests in test/links/open.test.ts).
  test.skipIf(WINDOWS)("PhpStorm: the host hint after the deceptive label, and a label that is no URL, open through acp-tui; a bare URL is left to the IDE with no toast", async () => {
    const { s, log, events } = await start(JETBRAINS);
    const [hx, hy] = cellOf(s, "(evil.example)");
    s.mouseClick(hx + 2, hy);
    await s.waitFor(() => opened(log).length >= 2, 5000);
    expect(opened(log)).toEqual(["1", "https://evil.example/login"]);
    await Bun.sleep(500);
    const [dx, dy] = cellOf(s, "the docs");
    s.mouseClick(dx + 1, dy);
    await s.waitFor(() => opened(log).length >= 4, 5000);
    expect(opened(log).slice(2)).toEqual(["1", "https://example.com/docs"]);
    await s.waitFor((p) => toast(p).includes("opening example.com"), 5000);
    await Bun.sleep(500);
    const [bx, by] = cellOf(s, "https://example.com/bare/url");
    s.mouseClick(bx + 5, by);
    await s.waitFor(() => events("link_open").length >= 3, 5000);
    await Bun.sleep(300);
    expect(opened(log)).toHaveLength(4);
    expect(toast(s)).not.toContain("this link goes to");
    expect(events("link_open").map((e) => e["action"])).toEqual(["open", "open", "defer"]);
  }, 30000);

  // Skipped on Windows: the opener is a #!/bin/sh stub that records its arguments (the Windows opener is rundll32, covered by the argv tests in test/links/open.test.ts).
  test.skipIf(WINDOWS)("a click with Ctrl, Alt or Shift held is the terminal's: acp-tui opens nothing, here or in PhpStorm", async () => {
    const { s, log, events } = await start(NO_TERMINAL);
    const [x, y] = cellOf(s, "the docs");
    for (const mods of [{ ctrl: true }, { alt: true }, { shift: true }]) {
      s.mouseClick(x + 1, y, "left", mods);
      await Bun.sleep(450);
    }
    expect(opened(log)).toEqual([]);
    expect(events("link_open")).toEqual([]);
    // A plain click still opens.
    s.mouseClick(x + 1, y);
    await s.waitFor(() => opened(log).length >= 2, 5000);
    expect(opened(log)).toEqual(["1", "https://example.com/docs"]);
  }, 30000);

  // Skipped on Windows: the opener is a #!/bin/sh stub that records its arguments (the Windows opener is rundll32, covered by the argv tests in test/links/open.test.ts).
  test.skipIf(WINDOWS)("A1, PhpStorm: the long bare URL is drawn on one row without its scheme, shortened with …; a click opens the full URL through acp-tui and a drag copies it whole", async () => {
    const { s, log, events } = await start(JETBRAINS);
    const rows = s.screenText();
    const y = rows.findIndex((l) => l.includes("example.com/a/very/long/"));
    expect(y).toBeGreaterThan(0);
    const row = rows[y]!;
    expect(row).toContain("…");
    expect(row).toContain("?query=string");
    expect(row).not.toContain("https://example.com/a/very");
    expect(rows[y - 1]).toContain("A long one:");
    expect(rows[y + 1]!.trim()).not.toContain("query=string");
    const x = row.indexOf("example.com/a/very");
    s.mouseClick(x + 20, y);
    await s.waitFor(() => opened(log).length >= 2, 5000);
    expect(opened(log)).toEqual(["1", LINKS_LONG_URL]);
    expect(events("link_open")).toEqual([expect.objectContaining({ action: "open", trigger: "click" })]);
    // A drag from the end of "A long one:" into the URL copies the whole URL.
    await Bun.sleep(500);
    const [ax, ay] = cellOf(s, "long one:");
    s.mousePress(ax, ay);
    s.mouseMove(ax + 3, ay, "left");
    await Bun.sleep(15);
    s.mouseMove(x + 10, y, "left");
    await Bun.sleep(15);
    s.mouseRelease(x + 10, y);
    await s.waitFor((p) => osc52Payloads(p.rawOutput()).length > 0, 5000);
    expect(osc52Payloads(s.rawOutput())[0]).toBe(`long one: ${LINKS_LONG_URL}`);
  }, 30000);

  test("A1: without a terminal that detects URLs (Zed) the long URL still wraps over two rows with its scheme", async () => {
    const { s } = await start(ZED);
    // Its first row fills the conversation's width: the pane less the gutter, the right margin and
    // the scroll bar (mvp-chrome-and-keys D17).
    expect(withoutBar(s.screenText()).some((l) => l.trim() === LINKS_LONG_URL.slice(0, s.cols - 5))).toBe(true);
  }, 30000);

  // Skipped on Windows: the opener is a #!/bin/sh stub that records its arguments (the Windows opener is rundll32, covered by the argv tests in test/links/open.test.ts).
  test.skipIf(WINDOWS)("Zed is unchanged: the deceptive label and a bare URL open their targets through acp-tui on a plain click", async () => {
    const { s, log, events } = await start(ZED);
    const [x, y] = cellOf(s, "https://bank.example");
    s.mouseClick(x + 9, y);
    await s.waitFor(() => opened(log).length >= 2, 5000);
    expect(opened(log)).toEqual(["1", "https://evil.example/login"]);
    await Bun.sleep(500);
    const [bx, by] = cellOf(s, "https://example.com/bare/url");
    s.mouseClick(bx + 5, by);
    await s.waitFor(() => opened(log).length >= 4, 5000);
    expect(opened(log).slice(2)).toEqual(["1", "https://example.com/bare/url"]);
    expect(events("link_open").map((e) => e["action"])).toEqual(["open", "open"]);
  }, 30000);
});
