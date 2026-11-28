// The activity bar block (design 6.2, D7; spec tui-layout "Activity bar"):
// one line, shown while a turn runs with a tool call in progress or a plan
// reported this turn, or while a permission request is open; its content and
// width policy are `activityBar` (activity.ts). When the last running call
// finishes during a turn it lingers for `activity.linger_seconds`
// (day-two-feedback design D6): the finished call, muted (`lingerLine`), in the
// same row. Right-aligned it carries the running turn's run time (`4m 35s`,
// from the store's view, which ticks once a second while a turn runs), from
// the turn's start until its end, alone while nothing runs or lingers; blank
// while idle and while a session is being opened (no turn).
// The blank row above it (day-one-feedback: space between the conversation
// and the running action) is the screen's (`Spacing.activityGap`), which drops
// it in a short pane.
import { For, batch, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { ToolCallItem } from "acp-model";
import { useApp, useConfig } from "../app/context.ts";
import { RIGHT_MARGIN, SCROLLBAR_COLUMNS } from "../conversation/window/WindowedConversation.tsx";
import { toolTitleText } from "../conversation/tool-title.ts";
import { activityBar, lingerLine, type LingerCall } from "./activity.ts";
import { formatElapsed } from "./modules.ts";
import { ACTIVITY_LINE_ROWS, type BlockComponent, type BlockProps } from "./Screen.tsx";

function isLiveTool(item: { kind: string; status: string } | undefined): boolean {
  return item?.kind === "tool_call" && item.status === "live";
}

export const ActivityBar: BlockComponent = (props: BlockProps) => {
  const { store, scrollbar } = useApp();
  const config = useConfig();
  // Live tool ids, maintained from the store's item changes, so streaming text never makes
  // this block rescan the whole session. `liveIds` is current at once (the linger follows it); the
  // signal the row reads mirrors it once per macrotask of changes (below).
  let liveIds: string[] = store.snapshot().order.filter((id) => isLiveTool(store.snapshot().items.get(id)));
  const [ids, setIds] = createSignal<string[]>(liveIds);
  // The call the line lingers on after the last running one has finished, until the timer ends it,
  // a call starts, or the turn ends.
  const [linger, setLinger] = createSignal<LingerCall | null>(null);
  let lingerTimer: ReturnType<typeof setTimeout> | undefined;
  const endLinger = () => {
    clearTimeout(lingerTimer);
    lingerTimer = undefined;
    setLinger(null);
  };
  const startLinger = (call: LingerCall) => {
    const seconds = config().activity.linger_seconds;
    endLinger();
    if (seconds <= 0) return;
    setLinger(call);
    lingerTimer = setTimeout(endLinger, seconds * 1000);
  };
  // The live ids are given to the row's signal once per macrotask of changes (as the conversation
  // re-reads its snapshot), so a burst of updates (a 5000-item turn arrives in one) draws the row
  // once instead of once per tool call.
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  // What the changes since the last flush do to the linger: end it (a call started) or start it on
  // the call that finished last; applied in the same batch as the ids, so no frame shows one without
  // the other.
  let pendingLinger: "end" | LingerCall | null = null;
  const flush = (): void => {
    if (flushTimer !== null) clearTimeout(flushTimer);
    flushTimer = null;
    const lingerAction = pendingLinger;
    pendingLinger = null;
    batch(() => {
      setIds(liveIds);
      if (lingerAction === "end") endLinger();
      else if (lingerAction !== null && store.session.state !== "idle") startLinger(lingerAction);
    });
  };
  const scheduleFlush = (): void => {
    flushTimer ??= setTimeout(flush, 0);
  };
  const off = store.onChange((change) => {
    let next: string[] | null = null;
    // The last call this change finished, completed or failed.
    let finished: LingerCall | null = null;
    for (const c of change.items) {
      if (c.item.kind !== "tool_call") continue;
      const live = isLiveTool(c.item);
      const current: string[] = next ?? liveIds;
      const has = current.includes(c.id);
      if (live && !has) next = [...current, c.id];
      else if (!live && has) {
        next = current.filter((id) => id !== c.id);
        if (c.item.toolStatus === "completed" || c.item.toolStatus === "failed") finished = { title: toolTitleText(c.item), failed: c.item.toolStatus === "failed" };
      }
    }
    if (!next) return;
    liveIds = next;
    // A call running replaces the lingering line at once; the last one finishing starts it.
    if (next.length > 0) pendingLinger = "end";
    else if (finished) pendingLinger = finished;
    scheduleFlush();
  });
  onCleanup(() => {
    off();
    clearTimeout(lingerTimer);
    if (flushTimer !== null) clearTimeout(flushTimer);
  });
  // The turn's end ends the linger at once.
  createEffect(() => {
    if (store.session.state === "idle") endLinger();
  });

  // The run time as drawn, from the store's view; a string memo, so the row is recomputed once a
  // second while the turn runs, not on every other change to the view (scrolling, focus).
  const runTime = createMemo(() => {
    const view = store.view();
    return store.session.state !== "idle" && view.turnStartedAt !== null ? formatElapsed(view.now - view.turnStartedAt) : null;
  });
  const row = createMemo(() => {
    const running = store.session.state !== "idle";
    const tools = running
      ? ids()
          .map((id) => store.session.items[id])
          .filter((item): item is ToolCallItem => item?.kind === "tool_call")
      : [];
    const plan = running && store.session.turn?.planReportedThisTurn ? store.session.plan : [];
    const permissionOpen = store.session.openPermissionId !== null;
    // The run time ends where the conversation's text does: before its right margin and scroll bar.
    const width = props.width - RIGHT_MARGIN - (scrollbar !== undefined && props.layout.scrollbar ? SCROLLBAR_COLUMNS : 0);
    const time = running ? runTime() : null;
    const lingering = linger();
    if (running && lingering && tools.length === 0 && plan.length === 0 && !permissionOpen) return lingerLine(lingering, width, undefined, undefined, time);
    return activityBar({ running: tools, plan, permissionOpen, runTime: time }, width);
  });
  // The line keeps its row for the whole session, blank until something has run (task 13.2).
  createEffect(() => props.onHeight(ACTIVITY_LINE_ROWS));
  return (
    <text wrapMode="none" height={1} {...props.theme.text("text")}>
      <For each={row() ?? []}>{(s) => <span style={props.theme.text(s.token)}>{s.text}</span>}</For>
    </text>
  );
};
