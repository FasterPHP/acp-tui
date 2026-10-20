// Mounted conversation items to screen cells, shared by the selection highlight
// (select.tsx) and the find highlight (src/find/); design 6.3.
//
// Both highlights are post-process passes (OpenTUI's public
// `addPostProcessFn`) over the frame's buffer: they find the conversation's
// scroll box (a `ConversationScrollBox`), walk the item boxes (`item:<id>`) that overlap its viewport,
// map each item's drawn rows to projection offsets with rows.ts, and repaint
// the cells whose character lies in a wanted range. Neither conversation
// component knows about them.
//
// Neither pass paints a cell that something else covers in that frame
// (design D5): every visible renderable outside the conversation's scroll box
// and its ancestors that is drawn over the viewport (the palette, the session
// list, a docked card or the find bar if one ever overlaps it) is a covering
// rectangle (`coveringRects`), and its cells are skipped. In the default
// column layout only the overlays, drawn on top of the screen from the
// renderer's root, ever overlap.
import { OptimizedBuffer, ResourceContext, type CliRenderer, type Renderable, type RGBA } from "@opentui/core";
import type { Item } from "acp-model";
import { ConversationScrollBox } from "../conversation/scroll.ts";
import { collapsible } from "../conversation/view-model.ts";
import type { ConversationGlyphs } from "../conversation/glyphs.ts";
import { ProjectionCache } from "./projection.ts";
import { itemRows, type ItemRows } from "./rows.ts";

export const ITEM_PREFIX = "item:";

export function isItemNode(node: Renderable): boolean {
  return node.id.startsWith(ITEM_PREFIX);
}

/** The item id of an `item:<id>` box. */
export function itemIdOf(node: Renderable): string {
  return node.id.slice(ITEM_PREFIX.length);
}

/** The first child whose bottom is below row `y` (children are in row order). */
export function firstBelow(children: readonly Renderable[], y: number): number {
  let lo = 0;
  let hi = children.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const c = children[mid]!;
    if (c.y + c.height > y) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** The item box at row `y`, else the next one below it, else the last one above. */
export function itemNear(children: readonly Renderable[], y: number): Renderable | null {
  const at = firstBelow(children, y);
  for (let k = at; k < children.length; k++) if (isItemNode(children[k]!)) return children[k]!;
  for (let k = Math.min(at, children.length) - 1; k >= 0; k--) if (isItemNode(children[k]!)) return children[k]!;
  return null;
}

/** Whether the cell (`x`, `y`) is inside the box's viewport. */
export function inside(box: ConversationScrollBox, x: number, y: number): boolean {
  const vp = box.viewport;
  return x >= vp.x && x < vp.x + vp.width && y >= vp.y && y < vp.y + vp.height;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * The rectangles drawn over the conversation's viewport by anything outside it: every visible
 * renderable that is neither the scroll box, inside it, nor one of its ancestors, and overlaps the
 * viewport (taken whole, without looking inside). The walk skips the conversation's subtree, so it
 * visits only the chrome: a few dozen renderables.
 */
export function coveringRects(box: ConversationScrollBox): Rect[] {
  const vp = box.viewport;
  const ancestors = new Set<Renderable>();
  let root: Renderable = box;
  for (let p = box.parent; p; p = p.parent) {
    ancestors.add(p);
    root = p;
  }
  const out: Rect[] = [];
  const walk = (node: Renderable) => {
    for (const child of node.getChildren() as Renderable[]) {
      if (child === box || !child.visible) continue;
      if (ancestors.has(child)) walk(child);
      else if (child.width > 0 && child.height > 0 && overlaps(child, vp)) out.push({ x: child.x, y: child.y, width: child.width, height: child.height });
      // Absolutely positioned descendants may reach the viewport from a box that does not.
      else walk(child);
    }
  };
  walk(root);
  return out;
}

const covers = (rects: readonly Rect[], x: number, y: number) => rects.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);

/** Whether the cell (`x`, `y`) of the conversation's viewport is drawn over by something else. */
export function coveredAt(box: ConversationScrollBox, x: number, y: number): boolean {
  return covers(coveringRects(box), x, y);
}

/** Finds the conversation's scroll box under the renderer's root, and remembers it while it lives. */
export function conversationBoxFinder(renderer: CliRenderer): () => ConversationScrollBox | null {
  let box: ConversationScrollBox | null = null;
  const find = (node: Renderable): ConversationScrollBox | null => {
    if (node instanceof ConversationScrollBox) return node;
    for (const child of node.getChildren() as Renderable[]) {
      const found = find(child);
      if (found) return found;
    }
    return null;
  };
  return () => {
    if (box && !box.isDestroyed) return box;
    box = find(renderer.root);
    return box;
  };
}

/**
 * Row maps per mounted item, cached on the item version, the box's size, whether it is drawn
 * expanded and the flat theme (what the drawing depends on).
 */
export class RowMaps {
  readonly projections: ProjectionCache;
  private readonly cache = new Map<string, { item: Item; key: string; rows: ItemRows }>();

  constructor(
    private readonly glyphs: ConversationGlyphs,
    private readonly flat: () => boolean,
    projections: ProjectionCache = new ProjectionCache(),
  ) {
    this.projections = projections;
  }

  rowsFor(item: Item, node: Renderable): ItemRows {
    const expanded = collapsible(item) && node.height > 1;
    const key = `${node.width}x${node.height}|${expanded}|${this.flat()}`;
    const cached = this.cache.get(item.id);
    if (cached && cached.item === item && cached.key === key) return cached.rows;
    const rows = itemRows(item, this.projections.get(item), node, { glyphs: this.glyphs, expanded });
    this.cache.set(item.id, { item, key, rows });
    return rows;
  }
}

const encodings = new Map<string, Uint16Array>();
// The probe buffer colourQuad encodes through, created on first use. OpenTUI 0.6 gives every
// native buffer an owner; this one is not a renderer's (no renderer is at hand here, and the
// encoding does not depend on one), so it has a small context of its own for the process's
// lifetime, and its planes are read through `withBuffers()`, as outside a post-process pass.
let probe: OptimizedBuffer | null = null;
function probeBuffer(): OptimizedBuffer {
  probe ??= OptimizedBuffer.create(1, 1, "wcwidth", { owner: new ResourceContext({ objectCapacity: 16, renderCellsMax: 16 }) });
  return probe;
}

/** The raw colour value OpenTUI stores for `color` (four 16-bit words per cell, the same for the
 *  foreground and background planes). Cached per colour and intent (a default colour and an RGB
 *  one with the same channels encode differently), a few per theme. */
export function colourQuad(color: RGBA): Uint16Array {
  const key = `${color.intent},${color.slot},${color.r},${color.g},${color.b},${color.a}`;
  const known = encodings.get(key);
  if (known) return known;
  const buffer = probeBuffer();
  buffer.setCell(0, 0, " ", color, color, 0);
  const quad = buffer.withBuffers((cells) => cells.bg.slice(0, 4));
  if (encodings.size >= 64) encodings.clear();
  encodings.set(key, quad);
  return quad;
}

/** Whether the background of cell `cell` is `quad`. */
export function hasBackground(buffer: OptimizedBuffer, cell: number, quad: Uint16Array): boolean {
  const bg = buffer.buffers.bg;
  const o = cell * 4;
  return bg[o] === quad[0] && bg[o + 1] === quad[1] && bg[o + 2] === quad[2] && bg[o + 3] === quad[3];
}

/** One mapped cell in the viewport: its buffer index and the projection offsets of its character. */
export type CellVisitor = (itemId: string, from: number, to: number, cell: number) => void;

/**
 * Visits every mapped cell of the mounted items that overlap the conversation's viewport, for
 * the items `rowsOf` gives rows for (null skips an item). Decoration cells (-1) and cells covered
 * by something drawn over the viewport (`coveringRects`) are skipped.
 */
export function visitViewportCells(
  buffer: OptimizedBuffer,
  box: ConversationScrollBox,
  rowsOf: (itemId: string, node: Renderable) => ItemRows | null,
  visit: CellVisitor,
): void {
  const vp = box.viewport;
  const top = Math.max(0, vp.y);
  const bottom = Math.min(buffer.height, vp.y + vp.height);
  const left = Math.max(0, vp.x);
  const right = Math.min(buffer.width, vp.x + vp.width);
  const width = buffer.width;
  const children = box.content.getChildren() as Renderable[];
  const covering = coveringRects(box);
  for (let k = firstBelow(children, top); k < children.length; k++) {
    const node = children[k]!;
    if (node.y >= bottom) break;
    if (!isItemNode(node)) continue;
    const itemId = itemIdOf(node);
    const rows = rowsOf(itemId, node);
    if (!rows) continue;
    for (const span of rows.spans) {
      const y = node.y + span.y;
      if (y < top || y >= bottom) continue;
      for (let c = 0; c < span.from.length; c++) {
        const from = span.from[c]!;
        if (from < 0) continue;
        const x = node.x + span.x + c;
        if (x < left || x >= right) continue;
        if (covering.length > 0 && covers(covering, x, y)) continue;
        visit(itemId, from, span.to[c]!, y * width + x);
      }
    }
  }
}
