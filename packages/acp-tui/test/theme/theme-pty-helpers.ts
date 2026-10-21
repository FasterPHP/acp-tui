// Shared by theme.pty.test.ts and theme.pty.timing.test.ts (split by the change parallel-tests, tasks 3.x). Not a test file.
import { mkdirSync, mkdtempSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type TerminalColours } from "../../src/theme/index.ts";
import { startPty, type OscColours, type PtySession } from "../pty/harness.ts";
import { CARD_HEADER, READY } from "../pty/regions.ts";

export const ROOT = resolve(import.meta.dir, "../../../..");
export const CLI = join(ROOT, "packages/acp-tui/src/cli.ts");
export const FAKE_AGENT = join(ROOT, "packages/fake-agent/src/main.ts");
export const DARK = { foreground: "#bcbec4", background: "#191a1c" } satisfies OscColours & TerminalColours;
export const ONE_LIGHT = { foreground: "#2a2c33", background: "#fafafa" } satisfies OscColours & TerminalColours;
export const TRUECOLOUR_BG = /\x1b\[[0-9;]*\b48;2;/;

export const temp = (prefix: string) => realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), prefix)));

/** A configuration home; files are saved as an editor does, by renaming a temporary file. */
export function configHome() {
  const home = temp("acp-tui-theme-");
  const dir = join(home, "acp-tui");
  mkdirSync(join(dir, "themes"), { recursive: true });
  const save = (file: string, text: string) => {
    const tmp = `${file}.${Date.now()}.tmp`;
    writeFileSync(tmp, text);
    renameSync(tmp, file);
  };
  return {
    home,
    config: (text: string) => save(join(dir, "config.jsonc"), text),
    theme: (name: string, text: string) => save(join(dir, "themes", `${name}.jsonc`), text),
  };
}

export function start(home: string, colours: OscColours, scenario = "basic", delayScale = "0"): PtySession {
  const cwd = temp("acp-tui-theme-session-");
  const s = startPty(["bun", CLI, "--", "--", "bun", FAKE_AGENT, "--scenario", scenario, "--delay-scale", delayScale], {
    cols: 80,
    rows: 40,
    cwd,
    colours,
    env: { XDG_CONFIG_HOME: home, COLORTERM: "truecolor" },
  });
  session = s;
  return s;
}

export type Bg = "default" | string;
export function bgAt(s: PtySession, y: number, x: number): Bg {
  const cell = s.cell(s.term.buffer.active.viewportY + y, x)!;
  if (cell.isBgDefault()) return "default";
  if (cell.isBgPalette()) return `palette ${cell.getBgColor()}`;
  return `#${cell.getBgColor().toString(16).padStart(6, "0")}`;
}
export const rowBgs = (s: PtySession, y: number) => Array.from({ length: s.cols }, (_, x) => bgAt(s, y, x));
export const rgbCells = (s: PtySession) => {
  let n = 0;
  for (let y = 0; y < s.rows; y++) for (let x = 0; x < s.cols; x++) if (bgAt(s, y, x).startsWith("#")) n++;
  return n;
};
/** The docked card's rows, from its header to its bottom border. */
export function cardRows(s: PtySession): number[] {
  const rows = s.screenText();
  const top = rows.findIndex((row) => row.startsWith(`╭─ ${CARD_HEADER}`));
  if (top < 0) return [];
  const bottom = rows.findIndex((row, y) => y > top && row.startsWith("╰"));
  return bottom < 0 ? [] : Array.from({ length: bottom - top + 1 }, (_, i) => top + i);
}

export async function openPermission(s: PtySession) {
  await s.waitFor(READY, 10000);
  s.sendKeys({ text: "go" }, "Enter");
  await s.waitFor(CARD_HEADER, 5000);
  await s.waitFor(() => cardRows(s).length >= 2, 5000);
}

let session: PtySession | undefined;

/** For each test file's `afterEach`. */
export async function disposeSession(): Promise<void> {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
}
