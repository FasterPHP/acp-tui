// The syntax style handed to OpenTUI's `<markdown>`, from theme tokens, for
// `SyntaxStyle.fromStyles(...)`.
//
// Agent prose is drawn by acp-tui's own renderers (conversation/markdown/, through
// `renderNode`), and code blocks are coloured by acp-tui's own highlighter with the
// `code.*` tokens (conversation/markdown/highlight.ts), so OpenTUI looks nothing up
// here for them. What remains is what its own fallback rendering would ask for when
// `renderNode` returns nothing (never, for a mounted message): `default`, which
// every unknown scope falls back to, and `conceal`.
//
// MarkdownRenderable falls back from a scope to its first segment and then to
// `default`; a missing style or a style without `fg` ends up as explicit white
// (OpenTUI #1105). So `default` is always set and every entry carries an explicit
// `fg`. Pass `fg: theme.color("text")` to the MarkdownRenderable as well: without
// it, list markers are still white.
import { TextAttributes, type StyleDefinitionInput } from "@opentui/core";
import type { ResolvedTheme } from "./resolve.ts";
import type { TokenName } from "./tokens.ts";

const SCOPES: Record<string, TokenName> = {
  default: "text",
  conceal: "muted",
};

export function markdownStyles(theme: ResolvedTheme): Record<string, StyleDefinitionInput> {
  const out: Record<string, StyleDefinitionInput> = {};
  for (const [scope, token] of Object.entries(SCOPES)) {
    const { fg, attributes } = theme.text(token);
    const has = (flag: number) => (attributes & flag) !== 0;
    out[scope] = {
      fg,
      bold: has(TextAttributes.BOLD),
      dim: has(TextAttributes.DIM),
      italic: has(TextAttributes.ITALIC),
      underline: has(TextAttributes.UNDERLINE),
    };
  }
  return out;
}
