// Shared by surfaces.test.ts and surfaces.timing.test.ts (split by the change parallel-tests, tasks 3.x). Not a test file.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deriveSurfaces, type SurfaceName, type TerminalColours } from "../../src/theme/index.ts";
import { startPty, type OscColours, type PtySession } from "./harness.ts";
import { CARD_HEADER, READY, REQUIRES_ACTION } from "./regions.ts";

export const ROOT = resolve(import.meta.dir, "../../../..");
export const CLI = join(ROOT, "packages/acp-tui/src/cli.ts");
export const FAKE_AGENT = join(ROOT, "packages/fake-agent/src/main.ts");

export const DARK = { foreground: "#bcbec4", background: "#191a1c" } satisfies OscColours;
export const LIGHT = { foreground: "#1f2328", background: "#ffffff" } satisfies OscColours;

/** Runs the CLI against the `basic` scenario, sends a prompt and waits for the permission prompt;
 *  `config`, when given, is the user's configuration file. */
export async function openPermission(colours?: OscColours, config?: string): Promise<PtySession> {
  const cwd = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-surfaces-"));
  const env: Record<string, string> = { COLORTERM: "truecolor" };
  if (config !== undefined) {
    mkdirSync(join(cwd, "xdg", "acp-tui"), { recursive: true });
    writeFileSync(join(cwd, "xdg", "acp-tui", "config.jsonc"), config);
    env["XDG_CONFIG_HOME"] = join(cwd, "xdg");
  }
  const args = [CLI, "--", "--", "bun", FAKE_AGENT, "--scenario", "basic", "--delay-scale", "0"];
  const s = startPty(["bun", ...args], { cols: 80, rows: 60, cwd, colours, env });
  session = s;
  await s.waitFor(READY, 10000);
  s.sendKeys({ text: "go" }, "Enter");
  await s.waitFor(CARD_HEADER, 5000);
  return s;
}

/** Screen rows of the docked permission card, from its header to its bottom border. */
export function cardLines(s: PtySession): number[] {
  const rows = s.screenText();
  const top = rows.findIndex((row) => row.startsWith(`╭─ ${CARD_HEADER}`));
  if (top < 0) return [];
  const bottom = rows.findIndex((row, y) => y > top && row.startsWith("╰"));
  return bottom < 0 ? [] : Array.from({ length: bottom - top + 1 }, (_, i) => top + i);
}

export type Bg = { mode: "default" } | { mode: "palette"; index: number } | { mode: "rgb"; hex: string };

export function bgAt(s: PtySession, y: number, x: number): Bg {
  const cell = s.cell(y, x)!;
  if (cell.isBgDefault()) return { mode: "default" };
  if (cell.isBgPalette()) return { mode: "palette", index: cell.getBgColor() };
  return { mode: "rgb", hex: `#${cell.getBgColor().toString(16).padStart(6, "0")}` };
}

/** Every cell of row `y`. */
export function rowBg(s: PtySession, y: number): Bg[] {
  return Array.from({ length: s.cols }, (_, x) => bgAt(s, y, x));
}

export const rgb = (hex: string): Bg => ({ mode: "rgb", hex });
export const TRUECOLOUR_BG = /\x1b\[[0-9;]*\b48;2;/;

export const same = (a: Bg, b: Bg) => JSON.stringify(a) === JSON.stringify(b);
export const surface = (colours: TerminalColours, name: SurfaceName): Bg => rgb(deriveSurfaces(colours)[name]);
export const statusRow = (s: PtySession) => s.findLine(REQUIRES_ACTION);
/** True once the status row and every permission card row carry the surfaces derived from `colours`. */
export const showing = (s: PtySession, colours: TerminalColours): boolean => {
  const status = statusRow(s);
  if (status < 0 || !rowBg(s, status).every((b) => same(b, surface(colours, "status.bg")))) return false;
  const card = cardLines(s);
  const fills = [surface(colours, "surface.permission"), surface(colours, "surface.permission.selected")];
  return card.length > 0 && card.every((y) => rowBg(s, y).every((b) => fills.some((f) => same(b, f))));
};
/** No cell anywhere still has a background derived from the old colours. */
export const noneLeft = (s: PtySession, old: TerminalColours): boolean => {
  const stale = new Set(Object.values(deriveSurfaces(old)));
  for (let y = 0; y < s.rows; y++) if (rowBg(s, y).some((b) => b.mode === "rgb" && stale.has(b.hex))) return false;
  return true;
};

let session: PtySession | undefined;

/** For each test file's `afterEach`. */
export async function disposeSession(): Promise<void> {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
}
