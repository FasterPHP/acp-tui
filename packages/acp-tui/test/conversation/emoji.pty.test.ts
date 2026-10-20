// Emoji drawn as their names in the real CLI (mvp-rendering task 14.5, review C11; spec
// tui-rendering "Other extensions stay text", scenario "Family in PhpStorm"): acp-tui under the
// PTY harness against test/conversation/emoji-agent.ts, as PhpStorm (`TERMINAL_EMULATOR`), as Zed
// (`TERM_PROGRAM`) and as an unknown terminal. The names are muted; a drag over a row copies the
// emoji (OSC 52 to the emulator, never the user's clipboard: ../selection/pty.ts).
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { JEDITERM_ENV, startPty, type PtySession } from "../pty/harness.ts";
import { READY } from "../pty/regions.ts";
import { localEnv, osc52Payloads } from "../selection/pty.ts";
import { DARK } from "./gallery-screen.ts";
import { EMOJI } from "./emoji-agent.ts";
import { sendPrompt } from "./cli.ts";

const ROOT = resolve(import.meta.dir, "../../../..");
const CLI = join(ROOT, "packages/acp-tui/src/cli.ts");
const AGENT = join(import.meta.dir, "emoji-agent.ts");

let session: PtySession | undefined;
afterEach(async () => {
  await session?.dispose();
  session = undefined;
});

const TERMINALS = {
  jetbrains: { ...JEDITERM_ENV },
  zed: { TERMINAL_EMULATOR: undefined, TERM_PROGRAM: "zed", TERM_PROGRAM_VERSION: undefined },
  unknown: { TERMINAL_EMULATOR: undefined, TERM_PROGRAM: undefined, TERM_PROGRAM_VERSION: undefined },
} as const;

async function start(terminal: keyof typeof TERMINALS, cols = 80): Promise<PtySession> {
  const cwd = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-emoji-"));
  session = startPty(["bun", CLI, "--", "bun", AGENT], {
    cols,
    rows: 40,
    cwd,
    env: { ...localEnv(), ...TERMINALS[terminal], COLORTERM: "truecolor", ACP_TUI_CAPABILITIES: undefined },
    colours: DARK,
    ...(terminal === "jetbrains" ? { terminal: "jediterm" as const } : {}),
  });
  await sendPrompt(session, "go");
  await session.waitFor((p) => p.screenText().some((l) => /^ {2}end turn\b/.test(l)) && READY.test(p.screenText().join("\n")), 15000);
  // The message's blocks are drawn over the next frames.
  await session.waitFor((p) => p.screenText().some((l) => l.includes(" end.")) && p.screenText().some((l) => l.startsWith("  Family")), 5000);
  return session;
}

const screen = (s: PtySession) => s.screenText().join("\n");

/** The row and column where `text` is drawn. */
function at(s: PtySession, text: string): { y: number; x: number } {
  const rows = s.screenText();
  const y = rows.findIndex((l) => l.includes(text));
  if (y < 0) throw new Error(`${JSON.stringify(text)} is not on screen\n${rows.join("\n")}`);
  return { y, x: rows[y]!.indexOf(text) };
}

/** Whether every cell of `text` (ASCII) is drawn in ANSI 8 (the muted token on a dark
 *  background), found by the cells' characters (an emoji before it on the row takes another
 *  number of cells than characters). */
function muted(s: PtySession, text: string): boolean {
  const { y } = at(s, text);
  const absY = s.term.buffer.active.baseY + y;
  const chars: string[] = [];
  for (let x = 0; x < s.term.cols; x++) chars.push(s.cell(absY, x)?.getChars() ?? "");
  const x = chars.findIndex((_, i) => [...text].every((ch, k) => chars[i + k] === ch));
  if (x < 0) return false;
  for (let k = 0; k < text.length; k++) {
    const cell = s.cell(absY, x + k);
    if (!cell || !cell.isFgPalette() || cell.getFgColor() !== 8) return false;
  }
  return true;
}

/** Drags across the whole row holding `text` and returns what was copied. */
async function copyRow(s: PtySession, text: string): Promise<string> {
  const { y } = at(s, text);
  const row = s.screenText()[y]!;
  const before = osc52Payloads(s.rawOutput()).length;
  const from = row.length - row.trimStart().length;
  s.mousePress(from, y);
  s.mouseMove(from + 3, y, "left");
  await Bun.sleep(15);
  s.mouseMove(row.length - 1, y, "left");
  await Bun.sleep(15);
  s.mouseRelease(row.length - 1, y);
  await s.waitFor((p) => osc52Payloads(p.rawOutput()).length > before, 5000);
  return osc52Payloads(s.rawOutput())[before]!;
}

describe("emoji the terminal cannot draw intact are drawn as their names (task 14.5)", () => {
  test("Family in PhpStorm: the row shows :family_man_woman_girl: in the muted token, and copying the row gives the emoji", async () => {
    const s = await start("jetbrains");
    const text = screen(s);
    expect(text).toContain("Family :family_man_woman_girl: here.");
    expect(muted(s, ":family_man_woman_girl:")).toBe(true);
    // JetBrains also names flags, keycaps, tones and bare symbols; VS16 and plain emoji stay.
    expect(text).toContain(":flag_united_kingdom:");
    expect(text).toContain(":keycap_1:");
    expect(text).toContain(":thumbs_up_medium_skin_tone:");
    expect(text).toContain("bare :red_heart:");
    expect(text).not.toContain("heart :red_heart:");
    expect(text).toContain(EMOJI.grin);
    expect(await copyRow(s, "Family :family_man_woman_girl:")).toBe(`Family ${EMOJI.family} here.`);
  }, 30000);

  test("PhpStorm: the expanded tool card names its title, prose and fence alike", async () => {
    const s = await start("jetbrains");
    s.sendKeys("Ctrl+O");
    await s.waitFor((p) => p.screenText().some((l) => l.includes("ok ") && l.includes(":family_man_woman_girl:")), 5000);
    const text = screen(s);
    expect(text).toContain(":thumbs_up_medium_skin_tone: files");
    expect(muted(s, ":thumbs_up_medium_skin_tone:")).toBe(true);
    expect(await copyRow(s, "Checked :thumbs_up_medium_skin_tone:")).toBe(`Checked ${EMOJI.tone} files:`);
  }, 30000);

  test("Zed: keycaps and VS16 named, flags drawn as they are", async () => {
    // 83 columns: the conversation's 78 (less the gutter, the right margin and the scroll bar,
    // mvp-chrome-and-keys D17), so the keycap, tone and heart stay on one row.
    const s = await start("zed", 83);
    const text = screen(s);
    expect(text).toContain(":keycap_1:");
    expect(text).toContain("heart :red_heart:");
    expect(text).toContain(":family_man_woman_girl:");
    expect(text).not.toContain(":flag_united_kingdom:");
    expect(muted(s, ":keycap_1:")).toBe(true);
    expect(await copyRow(s, "keycap :keycap_1:")).toContain(`keycap ${EMOJI.keycap} tone ${EMOJI.tone} heart ${EMOJI.heart}`);
  }, 30000);

  test("an unknown terminal: only what OpenTUI itself mis-measures (the bare heart) is named", async () => {
    const s = await start("unknown");
    const text = screen(s);
    for (const name of [":family_man_woman_girl:", ":flag_united_kingdom:", ":keycap_1:", ":thumbs_up_medium_skin_tone:"]) expect(text).not.toContain(name);
    expect(text).not.toContain("heart :red_heart:");
    expect(text).toContain("bare :red_heart:");
  }, 30000);
});
