// The prompt box's cursor (day-two-feedback design D7; specs tui-layout "Prompt box cursor" and
// "The focused window can be told apart", tui-config "Prompt cursor setting", tui-screen "Terminal
// restored on every exit path"). Pure: the textarea's `cursorStyle` for a setting and a position,
// the DECSCUSR sequences, and the focus follower that writes the terminal's default shape while
// another window has focus.
//
// Why `block_at_end`: Marcus relies on the hollow outline PhpStorm and Zed draw for an unfocused
// block, and no terminal draws an unfocused bar differently (docs/mvp-notes/day-two-feedback-
// probes.md), so the block stays wherever the cursor rests at the end of the text, and a bar only
// shows inside it, where a block looked like a selected character. Where the terminal reports
// focus (Zed), the terminal's own default shape (`CSI 0 SP q`) is written on `CSI O`, which Zed
// draws hollow even for a bar; PhpStorm's engines report nothing, so there the block carries it.
import type { PROMPT_CURSORS } from "../config/schema.ts";
import { CURSOR_SHAPE_RESET } from "../renderer/lifecycle.ts";
import { columnOffset } from "./mentions.ts";

export type PromptCursor = (typeof PROMPT_CURSORS)[number];

/** The textarea's `cursorStyle` (OpenTUI's `CursorStyleOptions`, which this is assignable to). */
export interface PromptCursorStyle {
  readonly style: "block" | "line";
  readonly blinking: boolean;
}

/** The terminal's default cursor shape: DECSCUSR 0, as the final reset writes it. */
export const CURSOR_SHAPE_DEFAULT = CURSOR_SHAPE_RESET;

/** Whether the cursor is after the last character: `offset` is the textarea's (display columns,
 *  a newline one; `columnOffset`), so it is compared with the offset of the text's end. */
export function cursorAtEnd(text: string, offset: number): boolean {
  return offset >= columnOffset(text, text.length);
}

/** The shape a setting gives, blinking as OpenTUI's default cursor does (the block acp-tui drew
 *  before `prompt.cursor` existed). */
export function promptCursorStyle(setting: PromptCursor, atEnd: boolean): PromptCursorStyle {
  const block = setting === "block" || (setting === "block_at_end" && atEnd);
  return { style: block ? "block" : "line", blinking: true };
}

/** DECSCUSR for a style: 1 and 2 are a blinking and a steady block, 5 and 6 a bar. */
export function cursorShapeSequence(style: PromptCursorStyle): string {
  const base = style.style === "block" ? 1 : 5;
  return `\x1b[${base + (style.blinking ? 0 : 1)} q`;
}

export interface CursorFocusOptions {
  /** Terminal output (`rendererWrite`). */
  readonly write: (data: string) => void;
  /** The shape the prompt box's cursor has now, as DECSCUSR. */
  readonly shape: () => string;
  /** Whether the prompt box has keyboard focus. */
  readonly promptFocused: () => boolean;
}

export interface CursorFocus {
  /** The terminal reported `CSI O`: another window has focus. */
  blur(): void;
  /** The terminal reported `CSI I`. */
  focus(): void;
  /** The prompt box gained or lost keyboard focus. */
  promptFocusChanged(): void;
}

/**
 * Follows the terminal's focus reports (OpenTUI's `blur` and `focus`): on blur the terminal's
 * default shape, on focus the prompt box's own again, and nothing at all until the terminal has
 * reported once, so a terminal that never reports (PhpStorm) is left to the block's own
 * unfocused form. A focus report while the prompt box has no keyboard focus is kept until it
 * has (OpenTUI draws no cursor then, and the shape it last wrote is not rewritten).
 */
export function createCursorFocus(options: CursorFocusOptions): CursorFocus {
  // Set by the first report; true while the shape written is the terminal's default.
  let defaulted = false;
  let pending = false;
  const restore = (): void => {
    if (!options.promptFocused()) {
      pending = true;
      return;
    }
    pending = false;
    options.write(options.shape());
  };
  return {
    blur() {
      defaulted = true;
      pending = false;
      options.write(CURSOR_SHAPE_DEFAULT);
    },
    focus() {
      if (!defaulted) return;
      defaulted = false;
      restore();
    },
    promptFocusChanged() {
      if (pending && options.promptFocused()) restore();
    },
  };
}
