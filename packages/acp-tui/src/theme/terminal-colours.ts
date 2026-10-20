// Reading the terminal's foreground and background (design D8, spec tui-theme
// "Surfaces derived from the terminal's colours"). OpenTUI 0.5.12's `getPalette()` cannot
// be used: `TerminalPalette.detect()` first waits 300 ms for an OSC 4 reply and returns every
// colour as null when none arrives, and PhpStorm does not answer OSC 4. So acp-tui asks OSC 10
// and OSC 11 itself and reads the replies through `renderer.subscribeOsc`.
//
// The tracker keeps its subscription for the life of the renderer, so replies that OpenTUI's own
// queries provoke (it re-queries on `CSI ? 997 ; n n`) update the colours too.
import type { CliRenderer } from "@opentui/core";
import type { TerminalColours } from "./derive.ts";
import type { LiveTheme } from "./live.ts";

/** Start-up wait for the two replies; no reply means the flat fallback. */
export const QUERY_TIMEOUT_MS = 300;

/** The queries: foreground then background, BEL-terminated (terminals reply in kind). */
export const COLOUR_QUERY = "\x1b]10;?\x07\x1b]11;?\x07";

/** One channel of `rgb:` in 1 to 4 hex digits, scaled to 0 to 255. */
function channel(digits: string): number {
  return Math.round((parseInt(digits, 16) / (16 ** digits.length - 1)) * 255);
}

/**
 * Parses an OSC 10 or OSC 11 reply: `ESC ] 10 ; rgb:rrrr/gggg/bbbb` (1 to 4 hex digits per
 * channel) or `ESC ] 11 ; #rrggbb`, ended by BEL, ST (`ESC \`) or nothing. Returns `null` for
 * anything else, including the `?` query itself.
 */
export function parseColourReply(sequence: string): { code: 10 | 11; colour: string } | null {
  const m = /^\x1b\](10|11);(?:rgba?:([0-9a-fA-F]{1,4})\/([0-9a-fA-F]{1,4})\/([0-9a-fA-F]{1,4})(?:\/[0-9a-fA-F]{1,4})?|#([0-9a-fA-F]{6}))(?:\x07|\x1b\\)?$/.exec(sequence);
  if (!m) return null;
  const code = m[1] === "10" ? 10 : 11;
  if (m[5]) return { code, colour: `#${m[5].toLowerCase()}` };
  const [r, g, b] = [m[2]!, m[3]!, m[4]!].map((d) => channel(d).toString(16).padStart(2, "0"));
  return { code, colour: `#${r}${g}${b}` };
}

export interface ColourTracker {
  /** The latest pair of replies, or `null` while either is missing. */
  colours(): TerminalColours | null;
  /**
   * Sends the queries and resolves with the colours once both replies have arrived, or
   * `null` at the timeout. Replies from before the call do not count: the previous pair is
   * forgotten first, so a terminal that stops answering falls back to flat.
   */
  query(timeoutMs?: number): Promise<TerminalColours | null>;
  /** Called with the new colours whenever a complete, changed pair arrives (including from queries acp-tui did not send). */
  onChange(handler: (colours: TerminalColours) => void): () => void;
  dispose(): void;
}

export interface ColourTrackerOptions {
  /** Where the queries go; default the process's stdout, as OpenTUI's own output does. */
  write?: (data: string) => void;
}

export function createColourTracker(
  renderer: Pick<CliRenderer, "subscribeOsc">,
  options: ColourTrackerOptions = {},
): ColourTracker {
  const write = options.write ?? ((data: string) => void process.stdout.write(data));
  let foreground: string | null = null;
  let background: string | null = null;
  let complete: TerminalColours | null = null;
  // The last pair handed to `onChange`; a query forgets `complete` but not this, so an answer
  // equal to the previous one is not a change.
  let reported: TerminalColours | null = null;
  const handlers = new Set<(colours: TerminalColours) => void>();
  const waiters = new Set<(colours: TerminalColours) => void>();

  const unsubscribe = renderer.subscribeOsc((sequence) => {
    const reply = parseColourReply(sequence);
    if (!reply) return;
    // A second reply for a colour already held starts a new round (an unsolicited change, such
    // as OpenTUI's re-query after `CSI ? 997 ; n n`): forget the other colour, so a pair is
    // never one new colour with one old one.
    if (reply.code === 10) {
      if (foreground !== null) background = null;
      foreground = reply.colour;
    } else {
      if (background !== null) foreground = null;
      background = reply.colour;
    }
    if (foreground === null || background === null) return;
    const next = { foreground, background };
    const changed = reported?.foreground !== next.foreground || reported?.background !== next.background;
    complete = next;
    if (changed) reported = next;
    for (const waiter of [...waiters]) waiter(next);
    if (changed) for (const handler of [...handlers]) handler(next);
  });

  return {
    colours: () => complete,
    query(timeoutMs = QUERY_TIMEOUT_MS) {
      foreground = null;
      background = null;
      complete = null;
      return new Promise<TerminalColours | null>((resolve) => {
        const done = (colours: TerminalColours | null) => {
          clearTimeout(timer);
          waiters.delete(done as (colours: TerminalColours) => void);
          resolve(colours);
        };
        const timer = setTimeout(() => done(null), timeoutMs);
        waiters.add(done as (colours: TerminalColours) => void);
        write(COLOUR_QUERY);
      });
    },
    onChange(handler) {
      handlers.add(handler);
      return () => void handlers.delete(handler);
    },
    dispose() {
      unsubscribe();
      handlers.clear();
      waiters.clear();
    },
  };
}

export interface ThemeColours {
  readonly tracker: ColourTracker;
  /**
   * Asks the terminal again and re-derives the surfaces from the answer (the caller then
   * requests a full repaint). Resolves with the colours, or null when the terminal did not
   * answer: that keeps the colours already in use, so only the start-up query falls back to flat.
   */
  refresh(timeoutMs?: number): Promise<TerminalColours | null>;
  dispose(): void;
}

/**
 * Connects the terminal's colours to the live theme: every complete, changed pair of replies
 * (ours or OpenTUI's own, such as after `CSI ? 997 ; n n`) re-derives the surfaces. Call
 * `refresh()` once before the first render for the start-up query.
 */
export function bindTerminalColours(
  renderer: Pick<CliRenderer, "subscribeOsc">,
  theme: LiveTheme,
  options: ColourTrackerOptions = {},
): ThemeColours {
  const tracker = createColourTracker(renderer, options);
  tracker.onChange((colours) => void theme.setTerminalColours(colours));
  return {
    tracker,
    async refresh(timeoutMs) {
      const colours = await tracker.query(timeoutMs);
      if (colours) theme.setTerminalColours(colours);
      return colours;
    },
    dispose: () => tracker.dispose(),
  };
}
