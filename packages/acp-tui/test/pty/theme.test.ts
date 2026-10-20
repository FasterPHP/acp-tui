// PTY tests for the theme scenarios in specs/tui-footer/spec.md (task 6.3),
// against test/pty/theme-rows.tsx, on the alternate screen since phase-1a task
// 3.5. They check what the terminal actually receives: xterm cell colour modes
// and the raw SGR stream.
import { afterEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { startPty, type PtySession } from "./harness.ts";
import { WINDOWS } from "../windows.ts";

const ROOT = resolve(import.meta.dir, "../../../..");
const SPIKE = "packages/acp-tui/test/pty/theme-rows.tsx";
const FORCED_WHITE = ["\x1b[38;2;255;255;255m", "\x1b[38;5;15m", "\x1b[97m", "\x1b[37m"];

let session: PtySession | undefined;
afterEach(async () => {
  await session?.dispose();
  session = undefined;
});

async function run(colorterm: string, overrides?: object): Promise<PtySession> {
  const args = overrides ? [JSON.stringify(overrides)] : [];
  session = startPty(["bun", SPIKE, ...args], { cols: 80, rows: 24, cwd: ROOT, env: { COLORTERM: colorterm } });
  await session.waitFor("DONE", 10000);
  await session.waitFor((s) => s.findLine("HINTS") >= 0 && s.findLine("MDITEM") >= 0);
  expect(session.term.buffer.active.type).toBe("alternate");
  return session;
}

type Fg = { mode: "default" } | { mode: "palette"; index: number } | { mode: "rgb"; value: number };

/** Foreground of each non-blank cell in the first row containing `tag`. */
function fgCells(s: PtySession, tag: string): { ch: string; fg: Fg }[] {
  const y = s.findLine(tag);
  expect(y).toBeGreaterThanOrEqual(0);
  const text = s.lineText(y);
  const out: { ch: string; fg: Fg }[] = [];
  for (let x = 0; x < text.length; x++) {
    const cell = s.cell(y, x)!;
    const ch = cell.getChars();
    if (ch === "" || ch === " ") continue;
    const fg: Fg = cell.isFgDefault()
      ? { mode: "default" }
      : cell.isFgPalette()
        ? { mode: "palette", index: cell.getFgColor() }
        : { mode: "rgb", value: cell.getFgColor() };
    out.push({ ch, fg });
  }
  return out;
}

/** The SGR sequences emitted immediately before the first occurrence of `text`: from the last
 *  attribute reset or cursor move before it (a frame moves the cursor to each row it draws). */
function sgrBefore(s: PtySession, text: string): string {
  const raw = s.rawOutput();
  const i = raw.indexOf(text);
  expect(i).toBeGreaterThan(0);
  const head = raw.slice(Math.max(0, i - 60), i);
  let from = head.lastIndexOf("\x1b[0m");
  for (const m of head.matchAll(/\x1b\[\d+;\d+H/g)) from = Math.max(from, m.index!);
  expect(from).toBeGreaterThanOrEqual(0);
  return head.slice(from);
}

async function quit(s: PtySession) {
  s.sendKeys({ text: "q" });
  expect(await s.wait()).toBe(0);
}

// With COLORTERM=truecolor OpenTUI would emit RGB for rgb-intent colours; without
// it (256-colour only) it maps them to the nearest palette index. The default
// foreground must survive both.
for (const colorterm of ["truecolor", ""]) {
  // Skipped on Windows: it reads the raw colour bytes of the PTY stream, which a bare ConPTY rewrites.
  describe.skipIf(WINDOWS)(`Default foreground is not forced to white (COLORTERM=${colorterm || "unset"})`, () => {
    test("rows styled with a default-foreground token use the terminal's own foreground", async () => {
      const s = await run(colorterm);
      for (const tag of ["TEXT", "CORE", "DONE"]) {
        const cells = fgCells(s, tag);
        expect(cells.length).toBeGreaterThan(0);
        expect(cells.every((c) => c.fg.mode === "default")).toBe(true);
        const sgr = sgrBefore(s, tag);
        expect(sgr).toContain("\x1b[39m");
        for (const white of FORCED_WHITE) expect(sgr).not.toContain(white);
      }
      // Mixed spans: body text default, accent and muted from the palette.
      const mixed = fgCells(s, "MIXED");
      expect(mixed.filter((c) => c.fg.mode === "default").map((c) => c.ch).join("")).toBe("MIXEDbodyend");
      expect(mixed.filter((c) => c.fg.mode === "palette" && c.fg.index === 4).map((c) => c.ch).join("")).toBe("accent");
      expect(mixed.filter((c) => c.fg.mode === "palette" && c.fg.index === 8).map((c) => c.ch).join("")).toBe("muted");
      await quit(s);
    }, 20000);

    test("OpenTUI's own Markdown fallback styled with markdownStyles() uses the default foreground only", async () => {
      // acp-tui draws agent prose itself (renderNode); markdownStyles() only keeps OpenTUI's
      // fallback from forcing white (#1105), so every scope falls back to `default` (the `text`
      // token): no cell is white or a colour of acp-tui's own, and the list marker is not white.
      const s = await run(colorterm);
      const summary = (tag: string) =>
        fgCells(s, tag)
          .map((c) => `${c.ch}${c.fg.mode === "default" ? "" : c.fg.mode === "palette" ? c.fg.index : "!"}`)
          .join(" ");
      expect(summary("MDPARA")).toBe("M D P A R A b o d y b o l d c o d e e n d");
      expect(fgCells(s, "MDHEAD").every((c) => c.fg.mode === "default")).toBe(true);
      expect(summary("MDITEM")).toBe("- M D I T E M i t e m");
      await quit(s);
    }, 20000);

    test("the status bar uses default foreground and background", async () => {
      const s = await run(colorterm);
      const y = s.findLine("STATUS");
      const status = fgCells(s, "STATUS");
      expect(status.filter((c) => c.fg.mode === "default").map((c) => c.ch).join("")).toBe("STATUSready");
      for (let x = 0; x < s.lineText(y).length; x++) expect(s.cell(y, x)!.isBgDefault()).toBe(true);
      await quit(s);
    }, 20000);

    test("OpenTUI #1105 canary: a renderable with no fg is still painted white", async () => {
      // If this starts failing, OpenTUI has fixed #1105; the explicit `text`
      // token remains correct either way.
      const s = await run(colorterm);
      const cells = fgCells(s, "PLAIN");
      const white: Fg = colorterm ? { mode: "rgb", value: 0xffffff } : { mode: "palette", index: 15 };
      expect(cells.every((c) => JSON.stringify(c.fg) === JSON.stringify(white))).toBe(true);
      await quit(s);
    }, 20000);
  });
}

// Skipped on Windows: it reads the raw colour bytes of the PTY stream, which a bare ConPTY rewrites.
describe.skipIf(WINDOWS)("Token styling can be swapped", () => {
  test("mapping accent to another index recolours every accent element and nothing else", async () => {
    const base = await run("truecolor");
    const snapshot = (s: PtySession) =>
      ["TEXT", "ACCENT", "MIXED", "CORE", "STATUS", "HINTS"].map((tag) => fgCells(s, tag));
    const before = snapshot(base);
    await quit(base);
    await base.dispose();

    const swapped = await run("truecolor", { accent: 5 });
    const after = snapshot(swapped);
    await quit(swapped);

    let accentCells = 0;
    before.forEach((row, r) => {
      expect(after[r]!.map((c) => c.ch)).toEqual(row.map((c) => c.ch));
      row.forEach((cell, i) => {
        const next = after[r]![i]!.fg;
        if (cell.fg.mode === "palette" && cell.fg.index === 4) {
          accentCells++;
          expect(next).toEqual({ mode: "palette", index: 5 });
        } else {
          expect(next).toEqual(cell.fg);
        }
      });
    });
    // ACCENT row, the MIXED span and the status bar's "agent" span.
    expect(accentCells).toBe("ACCENTaccenttoken".length + "accent".length + "agent".length);
  }, 30000);
});
