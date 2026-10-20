// mvp-configuration tasks 7.2 and 7.3 under the PTY harness: a glyph set chosen in the
// configuration is the one drawn (spec tui-config "Glyph sets": "ASCII set"), a reload redraws
// with the new glyphs, and `acp-tui glyphs --test` prints every set on the main screen (spec
// "Glyph test": "All sets").
//
// The timing tests of this file are in glyphs.pty.timing.test.ts (parallel-tests: they run in the serial pass).
import { afterEach, describe, expect, test } from "bun:test";
import { GLYPH_NAMES, GLYPH_SET_NAMES, GLYPH_SETS } from "../../src/conversation/glyphs.ts";
import { sendPrompt } from "../conversation/cli.ts";
import { READY, REQUIRES_ACTION, statusRow } from "../pty/regions.ts";
import { configHome, run, CONVERSATION_GLYPHS, runGlyphs, disposeSessions } from "./glyphs-pty-helpers.ts";
import { WINDOWS } from "../windows.ts";

afterEach(disposeSessions);

describe("ASCII set (task 7.2)", () => {
  test("a nested list and a task list: every bullet and task box is ASCII, none of the unicode set's bullets is drawn", async () => {
    const cfg = configHome(`{ "glyphs": "ascii" }`);
    const r = run({ scenario: "markdown-gallery", cols: 100, rows: 600, env: { XDG_CONFIG_HOME: cfg.home } });
    const s = r.session;
    await sendPrompt(s, "go");
    await s.waitFor((p) => p.screenText().some((l) => /^ {2}end turn\b/.test(l)) && READY.test(p.screenText().join("\n")), 120000);
    await Bun.sleep(500);
    const rows = s.screenText();
    const at = rows.findIndex((l) => l.includes("Done task"));
    expect(at).toBeGreaterThan(0);
    // The task list's boxes are ASCII, and a nested list has a bullet for each level: `*`, `o`, `+`.
    expect(rows[at]).toMatch(/^ {2}\[x\] Done task/);
    expect(rows[at + 1]).toMatch(/^ {2}\[ \] Open task/);
    expect(rows.some((l) => /\[x\] Nested done/.test(l))).toBe(true);
    expect(rows.some((l) => /^ {2}\* \S/.test(l))).toBe(true);
    expect(rows.some((l) => /^ {4}o \S/.test(l))).toBe(true);
    expect(rows.some((l) => /^ {6}\+ \S/.test(l))).toBe(true);
    // No glyph of the unicode set's Markdown or spinner survives anywhere on the conversation's rows.
    const conversation = rows.slice(0, rows.findIndex((l) => l.startsWith("╭")) >= 0 ? rows.findIndex((l) => l.startsWith("╭")) : rows.length);
    expect(conversation.filter((l) => CONVERSATION_GLYPHS.test(l))).toEqual([]);
    // The table's borders are plus, dash and bar.
    expect(rows.some((l) => /^ {2}\+-+\+-+/.test(l))).toBe(true);
  }, 150000);

  test("the permission card's marker, frame and the terminal title's marker are the ascii set's", async () => {
    const cfg = configHome(`{ "glyphs": "ascii" }`);
    const r = run({ scenario: "basic", cols: 80, rows: 40, env: { XDG_CONFIG_HOME: cfg.home } });
    const s = r.session;
    await sendPrompt(s, "go");
    await s.waitFor((p) => p.screenText().some((l) => l.startsWith("+- ! Permission")), 10000);
    const rows = s.screenText();
    const top = rows.findIndex((l) => l.startsWith("+- ! Permission"));
    expect(rows[top]).toMatch(/^\+- ! Permission {2}edit {2}#2 -+\+$/);
    expect(rows.slice(top + 1).some((l) => /^\+-+\+$/.test(l))).toBe(true);
    expect(rows.slice(top + 1, top + 4).every((l) => !l.startsWith("│"))).toBe(true);
    expect(rows[top + 1]).toMatch(/^\| .* \|$/);
    expect(REQUIRES_ACTION.test(statusRow(s))).toBe(true);
    // The title carries the ascii marker while the session waits.
    const titles = [...s.rawOutput().matchAll(/\x1b\]0;([^\x07\x1b]*)\x07/g)].map((m) => m[1]);
    expect(titles.at(-1)).toMatch(/^! acp-tui/);
  }, 30000);

  test("a reload redraws the conversation, history included: bullets, tool kinds and statuses change set, the reading position and the text stay", async () => {
    const cfg = configHome(`{ "density": "compact" }`);
    const r = run({ scenario: "long-session", cols: 100, rows: 40, agentArgs: ["--items", "60"], env: { XDG_CONFIG_HOME: cfg.home } });
    const s = r.session;
    await sendPrompt(s, "go");
    await s.waitFor((p) => p.screenText().some((l) => /^ {2}end turn\b/.test(l)) && READY.test(p.screenText().join("\n")), 60000);
    const glyphsOf = (rows: readonly string[]) => rows.join("\n");
    const before = s.screenText();
    expect(glyphsOf(before)).toMatch(/[→←×»✓]/);
    cfg.write(`{ "density": "compact", "glyphs": "ascii" }`);
    await s.waitFor((p) => !/[→←×»✓●○•]/.test(glyphsOf(p.screenText().slice(0, -5))), 2000);
    // The same rows of text, the glyphs apart.
    const after = s.screenText();
    expect(after.filter((l) => l.trim() !== "").length).toBe(before.filter((l) => l.trim() !== "").length);
    cfg.write(`{ "density": "compact" }`);
    await s.waitFor((p) => /[→←×»✓]/.test(glyphsOf(p.screenText())), 2000);
  }, 90000);

  test("an invalid override is reported at its place and the set's own glyph stays in use", async () => {
    const cfg = configHome(`{\n  "glyphs": {\n    "overrides": { "tool.status.ok": "✅" }\n  }\n}\n`);
    const r = run({ scenario: "basic", cols: 100, rows: 40, env: { XDG_CONFIG_HOME: cfg.home } });
    const s = r.session;
    await s.waitFor(READY, 10000);
    await s.waitFor(() => r.events("config_loaded").length === 1, 5000);
    const problems = (r.events("config_loaded")[0]?.["problems"] ?? []) as { path: string; severity: string }[];
    expect(problems).toEqual([expect.objectContaining({ path: "glyphs.overrides.tool.status.ok", severity: "warning" })]);
    await s.waitFor((p) => p.screenText().join("\n").includes("glyphs.overrides.tool.status.ok takes 2 cells"), 5000);
  }, 20000);
});

describe("All sets (task 7.3)", () => {
  // Skipped on Windows: it reads raw bytes of the PTY stream (sequences, modes or titles), which ConPTY rewrites.
  test.skipIf(WINDOWS)("glyphs --test prints every set with each glyph next to its name, on the main screen, and exits 0", async () => {
    const { code, output } = await runGlyphs(["--test"]);
    expect(code).toBe(0);
    // No alternate screen, no mouse reporting.
    expect(output).not.toContain("\x1b[?1049h");
    expect(output).not.toMatch(/\x1b\[\?100[0-6]h/);
    const plain = output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "");
    const lines = plain.split("\n");
    for (const set of GLYPH_SET_NAMES) expect(lines).toContain(set);
    // A group per row, `name glyph` pairs (the full name is the group, a dot and the name).
    for (const set of GLYPH_SET_NAMES) {
      const from = lines.indexOf(set);
      const block = lines.slice(from + 1, lines.findIndex((l, i) => i > from && l === "") === -1 ? undefined : lines.findIndex((l, i) => i > from && l === ""));
      const row = (group: string) => block.find((l) => l.trim().startsWith(`${group} `));
      expect(row("tool.kind")).toContain(`read ${GLYPH_SETS[set]["tool.kind.read"]}`);
      expect(row("list.bullet")).toContain(`1 ${GLYPH_SETS[set]["list.bullet.1"]}`);
      expect(row("permission")).toContain(`marker ${GLYPH_SETS[set]["permission.marker"]}`);
      expect(row("tool.status")).toContain(`ok ${GLYPH_SETS[set]["tool.status.ok"]}`);
    }
    // Every group of the registry is printed once per set.
    const groups = new Set(GLYPH_NAMES.map((n) => (n.includes(".") ? n.slice(0, n.lastIndexOf(".")) : n)));
    for (const group of groups) expect(lines.filter((l) => l.trim().startsWith(`${group} `) || l.trim() === group).length).toBeGreaterThanOrEqual(GLYPH_SET_NAMES.length);
  }, 30000);

  test("with a set name only that set is printed; an unknown set, no --test or a second set is an error", async () => {
    const ascii = await runGlyphs(["--test", "ascii"]);
    expect(ascii.code).toBe(0);
    const text = ascii.output.replace(/\r/g, "");
    expect(text).toContain("ascii\n");
    expect(text).not.toContain("unicode\n");
    expect(text).not.toContain("nerd-font\n");
    expect((await runGlyphs(["--test", "emoji"])).code).toBe(1);
    expect((await runGlyphs([])).code).toBe(1);
    expect((await runGlyphs(["--test", "ascii", "unicode"])).code).toBe(1);
    const unknown = await runGlyphs(["--test", "emoji"]);
    expect(unknown.output).toContain("unknown glyph set 'emoji'");
    // Nothing is launched: no alternate screen even when it fails.
    expect(unknown.output).not.toContain("\x1b[?1049h");
  }, 30000);
});
