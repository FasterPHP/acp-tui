// mvp-chrome-and-keys task 4.7 (spec tui-layout "Splash screen"; design D2):
// the splash's rows, pure. The PTY tests are test/app/splash.pty.test.ts.
import { describe, expect, test } from "bun:test";
import { PERMISSION_GLYPHS } from "../../src/app/permission.ts";
import { DEFAULT_GLYPHS } from "../../src/conversation/glyphs.ts";
import { ASCII_CHROME_GLYPHS, DEFAULT_CHROME_GLYPHS } from "../../src/layout/glyphs.ts";
import { DEFAULT_KEY_MAP, loadKeyMap } from "../../src/keys/keymap.ts";
import { displayWidth } from "../../src/layout/segments.ts";
import { harnessName, hintRows, SPLASH_TAGLINE, splashHints, splashLaunch, splashLayout, type SplashInput } from "../../src/app/splash.ts";

const INPUT: SplashInput = {
  version: "0.0.0",
  agent: "claude-agent-acp",
  model: "Opus 5.5",
  cwd: "/work/repo-b",
  launch: { harness: "fake", directory: "/work/repo-b" },
  connecting: false,
  spinner: DEFAULT_GLYPHS.spinner,
  home: "/home/marcus",
  keyMap: DEFAULT_KEY_MAP,
  glyphs: DEFAULT_CHROME_GLYPHS,
};
const text = (rows: { text: string }[][]) => rows.map((r) => r.map((s) => s.text).join(""));

describe("splash rows (task 4.7)", () => {
  test("new session at IDE-pane size: wordmark, graphic, agent, model, cwd and every hint in the conversation's 12 rows at 63 columns", () => {
    const layout = splashLayout(INPUT, 63, 12);
    expect(layout.shown).toEqual(["wordmark", "graphic", "identity", "hints"]);
    const all = text(layout.rows).join("\n");
    for (const part of ["┏━┓", "0.0.0", "IDE · terminal", "acp-tui", "opencode", "Harness: claude-agent-acp", "Model: Opus 5.5", "/work/repo-b", "enter", "shift+enter", "/ commands", "@ files", "? help", "esc esc", "ctrl+d"]) {
      expect(all).toContain(part);
    }
    expect(layout.rows.length).toBeLessThanOrEqual(12);
    expect(layout.top + layout.rows.length).toBeLessThanOrEqual(12);
    for (const row of text(layout.rows)) expect(displayWidth(row)).toBeLessThanOrEqual(63);
  });

  test("the hints come from the key map in use", () => {
    expect(splashHints(DEFAULT_KEY_MAP).map((h) => `${h.key} ${h.label}`)).toEqual([
      "enter send",
      "shift+enter newline",
      "/ commands",
      "@ files",
      "? help",
      "esc esc interrupt",
      "ctrl+d detach",
    ]);
    const rebound = loadKeyMap({ global: { "ctrl+d": null, "ctrl+q": "detach" } });
    expect(splashHints(rebound).map((h) => h.key)).toContain("ctrl+q");
  });

  test("the interrupt hint follows the interrupt setting: one Esc under single", () => {
    expect(splashHints(DEFAULT_KEY_MAP, "single").map((h) => `${h.key} ${h.label}`)).toContain("esc interrupt");
    expect(splashHints(DEFAULT_KEY_MAP, "double").map((h) => `${h.key} ${h.label}`)).toContain("esc esc interrupt");
    const all = text(splashLayout({ ...INPUT, interrupt: "single" }, 100, 30).rows).join("\n");
    expect(all).toContain("esc interrupt");
    expect(all).not.toContain("esc esc");
  });

  test("tiny pane: at 50x14 (7 conversation rows) the hints without the graphic, nothing cut mid-word", () => {
    const layout = splashLayout(INPUT, 50, 7);
    expect(layout.shown).not.toContain("graphic");
    expect(layout.shown).toContain("hints");
    const all = text(layout.rows).join("\n");
    for (const hint of splashHints(DEFAULT_KEY_MAP)) expect(all).toContain(`${hint.key} ${hint.label}`);
    expect(all).not.toContain("…");
  });

  test("drop order: the graphic, then the wordmark, then the blank rows, then the identity; never the hints", () => {
    expect(splashLayout(INPUT, 63, 12).shown).toEqual(["wordmark", "graphic", "identity", "hints"]);
    expect(splashLayout(INPUT, 63, 9).shown).toEqual(["wordmark", "identity", "hints"]);
    expect(splashLayout(INPUT, 63, 6).shown).toEqual(["identity", "hints"]);
    expect(splashLayout(INPUT, 63, 4).rows.some((r) => r.length === 0)).toBe(false);
    expect(splashLayout(INPUT, 63, 3).shown).toEqual(["hints"]);
    // Too narrow for the graphic (51 columns): it goes at any height.
    expect(splashLayout(INPUT, 50, 40).shown).toEqual(["wordmark", "identity", "hints"]);
  });

  test("the graphic (task 12.3): `IDE · terminal ━→ acp-tui ━→ claude · codex · opencode · …`, 58 columns; kept at 63 and 61 columns in 12 rows, dropped below 58", () => {
    const graphic = (width: number, height = 12) => text(splashLayout(INPUT, width, height).rows).filter((r) => r.includes("acp-tui ━→"));
    expect(graphic(63)).toEqual(["IDE · terminal ━→ acp-tui ━→ claude · codex · opencode · …"]);
    expect(displayWidth(graphic(63)[0]!)).toBe(58);
    // 63x21 and 61x20 both leave the conversation 12 rows (design D1): the whole splash fits.
    for (const width of [63, 61]) {
      const layout = splashLayout(INPUT, width, 12);
      expect([width, layout.shown]).toEqual([width, ["wordmark", "graphic", "identity", "hints"]]);
      expect(layout.rows.length).toBe(12);
    }
    // The hints take two rows at both widths: `? help` ends the first at 63 and starts the second
    // at 61.
    expect(text(splashLayout(INPUT, 63, 12).rows).slice(-2)).toEqual(["enter send  shift+enter newline  / commands  @ files  ? help", "esc esc interrupt  ctrl+d detach"]);
    expect(text(splashLayout(INPUT, 61, 12).rows).slice(-2)).toEqual(["enter send  shift+enter newline  / commands  @ files", "? help  esc esc interrupt  ctrl+d detach"]);
    // The drop order at 61 columns is the same as at 63.
    expect(splashLayout(INPUT, 61, 9).shown).toEqual(["wordmark", "identity", "hints"]);
    expect(splashLayout(INPUT, 61, 6).shown).toEqual(["identity", "hints"]);
    expect(splashLayout(INPUT, 61, 3).shown).toEqual(["hints"]);
    // Wider than the region: left out at any height.
    expect(splashLayout(INPUT, 58, 40).shown).toContain("graphic");
    expect(splashLayout(INPUT, 57, 40).shown).not.toContain("graphic");
    // The graphic's second row is the tagline (Marcus, 15 October 2026), not the features.
    expect(text(splashLayout(INPUT, 63, 12).rows)).toContain("clear · concise · fast · customisable");
    // The ascii set's arrow, separator and `more`.
    const ascii = text(splashLayout({ ...INPUT, glyphs: ASCII_CHROME_GLYPHS }, 63, 12).rows).find((r) => r.includes("acp-tui ->"));
    expect(ascii).toBe("IDE - terminal -> acp-tui -> claude - codex - opencode - ...");
  });

  test("centred: as many rows above as below, give or take one", () => {
    const layout = splashLayout(INPUT, 63, 20);
    const below = 20 - layout.top - layout.rows.length;
    expect(Math.abs(layout.top - below)).toBeLessThanOrEqual(1);
  });

  test("hints wrap between whole hints", () => {
    const rows = text(hintRows(splashHints(DEFAULT_KEY_MAP), 20));
    expect(rows).toEqual(["enter send", "shift+enter newline", "/ commands  @ files", "? help", "esc esc interrupt", "ctrl+d detach"]);
  });

  test("tagline: the graphic's second row is acp-tui's qualities and no row names the palette", () => {
    expect(SPLASH_TAGLINE.join(" · ")).toBe("clear · concise · fast · customisable");
    const all = text(splashLayout(INPUT, 100, 30).rows).join("\n");
    expect(all).toContain("clear · concise · fast · customisable");
    expect(all).not.toContain("palette");
    expect(all).not.toContain("resume · find");
    // Four single words and their separators fit at 63 columns: 37 of them.
    expect(displayWidth(text(splashLayout(INPUT, 63, 12).rows).find((r) => r.includes("clear"))!)).toBe(37);
  });

  test("connecting: the harness, a spinner cell and `connecting…` on row 1, the launch directory on row 2", () => {
    const connecting: SplashInput = { ...INPUT, agent: null, model: null, cwd: null, connecting: true };
    const rows = text(splashLayout(connecting, 100, 30).rows);
    const at = rows.findIndex((r) => r.includes("connecting…"));
    expect(at).toBeGreaterThan(0);
    expect(rows[at]!.trim()).toBe("Harness: fake · ▖ connecting…");
    expect(rows[at + 1]!.trim()).toBe("/work/repo-b");
    // The spinner cell is the one marked for redraw, and `connecting…` is muted.
    const row = splashLayout(connecting, 100, 30).rows[at]!;
    expect(row.filter((seg) => seg.spinner === true).map((seg) => seg.text)).toEqual(["▖"]);
    expect(row.find((seg) => seg.text.includes("connecting…"))?.token).toBe("muted");
    // The ascii set's spinner.
    const ascii = text(splashLayout({ ...connecting, spinner: ["|", "/", "-", "\\"] }, 100, 30).rows).find((r) => r.includes("connecting…"));
    expect(ascii!.trim()).toBe("Harness: fake · | connecting…");
  });

  test("nothing moves: the layout's height and drop order are the same before and after the session starts, whatever the pane", () => {
    const before: SplashInput = { ...INPUT, agent: null, model: null, cwd: null, connecting: true };
    const identity = (r: string) => r.includes("fake") || r.includes("repo-b") || r.includes("claude-agent-acp") || r.includes("Opus");
    for (const [width, height] of [[100, 30], [63, 12], [63, 9], [63, 6], [50, 7], [61, 12]] as const) {
      const a = splashLayout(before, width, height);
      const b = splashLayout(INPUT, width, height);
      expect([width, height, a.shown, a.top, a.rows.length]).toEqual([width, height, b.shown, b.top, b.rows.length]);
      // Every row that is not an identity row is the same text.
      expect(text(a.rows).filter((r) => !identity(r))).toEqual(text(b.rows).filter((r) => !identity(r)));
    }
  });

  test("started: the agent's name and model on row 1, the session's directory on row 2; the name alone without a model; the harness without an agent name", () => {
    const rows = text(splashLayout(INPUT, 100, 30).rows).map((r) => r.trim());
    const at = rows.indexOf("Harness: claude-agent-acp · Model: Opus 5.5");
    expect(at).toBeGreaterThan(0);
    expect(rows[at + 1]).toBe("/work/repo-b");
    expect(text(splashLayout({ ...INPUT, model: null }, 100, 30).rows).map((r) => r.trim())).toContain("Harness: claude-agent-acp");
    expect(text(splashLayout({ ...INPUT, agent: null, model: null }, 100, 30).rows).map((r) => r.trim())).toContain("Harness: fake");
    // The launch's directory stands in until the session reports its own.
    expect(text(splashLayout({ ...INPUT, cwd: null }, 100, 30).rows).join("\n")).toContain("/work/repo-b");
  });

  test("Marcus's wording: `Harness: Claude · Model: Default (recommended)`, labels muted and values text; `Harness: claude · ⠋ connecting…` before", () => {
    const started: SplashInput = { ...INPUT, agent: "Claude Agent", model: "Default (recommended)" };
    const layout = splashLayout(started, 100, 30);
    const row = layout.rows.find((r) => r.map((x) => x.text).join("").includes("Harness:"))!;
    expect(row.map((x) => x.text).join("")).toBe("Harness: Claude · Model: Default (recommended)");
    expect(row.map((x) => [x.text, x.token])).toEqual([["Harness: ", "muted"], ["Claude", "text"], [" · ", "muted"], ["Model: ", "muted"], ["Default (recommended)", "text"]]);
    const before = splashLayout({ ...INPUT, agent: null, model: null, connecting: true, launch: { harness: "claude", directory: "/w" } }, 100, 30);
    const first = before.rows.find((r) => r.map((x) => x.text).join("").includes("Harness:"))!;
    expect(first.map((x) => [x.text, x.token])).toEqual([["Harness: ", "muted"], ["claude", "text"], [" · ", "muted"], ["▖", "muted"], [" connecting…", "muted"]]);
    // No model: just the harness.
    expect(text(splashLayout({ ...started, model: null }, 100, 30).rows).map((r) => r.trim())).toContain("Harness: Claude");
  });

  test("the harness name drops a trailing word `Agent` (case-insensitive, whole word), never to nothing, and falls back to the launch's", () => {
    expect(harnessName("Claude Agent", "x")).toBe("Claude");
    expect(harnessName("Codex agent", "x")).toBe("Codex");
    expect(harnessName("Agent", "x")).toBe("Agent");
    expect(harnessName("Reagent", "x")).toBe("Reagent");
    expect(harnessName("Agent Smith", "x")).toBe("Agent Smith");
    expect(harnessName("", "launch")).toBe("launch");
    expect(harnessName(null, "launch")).toBe("launch");
  });

  test("narrow: values are truncated, not labels; the model part goes when `Model: ` and one column do not fit", () => {
    for (const width of [20, 24, 30, 40]) {
      const rows = text(splashLayout({ ...INPUT, agent: "Claude Agent", model: "A very long model name indeed" }, width, 30).rows);
      const row = rows.find((r) => r.includes("Harness:"))!;
      expect(displayWidth(row)).toBeLessThanOrEqual(width);
      expect(row.trim().startsWith("Harness: ")).toBe(true);
      if (row.includes("Model")) expect(row).toContain("Model: ");
    }
    const row = text(splashLayout({ ...INPUT, agent: "Claude Agent", model: "Opus" }, 20, 30).rows).find((r) => r.includes("Harness:"))!;
    expect(row.trim()).toBe("Harness: Claude");
  });

  test("the launch: a configured name as it is, an ad hoc command by its first word without its directory", () => {
    expect(splashLaunch({ agentName: "auggie", command: "auggie", directory: "/work" })).toEqual({ harness: "auggie", directory: "/work" });
    expect(splashLaunch({ agentName: "ad hoc", command: "/usr/local/bin/bun", directory: "/work" })).toEqual({ harness: "bun", directory: "/work" });
    expect(splashLaunch({ agentName: "ad hoc", command: "bun", directory: "/work" }).harness).toBe("bun");
  });

  test("Windows: an ad hoc command is named by its file, and the profile reads `~` in the identity row", () => {
    expect(splashLaunch({ agentName: "ad hoc", command: "C:\\tools\\agent.cmd", directory: "C:\\Users\\u\\app" }, "win32").harness).toBe("agent.cmd");
    const layout = splashLayout({ ...INPUT, cwd: "C:\\Users\\u\\src\\app", home: "c:\\users\\U", platform: "win32" }, 63, 12);
    expect(text(layout.rows).join("\n")).toContain("~\\src\\app");
  });

  test("a long agent name is cut to the width; home is shown as ~", () => {
    const layout = splashLayout({ ...INPUT, agent: "x".repeat(200), cwd: "/home/marcus/Projects/acp-tui" }, 63, 12);
    for (const row of text(layout.rows)) expect(displayWidth(row)).toBeLessThanOrEqual(63);
    expect(text(layout.rows).join("\n")).toContain("~/Projects/acp-tui");
  });

  test("glyph set: the wordmark's rows are one width, from box-drawing characters and no block elements, none of the permission card's; the ascii set has its own", () => {
    for (const glyphs of [DEFAULT_CHROME_GLYPHS, ASCII_CHROME_GLYPHS]) {
      const widths = glyphs.splash.wordmark.map((r) => displayWidth(r));
      expect(new Set(widths).size).toBe(1);
    }
    for (const ch of DEFAULT_CHROME_GLYPHS.splash.wordmark.join("")) {
      const code = ch.codePointAt(0)!;
      expect(code >= 0x2580 && code <= 0x259f).toBe(false);
    }
    const splash = JSON.stringify(DEFAULT_CHROME_GLYPHS.splash);
    for (const glyph of Object.values(PERMISSION_GLYPHS)) expect(splash).not.toContain(glyph);
    const ascii = [...Object.values(ASCII_CHROME_GLYPHS.busy).filter((glyph) => glyph !== ""), ...ASCII_CHROME_GLYPHS.splash.wordmark, ASCII_CHROME_GLYPHS.splash.arrow, ASCII_CHROME_GLYPHS.splash.separator, ASCII_CHROME_GLYPHS.splash.more];
    for (const glyph of ascii) expect(glyph).toMatch(/^[\x20-\x7e]+$/);
  });
});
