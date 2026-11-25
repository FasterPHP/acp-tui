// The activity bar block (design 6.2, D7; spec tui-layout "Activity bar"):
// one line, shown while a turn runs with a tool call in progress or a plan
// reported this turn, or while a permission request is open; its content and
// width policy are `activityBar` (activity.ts). When the last running call
// finishes during a turn it lingers for `activity.linger_seconds`
// (day-two-feedback design D6): the finished call, muted (`lingerLine`), in the
// same row. Right-aligned it carries the turn's count (focus-groups design D6),
// kept here incrementally from the store's item changes, reset when a turn
// starts, from the turn's first call or thought until its end; alone once
// nothing runs or lingers. It takes no rows otherwise.
// The blank row above it (day-one-feedback: space between the conversation
// and the running action) is the screen's (`Spacing.activityGap`), which drops
// it in a short pane.
import { createEffect, createMemo, createSignal, For, onCleanup } from "solid-js";
import type { Item, ToolCallItem } from "acp-model";
import { useApp, useConfig } from "../app/context.ts";
import { addCounts, EMPTY_COUNTS, isRunningTool, type ItemCounts } from "../conversation/counts.ts";
import { isRenderable } from "../conversation/list.ts";
import { RIGHT_MARGIN, SCROLLBAR_COLUMNS } from "../conversation/window/WindowedConversation.tsx";
import { toolTitleText } from "../conversation/tool-title.ts";
import { activityBar, lingerLine, type LingerCall } from "./activity.ts";
import { ACTIVITY_LINE_ROWS, type BlockComponent, type BlockProps } from "./Screen.tsx";

function isLiveTool(item: { kind: string; status: string } | undefined): boolean {
  return item?.kind === "tool_call" && item.status === "live";
}

export const ActivityBar: BlockComponent = (props: BlockProps) => {
  const { store, scrollbar } = useApp();
  const config = useConfig();
  // Live tool ids, maintained from the store's item changes, so streaming text never makes
  // this block rescan the whole session.
  const initial = store.snapshot().order.filter((id) => isLiveTool(store.snapshot().items.get(id)));
  const [ids, setIds] = createSignal<string[]>(initial);
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
  // The turn's count (focus-groups D6): `turnKey` is the running turn's `startedAt`; each tool
  // call's last counted state and each counted thought are kept, so a change adjusts the totals
  // instead of rescanning the session.
  const [counts, setCounts] = createSignal<ItemCounts>(EMPTY_COUNTS);
  let turnKey: number | null = null;
  let tools = new Map<string, { failed: boolean; running: boolean }>();
  let thoughts = new Set<string>();
  const syncTurn = () => {
    const key = store.session.turn?.startedAt ?? null;
    if (key === turnKey) return;
    turnKey = key;
    tools = new Map();
    thoughts = new Set();
    setCounts(EMPTY_COUNTS);
  };
  const count = (changes: readonly { id: string; item: Item }[]) => {
    if (turnKey === null) return;
    let next = counts();
    for (const c of changes) {
      const item = c.item;
      if (item.kind === "tool_call") {
        const now = { failed: item.toolStatus === "failed", running: isRunningTool(item) };
        const was = tools.get(c.id);
        if (!was) next = addCounts(next, item);
        else if (was.failed !== now.failed || was.running !== now.running) {
          next = { ...next, failed: next.failed + (now.failed ? 1 : 0) - (was.failed ? 1 : 0), running: next.running + (now.running ? 1 : 0) - (was.running ? 1 : 0) };
        }
        tools.set(c.id, now);
      } else if (item.kind === "thought" && !thoughts.has(c.id) && isRenderable(item)) {
        thoughts.add(c.id);
        next = addCounts(next, item);
      }
    }
    if (next !== counts()) setCounts(next);
  };
  const off = store.onChange((change) => {
    syncTurn();
    count(change.items);
    let next: string[] | null = null;
    // The last call this change finished, completed or failed.
    let finished: LingerCall | null = null;
    for (const c of change.items) {
      if (c.item.kind !== "tool_call") continue;
      const live = isLiveTool(c.item);
      const current: string[] = next ?? ids();
      const has = current.includes(c.id);
      if (live && !has) next = [...current, c.id];
      else if (!live && has) {
        next = current.filter((id) => id !== c.id);
        if (c.item.toolStatus === "completed" || c.item.toolStatus === "failed") finished = { title: toolTitleText(c.item), failed: c.item.toolStatus === "failed" };
      }
    }
    if (!next) return;
    setIds(next);
    // A call running replaces the lingering line at once; the last one finishing starts it.
    if (next.length > 0) endLinger();
    else if (finished && store.session.state !== "idle") startLinger(finished);
  });
  onCleanup(() => {
    off();
    clearTimeout(lingerTimer);
  });
  // The turn's end ends the linger at once.
  createEffect(() => {
    if (store.session.state === "idle") endLinger();
    store.session.turn?.startedAt;
    syncTurn();
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
    // The count ends where the conversation's text does: before its right margin and scroll bar.
    const width = props.width - RIGHT_MARGIN - (scrollbar !== undefined && props.layout.scrollbar ? SCROLLBAR_COLUMNS : 0);
    const count = running ? counts() : EMPTY_COUNTS;
    const lingering = linger();
    if (running && lingering && tools.length === 0 && plan.length === 0 && !permissionOpen) return lingerLine(lingering, width, undefined, undefined, count);
    return activityBar({ running: tools, plan, permissionOpen, count }, width);
  });
  // The line keeps its row for the whole session, blank until something has run (task 13.2).
  createEffect(() => props.onHeight(ACTIVITY_LINE_ROWS));
  return (
    <text wrapMode="none" height={1} {...props.theme.text("text")}>
      <For each={row() ?? []}>{(s) => <span style={props.theme.text(s.token)}>{s.text}</span>}</For>
    </text>
  );
};
