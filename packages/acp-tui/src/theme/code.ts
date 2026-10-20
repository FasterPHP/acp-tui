// Highlight scopes to the `code.*` tokens (mvp-rendering design decision 8, task 8.3; spec
// tui-theme "Code scope tokens").
//
// A tree-sitter capture such as `keyword.control.return` or `variable.builtin` resolves by its
// first segment that names a token (`keyword`, `variable`), so highlighting follows the
// terminal's palette like everything else. A few segments the bundled highlight queries use under
// older or different names are aliases (`boolean` is a constant, `float` a number, `field` a
// property, `conditional` a keyword, ...). A scope none of whose segments matches (`label`,
// `embedded`, `spell`, `none`) has no token: it neither colours its text nor overrides a
// broader capture over the same text, and text no capture colours is drawn in `code.default`,
// never in an explicit white (OpenTUI #1105).
//
// Variables: design decision 8 keeps them in the terminal's default foreground, and the spec's
// "PHP without the tag" wants `$x` in a token other than `code.default`. Both hold: a variable
// is drawn in `code.variable`, whose default value is the default foreground.
import type { TokenName } from "./tokens.ts";

/** Scope segments to the `code.*` token they are drawn in (a map: `constructor` is a segment). */
export const CODE_SCOPE_SEGMENTS: ReadonlyMap<string, TokenName> = new Map<string, TokenName>([
  ["keyword", "code.keyword"],
  ["conditional", "code.keyword"],
  ["repeat", "code.keyword"],
  ["exception", "code.keyword"],
  ["include", "code.keyword"],
  ["storageclass", "code.keyword"],
  ["string", "code.string"],
  ["character", "code.string"],
  ["comment", "code.comment"],
  ["number", "code.number"],
  ["float", "code.number"],
  ["constant", "code.constant"],
  ["boolean", "code.constant"],
  ["escape", "code.constant"],
  ["type", "code.type"],
  ["constructor", "code.type"],
  ["module", "code.type"],
  ["namespace", "code.type"],
  ["function", "code.function"],
  ["method", "code.function"],
  ["variable", "code.variable"],
  ["parameter", "code.variable"],
  ["property", "code.property"],
  ["field", "code.property"],
  ["operator", "code.operator"],
  ["punctuation", "code.punctuation"],
  ["tag", "code.tag"],
  ["attribute", "code.attribute"],
]);

/** The token a highlight scope is drawn in, by its first segment that names one; `null` when no
 *  segment does (the text keeps whatever a broader capture, or `code.default`, gives it). */
export function codeScopeToken(scope: string): TokenName | null {
  for (const segment of scope.split(".")) {
    const token = CODE_SCOPE_SEGMENTS.get(segment);
    if (token) return token;
  }
  return null;
}

/** The token a highlight scope is drawn in on its own: its segment's, else `code.default`. */
export function codeToken(scope: string): TokenName {
  return codeScopeToken(scope) ?? "code.default";
}
