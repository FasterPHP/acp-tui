// Task 5.4 (spec tui-theme "Safe text attributes only"): the real CLI runs each fake-agent scenario
// to its end under the PTY harness, with truecolour and the terminal's colours answered so surfaces
// are drawn, and everything it sent to the terminal is scanned for SGR sequences outside the safe
// subset: no colon-separated sub-parameters (underline styles, colon colours), no strikethrough (9),
// overline (53) and no underline colour (58). Scenario names come from the fake-agent registry, so a
// new scenario is covered without touching this file.
//
// mvp-rendering task 3.6 amends it for the strikethrough exception: every scenario runs twice, as
// PhpStorm's terminals identify themselves (`TERMINAL_EMULATOR=JetBrains-JediTerm`) and with no
// terminal identified, and neither may write SGR 9; under `TERM_PROGRAM=zed`, which draws it,
// `markdown-gallery` may set SGR 9 only on the cells of its struck text.
//
// parallel-tests task 2.2 split the file along those terminal identities so that the two halves run
// in different workers: this file has the scenarios with no terminal identified, the scanners' own
// tests, Zed and the Markdown theme-token test; safe-sgr-jediterm.test.ts has the scenarios as
// JediTerm; safe-sgr-helpers.ts has what they share.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_GLYPHS } from "../../src/conversation/glyphs.ts";
import { MessageLayout } from "../../src/conversation/markdown/layout.ts";
import { deriveSurfaces } from "../../src/theme/index.ts";
import { startPty } from "./harness.ts";
import { MARKDOWN_CHUNKS } from "./markdown-agent.ts";
import { READY } from "./regions.ts";
import {
  CLI,
  ROOT,
  ROWS,
  RUN_LIMIT_MS,
  SCENARIOS,
  disposeSession,
  findUnsafeSgr,
  printedColours,
  runScenario,
  struckRuns,
  track,
  unsafeSgr,
} from "./safe-sgr-helpers.ts";
import { WINDOWS } from "../windows.ts";

afterEach(disposeSession);

describe("the SGR scanner", () => {
  test("flags colons and parameters 9, 53 and 58, and not colour arguments", () => {
    expect(unsafeSgr("4:3")).toHaveLength(1);
    expect(unsafeSgr("38:2::1:2:3")).toHaveLength(1);
    expect(unsafeSgr("9")).toHaveLength(1);
    expect(unsafeSgr("1;53")).toHaveLength(1);
    expect(unsafeSgr("58;5;1")).toHaveLength(1);
    expect(unsafeSgr("38;5;9")).toEqual([]);
    expect(unsafeSgr("48;2;9;53;58")).toEqual([]);
    expect(unsafeSgr("0;1;2;3;4;7;22;23;24;27;39;49;90;107")).toEqual([]);
    expect(findUnsafeSgr("\x1b[>4;0m\x1b[1mx\x1b[9mx")).toEqual(["parameter 9 in ESC[9m"]);
  });
});

describe("Output stream over every scenario", () => {
  for (const terminal of ["unknown"] as const) {
    for (const name of Object.keys(SCENARIOS)) {
      test(`${name} (${terminal} terminal): no SGR with a colon, none with parameter 9, 53 or 58`, async () => {
        const raw = await runScenario(name, terminal, ROWS[name]);
        // The run reached the alternate screen and drew truecolour surfaces, so the scan means something.
        expect(raw).toContain("\x1b[?1049h");
        expect(raw).toMatch(/\x1b\[[0-9;]*48;2;/);
        expect(findUnsafeSgr(raw)).toEqual([]);
      }, RUN_LIMIT_MS + 15000);
    }
  }
});

describe("the struck-run scanner", () => {
  test("collects what SGR 9 covers, through 29, 0 and colour arguments", () => {
    const raw = "a\x1b[1;9mstruck one\x1b[0m b \x1b[9;38;2;9;9;9mtwo\x1b[29mc\x1b[38;5;9md\x1b[9mx\x1b[m y";
    expect(struckRuns(raw)).toEqual(["struckone", "two", "x"]);
  });
});

// Spec tui-theme "Safe text attributes only", scenario "Strikethrough where it is drawn".
describe("Strikethrough where it is drawn", () => {
  test("markdown-gallery under TERM_PROGRAM=zed sets SGR 9 only on its struck text, and nothing unsafe otherwise", async () => {
    // Tall enough to draw the whole gallery (about 360 rows at this width), so every struck cell is
    // drawn at least once.
    const raw = await runScenario("markdown-gallery", "zed", ROWS["markdown-gallery"]);
    expect(raw).toContain("\x1b[?1049h");
    // Apart from SGR 9, which is checked against the struck text below, nothing unsafe.
    expect(findUnsafeSgr(raw).filter((bad) => !/^parameter 9 /.test(bad))).toEqual([]);
    // The struck text as the renderers give it: each run of struck spans on a row, spaces left out.
    const gallery = (await Bun.file(join(ROOT, "packages/fake-agent/src/scenarios/markdown-gallery.md")).text());
    const expected: string[] = [];
    for (const block of new MessageLayout(gallery, 100 - DEFAULT_GLYPHS.gutterWidth, DEFAULT_GLYPHS).blocks()) {
      for (const row of block.rows) {
        let run = "";
        for (const span of row.spans) {
          if (span.strike) run += span.text.replace(/\s+/g, "");
          else if (run !== "") {
            expected.push(run);
            run = "";
          }
        }
        if (run !== "") expected.push(run);
      }
    }
    // `~~double tilde~~`, `**~~bold and struck~~**`, `~~struck with `code`~~` (M02), `<del>del tag</del>` (M09), the table's `~~struck~~` (M19).
    expect(expected).toEqual(["doubletilde", "boldandstruck", "struckwithcode", "deltag", "struck"]);
    const runs = struckRuns(raw.slice(raw.indexOf("\x1b[?1049h")));
    // Every cell written with SGR 9 is struck text (OpenTUI may redraw part of a run).
    const outside = runs.filter((run) => !expected.some((text) => text.includes(run)));
    expect(outside).toEqual([]);
    // And every piece of struck text was written with it.
    for (const text of expected) expect(runs.some((run) => run.includes(text))).toBe(true);
  }, RUN_LIMIT_MS + 15000);
});

describe("the printed-colour scanner", () => {
  test("tracks foreground and background through SGR, ignoring spaces and private CSI m", () => {
    const raw = "\x1b[>4;1ma\x1b[38;2;255;255;255m \x1b[48;5;4mb\x1b[39;41mc\x1b[0md\x1b[94;48;2;1;2;3me";
    expect(printedColours(raw)).toEqual([
      { ch: "a", fg: "default", bg: "default" },
      { ch: "b", fg: "rgb 255;255;255", bg: "palette 4" },
      { ch: "c", fg: "default", bg: "palette 1" },
      { ch: "d", fg: "default", bg: "default" },
      { ch: "e", fg: "palette 12", bg: "rgb 1;2;3" },
    ]);
  });
});

// S1 bug 4 (phase-1a, spec tui-theme "Text follows the terminal's palette"): agent Markdown
// whose message starts with a list was drawn in explicit white (`38;2;255;255;255`), invisible on
// a light theme, because `content` reached OpenTUI's MarkdownRenderable before its style.
// Skipped on Windows: it scans the raw SGR bytes of the PTY stream, which ConPTY rewrites, or expects truecolour from a bare ConPTY.
describe.skipIf(WINDOWS)("Agent Markdown uses theme tokens only", () => {
  const LIGHT = { foreground: "#383a42", background: "#fafafa" };
  const AGENT = join(import.meta.dir, "markdown-agent.ts");

  test("a list, headings, emphasis, code, a link and a quote print no RGB foreground and only derived RGB fills", async () => {
    const cwd = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-markdown-"));
    const s = startPty(["bun", CLI, "--", "bun", AGENT], { cols: 100, rows: 50, cwd, colours: LIGHT, env: { COLORTERM: "truecolor" } });
    track(s);
    await s.waitFor(READY, 10000);
    s.sendKeys({ text: "go" }, "Enter");
    await s.waitFor("Closing", 10000);
    await s.waitFor(READY, 5000);
    // Tree-sitter highlighting lands asynchronously after the last chunk.
    await Bun.sleep(600);
    await s.flush();
    const raw = s.rawOutput();
    expect(raw).toMatch(/\x1b\[[0-9;]*48;2;/);
    expect(MARKDOWN_CHUNKS.join("")).toStartWith("- first item");
    const printed = printedColours(raw.slice(raw.indexOf("\x1b[?1049h")));
    // The Markdown reached the screen.
    for (const text of ["first item", "Heading one", "link", "quoted", "nested item", "answer", "Closing"]) {
      expect(s.findLine(text)).toBeGreaterThanOrEqual(0);
    }
    const derived = new Set(Object.values(deriveSurfaces(LIGHT)).map((hex) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return `rgb ${r};${g};${b}`;
    }));
    // No RGB foreground at all: until the change opentui-0-6-6 a dim cell in a row's last column
    // was given the dimmed default foreground as an RGB colour (the row-end workaround for
    // OpenTUI #1633, removed); dim is now drawn as dim everywhere.
    const badFg = [...new Set(printed.filter((c) => c.fg.startsWith("rgb")).map((c) => `${c.fg} on "${c.ch}"`))];
    const badBg = [...new Set(printed.filter((c) => c.bg.startsWith("rgb") && !derived.has(c.bg)).map((c) => `${c.bg} under "${c.ch}"`))];
    expect(badFg).toEqual([]);
    expect(badBg).toEqual([]);
    // In particular, the text of the list items is not forced white.
    const y = s.findLine("first item");
    const x = s.lineText(y).indexOf("first item");
    expect(s.cell(y, x)!.isFgRGB()).toBe(false);
    // The code block's language label (`muted`, the default foreground dimmed on a light
    // background) is drawn with SGR 2 in the default foreground, its last letter too (tui-theme
    // "Text attributes end with their cells", scenario "Dim in the last column"). Since the scroll
    // bar's column and the two-column right margin, the label no longer reaches the screen's last
    // column; the last column itself is checked in the renderer's bytes,
    // test/renderer/row-end-reset.test.ts.
    const labelRow = s.findLine("const answer") - 1;
    const labelAt = s.lineText(labelRow).lastIndexOf("ts");
    expect(labelAt).toBeGreaterThan(0);
    for (const at of [labelAt, labelAt + 1]) {
      const cell = s.cell(labelRow, at)!;
      expect(cell.isDim()).not.toBe(0);
      expect(cell.isFgDefault()).toBe(true);
    }
  }, 30000);
});
