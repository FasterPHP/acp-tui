// The prompt box's selection (day-two-feedback task group 8, design D7; spec tui-selection
// "Selection in the prompt box"). The textarea draws its selection itself, in the `selectionBg` it
// is given: `surface.selection` where the theme has fills. Under the flat theme there is no fill to
// give (and OpenTUI's own default draws nothing at all, which is why the selection was invisible),
// so the textarea is given a mark colour no theme uses, and a post-process pass over its cells
// turns every cell that carries the mark into inverse video on the plain background, as the
// conversation's flat selection is drawn (src/selection/select.tsx).
import { RGBA, TextAttributes, type OptimizedBuffer } from "@opentui/core";
import { colourQuad } from "../selection/cells.ts";

/** The `selectionBg` the textarea is given under the flat theme; never drawn, replaced by inverse
 *  video before the frame is written. */
export const FLAT_SELECTION_MARK = RGBA.fromInts(1, 2, 3, 255);

/** A screen rectangle in cells. */
export interface CellRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Turns the marked cells inside `rect` into inverse video: the attribute is added and the
 * background is put back to that of the cell left of `rect`, which is the prompt box's own
 * frame side, drawn with no fill, as the textarea's unselected cells are. Returns how many cells
 * it changed.
 */
export function paintFlatSelection(buffer: OptimizedBuffer, rect: CellRect): number {
  if (rect.x < 1 || rect.width <= 0 || rect.height <= 0) return 0;
  const mark = colourQuad(FLAT_SELECTION_MARK);
  const { bg, attributes } = buffer.buffers;
  const columns = buffer.width;
  const rows = buffer.height;
  const plain = (rect.y * columns + rect.x - 1) * 4;
  let changed = 0;
  for (let y = Math.max(0, rect.y); y < Math.min(rows, rect.y + rect.height); y++) {
    for (let x = rect.x; x < Math.min(columns, rect.x + rect.width); x++) {
      const cell = y * columns + x;
      const o = cell * 4;
      if (bg[o] !== mark[0] || bg[o + 1] !== mark[1] || bg[o + 2] !== mark[2] || bg[o + 3] !== mark[3]) continue;
      attributes[cell] = attributes[cell]! | TextAttributes.INVERSE;
      bg[o] = bg[plain]!;
      bg[o + 1] = bg[plain + 1]!;
      bg[o + 2] = bg[plain + 2]!;
      bg[o + 3] = bg[plain + 3]!;
      changed++;
    }
  }
  return changed;
}
