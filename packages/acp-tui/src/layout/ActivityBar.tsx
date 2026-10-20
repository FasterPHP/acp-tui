// The activity bar block (design 6.2, D7; spec tui-layout "Activity bar"):
// one line, shown while a turn runs with a tool call in progress or a plan
// reported this turn, or while a permission request is open; its content and
// width policy are `activityBar` (activity.ts). When the last running call
// finishes during a turn it lingers for `activity.linger_seconds`
// (day-two-feedback design D6): the finished call, muted (`lingerLine`), in the
// same row. It takes no rows otherwise.
// The blank row above it (day-one-feedback: space between the conversation
// and the running action) is the screen's (`Spacing.activityGap`), which drops
// it in a short pane.
import { createEffect, createMemo, createSignal, For, onCleanup } from "solid-js";
import type { ToolCallItem } from "acp-model";
import { useApp, useConfig } from "../app/context.ts";
import { activityBar, lingerLine, type LingerCall } from "./activity.ts";
import { ACTIVITY_LINE_ROWS, type BlockComponent, type BlockProps } from "./Screen.tsx";

function isLiveTool(item: { kind: string; status: string } | undefined): boolean {
  return item?.kind === "tool_call" && item.status === "live";
}

export const ActivityBar: BlockComponent = (props: BlockProps) => {
  const { store } = useApp();
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
  const off = store.onChange((change) => {
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
        if (c.item.toolStatus === "completed" || c.item.toolStatus === "failed") finished = { title: c.item.title, failed: c.item.toolStatus === "failed" };
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
  });

  const row = createMemo(() => {
    const running = store.session.state !== "idle";
    const tools = running
      ? ids()
          .map((id) => store.session.items[id])
          .filter((item): item is ToolCallItem => item?.kind === "tool_call")
      : [];
    const plan = running && store.session.turn?.planReportedThisTurn ? store.session.plan : [];
    const built = activityBar({ running: tools, plan, permissionOpen: store.session.openPermissionId !== null }, props.width);
    if (built || !running) return built;
    const lingering = linger();
    return lingering ? lingerLine(lingering, props.width) : null;
  });
  // The line keeps its row for the whole session, blank until something has run (task 13.2).
  createEffect(() => props.onHeight(ACTIVITY_LINE_ROWS));
  return (
    <text wrapMode="none" height={1} {...props.theme.text("text")}>
      <For each={row() ?? []}>{(s) => <span style={props.theme.text(s.token)}>{s.text}</span>}</For>
    </text>
  );
};
