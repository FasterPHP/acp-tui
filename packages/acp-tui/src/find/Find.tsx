// Find and export (design of record 6.3 "Find"; decision 2,
// research/full-screen-synthesis.md section 4). Mounted by app/run.tsx:
// `createFind()` gives a `find` block (the bar: one row directly above the
// status row in the default layout, no rows while closed, so the conversation
// gives up a row only while it is open; mvp-conversation design D10) and a
// component for the App's overlay slot (the keys, the highlight and the
// export).
//
// Find:
//
// - Ctrl+F (the global `find` action) opens the bar and gives it focus,
//   remembering the reading position (the top item and offset, or following)
//   and the focus. The last query stays in the bar. Typing searches every
//   item's plain-text projection (src/find/index.ts: collapsed content
//   included, smart case) and shows the count (`17 hits`); the view does not
//   move until Enter.
// - Enter or F3 goes to the next hit, Shift+Enter (or `ESC CR`) or Shift+F3
//   to the previous one (Shift+F3 only where the terminal sends it in the
//   kitty form, `CSI 13 ; 2 ~`: the xterm form, `CSI 1 ; 2 R`, never reaches
//   the app, because OpenTUI 0.5.12 takes any `CSI 1 ; n R` for a capability
//   reply; Shift+Enter is the alternative); the first Enter goes to the first hit at or after
//   the top item on screen when the bar opened, wrapping to the first
//   (Shift+Enter to the last one before it).
//   The counter then reads `3 of 17`. F3 and Shift+F3 with the bar closed
//   reopen it and step. Each step searches again, so items that arrived
//   since are included.
// - The hit's item is shown through the conversation's find handle
//   (keys/controller.ts `ConversationFindHandle`): expanded when the hit lies
//   beyond what the collapsed line shows (`summaryEnd`; 0 for a plan, whose
//   collapsed line shows no entry), a group line hiding
//   it opened, mounted if the windowed list has it outside the window, and
//   scrolled into view; once it is drawn, the hit's row is brought into view
//   if it is not (a third of the way down).
// - Expansion is recorded in the view model as a user choice
//   (`expandRecorded`), with what puts it back. The choice made here: an item
//   stays expanded only while it holds the current hit; moving to a hit in
//   another item, changing the query or Esc puts the previous item's state
//   back (the user's own earlier choice, or none). Tab keeps the item
//   expanded, since the reader went there.
// - Esc closes the bar, puts that state back and restores the reading
//   position and focus from when the bar opened. Tab closes it and moves
//   focus to the conversation with the cursor on the hit's item; a click
//   elsewhere closes it where it is.
// - Highlight: a post-process pass over the mounted items in the viewport
//   (src/selection/cells.ts, the same row maps as the selection): the
//   current hit on `find.current`, bold, every other visible hit on
//   `find.other`, both in the default foreground (derived amber fills,
//   src/theme/derive.ts; S5, IDE session B2: the current hit had been
//   inverse video in `warning`, about 1.7:1 on a light theme). Under the
//   flat theme the current hit is in inverse video and bold, the others
//   underlined (also where a cell already has the `find.other` fill).
// - Log (`ACP_TUI_LOG`), never the query text: `find` events with `action`
//   `open`, `search` (`queryLength`, `hits`, `caseSensitive`, `ms`), `step`
//   (`direction`, `index`, `hits`, `searchMs`), `shown` (`index`, `ms` from
//   the key to the frame whose post-process drew the hit in the viewport,
//   `frames`, `scrolls`, `mapped`: false when the hit's row could not be
//   found and the item's reveal is all there is) and `close` (`how`), and
//   `warm` (`items`, `ms`) when the projections computed ahead of a search
//   (src/find/warm.ts) have caught up with the items.
// - The first search's cost (tui-find "Search cost"): every item's
//   projection is computed in idle slices as it arrives or becomes final
//   (warm.ts), never in a frame, so a search only scans text.
//
// Export (task 15.3): `e` with the conversation focused (a new `conversation`
// action, `export`, so the S6 palette lists it under Conversation) writes
// `conversationMarkdown` to a new file (src/find/export-file.ts), shows the
// path in the prompt box's top border and logs `export` (`path`, `bytes`,
// `items`, `fallback`, `ms`).
import { decodePasteBytes, TextAttributes, type BoxRenderable, type KeyEvent, type OptimizedBuffer, type PasteEvent } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import { batch, createEffect, createSignal, For, on, onCleanup, Show, type JSX } from "solid-js";
import { relative, sep } from "node:path";
import { sanitise, type Item, type Session } from "acp-model";
import { useApp } from "../app/context.ts";
import { shortenHome } from "../layout/segments.ts";
import { userHome } from "../platform/paths.ts";
import { LIVE_GLYPHS } from "../conversation/live-glyphs.ts";
import { groupKeyItem } from "../conversation/window/entries.ts";
import { typedText } from "../card/elicitation.tsx";
import { useKeys } from "../keys/context.ts";
import type { ConversationFindHandle, ReadingPosition } from "../keys/controller.ts";
import { registerContext } from "../keys/register.ts";
import type { BlockComponent, BlockProps } from "../layout/Screen.tsx";
import type { BlockName } from "../layout/layout.ts";
import type { Focus } from "../layout/view.ts";
import { spanStyle } from "../theme/index.ts";
import { colourQuad, conversationBoxFinder, hasBackground, isItemNode, itemIdOf, RowMaps, visitViewportCells } from "../selection/cells.ts";
import { conversationMarkdown } from "../selection/export.ts";
import { ProjectionCache } from "../selection/projection.ts";
import { barHints, barRow, pasteQuery } from "./bar.ts";
import { writeExport } from "./export-file.ts";
import { FindIndex, firstHitFrom, stepHit, type FindHit, type FindResult } from "./index.ts";
import { ProjectionWarmer } from "./warm.ts";

/** The `find` layer outranks the focus-scoped contexts (10); it acts only while the bar has focus. */
export const FIND_PRIORITY = 15;

/** Frames to wait for the hit's item to be mounted and drawn before giving up. */
export const SHOW_FRAMES = 120;

export interface FindMount {
  /** Blocks that replace the app's own: the find bar. */
  readonly blocks: Partial<Record<BlockName, BlockComponent>>;
  /** Mounted inside the App (its overlay slot): keys, highlight, export; draws nothing itself. */
  readonly overlay: () => JSX.Element;
}

/** The state the bar (in the prompt block) and the layer (in the overlay slot) share. */
interface FindState {
  readonly open: () => boolean;
  setOpen(open: boolean): void;
  readonly query: () => string;
  setQuery(query: string): void;
  readonly result: () => FindResult | null;
  setResult(result: FindResult | null): void;
  readonly current: () => number;
  setCurrent(index: number): void;
  /** Set by the layer: the bar's typing. */
  type?: (key: KeyEvent) => void;
  /** Set by the layer: a bracketed paste into the bar. */
  paste?: (event: PasteEvent) => void;
}

function createFindState(): FindState {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [result, setResult] = createSignal<FindResult | null>(null);
  const [current, setCurrent] = createSignal(-1);
  return {
    open,
    setOpen: (v) => void setOpen(v),
    query,
    setQuery: (v) => void setQuery(v),
    result,
    setResult: (v) => void setResult(v),
    current,
    setCurrent: (v) => void setCurrent(v),
  };
}

export function createFind(): FindMount {
  const state = createFindState();
  return {
    blocks: { find: (props: BlockProps) => <FindBlock {...props} state={state} /> },
    overlay: () => <FindLayer state={state} />,
  };
}

// ------------------------------------------------------------------ the bar

/** The bar while find is open (one row), nothing otherwise. */
function FindBlock(props: BlockProps & { state: FindState }): JSX.Element {
  createEffect(() => props.onHeight(props.state.open() ? 1 : 0));
  return (
    <Show when={props.state.open()}>
      <FindBar state={props.state} width={props.width} />
    </Show>
  );
}

function FindBar(props: { state: FindState; width: number }): JSX.Element {
  const { store, theme } = useApp();
  const { keyMap } = useKeys();
  // Read in the row, so a key map reloaded from the configuration is named.
  const row = () =>
    barRow({
      query: props.state.query(),
      hits: props.state.result()?.hits.length ?? 0,
      current: props.state.current(),
      width: props.width,
      hints: barHints(keyMap),
    });
  const style = (s: { token: Parameters<typeof theme.text>[0]; cursor?: boolean }) => {
    const base = theme.text(s.token);
    const focused = store.ui.focus === "find";
    return spanStyle(s.cursor && focused ? { ...base, attributes: base.attributes | TextAttributes.INVERSE } : base);
  };
  return (
    <box
      height={1}
      flexShrink={0}
      width="100%"
      focusable
      focused={store.ui.focus === "find"}
      backgroundColor={theme.color("surface.card")}
      onKeyDown={(key: KeyEvent) => props.state.type?.(key)}
      onPaste={(event: PasteEvent) => props.state.paste?.(event)}
      onMouseDown={() => store.setFocus("find")}
    >
      <text wrapMode="none" height={1} {...theme.text("text")}>
        <For each={row()}>{(s) => <span style={style(s)}>{s.text}</span>}</For>
      </text>
    </box>
  );
}

// ------------------------------------------------------------------ the layer

function FindLayer(props: { state: FindState }): JSX.Element {
  const renderer = useRenderer();
  const { store, theme, logger } = useApp();
  const { keymap, keyMap, controller } = useKeys();
  const { state } = props;
  const vm = store.conversation;
  const projections = new ProjectionCache();
  const index = new FindIndex(projections);
  const rowMaps = new RowMaps(LIVE_GLYPHS, () => theme.flat, projections);
  const conversationBox = conversationBoxFinder(renderer);

  // The model, read from the reducer's plain snapshot: a search over 5000 items through the
  // store's proxies would subscribe to every one of them.
  const snapshot = (): Session => store.snapshot();
  const itemOf = (id: string): Item | undefined => snapshot().items.get(id);
  const handle = (): ConversationFindHandle | null => controller.conversation()?.find ?? null;
  const log = (fields: Record<string, unknown>) => logger?.log({ event: "find", ...fields });

  let saved: ReadingPosition | null = null;
  let returnFocus: Focus = "prompt";
  /** Puts back what showing the current hit's item changed (its collapse state, a group). */
  let undo: { itemId: string; run: () => void } | null = null;
  /** Hits by item, for the highlight. */
  let byItem = new Map<string, FindHit[]>();
  let pending: { hit: FindHit; index: number; t0: number; frames: number; scrolls: number; unmapped: number } | null = null;

  function restoreItem(): void {
    undo?.run();
    undo = null;
  }

  function setResult(result: FindResult | null, current: number): void {
    byItem = new Map();
    for (const hit of result?.hits ?? []) {
      const list = byItem.get(hit.itemId);
      if (list) list.push(hit);
      else byItem.set(hit.itemId, [hit]);
    }
    batch(() => {
      state.setResult(result);
      state.setCurrent(current);
    });
    renderer.requestRender();
  }

  function search(): { result: FindResult; ms: number } {
    const t = performance.now();
    const session = snapshot();
    const result = index.search(state.query(), session.order, (id) => session.items.get(id));
    return { result, ms: performance.now() - t };
  }

  /** A new query: search, count, forget the current hit (its item is put back). */
  function requery(query: string): void {
    state.setQuery(query);
    restoreItem();
    pending = null;
    if (query === "") {
      setResult(null, -1);
      return;
    }
    const { result, ms } = search();
    setResult(result, -1);
    log({ action: "search", queryLength: query.length, hits: result.hits.length, caseSensitive: result.caseSensitive, ms: round(ms) });
  }

  // -- Hits kept current (design D11) -----------------------------------------------------------

  /** At most one re-search per this many ms while items change. */
  const REFRESH_MS = 100;
  let lastRefresh = Number.NEGATIVE_INFINITY;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;

  /** Searches again after items arrived or changed: the counter and the highlights follow, the
   *  view does not move, and the current hit stays by item and offset (lost, it becomes none). */
  function refresh(): void {
    if (!state.open() || state.query() === "") return;
    const previous = state.result()?.hits[state.current()];
    const { result, ms } = search();
    const k = previous ? result.hits.findIndex((h) => h.itemId === previous.itemId && h.start === previous.start) : -1;
    setResult(result, k);
    log({ action: "refresh", hits: result.hits.length, ms: round(ms) });
  }

  // Projections computed in idle time as items arrive or finish (warm.ts), so the first search
  // only scans text. `warm` is logged when the queue drains.
  const warmer = new ProjectionWarmer(projections, () => {
    const session = snapshot();
    return (id) => session.items.get(id);
  }, {
    order: () => snapshot().order,
    onDrained: ({ projected, ms }) => logger?.log({ event: "find", action: "warm", items: projected, ms: round(ms) }),
  });
  {
    const session = snapshot();
    warmer.add(session.order.map((id) => session.items.get(id)).filter((item): item is Item => item !== undefined));
  }

  const removeChange = store.onChange((change) => {
    if (change.items.length > 0) warmer.add(change.items.map((c) => c.item));
    if (!state.open() || change.items.length === 0 || refreshTimer !== null) return;
    const wait = Math.max(0, lastRefresh + REFRESH_MS - performance.now());
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      lastRefresh = performance.now();
      refresh();
    }, wait);
  });

  function open(): void {
    if (!state.open()) {
      saved = handle()?.position() ?? null;
      if (store.ui.focus !== "find") returnFocus = store.ui.focus;
      state.setOpen(true);
      log({ action: "open" });
      if (state.query() !== "") requery(state.query());
    }
    store.setFocus("find");
  }

  function step(delta: 1 | -1): void {
    if (!state.open()) open();
    const query = state.query();
    if (query === "") return;
    const t0 = performance.now();
    const previous = state.result()?.hits[state.current()];
    const { result, ms } = search();
    const n = result.hits.length;
    let k = previous ? result.hits.findIndex((h) => h.itemId === previous.itemId && h.start === previous.start) : -1;
    if (n === 0) {
      restoreItem();
      setResult(result, -1);
      log({ action: "step", direction: delta, index: -1, hits: 0, searchMs: round(ms) });
      return;
    }
    if (k >= 0) k = stepHit(n, k, delta);
    else {
      // From the top item on screen when the bar opened (following or not); a group line's key
      // stands for its first item.
      const top = saved?.anchor?.id ?? null;
      const from = firstHitFrom(result, snapshot().order, top === null ? null : (groupKeyItem(top) ?? top));
      k = delta > 0 ? from : (from - 1 + n) % n;
    }
    log({ action: "step", direction: delta, index: k, hits: n, searchMs: round(ms) });
    goTo(result, k, t0);
  }

  function goTo(result: FindResult, k: number, t0: number): void {
    const hit = result.hits[k]!;
    if (undo && undo.itemId !== hit.itemId) restoreItem();
    const item = itemOf(hit.itemId);
    const h = handle();
    if (item && h) {
      const expand = hit.start >= projections.get(item).summaryEnd;
      const put = h.show(hit.itemId, expand);
      if (put) undo = { itemId: hit.itemId, run: undo?.itemId === hit.itemId ? chain(undo.run, put) : put };
    }
    pending = { hit, index: k, t0, frames: 0, scrolls: 0, unmapped: 0 };
    setResult(result, k);
  }

  function close(how: "escape" | "conversation" | "focus"): void {
    if (!state.open()) return;
    pending = null;
    const hit = state.result()?.hits[state.current()];
    if (how === "escape") {
      restoreItem();
      if (saved) handle()?.restore(saved);
    } else {
      // The reader stays at the hit: its item keeps its state.
      undo = null;
    }
    state.setOpen(false);
    setResult(state.result(), -1);
    log({ action: "close", how });
    if (how === "conversation") {
      if (hit) vm.setCursor(hit.itemId);
      store.setFocus("conversation");
    } else if (how === "escape") {
      let next = returnFocus;
      if (next === "card" && store.session.openPermissionId === null) next = "prompt";
      if (next === "find" || next === "overlay") next = "prompt";
      store.setFocus(next);
    }
    saved = null;
  }

  // Focus taken elsewhere (a click on the prompt box or the conversation) closes the bar where it is.
  createEffect(
    on(
      () => store.ui.focus,
      (focus) => {
        if (focus !== "find" && state.open()) close("focus");
      },
      { defer: true },
    ),
  );

  state.type = (key: KeyEvent) => {
    if (key.name === "backspace") {
      requery(Array.from(state.query()).slice(0, -1).join(""));
      key.preventDefault();
      return;
    }
    const typed = typedText(key);
    if (typed !== null) {
      requery(state.query() + typed);
      key.preventDefault();
    }
  };

  // A bracketed paste is query text, its line breaks spaces (design D11); Ctrl+U clears (below).
  state.paste = (event: PasteEvent) => {
    event.preventDefault();
    const text = pasteQuery(decodePasteBytes(event.bytes));
    if (text !== "") requery(state.query() + text);
  };

  // -- Keys -------------------------------------------------------------------------------------

  const inBar = () => store.ui.focus === "find";
  const removeGlobal = registerContext(keymap, keyMap, "global", {
    find: () => open(),
    findNext: () => step(1),
    findPrevious: () => step(-1),
  });
  const removeBar = registerContext(
    keymap,
    keyMap,
    "find",
    {
      next: () => inBar() && (step(1), true),
      previous: () => inBar() && (step(-1), true),
      close: () => inBar() && (close("escape"), true),
      conversation: () => inBar() && (close("conversation"), true),
      clear: () => inBar() && (requery(""), true),
    },
    { priority: FIND_PRIORITY },
  );
  // `e` with the conversation focused (a global layer that acts only then, as the S4 copy keys).
  const removeExport = registerContext(keymap, keyMap, "conversation", {
    export: () => {
      if (store.ui.focus !== "conversation") return false;
      void exportConversation();
      return true;
    },
  });

  // -- Export -----------------------------------------------------------------------------------

  async function exportConversation(): Promise<void> {
    const t = performance.now();
    const session = snapshot();
    const text = conversationMarkdown(session.order, (id) => session.items.get(id));
    if (text === "") {
      controller.notify("nothing to export: the conversation is empty", "muted");
      return;
    }
    const cwd = session.cwd ?? process.cwd();
    try {
      const result = await writeExport(text, { cwd, sessionId: session.id });
      logger?.log({ event: "export", path: result.path, bytes: result.bytes, items: session.order.length, fallback: result.fallback, ms: round(performance.now() - t) });
      controller.notify(`exported to ${sanitise(shortPath(result.path, cwd), "approval")}`, "muted", 6000);
    } catch (error) {
      logger?.log({ event: "export", error: (error as NodeJS.ErrnoException).code ?? "failed" });
      controller.notify(`export failed: ${sanitise(error instanceof Error ? error.message : String(error), "approval")}`, "warning");
    }
  }

  // -- Highlight --------------------------------------------------------------------------------

  const paint = (buffer: OptimizedBuffer): void => {
    if (!state.open() || byItem.size === 0) return;
    const b = conversationBox();
    if (!b) return;
    const current = state.result()?.hits[state.current()] ?? null;
    const { attributes } = buffer.buffers;
    const flat = theme.flat;
    const other = flat ? null : colourQuad(theme.color("find.other"));
    const strong = flat ? null : colourQuad(theme.color("find.current"));
    const text = colourQuad(theme.color("text"));
    let drawn = false;
    let hits: FindHit[] = [];
    let hitsOf = "";
    visitViewportCells(
      buffer,
      b,
      (itemId, node) => {
        if (!byItem.has(itemId)) return null;
        const item = itemOf(itemId);
        return item ? rowMaps.rowsFor(item, node) : null;
      },
      (itemId, from, to, cell) => {
        if (hitsOf !== itemId) {
          hits = byItem.get(itemId) ?? [];
          hitsOf = itemId;
        }
        const hit = hits.find((h) => from < h.end && to > h.start);
        if (!hit) return;
        if (current && hit.itemId === current.itemId && hit.start === current.start) {
          buffer.buffers.fg.set(text, cell * 4);
          if (strong === null) attributes[cell] = attributes[cell]! | TextAttributes.INVERSE | TextAttributes.BOLD;
          else {
            buffer.buffers.bg.set(strong, cell * 4);
            attributes[cell] = attributes[cell]! | TextAttributes.BOLD;
          }
          drawn = true;
        } else if (other === null || hasBackground(buffer, cell, other)) {
          attributes[cell] = attributes[cell]! | TextAttributes.UNDERLINE;
        } else {
          buffer.buffers.fg.set(text, cell * 4);
          buffer.buffers.bg.set(other, cell * 4);
        }
      },
    );
    if (pending) settleShow(drawn);
  };
  renderer.addPostProcessFn(paint);

  /** After a frame: log the hit as shown, or bring its row into view, or wait for its item. */
  function settleShow(drawn: boolean): void {
    const p = pending;
    if (!p) return;
    p.frames++;
    if (drawn) {
      pending = null;
      log({ action: "shown", index: p.index, ms: round(performance.now() - p.t0), frames: p.frames, scrolls: p.scrolls, mapped: true });
      return;
    }
    const b = conversationBox();
    const node = b ? (b.content.getChildren() as BoxRenderable[]).find((c) => isItemNode(c) && itemIdOf(c) === p.hit.itemId) : undefined;
    const item = itemOf(p.hit.itemId);
    if (b && node && item) {
      const rows = rowMaps.rowsFor(item, node);
      const span = rows.spans.find((s) => {
        for (let c = 0; c < s.from.length; c++) if (s.from[c]! >= p.hit.start && s.from[c]! < p.hit.end) return true;
        return false;
      });
      const vp = b.viewport;
      if (span) {
        const y = node.y + span.y;
        if ((y < vp.y || y >= vp.y + vp.height) && p.scrolls < 5) {
          p.scrolls++;
          const delta = y - (vp.y + Math.floor(vp.height / 3));
          queueMicrotask(() => handle()?.scrollBy(delta));
          return;
        }
      } else if (node.y < vp.y + vp.height && node.y + node.height > vp.y && ++p.unmapped > 10) {
        // The item is on screen but no drawn row shows the hit (a gap in the row maps).
        pending = null;
        log({ action: "shown", index: p.index, ms: round(performance.now() - p.t0), frames: p.frames, scrolls: p.scrolls, mapped: false });
        return;
      }
    }
    if (p.frames >= SHOW_FRAMES) {
      pending = null;
      log({ action: "shown", index: p.index, ms: round(performance.now() - p.t0), frames: p.frames, scrolls: p.scrolls, mapped: false, gaveUp: true });
      return;
    }
    // Keep frames coming until the item is mounted and drawn (a render requested during this
    // frame's post-process would be dropped).
    setTimeout(() => renderer.requestRender(), 16);
  }

  onCleanup(() => {
    state.type = undefined;
    state.paste = undefined;
    removeChange();
    warmer.dispose();
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    renderer.removePostProcessFn(paint);
    removeGlobal();
    removeBar();
    removeExport();
  });
  return null;
}

function chain(a: () => void, b: () => void): () => void {
  return () => {
    b();
    a();
  };
}

function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}

/** `./name` inside `cwd`, else the path with the home directory as `~`. */
function shortPath(path: string, cwd: string): string {
  const rel = relative(cwd, path);
  if (rel !== "" && !rel.startsWith("..") && !rel.startsWith(sep)) return `.${sep}${rel}`;
  return shortenHome(path, userHome());
}
