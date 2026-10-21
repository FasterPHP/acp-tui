// The `@` file picker (mvp-chrome-and-keys task 6.6, design D9, spec
// tui-palette "File picker"). The prompt box opens it when `@` is typed at the
// start of the draft or after whitespace, and keeps the keyboard: the text
// typed after `@` stays in the draft and is the filter (`setQuery`). It is
// drawn above the prompt box, at most `FILE_PICKER_ROWS` rows, through the
// overlay's own rows (`overlayLayout`, src/overlay/list.ts), but it is not the
// palette's overlay: it takes no focus and no `ui.overlay` slot, and only the
// rows in view are laid out, since the list may hold `FILE_CAP` paths.
//
// The list is built afresh each time it opens, off the input path
// (`listFiles`, src/overlay/files.ts): batches are appended as they arrive
// and the matches re-ranked at most every `RANK_MS`, so typing never waits
// for the walk. While the prompt box has focus and the picker is open, the
// `overlay` context's Up, Down, PgUp, PgDn, Enter and Esc are the picker's
// (`handlers`, registered by the prompt box on its textarea above its own
// layer); Enter chooses the selected path, which the prompt box turns into a
// mention (src/app/mentions.ts), and Esc closes the picker, leaving the typed
// text. With no match, Enter closes it and goes on to the prompt box (send).
// It is drawn through a portal on the root, since the prompt box's region
// clips what lies outside it.
import { batch, createMemo, createSignal, onCleanup, For, Show, type JSX } from "solid-js";
import { Portal, useTerminalDimensions } from "@opentui/solid";
import { TextAttributes, type BoxRenderable } from "@opentui/core";
import { useApp } from "../app/context.ts";
import { useKeys } from "../keys/context.ts";
import { actionLabel } from "../keys/keymap.ts";
import type { ContextHandlers } from "../keys/register.ts";
import type { DebugLogger } from "../log.ts";
import type { Segment } from "../layout/segments.ts";
import { spanStyle } from "../theme/index.ts";
import { displayPath, FILE_CAP, listFiles, PathList, rankFiles } from "./files.ts";
import { moveSelection, overlayLayout, type ListItem, type OverlaySegment } from "./list.ts";
import { listPointer } from "./pointer.ts";

/** The picker is at most this many rows tall, borders included. */
export const FILE_PICKER_ROWS = 8;

/** While paths stream in, the matches are re-ranked at most this often. */
const RANK_MS = 50;

export interface FilePicker {
  /** Opens the picker for the `@` at `anchor` (a UTF-16 index into the draft), listing `cwd`. */
  open(anchor: number, cwd: string): void;
  close(): void;
  isOpen(): boolean;
  /** The `@`'s index while open, else -1. */
  anchor(): number;
  /** The text typed after `@`. */
  setQuery(query: string): void;
  /** The `overlay` context's keys while the picker is open; each returns false while it is
   *  closed, so the key goes on to the prompt box. */
  readonly handlers: ContextHandlers<"overlay">;
  /** Drawn by the prompt box: the picker above `top()`, the prompt box's first screen row. */
  View(props: { top: number }): JSX.Element;
}

/** `choose` is given the chosen path, relative to `cwd`, and the index of its `@`. The debug log's
 *  `file_picker` event (never a path or the query): `open`, `first` (`ms` from opening to the
 *  first batch, `count`), `listed` (`source`, `count`, `capped`, `ms`), `close` (`chosen`). */
export function createFilePicker(choose: (path: string, anchor: number) => void, logger?: DebugLogger): FilePicker {
  const [anchor, setAnchor] = createSignal(-1);
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal(0);
  const [version, setVersion] = createSignal(0);
  const [listing, setListing] = createSignal(false);
  const [capped, setCapped] = createSignal(false);
  // Alphabetical (case-insensitive, a directory's files together), tracked and untracked
  // merged, whatever order the sources list them in. The matches are indices into `snap`, the
  // list as it was when last ranked: a later merge moves paths, but never changes `snap`.
  const list = new PathList();
  let snap: { version: number; paths: readonly string[]; lower: readonly string[] } = { version: -1, paths: [], lower: [] };
  let abort: AbortController | null = null;
  let rankTimer: ReturnType<typeof setTimeout> | null = null;
  let offset = 0;

  const bump = () => {
    if (rankTimer) return;
    rankTimer = setTimeout(() => {
      rankTimer = null;
      setVersion((v) => v + 1);
    }, RANK_MS);
  };
  const stop = () => {
    abort?.abort();
    abort = null;
    if (rankTimer) clearTimeout(rankTimer);
    rankTimer = null;
  };

  // The matches of a longer query are searched among those of the shorter one while the list
  // has not grown since.
  let last: { query: string; version: number; matches: number[] } | null = null;
  const matches = createMemo(() => {
    const q = query();
    const v = version();
    if (anchor() < 0) return [];
    if (snap.version !== v) snap = { version: v, paths: list.paths, lower: list.lower };
    const among = last && last.version === v && q.startsWith(last.query) && last.query !== "" ? last.matches : undefined;
    const result = rankFiles(q, snap.paths, snap.lower, among);
    last = { query: q, version: v, matches: result };
    return result;
  });

  const close = (chosen = false) => {
    if (anchor() >= 0) logger?.log({ event: "file_picker", action: "close", chosen });
    stop();
    batch(() => {
      setAnchor(-1);
      setQuery("");
      setSelected(0);
      setListing(false);
    });
    list.clear();
    snap = { version: -1, paths: [], lower: [] };
    last = null;
  };
  onCleanup(stop);

  const open = (at: number, cwd: string) => {
    stop();
    list.clear();
    snap = { version: -1, paths: [], lower: [] };
    last = null;
    offset = 0;
    const controller = new AbortController();
    abort = controller;
    batch(() => {
      setAnchor(at);
      setQuery("");
      setSelected(0);
      setCapped(false);
      setListing(true);
      setVersion((v) => v + 1);
    });
    let first = true;
    const started = performance.now();
    const ms = () => Math.round((performance.now() - started) * 10) / 10;
    logger?.log({ event: "file_picker", action: "open" });
    void listFiles(
      cwd,
      {
        add: (batchOf) => {
          if (controller.signal.aborted) return;
          list.add(batchOf);
          // The first batch is shown at once; later ones at most every RANK_MS.
          if (first) {
            first = false;
            logger?.log({ event: "file_picker", action: "first", ms: ms(), count: list.paths.length });
            setVersion((v) => v + 1);
          } else bump();
        },
        done: (result) => {
          if (controller.signal.aborted) return;
          if (rankTimer) clearTimeout(rankTimer);
          rankTimer = null;
          logger?.log({ event: "file_picker", action: "listed", source: result.source, count: list.paths.length, capped: result.capped, ms: ms() });
          batch(() => {
            setCapped(result.capped);
            setListing(false);
            setVersion((v) => v + 1);
          });
        },
      },
      { signal: controller.signal },
    ).catch(() => {
      if (!controller.signal.aborted) setListing(false);
    });
  };

  const isOpen = () => anchor() >= 0;
  const move = (by: number | "first" | "last") => {
    setSelected((s) => moveSelection(matches().length, s, by));
    return true;
  };
  let pageRows = FILE_PICKER_ROWS - 2;
  const handlers: ContextHandlers<"overlay"> = {
    up: () => isOpen() && move(-1),
    down: () => isOpen() && move(1),
    pageUp: () => isOpen() && move(-Math.max(1, pageRows - 1)),
    pageDown: () => isOpen() && move(Math.max(1, pageRows - 1)),
    choose: () => {
      if (!isOpen()) return false;
      const index = matches()[selected()];
      // Nothing to choose: the picker closes and Enter goes on to the prompt box (it sends).
      if (index === undefined) {
        close();
        return false;
      }
      const path = snap.paths[index]!;
      const at = anchor();
      close(true);
      choose(path, at);
      return true;
    },
    close: () => {
      if (!isOpen()) return false;
      close();
      return true;
    },
  };

  function View(props: { top: number }): JSX.Element {
    const { theme } = useApp();
    const { keyMap } = useKeys();
    const dims = useTerminalDimensions();
    let panel: BoxRenderable | undefined;
    const layout = createMemo(() => {
      const all = matches();
      const maxRows = Math.max(3, Math.min(FILE_PICKER_ROWS, props.top));
      // Only the rows in view are laid out: the window moves as little as it must to keep the
      // selection in it.
      const rows = Math.max(1, maxRows - 2 - (capped() ? 1 : 0));
      const sel = Math.min(selected(), Math.max(0, all.length - 1));
      offset = Math.max(0, Math.min(offset, Math.max(0, all.length - rows)));
      if (sel < offset) offset = sel;
      if (sel >= offset + rows) offset = sel - rows + 1;
      const items: ListItem[] = all.slice(offset, offset + rows).map((i) => ({ id: snap.paths[i]!, group: null, title: displayPath(snap.paths[i]!) }));
      const enter = actionLabel(keyMap, "overlay", "choose");
      const esc = actionLabel(keyMap, "overlay", "close");
      const hints: Segment[] = [
        { text: "↑↓ select", token: "muted" },
        ...(enter ? [{ text: " · ", token: "muted" as const, breakBefore: true }, { text: `${enter} mention`, token: "muted" as const }] : []),
      ];
      const view = overlayLayout({
        title: "Files",
        filter: null,
        placeholder: "",
        items,
        grouped: false,
        selected: sel - offset,
        offset: 0,
        width: dims().width,
        rows: dims().height,
        maxRows,
        count: `${all.length}${listing() ? "…" : ""}`,
        closeLabel: esc,
        hints,
        marks: false,
        ...(capped() ? { footer: { text: `only the first ${FILE_CAP} files are listed`, token: "muted" as const } } : {}),
      });
      pageRows = view.listHeight;
      return view;
    });
    const style = (s: OverlaySegment) => {
      const base = theme.text(s.token);
      if (!s.selected) return spanStyle(base);
      return spanStyle(theme.flat ? { ...base, attributes: base.attributes | TextAttributes.INVERSE } : { ...base, bg: theme.color("surface.cursor") });
    };
    return (
      <Show when={isOpen()}>
        <Portal
          ref={(container: {}) => {
            // The portal's own box sits on the root: out of the flow, over the screen.
            const box = container as BoxRenderable;
            box.position = "absolute";
            box.zIndex = 100;
          }}
        >
          <box
            ref={(r: BoxRenderable) => (panel = r)}
            position="absolute"
            left={0}
            top={Math.max(0, props.top - layout().lines.length)}
            zIndex={100}
            width={dims().width}
            height={layout().lines.length}
            flexDirection="column"
            backgroundColor={theme.color("surface.overlay")}
            {...listPointer({
              box: () => panel,
              itemAt: () => layout().itemAt,
              // Only the rows in view are laid out: item `i` of the layout is match `offset + i`.
              // The prompt box keeps the keyboard; a click chooses as Enter would (task 13.6).
              select: (index) => void setSelected(offset + index),
              choose: (index) => {
                setSelected(offset + index);
                handlers.choose?.();
              },
            })}
          >
            <For each={layout().lines}>
              {(row) => (
                <text wrapMode="none" height={1} {...theme.text("text")}>
                  <For each={row}>{(s) => <span style={style(s)}>{s.text}</span>}</For>
                </text>
              )}
            </For>
          </box>
        </Portal>
      </Show>
    );
  }

  return { open, close, isOpen, anchor, setQuery: (q) => {
      if (q === query()) return;
      batch(() => {
        setQuery(q);
        setSelected(0);
      });
    }, handlers, View };
}
