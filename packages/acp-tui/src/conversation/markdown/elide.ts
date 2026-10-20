// Long bare URLs on one row in terminals that detect URLs by themselves (mvp-rendering task 14.5,
// review A1; spec tui-rendering "Links in every form"; docs/mvp-notes/rendering-research.md, C9).
// The JetBrains terminals run the IDE's URL patterns over each screen row on its own, so the
// first row of a URL wrapped over several rows is detected as a whole, cut-off URL, which the IDE
// opens on a plain click (src/links/detect.ts). Where the capability table says `detectsUrls`,
// a bare URL (an autolink, or bare `http(s)://` or `www.` text: a link whose label is its URL)
// too long for its row is drawn on one row without its scheme (and a leading `www.`) and, if it
// still does not fit, shortened in the middle with `…`: `example.com/a/very/long/…/and-a-fragment`.
// The terminal detects neither form, so the click is acp-tui's, which opens the full URL; the
// span projects the full URL, so copy, find and export hold it too (Marcus, 10 October 2026).
//
// The switch is process-wide, like the link base (links.ts): the app sets it once at start-up from
// the capability table, before anything is laid out; tests that lay out without it get the plain
// wrap. Heights follow, since the estimate and the drawing share the wrap (wrap.ts).
import { displayWidth } from "../../layout/segments.ts";
import { labelShowsTarget } from "./links.ts";

let elision = false;

/** Whether long bare URLs are drawn elided on one row (the terminal detects URLs itself). */
export function urlElision(): boolean {
  return elision;
}

/** Sets the switch (app/run.tsx, from the capability table's `detectsUrls`). */
export function setUrlElision(on: boolean): void {
  elision = on;
}

const BARE = /^(?:https?:\/\/|www\.)/i;

/** Whether `label` is a bare URL for the link `href`: `http(s)://` or `www.` text showing its own
 *  target (an autolink, a GFM bare URL or a link written with its URL as the label). */
export function isBareUrl(label: string, href: string): boolean {
  return BARE.test(label) && labelShowsTarget(label, href);
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Below this many columns a URL is not elided (nothing useful would be left of it). */
export const MIN_ELIDED_WIDTH = 8;

/**
 * `url` drawn within `width` columns: without its scheme and a leading `www.`, and, when that is
 * still wider, its start and end with `…` between (the end about a third of what is kept). Null
 * when `width` is below `MIN_ELIDED_WIDTH`.
 */
export function elideUrl(url: string, width: number): string | null {
  if (width < MIN_ELIDED_WIDTH) return null;
  const bare = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^www\./i, "");
  if (displayWidth(bare) <= width) return bare;
  const parts = Array.from(graphemes.segment(bare), (s) => s.segment);
  const keep = width - 1;
  const tailWidth = Math.floor(keep / 3);
  let head = "";
  let used = 0;
  for (const g of parts) {
    const w = displayWidth(g);
    if (used + w > keep - tailWidth) break;
    head += g;
    used += w;
  }
  let tail = "";
  let tailUsed = 0;
  for (let i = parts.length - 1; i >= 0; i--) {
    const w = displayWidth(parts[i]!);
    if (used + tailUsed + w > keep) break;
    tail = parts[i] + tail;
    tailUsed += w;
  }
  return `${head}…${tail}`;
}
