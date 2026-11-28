// The activity bar's content (design 6.2, D7; spec tui-layout "Activity line run time"). Pure: at
// the left the kind and title of the most recently started tool call in progress (`read src/a.ts`,
// the kind in its `tool.kind.<kind>` token, as in the conversation's collapsed line), the plan's
// progress with its current entry (`plan 2/5 ▸ <entry>`) and `awaiting permission`; at the right,
// ending at the width given, `running` and the running turn's run time (`running 4m 35s`,
// `formatElapsed`), the word in the turn-state's `running` token and the time in `muted`. When the
// row is too narrow the titles are truncated first, then dropped (the kind stays), then the plan;
// the run time and `awaiting permission` stay, and only when `running <time>` leaves no room for
// them does the word `running` go before the time (run-time-and-cmd-keys design D4 and D5). The text starts in the conversation's text column, after the gutter
// (day-one-feedback task 7.2), so it lines up with the tool glyphs above it, and at least one space
// separates the left from the run time. `running <time>` alone is a valid row. (The turn's count that
// focus-groups put at the right is gone: the gap lines and the turn-end line carry it.)
import type { Session, ToolCallItem } from "acp-model";
import { LIVE_GLYPHS } from "../conversation/live-glyphs.ts";
import { toolTitleText } from "../conversation/tool-title.ts";
import { toolKindToken } from "../theme/tokens.ts";
import { TURN_TOKENS } from "./modules.ts";
import { displayWidth, fitSegments, segmentsWidth, truncateEnd, type Segment } from "./segments.ts";

type PlanEntry = Session["plan"][number];

export interface ActivityInput {
  /** Tool calls pending or in progress, in start order. */
  running: readonly (Pick<ToolCallItem, "title"> &
    Partial<Pick<ToolCallItem, "toolKind" | "toolName">> & { readonly inputText?: string | null })[];
  /** The plan reported during the running turn; empty when none (or idle). */
  plan: readonly Pick<PlanEntry, "content" | "status">[];
  permissionOpen: boolean;
  /** The running turn's run time as drawn (`4m 35s`; the row adds `running`), or null (idle, or no turn yet). */
  runTime?: string | null;
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
  // The running part is the call's kind and title; how many calls run is on the gap line (focus)
  // or on each call's own row.
  const title = latest ? toolTitleText(latest) : "";
  const kind = latest ? activityKind(latest) : "";
  // A title that is only the kind (a call with no input) shows the kind once.
  const same = title.toLowerCase() === kind.toLowerCase();
  const running: Part | null =
    title || kind
      ? { kind: "running", head: { text: kind, token: toolKindToken(latest!.toolKind) }, tail: title && !same ? title : null }
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

const lead = (part: Part) => (part.kind === "plan" ? ` ${PLAN_POINTER} ` : part.kind === "running" ? (part.head.text ? " " : "") : ": ");

/**
 * The call's kind as the row names it: its ACP kind, or the harness's tool name when it sent none;
 * empty for the catch-all `other` (and for neither), where the title alone says what it does.
 */
function activityKind(call: Partial<Pick<ToolCallItem, "toolKind" | "toolName">>): string {
  const kind = oneLine(call.toolKind ?? "");
  if (kind !== "" && kind !== "other") return kind;
  return kind === "other" ? "" : oneLine(call.toolName ?? "");
}

/** `running <time>` on the activity line: the word in the turn-state's running token, the time in
 *  `muted`; with `word` false the time alone (a row too narrow for both). None when no turn. */
function runTimeOf(runTime: string | null | undefined, word = true): Segment[] {
  if (!runTime) return [];
  const time: Segment = { text: runTime, token: "muted" };
  return word ? [{ text: "running ", token: TURN_TOKENS.running }, time] : [time];
}

/** `left` then spaces then `right`, `right` ending at `width`; the spaces at least one. */
function join(left: Segment[], right: Segment[], width: number): Segment[] {
  if (right.length === 0) return left;
  const pad = Math.max(1, width - segmentsWidth(left) - segmentsWidth(right));
  return [...left, { text: " ".repeat(pad), token: "muted" }, ...right];
}

/** The row, each shown title truncated to its width in `widths` (by part kind). */
function render(list: readonly Shown[], widths: ReadonlyMap<Part["kind"], number>, indent: number): Segment[] {
  const out: Segment[] = [{ text: " ".repeat(indent), token: "muted" }];
  list.forEach(({ part, tail }, i) => {
    if (i > 0) out.push({ text: SEPARATOR, token: "muted" });
    if (part.head.text !== "") out.push(part.head);
    const w = widths.get(part.kind);
    if (tail && part.tail !== null && w !== undefined) {
      const l = lead(part);
      if (l !== "") out.push({ text: l, token: "muted" });
      out.push({ text: truncateEnd(part.tail, w), token: "text" });
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
  if (room < 0) return null;
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
 * The activity bar's row for `width` columns (the run time ends at the last of them), or null when
 * there is nothing to show. Pure, so the width policy is unit-tested without a renderer. The text
 * starts `indent` columns in (the conversation's gutter, by default).
 */
export function activityBar(input: ActivityInput, width: number, indent: number = LIVE_GLYPHS.gutterWidth): Segment[] | null {
  const p = parts(input);
  const full = runTimeOf(input.runTime);
  const short = runTimeOf(input.runTime, false);
  const blank: Segment = { text: " ".repeat(indent), token: "muted" };
  if (!p.running && !p.plan && !p.awaiting) {
    if (full.length === 0) return null;
    const right = indent + segmentsWidth(full) + 1 <= width ? full : short;
    return fitSegments(join([blank], right, width), width);
  }
  // Most detailed first: both titles, then the plan entry dropped, then the tool title (its kind
  // stays), then the kind and the plan; `running <time>` and `awaiting permission` always stay,
  // and the word `running` goes before either of them is cut.
  const attempts: [Part | null, boolean][][] = [
    [[p.running, true], [p.plan, true], [p.awaiting, false]],
    [[p.running, true], [p.plan, false], [p.awaiting, false]],
    [[p.running, false], [p.plan, false], [p.awaiting, false]],
    [[p.running, false], [p.awaiting, false]],
    [[p.plan, false], [p.awaiting, false]],
    [[p.awaiting, false]],
  ];
  for (const right of full.length > 0 ? [full, short] : [full]) {
    const room = width - (right.length > 0 ? segmentsWidth(right) + 1 : 0);
    for (const attempt of attempts) {
      const list = attempt.flatMap(([part, tail]) => (part && !(part.kind === "running" && !tail && part.head.text === "") ? [{ part, tail }] : []));
      if (list.length === 0) continue;
      const row = fit(list, room, indent);
      if (row) return join(row, right, width);
    }
  }
  // Nothing fits beside the run time: `awaiting permission` (when open) is cut to the room left of
  // it, or the run time stands alone; the run time is cut only when it alone is wider than the row.
  const right = !p.awaiting && indent + segmentsWidth(full) + 1 <= width ? full : short;
  const room2 = width - (right.length > 0 ? segmentsWidth(right) + 1 : 0);
  const left = p.awaiting && room2 > indent + 1 ? fitSegments(render([{ part: p.awaiting, tail: false }], new Map(), indent), room2) : [];
  return fitSegments(join(left.length > 0 ? left : [blank], right, width), width);
}

/** A call that has finished, for the line that lingers after it (design D6). */
export interface LingerCall {
  readonly title: string;
  /** The call failed: its glyph is the set's `tool.status.fail`, else `tool.status.ok`. */
  readonly failed: boolean;
}

/**
 * The line that lingers after the last running call finishes while the turn still runs
 * (day-two-feedback design D6, spec tui-layout "Activity line linger"): the finished call's status
 * glyph and title, all in `muted`, starting `indent` columns in like the running line, the title
 * truncated to the room beside the glyph and, ending at `width`, the turn's run time. Pure, so the
 * width policy is unit-tested without a renderer.
 */
export function lingerLine(
  call: LingerCall,
  width: number,
  indent: number = LIVE_GLYPHS.gutterWidth,
  glyphs: { readonly ok: string; readonly fail: string } = LIVE_GLYPHS.toolStatus,
  runTime: string | null = null,
): Segment[] {
  const glyph = call.failed ? glyphs.fail : glyphs.ok;
  const head = `${" ".repeat(indent)}${glyph}`;
  const title = oneLine(call.title);
  const roomFor = (right: Segment[]) => width - displayWidth(head) - 1 - (right.length > 0 ? segmentsWidth(right) + 1 : 0);
  const wordy = runTimeOf(runTime);
  const right = roomFor(wordy) >= MIN_TAIL ? wordy : runTimeOf(runTime, false);
  const room = roomFor(right);
  const text = title === "" || room < 1 ? "" : ` ${truncateEnd(title, room)}`;
  const left: Segment[] = [{ text: `${head}${text}`, token: "muted" }];
  return fitSegments(join(left, right, width), width);
}
