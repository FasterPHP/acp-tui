// Selection and copy (design of record 6.3 "Selection and copy"; decision 11,
// research/full-screen-synthesis.md section 4). Mounted by app/run.tsx:
// `createSelection()` gives the mouse hook (renderer/mouse.ts `intercept`,
// after the policy check, so `--mouse wheel` and `off` never select) and a
// component that App mounts in its overlay slot, inside the app's contexts.
//
// - Ends as model positions (model.ts): each end is an item and offsets into
//   its plain-text projection (projection.ts), found from the screen cell
//   through the item's row map (rows.ts). Items are found under the pointer
//   in the conversation's scroll box (a `ConversationScrollBox`) by their
//   `item:<id>` boxes, so the conversation component knows nothing of this
//   module.
// - Mouse: a primary press in the conversation is handed on (the cursor,
//   focus and the header toggle keep working), then OpenTUI's own renderer
//   selection, which a press on any text starts, is cleared at once, so it
//   never draws or fights this one. Drag reports after the press are
//   consumed: the first that leaves the pressed cell starts the selection,
//   each moves its focus end, and the release (also consumed, so a drag that
//   ends on a header line does not toggle it) copies. A second press within
//   400 ms on the same cell selects the word, a third the line; their presses
//   and releases are consumed. With the pointer on the conversation's top or
//   bottom row, or beyond it, a timer scrolls the conversation (1 row per
//   40 ms at the edge, up to 5 further out) and the focus end follows.
// - Highlight: a post-process function (OpenTUI's public `addPostProcessFn`)
//   repaints the selected cells of the mounted items in the viewport after
//   each frame: the background becomes `surface.selection` (its own fill, so
//   it stays distinct inside the item under the conversation cursor), or,
//   under the flat theme, inverse video. Decoration cells (gutters, card
//   padding, diff numbers, header glyphs) and cells under anything drawn over
//   the conversation (an overlay; cells.ts `coveringRects`) are never
//   painted, and a press there is not the conversation's. OpenTUI's
//   renderer selection was not used for this; the reasons are in the Phase 1a
//   report (S4, task 14.2).
// - Copy (clipboard.ts): on release (`selection.copy_on_release`), and with Ctrl+C (the
//   `selection` key context, a global layer above the others): the selection;
//   else, with the conversation focused, the item under its cursor; else
//   nothing, and the key is consumed all the same, so it never clears the
//   prompt box, cancels a turn or arms exit (design D7). Ctrl+Shift+C
//   (`copyRich`) is the same with the cursor item's Markdown. `y` and `Y`
//   copy the item under the conversation cursor (projection and Markdown),
//   with the conversation focused. All four are palette commands. A notice in
//   the prompt box's top border names the path or says nothing was copied.
//   Esc clears the selection (again through the `selection` context).
// - The prompt box's selection (day-two-feedback; the textarea owns it, src/app/prompt-selection.ts):
//   Ctrl+C and Ctrl+Shift+C copy it first while the prompt box has focus, Esc clears it first,
//   Ctrl+X cuts it (a global layer on the `prompt` context's `cut`, which acts only with the prompt
//   box focused), and it clears this module's selection (one selection at a time). A drag there is
//   not intercepted, and its release copies nothing.
import { TextAttributes, type OptimizedBuffer, type Renderable } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import { onCleanup, type JSX } from "solid-js";
import type { Item, Session } from "acp-model";
import { useApp, useConfig } from "../app/context.ts";
import { LIVE_GLYPHS } from "../conversation/live-glyphs.ts";
import { collapsible } from "../conversation/view-model.ts";
import { useKeys } from "../keys/context.ts";
import { registerContext } from "../keys/register.ts";
import type { MouseIntercept, MouseReport } from "../renderer/mouse.ts";
import { copyToast, createCopier, type ClipboardModeSource, type Copier, type CopierOptions } from "./clipboard.ts";
import { itemMarkdown } from "./export.ts";
import { dragRange, isEmptyRange, lineAround, nextClick, rangeEnds, wordAt, type Click, type SelectionEnd } from "./model.ts";
import { itemText, ProjectionCache, rangeText, type TextRange } from "./projection.ts";
import { hitRows } from "./rows.ts";
import { colourQuad, conversationBoxFinder, coveredAt, inside as insideViewport, itemIdOf, itemNear, RowMaps, visitViewportCells } from "./cells.ts";

/** The `selection` layer outranks the focus-scoped contexts (10) and the global layer (0). */
export const SELECTION_PRIORITY = 20;

/** Auto-scroll: one step per this many milliseconds while the pointer is at an edge. */
export const AUTO_SCROLL_MS = 40;

export interface SelectionMount {
  /** The mouse hook for renderer/mouse.ts (`installMouseInput`'s `intercept`). */
  readonly intercept: MouseIntercept;
  /** Mounted inside the App (its `overlay` slot); draws nothing itself. */
  readonly overlay: () => JSX.Element;
}

/** Whether releasing a drag (or a double or triple click) copies the selection by default: the
 *  setting `selection.copy_on_release` (on by default). */
export const DEFAULT_COPY_ON_RELEASE = true;

export interface SelectionOptions {
  /** The `clipboard` setting (or `--clipboard`): the copy paths; default `auto`. */
  readonly clipboard?: ClipboardModeSource;
  /** Overrides `selection.copy_on_release` (tests); without it the setting is read from the
   *  configuration at each release (live on a reload). Off, a release only ends the selection,
   *  which stays highlighted until Ctrl+C copies it or it is cleared. */
  readonly copyOnRelease?: boolean;
  /** Replaces the clipboard (in-process tests record the text instead of copying it). */
  readonly copier?: (options: CopierOptions) => Copier;
}

export function createSelection(options: SelectionOptions = {}): SelectionMount {
  let handler: MouseIntercept | null = null;
  return {
    intercept: (report, dispatch) => (handler ? handler(report, dispatch) : dispatch(report)),
    overlay: () => <SelectionLayer bind={(h) => (handler = h)} mode={options.clipboard ?? "auto"} copier={options.copier ?? createCopier} copyOnRelease={options.copyOnRelease} />,
  };
}

function SelectionLayer(props: {
  bind: (handler: MouseIntercept | null) => void;
  mode: ClipboardModeSource;
  copier: (options: CopierOptions) => Copier;
  copyOnRelease: boolean | undefined;
}): JSX.Element {
  const renderer = useRenderer();
  const { store, theme, logger } = useApp();
  const config = useConfig();
  const copyOnRelease = (): boolean => props.copyOnRelease ?? config().selection.copy_on_release;
  const { keymap, keyMap, controller } = useKeys();
  const vm = store.conversation;
  const glyphs = LIVE_GLYPHS;
  const projections = new ProjectionCache();
  const rowMaps = new RowMaps(glyphs, () => theme.flat, projections);
  const copier = props.copier({ renderer, logger, mode: props.mode });

  let selection: TextRange | null = null;
  let drag: { anchor: SelectionEnd; pressX: number; pressY: number; moved: boolean; x: number; y: number } | null = null;
  let click: Click | null = null;
  let swallowRelease = false;
  let autoTimer: ReturnType<typeof setInterval> | null = null;
  const conversationBox = conversationBoxFinder(renderer);

  // -- The model, read from the reducer's plain snapshot (not the store's proxies) ------------

  let indexed: { order: readonly string[]; index: Map<string, number> } | null = null;
  const snapshot = (): Session => store.snapshot();
  const index = (id: string): number => {
    const order = snapshot().order;
    if (indexed?.order !== order) indexed = { order, index: new Map(order.map((itemId, i) => [itemId, i])) };
    return indexed.index.get(id) ?? -1;
  };
  const itemOf = (id: string): Item | undefined => snapshot().items.get(id);
  /** Shown as its one-liner or less: as the conversation draws it (the density, closed group
   *  lines), else by the view model alone. */
  const collapsed = (id: string): boolean => {
    const shown = controller.conversation()?.collapsed;
    if (shown) return shown(id);
    const item = itemOf(id);
    return item !== undefined && collapsible(item) && !vm.expanded(item);
  };

  // -- Screen to model --------------------------------------------------------------------------

  /** The character under (`x`, `y`), with `y` clamped into the conversation's viewport. */
  function hitAt(x: number, y: number): SelectionEnd | null {
    const b = conversationBox();
    if (!b) return null;
    const vp = b.viewport;
    const row = Math.max(vp.y, Math.min(vp.y + vp.height - 1, y));
    const node = itemNear(b.content.getChildren() as Renderable[], row);
    if (!node) return null;
    const itemId = itemIdOf(node);
    const item = itemOf(itemId);
    if (!item) return null;
    const hit = hitRows(rowMaps.rowsFor(item, node), x - node.x, row - node.y, projections.get(item).text.length);
    return { itemId, ...hit };
  }

  /** In the conversation's viewport and not under an overlay drawn over it. */
  function inside(x: number, y: number): boolean {
    const b = conversationBox();
    return b !== null && insideViewport(b, x, y) && !coveredAt(b, x, y);
  }

  function setSelection(range: TextRange | null): void {
    selection = range;
    renderer.requestRender();
  }

  function updateFocus(): void {
    if (!drag?.moved) return;
    const hit = hitAt(drag.x, drag.y);
    if (hit && index(drag.anchor.itemId) >= 0) selection = dragRange(index, drag.anchor, hit);
  }

  // -- Auto-scroll ------------------------------------------------------------------------------

  /** Rows per step while dragging at an edge: negative up, positive down, 0 inside. */
  function edgeStep(): number {
    const b = conversationBox();
    if (!b || !drag) return 0;
    const vp = b.viewport;
    const bottom = vp.y + vp.height - 1;
    if (drag.y <= vp.y) return -(1 + Math.min(4, (vp.y - drag.y) * 2));
    if (drag.y >= bottom) return 1 + Math.min(4, (drag.y - bottom) * 2);
    return 0;
  }

  function stopAutoScroll(): void {
    if (autoTimer !== null) clearInterval(autoTimer);
    autoTimer = null;
  }

  function autoScrollStep(): void {
    const step = edgeStep();
    const b = conversationBox();
    if (step === 0 || !b) return stopAutoScroll();
    // The scroll bar's change event tells the scroll controller (a scroll "by other means").
    b.scrollTop += step;
    // The focus end is recomputed after the frame's layout (in `paint`).
    renderer.requestRender();
  }

  function updateAutoScroll(): void {
    if (edgeStep() === 0) stopAutoScroll();
    else if (autoTimer === null) autoTimer = setInterval(autoScrollStep, AUTO_SCROLL_MS);
  }

  // -- Copy -------------------------------------------------------------------------------------

  async function copyText(text: string, trigger: string): Promise<void> {
    const outcome = await copier.copy(text, trigger);
    const toast = copyToast(Array.from(text).length, outcome, copier.display);
    controller.notify(toast.text, toast.ok ? "muted" : "warning");
  }

  function selectedText(): string {
    if (!selection || isEmptyRange(selection)) return "";
    const snap = snapshot();
    return rangeText(snap.order, (id) => snap.items.get(id), selection, { cache: projections, collapsed });
  }

  /** The prompt box's selection (day-two-feedback; spec tui-selection "Selection in the prompt
   *  box"): copied by Ctrl+C while the prompt box has focus, ahead of the conversation's. */
  function copyPromptSelection(trigger: string): boolean {
    if (store.ui.focus !== "prompt") return false;
    const text = controller.composer()?.selectedText?.() ?? "";
    if (text === "") return false;
    void copyText(text, trigger);
    return true;
  }

  function copySelection(trigger: string): boolean {
    const text = selectedText();
    if (text === "") return false;
    void copyText(text, trigger);
    return true;
  }

  /** The item under the conversation cursor, as plain text or its Markdown; false (the key is
   *  not ours) unless the conversation has focus. */
  function copyItem(markdown: boolean, trigger: string): boolean {
    if (store.ui.focus !== "conversation") return false;
    const id = vm.cursor();
    const item = id ? itemOf(id) : undefined;
    const text = item ? (markdown ? itemMarkdown(item) : itemText(item, projections)) : "";
    if (text === "") controller.notify("nothing copied: no text under the cursor", "warning");
    else void copyText(text, trigger);
    return true;
  }

  // -- Mouse ------------------------------------------------------------------------------------

  function selectUnit(hit: SelectionEnd, count: number): void {
    const item = itemOf(hit.itemId);
    if (!item) return;
    const text = projections.get(item).text;
    const unit = count === 2 ? wordAt(text, hit.from) : lineAround(text, hit.from);
    setSelection({ anchor: { itemId: hit.itemId, offset: unit.start }, focus: { itemId: hit.itemId, offset: unit.end } });
  }

  const onMouse: MouseIntercept = (report: MouseReport, dispatch) => {
    const { x, y } = report;
    if (report.type === "down" && report.button === 0) {
      drag = null;
      swallowRelease = false;
      if (!inside(x, y)) return dispatch(report);
      click = nextClick(click, x, y, Date.now());
      const hit = hitAt(x, y);
      if (click.count >= 2 && hit) {
        selectUnit(hit, click.count);
        swallowRelease = true;
        return true;
      }
      setSelection(null);
      if (hit) drag = { anchor: hit, pressX: x, pressY: y, moved: false, x, y };
      const handled = dispatch(report);
      // OpenTUI starts its own renderer selection on a press on selectable text: never here.
      if (renderer.getSelection()) renderer.clearSelection();
      return handled;
    }
    if (report.type === "drag" && drag) {
      drag.x = x;
      drag.y = y;
      if (!drag.moved && x === drag.pressX && y === drag.pressY) return true;
      drag.moved = true;
      updateFocus();
      updateAutoScroll();
      renderer.requestRender();
      return true;
    }
    if (report.type === "up" && report.button === 0) {
      if (swallowRelease) {
        swallowRelease = false;
        if (copyOnRelease()) copySelection("release");
        return true;
      }
      const dragged = drag?.moved === true;
      drag = null;
      stopAutoScroll();
      // A press and release on one cell is a click (handed on: the cursor, a header toggle).
      if (dragged) {
        if (copyOnRelease()) copySelection("release");
        return true;
      }
    }
    return dispatch(report);
  };
  props.bind(onMouse);
  controller.setSelectionProbe(() => selection !== null && !isEmptyRange(selection));

  // -- Highlight --------------------------------------------------------------------------------

  const paint = (buffer: OptimizedBuffer): void => {
    // At most one selection exists: one made in the prompt box, by keys or a drag, clears this one
    // (the reverse is the press that starts a selection here, which clears OpenTUI's).
    if (selection && controller.composer()?.hasSelection?.()) {
      selection = null;
      drag = null;
      stopAutoScroll();
    }
    updateFocus();
    const range = selection;
    if (!range || isEmptyRange(range)) return;
    const b = conversationBox();
    if (!b) return;
    const { start, end } = rangeEnds(index, range);
    const first = index(start.itemId);
    const last = index(end.itemId);
    if (first < 0 || last < 0) return;
    const attributes = buffer.buffers.attributes;
    const quad = theme.flat ? null : colourQuad(theme.color("surface.selection"));
    let bounds = { item: "", s: 0, e: 0 };
    visitViewportCells(
      buffer,
      b,
      (itemId, node) => {
        const i = index(itemId);
        if (i < first || i > last) return null;
        const item = itemOf(itemId);
        if (!item) return null;
        return rowMaps.rowsFor(item, node);
      },
      (itemId, from, to, cell) => {
        if (bounds.item !== itemId) {
          const i = index(itemId);
          bounds = { item: itemId, s: i === first ? start.offset : 0, e: i === last ? end.offset : Number.POSITIVE_INFINITY };
        }
        if (from >= bounds.e || to <= bounds.s) return;
        if (quad === null) attributes[cell] = attributes[cell]! | TextAttributes.INVERSE;
        else buffer.buffers.bg.set(quad, cell * 4);
      },
    );
  };
  renderer.addPostProcessFn(paint);

  // -- Keys -------------------------------------------------------------------------------------

  const removeSelectionKeys = registerContext(
    keymap,
    keyMap,
    "selection",
    {
      // Ctrl+C (design D7): the prompt box's selection while it has focus and holds one
      // (day-two-feedback); else the conversation's selection; else, with the conversation
      // focused, the item under the cursor; else nothing. Always consumed, so it never reaches
      // clear, cancel or exit.
      copy: () => {
        if (!copyPromptSelection("ctrl+c") && !copySelection("ctrl+c")) copyItem(false, "ctrl+c");
        return true;
      },
      // Ctrl+Shift+C (design D7): a selection as plain text (a slice of Markdown source could cut
      // a fence or a table in half), else the cursor item's Markdown; always consumed.
      copyRich: () => {
        if (!copyPromptSelection("ctrl+shift+c") && !copySelection("ctrl+shift+c")) copyItem(true, "ctrl+shift+c");
        return true;
      },
      // Esc clears a selection and does nothing else: the prompt box's (tui-selection "Esc clears
      // first"), else the conversation's.
      clear: () => {
        if (controller.composer()?.clearSelection?.()) {
          renderer.requestRender();
          return true;
        }
        if (!selection) return false;
        setSelection(null);
        return true;
      },
    },
    { priority: SELECTION_PRIORITY },
  );
  // Ctrl+X (tui-keymap "Prompt box selection keys"): copies the prompt box's selection through the
  // copy paths above, with their toast, and removes it from the draft (undo brings it back). A
  // global layer that acts only while the prompt box has focus, so the clipboard stays here; with
  // nothing selected it does nothing.
  const removeCutKey = registerContext(keymap, keyMap, "prompt", {
    cut: () => {
      if (store.ui.focus !== "prompt") return false;
      const text = controller.composer()?.cutSelection?.() ?? "";
      if (text !== "") void copyText(text, "ctrl+x");
      return true;
    },
  });
  // A global layer that acts only while the conversation has focus, so it keeps working if the
  // conversation remounts (the `conversation` context's own layer is on its focus box).
  const removeItemKeys = registerContext(keymap, keyMap, "conversation", {
    copyItem: () => copyItem(false, "y"),
    copyItemMarkdown: () => copyItem(true, "Y"),
  });

  onCleanup(() => {
    props.bind(null);
    controller.setSelectionProbe(null);
    stopAutoScroll();
    renderer.removePostProcessFn(paint);
    removeSelectionKeys();
    removeCutKey();
    removeItemKeys();
    void copier.dispose();
  });
  return null;
}
