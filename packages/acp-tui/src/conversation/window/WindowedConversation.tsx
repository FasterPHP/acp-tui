// The conversation view (design of record 6.2; decisions 4, 8 and 9,
// research/full-screen-synthesis.md section 4; spec tui-conversation): the
// conversation region of the screen layout (`APP_BLOCKS` in app/App.tsx), the
// only list. One scroll box, the `conversation` key context, PgUp and PgDn,
// Ctrl+O, the wheel and clicks, the scroll controller of ../scroll.ts, and:
//
// - Entries, not items (entries.ts): the rows are built from the model under a
//   density (`compact`, `verbose`, `focus`; the key map's `cycleDensity` (`v`)
//   action switches it, and a notice names the new one), with runs of
//   reads, searches, fetches and thoughts grouped into one expandable line in
//   `compact` and one line per turn for tool calls and thoughts in `focus`.
//   The cursor moves by entry, and jumps to the previous or next prompt or tool
//   call (`jump`); Enter, a click or Ctrl+O toggles an entry (a
//   group line opens and closes; Ctrl+O on a call hidden in a closed group
//   opens the group first).
// - A window (range.ts): only the entries in `[start, end)` are mounted, between
//   a top and a bottom spacer box whose heights come from the per-item,
//   per-width height cache (heights.ts); the tail 40 while following, growing
//   by chunks of 60 as the viewport nears an edge, at most 160.
// - Virtual geometry (geometry.ts): the scroll controller sees every entry,
//   mounted or not, so paging, the cursor, reveal and anchors work across the
//   whole conversation. A key that moves the view (PgUp, PgDn, Home, End, the
//   cursor, a reveal) acts on the last layout, then mounts what the new view
//   needs before the next frame; the frame's layout puts the anchored entry
//   back on its screen row (anchor compensation), so a chunk whose real
//   heights differ from the estimates does not move what the reader sees.
//   The wheel does the same through the scroll bar's change event; anything
//   else (a resize, a taller prompt box) is caught after the frame's layout.
//
// The model is read from the reducer's plain snapshot (`store.snapshot()`)
// once per macrotask of updates, not through the store's proxies: building
// the entries is linear in the conversation, and a 5000-item session arrives
// in thousands of updates.
//
// Private OpenTUI internals: none beyond ../scroll.ts's (the ScrollBox
// content's `onUpdate`, wrapped by `ConversationScrollBox`). The computed
// layout (`getLayout()`, native since OpenTUI 0.6) is public. The Markdown
// `SyntaxStyle` is owned by the renderer's native scene (OpenTUI 0.6 gives
// every native resource an owner), so it is created per mount, never cached.
import { CliRenderEvents, SyntaxStyle, type BoxRenderable } from "@opentui/core";
import { extend, useRenderer, useTerminalDimensions } from "@opentui/solid";
import { batch, createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, untrack, type Accessor, type JSX } from "solid-js";
import { createStore } from "solid-js/store";
import type { Item, Session } from "acp-model";
import { useApp, useConfig } from "../../app/context.ts";
import { useKeys } from "../../keys/context.ts";
import { keyLabel, keysFor } from "../../keys/keymap.ts";
import { registerContext, type ContextHandlers } from "../../keys/register.ts";
import { fitSegments } from "../../layout/segments.ts";
import { isPrimaryPress } from "../../renderer/mouse.ts";
import { DEFAULT_WHEEL, WheelAccumulator } from "../../renderer/wheel.ts";
import { markdownStyles } from "../../theme/index.ts";
import { viewerTarget } from "../content.ts";
import { glyphsVersion, LIVE_GLYPHS } from "../live-glyphs.ts";
import { renderSettingsKey } from "../markdown/context.ts";
import { createSpinner, CursorBar, cursorFill, Gutter, ItemView, Segments, type ItemContext } from "../items.tsx";
import { ConversationScrollBox, ScrollController } from "../scroll.ts";
import { expandedByDefault, expandRecorded, moveCursor, type ConversationViewModel } from "../view-model.ts";
import { buildEntries, firstItem, fromRecord, groupKeyItem, groupLine, jumpTarget, nextDensity, type Density, type EntryList, type GroupEntry } from "./entries.ts";
import { EMPTY_LIST, WindowGeometry } from "./geometry.ts";
import { estimateHeight, HeightCache } from "./heights.ts";
import { nextRange, prefixRows, remapRange, rowsAround, sameRange, tailStart, WINDOW_SIZES, type Range, type WindowSizes } from "./range.ts";

extend({ window_scrollbox: ConversationScrollBox });

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    window_scrollbox: typeof ConversationScrollBox;
  }
}

/** What outlives a remount of the region, per conversation view model (so per store). */
interface WindowState {
  readonly density: Accessor<Density>;
  setDensity(density: Density): void;
  /** Open group lines by key. */
  readonly open: Record<string, boolean>;
  setOpen(key: string, open: boolean): void;
  readonly cache: HeightCache;
}

const states = new WeakMap<ConversationViewModel, WindowState>();

function windowState(vm: ConversationViewModel, initial: Density): WindowState {
  let state = states.get(vm);
  if (!state) {
    const [density, setDensity] = createSignal<Density>(initial);
    const [open, setOpen] = createStore<Record<string, boolean>>({});
    state = { density, setDensity, open, setOpen: (key, value) => setOpen(key, value), cache: new HeightCache() };
    states.set(vm, state);
  }
  return state;
}

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/** The entry's key for an entry key that is no longer in `list` (a group dissolved or closed, a
 *  density switched): the entry that now shows its first item. */
function resolveKey(key: string, list: EntryList): string | null {
  if (list.index.has(key)) return key;
  const at = list.holder.get(groupKeyItem(key) ?? key);
  return at === undefined ? null : list.keys[at]!;
}

/** Columns of the conversation's right margin, as wide as its left gutter (spec tui-layout
 *  "Conversation right margin"); never drawn in. */
export const RIGHT_MARGIN = 2;

/** Columns of the scroll bar while `layout.scrollbar` is on (../scrollbar.ts). */
export const SCROLLBAR_COLUMNS = 1;

/** The window's sizes while a load replays and the view follows: no minimum tail
 *  (history-replay-pacing design D4). */
const LOAD_SIZES: WindowSizes = { ...WINDOW_SIZES, tail: 0 };

interface View {
  readonly list: EntryList;
  readonly range: Range;
}

/** The conversation region with the windowed list. */
export function WindowedConversation(props: { readonly scrollbar?: boolean } = {}): JSX.Element {
  const { store, theme, wheel, logger, scrollbar } = useApp();
  // `layout.scrollbar` (the layout in use; mvp-configuration task 6.5), read reactively, so a
  // reload switches the bar at the next frame and the entries are laid out again at the new width,
  // keeping the reading position as a resize does.
  const barShown = () => scrollbar !== undefined && (props.scrollbar ?? true);
  const { controller, keymap, keyMap } = useKeys();
  const vm = store.conversation;
  // The density a session starts in is the `density` setting (mvp-configuration task 4.5).
  const config = useConfig();
  const state = windowState(vm, untrack(() => config().density));
  const renderer = useRenderer();
  const dims = useTerminalDimensions();
  // The entries are laid out, estimated and measured narrower than the region by its right margin
  // (two blank columns, as wide as the gutter on the left; spec tui-layout "Conversation right
  // margin") and, while `layout.scrollbar` is on, the scroll bar's column right of it: 60 text
  // columns at 63 with the bar, 61 without. The margin is the scroll box content's right padding,
  // so it lies inside the viewport (a press there is a press on blank conversation) but outside
  // every item, and nothing (text, cards, the cursor, selection or find highlights) is drawn there.
  const width = () => dims().width - RIGHT_MARGIN - (barShown() ? SCROLLBAR_COLUMNS : 0);
  let box: ConversationScrollBox | undefined;
  let focusBox: BoxRenderable | undefined;
  let topSpacer: BoxRenderable | undefined;
  let bottomSpacer: BoxRenderable | undefined;
  let scroll: ScrollController | null = null;
  const nodes = new Map<string, BoxRenderable>();
  const focused = () => store.ui.focus === "conversation";

  // ------------------------------------------------------------ the model and the entries

  // Re-read the reducer's snapshot once per macrotask of updates. A change while a load replays
  // (and the one that ends it) is one notification of the batched replay, which the drain already
  // coalesces and gives a turn outside frames (agent/client-handler.ts): re-read at once, so the
  // window is mounted in that turn and never in a later timer that falls inside a frame
  // (history-replay-pacing design D3).
  const [version, setVersion] = createSignal(0);
  let bumpTimer: ReturnType<typeof setTimeout> | null = null;
  const bump = (): void => {
    if (bumpTimer !== null) clearTimeout(bumpTimer);
    bumpTimer = null;
    setVersion((v) => v + 1);
  };
  const offChange = store.onChange((change) => {
    if (change.session.replaying || change.previous.replaying) return bump();
    bumpTimer ??= setTimeout(bump, 0);
  });
  onCleanup(() => {
    offChange();
    if (bumpTimer !== null) clearTimeout(bumpTimer);
  });
  const snapshot = (): Session => {
    version();
    return store.snapshot();
  };

  /** Expanded under the density unless the user toggled the item (their choice wins). */
  const expandedFor = (item: Item): boolean => {
    if (!vm.collapsible(item)) return false;
    if (vm.toggled(item.id)) return vm.expanded(item);
    if (state.density() === "verbose") return true;
    return expandedByDefault(item);
  };

  const list = createMemo<EntryList>(() => {
    const session = snapshot();
    return buildEntries(session.order, (id) => session.items.get(id), {
      density: state.density(),
      open: (key) => state.open[key] ?? false,
    });
  });

  // The density is published to the store for the status row's `density` module.
  createEffect(() => store.setDensity(state.density()));
  createEffect(() => store.setDensitySetting(config().density));

  // The `↓ N new` indicator: the items shown when the reader left the bottom, against the items
  // shown now (a group line hides items but still holds them, so the count does not depend on the
  // density or on runs forming).
  const shownItems = () => list().holder.size;
  const [leftAt, setLeftAt] = createSignal<number | null>(null);
  const newBelow = createMemo(() => {
    const at = leftAt();
    return at === null ? 0 : Math.max(0, shownItems() - at);
  });
  let lastPosition = { following: true, percent: 100, below: 0 };
  const publishScroll = () => store.setScroll({ ...lastPosition, newBelow: lastPosition.following ? 0 : newBelow() });
  createEffect(on(newBelow, publishScroll, { defer: true }));

  // ------------------------------------------------------------ heights

  const estimates = new WeakMap<Item, Map<string, number>>();
  // The rendering settings (`markdown.*`, `tool_output.snippet_rows`) are in the key, so a reload
  // that changes them measures and estimates every item again.
  const variantOf = (item: Item) => `${expandedFor(item) ? "e" : "c"}${theme.flat ? "f" : ""}${item.kind === "tool_call" && vm.outputShown(item.id) ? "a" : ""}|${renderSettingsKey()}`;
  /** An entry's body height: the cache's measurement, else an estimate (memoised per item). */
  function entryHeight(l: EntryList, i: number, session: Session, w: number): number {
    const entry = l.entries[i]!;
    if (entry.kind === "group") return state.cache.get(entry.key, w, { ref: null, variant: "group" }, () => 1);
    const item = session.items.get(entry.key);
    if (!item) return 1;
    // The glyph set is part of the variant: a footnote's brackets, say, change a row's width.
    const base = variantOf(item);
    const variant = `${base}${glyphsVersion()}`;
    return state.cache.get(entry.key, w, { ref: item, variant }, () => {
      let byItem = estimates.get(item);
      if (!byItem) estimates.set(item, (byItem = new Map()));
      const key = `${w}|${variant}`;
      let h = byItem.get(key);
      if (h === undefined) {
        const options = { glyphs: LIVE_GLYPHS, flat: theme.flat, fullOutput: base.split("|")[0]!.endsWith("a") };
        byItem.set(key, (h = estimateHeight(item, w, base.startsWith("e"), options)));
      }
      return h;
    });
  }

  /** Content rows above each entry's slot, from the cache and estimates (tracks the list, the
   *  width, toggles and the theme's flatness). */
  const prefix = createMemo(() => {
    const l = list();
    const session = store.snapshot();
    const w = width();
    return prefixRows(l.entries.length, (i) => l.entries[i]!.margin, (i) => entryHeight(l, i, session, w));
  });

  // ------------------------------------------------------------ the window

  const geometry = new WindowGeometry({
    scrollTop: () => box?.scrollTop ?? 0,
    setScrollTop(top, content, viewport) {
      if (!box) return;
      // Guarded from the sizes on: setting them moves the scroll bar's slider, which emits
      // `change`. Unguarded, that change was taken for a reader's scroll in the frame's layout
      // step, and `ensureWindow` mounted entries there, after Yoga's layout: their first layout
      // was NaN by NaN, and OpenTUI failed to create the frame buffers of the Markdown tables
      // (21 console errors and warnings on the switch to `focus`; S3, IDE session B2 finding 1).
      applying = true;
      try {
        // The scroll bar clamps to the sizes it knows; give it this snapshot's first.
        box.verticalScrollBar.scrollSize = content;
        box.verticalScrollBar.viewportSize = viewport;
        box.scrollTop = top;
      } finally {
        applying = false;
      }
    },
  });
  let applying = false;
  const viewportRows = () => geometry.viewportHeight() || dims().height;

  /** True while a load's history arrives (`session/load`). */
  const loading = (): boolean => store.snapshot().replaying;

  /** The tail while following: 40 entries, or more to cover the viewport and a margin. While a
   *  load replays, only the entries that cover the viewport (history-replay-pacing design D4):
   *  each notification of a load appends more than the tail, so it remounts all of it, and a
   *  smaller one is cheaper to mount and draw; the load's last notification mounts the tail. */
  const tailRange = (l: EntryList): Range => {
    const n = l.entries.length;
    if (loading()) return { start: Math.max(0, tailStart(prefix(), viewportRows())), end: n };
    return { start: Math.max(0, Math.min(n - WINDOW_SIZES.tail, tailStart(prefix(), 2 * viewportRows()))), end: n };
  };

  // A range chosen for a given list (scrolling, jumps); any other list change follows the tail or
  // remaps the window's edges to the same model items.
  const [chosen, setChosen] = createSignal<View | null>(null);
  const view = createMemo<View>((previous) => {
    const l = list();
    const pick = chosen();
    if (pick && pick.list === l) return pick;
    if (previous === undefined || previous.list === EMPTY_LIST) return { list: l, range: tailRange(l) };
    if (previous.list === l) return previous;
    return { list: l, range: untrack(() => vm.following) ? tailRange(l) : remapRange(previous.list, l, previous.range) };
  });
  const mountedKeys = createMemo(
    () => {
      const { list: l, range } = view();
      return l.keys.slice(range.start, range.end);
    },
    undefined,
    { equals: sameIds },
  );
  const spacers = createMemo(
    () => {
      const { list: l, range } = view();
      const p = prefix();
      if (p.length !== l.entries.length + 1) return { top: 0, bottom: 0 };
      return { top: p[range.start]!, bottom: p[l.entries.length]! - p[range.end]! };
    },
    undefined,
    { equals: (a, b) => a.top === b.top && a.bottom === b.bottom },
  );

  /** Mounts what the view needs, from the last layout; a no-op while the list has changed since
   *  (the next layout's check covers it). */
  function ensureWindow(): void {
    if (!scroll || !geometry.ready) return;
    const current = view();
    if (geometry.list !== current.list) return;
    // While a load replays and the view follows, the viewport only, as `tailRange` (design D4).
    const replay = vm.following && loading();
    const need = geometry.need(replay ? 0 : geometry.viewportHeight());
    const range = nextRange(current.range, current.list.entries.length, need, vm.following, replay ? LOAD_SIZES : WINDOW_SIZES);
    if (!sameRange(range, current.range)) setChosen({ list: current.list, range });
  }

  /** Mounts `[at, at + 1)` and around it for the list in use (a jump). */
  function mountAround(at: number): void {
    const current = view();
    const range = nextRange(current.range, current.list.entries.length, { start: at, end: at + 1 }, false);
    if (!sameRange(range, current.range)) setChosen({ list: current.list, range });
  }

  /** Records Yoga's layout of the mounted slice, measures it into the cache and refreshes the
   *  geometry. Called in the frame's layout step, before the scroll controller. */
  function refreshGeometry(): void {
    if (!box || !topSpacer || !bottomSpacer) return;
    const { list: l, range } = view();
    const session = store.snapshot();
    const w = width();
    const tops: number[] = [];
    const heights: number[] = [];
    let previousBottom = topSpacer.getLayout().height;
    for (let i = range.start; i < range.end; i++) {
      const entry = l.entries[i]!;
      const node = nodes.get(entry.key);
      const layout = node && !node.isDestroyed ? node.getLayout() : null;
      const top = layout ? layout.top : previousBottom + entry.margin;
      const height = layout ? layout.height : entryHeight(l, i, session, w);
      tops.push(top);
      heights.push(height);
      previousBottom = top + height;
      if (!layout) continue;
      if (entry.kind === "group") state.cache.measure(entry.key, w, { ref: null, variant: "group" }, height);
      else {
        const item = session.items.get(entry.key);
        if (item) state.cache.measure(entry.key, w, { ref: item, variant: variantOf(item) }, height);
      }
    }
    geometry.update(
      l,
      {
        start: range.start,
        end: range.end,
        topSpacer: topSpacer.getLayout().height,
        tops,
        heights,
        bottomTop: bottomSpacer.getLayout().top,
      },
      box.content.getLayout().height,
      box.viewport.getLayout().height,
      (i) => entryHeight(l, i, session, w),
    );
  }

  // After a layout (outside the render pass): a pending reveal, then the window for the view.
  let afterQueued = false;
  let pendingReveal: string | null = null;
  function afterLayout(): void {
    if (afterQueued) return;
    afterQueued = true;
    queueMicrotask(() => {
      afterQueued = false;
      if (pendingReveal && geometry.box(pendingReveal)) {
        const key = pendingReveal;
        pendingReveal = null;
        revealKey(key);
        return;
      }
      ensureWindow();
    });
  }

  // ------------------------------------------------------------ cursor, toggles, density

  /** Scrolls the least needed to show `key`, keeps it on that row through the next layout (its
   *  neighbours may mount with other heights than estimated), and mounts around it. */
  function revealKey(key: string): void {
    if (!scroll) return;
    if (geometry.list !== list() || !geometry.box(key)) {
      pendingReveal = key;
      return;
    }
    scroll.reveal(key);
    const b = geometry.box(key)!;
    scroll.keep(key, b.top - geometry.scrollTop());
    const at = geometry.list.index.get(key)!;
    if (at < view().range.start || at >= view().range.end) mountAround(at);
    ensureWindow();
  }

  function setCursor(key: string | null, reveal = true): void {
    vm.setCursor(key);
    if (key && reveal) revealKey(key);
  }

  const cursorKey = (): string | null => {
    const c = vm.cursor();
    return c === null ? null : resolveKey(c, list());
  };

  /** Toggles an entry in place (a group line opens or closes; an item expands or collapses),
   *  keeping its first row where it is (with `reveal`, then showing as much as fits). */
  function toggleEntry(key: string, reveal = false): boolean {
    const l = list();
    const at = l.index.get(key);
    if (at === undefined) return false;
    const entry = l.entries[at]!;
    if (entry.kind === "group") {
      scroll?.beforeToggle(key, reveal);
      state.setOpen(key, !entry.open);
      return true;
    }
    const item = store.snapshot().items.get(key);
    if (!item || !vm.collapsible(item)) return false;
    scroll?.beforeToggle(key, reveal);
    vm.setExpanded(item, !expandedFor(item));
    return true;
  }

  /** Shows a tool call's whole output, or its snippet again (`expandOutput`, a click on the
   *  snippet's marker row), keeping its first row where it is; a collapsed call is expanded with
   *  its whole output. */
  function toggleOutput(key: string): boolean {
    const item = store.snapshot().items.get(key);
    if (item?.kind !== "tool_call") return false;
    scroll?.beforeToggle(key, false);
    batch(() => {
      if (!expandedFor(item)) {
        vm.setExpanded(item, true);
        vm.setOutputShown(key, true);
      } else vm.setOutputShown(key, !vm.outputShown(key));
    });
    return true;
  }

  /** After paging with the conversation focused, keeps the cursor on a visible entry. */
  function keepCursorInView(direction: -1 | 1): void {
    const cursor = cursorKey();
    if (!focused() || !scroll || (cursor && scroll.visible(cursor))) return;
    const range = scroll.visibleRange();
    if (range) vm.setCursor(direction < 0 ? range.last : range.first);
  }

  const MESSAGE_KINDS = new Set(["user_message", "agent_message", "marker"]);

  // The item a density switch put behind a group line (the cursor on a tool call, then `focus`),
  // so the next switch returns to that item rather than the group's first member.
  let hidden: { group: string; item: string } | null = null;

  // The `density` debug-log event (only with `ACP_TUI_LOG`): the time from a switch's key to the
  // end of the first frame laid out after it, which the spec bounds at 100 ms.
  let densityShown: { density: Density; t0: number; laidOut: boolean } | null = null;
  if (logger?.enabled) {
    const onFrame = () => {
      if (!densityShown?.laidOut) return;
      logger.log({ event: "density", density: densityShown.density, ms: Math.round((performance.now() - densityShown.t0) * 100) / 100 });
      densityShown = null;
    };
    renderer.on(CliRenderEvents.FRAME, onFrame);
    onCleanup(() => renderer.off(CliRenderEvents.FRAME, onFrame));
  }

  /** Switches to `next` (`cycleDensity`, or the `density` setting changing), keeping the reader's
   *  entry on its screen row. The reader's entry is the cursor while the conversation has focus
   *  and the cursor is on screen, else the top entry; while following without either, the bottom
   *  is kept. */
  function switchDensity(next: Density): void {
    if (next === state.density()) {
      controller.notify(`density: ${next}`, "muted");
      return;
    }
    const t0 = performance.now();
    const cursor = cursorKey();
    let reader: { item: string; row: number; message: boolean; cursor: boolean } | null = null;
    const readerKey = focused() && cursor && scroll?.visible(cursor) ? cursor : vm.following ? null : (vm.anchor?.id ?? null);
    const readerAt = readerKey === null ? undefined : geometry.list.index.get(readerKey);
    if (readerKey !== null && readerAt !== undefined) {
      const entry = geometry.list.entries[readerAt]!;
      const remembered = entry.kind === "group" && hidden?.group === entry.key && entry.members.includes(hidden.item) ? hidden.item : null;
      const item = store.snapshot().items.get(remembered ?? firstItem(entry));
      reader = {
        item: remembered ?? firstItem(entry),
        row: geometry.box(readerKey)!.top - geometry.scrollTop(),
        message: entry.kind === "item" && item !== undefined && MESSAGE_KINDS.has(item.kind),
        cursor: readerKey === cursor,
      };
    }
    // The density and the window for its first frame in one batch, so that only the entries the
    // frame needs are drawn under the new density: the reader's entry and the viewport around it,
    // with a margin of one viewport either side (as `ensureWindow` asks for), by the estimates.
    // The entries mounted before the switch are dropped rather than redrawn first (a switch to
    // `verbose` 150 entries back redrew all 160 of them: 90 to 106 ms before the first frame,
    // IDE check 9.4); the window grows from there by chunks as the reader scrolls.
    const kept = batch(() => {
      state.setDensity(next);
      const l = list();
      if (cursor !== null) vm.setCursor(resolveKey(cursor, l) ?? l.keys.at(-1) ?? null);
      if (!reader || !scroll) return null;
      const at = l.holder.get(reader.item);
      if (at === undefined) return null;
      const key = l.keys[at]!;
      hidden = key !== reader.item ? { group: key, item: reader.item } : null;
      if (reader.cursor) vm.setCursor(key);
      const rows = viewportRows();
      setChosen({ list: l, range: rowsAround(prefix(), at, Math.max(0, reader.row) + rows, rows - reader.row + rows) });
      return key;
    });
    // A message keeps its exact text row even when it starts above the view; anything else
    // (which may shrink) keeps its first row on screen.
    if (kept !== null && reader && scroll) scroll.keep(kept, reader.message ? reader.row : Math.max(0, reader.row));
    controller.notify(`density: ${next}`, "muted");
    if (logger?.enabled) densityShown = { density: next, t0, laidOut: false };
  }

  // The cursor and the anchor follow their item when their entry leaves the list.
  createEffect(
    on(list, (l) => {
      const c = vm.cursor();
      if (c !== null && !l.index.has(c)) vm.setCursor(resolveKey(c, l) ?? l.keys.at(-1) ?? null);
      const a = vm.anchor;
      if (a && !l.index.has(a.id)) {
        const key = resolveKey(a.id, l);
        vm.anchor = key ? { id: key, offset: 0 } : null;
      }
    }),
  );

  /** Moves the cursor to the previous or next prompt or tool call over the whole session, mounted
   *  or not, scrolling it into view; stays put when there is none. */
  function jump(direction: -1 | 1, what: "prompt" | "tool"): void {
    const items = store.snapshot().items;
    const target = jumpTarget(list(), (id) => items.get(id), cursorKey(), direction, what);
    if (target !== null) setCursor(target);
  }

  /** Home: the cursor on the first item, scrolled into view. */
  function first(): void {
    setCursor(list().keys[0] ?? null);
  }

  /** End: the cursor on the last item, the view at the bottom and following. */
  function last(): void {
    setCursor(list().keys.at(-1) ?? null, false);
    scroll?.toBottom();
    ensureWindow();
  }

  // A reload switches the density only when the `density` setting itself changed (spec tui-config
  // "Reload never touches the running session"): a density chosen with `v` survives a reload of
  // anything else, since the setting's value is unchanged then.
  const densitySetting = createMemo(() => config().density);
  createEffect(on(densitySetting, (density) => switchDensity(density), { defer: true }));

  const handlers: ContextHandlers<"conversation"> = {
    cycleDensity: () => switchDensity(nextDensity(state.density())),
    previousPrompt: () => jump(-1, "prompt"),
    nextPrompt: () => jump(1, "prompt"),
    previousTool: () => jump(-1, "tool"),
    nextTool: () => jump(1, "tool"),
    up: () => setCursor(moveCursor(list().keys, cursorKey(), -1)),
    down: () => setCursor(moveCursor(list().keys, cursorKey(), 1)),
    first,
    last,
    toggle: () => {
      const cursor = cursorKey();
      if (cursor) toggleEntry(cursor);
    },
    expandOutput: () => {
      const cursor = cursorKey();
      if (!cursor || !toggleOutput(cursor)) controller.notify("no tool call under the cursor", "muted");
    },
    back: () => controller.back(),
  };

  // Entering the conversation: the cursor starts on the last entry, or stays where it was left.
  createEffect(
    on(focused, (isFocused) => {
      if (!isFocused) return;
      let cursor = cursorKey();
      if (cursor === null) cursor = list().keys.at(-1) ?? null;
      vm.setCursor(cursor);
      if (cursor && scroll && !scroll.visible(cursor)) revealKey(cursor);
    }),
  );

  let pressedHeader: { id: string; event: object } | null = null;
  let pressedOutput: { id: string; event: object } | null = null;

  onMount(() => {
    if (!box || !focusBox) return;
    const sb = box;
    // The wheel step follows a reload of `wheel_lines` or `terminals` (`wheel` reads a signal).
    createEffect(() => (sb.wheel = new WheelAccumulator((wheel ?? DEFAULT_WHEEL).rows)));
    const report = (position: { following: boolean; percent: number; below: number }) =>
      queueMicrotask(() => {
        lastPosition = position;
        // The reader leaving the bottom starts the count; reaching it again clears it.
        if (position.following) setLeftAt(null);
        else if (untrack(leftAt) === null) setLeftAt(untrack(shownItems));
        publishScroll();
      });
    scroll = new ScrollController(geometry, vm, report);
    sb.onLayout = () => {
      if (densityShown) densityShown.laidOut = true;
      refreshGeometry();
      scroll?.layout();
      afterLayout();
    };
    // Scrolls by other means (the wheel) are recorded, then the window follows them.
    const onChange = () => {
      if (applying || sb.layingOut) return;
      scroll?.scrolled();
      ensureWindow();
    };
    sb.verticalScrollBar.on("change", onChange);
    // The scroll bar (`layout.scrollbar`, ../scrollbar.ts) is shown and drawn from the theme; a
    // drag on it sets the offset, which reaches `onChange` as the wheel's does.
    const detachBar = scrollbar?.attach(sb, theme, LIVE_GLYPHS, renderer, logger);
    // `layout.scrollbar` switched by a reload: the bar's column is shown or given to the text (the
    // width above follows the same setting), and the next layout keeps the reading position.
    if (scrollbar) {
      createEffect(
        on(barShown, (shown) => {
          if (sb.isDestroyed || sb.verticalScrollBar.visible === shown) return;
          sb.verticalScrollBar.visible = shown;
          sb.requestRender();
        }),
      );
    }

    controller.setConversation({
      page(direction) {
        scroll?.page(direction);
        keepCursorInView(direction);
        ensureWindow();
      },
      toBottom() {
        scroll?.toBottom();
        ensureWindow();
      },
      first,
      last,
      toggleTool() {
        const target = viewerTarget(store.session);
        if (target === null) return false;
        // A call hidden in a closed group: open the group first.
        const l = list();
        const at = l.holder.get(target);
        const holder = at === undefined ? undefined : l.entries[at];
        if (holder?.kind === "group" && !holder.open) state.setOpen(holder.key, true);
        return toggleEntry(target, true);
      },
      // Find (src/find/). The item may be outside the window or behind a
      // closed group line: the group is opened, then `revealKey` mounts around the item and
      // scrolls to it once the list and the geometry have caught up.
      find: {
        position: () => ({ anchor: vm.anchor, following: vm.following }),
        restore(position) {
          scroll?.restore(position.anchor, position.following);
          pendingReveal = null;
          const key = position.anchor && !position.following ? resolveKey(position.anchor.id, list()) : null;
          const at = key === null ? undefined : list().index.get(key);
          if (at !== undefined) mountAround(at);
          sb.requestRender();
        },
        show(id, expand) {
          const l = list();
          const at = l.holder.get(id);
          if (at === undefined || !scroll) return null;
          const undo: (() => void)[] = [];
          const holder = l.entries[at]!;
          if (holder.kind === "group" && !holder.open) {
            const key = holder.key;
            state.setOpen(key, true);
            undo.push(() => state.setOpen(key, false));
          }
          const target = store.snapshot().items.get(id);
          const expanded = expand && target ? expandRecorded(vm, target, expandedFor(target)) : null;
          if (expanded) undo.push(expanded);
          // A hit may lie in rows a snippet hides (mvp-rendering "Output snippets"): the output is
          // shown in full while find shows it, and put back with the rest.
          if (expand && target?.kind === "tool_call" && !vm.outputShown(id)) {
            vm.setOutputShown(id, true);
            undo.push(() => vm.setOutputShown(id, false));
          }
          revealKey(id);
          sb.requestRender();
          return undo.length === 0 ? null : () => undo.reverse().forEach((f) => f());
        },
        scrollBy(rows) {
          sb.scrollTop += rows;
        },
      },
      collapsed(id) {
        const item = store.snapshot().items.get(id);
        if (!item) return false;
        const l = list();
        const at = l.holder.get(id);
        const holder = at === undefined ? undefined : l.entries[at];
        if (holder?.kind === "group" && !holder.open) return true;
        return vm.collapsible(item) && !expandedFor(item);
      },
    });
    const removeKeys = registerContext(keymap, keyMap, "conversation", handlers, { target: focusBox });
    onCleanup(() => {
      removeKeys();
      sb.onLayout = null;
      sb.verticalScrollBar.off("change", onChange);
      detachBar?.();
      controller.setConversation(null);
      scroll = null;
    });
  });

  const glyphs = LIVE_GLYPHS;
  // Rebuilt whenever the theme changes (a configuration reload, new terminal colours), owned by
  // this renderer's native scene; the previous one is destroyed once the items have switched to the
  // new one (an effect runs after the render effects that set their `syntaxStyle`). Never cached
  // at module level (mvp-configuration design D6).
  const syntaxStyle = createMemo(() => SyntaxStyle.fromStyles(markdownStyles(theme), renderer.nativeScene));
  let shownStyle: SyntaxStyle | undefined;
  createEffect(() => {
    const next = syntaxStyle();
    if (shownStyle && shownStyle !== next) shownStyle.destroy();
    shownStyle = next;
  });
  onCleanup(() => syntaxStyle().destroy());
  const spinner = createSpinner();
  // Items draw with the density's expansion; the rest of the view model is the store's.
  const itemVm: ConversationViewModel = {
    collapsible: (item) => vm.collapsible(item),
    expanded: expandedFor,
    toggle: (item) => vm.setExpanded(item, !expandedFor(item)),
    setExpanded: (item, value) => vm.setExpanded(item, value),
    forget: (id) => vm.forget(id),
    toggled: (id) => vm.toggled(id),
    outputShown: (id) => vm.outputShown(id),
    setOutputShown: (id, shown) => vm.setOutputShown(id, shown),
    cursor: () => vm.cursor(),
    setCursor: (id) => vm.setCursor(id),
    reset: () => vm.reset(),
    get anchor() {
      return vm.anchor;
    },
    set anchor(anchor) {
      vm.anchor = anchor;
    },
    get following() {
      return vm.following;
    },
    set following(following) {
      vm.following = following;
    },
  };
  const ctx: ItemContext = {
    theme,
    glyphs,
    get style() {
      return syntaxStyle();
    },
    items: store.session.items,
    vm: itemVm,
    spinner,
    width,
    selected: (id) => focused() && vm.cursor() === id,
    register(id, node) {
      if (node) nodes.set(id, node);
      else nodes.delete(id);
    },
    mouse: {
      pressItem(id, event) {
        if (pressedHeader?.event !== event) pressedHeader = null;
        if (pressedOutput?.event !== event) pressedOutput = null;
        vm.setCursor(id);
      },
      pressHeader(id, event) {
        pressedHeader = { id, event };
      },
      releaseHeader(id) {
        if (pressedHeader?.id === id) toggleEntry(id);
        pressedHeader = null;
      },
      pressOutput(id, event) {
        pressedOutput = { id, event };
      },
      releaseOutput(id) {
        if (pressedOutput?.id === id) toggleOutput(id);
        pressedOutput = null;
      },
    },
    outputKey: () => {
      const key = keysFor(keyMap, "conversation", "expandOutput")[0];
      return key === undefined ? null : keyLabel(key);
    },
  };

  const entryOf = (key: string) => {
    const l = view().list;
    const at = l.index.get(key);
    return at === undefined ? undefined : l.entries[at];
  };

  return (
    <box
      ref={(r: BoxRenderable) => (focusBox = r)}
      focusable
      focused={focused()}
      flexGrow={1}
      flexShrink={1}
      minHeight={0}
      flexDirection="column"
      // No click handler here: a click acts on what is under the pointer (the items' own
      // handlers) and leaves keyboard focus where it was; Tab is the keyboard route in
      // (mvp-chrome-and-keys task 3.3, tui-keymap "A click keeps keyboard focus").
    >
      <window_scrollbox
        ref={(r: ConversationScrollBox) => (box = r)}
        flexGrow={1}
        flexShrink={1}
        viewportCulling
        scrollX={false}
        contentOptions={{ paddingRight: RIGHT_MARGIN }}
        verticalScrollbarOptions={{ visible: untrack(barShown) }}
        horizontalScrollbarOptions={{ visible: false }}
      >
        <box ref={(r: BoxRenderable) => (topSpacer = r)} id="window:top" width="100%" height={spacers().top} flexShrink={0} />
        <For each={mountedKeys()}>
          {(key) =>
            untrack(() => entryOf(key)?.kind) === "group" ? (
              <GroupView entryKey={key} entry={() => entryOf(key) as GroupEntry | undefined} ctx={ctx} />
            ) : (
              <ItemView id={key} margin={entryOf(key)?.margin ?? 0} ctx={ctx} />
            )
          }
        </For>
        <box ref={(r: BoxRenderable) => (bottomSpacer = r)} id="window:bottom" width="100%" height={spacers().bottom} flexShrink={0} />
      </window_scrollbox>
    </box>
  );
}

/** A group line: `▸ 5 reads · 2 searches · 3.1s` behind the meta gutter; a click toggles it. */
function GroupView(props: { entryKey: string; entry: () => GroupEntry | undefined; ctx: ItemContext }): JSX.Element {
  const { ctx } = props;
  const { theme, glyphs } = ctx;
  const key = props.entryKey;
  const selected = () => ctx.selected(key);
  const items = fromRecord(ctx.items);
  onCleanup(() => ctx.register(key, null));
  const segments = () => {
    const entry = props.entry();
    return entry ? fitSegments(groupLine(entry, items), Math.max(1, ctx.width() - glyphs.gutterWidth)) : [];
  };
  return (
    <box
      id={`group:${key}`}
      ref={(r: BoxRenderable) => ctx.register(key, r)}
      onMouseDown={(event) => void (isPrimaryPress(event) && ctx.mouse.pressItem(key, event))}
      flexDirection="column"
      width="100%"
      flexShrink={0}
      marginTop={props.entry()?.margin ?? 0}
      backgroundColor={cursorFill(selected(), theme)}
    >
      <Gutter gutter={glyphs.gutter.meta} token="muted" selected={selected()} ctx={ctx} clickId={key}>
        <Segments segments={segments()} theme={theme} />
      </Gutter>
      <Show when={selected() && !theme.flat}>
        <CursorBar ctx={ctx} />
      </Show>
    </box>
  );
}
