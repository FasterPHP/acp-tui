// Lexing agent Markdown exactly as OpenTUI lexes `<markdown>` content.
import { Lexer, type Token, type TokensList } from "marked";

/**
 * The options OpenTUI 0.5.12 lexes `<markdown>` content with: `parseMarkdownIncremental` in
 * @opentui/core's `index.bun.js` calls its bundled marked as `lex(content, { gfm: true })`. The
 * drawing and the estimate must lex alike, so acp-tui pins the same marked version (checked by
 * test/conversation/markdown/marked-version.test.ts) and these options.
 */
export const LEX_OPTIONS = { gfm: true } as const;

// marked stores its tokenizer on the options object it is given, so each call gets a fresh copy,
// as OpenTUI's literal does.

/** Lexes Markdown blocks as OpenTUI does. `breaks`: a single newline in a paragraph is a hard
 *  break (tool output, whose lines are not prose). */
export function lexMarkdown(source: string, breaks = false): TokensList {
  return Lexer.lex(source, breaks ? { ...LEX_OPTIONS, breaks: true } : { ...LEX_OPTIONS });
}

/** Lexes inline Markdown (a footnote definition's text) with the same options. */
export function lexInline(source: string): Token[] {
  return Lexer.lexInline(source, { ...LEX_OPTIONS });
}
