// The session list (mvp-sessions task group 7, design decisions 5 to 7, spec
// tui-sessions "Session list", "Reaching the session list", "Agent selector",
// "Switching sessions is detach" and "Honest errors when a session cannot be
// opened"). Always mounted from app/run.tsx: it takes from the palette only
// the pure list module (list.ts), and draws like the palette, above the status row, at most `rows - 4` tall, framed in
// the accent colour on the `surface.overlay` fill.
//
// - Opened by `--resume` (without an ID) at start-up (before any session exists), and by the
//   `sessions` action of the `global` context (no default key; the palette
//   lists it) while a session is open.
// - Rows (sessions.ts): "New session with <agent>" for every named agent, the
//   current one first; then the sessions of the session directory (Tab, the
//   `overlay` context's `toggleScope`: all directories), merged from the
//   current agent's `session/list` (the first page at open, the next once the
//   selection reaches the end) and the index, newest first. Typing filters.
// - Enter opens the selected row through the session switcher
//   (session/switch.ts); the list closes once the session is open, or stays
//   open with the switcher's message in its footer row. Esc closes the list:
//   at start-up that starts a new session in the session directory, so
//   `--resume` never leaves the user without one; otherwise the session in use
//   carries on.
// - At start-up the list opens with the app's first frame, from the index, while the harness is
//   still starting (day-two-feedback D2). The footer row says what it waits for after a spinner
//   cell (`starting <harness>…`, then `reading <harness>'s sessions…`); the panel has its full
//   height from the first frame, so nothing moves when rows arrive; the harness's sessions are
//   merged in place (the selected entry stays selected, on its screen row where it can); a row
//   chosen, or Esc, before the harness is up is taken at once and carried out when it is.
import { batch, createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, type JSX } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import { TextAttributes, type BoxRenderable, type KeyEvent } from "@opentui/core";
import type { SessionInfo } from "@agentclientprotocol/sdk";
import { useApp } from "../app/context.ts";
import { typedText } from "../card/elicitation.tsx";
import { createSpinner } from "../conversation/items.tsx";
import { LIVE_GLYPHS } from "../conversation/live-glyphs.ts";
import { OVERLAY_BOTTOM } from "../layout/layout.ts";
import type { Focus } from "../layout/view.ts";
import { shortenHome, type Segment } from "../layout/segments.ts";
import { useKeys } from "../keys/context.ts";
import { actionLabel } from "../keys/keymap.ts";
import { registerContext, type ContextHandlers } from "../keys/register.ts";
import { oneLine, type SessionRecord } from "../session/session-index.ts";
import { SESSION_LIST_OVERLAY } from "../session/store.ts";
import type { SessionSwitcher } from "../session/switch.ts";
import type { TokenName } from "../theme/index.ts";
import { spanStyle as toSpan } from "../theme/index.ts";
import { filterItems, moveSelection, overlayLayout, type OverlaySegment } from "./list.ts";
import { listPointer } from "./pointer.ts";
import {
  DETAIL_MIN_WIDTHS,
  detailDropOrder,
  harnessName,
  indexOfKey,
  keepSelection,
  mergeSessions,
  newSessionEntries,
  noSessionsLine,
  sessionListItem,
  waitText,
  type CurrentAgent,
  type ListWait,
  type SessionListEntry,
  type SessionScope,
} from "./sessions.ts";

export { SESSION_LIST_OVERLAY };

/** What the session list needs from the app. */
export type SessionListHost = Pick<
  SessionSwitcher,
  "agents" | "currentAgent" | "directory" | "canList" | "listPage" | "records" | "choose" | "current" | "starting" | "ready"
> & {
  /** Esc at start-up: starts a new session (the app reports a failure as a start-up failure). */
  startNew(): void;
  /** Clock for the activity times; default `Date.now`. */
  now?(): number;
  /** Home directory for `~`; default `process.env.HOME`. */
  readonly home?: string | null;
};

export interface SessionList {
  /** Rendered in the App's overlay slot. */
  readonly overlay: () => JSX.Element;
  /** Opens the list; `startup` (`--resume` without an ID): no session exists yet, and Esc starts one.
   *  With `only` (a harness named on the command line), the list holds that harness's sessions and
   *  its own "New session with" row alone; without it, every harness's. */
  open(startup: boolean, only?: string | null): void;
}

/** What the list is opened with: read once per opening (the configuration file included). */
interface OpenState {
  readonly startup: boolean;
  /** The session directory, the `directory` scope. */
  readonly directory: string;
  /** The named agents, for the "New session with" rows. */
  readonly agents: readonly string[];
  readonly current: CurrentAgent;
  /** The one harness the list is limited to (named on the command line), or null for all. */
  readonly only: string | null;
}

function openState(host: SessionListHost, startup: boolean, only: string | null): OpenState {
  return { startup, directory: host.directory(), agents: host.agents(), current: host.currentAgent(), only };
}

export function createSessionList(host: SessionListHost): SessionList {
  const [state, setState] = createSignal<OpenState | null>(null);
  return {
    overlay: () => <SessionListOverlay host={host} state={state} setState={setState} />,
    open: (startup, only = null) => setState(openState(host, startup, only)),
  };
}

function SessionListOverlay(props: {
  host: SessionListHost;
  state: () => OpenState | null;
  setState: (next: OpenState | null) => void;
}): JSX.Element {
  const { store, theme } = useApp();
  const { keymap, keyMap, controller } = useKeys();
  const dims = useTerminalDimensions();
  const host = props.host;
  const now = () => host.now?.() ?? Date.now();
  const home = host.home === undefined ? (process.env["HOME"] ?? null) : host.home;

  const [scope, setScope] = createSignal<SessionScope>("directory");
  const [filter, setFilter] = createSignal("");
  // The entry the user moved the selection to, by its key; null until they move (the first row).
  const [held, setHeld] = createSignal<string | null>(null);
  const [listed, setListed] = createSignal<readonly SessionInfo[]>([]);
  const [records, setRecords] = createSignal<readonly SessionRecord[]>([]);
  const [cursor, setCursor] = createSignal<string | null>(null);
  const [reading, setReading] = createSignal(false);
  // The harness is still starting (a `--resume` list opened before it was up), and a choice made
  // meanwhile is waiting for it; `startFailed` once it could not start.
  const [starting, setStarting] = createSignal(false);
  const [waiting, setWaiting] = createSignal(false);
  const [startFailed, setStartFailed] = createSignal(false);
  const spinner = createSpinner();
  const [footer, setFooter] = createSignal<{ text: string; token: TokenName } | null>(null);
  const [busy, setBusy] = createSignal(false);
  // Bumped on every open and scope change, so a page that answers late is dropped.
  let generation = 0;
  // The page request in flight: aborted (`$/cancel_request`) when a choice is made or the list
  // closes, so a harness that handles requests one at a time is not kept waiting on it.
  let inFlight: AbortController | null = null;
  const cancelReading = (): void => {
    inFlight?.abort();
    inFlight = null;
  };
  let returnFocus: Focus = "prompt";
  let lastOffset = 0;
  // The selected entry's index and key as last drawn, for keeping its screen row when rows arrive.
  let lastIndex = 0;
  let lastKey: string | null = null;

  const open = () => props.state() !== null;
  const harness = () => {
    const s = props.state();
    return s === null ? "" : harnessName(s.current);
  };
  /** What the footer row waits for now, if anything. */
  const wait = (): ListWait | null => (waiting() ? "waiting" : starting() ? "starting" : reading() ? "reading" : null);
  // The spinner's clock runs only while the footer waits for something.
  createEffect(() => {
    if (open() && wait() !== null) onCleanup(spinner.hold());
  });

  /** Reads one page of the agent's list (the first, or the one after `after`). */
  function readPage(after: string | null): void {
    if (!host.canList()) return;
    const at = generation;
    const cwd = scope() === "directory" ? props.state()?.directory : undefined;
    setReading(true);
    cancelReading();
    const controller = new AbortController();
    inFlight = controller;
    host.listPage({ ...(cwd !== undefined ? { cwd } : {}), ...(after !== null ? { cursor: after } : {}) }, controller.signal).then(
      (response) => {
        if (at !== generation) return;
        batch(() => {
          setListed((rows) => [...rows, ...response.sessions]);
          setCursor(response.nextCursor ?? null);
          setReading(false);
        });
      },
      (error: unknown) => {
        if (at !== generation) return;
        batch(() => {
          setReading(false);
          setCursor(null);
          setFooter({ text: `${harness()} could not list its sessions: ${error instanceof Error ? error.message : String(error)}`, token: "warning" });
        });
      },
    );
  }

  /** Starts the rows afresh for the scope: the index, and the agent's first page (once the harness
   *  is up, when the list was opened while it started). */
  function reload(): void {
    generation += 1;
    cancelReading();
    const at = generation;
    batch(() => {
      setListed([]);
      setCursor(null);
      setReading(false);
      setRecords(host.records());
      setHeld(null);
    });
    lastOffset = 0;
    lastIndex = 0;
    lastKey = null;
    if (!host.starting()) {
      setStarting(false);
      readPage(null);
      return;
    }
    setStarting(true);
    host.ready().then(
      () => {
        if (at !== generation) return;
        setStarting(false);
        readPage(null);
      },
      (error: unknown) => {
        if (at !== generation) return;
        batch(() => {
          setStarting(false);
          setStartFailed(true);
          setFooter({ text: error instanceof Error ? error.message : String(error), token: "danger" });
        });
      },
    );
  }

  // Opening: focus, the overlay slot, the rows.
  createEffect(
    on(props.state, (next, previous) => {
      if (next === null || previous !== null) return;
      if (store.ui.focus !== "overlay") returnFocus = store.ui.focus;
      batch(() => {
        setScope("directory");
        setFilter("");
        setFooter(null);
        setBusy(false);
        setWaiting(false);
        setStartFailed(false);
        store.setOverlay(SESSION_LIST_OVERLAY);
        store.setFocus("overlay");
      });
      reload();
    }),
  );

  const entries = createMemo((): SessionListEntry[] => {
    const s = props.state();
    if (s === null) return [];
    const current = s.current;
    const sessions = mergeSessions(listed(), records(), current, scope() === "directory" ? s.directory : null, s.only);
    return [...newSessionEntries(s.only === null ? s.agents : s.agents.filter((a) => a === s.only), current), ...sessions];
  });
  const items = createMemo(() => entries().map((entry) => ({ entry, item: sessionListItem(entry, { now: now(), home }) })));
  const shown = createMemo(() => {
    const matching = new Set(filterItems(items().map((i) => i.item), filter()).map((i) => i.id));
    return items().filter((i) => matching.has(i.item.id));
  });
  // The selection is the entry the user moved to, found again by its key whenever the rows change.
  const selected = createMemo(() => indexOfKey(held(), shown().map((i) => i.item.id)));
  /** Selects row `n` of the shown rows (a move of the user's). */
  const select = (n: number): void => void setHeld(shown()[n]?.item.id ?? null);
  /** The first row again (a new filter or scope). */
  const selectFirst = (): void => void setHeld(null);

  // The next page of the agent's list once the selection reaches the end.
  createEffect(() => {
    if (!open() || reading() || busy() || cursor() === null) return;
    if (shown().length > 0 && selected() >= shown().length - 1) readPage(cursor());
  });

  /** Closes the list; at start-up a close without a choice starts a new session. */
  function close(chosen: boolean): void {
    const s = props.state();
    if (s === null) return;
    generation += 1;
    cancelReading();
    batch(() => {
      setStarting(false);
      setWaiting(false);
    });
    // Focus is left alone when another overlay has taken the slot (it has the focus now).
    const mine = store.ui.overlay === SESSION_LIST_OVERLAY;
    props.setState(null);
    if (mine) {
      batch(() => {
        store.setOverlay(null);
        if (store.ui.focus === "overlay") store.setFocus(chosen || returnFocus === "card" ? "prompt" : returnFocus);
      });
    }
    if (s.startup && !chosen) host.startNew();
  }

  // Another overlay (the palette) took the slot, or focus went elsewhere (a click): the list
  // closes; at start-up that starts a new session, as Esc would.
  createEffect(
    on(
      () => [store.ui.overlay, store.ui.focus] as const,
      ([overlay, focus]) => {
        if (open() && !busy() && (overlay !== SESSION_LIST_OVERLAY || focus !== "overlay")) close(false);
      },
      { defer: true },
    ),
  );

  function choose(): void {
    const chosen = shown()[selected()];
    if (!chosen || busy()) return;
    // No further page is asked for, the request in flight is cancelled and a page that answers
    // late is dropped (the generation moves on): the session opens without waiting for the list.
    generation += 1;
    cancelReading();
    batch(() => {
      setReading(false);
      setBusy(true);
    });
    // Taken at once; carried out once the harness is up, or its start-up error shown here.
    if (starting()) {
      setFooter(null);
      setWaiting(true);
      host.ready().then(
        () => {
          setWaiting(false);
          openChosen(chosen);
        },
        (error: unknown) => {
          batch(() => {
            setWaiting(false);
            setBusy(false);
            setStarting(false);
            setStartFailed(true);
            setFooter({ text: error instanceof Error ? error.message : String(error), token: "danger" });
          });
        },
      );
      return;
    }
    openChosen(chosen);
  }

  /** Opens the chosen row through the switcher (the list is busy meanwhile). */
  function openChosen(chosen: { readonly entry: SessionListEntry; readonly item: { readonly title: string } }): void {
    setFooter({ text: chosen.entry.kind === "new" ? `starting a new session with ${chosen.item.title.replace(/^New session with /, "")}…` : `opening ${chosen.item.title}…`, token: "muted" });
    host.choose(chosen.entry).then(
      (problem) => {
        setBusy(false);
        if (problem === null) {
          close(true);
          return;
        }
        setFooter({ text: problem, token: "danger" });
        // The scope's rows again: a failed open may have recorded nothing, but the index may
        // have changed meanwhile.
        setRecords(host.records());
        // The choice stopped the paging: a list still empty of the harness's rows asks for its
        // first page again (the cancelled page's cursor is kept, so later pages follow as usual).
        if (listed().length === 0 && cursor() === null) readPage(null);
      },
      (error: unknown) => {
        setBusy(false);
        // Not a failure to open (those resolve with the message above) but acp-tui's own error,
        // such as a component that threw while the store attached the new session: it goes on to
        // the app's uncaught-error path (terminal restored, the message below the command line,
        // exit status 1), never into the footer as if the agent had failed (IDE check 10.2).
        throw error;
      },
    );
  }

  const layout = createMemo(() => {
    const s = props.state();
    const enter = actionLabel(keyMap, "overlay", "choose");
    const tab = actionLabel(keyMap, "overlay", "toggleScope");
    const esc = actionLabel(keyMap, "overlay", "close");
    const all = scope() === "all";
    const hints: Segment[] = [
      { text: "↑↓ select", token: "muted" },
      ...(enter ? [{ text: " · ", token: "muted" as const, breakBefore: true }, { text: `${enter} open`, token: "muted" as const }] : []),
      ...(tab ? [{ text: " · ", token: "muted" as const, breakBefore: true }, { text: `${tab} ${all ? "this directory" : "all directories"}`, token: "muted" as const }] : []),
      ...(esc && s?.startup ? [{ text: " · ", token: "muted" as const, breakBefore: true }, { text: `${esc} new session`, token: "muted" as const }] : []),
    ];
    const where = s ? oneLine(shortenHome(s.directory, home)) : "";
    const waitingFor = wait();
    const info = footer() ?? (waitingFor !== null ? { text: waitText(waitingFor, harness(), LIVE_GLYPHS.spinner[spinner.frame() % LIVE_GLYPHS.spinner.length] ?? " "), token: "muted" as TokenName } : { text: "", token: "muted" as TokenName });
    const shownItems = shown();
    // The selected entry keeps its screen row when rows arrive above it.
    const kept = keepSelection(held(), shownItems.map((i) => i.item.id), { index: lastIndex, offset: lastOffset });
    if (held() !== null && lastKey === held()) lastOffset = kept.offset;
    // With no session to show, once nothing is loading: the first row after the entries says so.
    const loading = wait() !== null || cursor() !== null;
    const hasSessions = shownItems.some((i) => i.entry.kind === "session");
    const tail = s !== null && !hasSessions && !loading && !startFailed() ? noSessionsLine(scope(), s.directory, home, filter() !== "") : undefined;
    const result = overlayLayout({
      title: all ? "Sessions in all directories" : `Sessions in ${where}`,
      filter: filter(),
      placeholder: "type to filter by title, harness or directory",
      items: shownItems.map((i) => i.item),
      grouped: false,
      selected: selected(),
      offset: lastOffset,
      width: dims().width,
      rows: dims().height,
      // The panel has its full height from the first frame to its close, blank rows below the
      // entries, so it never grows or moves while rows arrive (day-two-feedback D2).
      minRows: dims().height,
      ...(tail !== undefined ? { tail } : {}),
      closeLabel: esc,
      hints,
      marks: false,
      // Aligned detail columns; with all directories shown the time is dropped before the directory.
      detailDrop: detailDropOrder(scope()),
      detailMin: DETAIL_MIN_WIDTHS,
      // Messages quote the agent's errors and recorded commands: printable, on one line.
      footer: { ...info, text: oneLine(info.text) },
    });
    lastOffset = result.offset;
    lastIndex = selected();
    lastKey = held();
    return result;
  });

  const moveBy = (move: number | "first" | "last") => select(moveSelection(shown().length, selected(), move));
  const handlers: ContextHandlers<"overlay"> = {
    up: () => moveBy(-1),
    down: () => moveBy(1),
    pageUp: () => moveBy(-Math.max(1, layout().listHeight - 1)),
    pageDown: () => moveBy(Math.max(1, layout().listHeight - 1)),
    first: () => moveBy("first"),
    last: () => moveBy("last"),
    choose,
    close: () => {
      if (!busy()) close(false);
    },
    clear: () => {
      setFilter("");
      selectFirst();
    },
    toggleScope: () => {
      if (busy()) return;
      setScope((s) => (s === "directory" ? "all" : "directory"));
      setFooter(null);
      reload();
    },
  };

  // The `sessions` action: the list while a session is open (no default key).
  onCleanup(
    registerContext(keymap, keyMap, "global", {
      sessions: () => {
        if (open()) return;
        if (host.current() === null) {
          controller.notify(`${harnessName(host.currentAgent())} is still starting`, "muted");
          return;
        }
        props.setState(openState(host, false, null));
      },
    }),
  );

  const onKeyDown = (key: KeyEvent) => {
    if (key.name === "backspace") {
      setFilter((f) => [...f].slice(0, -1).join(""));
      selectFirst();
      key.preventDefault();
      return;
    }
    const typed = typedText(key);
    if (typed !== null) {
      setFilter((f) => f + typed);
      selectFirst();
      key.preventDefault();
    }
  };

  const spanStyle = (s: OverlaySegment) => {
    const base = theme.text(s.token);
    if (s.cursor) return toSpan({ ...base, attributes: base.attributes | TextAttributes.INVERSE });
    if (!s.selected) return toSpan(base);
    return toSpan(theme.flat ? { ...base, attributes: base.attributes | TextAttributes.INVERSE } : { ...base, bg: theme.color("surface.cursor") });
  };

  function Panel(): JSX.Element {
    let box: BoxRenderable | undefined;
    onMount(() => {
      if (box) onCleanup(registerContext(keymap, keyMap, "overlay", handlers, { target: box }));
    });
    return (
      <box
        ref={(r: BoxRenderable) => (box = r)}
        position="absolute"
        left={0}
        bottom={OVERLAY_BOTTOM}
        zIndex={100}
        width={dims().width}
        height={layout().lines.length}
        flexDirection="column"
        focusable
        focused={store.ui.focus === "overlay"}
        backgroundColor={theme.color("surface.overlay")}
        onKeyDown={onKeyDown}
        {...listPointer({
          box: () => box,
          itemAt: () => layout().itemAt,
          // The pointer selects as the keyboard does (nothing when the row is already selected, so
          // the held entry is not set by a pointer that rests); a click does what Enter does, and
          // like Enter it is taken once a choice is being made (task 13.6).
          select: (index) => {
            if (index !== selected()) select(index);
          },
          choose: (index) => {
            if (busy()) return;
            select(index);
            choose();
          },
        })}
      >
        <For each={layout().lines}>
          {(row) => (
            <text wrapMode="none" height={1} {...theme.text("text")}>
              <For each={row}>{(s) => <span style={spanStyle(s)}>{s.text}</span>}</For>
            </text>
          )}
        </For>
      </box>
    );
  }

  return (
    <Show when={open()}>
      <Panel />
    </Show>
  );
}
