// Styled segments and display-width helpers for the layout engine (design D6).
// A bar module returns segments; the engine measures them in terminal columns,
// East Asian wide characters counting two. Bun's built-in `stringWidth` is the
// same function OpenTUI 0.5.12 uses internally (its own `stringWidth` is not
// part of the public exports).
import type { Platform } from "../platform/paths.ts";
import type { TokenName } from "../theme/index.ts";

export interface Segment {
  text: string;
  token: TokenName;
  /** Truncation may cut the row cleanly before this segment (for example between key hints). */
  breakBefore?: boolean;
  /** A surface token drawn behind the text, except under the flat theme (the config option
   *  pills' values on `surface.card`). */
  fill?: TokenName;
}

export const ELLIPSIS = "…";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function displayWidth(text: string): number {
  return Bun.stringWidth(text);
}

export function segmentsWidth(segments: readonly Segment[]): number {
  let w = 0;
  for (const s of segments) w += displayWidth(s.text);
  return w;
}

/** The longest prefix of `text` that fits in `width` columns, never splitting a grapheme. */
export function takeWidth(text: string, width: number): string {
  if (width <= 0) return "";
  if (displayWidth(text) <= width) return text;
  let out = "";
  let used = 0;
  for (const { segment } of graphemes.segment(text)) {
    const w = displayWidth(segment);
    if (used + w > width) break;
    out += segment;
    used += w;
  }
  return out;
}

/** The longest suffix of `text` that fits in `width` columns. */
function takeWidthFromEnd(text: string, width: number): string {
  if (width <= 0) return "";
  const parts = Array.from(graphemes.segment(text), (g) => g.segment);
  let out = "";
  let used = 0;
  for (let i = parts.length - 1; i >= 0; i--) {
    const w = displayWidth(parts[i]!);
    if (used + w > width) break;
    out = parts[i]! + out;
    used += w;
  }
  return out;
}

/** Truncates the end of `text` to `width` columns, marking the cut with an ellipsis. */
export function truncateEnd(text: string, width: number): string {
  if (displayWidth(text) <= width) return text;
  if (width <= 0) return "";
  return takeWidth(text, width - 1) + ELLIPSIS;
}

/** Truncates the middle of `text` to `width` columns (paths keep both ends). */
export function truncateMiddle(text: string, width: number): string {
  if (displayWidth(text) <= width) return text;
  if (width <= 1) return takeWidth(ELLIPSIS, width);
  const room = width - 1;
  const head = takeWidth(text, Math.floor(room / 2));
  const tail = takeWidthFromEnd(text, room - displayWidth(head));
  return head + ELLIPSIS + tail;
}

/**
 * Fits segments into `width` columns: cuts at the last `breakBefore` boundary
 * that fits if there is one, otherwise truncates the text with an ellipsis.
 */
export function fitSegments(segments: readonly Segment[], width: number): Segment[] {
  if (segmentsWidth(segments) <= width) return [...segments];
  if (width <= 0) return [];
  let used = 0;
  let lastBreak = -1;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!;
    if (i > 0 && s.breakBefore) lastBreak = i;
    const w = displayWidth(s.text);
    if (used + w > width) break;
    used += w;
  }
  if (lastBreak > 0) {
    const kept = segments.slice(0, lastBreak);
    // Drop trailing blank separators left by the cut.
    while (kept.length > 0 && kept[kept.length - 1]!.text.trim() === "") kept.pop();
    if (segmentsWidth(kept) <= width) return kept;
  }
  const out: Segment[] = [];
  let left = width;
  for (const s of segments) {
    const w = displayWidth(s.text);
    // Strictly less, so at least one column remains for the ellipsis.
    if (w < left) {
      out.push(s);
      left -= w;
      continue;
    }
    out.push({ ...s, text: takeWidth(s.text, left - 1) + ELLIPSIS });
    break;
  }
  return out;
}

/** Replaces a leading home directory with `~` (the status row's `cwd` module, the session list,
 *  the session directory notice). On Windows the home directory matches whichever separator the
 *  path uses and whatever its case, as the file system does; the rest of the path is kept as written. */
export function shortenHome(path: string, home: string | null, platform: Platform = process.platform): string {
  if (!home) return path;
  if (platform === "win32") {
    const h = home.replace(/[\\/]+$/, "");
    // A root (`C:\`) is not a home directory worth abbreviating, as `/` is not.
    if (h === "" || /^[A-Za-z]:$/.test(h)) return path;
    const key = (text: string) => text.replace(/\//g, "\\").toUpperCase();
    const head = path.slice(0, h.length);
    if (key(head) !== key(h) || head.length !== h.length) return path;
    const next = path.charAt(h.length);
    return next === "" ? "~" : next === "\\" || next === "/" ? `~${path.slice(h.length)}` : path;
  }
  if (home === "/") return path;
  const h = home.endsWith("/") ? home.slice(0, -1) : home;
  if (path === h) return "~";
  if (path.startsWith(`${h}/`)) return `~${path.slice(h.length)}`;
  return path;
}
