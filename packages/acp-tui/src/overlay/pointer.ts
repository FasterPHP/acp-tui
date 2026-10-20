// The pointer in a list (day-two-feedback task 13.6, design D11; spec tui-palette "Click to select
// in lists"). Every list of the overlay family (the command palette, the slash menu, the config
// pickers, key help and the configuration's problems; the session list; the link chooser; the `@`
// file picker) draws its rows through `overlayLayout`, whose `itemAt` says which item each line
// shows. A primary click on an item's line does what Enter does on it, and the pointer moving over
// an item's line selects it as the keyboard would, so the highlighted row is the one a click would
// act on. Clicks and motion only reach a list under the `full` mouse policy: the policy check in
// front of every report (renderer/mouse.ts) drops them under `wheel` and `off`, and all-motion
// reporting is on only under `full` (renderer/create.ts), so nothing here needs to look at the
// policy. A line that is not an item (a border, the filter, a group header, a blank row, the footer)
// does nothing, and a click on it neither closes the list nor moves its selection.
import type { MouseEvent } from "@opentui/core";
import { isPrimaryPress } from "../renderer/mouse.ts";

/** The part of a renderable the pointer needs: where its first line is on the screen. */
export interface ListBox {
  readonly y: number;
}

/** What a list gives the pointer. */
export interface ListPointerTarget {
  /** The panel's box, once mounted. */
  box(): ListBox | undefined;
  /** The index of the item shown on each line of the panel (`OverlayLayout.itemAt`). */
  itemAt(): readonly (number | null)[];
  /** The pointer is over item `index`: select it. */
  select(index: number): void;
  /** A primary click on item `index`: what Enter does on it. */
  choose(index: number): void;
}

/** The item under a mouse event, or null. */
export function itemUnder(target: ListPointerTarget, event: { readonly y: number }): number | null {
  const box = target.box();
  if (!box) return null;
  return target.itemAt()[event.y - box.y] ?? null;
}

/** The mouse handlers for a list's panel: spread them onto its box. */
export function listPointer(target: ListPointerTarget): {
  readonly onMouseDown: (event: MouseEvent) => void;
  readonly onMouseMove: (event: MouseEvent) => void;
} {
  return {
    onMouseDown: (event) => {
      if (!isPrimaryPress(event)) return;
      const index = itemUnder(target, event);
      // The list has the click, whatever line it landed on: nothing under it reacts.
      event.stopPropagation();
      if (index !== null) target.choose(index);
    },
    onMouseMove: (event) => {
      const index = itemUnder(target, event);
      if (index !== null) target.select(index);
    },
  };
}
