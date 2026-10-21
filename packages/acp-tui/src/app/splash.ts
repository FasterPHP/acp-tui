// The splash's rows (mvp-chrome-and-keys design D2; spec tui-layout "Splash
// screen"), pure so they are unit-tested without a renderer. Shown in the
// conversation region while the session has no items: acp-tui's wordmark and
// version, a graphic of what acp-tui does (any IDE or terminal, acp-tui, the
// agents it drives, and a tagline of its qualities), the harness, model and
// directory (two rows, drawn from the first frame: before the session has started
// `Harness: <launch name> • <spinner> starting…` then `opening session…`, then `Harness: <agent name> • Model: <model>`,
// the labels in `muted` and the values in `text`), and the keys that are not in the status row (send, newline, the
// agent's commands, file mention, the command palette, interrupt, detach) with
// labels from the key map in use. Every
// character comes from the glyph set or is plain text, in theme tokens.
//
// Where the region is too small, the graphic goes first, then the wordmark,
// then the blank rows between the sections, then the identity rows; the hints
// stay, wrapped between whole hints, never cut mid-word.
import { interruptHintKey } from "../keys/hints.ts";
import { actionLabel, type KeyMap } from "../keys/keymap.ts";
import { commandDisplayName } from "../agent/harness-name.ts";
import type { Platform } from "../platform/paths.ts";
import { newlineLabel } from "../keys/newline-hint.ts";
import type { InterruptSetting } from "../keys/settings.ts";
import type { ChromeGlyphs } from "../layout/glyphs.ts";
import { AD_HOC_AGENT } from "../session/session-index.ts";
import { displayWidth, shortenHome, truncateEnd, truncateMiddle, type Segment } from "../layout/segments.ts";

/** Where acp-tui runs, on the left of the graphic (generic: "it should work with any terminal or
 *  IDE", Marcus, 11 October 2026, task 12.3), and the agents on its right, followed by the glyph
 *  set's `more` (examples, not a list). */
export const SPLASH_TERMINALS = ["IDE", "terminal"] as const;
export const SPLASH_AGENTS = ["auggie", "claude", "codex"] as const;
/** What acp-tui is, the graphic's second row (Marcus, 15 October 2026): its own qualities, not
 *  features every client has. Plain text, not a setting. */
export const SPLASH_TAGLINE = ["clear", "concise", "fast", "customisable"] as const;
/** What the first identity row says, after the spinner, until the session has started: `starting…`
 *  until the harness has answered `initialize`, then `opening session…`, and from the fifth second of
 *  a wait on the whole seconds waited (`starting… 12 s`). */
export const SPLASH_STARTING = "starting…";
export const SPLASH_OPENING = "opening session…";
/** The seconds are shown from this many on. */
export const SPLASH_SECONDS_FROM = 5;
/** The seconds the form reserves room for (a start-up timeout is at most 600 s). */
const SPLASH_SECONDS_RESERVED = " 600 s";
/** The columns the phase cell holds, whichever form it shows, so nothing on the row moves. */
export const SPLASH_PHASE_WIDTH = displayWidth(SPLASH_OPENING) + displayWidth(SPLASH_SECONDS_RESERVED);

export type StartupPhase = "starting" | "opening";

/** The phase cell's text for a wait of `seconds` whole seconds, padded to `SPLASH_PHASE_WIDTH`
 *  columns: `starting…`, or from the fifth second `starting… 12 s`. */
export function phaseCell(phase: StartupPhase, seconds: number): string {
  const text = `${phase === "starting" ? SPLASH_STARTING : SPLASH_OPENING}${seconds >= SPLASH_SECONDS_FROM ? ` ${Math.min(999, Math.floor(seconds))} s` : ""}`;
  return text + " ".repeat(Math.max(0, SPLASH_PHASE_WIDTH - displayWidth(text)));
}

/** The identity row's labels, in `muted`; the values after them are in `text` (Marcus, 18 October 2026). */
export const SPLASH_HARNESS_LABEL = "Harness: ";
export const SPLASH_MODEL_LABEL = "Model: ";

/** The harness as the identity row names it: the agent's sanitised reported name without a trailing
 *  word "Agent" (`Claude Agent` is `Claude`), never stripped to nothing; the launch's own name when
 *  the agent reported none. */
export function harnessName(reported: string | null, fallback: string): string {
  const name = (reported ?? "").trim();
  if (name === "") return fallback;
  const stripped = name.replace(/\s+agent$/i, "").trim();
  return stripped === "" ? name : stripped;
}

/** Between two hints on a row. */
const HINT_GAP = "  ";

/** What the launch says before the session reports anything: the harness's name as launched (the
 *  configured name, or the first word of an ad hoc command without its directory, and on Windows
 *  without a `.cmd`, `.bat` or `.exe` extension) and the session
 *  directory. Both are known at launch, so the identity rows never wait for the agent. */
export interface SplashLaunch {
  readonly harness: string;
  readonly directory: string;
}

/** The launch as the splash shows it. `agentName` is `ad hoc` for a command given after `--`. */
export function splashLaunch(launch: { readonly agentName: string; readonly command: string; readonly directory: string }, platform: Platform = process.platform): SplashLaunch {
  return { harness: launch.agentName === AD_HOC_AGENT ? commandDisplayName(launch.command, platform) : launch.agentName, directory: launch.directory };
}

/** A segment the spinner's current frame replaces (the splash redraws that cell alone). */
export interface SplashSegment extends Segment {
  readonly spinner?: true;
  /** The cell showing what the start waits for (`phaseCell`); the app redraws it as the seconds pass. */
  readonly phase?: true;
}

export interface SplashInput {
  readonly version: string;
  /** The agent's sanitised name, or null before `initialize`. */
  readonly agent: string | null;
  readonly model: string | null;
  /** The session's directory, or null before it reports one: the launch's is shown instead. */
  readonly cwd: string | null;
  /** The harness and directory of the launch. */
  readonly launch: SplashLaunch;
  /** True until the session has started: the first identity row then reads the harness and
   *  `connecting…` after a spinner cell. */
  readonly connecting: boolean;
  /** What the start waits for while `connecting` (default `starting`), and the seconds waited (default 0). */
  readonly phase?: StartupPhase;
  readonly seconds?: number;
  /** The spinner's frames (`spinner.1` to `spinner.4`, one column each); the layout holds the
   *  first, and `SplashSegment.spinner` marks the cell to redraw. */
  readonly spinner: readonly string[];
  readonly home: string | null;
  /** The platform whose path rules apply to the directory (tests inject `win32`); absent = this one. */
  readonly platform?: NodeJS.Platform;
  readonly keyMap: KeyMap;
  /** The `interrupt` setting in use (the interrupt hint's presses); default `double`. */
  readonly interrupt?: InterruptSetting;
  readonly glyphs: ChromeGlyphs;
}

/** One hint: the key (from the key map) and what it does. */
export interface SplashHint {
  readonly key: string;
  readonly label: string;
}

/**
 * The splash's hints, from the key map in use: send, newline, the agent's commands (`/`), file
 * mention (`@`, typed into the prompt box, not a key map action), the command palette (`?`, task
 * 12.1), interrupt (the double Esc, or one under `interrupt: single`) and detach. A hint whose
 * action has no key is left out. The newline key is `shift+enter` unless the terminal is Windows
 * Terminal without the kitty keyboard protocol, where it is `ctrl+enter` (`keys/newline-hint.ts`).
 */
export function splashHints(map: KeyMap, interrupt?: InterruptSetting): SplashHint[] {
  const hints: { key: string | null; label: string }[] = [
    { key: actionLabel(map, "prompt", "submit"), label: "send" },
    { key: newlineLabel(map), label: "newline" },
    { key: actionLabel(map, "prompt", "agentCommands"), label: "commands" },
    { key: "@", label: "files" },
    { key: actionLabel(map, "prompt", "palette"), label: "help" },
    { key: interruptHintKey(map, interrupt), label: "interrupt" },
    { key: actionLabel(map, "global", "detach"), label: "detach" },
  ];
  return hints.filter((h): h is SplashHint => h.key !== null);
}

/** The hints laid out in rows of at most `width` columns, broken between whole hints. */
export function hintRows(hints: readonly SplashHint[], width: number): Segment[][] {
  const rows: Segment[][] = [];
  let row: Segment[] = [];
  let used = 0;
  for (const hint of hints) {
    const w = displayWidth(hint.key) + 1 + displayWidth(hint.label);
    const gap = row.length > 0 ? displayWidth(HINT_GAP) : 0;
    if (row.length > 0 && used + gap + w > width) {
      rows.push(row);
      row = [];
      used = 0;
    }
    if (row.length > 0) row.push({ text: HINT_GAP, token: "muted" });
    row.push({ text: hint.key, token: "accent" }, { text: ` ${hint.label}`, token: "muted" });
    used += (row.length > 2 ? displayWidth(HINT_GAP) : 0) + w;
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

type Section = { readonly name: "wordmark" | "graphic" | "identity" | "hints"; readonly rows: SplashSegment[][] };

function sectionWidth(section: Section): number {
  return Math.max(0, ...section.rows.map((r) => r.reduce((w, s) => w + displayWidth(s.text), 0)));
}

/** The sections at `width` columns, before fitting the height; a section wider than the region
 *  (the wordmark or the graphic) is left out. */
function sections(input: SplashInput, width: number): Section[] {
  const { glyphs } = input;
  const out: Section[] = [];
  // The version follows the wordmark's last row; as many blank columns before every row (and after
  // the others) keep the wordmark itself centred.
  const version = `  ${input.version}`;
  const pad = " ".repeat(displayWidth(version));
  const last = glyphs.splash.wordmark.length - 1;
  const wordmark: Segment[][] = glyphs.splash.wordmark.map((row, i) => [
    { text: pad, token: "muted" },
    { text: row, token: "accent" },
    { text: i === last ? version : pad, token: "muted" },
  ]);
  out.push({ name: "wordmark", rows: wordmark });

  const sep = glyphs.splash.separator;
  const arrow = ` ${glyphs.splash.arrow} `;
  out.push({
    name: "graphic",
    rows: [
      [
        { text: SPLASH_TERMINALS.join(sep), token: "muted" },
        { text: arrow, token: "muted" },
        { text: "acp-tui", token: "accent" },
        { text: arrow, token: "muted" },
        { text: [...SPLASH_AGENTS, glyphs.splash.more].join(sep), token: "muted" },
      ],
      [{ text: SPLASH_TAGLINE.join(sep), token: "muted" }],
    ],
  });

  // Two rows, always: the section's height never changes when the session starts, so nothing on
  // the splash moves (spec tui-layout "Nothing moves when the session starts").
  const identity: SplashSegment[][] = [];
  const room = Math.max(1, width - 2);
  const harnessLabel: SplashSegment = { text: SPLASH_HARNESS_LABEL, token: "muted" };
  const labelWidth = displayWidth(SPLASH_HARNESS_LABEL);
  if (input.connecting) {
    const tail: SplashSegment[] = [
      { text: sep, token: "muted" },
      { text: input.spinner[0] ?? " ", token: "muted", spinner: true },
      { text: ` ${phaseCell(input.phase ?? "starting", input.seconds ?? 0)}`, token: "muted", phase: true },
    ];
    const tailWidth = tail.reduce((w, seg) => w + displayWidth(seg.text), 0);
    identity.push([harnessLabel, { text: truncateEnd(input.launch.harness, Math.max(1, room - labelWidth - tailWidth)), token: "text" }, ...tail]);
  } else {
    // The values are truncated, never the labels; the model part goes when its label and one column
    // of the value do not fit.
    const harness = truncateEnd(input.agent === null ? input.launch.harness : harnessName(input.agent, input.launch.harness), Math.max(1, room - labelWidth));
    const row: SplashSegment[] = [harnessLabel, { text: harness, token: "text" }];
    const model = input.model;
    const used = labelWidth + displayWidth(harness) + displayWidth(sep);
    if (model !== null && model !== "" && used + displayWidth(SPLASH_MODEL_LABEL) + 1 <= room) {
      row.push(
        { text: sep, token: "muted" },
        { text: SPLASH_MODEL_LABEL, token: "muted" },
        { text: truncateEnd(model, room - used - displayWidth(SPLASH_MODEL_LABEL)), token: "text" },
      );
    }
    identity.push(row);
  }
  identity.push([{ text: truncateMiddle(shortenHome(input.cwd ?? input.launch.directory, input.home, input.platform), room), token: "muted" }]);
  out.push({ name: "identity", rows: identity });

  out.push({ name: "hints", rows: hintRows(splashHints(input.keyMap, input.interrupt), room) });
  return out.filter((s) => s.name === "hints" || s.name === "identity" || sectionWidth(s) <= width);
}

/** Rows a list of sections takes, with one blank row between two sections when `gaps`. */
function heightOf(list: readonly Section[], gaps: boolean): number {
  return list.reduce((h, s) => h + s.rows.length, 0) + (gaps ? Math.max(0, list.length - 1) : 0);
}

/**
 * The splash for a region of `width` x `height` cells: its rows from top to bottom (blank rows
 * between the sections as `[]`), each to be centred, and how many blank rows go above it.
 */
export function splashLayout(input: SplashInput, width: number, height: number): { top: number; rows: SplashSegment[][]; shown: Section["name"][] } {
  let list = sections(input, width);
  // Drop order: the graphic, the wordmark, the blank rows between sections, the identity.
  let gaps = true;
  for (const name of ["graphic", "wordmark"] as const) {
    if (heightOf(list, gaps) > height) list = list.filter((s) => s.name !== name);
  }
  if (heightOf(list, gaps) > height) gaps = false;
  if (heightOf(list, gaps) > height) list = list.filter((s) => s.name !== "identity");
  const rows: SplashSegment[][] = [];
  list.forEach((s, i) => {
    if (i > 0 && gaps) rows.push([]);
    rows.push(...s.rows);
  });
  const shownRows = rows.slice(0, Math.max(0, height));
  return { top: Math.max(0, Math.floor((height - shownRows.length) / 2)), rows: shownRows, shown: list.map((s) => s.name) };
}

/** A row's display width. */
export function rowWidth(row: readonly Segment[]): number {
  return row.reduce((w, s) => w + displayWidth(s.text), 0);
}
