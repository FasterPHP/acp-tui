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

/** What the terminal reported (`#rrggbb`), each `null`/absent when it did not answer. */
export interface CursorReplies {
  readonly foreground?: string | null;
  readonly background?: string | null;
  readonly cursor?: string | null;
}

/** The prompt box cursor's colour: a `#rrggbb`, or `terminal` to leave the terminal's own. */
export type CursorColourChoice = string | "terminal";

/** The non-text contrast threshold (WCAG 1.4.11): what a cursor needs against its background. */
export const CURSOR_CONTRAST = 3;

function channel(value: number): number {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  return 0.2126 * channel(parseInt(hex.slice(1, 3), 16)) + 0.7152 * channel(parseInt(hex.slice(3, 5), 16)) + 0.0722 * channel(parseInt(hex.slice(5, 7), 16));
}

/** The WCAG 2 contrast ratio of two `#rrggbb` colours. */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const isHex = (colour: string | null | undefined): colour is string => !!colour && /^#[0-9a-f]{6}$/i.test(colour);

/**
 * The cursor colour from the terminal's replies (spec tui-layout "Prompt box cursor colour", design
 * D3): the reported cursor colour if it reaches 3:1 against the background, else the reported
 * foreground if it does, else `terminal` (leave the terminal's own colour). With no background
 * nothing can be compared, so the cursor reply, else the foreground, else `terminal`.
 */
export function cursorColourFrom(replies: CursorReplies): CursorColourChoice {
  const cursor = isHex(replies.cursor) ? replies.cursor.toLowerCase() : null;
  const foreground = isHex(replies.foreground) ? replies.foreground.toLowerCase() : null;
  const background = isHex(replies.background) ? replies.background.toLowerCase() : null;
  if (!background) return cursor ?? foreground ?? "terminal";
  if (cursor && contrastRatio(cursor, background) >= CURSOR_CONTRAST) return cursor;
  if (foreground && contrastRatio(foreground, background) >= CURSOR_CONTRAST) return foreground;
  return "terminal";
}
