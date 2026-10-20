// Emoji the terminal cannot draw at the width acp-tui lays out, as spans (mvp-rendering task 14.5,
// review C11; spec tui-rendering "Other extensions stay text"): where the flags' `emoji` classes
// (context.ts, from the capability table) hold the class of a sequence, it is drawn as its name
// (render/emoji/emoji.ts), `:family_man_woman_girl:`, in the `muted` token (which follows the
// theme's muted-on-light rule), with the emoji as the span's projection, so copy, find and export
// hold the emoji. The span is `named`: it wraps as one word, and is broken at the width only when
// it is longer than a row (wrap.ts, code.ts), the pieces after the first projecting nothing.
//
// Used by the renderers that draw text (inline.ts for prose, inline code, headings, list items,
// quotes and table cells; code.ts for code blocks; the expanded card's title in card.ts). Widths
// and wrapping read the drawn name, so the height estimate and the screen agree.
import { splitEmoji, type EmojiClass } from "../../render/emoji/emoji.ts";
import type { Span, SpanStyle } from "./types.ts";

/** The token a name is drawn in. */
export const EMOJI_NAME_TOKEN = "muted" as const;

/** A name span for `source` drawn as `name` in `style` (its token replaced by `muted`). */
export function nameSpan(name: string, source: string, style: SpanStyle): Span {
  return { ...style, token: EMOJI_NAME_TOKEN, text: name, projection: source, named: true };
}

/** `text` in `style` as spans: one span when nothing in it is drawn as a name under `named`. */
export function emojiSpans(text: string, style: SpanStyle, named: readonly EmojiClass[]): Span[] {
  const pieces = splitEmoji(text, named);
  if (pieces.length === 1 && pieces[0]!.source === undefined) return [{ ...style, text }];
  return pieces.map((p) => (p.source === undefined ? { ...style, text: p.text } : nameSpan(p.text, p.source, style)));
}
