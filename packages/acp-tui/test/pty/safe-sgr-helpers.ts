// Shared by safe-sgr.test.ts and safe-sgr-jediterm.test.ts (split by the change parallel-tests, task
// 2.2, so that the longest file of the suite runs as two): the SGR scanners, the scenario runner and
// the terminal identities. Not a test file.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startPty, type PtySession } from "./harness.ts";
import { CARD_HEADER } from "./regions.ts";

/** The docked card, not agent text that imitates it (hostile): the docked card starts at column 0. */
const cardDocked = (rows: readonly string[]) => rows.some((row) => row.startsWith(`╭─ ${CARD_HEADER}`));

export const ROOT = resolve(import.meta.dir, "../../../..");
export const CLI = join(ROOT, "packages/acp-tui/src/cli.ts");
const FAKE_AGENT = join(ROOT, "packages/fake-agent/src/main.ts");
// The registry is imported by a computed path: acp-tui does not depend on the fake-agent package.
export const { SCENARIOS } = (await import(join(ROOT, "packages/fake-agent/src/scenarios/index.ts"))) as {
  SCENARIOS: Record<string, unknown>;
};

/** Scenarios that are slow or heavy at full speed get a scale; everything else runs flat out. */
const DELAY_SCALE: Record<string, number> = { "stream-long": 0.05 };
/** Scenarios drawn on a taller screen, so that all of their text reaches it (the gallery's struck
 *  text is far above its end); everything else gets 40 rows. */
export const ROWS: Record<string, number> = { "markdown-gallery": 450 };
/** Longest a scenario may take, prompt to quiet. */
export const RUN_LIMIT_MS = 30000;
/** No new output for this long after the prompt means the scenario has ended. */
const QUIET_MS = 800;

let session: PtySession | undefined;
/** Remembers the session the running test uses, for `disposeSession` to end. */
export function track(s: PtySession): PtySession {
  session = s;
  return s;
}
/** Each test file's `afterEach`. */
export async function disposeSession(): Promise<void> {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
}

/** SGR parameters that are unsafe in `sequence` (the text between `CSI` and `m`), or an empty list. */
export function unsafeSgr(sequence: string): string[] {
  if (sequence.includes(":")) return [`colon in ESC[${sequence}m`];
  const params = sequence === "" ? [0] : sequence.split(";").map((p) => (p === "" ? 0 : Number(p)));
  const bad: string[] = [];
  for (let i = 0; i < params.length; i++) {
    const p = params[i]!;
    // Extended colours consume their arguments, which may legitimately be 9, 53 or 58.
    if (p === 38 || p === 48) {
      i += params[i + 1] === 5 ? 2 : params[i + 1] === 2 ? 4 : 0;
      continue;
    }
    if (p === 9 || p === 53 || p === 58) bad.push(`parameter ${p} in ESC[${sequence}m`);
  }
  return bad;
}

/** Every unsafe SGR in a stream of terminal output. */
export function findUnsafeSgr(raw: string): string[] {
  const bad: string[] = [];
  for (const m of raw.matchAll(/\x1b\[([0-9;:]*)m/g)) bad.push(...unsafeSgr(m[1]!));
  return bad;
}

/** How the terminal names itself to acp-tui (renderer/capabilities.ts reads these three). */
const TERMINALS = {
  /** PhpStorm's terminals, classic and reworked: no SGR 9. */
  jetbrains: { TERMINAL_EMULATOR: "JetBrains-JediTerm", TERM_PROGRAM: undefined, TERM_PROGRAM_VERSION: undefined },
  /** Nothing identified (TERM is the harness's `xterm-256color`): no SGR 9. */
  unknown: { TERMINAL_EMULATOR: undefined, TERM_PROGRAM: undefined, TERM_PROGRAM_VERSION: undefined },
  /** Zed, which draws SGR 9. */
  zed: { TERMINAL_EMULATOR: undefined, TERM_PROGRAM: "zed", TERM_PROGRAM_VERSION: undefined },
} as const satisfies Record<string, Record<string, string | undefined>>;
export type Terminal = keyof typeof TERMINALS;

export async function runScenario(name: string, terminal: Terminal = "unknown", rows = 40): Promise<string> {
  const cwd = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-sgr-"));
  const scale = DELAY_SCALE[name] ?? 0;
  const args = [CLI, "--", "--", "bun", FAKE_AGENT, "--scenario", name, "--delay-scale", String(scale)];
  const s = startPty(["bun", ...args], {
    cols: 100,
    rows,
    cwd,
    colours: { foreground: "#bcbec4", background: "#191a1c" },
    env: { COLORTERM: "truecolor", ...TERMINALS[terminal] },
  });
  track(s);
  await s.waitFor(/\b(idle|running)\b[^\n]*\bconnected\b/, 10000);
  s.sendKeys({ text: "go" }, "Enter");

  const deadline = Date.now() + RUN_LIMIT_MS;
  let lastLength = -1;
  let quietSince = Date.now();
  let answeredAt = 0;
  while (Date.now() < deadline) {
    await Bun.sleep(100);
    await s.flush();
    // A permission card blocks the turn: select and confirm the first option once the typing-ahead
    // guard has passed.
    if (cardDocked(s.screenText()) && Date.now() - answeredAt > 700) {
      await Bun.sleep(350);
      s.sendKeys("1", "Enter");
      answeredAt = Date.now();
    }
    const length = s.rawOutput().length;
    if (length !== lastLength) {
      lastLength = length;
      quietSince = Date.now();
    } else if (Date.now() - quietSince > QUIET_MS) {
      break;
    }
  }
  return s.rawOutput();
}

/** A colour in effect for printed text, as the SGR stream set it. */
export type SgrColour = "default" | `palette ${number}` | `rgb ${number};${number};${number}`;

export interface PrintedCell {
  ch: string;
  fg: SgrColour;
  bg: SgrColour;
}

// One token of terminal output: a CSI, OSC, DCS or APC sequence, a two-byte escape, or plain text.
const TOKEN = /\x1b\[([0-9;:?<>=]*)[ -\/]*([@-~])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[P_^][^\x1b]*\x1b\\|\x1b[^[\]P_^]|[^\x1b]+/g;

/**
 * The runs of visible characters printed in `raw` while SGR 9 was in effect, spaces left out: a run
 * ends at the first visible character printed without it. Parameter 9 sets it; 29 and 0 (or an
 * empty SGR) clear it; extended colours' arguments are skipped.
 */
export function struckRuns(raw: string): string[] {
  let strike = false;
  const runs: string[] = [];
  let run = "";
  const end = () => {
    if (run !== "") runs.push(run);
    run = "";
  };
  for (const m of raw.matchAll(TOKEN)) {
    const token = m[0];
    if (!token.startsWith("\x1b")) {
      for (const ch of token) {
        if (ch <= " " || ch === "\x7f") continue;
        if (strike) run += ch;
        else end();
      }
      continue;
    }
    if (m[2] !== "m" || /[?<>=]/.test(m[1] ?? "")) continue;
    const params = (m[1] ?? "") === "" ? [0] : m[1]!.split(";").map((p) => (p === "" ? 0 : Number(p)));
    for (let i = 0; i < params.length; i++) {
      const p = params[i]!;
      if (p === 38 || p === 48) i += params[i + 1] === 5 ? 2 : params[i + 1] === 2 ? 4 : 0;
      else if (p === 9) strike = true;
      else if (p === 29 || p === 0) strike = false;
    }
  }
  end();
  return runs;
}

/**
 * Every visible character printed in `raw` with the foreground and background SGR in effect when
 * it was printed. Spaces and control characters are left out: a space's foreground is never seen.
 */
export function printedColours(raw: string): PrintedCell[] {
  let fg: SgrColour = "default";
  let bg: SgrColour = "default";
  const out: PrintedCell[] = [];
  for (const m of raw.matchAll(TOKEN)) {
    const token = m[0];
    if (!token.startsWith("\x1b")) {
      for (const ch of token) if (ch > " " && ch !== "\x7f") out.push({ ch, fg, bg });
      continue;
    }
    // SGR only: `CSI ... m` without a private prefix (`CSI > 4 ; 1 m` is modifyOtherKeys).
    if (m[2] !== "m" || /[?<>=]/.test(m[1] ?? "")) continue;
    const params = (m[1] ?? "") === "" ? [0] : m[1]!.split(";").map((p) => (p === "" ? 0 : Number(p)));
    for (let i = 0; i < params.length; i++) {
      const p = params[i]!;
      if (p === 38 || p === 48) {
        let colour: SgrColour | null = null;
        if (params[i + 1] === 5) {
          colour = `palette ${params[i + 2]!}`;
          i += 2;
        } else if (params[i + 1] === 2) {
          colour = `rgb ${params[i + 2]!};${params[i + 3]!};${params[i + 4]!}`;
          i += 4;
        }
        if (colour && p === 38) fg = colour;
        if (colour && p === 48) bg = colour;
      } else if (p === 0) {
        fg = "default";
        bg = "default";
      } else if (p === 39) fg = "default";
      else if (p === 49) bg = "default";
      else if ((p >= 30 && p <= 37) || (p >= 90 && p <= 97)) fg = `palette ${p >= 90 ? p - 82 : p - 30}`;
      else if ((p >= 40 && p <= 47) || (p >= 100 && p <= 107)) bg = `palette ${p >= 100 ? p - 92 : p - 40}`;
    }
  }
  return out;
}
