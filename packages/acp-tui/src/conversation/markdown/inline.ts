// The inline renderer (mvp-rendering task 4.2; spec tui-rendering "Inline
// text"): marked's inline tokens to lines of styled spans, a new line at each
// hard break. Wrapping is the block renderer's business (wrap.ts).
//
// - Emphasis and strong add italic and bold to whatever token the text is in,
//   so they nest (`***x***` is both).
// - Inline code is in `markdown.code`; marked has already stripped one space
//   of padding each side (CommonMark), and its text is never entity-decoded.
// - Escapes are drawn without the backslash; entities are decoded
//   (entities.ts), `&nbsp;` as a space that keeps its words together.
// - A soft break is a space, so a paragraph is re-wrapped to the pane; a hard
//   break (two trailing spaces, a backslash, `<br>`) starts a new line.
// - Only `~~` strikes; marked also strikes `~x~`, which is drawn literally.
// - Inline HTML: html.ts.
// - Pre-pass placeholders (prepass.ts) in text: literals become the agent's
//   character again; maths and footnote references go through `mathLines`
//   and `footnoteRef`, the hooks tasks 7.3 and 7.5 replace.
// - Emoji the terminal draws at another width than the layout are drawn as
//   their names, muted, projected as the emoji (emoji.ts, task 14.5), in text
//   and inline code alike.
import type { Token, Tokens } from "marked";
import type { TokenName } from "../../theme/index.ts";
import type { MarkdownContext } from "./context.ts";
import { emojiSpans } from "./emoji.ts";
import { decodeEntities } from "./entities.ts";
import { footnoteNumber, superscriptNumber } from "./footnotes.ts";
import { applyTag, htmlState, parseTag, scriptDigits, type HtmlState } from "./html.ts";
import { classifyTarget, labelShowsTarget, linkBase, refusedShown } from "./links.ts";
import { restoreSource, splitPlaceholders, type FootnoteRef, type MathSpan } from "./prepass.ts";
import type { LinkTarget, Span, SpanStyle } from "./types.ts";
import { decoration, mergeSpans, type Line } from "./wrap.ts";
import { convertMath } from "../../render/math/convert.ts";

/** The token struck text is drawn in (task 7.2 adds SGR 9 or U+0336 per terminal). */
export const STRIKE_TOKEN: TokenName = "markdown.strike";

/** Columns a tab takes in prose (code blocks expand tabs to stops, code.ts). */
export const PROSE_TAB_COLUMNS = 2;

/** Adds `text`, each tab drawn `PROSE_TAB_COLUMNS` wide (as OpenTUI drew it) and copied as a tab,
 *  and each emoji the terminal mis-measures drawn as its name (emoji.ts, task 14.5). */
function addTabbed(out: LineBuilder, text: string, style: SpanStyle, ctx: MarkdownContext): void {
  text.split("\t").forEach((piece, i) => {
    if (i > 0) out.add({ ...style, text: " ".repeat(PROSE_TAB_COLUMNS), projection: "\t" });
    for (const span of emojiSpans(piece, style, ctx.flags.emoji)) out.add(span);
  });
}

/** Collects spans into lines. */
export class LineBuilder {
  private readonly lines: Span[][] = [[]];

  private pendingBreak = false;

  add(span: Span): void {
    if (this.collapse && span.projection === undefined && span.text.startsWith(" ")) span = { ...span, text: span.text.slice(1) };
    if (span.text === "" && span.projection === undefined) return;
    this.collapse = false;
    if (this.pendingBreak) {
      this.pendingBreak = false;
      this.lines.push([]);
    }
    this.lines[this.lines.length - 1]!.push(span);
  }

  /** Ends the current line (a hard break). */
  break(): void {
    this.pendingBreak = false;
    this.lines.push([]);
  }

  /** Ends the current line if anything follows it (after block maths). */
  breakBeforeNext(): void {
    this.pendingBreak = !this.atLineStart;
  }

  /** Whether the current line is still empty. */
  get atLineStart(): boolean {
    return this.lines[this.lines.length - 1]!.length === 0;
  }

  /** After a dropped comment between two spaces (`a <!-- c --> b`), the next space is dropped,
   *  so the words keep one space between them. */
  collapseNextSpace(): void {
    const line = this.lines[this.lines.length - 1]!;
    const last = line[line.length - 1];
    if (!last || !last.text.endsWith(" ")) return;
    this.collapse = true;
  }

  private collapse = false;

  done(): Line[] {
    return this.lines.map(mergeSpans);
  }
}

/** Columns block maths is indented by (decoration, never projected). */
export const MATH_INDENT = 2;

/**
 * Maths from the pre-pass, as lines (display maths on lines of its own, indented): converted to
 * Unicode in `markdown.math` (render/math/convert.ts, task 7.5), its fragments falling back to
 * their LaTeX form; a span the converter cannot take is shown as written, delimiters included, in
 * `markdown.code`, so nothing is lost.
 */
export function mathLines(math: MathSpan, style: SpanStyle): Span[][] {
  const indent = math.display ? [decoration(" ".repeat(MATH_INDENT), { token: "muted" })] : [];
  const converted = convertMath(math.tex);
  const token: TokenName = converted === null ? "markdown.code" : "markdown.math";
  return (converted ?? math.raw).split("\n").map((text) => [...indent, { ...style, token, text }]);
}

/** A footnote reference from the pre-pass (task 7.3, footnotes.ts): its number in superscript
 *  digits in `markdown.link` when its label has a definition, else as written. */
export function footnoteRef(ref: FootnoteRef, style: SpanStyle, ctx: MarkdownContext): Span[] {
  const n = footnoteNumber(ref.key, ctx);
  if (n === null) return [{ ...style, text: ref.raw }];
  return [{ ...style, token: "markdown.link", text: superscriptNumber(n, ctx.glyphs) }];
}

/** Text from a text token: soft breaks as spaces, entities decoded, placeholders substituted. */
export function textSpans(out: LineBuilder, text: string, style: SpanStyle, ctx: MarkdownContext, html?: HtmlState): void {
  // A soft break is a space, except before a line that starts with `: ` (a definition list's
  // definition, drawn as written on a row of its own).
  text.split(/[ \t]*\n[ \t]*/).forEach((line, i) => {
    if (i > 0) {
      if (line.startsWith(": ")) out.break();
      else out.add({ ...style, text: " " });
    }
    lineSpans(out, line, style, ctx, html);
  });
}

/** One source line of text (see `textSpans`). */
function lineSpans(out: LineBuilder, soft: string, style: SpanStyle, ctx: MarkdownContext, html?: HtmlState): void {
  for (const part of splitPlaceholders(soft, ctx.prepared)) {
    if (typeof part === "string") {
      let decoded = decodeEntities(part);
      if (html && html.sup > 0) decoded = scriptDigits(decoded, "sup", ctx.glyphs);
      else if (html && html.sub > 0) decoded = scriptDigits(decoded, "sub", ctx.glyphs);
      addTabbed(out, decoded, style, ctx);
    } else if (part.kind === "literal") {
      out.add({ ...style, text: part.char });
    } else if (part.kind === "math") {
      const lines = mathLines(part.span, style);
      if (part.span.display && !out.atLineStart) out.break();
      lines.forEach((line, i) => {
        if (i > 0) out.break();
        for (const s of line) out.add(s);
      });
      if (part.span.display) out.breakBeforeNext();
    } else if (part.kind === "footnote") {
      for (const s of footnoteRef(part.ref, style, ctx)) out.add(s);
    }
  }
}

/** The style an inline HTML state adds to `style`. */
function withHtml(style: SpanStyle, html: HtmlState): SpanStyle {
  let s = style;
  if (html.bold > 0) s = { ...s, bold: true };
  if (html.italic > 0) s = { ...s, italic: true };
  if (html.strike > 0) s = { ...s, strike: true, token: s.token === "markdown.code" ? s.token : STRIKE_TOKEN };
  if (html.code > 0) s = { ...s, token: "markdown.code" };
  return s;
}

/** Renders inline tokens into `out` (see the module header). */
export function renderInline(out: LineBuilder, tokens: readonly Token[] | undefined, style: SpanStyle, ctx: MarkdownContext, html: HtmlState = htmlState()): void {
  for (const token of tokens ?? []) {
    const here = withHtml(style, html);
    switch (token.type) {
      case "text": {
        const t = token as Tokens.Text;
        if (t.tokens && t.tokens.length > 0) renderInline(out, t.tokens, style, ctx, html);
        else textSpans(out, t.text, here, ctx, html);
        break;
      }
      case "escape":
        out.add({ ...here, text: (token as Tokens.Escape).text });
        break;
      case "strong":
        renderInline(out, (token as Tokens.Strong).tokens, { ...style, bold: true }, ctx, html);
        break;
      case "em":
        renderInline(out, (token as Tokens.Em).tokens, { ...style, italic: true }, ctx, html);
        break;
      case "del": {
        const del = token as Tokens.Del;
        if (del.raw.startsWith("~~")) {
          renderInline(out, del.tokens, { ...style, strike: true, token: STRIKE_TOKEN }, ctx, html);
        } else {
          // A single tilde stays literal (M29's `H~2~O`).
          out.add({ ...here, text: "~" });
          renderInline(out, del.tokens, style, ctx, html);
          out.add({ ...here, text: "~" });
        }
        break;
      }
      case "codespan":
        addTabbed(out, restoreSource((token as Tokens.Codespan).text, ctx.prepared), { ...here, token: "markdown.code" }, ctx);
        break;
      case "br":
        out.break();
        break;
      case "link":
        renderLink(out, token as Tokens.Link, here, ctx, html);
        break;
      case "image": {
        const image = token as Tokens.Image;
        const alt = restoreSource(image.text, ctx.prepared).trim();
        const text = alt === "" ? "[image]" : `[image: ${alt}]`;
        // Under the link rules like any link (allowed: no host after it, spec "Reference image").
        const href = restoreSource(image.href, ctx.prepared);
        const target = linkTarget(href);
        if (target) out.add({ ...here, token: "markdown.link", link: target, text });
        else {
          out.add({ ...here, text });
          addRefusedTarget(out, href, here);
        }
        break;
      }
      case "html": {
        const tag = parseTag((token as Tokens.HTML).text.trim());
        // Comments and unknown tags are dropped; the text between tags is kept.
        if (tag && tag !== "comment" && applyTag(html, tag, false) === "break") out.break();
        else if (tag === "comment") out.collapseNextSpace();
        break;
      }
      case "checkbox":
        // Drawn by the list renderer in place of the bullet.
        break;
      default:
        if ("text" in token && typeof token.text === "string") textSpans(out, token.text, here, ctx, html);
        else out.add({ ...here, text: token.raw });
    }
  }
}

/** The span target for `href` when the link rules allow it (links.ts), else null. */
function linkTarget(href: string): LinkTarget | null {
  const verdict = classifyTarget(href, linkBase());
  return verdict.allowed ? { href, open: verdict.open, url: verdict.url, kind: verdict.kind, shown: verdict.shown } : null;
}

/** ` (target)` after the label of a refused link, muted and never linked. */
function addRefusedTarget(out: LineBuilder, href: string, style: SpanStyle): void {
  out.add({ ...style, text: " " });
  out.add({ token: "muted", text: `(${refusedShown(href)})` });
}

/**
 * A link (spec tui-rendering "Links in every form", "Link target safety"; tasks 6.1 and 6.2).
 * Every form reaches here: inline, reference, collapsed and shortcut links, autolinks, and
 * marked's GFM bare URLs, `www.` addresses and email addresses. The title is never shown.
 *
 * - Allowed (links.ts): the label in `markdown.link`, every span carrying the target, so a
 *   wrapped link is one link on every row. When the label is not the target, the host (the mail
 *   address, the path as written) follows in parentheses, muted and clickable too (but outside
 *   the OSC 8 span, so the terminal draws only the label as a link), against
 *   deceptive labels; it is projected as the full target (`docs (https://example.com/a)`, spec
 *   "Projection follows the rendered text"), and never broken across rows.
 * - Refused: the label as plain text, then the target as written, muted, in parentheses (unless
 *   the label already is the target), with no `link`: never opened, never OSC 8.
 */
export function renderLink(out: LineBuilder, link: Tokens.Link, style: SpanStyle, ctx: MarkdownContext, html: HtmlState): void {
  const href = restoreSource(link.href, ctx.prepared);
  const label = restoreSource(link.text, ctx.prepared);
  const target = linkTarget(href);
  if (!target) {
    renderInline(out, link.tokens, style, ctx, html);
    if (label.trim() !== href) addRefusedTarget(out, href, style);
    return;
  }
  renderInline(out, link.tokens, { ...style, token: "markdown.link", link: target }, ctx, html);
  if (labelShowsTarget(label, href)) return;
  const shown = `(${target.shown})`;
  const full = `(${href})`;
  out.add({ ...style, text: " " });
  out.add(shown === full ? { token: "muted", link: target, hint: true, text: shown } : { token: "muted", link: target, hint: true, text: shown, projection: full });
}

/** Inline tokens as lines in `style`. */
export function inlineLines(tokens: readonly Token[] | undefined, style: SpanStyle, ctx: MarkdownContext): Line[] {
  const out = new LineBuilder();
  renderInline(out, tokens, style, ctx);
  return out.done();
}
