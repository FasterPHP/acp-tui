// Emoji drawn as their names (mvp-rendering task 14.5, review C11; spec tui-rendering "Other
// extensions stay text"). An emoji or emoji sequence that a terminal draws in another number of
// cells than acp-tui lays out cuts or overdraws its neighbours, so where the capability table
// (renderer/capabilities.ts `emoji`) says a terminal mis-measures a class of sequence, the
// Markdown renderers draw the sequence as its CLDR short name in the long form, a shortcode such
// as `:family_man_woman_girl:`, in the `muted` token, and keep the sequence itself as the span's
// projection, so copy, find and export see the emoji. Pure: no OpenTUI.
//
// The classes (measured in the IDEs on 10 October 2026, docs/phase-1a-notes/mvp-rendering-ide.md):
//
// - `zwj`: ZWJ sequences (`👨‍👩‍👧`: JediTerm 8 cells, Zed 6, laid out 2).
// - `flag`: flags of regional indicators and the subdivision flags (`🇬🇧`: JediTerm 4, England 14).
// - `keycap`: keycaps (`1️⃣`: JediTerm 3, Zed 1).
// - `tone`: an emoji with skin tones (`👍🏽`: 4 in both).
// - `vs16`: a narrow base with variation selector 16 (`❤️`: Zed 1, so the next cell is overdrawn).
// - `bare`: what OpenTUI 0.5.12 itself counts differently from acp-tui's layout (Bun.stringWidth)
//   in every terminal: bare text-default symbols such as `❤` (OpenTUI 2, the layout and the
//   terminals 1), and the skin tones and unqualified forms on the six narrow bases such as `✌🏽`
//   (OpenTUI 1, the layout 2). The generated `OPENTUI_MISMEASURED` lists them exactly.
//
// Names come from the generated table (emoji-names.ts, scripts/build-emoji-names.ts): keyed by the
// sequence without U+FE0F, U+FE0E and skin tones, so the unqualified and minimally-qualified forms
// an agent may send find the name of the fully-qualified one, and a toned sequence finds its
// template. A sequence with no name (a ZWJ sequence outside Unicode's set) is drawn as it is.
import { EMOJI_NAMES, EMOJI_TONES, OPENTUI_MISMEASURED } from "./emoji-names.ts";

export const EMOJI_CLASSES = ["zwj", "flag", "keycap", "tone", "vs16", "bare"] as const;
export type EmojiClass = (typeof EMOJI_CLASSES)[number];

const MISMEASURED: ReadonlySet<string> = new Set(OPENTUI_MISMEASURED);

const ZWJ = 0x200d;
const VS15 = 0xfe0e;
const VS16 = 0xfe0f;
const KEYCAP = 0x20e3;
const BLACK_FLAG = 0x1f3f4;
const isTone = (cp: number) => cp >= 0x1f3fb && cp <= 0x1f3ff;
const isRegional = (cp: number) => cp >= 0x1f1e6 && cp <= 0x1f1ff;
const isTag = (cp: number) => cp >= 0xe0020 && cp <= 0xe007f;

/** The skin tones as name parts, in modifier order (U+1F3FB to U+1F3FF). */
const TONES = ["light_skin_tone", "medium_light_skin_tone", "medium_skin_tone", "medium_dark_skin_tone", "dark_skin_tone"] as const;

/** Whether `text` may hold an emoji at all (everything but ASCII may). */
export function mayHoldEmoji(text: string): boolean {
  return /[^\x00-\x7f]/.test(text);
}

function codePoints(grapheme: string): number[] {
  const out: number[] = [];
  for (const ch of grapheme) out.push(ch.codePointAt(0)!);
  return out;
}

/** The classes a grapheme belongs to (see the module header); empty for anything else. */
export function emojiClasses(grapheme: string): EmojiClass[] {
  const cps = codePoints(grapheme);
  const out: EmojiClass[] = [];
  if (cps.length === 0) return out;
  if (MISMEASURED.has(grapheme)) out.push("bare");
  if (cps.length === 1) return out;
  if (cps.includes(ZWJ)) out.push("zwj");
  if ((cps.length === 2 && isRegional(cps[0]!) && isRegional(cps[1]!)) || (cps[0] === BLACK_FLAG && cps.slice(1).every(isTag))) out.push("flag");
  if (cps.includes(KEYCAP)) out.push("keycap");
  if (cps.some(isTone)) out.push("tone");
  if (cps.length === 2 && cps[1] === VS16 && Bun.stringWidth(String.fromCodePoint(cps[0]!)) === 1) out.push("vs16");
  return out;
}

/** A grapheme's name without the colons (`family_man_woman_girl`), or null when the table has none. */
export function emojiName(grapheme: string): string | null {
  const cps = codePoints(grapheme);
  const key = String.fromCodePoint(...cps.filter((c) => c !== VS16 && c !== VS15 && !isTone(c)));
  const tones = cps.filter(isTone);
  if (tones.length === 0) return EMOJI_NAMES[key] ?? null;
  const template = EMOJI_TONES[key];
  if (template === undefined) return null;
  const pattern = template === "" ? `${EMOJI_NAMES[key]}_%` : template;
  const named = tones.every((t) => t === tones[0]) ? [tones[0]!] : tones;
  return pattern.replace("%", named.map((t) => TONES[t - 0x1f3fb]!).join("_"));
}

/** The shortcode a grapheme is drawn as where `named` holds one of its classes (`:red_heart:`),
 *  or null when it is drawn as it is. */
export function emojiSubstitute(grapheme: string, named: readonly EmojiClass[]): string | null {
  if (named.length === 0) return null;
  const classes = emojiClasses(grapheme);
  if (!classes.some((c) => named.includes(c))) return null;
  const name = emojiName(grapheme);
  return name === null ? null : `:${name}:`;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** A piece of text: as it is, or an emoji drawn as `name` (`source` the emoji). */
export type EmojiPiece = { readonly text: string; readonly source?: undefined } | { readonly text: string; readonly source: string };

/** `text` split where emoji are drawn as names under `named` (see `emojiSubstitute`); one piece
 *  when nothing is (the common case, without segmenting ASCII). */
export function splitEmoji(text: string, named: readonly EmojiClass[]): EmojiPiece[] {
  if (named.length === 0 || !mayHoldEmoji(text)) return [{ text }];
  const out: EmojiPiece[] = [];
  let plain = "";
  for (const { segment } of graphemes.segment(text)) {
    const name = segment.length > 1 || segment.charCodeAt(0) > 0x7f ? emojiSubstitute(segment, named) : null;
    if (name === null) {
      plain += segment;
      continue;
    }
    if (plain !== "") out.push({ text: plain });
    plain = "";
    out.push({ text: name, source: segment });
  }
  if (plain !== "" || out.length === 0) out.push({ text: plain });
  return out;
}
