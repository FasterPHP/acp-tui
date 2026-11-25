// The prompt box cursor's colour, chosen from the terminal's replies (spec tui-layout "Prompt box
// cursor colour", "Terminal's own cursor colour", "Cursor hidden until its colour is known",
// "Cursor colour kept across reloads"; design D3 and D4). The colour tracker asks `OSC 10 ? OSC 11 ?
// OSC 12 ?`; this follows its queries and replies:
//
// - the choice is made when all three replies are in, or when the query's wait ends with whatever
//   arrived, so the cursor stays hidden (`ready()` false) until then and no colour is written
//   before the terminal's replies are known;
// - a re-query (Ctrl+L, SIGUSR2, the resize settle) chooses again from its replies; one that
//   brings no reply at all keeps the choice, as an unanswered theme refresh keeps the surfaces;
//   replies OpenTUI's own re-query provokes choose again as they arrive;
// - a configuration reload or a theme change does not touch it: no theme token feeds it.
//
// OpenTUI 0.6 writes `OSC 12;#rrggbb` for every visible cursor in the first frame that shows it and
// has no value for "the terminal's own colour". When the choice is `terminal`, `OSC 112` is written
// after the frame that follows each moment OpenTUI writes one: the prompt box gaining focus or
// mounting, a full repaint, and the choice itself changing (design D4).
import { CliRenderEvents, type CliRenderer } from "@opentui/core";
import { createSignal, type Accessor } from "solid-js";
import type { DebugLogger } from "../log.ts";
import { CURSOR_COLOUR_RESET } from "../renderer/lifecycle.ts";
import { onForcedRepaint } from "../renderer/repaint.ts";
import type { WriteOut } from "../renderer/write-out.ts";
import type { ColourTracker } from "../theme/terminal-colours.ts";
import { cursorColourFrom, type CursorColourChoice } from "./prompt-cursor.ts";


export interface CursorColour {
  /** True once the colour is chosen; the prompt box shows no cursor before. */
  ready: Accessor<boolean>;
  /** The choice, `terminal` to leave the terminal's own colour; `null` until ready. */
  choice: Accessor<CursorColourChoice | null>;
  /** The `#rrggbb` the textarea is given: the choice, or for `terminal` the reported foreground
   *  (else `undefined`: the caller's `text` token), the colour OpenTUI paints for an instant before `OSC 112`. */
  colour(): string | undefined;
  /** OpenTUI is about to write `OSC 12` (the prompt box mounted or gained focus): under `terminal`, `OSC 112` follows the next frame. */
  markDirty(): void;
  dispose(): void;
}

export interface CursorColourOptions {
  readonly tracker: ColourTracker;
  readonly renderer: CliRenderer;
  /** Terminal output (`rendererWrite`). */
  readonly write: WriteOut;
  readonly logger?: DebugLogger;
}

export function createCursorColour(options: CursorColourOptions): CursorColour {
  const { tracker, renderer, write, logger } = options;
  const [choice, setChoice] = createSignal<CursorColourChoice | null>(null);
  let querying = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;

  const choose = (final: boolean): void => {
    const replies = tracker.replies();
    const any = replies.foreground !== null || replies.background !== null || replies.cursor !== null;
    // A re-query nobody answered keeps what was chosen.
    if (final && !any && choice() !== null) return;
    const next = cursorColourFrom(replies);
    if (next === choice()) return;
    setChoice(next);
    dirty = true;
    logger?.log({ event: "cursor_colour", choice: next, ...replyFields(replies) });
  };
  const settle = (): void => {
    querying = false;
    clearTimeout(timer);
    choose(true);
  };

  const offQuery = tracker.onQuery((timeoutMs) => {
    querying = true;
    clearTimeout(timer);
    timer = setTimeout(settle, timeoutMs);
  });
  const offReply = tracker.onReply(() => {
    const r = tracker.replies();
    if (querying) {
      if (r.foreground !== null && r.background !== null && r.cursor !== null) settle();
    } else if (r.foreground !== null && r.background !== null) {
      choose(false);
    }
  });
  const onFrame = (): void => {
    if (!dirty) return;
    dirty = false;
    if (choice() === "terminal") write(CURSOR_COLOUR_RESET);
  };
  renderer.on(CliRenderEvents.FRAME, onFrame);
  const offRepaint = onForcedRepaint(renderer, () => (dirty = true));

  return {
    ready: () => choice() !== null,
    choice,
    colour() {
      const c = choice();
      if (c === null) return undefined;
      return c === "terminal" ? tracker.replies().foreground ?? undefined : c;
    },
    markDirty: () => void (dirty = true),
    dispose() {
      clearTimeout(timer);
      offQuery();
      offReply();
      offRepaint();
      renderer.off(CliRenderEvents.FRAME, onFrame);
    },
  };
}

function replyFields(r: { foreground: string | null; background: string | null; cursor: string | null }) {
  return { foreground: r.foreground, background: r.background, cursor: r.cursor };
}
