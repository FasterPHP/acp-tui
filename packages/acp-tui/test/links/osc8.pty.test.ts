// OSC 8 only where verified, in the real CLI (mvp-rendering task 6.4; spec tui-rendering "OSC 8
// only where verified"): acp-tui under a PTY against fake-agent's `links` and `markdown-gallery`.
// A terminal is forced to `osc8: true` with `ACP_TUI_CAPABILITIES=osc8` (renderer/capabilities.ts),
// or is Zed (`TERM_PROGRAM=zed`), the one terminal the table marks verified (IDE check 12.3,
// 9 October 2026). The tests clear TERM_PROGRAM and TERMINAL_EMULATOR first, so that the
// terminal running them does not decide.
//
// How OpenTUI writes a link (measured): `ESC ] 8 ; id=N ; <url> ESC \` before the first linked
// cell and `ESC ] 8 ; ; ESC \` after the last; between two rows of one wrapped link it moves the
// cursor without closing (no cell is printed in between). The tests check what matters in the
// terminal: while a hyperlink is open, only that link's own cells are printed, row after row.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { LINKS_LONG_URL } from "fake-agent";
import { startPty, type PtySession } from "../pty/harness.ts";
import { READY, withoutBar } from "../pty/regions.ts";
import { CLI, FAKE_AGENT, PREFILL, readEvents, sendPrompt, startCli, type CliRun } from "../conversation/cli.ts";
import { localEnv } from "../selection/pty.ts";

let run: CliRun | undefined;
afterEach(async () => {
  await run?.session.dispose();
  run = undefined;
});

const OSC8 = /\x1b\]8;([^;\x1b\x07]*);([^\x1b\x07]*)(?:\x1b\\|\x07)/g;
// Everything that is not printed text: CSI, other OSC strings, charset designations.
const CONTROLS = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-Za-z]|\x1b[=>78]/g;

interface Hyperlink {
  readonly url: string;
  /** The `id=` parameter, or "" without one. */
  readonly id: string;
  /** What was printed while it was open. */
  readonly text: string;
  /** The rows the cursor was moved to while it was open (1-based, from `CSI row ; col H`). */
  readonly rows: readonly number[];
}

/** Every OSC 8 hyperlink in the output, with what was printed while it was open. Throws if one
 *  opens while another is open, or is never closed. */
function hyperlinks(raw: string): Hyperlink[] {
  const out: Hyperlink[] = [];
  let open: { url: string; id: string; from: number } | null = null;
  for (const m of raw.matchAll(OSC8)) {
    const url = m[2]!;
    if (url !== "") {
      if (open) throw new Error(`a hyperlink to ${url} opened while one to ${open.url} was open`);
      open = { url, id: /(?:^|:)id=([^:]*)/.exec(m[1]!)?.[1] ?? "", from: m.index! + m[0].length };
      continue;
    }
    if (!open) continue;
    const between = raw.slice(open.from, m.index!);
    const rows = [...between.matchAll(/\x1b\[(\d+);\d+H/g)].map((r) => Number(r[1]));
    out.push({ url: open.url, id: open.id, text: between.replace(CONTROLS, ""), rows });
    open = null;
  }
  if (open) throw new Error(`the hyperlink to ${open.url} was never closed`);
  return out;
}

/** The one `hyperlinks` log event: what the renderer was constructed with (`FORCE_HYPERLINK`,
 *  opentui-0-6 design D4); no `applied` since OpenTUI 0.6 (no run-time setter to report on). */
function expectHyperlinksLogged(osc8: boolean): void {
  const events = run!.events("hyperlinks");
  expect(events).toEqual([expect.objectContaining({ osc8 })]);
  expect(events[0]).not.toHaveProperty("applied");
}

/** Nothing names a terminal, so that only what a test sets decides. */
const NO_TERMINAL = { TERM_PROGRAM: undefined, TERMINAL_EMULATOR: undefined };

async function startLinks(env: Record<string, string | undefined>): Promise<{ s: PtySession; dir: string }> {
  run = startCli({ scenario: "links", cols: 100, rows: 30, env: localEnv(env) });
  const s = run.session;
  await sendPrompt(s, "show me links");
  await s.waitFor((p) => p.screenText().some((l) => l.includes("A long one:")) && READY.test(p.screenText().join("\n")), 15000);
  await Bun.sleep(300);
  return { s, dir: dirname(run.logPath) };
}

describe("OSC 8 (task 6.4)", () => {
  test("Verified terminal: each allowed link is wrapped in OSC 8 with its target, row after row, and closed; a refused one never", async () => {
    const { s, dir } = await startLinks({ ...NO_TERMINAL, ACP_TUI_CAPABILITIES: "osc8" });
    const links = hyperlinks(s.rawOutput());
    const readme = pathToFileURL(join(dir, "README.md")).href;
    expect(new Set(links.map((l) => l.url))).toEqual(
      new Set(["https://example.com/docs", "https://example.com/inline", "https://example.com/bare/url", "mailto:team@example.com", readme, "https://evil.example/login", LINKS_LONG_URL]),
    );
    // What is printed while a link is open is that link's own text: the label alone. The host
    // hint after a differing label is clickable in acp-tui but outside the OSC 8 span (IDE
    // follow-up 5: Zed underlined it as part of the link).
    const printed = (url: string) => links.filter((l) => l.url === url).map((l) => l.text);
    expect(printed("https://example.com/docs")).toEqual(["the docs"]);
    expect(printed("https://example.com/bare/url")).toEqual(["https://example.com/bare/url"]);
    expect(printed("mailto:team@example.com")).toEqual(["mail us"]);
    expect(links.some((l) => l.text.includes("example.com)") || l.text.includes("(team@"))).toBe(false);
    // The long URL wraps over two rows: every printed cell of both rows is inside the one link.
    // OpenTUI keeps the link open across the move to the next row when nothing else is printed
    // there; since 0.6 it closes it at the row's end and opens it again with the same `id` when
    // the frame also prints the next row's gutter (seen in about one run in three, opentui-0-6
    // task 3.3), which a terminal joins into one link. Either way the first drawing of the link
    // is its whole text, over two consecutive rows, under one id.
    const longSpans = links.filter((l) => l.url === LINKS_LONG_URL);
    let drawn = "";
    const first: Hyperlink[] = [];
    for (const span of longSpans) {
      if (drawn === LINKS_LONG_URL) break;
      drawn += span.text;
      first.push(span);
    }
    expect(drawn).toBe(LINKS_LONG_URL);
    expect(new Set(first.map((l) => l.id)).size).toBe(1);
    expect(first[0]!.id).not.toBe("");
    const rows = [...new Set(first.flatMap((l) => l.rows))].sort((a, b) => a - b);
    expect(rows.length).toBe(2);
    expect(rows[1]).toBe(rows[0]! + 1);
    const screen = withoutBar(s.screenText());
    // Its first row fills the conversation's width: the pane less the gutter, the right margin
    // and the scroll bar.
    expect(screen.some((l) => l.trim() === LINKS_LONG_URL.slice(0, s.cols - 5))).toBe(true);
    // The refused target is drawn, but never linked.
    expect(screen.some((l) => l.includes("script link (javascript:alert(1))"))).toBe(true);
    expect(links.some((l) => l.url.includes("javascript") || l.text.includes("script link"))).toBe(false);
    expectHyperlinksLogged(true);
  }, 30000);

  test("Zed (TERM_PROGRAM=zed): an allowed link is written with OSC 8 and a refused one is not", async () => {
    const { s, dir } = await startLinks({ ...NO_TERMINAL, TERM_PROGRAM: "zed" });
    const links = hyperlinks(s.rawOutput());
    const readme = pathToFileURL(join(dir, "README.md")).href;
    expect(new Set(links.map((l) => l.url))).toEqual(
      new Set(["https://example.com/docs", "https://example.com/inline", "https://example.com/bare/url", "mailto:team@example.com", readme, "https://evil.example/login", LINKS_LONG_URL]),
    );
    expect(links.filter((l) => l.url === "https://example.com/docs").map((l) => l.text)).toEqual(["the docs"]);
    expect(s.screenText().some((l) => l.includes("script link (javascript:alert(1))"))).toBe(true);
    expect(links.some((l) => l.url.includes("javascript") || l.text.includes("script link"))).toBe(false);
    expectHyperlinksLogged(true);
  }, 30000);

  test("PhpStorm (both engines): TERMINAL_EMULATOR=JetBrains-JediTerm writes no ESC ] 8 ; for markdown-gallery", async () => {
    run = startCli({ scenario: "markdown-gallery", cols: 100, rows: 40, env: localEnv({ ...NO_TERMINAL, TERMINAL_EMULATOR: "JetBrains-JediTerm" }) });
    const s = run.session;
    await sendPrompt(s, "gallery");
    await s.waitFor((p) => p.screenText().some((l) => l.includes("M99 end of gallery")) && READY.test(p.screenText().join("\n")), 15000);
    await Bun.sleep(300);
    expect(s.rawOutput()).not.toContain("\x1b]8;");
    expectHyperlinksLogged(false);
  }, 30000);

  test("Zed with ACP_TUI_CAPABILITIES=osc8=false: the override wins, no ESC ] 8 ; is written (opentui-0-6 task 3.3)", async () => {
    const { s } = await startLinks({ ...NO_TERMINAL, TERM_PROGRAM: "zed", ACP_TUI_CAPABILITIES: "osc8=false" });
    expect(s.rawOutput()).not.toContain("\x1b]8;");
    expectHyperlinksLogged(false);
  }, 30000);

  test("the agent's environment holds none of the renderer's overrides (opentui-0-6 task 3.3)", async () => {
    // The agent is a shell that records its environment and then runs fake-agent; acp-tui runs
    // as Zed, where every override applies (FORCE_HYPERLINK=1, COLORTERM, the two probe switches).
    const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-agent-env-"));
    const envFile = join(dir, "agent-env");
    const logPath = join(dir, "acp-tui.log");
    const env = localEnv({ ...NO_TERMINAL, TERM_PROGRAM: "zed", COLORTERM: undefined, FORCE_HYPERLINK: undefined, OPENTUI_GRAPHICS: undefined, OPENTUI_FORCE_EXPLICIT_WIDTH: undefined, ACP_TUI_LOG: logPath });
    const agent = ["sh", "-c", `env > '${envFile}'; exec bun '${FAKE_AGENT}' --scenario basic --delay-scale 0`];
    const s = startPty(["bun", CLI, "--", ...agent], { cols: 100, rows: 30, cwd: dir, env, prefill: PREFILL });
    run = { session: s, logPath, events: (name) => readEvents(logPath, name), agentMethods: () => [] };
    await s.waitFor(READY, 15000);
    expectHyperlinksLogged(true);
    const seen = readFileSync(envFile, "utf8").split("\n");
    expect(seen.some((l) => l.startsWith("TERM_PROGRAM=zed"))).toBe(true);
    for (const key of ["FORCE_HYPERLINK", "OPENTUI_GRAPHICS", "OPENTUI_FORCE_EXPLICIT_WIDTH", "COLORTERM"]) {
      expect(seen.filter((l) => l.startsWith(`${key}=`)), key).toEqual([]);
    }
  }, 30000);

  test("a terminal OpenTUI itself would link (kitty) but the table does not mark gets no OSC 8 either", async () => {
    const { s } = await startLinks({ ...NO_TERMINAL, TERM: "xterm-kitty" });
    expect(s.rawOutput()).not.toContain("\x1b]8;");
  }, 30000);

  test("markdown-gallery under a verified terminal: no refused target (M31, M33, M35) is ever in OSC 8", async () => {
    run = startCli({ scenario: "markdown-gallery", cols: 100, rows: 40, env: localEnv({ ...NO_TERMINAL, ACP_TUI_CAPABILITIES: "osc8" }) });
    const s = run.session;
    await sendPrompt(s, "gallery");
    await s.waitFor((p) => p.screenText().some((l) => l.includes("M99 end of gallery")) && READY.test(p.screenText().join("\n")), 15000);
    // Through the whole gallery, so every row is drawn at least once.
    for (let k = 0; k < 40; k++) s.sendKeys("PageUp");
    await Bun.sleep(800);
    const urls = new Set(hyperlinks(s.rawOutput()).map((l) => l.url));
    expect(urls.has("https://example.com/inline")).toBe(true);
    for (const url of urls) expect(url).toMatch(/^(https?:|mailto:|file:\/\/\/)/);
    for (const url of urls) expect(url).not.toMatch(/javascript|data:|\/etc\/(passwd|hosts)|outside\/secret|html-link/i);
  }, 60000);
});
