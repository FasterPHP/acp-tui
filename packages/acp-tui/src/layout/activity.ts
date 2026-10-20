// The activity bar's content (design 6.2, D7; spec tui-layout "Activity
// bar"). Pure: the number of tool calls in progress with the title of the most
// recently started one, the plan's progress with its current entry
// (`plan 2/5 ▸ <entry>`), and `awaiting permission`. When the row is too
// narrow the titles are truncated first, then dropped, then the plan and the
// running count; `awaiting permission` stays. The text starts in the conversation's text column,
// after the gutter (day-one-feedback task 7.2), so it lines up with the tool glyphs above it.
import type { Session, ToolCallItem } from "acp-model";
import { LIVE_GLYPHS } from "../conversation/live-glyphs.ts";
import { displayWidth, fitSegments, segmentsWidth, truncateEnd, type Segment } from "./segments.ts";

type PlanEntry = Session["plan"][number];

export interface ActivityInput {
  /** Tool calls pending or in progress, in start order. */
  running: readonly Pick<ToolCallItem, "title">[];
  /** The plan reported during the running turn; empty when none (or idle). */
  plan: readonly Pick<PlanEntry, "content" | "status">[];
  permissionOpen: boolean;
}

export const PLAN_POINTER = "▸";
const SEPARATOR = " · ";
/** A title is not truncated below this many columns; it is dropped instead. */
const MIN_TAIL = 12;

interface Part {
  kind: "running" | "plan" | "awaiting";
  head: Segment;
  tail: string | null;
}

/** A part and whether its title (tail) is shown in this attempt. */
interface Shown {
  part: Part;
  tail: boolean;
}

function oneLine(text: string): string {
  return text.replace(/[\r\n\t]+/g, " ").trim();
}

function parts(input: ActivityInput): Record<Part["kind"], Part | null> {
  const latest = input.running.at(-1);
  const running: Part | null = latest
    ? { kind: "running", head: { text: `${input.running.length} running`, token: "tool.running" }, tail: oneLine(latest.title) || null }
    : null;
  let plan: Part | null = null;
  if (input.plan.length > 0) {
    const done = input.plan.filter((e) => e.status === "completed").length;
    const current = input.plan.find((e) => e.status === "in_progress") ?? input.plan.find((e) => e.status === "pending");
    plan = { kind: "plan", head: { text: `plan ${done}/${input.plan.length}`, token: "muted" }, tail: current ? oneLine(current.content) || null : null };
  }
  const awaiting: Part | null = input.permissionOpen
    ? { kind: "awaiting", head: { text: "awaiting permission", token: "permission" }, tail: null }
    : null;
  return { running, plan, awaiting };
}

const lead = (part: Part) => (part.kind === "plan" ? ` ${PLAN_POINTER} ` : ": ");

/** The row, each shown title truncated to its width in `widths` (by part kind). */
function render(list: readonly Shown[], widths: ReadonlyMap<Part["kind"], number>, indent: number): Segment[] {
  const out: Segment[] = [{ text: " ".repeat(indent), token: "muted" }];
  list.forEach(({ part, tail }, i) => {
    if (i > 0) out.push({ text: SEPARATOR, token: "muted" });
    out.push(part.head);
    const w = widths.get(part.kind);
    if (tail && part.tail !== null && w !== undefined) {
      out.push({ text: lead(part), token: "muted" }, { text: truncateEnd(part.tail, w), token: "text" });
    }
  });
  return out;
}

/** `list` in `width` columns, sharing the room left between the titles; null if it cannot fit. */
function fit(list: readonly Shown[], width: number, indent: number): Segment[] | null {
  const titled = list.filter((l) => l.tail && l.part.tail !== null);
  const fixed = segmentsWidth(render(list, new Map(), indent));
  let room = width - fixed - titled.reduce((w, l) => w + displayWidth(lead(l.part)), 0);
  const wants = titled.map((l) => ({ kind: l.part.kind, want: displayWidth(l.part.tail!) }));
  if (wants.reduce((w, t) => w + t.want, 0) <= room) return render(list, new Map(wants.map((t) => [t.kind, t.want])), indent);
  if (titled.length === 0 || room < MIN_TAIL * titled.length) return null;
  // Shorter titles keep their full width; the rest share what is left.
  const widths = new Map<Part["kind"], number>();
  [...wants]
    .sort((a, b) => a.want - b.want)
    .forEach((t, i, all) => {
      const give = Math.min(t.want, Math.floor(room / (all.length - i)));
      widths.set(t.kind, give);
      room -= give;
    });
  return render(list, widths, indent);
}

/**
 * The activity bar's row for `width` columns, or null when there is nothing to show. Pure, so the
 * width policy is unit-tested without a renderer. The text starts `indent` columns in (the
 * conversation's gutter, by default).
 */
export function activityBar(input: ActivityInput, width: number, indent: number = LIVE_GLYPHS.gutterWidth): Segment[] | null {
  const p = parts(input);
  if (!p.running && !p.plan && !p.awaiting) return null;
  // Most detailed first: both titles, then the plan entry dropped, then the tool title, then the
  // plan, then the running count; `awaiting permission` always stays.
  const attempts: [Part | null, boolean][][] = [
    [[p.running, true], [p.plan, true], [p.awaiting, false]],
    [[p.running, true], [p.plan, false], [p.awaiting, false]],
    [[p.running, false], [p.plan, false], [p.awaiting, false]],
    [[p.running, false], [p.awaiting, false]],
    [[p.awaiting, false]],
  ];
  for (const attempt of attempts) {
    const list = attempt.flatMap(([part, tail]) => (part ? [{ part, tail }] : []));
    if (list.length === 0) continue;
    const row = fit(list, width, indent);
    if (row) return row;
  }
  const last = p.awaiting ?? p.running ?? p.plan!;
  return fitSegments(render([{ part: last, tail: false }], new Map(), indent), width);
}


/** A call that has finished, for the line that lingers after it (design D6). */
export interface LingerCall {
  readonly title: string;
  /** The call failed: its glyph is the set's `tool.status.fail`, else `tool.status.ok`. */
  readonly failed: boolean;
}

/**
 * The line that lingers after the last running call finishes while the turn still runs
 * (day-two-feedback design D6, spec tui-layout "Activity bar"): the finished call's status glyph and
 * title, all in `muted`, starting `indent` columns in like the running line, the title truncated to
 * the room beside the glyph. Pure, so the width policy is unit-tested without a renderer.
 */
export function lingerLine(
  call: LingerCall,
  width: number,
  indent: number = LIVE_GLYPHS.gutterWidth,
  glyphs: { readonly ok: string; readonly fail: string } = LIVE_GLYPHS.toolStatus,
): Segment[] {
  const glyph = call.failed ? glyphs.fail : glyphs.ok;
  const head = `${" ".repeat(indent)}${glyph}`;
  const title = oneLine(call.title);
  const room = width - displayWidth(head) - 1;
  const text = title === "" || room < 1 ? "" : ` ${truncateEnd(title, room)}`;
  return fitSegments([{ text: `${head}${text}`, token: "muted" }], width);
}
