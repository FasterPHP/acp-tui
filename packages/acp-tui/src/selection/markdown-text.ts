// Agent Markdown as the plain text a user copies; design of record 6.3 "What
// is copied"; spec tui-rendering "Projection follows the rendered text".
//
// Design 6.3 says copy gives "text as rendered but without decoration", and
// `Y` gives the Markdown source. Since mvp-rendering draws agent Markdown with
// acp-tui's own renderers (conversation/markdown/), the projection is what
// those renderers draw, read without decoration: markers, escapes and tags
// gone, entities decoded, list bullets and task boxes as drawn, quote bars,
// rules and table borders left out, and every wrapped line rejoined as the
// source had it (conversation/markdown/project.ts). The selection's row maps
// (rows.ts) map the drawn cells onto it exactly.
import { LIVE_GLYPHS } from "../conversation/live-glyphs.ts";
import { projectMessage, type MessageProjection, type ProjectedKind } from "../conversation/markdown/project.ts";

/** What a projected block holds. */
export type MarkdownBlockKind = ProjectedKind;

/** The projection of an agent message's Markdown `source`. */
export function markdownProjection(source: string, cache = true): MessageProjection {
  return projectMessage(source, LIVE_GLYPHS, cache);
}

/** The projection's text alone. */
export function markdownPlain(source: string): string {
  return markdownProjection(source).text;
}
