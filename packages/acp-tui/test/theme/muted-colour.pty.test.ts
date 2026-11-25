// Muted text as a colour (prompt-box-feedback task 8b; spec tui-theme "Dimmed default foreground
// drawn as a colour", "Mixed colour follows the terminal's colours"), under the real CLI: the
// session list's muted detail column (harness, age, directory) read cell by cell from the emulator.
import { afterEach, describe, expect, test } from "bun:test";
import type { OscColours, PtySession } from "../pty/harness.ts";
import { listWorld, type ListWorld } from "../session/list-world.ts";
import { indexSessions, listOpen } from "../session/session-list-startup-helpers.ts";
import { WINDOWS } from "../windows.ts";

let session: PtySession | null = null;
afterEach(async () => {
  session?.kill("SIGKILL");
  await session?.dispose();
  session = null;
});

const FOOT_LIGHT: OscColours = { foreground: "#212121", background: "#fafafa", terminator: "bel" };
const NIGHT: OscColours = { foreground: "#c0caf5", background: "#1a1b26", terminator: "bel" };

interface Cell {
  chars: string;
  rgb: boolean;
  fg: string;
  paletteIndex: number | null;
  dim: boolean;
}

/** The cells of the first row of the list that holds `text`, from the column where `text` starts to the row's end. */
function cellsFrom(s: PtySession, rowText: string, text: string): Cell[] {
  const rows = s.screenText();
  const y = rows.findIndex((r) => r.includes(rowText) && r.includes(text));
  if (y < 0) throw new Error(`no row with ${rowText} and ${text}:\n${rows.join("\n")}`);
  const abs = s.scrollbackText().length - rows.length + y;
  const out: Cell[] = [];
  for (let x = rows[y]!.indexOf(text); x < text.length + rows[y]!.indexOf(text); x++) {
    const c = s.cell(abs, x)!;
    out.push({ chars: c.getChars(), rgb: c.isFgRGB(), fg: c.getFgColor().toString(16).padStart(6, "0"), paletteIndex: c.isFgPalette() ? c.getFgColor() : null, dim: c.isDim() !== 0 });
  }
  return out;
}

function start(w: ListWorld, colours: OscColours | undefined, extra: Record<string, unknown> = {}): PtySession {
  const repo = w.dir("repo");
  indexSessions(w, repo, 2);
  w.configure({ fake: ["--scenario", "basic", "--load", "--list"] }, extra);
  return (session = w.start(["-a", "fake", "--resume"], { cwd: repo, ...(colours ? { colours } : {}) }));
}

const listed = (p: PtySession) => listOpen(p) && p.screenText().some((r) => r.includes("Session 00") && r.includes("minute"));

// Skipped on Windows: ConPTY answers or swallows the terminal's colour queries itself.
describe.skipIf(WINDOWS)("Muted text drawn as a colour", () => {
  test("Foot with a light theme: the detail column is #8e8e8e with no SGR 2, the title keeps the default foreground", async () => {
    const s = start(listWorld(), FOOT_LIGHT);
    await s.waitFor(listed, 15000);
    const detail = cellsFrom(s, "Session 00", "fake  1 minute");
    for (const c of detail.filter((c) => c.chars.trim())) {
      expect(c.rgb).toBe(true);
      expect(c.fg).toBe("8e8e8e");
      expect(c.dim).toBe(false);
    }
    expect(cellsFrom(s, "Session 00", "Session 00").every((c) => !c.rgb && !c.dim)).toBe(true);
    expect(s.rawOutput()).not.toMatch(/\x1b\[[0-9;]*\b2m/); // no SGR 2 anywhere in the run so far
  }, 30000);

  // With no replies the theme is the dark one (bright black, a palette colour), so there is nothing
  // dimmed to mix; the SGR 2 case (a light terminal that cannot draw 24-bit colour) is in
  // test/theme/muted-mix.test.ts.
  test("Colours not reported: muted text is bright black with no RGB foreground and no SGR 2", async () => {
    const s = start(listWorld(), undefined);
    await s.waitFor(listed, 15000);
    const detail = cellsFrom(s, "Session 00", "fake  1 minute").filter((c) => c.chars.trim());
    expect(detail.length).toBeGreaterThan(0);
    for (const c of detail) {
      expect(c.paletteIndex).toBe(8);
      expect(c.dim).toBe(false);
    }
    expect(s.rawOutput()).not.toContain("38;2;142");
  }, 30000);

  test("Theme's own muted colour: drawn in ANSI colour 8 on a light background, with no mixed colour", async () => {
    const s = start(listWorld(), FOOT_LIGHT, { theme: { tokens: { muted: { color: 8 } } } });
    await s.waitFor(listed, 15000);
    const detail = cellsFrom(s, "Session 00", "fake  1 minute").filter((c) => c.chars.trim());
    expect(detail.length).toBeGreaterThan(0);
    for (const c of detail) {
      expect(c.paletteIndex).toBe(8);
      expect(c.rgb).toBe(false);
    }
  }, 30000);

  test("Switched to a dark theme: after Ctrl+L the muted text is bright black again and no mixed colour is written after the refresh", async () => {
    const s = start(listWorld(), FOOT_LIGHT);
    await s.waitFor(listed, 15000);
    expect(cellsFrom(s, "Session 00", "fake  1 minute").find((c) => c.chars === "f")!.fg).toBe("8e8e8e");
    s.setColours(NIGHT);
    s.sendKeys("Ctrl+L");
    await s.waitFor((p) => {
      const c = cellsFrom(p, "Session 00", "fake  1 minute").find((c) => c.chars === "f")!;
      return c.paletteIndex === 8;
    }, 10000);
    // The first repaint of Ctrl+L may still carry the old mix (the replies come after it); once
    // the refresh has drawn bright black, the mixed colour is never written again.
    const raw = s.rawOutput();
    const refreshed = raw.indexOf("\x1b[38;5;8m", raw.lastIndexOf("38;2;142;142;142"));
    expect(refreshed).toBeGreaterThan(0);
    await Bun.sleep(300);
    s.sendKeys("Ctrl+L");
    await s.waitFor(() => s.rawOutput().length > raw.length, 5000);
    expect(s.rawOutput().slice(raw.length)).not.toContain("38;2;142;142;142");
  }, 40000);
});
