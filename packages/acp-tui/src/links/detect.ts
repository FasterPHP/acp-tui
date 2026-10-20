// What a terminal that detects URLs by itself opens on a plain click (mvp-rendering task 14.5,
// review C9 option A; spec tui-rendering "Opening links"; docs/mvp-notes/rendering-research.md,
// C9). Both PhpStorm terminals (the capability `detectsUrls`) run the IDE's URL filter over each
// screen row on its own, open the text it matches on a plain click and still report the click to
// acp-tui. So, before acp-tui opens a link on a click, it runs the same patterns over the clicked
// row as drawn and opens nothing itself when the clicked cell lies inside a match: the terminal
// is opening that text, and one click opens one target.
//
// The patterns are JetBrains' `URLUtil.URL_PATTERN_OPTIMIZED` and `FILE_URL_PATTERN_OPTIMIZED`
// (intellij-community branch 262, `platform/util/src/com/intellij/util/io/URLUtil.java:50-52`),
// rewritten for JavaScript (`u` for `\p{L}`): case-sensitive, stopping at a space, a parenthesis
// (file URLs) or any character outside the class, such as `…`. To be rechecked when the IDE
// changes; if they drift, the fallback is a double open, as before this change.
//
// The row is read from the frame on screen (OpenTUI's current buffer), one string unit per cell,
// so a match's index is its column: a cell that holds a grapheme of its own (a wide character, an
// emoji) or the continuation of one becomes U+FFFC, which neither pattern matches.
import type { CliRenderer, OptimizedBuffer } from "@opentui/core";
import type { LinkTarget } from "../conversation/markdown/types.ts";

/** `URL_PATTERN_OPTIMIZED`: `mailto:`, `news://`, `http(s)://`, `ftp(s)://` and `www.` (not after a letter, digit, `_` or `.`). */
export const JETBRAINS_URL_PATTERN = /\b(?:mailto:|(?:news|(?:ht|f)tps?):\/\/|(?<![\p{L}0-9_.])www\.)[-A-Za-z0-9+$&@#/%?=~_|!:,.;]*[-A-Za-z0-9+$&@#/%=~_|]/gu;

/** `FILE_URL_PATTERN_OPTIMIZED`: `file:/...` or `file:C:...`. */
export const JETBRAINS_FILE_URL_PATTERN = /\bfile:(?:\/|[A-Za-z]:)[^\s()[\]]*[^\s()[\]:;?!,.]/gu;

/** A match of the terminal's patterns on a row: columns `[from, to)` and the text. */
export interface DetectedUrl {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

/** Every match of the two patterns in `row` (one string unit per cell), in column order. */
export function detectedUrls(row: string): DetectedUrl[] {
  const out: DetectedUrl[] = [];
  for (const pattern of [JETBRAINS_URL_PATTERN, JETBRAINS_FILE_URL_PATTERN]) {
    pattern.lastIndex = 0;
    for (const m of row.matchAll(pattern)) out.push({ from: m.index!, to: m.index! + m[0].length, text: m[0] });
  }
  return out.sort((a, b) => a.from - b.from);
}

/** The match that holds column `col` of `row`, or null. */
export function detectedUrlAt(row: string, col: number): DetectedUrl | null {
  return detectedUrls(row).find((m) => col >= m.from && col < m.to) ?? null;
}

// OpenTUI's char plane: a plain code point, or a grapheme reference with these high bits set (a
// wide character's first cell, and its continuation cells).
const GRAPHEME_BITS = 0x80000000;

/** Row `y` of `buffer` as one string unit per cell (empty cells as spaces, graphemes as U+FFFC).
 *  Read through `withBuffers()`: OpenTUI 0.6 gives the raw planes only to a post-process pass. */
export function bufferRow(buffer: OptimizedBuffer, y: number): string {
  const width = buffer.width;
  if (y < 0 || y >= buffer.height) return "";
  return buffer.withBuffers(({ char: chars }) => {
    let out = "";
    for (let x = 0; x < width; x++) {
      const code = chars[y * width + x]!;
      if (code === 0) out += " ";
      else if (code >= GRAPHEME_BITS || code > 0xffff) out += "￼";
      else out += String.fromCharCode(code);
    }
    return out;
  });
}

/** The match of the terminal's patterns under the screen cell (`x`, `y`) of the frame on screen. */
export function detectedUrlOnScreen(renderer: CliRenderer, x: number, y: number): DetectedUrl | null {
  return detectedUrlAt(bufferRow(renderer.currentRenderBuffer, y), x);
}

/** A URL without its scheme and a trailing `/`, for comparing what the terminal opens (`www.`
 *  text opens as `http://www.`) with a link's target. */
function comparable(url: string): string {
  return url.replace(/^(?:[a-z][a-z0-9+.-]*:)?(?:\/\/)?/i, "").replace(/\/$/, "");
}

/** Whether the text the terminal opens is the link's own target (a bare URL or autolink), or a
 *  label that differs from it (a deceptive label, a URL cut off at the row's end). */
export function opensTarget(detected: string, link: LinkTarget): boolean {
  return comparable(detected) === comparable(link.href) || comparable(detected) === comparable(link.url);
}
