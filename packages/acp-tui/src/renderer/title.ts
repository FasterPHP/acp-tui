// The terminal title (mvp-chrome-and-keys task 7.1, design D12; spec tui-screen "Terminal title").
// acp-tui pushes the terminal's title at start-up (`CSI 22 ; 0 t`), sets the text of the setting
// `title.format` (title-format.ts; by default the session directory's name, with ` 2`, ` 3` and so
// on when other running acp-tui instances show the same name: title-slot.ts) through OpenTUI's
// `setTerminalTitle`, prefixed with a marker while the session is `requires_action`, and pops the
// stack in the final reset (`CSI 23 ; 0 t`, lifecycle.ts, before the exit text) on every exit path.
// The text is built from the model's already sanitised fields, cleaned again here (the title is the
// one place agent text reaches an OSC sequence), held on one line and cut to 60 columns, so no byte
// of it can end the sequence early.
import { basename } from "node:path";
import { sanitise, type Session } from "acp-model";
import type { CliRenderer } from "@opentui/core";
import { RESOLVED_SETS } from "../conversation/glyphs.ts";
import { activeGlyphs } from "../conversation/live-glyphs.ts";
import { truncateEnd } from "../layout/segments.ts";
import { DEFAULT_TITLE_FORMAT, expandTitleFormat, titleFormatUsesCounter } from "./title-format.ts";
import type { TitleSlots } from "./title-slot.ts";

export const TITLE_PUSH = "\x1b[22;0t";
export const TITLE_POP = "\x1b[23;0t";
/** The title is cut to this many columns, marker included. */
export const TITLE_COLUMNS = 60;
/** The title when the format leaves nothing (no directory yet, say). */
const TITLE_NAME = "acp-tui";
/** Marks the title while the session waits for the user: the `unicode` set's `title.marker`, by default the permission card's marker. The marker in use is the glyph set's (`activeGlyphs().titleMarker`). */
export const TITLE_MARKER = RESOLVED_SETS.unicode.titleMarker;

/** Every control character, including C1, and the Unicode line and paragraph separators. */
const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]+", "g");

/** Agent or directory text as one printable line (no escape, BEL or line break survives). */
export function titlePart(text: string | null | undefined): string {
  if (!text) return "";
  return sanitise(text, "approval").replace(CONTROL, " ").replace(/\s+/g, " ").trim();
}

export interface TitleInput {
  /** The session title the agent reported, if any. */
  readonly title: string | null;
  /** The agent's name. */
  readonly agent: string | null;
  /** The session directory; only its last component is shown. */
  readonly cwd: string | null;
  /** True while the session is `requires_action`. */
  readonly waiting: boolean;
  /** `title.format`; default `DEFAULT_TITLE_FORMAT`. */
  readonly format?: string;
  /** Which running instance showing this directory name this one is (1 for the first); default 1. */
  readonly instance?: number;
}

/** The name of the session directory as the title shows it: its last component, one printable line. */
export function titleDirectory(cwd: string | null): string {
  return titlePart(cwd ? basename(cwd) : null);
}

/**
 * The text of the title for a session, at most `TITLE_COLUMNS` columns: the format filled in, the
 * default format when it leaves nothing, then `acp-tui`; the marker leads while the session waits.
 */
export function terminalTitle(input: TitleInput, marker: string = activeGlyphs().titleMarker): string {
  const instance = input.instance ?? 1;
  const values = {
    dir: titleDirectory(input.cwd),
    counter: instance > 1 ? ` ${instance}` : "",
    agent: titlePart(input.agent),
    title: titlePart(input.title),
  };
  const text =
    titlePart(expandTitleFormat(input.format ?? DEFAULT_TITLE_FORMAT, values)) ||
    titlePart(expandTitleFormat(DEFAULT_TITLE_FORMAT, values)) ||
    TITLE_NAME;
  return truncateEnd(input.waiting ? `${marker} ${text}` : text, TITLE_COLUMNS);
}

/** The title of a model snapshot, under `format` and as instance `instance` of its directory. */
export function titleOf(session: Session, format?: string, instance?: number): string {
  return terminalTitle({
    title: session.title,
    agent: session.agent?.title ?? session.agent?.name ?? null,
    cwd: session.cwd,
    waiting: session.state === "requires_action",
    ...(format !== undefined ? { format } : {}),
    ...(instance !== undefined ? { instance } : {}),
  });
}

/** What the title follows: the session store's `snapshot` and `onChange`. */
export interface TitleFeed {
  snapshot(): Session;
  onChange(listener: (change: { readonly session: Session }) => void): () => void;
}

export interface TerminalTitle {
  /** The sequence that pops the title stack, written in the final reset; empty when no title
   *  was pushed (start-up failed before the renderer was installed). Stops following the feed and
   *  releases the instance's slot. */
  restore(): string;
  /** Sets the title again from the session as it is now (the format changed). */
  refresh(): void;
  /** Writes the title again even if it has not changed, for a program that retitled the tab
   *  behind acp-tui's back (npm's `.cmd` shims run `title %COMSPEC%`); nothing before `restore`. */
  reassert(): void;
}

export interface TitleOptions {
  /** `title.format`, read at each change; default `DEFAULT_TITLE_FORMAT`. */
  readonly format?: () => string;
  /** The instance counter's slots; without them every instance is the first. A slot is taken only
   *  while the format names `{counter}`. */
  readonly slots?: TitleSlots;
  /** The directory the session will start in, shown until the session reports its own (the launch
   *  directory or the directory argument), so the tab does not flash `acp-tui` first. */
  readonly directory?: string | null;
}

/**
 * Pushes the terminal's title and keeps `renderer`'s title in step with the session. `write` is
 * the escape output path (write-out.ts) and `setTitle` OpenTUI's `setTerminalTitle`.
 */
export function installTerminalTitle(
  renderer: Pick<CliRenderer, "setTerminalTitle" | "isDestroyed">,
  feed: TitleFeed,
  write: (data: string) => void,
  options: TitleOptions = {},
): TerminalTitle {
  let last = "";
  let stopped = false;
  const apply = (session: Session): void => {
    if (renderer.isDestroyed || stopped) return;
    const format = options.format?.() ?? DEFAULT_TITLE_FORMAT;
    // The slot follows the directory's name and is held only while the format shows the counter.
    const shown = session.cwd ?? options.directory ?? null;
    const dir = titleDirectory(shown);
    const counted = options.slots !== undefined && dir !== "" && titleFormatUsesCounter(format);
    if (!counted) options.slots?.release();
    const instance = counted ? options.slots!.acquire(dir) : 1;
    const text = titleOf(shown === session.cwd ? session : { ...session, cwd: shown }, format, instance);
    if (text === last) return;
    last = text;
    renderer.setTerminalTitle(text);
  };
  write(TITLE_PUSH);
  apply(feed.snapshot());
  const stop = feed.onChange(({ session }) => apply(session));
  return {
    restore() {
      stop();
      stopped = true;
      options.slots?.release();
      return TITLE_POP;
    },
    refresh: () => apply(feed.snapshot()),
    reassert() {
      last = "";
      apply(feed.snapshot());
    },
  };
}
