// A whole agent message laid out at one width, without mounting anything
// (spec tui-rendering "Heights computable without mounting"): the message is
// pre-passed (prepass.ts), lexed with marked exactly as OpenTUI lexes it, and
// each top-level block rendered by `renderBlock` with the blank rows OpenTUI
// and acp-tui put above it. draw.ts draws the same blocks from the same
// object, so the height estimate, the projection and the screen agree.
//
// Blank rows between top-level blocks: OpenTUI's `<markdown>` in
// `internalBlockMode="top-level"` gives a block a top margin of one row when
// either it or the block before it is a heading, list, code block, table,
// quote or rule, or both are paragraphs with a blank line between them
// (`shouldAddTopLevelMargin` in @opentui/core 0.5.12), and takes the larger
// of that and the margin of the renderable `renderNode` returns. acp-tui adds
// one row wherever the source has a blank line between two blocks that draw
// something, so a link definition or an HTML comment between two paragraphs
// (which draw nothing) does not join them; `marginAt` computes the result.
import type { Token, TokensList } from "marked";
import type { TokenName } from "../../theme/index.ts";
import type { ConversationGlyphs } from "../glyphs.ts";
import { renderBlock } from "./blocks.ts";
import { DEFAULT_FLAGS, type MarkdownContext, type MarkdownFlags } from "./context.ts";
import { lexMarkdown } from "./lex.ts";
import { prepass, type Prepared } from "./prepass.ts";
import type { Row } from "./types.ts";

/** OpenTUI's blocks that are always set apart by a blank row. */
const SEPARATED = new Set(["heading", "list", "code", "table", "blockquote", "hr"]);
const ENDS_WITH_BLANK_LINE = /(?:\r?\n){2,}$/;

/** OpenTUI's own top margin for the block at `i` (see the module header). */
function openTuiMargin(tokens: readonly Token[], i: number): number {
  let gap = "";
  let k = i - 1;
  for (; k >= 0 && tokens[k]!.type === "space"; k--) gap += tokens[k]!.raw;
  if (k < 0) return 0;
  const prev = tokens[k]!;
  const current = tokens[i]!;
  if (SEPARATED.has(prev.type) || SEPARATED.has(current.type)) return 1;
  return prev.type === "paragraph" && current.type === "paragraph" && ENDS_WITH_BLANK_LINE.test(prev.raw + gap) ? 1 : 0;
}

/**
 * The top margin of the block at `i` (never a `space` token): OpenTUI's margin, or more where
 * acp-tui wants a blank row (see the module header). `drawsNothing(k)` says whether block `k`
 * takes no rows.
 */
export function marginAt(tokens: readonly Token[], i: number, drawsNothing: (k: number) => boolean): number {
  const floor = openTuiMargin(tokens, i);
  if (drawsNothing(i)) return floor;
  // Back to the previous block that draws something, noting blank lines and the blank rows
  // the blocks in between already take.
  let blank = false;
  let taken = 0;
  let k = i - 1;
  for (; k >= 0; k--) {
    const t = tokens[k]!;
    if (t.type === "space") {
      blank = true;
      continue;
    }
    if (!drawsNothing(k)) break;
    blank = true;
    taken += openTuiMargin(tokens, k);
  }
  if (k < 0) return floor;
  const prev = tokens[k]!;
  const wanted = blank || ENDS_WITH_BLANK_LINE.test(prev.raw) || SEPARATED.has(prev.type) || SEPARATED.has(tokens[i]!.type) ? 1 : 0;
  return Math.max(floor, wanted - taken);
}

/** How many messages' pre-pass and tokens are kept (the drawing, the height estimate and the
 *  projection of one message share them; tokens are never changed by the renderers). */
const LEXED_CACHE_SIZE = 4096;
const lexedCache = new Map<string, { prepared: Prepared; tokens: TokensList }>();

/** A message's pre-pass and tokens. */
export function lexMessage(text: string): { prepared: Prepared; tokens: TokensList } {
  const prepared = prepass(text);
  return { prepared, tokens: lexMarkdown(prepared.source) };
}

/** A message's pre-pass and tokens, from a small cache keyed by its text. */
export function lexedMessage(text: string): { prepared: Prepared; tokens: TokensList } {
  const hit = lexedCache.get(text);
  if (hit) {
    // Most recently used last.
    lexedCache.delete(text);
    lexedCache.set(text, hit);
    return hit;
  }
  const lexed = lexMessage(text);
  lexedCache.set(text, lexed);
  if (lexedCache.size > LEXED_CACHE_SIZE) lexedCache.delete(lexedCache.keys().next().value!);
  return lexed;
}

export interface LaidOutBlock {
  /** Index of the token in `MessageLayout.tokens`. */
  readonly index: number;
  readonly token: Token;
  readonly marginTop: number;
  readonly rows: readonly Row[];
}

/** One message laid out at one width (see the module header). Rows are rendered on demand and
 *  kept. */
export class MessageLayout {
  readonly prepared: Prepared;
  readonly tokens: TokensList;
  readonly ctx: MarkdownContext;
  /** Each token's offset in `prepared.source`. */
  private readonly offsets: number[] = [];
  private readonly byOffset = new Map<number, number>();
  private readonly rowCache = new Map<number, readonly Row[]>();
  private margins: number[] | null = null;

  /** `cache`: keep the text's pre-pass and tokens for the next layout of it (not while it streams,
   *  when every chunk is a new text). `textToken`: the token of plain text (`thought` for a
   *  thought's body, mvp-rendering task 9.4). */
  constructor(
    source: string | Prepared,
    width: number,
    glyphs: ConversationGlyphs,
    flags: MarkdownFlags = DEFAULT_FLAGS,
    cache = true,
    textToken: TokenName = "text",
  ) {
    if (typeof source === "string") {
      const lexed = cache ? lexedMessage(source) : lexMessage(source);
      this.prepared = lexed.prepared;
      this.tokens = lexed.tokens;
    } else {
      this.prepared = source;
      this.tokens = lexMarkdown(source.source);
    }
    this.ctx = { width: Math.max(1, width), glyphs: glyphs.markdown, prepared: this.prepared, flags, textToken, listDepth: 0 };
    let offset = 0;
    this.tokens.forEach((token, i) => {
      this.offsets.push(offset);
      this.byOffset.set(offset, i);
      offset += token.raw.length;
    });
  }

  /** The index of the top-level token at `offset` in the source with this `raw`, or -1 (OpenTUI's
   *  incremental lexing split the source differently). */
  indexAt(offset: number, raw: string): number {
    const i = this.byOffset.get(offset);
    return i !== undefined && this.tokens[i]!.raw === raw ? i : -1;
  }

  rowsAt(i: number): readonly Row[] {
    let rows = this.rowCache.get(i);
    if (!rows) {
      rows = renderBlock(this.tokens[i]!, this.ctx);
      this.rowCache.set(i, rows);
    }
    return rows;
  }

  /** Whether block `i` takes no rows (a definition, an HTML comment, a space). */
  drawsNothing(i: number): boolean {
    const type = this.tokens[i]!.type;
    if (type === "space" || type === "def") return true;
    if (type !== "html") return false;
    return this.rowsAt(i).length === 0;
  }

  marginAt(i: number): number {
    if (!this.margins) this.margins = this.tokens.map((t, k) => (t.type === "space" ? 0 : marginAt(this.tokens, k, (j) => this.drawsNothing(j))));
    return this.margins[i] ?? 0;
  }

  /** Every top-level block in order (space tokens left out). */
  blocks(): LaidOutBlock[] {
    const out: LaidOutBlock[] = [];
    this.tokens.forEach((token, index) => {
      if (token.type === "space") return;
      out.push({ index, token, marginTop: this.marginAt(index), rows: this.rowsAt(index) });
    });
    return out;
  }

  /** The rows the message takes, blank rows between blocks included. */
  height(): number {
    let h = 0;
    for (const block of this.blocks()) h += block.marginTop + block.rows.length;
    return h;
  }
}
