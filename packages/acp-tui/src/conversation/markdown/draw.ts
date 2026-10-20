// Drawing rendered Markdown through OpenTUI's `<markdown>` (mvp-rendering
// design decision 1). `createRenderNode` gives the `renderNode` prop: for each
// top-level block OpenTUI asks for, a text renderable holding the block's rows
// (already wrapped, so `wrapMode` is "none") as styled chunks, with the block's
// top margin; a block that draws nothing is an empty box. OpenTUI keeps its
// block reconciliation: only blocks whose tokens changed are asked for again,
// so while a message streams only its trailing block is redrawn.
//
// The rows come from the message's `MessageLayout` (layout.ts), found by the
// block's offset and source in OpenTUI's own token list, so the screen shows
// exactly what the height estimate and the projection computed. OpenTUI lexes
// a streaming message piecemeal; where its blocks differ from the layout's
// (never seen, but possible), the block is rendered from OpenTUI's token.
//
// The renderers know only the width they were given, so the `renderNode`
// function is rebuilt when the width or the theme changes; setting a new one
// makes OpenTUI rebuild every block.
//
// Struck text (task 7.2; spec tui-rendering "Strikethrough per terminal",
// tui-theme "Safe text attributes only") is in the muted `markdown.strike`
// token everywhere, which the rows already carry. What the terminal draws on
// top is decided here, from the capability table (renderer/capabilities.ts):
// SGR 9 (OpenTUI's `TextAttributes.STRIKETHROUGH`, which its native renderer
// writes as parameter 9) where `sgr9`, else U+0336 after each character where
// `combiningStrike`, and italic where it marks neither (Marcus, 9 October
// 2026). This is the only place acp-tui sets the strikethrough attribute,
// and only on a span marked `strike`: a token's own attributes never carry it.
// The overlay characters exist only in the chunks given to OpenTUI, never in
// the rows, so the projection, copy, find and export never see them, and the
// selection's cell maps (which read the rows) are unchanged.
//
// Code blocks are highlighted here and only here (highlight.ts): a block is
// drawn with the highlights cached so far, and its content replaced, rows
// unchanged, when the tree-sitter worker answers for the rest.
import { BoxRenderable, StyledText, TextAttributes, TextRenderable, type MarkdownRenderable, type Renderable, type RGBA, type TextChunk } from "@opentui/core";
import type { Token } from "marked";
import { createSignal } from "solid-js";
import { displayWidth } from "../../layout/segments.ts";
import { terminalCapabilities, type TerminalCapabilities } from "../../renderer/capabilities.ts";
import type { ResolvedTheme } from "../../theme/index.ts";
import { renderBlock } from "./blocks.ts";
import { codeSources, highlightNow, requestHighlights } from "./highlight.ts";
import { marginAt, type MessageLayout } from "./layout.ts";
import type { Row, Span } from "./types.ts";

/** The `<markdown>` renderable a `renderNode` belongs to; set by the element's `ref`. */
export interface MarkdownHolder {
  current: MarkdownRenderable | null;
}

/** What a drawn block renderable shows: the rows of block `index` of the message's lex. */
export interface DrawnBlock {
  readonly index: number;
  readonly token: Token;
  readonly rows: readonly Row[];
}

const drawnBlocks = new WeakMap<Renderable, DrawnBlock>();

/** The block a renderable inside an agent message's `<markdown>` draws, or undefined (the
 *  selection's row maps read it, `selection/rows.ts`). */
export function drawnBlock(renderable: Renderable): DrawnBlock | undefined {
  return drawnBlocks.get(renderable);
}

/** U+0336 COMBINING LONG STROKE OVERLAY, drawn after each struck character where the terminal
 *  composes it (`combiningStrike`). */
export const STRIKE_OVERLAY = "̶";

let processCapabilities: TerminalCapabilities | undefined;
const [appCapabilities, setAppCapabilities] = createSignal<TerminalCapabilities | null>(null, { equals: sameCapabilities });

function sameCapabilities(a: TerminalCapabilities | null, b: TerminalCapabilities | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.sgr9 === b.sgr9 && a.combiningStrike === b.combiningStrike && a.osc8 === b.osc8 && a.detectsUrls === b.detectsUrls && a.emoji.join() === b.emoji.join();
}

/**
 * What this process's terminal draws: the capabilities the app set (`setDrawCapabilities`: the
 * effective per-terminal table, with the `terminals` setting, live on a reload), else the built-in
 * table from the environment (read once). Reactive: a renderer's `renderNode` built in a reactive
 * scope is rebuilt when they change (mvp-configuration design D12: `strikethrough` stays live).
 */
export function drawCapabilities(): TerminalCapabilities {
  const set = appCapabilities();
  if (set !== null) return set;
  processCapabilities ??= terminalCapabilities(process.env);
  return processCapabilities;
}

/**
 * The capabilities `drawCapabilities` gives from now on (`app/run.tsx`, at start-up and on each
 * reload), or (null) the environment's again. `osc8` must be the value the renderer was
 * constructed with, never a reloaded one: OpenTUI fixes its hyperlink capability at construction
 * (`FORCE_HYPERLINK`), and a link attached here must be one OpenTUI writes (design D6, D12).
 */
export function setDrawCapabilities(capabilities: TerminalCapabilities | null): void {
  setAppCapabilities(capabilities);
}

/** The SGR attributes of a span: its token's own, plus its flags; strikethrough only for a struck
 *  span in a terminal that draws SGR 9, italic for one in a terminal that draws neither SGR 9 nor
 *  U+0336 (see the module header). */
function attributesOf(span: Span, theme: ResolvedTheme, capabilities: TerminalCapabilities): number {
  let attributes = theme.text(span.token).attributes & ~TextAttributes.STRIKETHROUGH;
  if (span.bold) attributes |= TextAttributes.BOLD;
  if (span.italic) attributes |= TextAttributes.ITALIC;
  if (span.underline) attributes |= TextAttributes.UNDERLINE;
  if (span.dim) attributes |= TextAttributes.DIM;
  if (span.strike && capabilities.sgr9) attributes |= TextAttributes.STRIKETHROUGH;
  // Where neither SGR 9 nor U+0336 is drawn, the muted colour alone was easy to miss (review C8).
  if (span.strike && !capabilities.sgr9 && !capabilities.combiningStrike) attributes |= TextAttributes.ITALIC;
  return attributes;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** A span's text as drawn: where the terminal composes U+0336 and does not draw SGR 9, struck
 *  text gets the overlay after each character, spaces included so the stroke is unbroken. */
function drawnText(span: Span, capabilities: TerminalCapabilities): string {
  if (!span.strike || capabilities.sgr9 || !capabilities.combiningStrike) return span.text;
  let out = "";
  for (const { segment } of graphemes.segment(span.text)) out += segment + STRIKE_OVERLAY;
  return out;
}

function chunk(text: string, fg: RGBA, bg: RGBA | undefined, attributes: number): TextChunk {
  return bg === undefined ? { __isChunk: true, text, fg, attributes } : { __isChunk: true, text, fg, bg, attributes };
}

/** A fill token's colour, or none under the flat theme (which draws no fills). */
function fillOf(token: Span["fill"], theme: ResolvedTheme): RGBA | undefined {
  return token === undefined || theme.flat ? undefined : theme.color(token);
}

/**
 * Rows as OpenTUI text chunks, `width` columns wide where a row has a fill or a label. A linked
 * span's chunk carries its URL only where the capability table marks the terminal `osc8` (task
 * 6.4): OpenTUI then writes OSC 8 around it, since renderer/hyperlinks.ts sets OpenTUI's own
 * hyperlink capability to the table's answer; elsewhere no chunk has a link, so nothing is written.
 * Struck spans are drawn as `capabilities` allow (the module header).
 */
export function rowsToChunks(rows: readonly Row[], width: number, theme: ResolvedTheme, capabilities: TerminalCapabilities = drawCapabilities()): TextChunk[] {
  const chunks: TextChunk[] = [];
  rows.forEach((row, r) => {
    if (r > 0) chunks.push(chunk("\n", theme.color("text"), undefined, 0));
    const rowFill = fillOf(row.fill, theme);
    let used = 0;
    for (const span of row.spans) {
      // A row's fill is behind its own spans' fills only: a container's prefix stays unfilled.
      const text = theme.flat && span.flatText !== undefined ? span.flatText : span.text;
      const drawn = chunk(drawnText({ ...span, text }, capabilities), theme.color(span.token), fillOf(span.fill, theme), attributesOf(span, theme, capabilities));
      // OSC 8 (task 6.4): only an allowed target (only those are on a span), only where the table
      // marks the terminal verified, with the URL acp-tui built, and not on the host hint after a
      // differing label (IDE follow-up 5: Zed underlined it as part of the link).
      chunks.push(capabilities.osc8 && span.link && !span.hint ? { ...drawn, link: { url: span.link.url } } : drawn);
      used += displayWidth(span.text);
    }
    const label = row.label;
    const labelWidth = label ? displayWidth(label.text) : 0;
    const inset = row.labelInset ?? 0;
    if (label && used + 1 + labelWidth + inset <= width) {
      chunks.push(chunk(" ".repeat(width - used - labelWidth - inset), theme.color("text"), rowFill, 0));
      chunks.push(chunk(label.text, theme.color(label.token), fillOf(label.fill, theme) ?? rowFill, attributesOf(label, theme, capabilities)));
      if (inset > 0) chunks.push(chunk(" ".repeat(inset), theme.color("text"), rowFill, 0));
    } else if (rowFill && used < width) {
      chunks.push(chunk(" ".repeat(width - used), theme.color("text"), rowFill, 0));
    }
  });
  return chunks;
}

export interface RenderNodeOptions {
  readonly holder: MarkdownHolder;
  /** The message laid out at the width the blocks are drawn at, for the content being drawn (read
   *  when OpenTUI asks for a block, so a streamed chunk needs no new `renderNode`). */
  readonly layout: () => MessageLayout;
  readonly theme: ResolvedTheme;
  /** What the terminal draws (struck text); the process's terminal when absent. */
  readonly capabilities?: TerminalCapabilities;
  /** Ask the tree-sitter worker for code highlights (default true); cached ones are always used. */
  readonly highlight?: boolean;
}

/** The `renderNode` prop for one message's `<markdown>` (see the module header). */
export function createRenderNode(options: RenderNodeOptions): (token: Token) => Renderable | undefined {
  const { holder, theme } = options;
  const capabilities = options.capabilities ?? drawCapabilities();
  return (token: Token) => {
    const md = holder.current;
    const layout = options.layout();
    if (!md) return undefined;
    // The block's index and offset in OpenTUI's token list (current: renderNode is called while
    // OpenTUI updates its blocks from it).
    const tokens = (md._parseState?.tokens ?? []) as Token[];
    const index = tokens.indexOf(token);
    let offset = 0;
    for (let k = 0; k < index; k++) offset += tokens[k]!.raw.length;
    const own = index < 0 ? -1 : layout.indexAt(offset, token.raw);
    let rows: readonly Row[];
    let margin: number;
    if (own >= 0) {
      rows = layout.rowsAt(own);
      margin = layout.marginAt(own);
    } else {
      rows = renderBlock(token, layout.ctx);
      const drawsNothing = (k: number) => {
        const t = tokens[k]!;
        return t.type === "space" || t.type === "def" || (t.type === "html" && renderBlock(t, layout.ctx).length === 0);
      };
      margin = index < 0 ? 0 : marginAt(tokens, index, drawsNothing);
    }
    if (rows.length === 0) return new BoxRenderable(md.ctx, { height: 0, flexShrink: 0, marginTop: margin });
    const width = layout.ctx.width;
    // Code is coloured with the highlights cached so far, and again as the missing ones arrive
    // (highlight.ts); the rows, and so the height, stay as laid out.
    const renderable = new TextRenderable(md.ctx, {
      content: new StyledText(rowsToChunks(highlightNow(rows), width, theme, capabilities)),
      wrapMode: "none",
      flexShrink: 0,
      marginTop: margin,
      fg: theme.color("text"),
    });
    if (options.highlight !== false) {
      const sources = codeSources(rows);
      if (sources.length > 0) {
        requestHighlights(
          sources,
          () => !renderable.isDestroyed,
          () => (renderable.content = new StyledText(rowsToChunks(highlightNow(rows), width, theme, capabilities))),
        );
      }
    }
    if (own >= 0) drawnBlocks.set(renderable, { index: own, token, rows });
    return renderable;
  };
}
