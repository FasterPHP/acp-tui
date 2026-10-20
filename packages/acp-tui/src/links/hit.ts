// Where links are (task 6.3): the link drawn in a screen cell, and the links of a
// conversation item. Both read the rows acp-tui's Markdown renderers drew
// (conversation/markdown/), so a link is exactly what the screen shows as one:
// only allowed targets carry a `link`.
import type { Renderable } from "@opentui/core";
import type { Item } from "acp-model";
import { displayWidth } from "../layout/segments.ts";
import { LIVE_GLYPHS } from "../conversation/live-glyphs.ts";
import { drawnBlock } from "../conversation/markdown/draw.ts";
import { MessageLayout } from "../conversation/markdown/layout.ts";
import { PROJECTION_WIDTH } from "../conversation/markdown/project.ts";
import type { LinkTarget, Row } from "../conversation/markdown/types.ts";
import type { ConversationScrollBox } from "../conversation/scroll.ts";
import { coveredAt, firstBelow, inside, isItemNode } from "../selection/cells.ts";

/** The link of the span drawn at column `col` of `row`, if any. */
export function linkInRow(row: Row, col: number): LinkTarget | null {
  let x = 0;
  for (const span of row.spans) {
    const w = displayWidth(span.text);
    if (col >= x && col < x + w) return span.link ?? null;
    x += w;
  }
  return null;
}

/** The deepest drawn Markdown block under `node` that holds the cell (`x`, `y`). */
function blockAt(node: Renderable, x: number, y: number): { renderable: Renderable; rows: readonly Row[] } | null {
  const drawn = drawnBlock(node);
  if (drawn && y >= node.y && y < node.y + node.height && x >= node.x) return { renderable: node, rows: drawn.rows };
  for (const child of node.getChildren() as Renderable[]) {
    if (y < child.y || y >= child.y + Math.max(1, child.height)) continue;
    const found = blockAt(child, x, y);
    if (found) return found;
  }
  return null;
}

/** The drawn Markdown block of the conversation item at the screen cell (`x`, `y`), or null
 *  (outside the viewport, under an overlay, or no block there). */
function blockInConversation(box: ConversationScrollBox, x: number, y: number): { renderable: Renderable; rows: readonly Row[] } | null {
  if (!inside(box, x, y) || coveredAt(box, x, y)) return null;
  const children = box.content.getChildren() as Renderable[];
  const k = firstBelow(children, y);
  const node = children[k];
  if (!node || !isItemNode(node) || node.y > y) return null;
  return blockAt(node, x, y);
}

/** The link drawn at the screen cell (`x`, `y`) of the conversation, or null (outside the
 *  viewport, under an overlay, or no link there). */
export function linkAt(box: ConversationScrollBox, x: number, y: number): LinkTarget | null {
  const block = blockInConversation(box, x, y);
  if (!block) return null;
  const row = block.rows[y - block.renderable.y];
  return row ? linkInRow(row, x - block.renderable.x) : null;
}

/** A run of cells on one screen row: columns `[x, x + width)` of row `y`. */
export interface CellRun {
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

/** The link drawn at the screen cell (`x`, `y`) and every run of cells it is drawn in within its
 *  block (the label on each row it wraps over, and the host hint after a differing label: the
 *  spans that carry the same link), or null. */
export function linkCellsAt(box: ConversationScrollBox, x: number, y: number): { link: LinkTarget; cells: CellRun[] } | null {
  const block = blockInConversation(box, x, y);
  if (!block) return null;
  const row = block.rows[y - block.renderable.y];
  const link = row ? linkInRow(row, x - block.renderable.x) : null;
  if (!link) return null;
  const cells: CellRun[] = [];
  block.rows.forEach((r, i) => {
    let col = 0;
    for (const span of r.spans) {
      const w = displayWidth(span.text);
      if (span.link === link && w > 0) cells.push({ x: block.renderable.x + col, y: block.renderable.y + i, width: w });
      col += w;
    }
  });
  return { link, cells };
}

/** A link of an item and the label it is first drawn with. */
export interface ItemLink {
  readonly link: LinkTarget;
  readonly label: string;
}

/** The distinct links (by target) of an item in reading order, each with the label of its first
 *  occurrence: an agent message's Markdown. */
export function itemLinks(item: Item): ItemLink[] {
  if (item.kind !== "agent_message") return [];
  // At the projection's width nothing wraps, so a label is the run of linked spans on one row.
  const out = new Map<string, { link: LinkTarget; label: string }>();
  for (const block of new MessageLayout(item.text, PROJECTION_WIDTH, LIVE_GLYPHS).blocks()) {
    for (const row of block.rows) {
      let open: { label: string } | null = null;
      for (const span of row.spans) {
        if (!span.link || span.token === "muted") {
          open = null;
          continue;
        }
        const entry = out.get(span.link.href);
        if (!entry) {
          const fresh = { link: span.link, label: span.text };
          out.set(span.link.href, fresh);
          open = fresh;
        } else if (entry === open) entry.label += span.text;
      }
    }
  }
  return [...out.values()].map(({ link, label }) => ({ link, label: label.trim() }));
}
