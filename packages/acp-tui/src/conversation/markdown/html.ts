// HTML in agent Markdown (spec tui-rendering "HTML in Markdown"; audit M09,
// M27). Tags are removed and their text kept; attributes are never read, so
// an `<a href>` gives its text only and an `<img>` nothing. A few tags map to
// styles: `<b>` and `<strong>` bold, `<i>` and `<em>` italic, `<del>` and
// `<s>` struck, `<kbd>` and `<code>` in the code token, `<br>` a hard break,
// `<sup>` and `<sub>` Unicode digits where every character has one, and
// `<summary>` a bold line. Comments are dropped.
//
// The tag state is shared by the inline renderer (marked gives an inline tag
// as its own `html` token between text tokens) and by HTML blocks, whose raw
// text this module splits into tags and text itself.
import { UNICODE_MARKDOWN_GLYPHS } from "../glyphs.ts";
import type { MarkdownGlyphs } from "./types.ts";

export interface Tag {
  readonly name: string;
  readonly closing: boolean;
}

/** A tag's name and whether it closes, or "comment" for a comment, declaration or processing
 *  instruction; null when `raw` is not a tag. Attributes are skipped unread. */
export function parseTag(raw: string): Tag | "comment" | null {
  if (raw.startsWith("<!") || raw.startsWith("<?")) return "comment";
  const m = /^<(\/?)([A-Za-z][A-Za-z0-9-]*)/.exec(raw);
  if (!m) return null;
  return { name: m[2]!.toLowerCase(), closing: m[1] === "/" };
}

/** Tags that end a line in an HTML block (and `br` anywhere). */
const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "br", "dd", "details", "div", "dl", "dt", "figcaption", "figure",
  "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section",
  "summary", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
]);

/** The open style tags, as counts (tags may nest or be left open). */
export interface HtmlState {
  bold: number;
  italic: number;
  strike: number;
  code: number;
  sup: number;
  sub: number;
  pre: number;
}

export function htmlState(): HtmlState {
  return { bold: 0, italic: 0, strike: 0, code: 0, sup: 0, sub: 0, pre: 0 };
}

const STYLE_OF: Readonly<Record<string, keyof HtmlState>> = {
  b: "bold",
  strong: "bold",
  summary: "bold",
  i: "italic",
  em: "italic",
  del: "strike",
  s: "strike",
  strike: "strike",
  kbd: "code",
  code: "code",
  sup: "sup",
  sub: "sub",
  pre: "pre",
};

/**
 * Applies a tag to the state; returns "break" when the tag ends a line: `<br>` anywhere, and in
 * an HTML block (`block`) every block-level tag.
 */
export function applyTag(state: HtmlState, tag: Tag, block: boolean): "break" | null {
  const style = STYLE_OF[tag.name];
  if (style) state[style] = Math.max(0, state[style] + (tag.closing ? -1 : 1));
  if (tag.name === "br") return "break";
  return block && BLOCK_TAGS.has(tag.name) ? "break" : null;
}

/** `text` as the glyph set's superscript or subscript digits when every character is a digit, else
 *  unchanged. */
export function scriptDigits(text: string, kind: "sup" | "sub", glyphs: MarkdownGlyphs = UNICODE_MARKDOWN_GLYPHS): string {
  if (!/^[0-9]+$/.test(text)) return text;
  const digits = kind === "sup" ? glyphs.superscriptDigits : glyphs.subscriptDigits;
  return text.replace(/[0-9]/g, (d) => digits[Number(d)]!);
}

/** An HTML block's raw text as tags, comments and text, in order. */
export function htmlParts(raw: string): ({ kind: "tag"; tag: Tag } | { kind: "text"; text: string })[] {
  const out: ({ kind: "tag"; tag: Tag } | { kind: "text"; text: string })[] = [];
  const re = /<!--[\s\S]*?(?:-->|$)|<![^>]*>?|<\?[\s\S]*?(?:\?>|$)|<\/?[A-Za-z][A-Za-z0-9-]*(?:[^>"']|"[^"]*"|'[^']*')*>/g;
  let last = 0;
  for (const m of raw.matchAll(re)) {
    if (m.index > last) out.push({ kind: "text", text: raw.slice(last, m.index) });
    last = m.index + m[0].length;
    const tag = parseTag(m[0]);
    if (tag && tag !== "comment") out.push({ kind: "tag", tag });
  }
  if (last < raw.length) out.push({ kind: "text", text: raw.slice(last) });
  return out;
}
