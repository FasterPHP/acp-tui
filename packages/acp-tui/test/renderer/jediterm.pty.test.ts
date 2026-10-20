// S1 bugs 1 to 3 of phase-1a (docs/phase-1a-spike-report.md), under the harness's JediTerm
// emulation (test/pty/jediterm.ts: PhpStorm's environment, `CSI s` and `CSI u` ignored, APC
// printed as text). The real acp-tui CLI against fake-agent:
//
// - bug 1 (spec tui-screen "Exit text below the command line", design D3): on Ctrl+D and
//   SIGTERM the command line is intact and the cursor is on the next row;
// - bug 2: OpenTUI's kitty graphics query never reaches the main screen as text;
// - bug 3 (spec tui-theme, design D8): with OSC 10 and 11 answered the surfaces are truecolour
//   (`48;2;`) and the selected permission option differs from the card's fill; and a terminal
//   that is not known to draw truecolour gets the flat theme, where the selection is inverse video.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deriveSurfaces, lightness, parseHex } from "../../src/theme/index.ts";
import { startPty, type PtySession, type PtyStartOptions } from "../pty/harness.ts";
import { CARD_HEADER, READY, REQUIRES_ACTION } from "../pty/regions.ts";

const ROOT = resolve(import.meta.dir, "../../../..");
const CLI = join(ROOT, "packages/acp-tui/src/cli.ts");
const FAKE_AGENT = join(ROOT, "packages/fake-agent/src/main.ts");
/** The main screen before start: earlier output, then the command line (rows 0 to 2). */
const PREFILL = "BEFORE-ACP-TUI\r\n\x1b[32mgreen line\x1b[0m\r\n$ acp-tui\r\n";
const BELOW = 3;
/** PhpStorm's dark theme, as its terminals answer OSC 10 and 11. */
const DARK = { foreground: "#bcbec4", background: "#1e1f22" };
/** The kitty graphics query's payload, which JediTerm printed at start-up. */
const GRAPHICS_QUERY = /Gi=31337|f=24;AAAA/;

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

function start(opts: PtyStartOptions = {}): { s: PtySession; dir: string } {
  const dir = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-jediterm-")));
  const agent = ["bun", FAKE_AGENT, "--scenario", "basic", "--delay-scale", "0"];
  const s = startPty(["bun", CLI, "--", ...agent], { cols: 100, rows: 30, cwd: dir, terminal: "jediterm", prefill: PREFILL, ...opts });
  session = s;
  return { s, dir };
}

async function ready(s: PtySession): Promise<void> {
  await s.waitFor(READY, 10000);
  await Bun.sleep(100);
  await s.flush();
  expect(s.term.buffer.active.type).toBe("alternate");
}

describe("JediTerm emulation: exit text below the command line (bug 1) and no start-up junk (bug 2)", () => {
  const paths: [string, (s: PtySession) => Promise<void>, number][] = [
    ["Ctrl+D", async (s) => s.sendKeys("Ctrl+D"), 0],
    ["SIGTERM", async (s) => s.kill("SIGTERM"), 143],
  ];
  for (const [name, leave, code] of paths) {
    test(`${name}: the command line intact, the cursor on the next row, no graphics query text`, async () => {
      const { s } = start();
      await ready(s);
      // Nothing was printed on the main screen at start-up.
      expect(s.mainSnapshot().lines).toEqual((await s.mainBefore()).lines);
      await leave(s);
      expect(await s.wait(10000)).toBe(code);
      expect(s.term.buffer.active.type).toBe("normal");
      const before = (await s.mainBefore()).lines;
      const after = s.mainSnapshot().lines;
      expect(after.slice(0, BELOW)).toEqual(before.slice(0, BELOW));
      // No exit text for a session that cannot be resumed (mvp-sessions design decision 12): the
      // cursor at the start of the row below the command line.
      expect(after.slice(BELOW).filter((l) => l !== "")).toEqual([]);
      expect(s.mainSnapshot().cursor).toEqual({ x: 0, y: BELOW });
      expect(after.join("\n")).not.toMatch(GRAPHICS_QUERY);
      // Nothing moved the cursor home on the main screen before the alternate screen was entered.
      const raw = s.rawOutput();
      expect(raw.slice(0, raw.indexOf("\x1b[?1049h"))).not.toContain("\x1b[H");
      expect(raw).not.toContain("\x1b_G");
    }, 30000);
  }
});

type Bg = string;

/** A background from the 256-colour grey ramp (232 to 255), where OpenTUI put derived surfaces. */
const GREY_256 = /\x1b\[[0-9;]*48;5;(23[2-9]|24[0-9]|25[0-5])m/;

/** The background of a cell: `default`, `palette N` or `#rrggbb`. */
function bgAt(s: PtySession, y: number, x: number): Bg {
  const cell = s.cell(y, x)!;
  if (cell.isBgDefault()) return "default";
  if (cell.isBgPalette()) return `palette ${cell.getBgColor()}`;
  return `#${cell.getBgColor().toString(16).padStart(6, "0")}`;
}

/** The absolute row and the start column of `text` on the docked card. */
function onCard(s: PtySession, text: string): { y: number; x: number } {
  const base = s.term.buffer.active.baseY;
  const rows = s.screenText();
  const top = rows.findIndex((r) => r.startsWith(`╭─ ${CARD_HEADER}`));
  expect(top).toBeGreaterThanOrEqual(0);
  for (let y = top; y < rows.length; y++) {
    const x = rows[y]!.indexOf(text);
    if (x >= 0) return { y: base + y, x };
  }
  throw new Error(`"${text}" not on the card:\n${rows.join("\n")}`);
}

async function openPermission(s: PtySession): Promise<void> {
  await ready(s);
  s.sendKeys({ text: "go" }, "Enter");
  await s.waitFor(REQUIRES_ACTION, 10000);
  await s.waitFor(CARD_HEADER, 5000);
  // Past the card's typing-ahead guard, then select the second option.
  await Bun.sleep(700);
  s.sendKeys("2");
  await Bun.sleep(200);
  await s.flush();
}

describe("JediTerm emulation: truecolour surfaces (bug 3)", () => {
  test("OSC 10 and 11 answered: truecolour fills, and the selected option differs from the card", async () => {
    const { s } = start({ colours: DARK });
    await openPermission(s);
    const raw = s.rawOutput();
    expect(raw).toMatch(/\x1b\[[0-9;]*48;2;/);
    const surfaces = deriveSurfaces(DARK);
    const selected = onCard(s, "2 allow always");
    const other = onCard(s, "3 reject once");
    const cardFill = bgAt(s, other.y, other.x);
    expect(cardFill).toBe(surfaces["surface.permission"]);
    expect(bgAt(s, selected.y, selected.x)).toBe(surfaces["surface.permission.selected"]);
    // Clearly lighter than the card (S1 re-check: it came out darker): CIE L* difference of at least 5.
    for (let x = selected.x; x < selected.x + "2 allow always".length; x++) {
      const hex = bgAt(s, selected.y, x);
      expect(lightness(parseHex(hex)) - lightness(parseHex(cardFill))).toBeGreaterThanOrEqual(5);
    }
    expect(bgAt(s, selected.y, selected.x)).not.toBe(cardFill);
    // The option selected before (the first) is back on the card's fill.
    const first = onCard(s, "1 allow once");
    expect(bgAt(s, first.y, first.x + 2)).toBe(cardFill);
    // No derived surface fell back to a 256-colour index.
    expect(raw).not.toMatch(GREY_256);
  }, 30000);

  test("a terminal not known to draw truecolour: the flat theme, the selection in inverse video", async () => {
    // Plain xterm environment without COLORTERM (and not JediTerm or Zed).
    const { s } = start({
      colours: DARK,
      terminal: "xterm",
      env: { COLORTERM: undefined, TERMINAL_EMULATOR: undefined, TERM_PROGRAM: undefined },
    });
    await openPermission(s);
    const raw = s.rawOutput();
    // No derived fill at all, neither truecolour nor its 256-colour approximation.
    expect(raw).not.toMatch(/\x1b\[[0-9;]*48;2;/);
    expect(raw).not.toMatch(GREY_256);
    const selected = onCard(s, "2 allow always");
    for (let x = selected.x; x < selected.x + "2 allow always".length; x++) expect(s.cell(selected.y, x)!.isInverse()).toBeTruthy();
    for (const label of ["1 allow once", "3 reject once"]) {
      const other = onCard(s, label);
      expect(s.cell(other.y, other.x + 2)!.isInverse()).toBeFalsy();
    }
  }, 30000);
});
