// PTY regression test for the idle permission-card band (phase-1a S2, IDE session A2): with no
// permission request open the docked card region takes no rows and paints nothing, so no cell
// above the prompt box (the conversation's last rows and the prompt box's top border) has the
// `surface.permission` background. Run with truecolour and OSC 10 and 11 answered, so the surfaces
// are derived (the flat theme has no fills and would hide the bug).
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deriveSurfaces, parseHex } from "../../src/theme/index.ts";
import { startPty, type OscColours, type PtySession } from "../pty/harness.ts";
import { CARD_HEADER, READY } from "../pty/regions.ts";
import { WINDOWS } from "../windows.ts";

const ROOT = resolve(import.meta.dir, "../../../..");
const CLI = join(ROOT, "packages/acp-tui/src/cli.ts");
const FAKE_AGENT = join(ROOT, "packages/fake-agent/src/main.ts");
const DARK = { foreground: "#bcbec4", background: "#191a1c" } satisfies OscColours;

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

function start(appArgs: readonly string[]): PtySession {
  const cwd = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-idle-band-"));
  const args = [CLI, ...appArgs, "--", "bun", FAKE_AGENT, "--scenario", "basic", "--delay-scale", "0"];
  const s = startPty(["bun", ...args], { cols: 80, rows: 30, cwd, colours: DARK, env: { COLORTERM: "truecolor" } });
  session = s;
  return s;
}

/** Screen rows holding a cell on the `surface.permission` fill (RGB 57,54,48 for this palette). */
function permissionFillRows(s: PtySession): number[] {
  const [r, g, b] = parseHex(deriveSurfaces(DARK)["surface.permission"]);
  const want = (r << 16) | (g << 8) | b;
  const rows: number[] = [];
  for (let y = 0; y < s.rows; y++) {
    for (let x = 0; x < s.cols; x++) {
      const cell = s.cell(y, x)!;
      if (!cell.isBgDefault() && !cell.isBgPalette() && cell.getBgColor() === want) {
        rows.push(y);
        break;
      }
    }
  }
  return rows;
}

/** The prompt box's top border row: the first row starting with `╭`. */
const promptTop = (s: PtySession): number => s.findLine(/^╭/);

// The variant under the retired `chrome` spike name is gone (mvp-chrome-and-keys task 7.5): the palette and cards always run.
for (const [name, appArgs] of [["plain shell", []]] as const) {
  // Skipped on Windows: it needs the terminal's OSC 10/11 colour replies (derived surfaces, light theme), which ConPTY never passes on (it passes only OSC 4).
  describe.skipIf(WINDOWS)(`idle, no card open (${name})`, () => {
    test("no cell above the prompt box, nor its top border, is on surface.permission", async () => {
      const s = start(appArgs);
      await s.waitFor(READY, 10000);
      await s.flush();
      expect(s.rawOutput()).toMatch(/\x1b\[[0-9;]*\b48;2;/); // truecolour surfaces are in use
      const top = promptTop(s);
      expect(top).toBeGreaterThan(0);
      expect(permissionFillRows(s).filter((y) => y <= top)).toEqual([]);
    }, 30000);

    test("after a permission card is answered and closes, the band does not remain", async () => {
      const s = start(appArgs);
      await s.waitFor(READY, 10000);
      s.sendKeys({ text: "go" }, "Enter");
      await s.waitFor(CARD_HEADER, 5000);
      expect(permissionFillRows(s).length).toBeGreaterThan(0); // an open card does carry the fill
      await Bun.sleep(700); // past the typing-ahead guard
      s.sendKeys("Enter");
      await s.waitFor((p) => p.findLine(CARD_HEADER) < 0, 5000);
      // The turn's end (its answer's heading may be above the view: the answer's code block has
      // padding rows since day-one-feedback task group 13).
      await s.waitFor("end turn", 5000);
      await s.flush();
      const top = promptTop(s);
      expect(top).toBeGreaterThan(0);
      expect(permissionFillRows(s).filter((y) => y <= top)).toEqual([]);
    }, 30000);
  });
}
