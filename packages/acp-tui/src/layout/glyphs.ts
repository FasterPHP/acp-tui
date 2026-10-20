// The chrome's glyph types (mvp-chrome-and-keys design D2 and D3): the busy indicator in the
// prompt box's top border and the splash. The values are in the glyph registry
// (src/conversation/glyphs.ts, mvp-configuration design D9) as `busy.*` and `splash.*`, with the
// `unicode`, `ascii` and `nerd-font` sets. The busy track is the prompt box's own frame line, and
// the splash's wordmark is drawn in heavy box-drawing characters, none of them the permission
// card's frame; the set's permission marker is used by no other glyph. `DEFAULT_CHROME_GLYPHS`
// and `ASCII_CHROME_GLYPHS` are the fixed sets; `LIVE_CHROME_GLYPHS` (conversation/live-glyphs.ts) follows the configuration.
export { ASCII_CHROME_GLYPHS, DEFAULT_CHROME_GLYPHS } from "../conversation/glyphs.ts";

export interface ChromeGlyphs {
  /** The busy indicator: the track (the border's own line) and the segment that sweeps over it,
   *  one column each, and the half cells of a segment or gap that starts or ends mid-cell (the
   *  segment's leading and trailing cell, a gap's), each empty where the set has none, which makes
   *  the steps whole cells. */
  readonly busy: {
    readonly track: string;
    readonly segment: string;
    readonly segmentLead: string;
    readonly segmentTrail: string;
    readonly gapLead: string;
    readonly gapTrail: string;
  };
  /** The splash: the wordmark's rows, in box-drawing characters and never block elements (seams in
   *  PhpStorm reworked, design 6.1), and the graphic's arrow, separator and the `more` that ends its
   *  list of agents (mvp-chrome-and-keys task 12.3). */
  readonly splash: { readonly wordmark: readonly string[]; readonly arrow: string; readonly separator: string; readonly more: string };
}
