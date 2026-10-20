// File mentions in the prompt box (mvp-chrome-and-keys design D9, spec
// tui-palette "File mentions are sent as resource links"). Pure, so it is
// unit-tested without a renderer.
//
// A mention is a range of the draft, `@<path as shown>`, tracked across edits:
// an edit before it moves it, an edit after it leaves it alone, and an edit
// that touches its inside turns it back into plain text (it is dropped). Text
// typed directly after or before a mention is outside it. On send the draft is
// one text block, as typed, followed by one `resource_link` per intact mention
// in the order they appear: its `file://` URI, the relative path as `name`, and
// the size when known; the file's content is never read.
//
// Offsets here are UTF-16 indices into the draft's `plainText`. The textarea
// counts its cursor in display columns (a wide character two, a newline one):
// `columnOffset` and `indexAtColumn` convert.
//
// The columns are `Bun.stringWidth` per grapheme, not OpenTUI's own
// `measureEditText` (change opentui-0-6-6 design D4). Since OpenTUI 0.6.2
// (#1650) the editor measures an emoji typed one code point at a time (a skin
// tone, a ZWJ family) as the merged grapheme, so its offsets equal these in
// every case probed; 0.6.1 added the parts' widths. `measureEditText` would
// follow the editor if it changed, but would tie this pure helper to the native
// library, and the rest of acp-tui's layout measures with `Bun.stringWidth`.
// The PTY test "Mention after a typed emoji" (test/overlay/
// file-picker.pty.test.ts) checks the editor's cursor against these columns;
// if it fails after an upgrade, reconsider `measureEditText` then.
import type { ResourceLinkBlock } from "../session/controller.ts";

export interface Mention {
  readonly start: number;
  readonly end: number;
  /** The real path, relative to the session's `cwd`. */
  readonly path: string;
  /** The text the range holds: `@` and the path as shown. */
  readonly text: string;
}

/**
 * The mentions after the draft changed from `before` to `after`: the changed span is found by the
 * longest common prefix and then suffix (the suffix kept clear of the prefix); mentions wholly
 * before it stay, those wholly after it move, and those it touches inside are dropped, as is any
 * whose range no longer holds its text.
 */
export function updateMentions(mentions: readonly Mention[], before: string, after: string): Mention[] {
  if (mentions.length === 0 || before === after) return [...mentions];
  const limit = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < limit && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++;
  let suffix = 0;
  while (suffix < limit - prefix && before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)) suffix++;
  const changeStart = prefix;
  const changeEnd = before.length - suffix; // in `before`
  const delta = after.length - before.length;
  const kept: Mention[] = [];
  for (const m of mentions) {
    let next: Mention | null = null;
    if (m.end <= changeStart) next = m;
    else if (m.start >= changeEnd) next = { ...m, start: m.start + delta, end: m.end + delta };
    if (next && after.slice(next.start, next.end) === next.text) kept.push(next);
  }
  return kept;
}

/** The `@` query at the cursor: the index of the `@` and the text between it and the cursor, or
 *  null when the cursor is not in an `@` word (one at the start of the draft or after
 *  whitespace, with no whitespace between it and the cursor). */
export function mentionQuery(text: string, cursor: number, anchor: number): string | null {
  if (!startsMention(text, anchor) || cursor <= anchor) return null;
  const query = text.slice(anchor + 1, cursor);
  return /\s/.test(query) ? null : query;
}

/** Whether `text` holds an `@` at `at` that starts a word: at the start of the draft or after
 *  whitespace. "Not after a word": the `@` of `me@example.com` does not. */
export function startsMention(text: string, at: number): boolean {
  return text[at] === "@" && (at === 0 || /\s/.test(text[at - 1]!));
}

/** The draft with `text.slice(start, end)` replaced by a mention of `path` shown as `shown`. */
export function insertMention(
  text: string,
  start: number,
  end: number,
  path: string,
  shown: string,
  mentions: readonly Mention[],
): { text: string; cursor: number; mentions: Mention[] } {
  const inserted = `@${shown}`;
  const next = text.slice(0, start) + inserted + text.slice(end);
  const mention: Mention = { start, end: start + inserted.length, path, text: inserted };
  const moved = updateMentions(mentions, text, next).filter((m) => m.end <= start || m.start >= mention.end);
  return { text: next, cursor: mention.end, mentions: [...moved, mention].sort((a, b) => a.start - b.start) };
}

export interface LinkTarget {
  /** The `file://` URI of a relative path. */
  uri(path: string): string;
  /** The file's size in bytes, or null when it cannot be read (never its content). */
  size(path: string): number | null;
}

/** The `resource_link` blocks that follow the text block: one per intact mention, in the order
 *  they appear in `text`. */
export function mentionLinks(text: string, mentions: readonly Mention[], target: LinkTarget): ResourceLinkBlock[] {
  const links: ResourceLinkBlock[] = [];
  for (const m of [...mentions].sort((a, b) => a.start - b.start)) {
    if (text.slice(m.start, m.end) !== m.text) continue;
    const size = target.size(m.path);
    links.push({ type: "resource_link", uri: target.uri(m.path), name: m.path, ...(size !== null ? { size } : {}) });
  }
  return links;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** The textarea's offset (display columns, a newline one) of UTF-16 index `index` in `text`. */
export function columnOffset(text: string, index: number): number {
  let offset = 0;
  for (const { segment, index: at } of graphemes.segment(text)) {
    if (at >= index) break;
    offset += segment === "\n" ? 1 : Bun.stringWidth(segment);
  }
  return offset;
}

/** The UTF-16 index in `text` at the textarea's offset `offset` (the inverse of `columnOffset`). */
export function indexAtColumn(text: string, offset: number): number {
  let column = 0;
  for (const { segment, index } of graphemes.segment(text)) {
    if (column >= offset) return index;
    column += segment === "\n" ? 1 : Bun.stringWidth(segment);
  }
  return text.length;
}

/** The offset a highlight takes for UTF-16 index `index` in `text`: display columns without the
 *  newlines (OpenTUI's `addHighlightByCharRange`). */
export function highlightOffset(text: string, index: number): number {
  let newlines = 0;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) newlines++;
  return columnOffset(text, index) - newlines;
}
