// The row model of rendered Markdown (mvp-rendering design decision 1).
//
// Every block renderer is a pure function from a marked token and a width to
// rows of styled spans. The same rows are drawn (draw.ts), counted for the
// height estimate (layout.ts, `window/heights.ts`) and read for the plain-text
// projection and its cell maps (project.ts), so the three agree by
// construction.
//
// A span carries theme token NAMES and attribute flags, never a colour; the
// drawing resolves them through the theme. What later work hangs on a span:
//
// - `link`: an allowed target (links.ts): opened on a click or `openLink`
//   (src/links/), and carried as OSC 8 where the terminal is verified (draw.ts), on the
//   label's spans only (the `hint` after it is not); a refused target puts no `link` on its spans (tasks 6.1 to 6.4).
// - `strike`: `~~` text; the capability table decides SGR 9 or U+0336 on top
//   of the `markdown.strike` token (task 7.2). Overlay characters are added
//   only when drawing, never to `text`, so they never reach the projection.
// - `fill`: a background surface (code blocks on `surface.code`, task 8.4).
// - `flatText`: what is drawn instead of `text` under the flat theme, at the
//   same width (a code block's left rule, which stands in for its fill).
// - `code`: code a highlighter may recolour (code.ts, highlight.ts): the
//   block's source and where the span's text starts in it.
// - `projection`: what copy, find and export hold for the span when it is not
//   the drawn text: `""` for decoration (bars, borders, rules, indents of
//   wrapped rows), or another text (a link drawn `label (host)` projected
//   `label (target)`, task 6.1), or the emoji drawn as its name (`named`, task 14.5).
//
// A row may also carry a `fill` from the end of its spans to the full width
// and a right-aligned `label` (a code block's language), both drawn by
// draw.ts and never projected; the spans carry their own fills, so a
// container's prefix (a quote bar, a list indent) stays off the fill.
import type { TokenName } from "../../theme/index.ts";

/**
 * A link's target as written by the agent (placeholders restored). Only targets the link rules
 * allow (links.ts `classifyTarget`) are put on a span, with the verdict's fields.
 */
export interface LinkTarget {
  readonly href: string;
  /** The opener's single argument: a URL, or an absolute path inside the working directory. */
  readonly open: string;
  /** The URL OSC 8 carries (built by acp-tui). */
  readonly url: string;
  readonly kind: "web" | "mail" | "file";
  /** The host, mail address or path as written: shown after a differing label, named by the toast. */
  readonly shown: string;
}

/** Attribute flags added to the token's own attributes. */
export interface SpanStyle {
  readonly token: TokenName;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly dim?: boolean;
  /** Struck text (`~~`); drawn per terminal by the capability table (task 7.2). */
  readonly strike?: boolean;
  readonly link?: LinkTarget;
  /** The host (or address, or path) shown after a differing label: clickable for acp-tui like
   *  the label, but never inside the OSC 8 span, so a terminal underlines the label only. */
  readonly hint?: boolean;
  /** A background surface token behind this span. */
  readonly fill?: TokenName;
}

/** A code block's source, shared by the spans of its code: what the highlighter is given. */
export interface CodeSource {
  /** OpenTUI's filetype of a bundled grammar (highlight.ts `codeFiletype`). */
  readonly filetype: string;
  /** The code as the agent wrote it, without the final newline. */
  readonly text: string;
}

/** Where a span's text stands in its code block's source (UTF-16 offset). */
export interface CodeRef {
  readonly source: CodeSource;
  readonly at: number;
}

/** A run of text in one style on one row; `text` never holds a newline. */
export interface Span extends SpanStyle {
  readonly text: string;
  /** The projection's text for this span when it differs from `text`; `""` for decoration. */
  readonly projection?: string;
  /**
   * Where `text` stands in its block's projection, for a block whose projection is not its rows
   * read in order (a table: a record layout repeats and reorders its cells). The span's
   * characters map one to one from there.
   */
  readonly at?: number;
  /** Drawn instead of `text` under the flat theme; the same display width (a code block's rule). */
  readonly flatText?: string;
  /** Highlightable code: the span's text is `code.source.text` from `code.at` on. */
  readonly code?: CodeRef;
  /**
   * An emoji drawn as its name (emoji.ts; task 14.5): `text` is the name, `projection` the emoji
   * (`""` on the pieces after the first of a name broken at the width). Wrapped as one word, and
   * broken like a word only when it is longer than a row.
   */
  readonly named?: boolean;
}

export interface Row {
  readonly spans: readonly Span[];
  /**
   * What the projection puts between this row and the row above it: a newline (the default),
   * or, for a row a word wrap started, the spaces the wrap consumed (`""` for a word broken at
   * the width). Ignored on a block's first projected row.
   */
  readonly joined?: string;
  /** A background surface from the end of the spans to the whole width, and behind the label
   *  (code blocks); the spans carry their own. */
  readonly fill?: TokenName;
  /** Drawn right-aligned in the row (a code block's language label); never projected. */
  readonly label?: Span;
  /** Columns of the row's fill drawn after the label (a code block's right padding, so its label
   *  keeps the inset its code keeps); 0 when absent. */
  readonly labelInset?: number;
  /** A row of decoration only (a rule, a table border), left out of the projection. */
  readonly decorative?: boolean;
}

/** The glyphs Markdown is drawn with (`conversation/glyphs.ts` holds the sets). */
export interface MarkdownGlyphs {
  /** Unordered list markers by nesting depth, repeating. */
  readonly bullets: readonly string[];
  readonly taskDone: string;
  readonly taskOpen: string;
  /** A level 1 heading's rule. */
  readonly ruleHeavy: string;
  /** A level 2 heading's rule, thematic breaks and the footnote rule. */
  readonly ruleLight: string;
  readonly quoteBar: string;
  /** A code block's left rule under the flat theme, in place of its fill. */
  readonly codeRule: string;
  /** Drawn in the last column of a code row whose line goes on in the next row. */
  readonly codeContinuation: string;
  /** The digits `0` to `9` of a footnote's number, between `footnoteOpen` and `footnoteClose`. */
  readonly footnoteDigits: readonly string[];
  readonly footnoteOpen: string;
  readonly footnoteClose: string;
  /** The digits `0` to `9` of `<sup>` and `<sub>` text. */
  readonly superscriptDigits: readonly string[];
  readonly subscriptDigits: readonly string[];
  readonly table: {
    readonly topLeft: string;
    readonly topRight: string;
    readonly bottomLeft: string;
    readonly bottomRight: string;
    readonly horizontal: string;
    readonly vertical: string;
    /** Where a column rule meets the top border. */
    readonly topTee: string;
    /** Where a column rule meets the bottom border. */
    readonly bottomTee: string;
    /** Where the header rule meets the left border. */
    readonly leftTee: string;
    /** Where the header rule meets the right border. */
    readonly rightTee: string;
    readonly cross: string;
  };
}

/** Plain text of a row as drawn (no label, no fill padding). */
export function rowText(row: Row): string {
  let out = "";
  for (const s of row.spans) out += s.text;
  return out;
}

/** The plain-text projection of rows read in order: decorative rows left out, wrapped rows
 *  joined by what their wrap consumed. */
export function projectRows(rows: readonly Row[]): string {
  let out = "";
  let first = true;
  for (const row of rows) {
    if (row.decorative) continue;
    if (!first) out += row.joined ?? "\n";
    for (const s of row.spans) out += s.projection ?? s.text;
    first = false;
  }
  return out;
}
