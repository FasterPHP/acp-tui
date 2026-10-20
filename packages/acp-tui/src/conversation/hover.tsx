// Hover feedback (mvp-rendering task 14.5, review C12; spec tui-rendering "Hover feedback"). No
// IDE terminal of the three shows a pointer shape an app asks for (OSC 22; Marcus's probe, 10
// October 2026), so acp-tui marks what a click would act on itself while the pointer is over it:
//
// - a link: its label (on every row it wraps over) and the host hint after a differing label,
//   the cells that carry the same link (src/links/hit.ts `linkCellsAt`);
// - the word `here` on a tool card's snippet marker row (card.ts `drawnMarker`);
// - a collapsed tool line or thought, and a group line, from the end of the gutter to the row's
//   end.
//
// The mark is the `surface.cursor` fill (the highlighted row of an overlay list: what Enter or a
// click would act on), or inverse video under the flat theme, which draws no fills. Not
// `surface.cursor.faint`: that fill already marks the item under the conversation cursor, and it
// lies below the card fill (3.5 L* against 5.5), so it would not show on the item under the
// cursor or on a card's `here`; `surface.cursor` is placed at least 5 L* beyond every fill it may
// sit on (theme/derive.ts). Not a stronger underline either: links and `here` are underlined
// already, and the IDE terminals draw no underline styles (SGR 4:2 and up). Cells painted by the
// selection or a find hit keep their highlight. No new theme token is needed.
//
// How: all-motion reporting (1003) is on under the `full` mouse policy (renderer/create.ts). The
// mouse hook (first in the chain, app/run.tsx) keeps the pointer's cell and hands every report
// on; on motion it resolves the target under the pointer against the last frame's layout and
// asks for a frame only when the cells to mark differ from the ones marked last, so movement
// within one target draws nothing. The mark is a post-process pass (OpenTUI's `addPostProcessFn`,
// as the selection highlight): it resolves the target again from the pointer's cell against the
// frame being drawn, so a scroll or a stream under a still pointer moves the mark with the text,
// and OpenTUI's diff writes only the cells whose mark changed. No mark while a button is held (a
// drag selects) or under any policy but `full`.
import { TextAttributes, type CliRenderer, type OptimizedBuffer, type Renderable } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import { onCleanup, type JSX } from "solid-js";
import { useApp } from "../app/context.ts";
import { linkCellsAt, type CellRun } from "../links/hit.ts";
import type { MouseIntercept, MouseReport } from "../renderer/mouse.ts";
import { colourQuad, conversationBoxFinder, coveredAt, coveringRects, firstBelow, hasBackground, inside, isItemNode, itemIdOf, type Rect } from "../selection/cells.ts";
import { drawnMarker } from "./card.ts";
import { LIVE_GLYPHS } from "./live-glyphs.ts";
import type { ConversationScrollBox } from "./scroll.ts";

/** What a click under the pointer would act on, and the cells that show it. */
export interface HoverTarget {
  readonly kind: "link" | "here" | "line";
  readonly cells: readonly CellRun[];
}

/** The id prefix of a group line's box (window/WindowedConversation.tsx `GroupView`). */
const GROUP_PREFIX = "group:";

/** The `here` of a snippet marker row under (`x`, `y`) inside `node`, if any. */
function hereAt(node: Renderable, x: number, y: number): HoverTarget | null {
  const marker = drawnMarker(node);
  if (marker) {
    const row = node.y + marker.row;
    const from = node.x + marker.from;
    if (y === row && x >= from && x < node.x + marker.to) return { kind: "here", cells: [{ x: from, y: row, width: marker.to - marker.from }] };
    return null;
  }
  for (const child of node.getChildren() as Renderable[]) {
    if (y < child.y || y >= child.y + Math.max(1, child.height)) continue;
    const found = hereAt(child, x, y);
    if (found) return found;
  }
  return null;
}

/**
 * The hover target at the screen cell (`x`, `y`) of the conversation, or null. `kindOf` names an
 * item's kind (`tool_call`, `thought`, ...), or undefined for an unknown id.
 */
export function hoverTargetAt(box: ConversationScrollBox, x: number, y: number, kindOf: (id: string) => string | undefined, gutterWidth = LIVE_GLYPHS.gutterWidth): HoverTarget | null {
  if (!inside(box, x, y) || coveredAt(box, x, y)) return null;
  const children = box.content.getChildren() as Renderable[];
  const node = children[firstBelow(children, y)];
  if (!node || node.y > y) return null;
  const line = (): HoverTarget => ({ kind: "line", cells: [{ x: node.x + gutterWidth, y: node.y, width: Math.max(0, node.width - gutterWidth) }] });
  const onLine = y === node.y && x >= node.x + gutterWidth;
  if (node.id.startsWith(GROUP_PREFIX)) return onLine ? line() : null;
  if (!isItemNode(node)) return null;
  const kind = kindOf(itemIdOf(node));
  if (kind === "agent_message") {
    const found = linkCellsAt(box, x, y);
    return found ? { kind: "link", cells: found.cells } : null;
  }
  if (kind === "tool_call" || kind === "thought") {
    // Collapsed: the header line is all there is.
    if (node.height === 1) return onLine ? line() : null;
    return kind === "tool_call" ? hereAt(node, x, y) : null;
  }
  return null;
}

/** A target's cells as one string, to tell whether the mark would change. */
export function hoverKey(target: HoverTarget | null): string {
  return target ? `${target.kind}:${target.cells.map((c) => `${c.x},${c.y},${c.width}`).join(";")}` : "";
}

export interface HoverMount {
  /** The mouse hook (first in the chain: it sees every report and hands each one on). */
  readonly intercept: MouseIntercept;
  /** Mounted in the App's overlay slot; draws nothing itself. */
  readonly overlay: () => JSX.Element;
}

export function createHover(): HoverMount {
  let handler: MouseIntercept | null = null;
  return {
    intercept: (report, dispatch) => (handler ? handler(report, dispatch) : dispatch(report)),
    overlay: () => <HoverLayer bind={(h) => (handler = h)} />,
  };
}

function HoverLayer(props: { bind: (handler: MouseIntercept | null) => void }): JSX.Element {
  const renderer = useRenderer() as CliRenderer;
  const { store, theme } = useApp();
  const conversationBox = conversationBoxFinder(renderer);
  const kindOf = (id: string) => store.snapshot().items.get(id)?.kind;

  let pointer: { x: number; y: number } | null = null;
  let held = false;
  /** The key of the cells marked in the last frame. */
  let painted = "";

  const resolve = (): HoverTarget | null => {
    if (!pointer || held || store.ui.mouse !== "full") return null;
    const box = conversationBox();
    return box ? hoverTargetAt(box, pointer.x, pointer.y, kindOf) : null;
  };

  /** Asks for a frame only when the mark would change. */
  const check = () => {
    if (hoverKey(resolve()) !== painted) renderer.requestRender();
  };

  const onMouse: MouseIntercept = (report: MouseReport, dispatch) => {
    pointer = { x: report.x, y: report.y };
    if (report.type === "down") held = true;
    else if (report.type === "up") held = false;
    if (report.type !== "scroll") check();
    return dispatch(report);
  };
  props.bind(onMouse);

  const paint = (buffer: OptimizedBuffer): void => {
    const target = resolve();
    painted = hoverKey(target);
    if (!target) return;
    const box = conversationBox();
    if (!box) return;
    const vp = box.viewport;
    const covering: Rect[] = coveringRects(box);
    const width = buffer.width;
    const flat = theme.flat;
    const fill = flat ? null : colourQuad(theme.color("surface.cursor"));
    // Cells the selection or a find hit has painted keep their highlight.
    const keep = flat ? [] : [colourQuad(theme.color("surface.selection")), colourQuad(theme.color("find.current")), colourQuad(theme.color("find.other"))];
    const attributes = buffer.buffers.attributes;
    for (const run of target.cells) {
      if (run.y < Math.max(0, vp.y) || run.y >= Math.min(buffer.height, vp.y + vp.height)) continue;
      for (let x = run.x; x < run.x + run.width; x++) {
        if (x < Math.max(0, vp.x) || x >= Math.min(width, vp.x + vp.width)) continue;
        if (covering.some((r) => x >= r.x && x < r.x + r.width && run.y >= r.y && run.y < r.y + r.height)) continue;
        const cell = run.y * width + x;
        if (fill === null) attributes[cell] = attributes[cell]! | TextAttributes.INVERSE;
        else if (!keep.some((quad) => hasBackground(buffer, cell, quad))) buffer.buffers.bg.set(fill, cell * 4);
      }
    }
  };
  renderer.addPostProcessFn(paint);

  onCleanup(() => {
    props.bind(null);
    renderer.removePostProcessFn(paint);
  });
  return <></>;
}
