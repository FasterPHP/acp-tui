// The terminal capability table (mvp-rendering design decision 5; spec tui-rendering
// "Strikethrough" and "Links"). Some text features depend on what the terminal draws, and the
// IDE terminals cannot be asked: SGR 9 (strikethrough) is dropped by JediTerm and drawn by Zed,
// OSC 8 (hyperlinks) is drawn and opened by Zed and not usable in PhpStorm (IDE check 12.3,
// 9 October 2026). So, like the wheel step (`wheel.ts`), the
// answer comes from a table keyed by what the environment names: `TERMINAL_EMULATOR`
// (`JetBrains-JediTerm` for both PhpStorm terminals), then `TERM_PROGRAM` (Zed, Ghostty,
// WezTerm, iTerm2), then `TERM` (kitty, Ghostty), then `WT_SESSION` (Windows Terminal, any
// non-empty value; last because an IDE started from Windows Terminal inherits it, as does
// anything started inside it). The first variable that matches a row decides;
// anything else, and an unset environment, gets no capability.
//
// - `sgr9`: the terminal draws SGR 9. Where it does, struck text carries the attribute as well
//   as the muted `markdown.strike` token (which is applied everywhere, as the floor).
// - `combiningStrike`: the terminal composes U+0336 into one cell per character. False for every
//   terminal until the PhpStorm check passes (audit section 10, check 2).
// - `osc8`: OSC 8 hyperlinks verified in the terminal, so a link is emitted as one. The rule
//   (design open question 3): a plain or Ctrl+click opens the target with mouse reporting on,
//   and the terminal does not also open what acp-tui's own click opens. True for Zed only
//   (Ctrl+click opens in Brave or a Zed tab with mouse reporting on, 9 October 2026). False for
//   JetBrains, whose one row serves both engines: classic opens a link on every plain click even
//   with mouse reporting on (a double open with acp-tui's own click), and reworked draws no OSC 8.
//   False for every unverified terminal; acp-tui's own click handler opens links either way.
// - `emoji`: the classes of emoji sequence drawn as their names (render/emoji/emoji.ts; task
//   14.5, review C11), because the terminal draws them in another number of cells than acp-tui
//   lays out (cell counts measured by `tools/mvp-rendering/emoji-probe.ts` on 10 October 2026).
//   JetBrains (both engines): ZWJ sequences (family 8 cells, laid out 2), flags (4, England 14),
//   keycaps (3) and skin tones (4); variation selector 16 is drawn in 2 cells there. Zed: ZWJ
//   sequences (6), keycaps (1), skin tones (4) and VS16 on a narrow base (1); flags are 2. Every
//   row, unknown terminals included, also has `bare`: what OpenTUI 0.5.12 itself counts
//   differently from the layout (a bare `❤` is 2 cells in OpenTUI and 1 in Bun.stringWidth and in
//   every terminal measured, which counts it by the Unicode width tables), so it is mis-drawn
//   whatever the terminal. Other terminals are not measured, so they get only `bare`.
// - `detectsUrls`: the terminal finds URL-like text on a screen row by itself and opens it on a
//   plain click, even while the app reports the mouse (review C9, docs/mvp-notes/rendering-research.md).
//   True for JetBrains only: both engines run the IDE's URL filter over each row (`http(s)://`,
//   `ftp(s)://`, `news://`, `mailto:`, `www.`, `file:/`), show the hand over a match, open it on a
//   plain click and still report the click. acp-tui then opens nothing itself for a click inside
//   such a match (src/links/detect.ts), so one click opens one target, and draws a bare URL too
//   long for its row on one row, without its scheme and shortened in the middle (review A1;
//   conversation/markdown/wrap.ts), so the terminal never detects a cut-off URL. Zed detects only
//   on Ctrl+click, which acp-tui leaves to it in every terminal: false.
//
// - Windows Terminal (windows-support design D9; measured in the Windows 11 VM in Windows Terminal
//   1.24 and 1.25 on 20 October 2026, see the row's comment below `TERMINAL_TABLE`): OSC 8 on,
//   URL detection off (it opens a bare URL only on Ctrl+click), flags and keycaps drawn as names.
//
// One table (mvp-configuration design D12): each terminal's row also holds its wheel step
// (`wheelLines`, the wheel table of spec tui-screen "Wheel step per terminal", which `wheel.ts`
// used to keep apart), and `detectTerminal` is the one detection function for both. The
// `terminals` setting overrides a row per field (`effectiveTerminal`): `wheel_lines`,
// `strikethrough` (`sgr9`, `overlay` for `combiningStrike`, `colour` for neither) and `hyperlinks`
// (`osc8`). `detectsUrls` and `emoji` are measured facts about a terminal, not preferences, and
// are not exposed (Open Question 10). `ACP_TUI_CAPABILITIES` stays a diagnostic override on top
// of the effective row (Open Question 9), absent from `--help` and the schema.
import { EMOJI_CLASSES, type EmojiClass } from "../render/emoji/emoji.ts";
import { TERMINAL_IDS, type TerminalId } from "./terminal-ids.ts";

export { TERMINAL_IDS, type TerminalId };

export interface TerminalCapabilities {
  /** The terminal draws SGR 9 (strikethrough). */
  readonly sgr9: boolean;
  /** The terminal composes U+0336 (combining long stroke overlay) into the cell of the character before it. */
  readonly combiningStrike: boolean;
  /** OSC 8 hyperlinks are verified to work in the terminal. */
  readonly osc8: boolean;
  /** The classes of emoji sequence the terminal (or OpenTUI) draws at another width than acp-tui
   *  lays out, drawn as their names instead. */
  readonly emoji: readonly EmojiClass[];
  /** The terminal detects URL-like text itself and opens it on a plain click (JetBrains). */
  readonly detectsUrls: boolean;
}

/** The environment variables a terminal is named by, in the order they are tried. */
export const CAPABILITY_KEYS = ["TERMINAL_EMULATOR", "TERM_PROGRAM", "TERM", "WT_SESSION"] as const;
export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

/** The `value` of a match that any non-empty value of the variable satisfies (`WT_SESSION` holds a GUID). */
export const ANY_VALUE = "*";

/** A variable and value (compared without case; `ANY_VALUE` for any non-empty one) that name a terminal of the table. */
export interface TerminalMatch {
  readonly id: Exclude<TerminalId, "default">;
  readonly key: CapabilityKey;
  readonly value: string;
}

/** One terminal's row: rows scrolled per wheel event, and what it draws. */
export interface TerminalRow {
  readonly wheelLines: number;
  readonly capabilities: TerminalCapabilities;
}

/** The emoji classes OpenTUI 0.5.12 mis-measures in every terminal (see the header). */
export const OPENTUI_EMOJI: readonly EmojiClass[] = Object.freeze(["bare"] as const);
/** The JetBrains terminals' (both engines): measured on 10 October 2026. */
export const JETBRAINS_EMOJI: readonly EmojiClass[] = Object.freeze(["zwj", "flag", "keycap", "tone", "bare"] as const);
/** Zed's: measured on 10 October 2026. */
export const ZED_EMOJI: readonly EmojiClass[] = Object.freeze(["zwj", "keycap", "tone", "vs16", "bare"] as const);

/** What an unknown terminal, or an unset environment, gets: only OpenTUI's own emoji classes. */
export const NO_CAPABILITIES: TerminalCapabilities = Object.freeze({ sgr9: false, combiningStrike: false, osc8: false, detectsUrls: false, emoji: OPENTUI_EMOJI });

const JETBRAINS: TerminalCapabilities = Object.freeze({ ...NO_CAPABILITIES, detectsUrls: true, emoji: JETBRAINS_EMOJI });
const SGR9_ONLY: TerminalCapabilities = Object.freeze({ ...NO_CAPABILITIES, sgr9: true });
const ZED: TerminalCapabilities = Object.freeze({ ...NO_CAPABILITIES, sgr9: true, osc8: true, emoji: ZED_EMOJI });
/**
 * Windows Terminal. Measured in the Windows 11 VM in Windows Terminal 1.24 and 1.25 (20 October
 * 2026), with mouse reporting on and off: SGR 9 is drawn (`sgr9`), and the wheel sends one report
 * per notch (3 rows per event, as the table's default). OSC 8 (`osc8`): a plain click on an OSC 8
 * link is acp-tui's and opens it once (the terminal does not open it as well), a Ctrl+click is the
 * terminal's and opens it once, with mouse reporting on or off. URL detection (`detectsUrls` off):
 * the terminal opens a bare URL only on Ctrl+click, never on a plain click, so acp-tui opens it on
 * a plain click itself (with the capability on, a plain click on a bare URL opened nothing). Emoji:
 * ConPTY counts every class in 2 cells, as OpenTUI does, and ZWJ sequences, skin tones and VS16 are
 * drawn intact; flags are drawn as a stray glyph (Windows ships no flag emoji) and a keycap
 * overdraws the cell to its left, so those two are drawn as names, with `bare` as everywhere.
 */
const WINDOWS_TERMINAL: TerminalCapabilities = Object.freeze({
  ...NO_CAPABILITIES,
  sgr9: true,
  osc8: true,
  detectsUrls: false,
  emoji: Object.freeze(["flag", "keycap", "bare"] as const),
});

/** How each terminal is detected: `TERMINAL_EMULATOR` (both PhpStorm engines), then `TERM_PROGRAM`
 *  (Zed, Ghostty, WezTerm, iTerm2), then `TERM` (kitty, Ghostty), then `WT_SESSION` (Windows
 *  Terminal). */
export const TERMINAL_MATCHES: readonly TerminalMatch[] = [
  { id: "jetbrains", key: "TERMINAL_EMULATOR", value: "JetBrains-JediTerm" },
  { id: "zed", key: "TERM_PROGRAM", value: "zed" },
  { id: "ghostty", key: "TERM_PROGRAM", value: "ghostty" },
  { id: "wezterm", key: "TERM_PROGRAM", value: "WezTerm" },
  { id: "iterm2", key: "TERM_PROGRAM", value: "iTerm.app" },
  { id: "ghostty", key: "TERM", value: "xterm-ghostty" },
  { id: "kitty", key: "TERM", value: "xterm-kitty" },
  { id: "windows-terminal", key: "WT_SESSION", value: ANY_VALUE },
];

/** The wheel step of the terminals not measured. */
const DEFAULT_WHEEL_LINES = 3;

/**
 * The built-in rows. Capabilities: SGR 9 for Zed, Ghostty, kitty, WezTerm and iTerm2 (audit
 * section 5), none for JetBrains; OSC 8 for Zed (verified on 9 October 2026) and Windows Terminal (20 October 2026); `detectsUrls`
 * for JetBrains only (review C9, 10 October 2026); no terminal has `combiningStrike` (JediTerm
 * gives each U+0336 a cell of its own, and in Zed the stroke is a fallback glyph offset by half a
 * cell, with SGR 9 drawn there anyway); emoji names as measured in JetBrains and Zed, OpenTUI's
 * own classes elsewhere (Windows Terminal's measured on 20 October 2026, see `WINDOWS_TERMINAL`). Wheel steps (phase-1a task 10.4, measured on 2 October 2026, so that one
 * notch scrolls about 3 rows): PhpStorm reworked sends one report per notch (3 rows per event);
 * Zed 1.18.1 sends three per notch in one read, occasionally two around a change of direction (1
 * row per event); Windows Terminal 1.24 sends one report per notch (3 rows per event, 20 October 2026);
 * PhpStorm classic and every other terminal are not measured and take 3.
 */
export const TERMINAL_TABLE: Readonly<Record<TerminalId, TerminalRow>> = Object.freeze({
  jetbrains: { wheelLines: 3, capabilities: JETBRAINS },
  zed: { wheelLines: 1, capabilities: ZED },
  ghostty: { wheelLines: DEFAULT_WHEEL_LINES, capabilities: SGR9_ONLY },
  kitty: { wheelLines: DEFAULT_WHEEL_LINES, capabilities: SGR9_ONLY },
  wezterm: { wheelLines: DEFAULT_WHEEL_LINES, capabilities: SGR9_ONLY },
  iterm2: { wheelLines: DEFAULT_WHEEL_LINES, capabilities: SGR9_ONLY },
  "windows-terminal": { wheelLines: 3, capabilities: WINDOWS_TERMINAL },
  default: { wheelLines: DEFAULT_WHEEL_LINES, capabilities: NO_CAPABILITIES },
});

/** The terminal this environment names: the first variable, in key order, that has a matching
 *  entry; `default` when none does. */
export function detectTerminal(
  env: Readonly<Record<string, string | undefined>> = process.env,
  matches: readonly TerminalMatch[] = TERMINAL_MATCHES,
): TerminalId {
  for (const key of CAPABILITY_KEYS) {
    const value = env[key]?.toLowerCase();
    if (!value) continue;
    const match = matches.find((candidate) => candidate.key === key && (candidate.value === ANY_VALUE || candidate.value.toLowerCase() === value));
    if (match) return match.id;
  }
  return "default";
}

/** The variable that overrides the table's answer (see `capabilityOverrides`). */
export const CAPABILITY_OVERRIDE_VAR = "ACP_TUI_CAPABILITIES";

const CAPABILITY_NAMES: readonly ("sgr9" | "combiningStrike" | "osc8" | "detectsUrls")[] = ["sgr9", "combiningStrike", "osc8", "detectsUrls"];

/** `emoji=` in `ACP_TUI_CAPABILITIES`: classes joined by `+`, `all`, or `none` (or nothing). */
function emojiOverride(setting: string | undefined): readonly EmojiClass[] {
  if (setting === undefined || setting === "all") return EMOJI_CLASSES;
  return EMOJI_CLASSES.filter((c) => setting.split("+").some((s) => s.trim() === c));
}

/**
 * The overrides in `ACP_TUI_CAPABILITIES`: a comma list of capability names, each alone (on) or
 * as `name=true` or `name=false`, such as `osc8`, `osc8=false,sgr9` or `detectsUrls`; and `emoji=` with the emoji
 * classes drawn as names joined by `+` (`emoji=zwj+flag`), `all` (as `emoji` alone) or `none`
 * (`emoji=none,osc8`). Unknown names and values are ignored. A diagnostic variable for the PTY
 * tests and the IDE checks (a terminal forced to `osc8: true`), applied on top of the `terminals`
 * setting (mvp-configuration Open Question 9).
 */
export function capabilityOverrides(value: string | undefined): Partial<TerminalCapabilities> {
  const out: { -readonly [K in keyof TerminalCapabilities]?: TerminalCapabilities[K] } = {};
  for (const part of (value ?? "").split(",")) {
    const [name, setting] = part.trim().split("=", 2).map((s) => s.trim());
    if (name === "emoji") {
      out.emoji = emojiOverride(setting);
      continue;
    }
    const key = CAPABILITY_NAMES.find((k) => k === name);
    if (!key) continue;
    if (setting === undefined || setting === "true" || setting === "1") out[key] = true;
    else if (setting === "false" || setting === "0") out[key] = false;
  }
  return out;
}

/** How struck text is drawn, as the `terminals` setting names it (design D12). */
export type StrikeMode = "sgr9" | "overlay" | "colour";

/** One terminal's entry of the `terminals` setting: values that replace the built-in ones. */
export interface TerminalOverrides {
  readonly wheel_lines?: number | undefined;
  readonly strikethrough?: StrikeMode | undefined;
  readonly hyperlinks?: boolean | undefined;
}

/** The `terminals` setting: entries by terminal ID. */
export type TerminalsSetting = Readonly<Partial<Record<TerminalId, TerminalOverrides | undefined>>>;

/** The terminal in use and its effective row. */
export interface EffectiveTerminal extends TerminalRow {
  readonly id: TerminalId;
  /** Whether `wheelLines` is the built-in step or the `terminals` entry's. */
  readonly wheelSource: "table" | "terminals";
}

const STRIKE_FIELDS: Readonly<Record<StrikeMode, Pick<TerminalCapabilities, "sgr9" | "combiningStrike">>> = {
  sgr9: { sgr9: true, combiningStrike: false },
  overlay: { sgr9: false, combiningStrike: true },
  colour: { sgr9: false, combiningStrike: false },
};

/**
 * The terminal this environment names with its effective row: the built-in row, then its entry
 * of the `terminals` setting (unset values keep the built-in ones; `default` applies only to a
 * terminal the table does not name), then `ACP_TUI_CAPABILITIES` on top of the capabilities (a
 * diagnostic override, which also reaches `emoji` and `detectsUrls`).
 */
export function effectiveTerminal(
  env: Readonly<Record<string, string | undefined>> = process.env,
  terminals: TerminalsSetting = {},
  table: Readonly<Record<TerminalId, TerminalRow>> = TERMINAL_TABLE,
): EffectiveTerminal {
  const id = detectTerminal(env);
  const row = table[id];
  const entry = terminals[id] ?? {};
  const changes: { -readonly [K in keyof TerminalCapabilities]?: TerminalCapabilities[K] } = {};
  if (entry.strikethrough !== undefined) Object.assign(changes, STRIKE_FIELDS[entry.strikethrough]);
  if (entry.hyperlinks !== undefined) changes.osc8 = entry.hyperlinks;
  Object.assign(changes, capabilityOverrides(env[CAPABILITY_OVERRIDE_VAR]));
  const capabilities = Object.keys(changes).length === 0 ? row.capabilities : Object.freeze({ ...row.capabilities, ...changes });
  const wheelLines = entry.wheel_lines ?? row.wheelLines;
  return { id, wheelLines, wheelSource: entry.wheel_lines === undefined ? "table" : "terminals", capabilities };
}

/** What this terminal draws, from its environment: the built-in row with `ACP_TUI_CAPABILITIES` on
 *  top (`effectiveTerminal` without the setting). */
export function terminalCapabilities(env: Readonly<Record<string, string | undefined>> = process.env): TerminalCapabilities {
  return effectiveTerminal(env).capabilities;
}
