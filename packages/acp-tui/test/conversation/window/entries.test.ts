// Spike S3 (tasks 12.4 and 12.5). Grouping runs of reads,
// searches, fetches and thoughts into one line, and the three densities, as
// pure functions over model items.
import { describe, expect, test } from "bun:test";
import type { Item, MarkerItem, ThoughtItem, ToolCallItem } from "acp-model";
import { addCounts, countItems, countSegments, EMPTY_COUNTS, isRunningTool, isStoppedTool } from "../../../src/conversation/counts.ts";
import { expandedByDefault } from "../../../src/conversation/view-model.ts";
import { buildEntries, groupable, groupKeyItem, groupLine, groupRuns, jumpTarget, nextDensity, focusGaps, type GroupEntry, type ItemLookup } from "../../../src/conversation/window/entries.ts";

let index = 0;
const tool = (id: string, toolKind: ToolCallItem["toolKind"], over: Partial<ToolCallItem> = {}): ToolCallItem => ({
  id,
  kind: "tool_call",
  status: "final",
  origin: "self",
  toolCallId: id,
  index: ++index,
  title: `${toolKind} ${id}`,
  toolName: null,
  toolKind,
  toolStatus: "completed",
  content: [],
  locations: [],
  rawOutputText: null,
  inputText: null,
  startedAt: 1000,
  endedAt: 1100,
  ...over,
});
const thought = (id: string, over: Partial<ThoughtItem> = {}): ThoughtItem => ({ id, kind: "thought", status: "final", origin: "self", text: "**T**", ...over });
const user = (id: string): Item => ({ id, kind: "user_message", status: "final", origin: "self", text: "hi" });
const agent = (id: string): Item => ({ id, kind: "agent_message", status: "final", origin: "self", text: "answer" });
const turnEnd = (id: string): MarkerItem => ({ id, kind: "marker", status: "final", origin: "self", markerKind: "turn_end", stopReason: "end_turn", interrupted: false, durationMs: 10, usage: null });

function model(...items: Item[]): { order: string[]; lookup: ItemLookup } {
  const map = new Map(items.map((i) => [i.id, i]));
  return { order: items.map((i) => i.id), lookup: (id) => map.get(id) };
}

const closed = () => false;

describe("grouping (compact)", () => {
  test("what may join a run: finished reads, searches, fetches, thinks and thoughts; not failed, live or other kinds", () => {
    expect(groupable(tool("a", "read"))).toBe(true);
    expect(groupable(tool("a", "search"))).toBe(true);
    expect(groupable(tool("a", "fetch"))).toBe(true);
    expect(groupable(tool("a", "think"))).toBe(true);
    expect(groupable(thought("t"))).toBe(true);
    expect(groupable(tool("a", "edit"))).toBe(false);
    expect(groupable(tool("a", "execute"))).toBe(false);
    expect(groupable(tool("a", "read", { toolStatus: "failed" }))).toBe(false);
    expect(groupable(tool("a", "read", { status: "live", toolStatus: "in_progress" }))).toBe(false);
    expect(groupable(thought("t", { status: "live" }))).toBe(false);
    expect(groupable(agent("m"))).toBe(false);
  });

  test("runs of two or more become one group; a lone read stays an item; anything else breaks the run", () => {
    const m = model(user("u"), tool("r1", "read"), tool("r2", "read"), tool("s1", "search"), agent("m"), tool("r3", "read"), tool("e1", "edit"), thought("t1"), tool("f1", "fetch"));
    expect(groupRuns(m.order, m.lookup)).toEqual([
      { kind: "item", id: "u" },
      { kind: "group", key: "group:run:r1", mode: "run", members: ["r1", "r2", "s1"] },
      { kind: "item", id: "m" },
      { kind: "item", id: "r3" },
      { kind: "item", id: "e1" },
      { kind: "group", key: "group:run:t1", mode: "run", members: ["t1", "f1"] },
    ]);
  });

  test("a turn's last thought joins its run like any other (thoughts always start collapsed, review C16)", () => {
    const m = model(tool("r1", "read"), thought("t1"), tool("o1", "read"), tool("o2", "read"), agent("m"));
    expect(groupRuns(m.order, m.lookup).map((s) => (s.kind === "group" ? s.key : s.id))).toEqual(["group:run:r1", "m"]);
    const entries = buildEntries(m.order, m.lookup, { density: "compact", open: () => false });
    expect(entries.keys).toEqual(["group:run:r1", "m"]);
  });

  test("a failed read splits the run and shows on its own; the group key stays with the first member as the run grows", () => {
    const m = model(tool("r1", "read"), tool("r2", "read"), tool("r3", "read", { toolStatus: "failed" }), tool("r4", "read"), tool("r5", "read"));
    expect(groupRuns(m.order, m.lookup).map((s) => (s.kind === "group" ? s.key : s.id))).toEqual(["group:run:r1", "r3", "group:run:r4"]);
    const grown = model(tool("r1", "read"), tool("r2", "read"), tool("r2b", "search"));
    expect(groupRuns(grown.order, grown.lookup)[0]).toMatchObject({ key: "group:run:r1", members: ["r1", "r2", "r2b"] });
  });

  // Scenario "A quiet other call joins the run" (tui-conversation "Grouping of quiet runs", design D2).
  test("a quiet other call joins the run and is counted as `other`", () => {
    const quiet = tool("o1", "other", { content: [{ type: "text", text: "Found 2 matching tools" }] });
    expect(groupable(quiet)).toBe(true);
    const m = model(tool("r1", "read"), quiet, thought("t1"));
    const list = buildEntries(m.order, m.lookup, { density: "compact", open: closed });
    expect(list.keys).toEqual(["group:run:r1"]);
    const entry = list.entries[0] as GroupEntry;
    expect(entry.members).toEqual(["r1", "o1", "t1"]);
    expect(groupLine(entry, m.lookup).map((s) => s.text).join("")).toBe("▸ 1 read · 1 other · 1 thought · 0.1s");
    // A live `other` call keeps its own line until it finishes, as the other kinds do.
    expect(groupable(tool("o2", "other", { status: "live", toolStatus: "in_progress" }))).toBe(false);
  });

  // Scenario "A consequential call breaks the run".
  test("an other call that asked for permission, changed a file or failed has its own line and breaks the run", () => {
    const asked = tool("o1", "other", { toolCallId: "tc-asked", title: "Reload configuration" });
    const record: Item = {
      id: "permission:tc-asked",
      kind: "permission_record",
      status: "final",
      origin: "self",
      toolCallId: "tc-asked",
      title: "Reload configuration",
      options: [],
      outcome: { type: "answered", optionId: "allow-once", optionKind: "allow_once" },
    };
    const m = model(tool("r1", "read"), asked, record, tool("r2", "read"));
    const list = buildEntries(m.order, m.lookup, { density: "compact", open: closed });
    // Neither read is grouped: each is alone on its side of the call.
    expect(list.keys).toEqual(["r1", "o1", "permission:tc-asked", "r2"]);
    expect(list.entries.every((e) => e.kind === "item")).toBe(true);
    // Even with the request not shown (a pending one is drawn by the card), the call is not quiet.
    const pending: Item = { ...record, status: "live", outcome: { type: "pending" } };
    const open = model(tool("r1", "read"), tool("o1", "other", { toolCallId: "tc-asked" }), tool("r2", "read"), pending);
    expect(buildEntries(open.order, open.lookup, { density: "compact", open: closed }).keys).toEqual(["r1", "o1", "r2"]);
    // A diff or a failure disqualifies it too.
    expect(groupable(tool("o3", "other", { content: [{ type: "diff", path: "/w/a.php", oldText: "a", newText: "b" }] }))).toBe(false);
    expect(groupable(tool("o4", "other", { toolStatus: "failed" }))).toBe(false);
    expect(groupable(tool("o5", null))).toBe(false);
  });

  // Scenario "A failure is never grouped".
  test("a failed read in the middle of a run is shown on its own, collapsed; the reads around it group separately where there are two or more", () => {
    const failed = tool("r3", "read", { toolStatus: "failed" });
    const m = model(tool("r1", "read"), tool("r2", "read"), failed, tool("r4", "read"), tool("r5", "read"), tool("r6", "read"));
    const list = buildEntries(m.order, m.lookup, { density: "compact", open: closed });
    expect(list.keys).toEqual(["group:run:r1", "r3", "group:run:r4"]);
    expect((list.entries[0] as GroupEntry).members).toEqual(["r1", "r2"]);
    expect((list.entries[2] as GroupEntry).members).toEqual(["r4", "r5", "r6"]);
    expect(list.entries[1]).toMatchObject({ kind: "item", group: null });
    // On its own line it shows collapsed, its failure mark seen (no item expands itself).
    expect(expandedByDefault(failed)).toBe(false);
    expect(expandedByDefault(tool("r1", "read"))).toBe(false);
    // A failed read with a single read on one side: the lone read stays an item.
    const lone = model(tool("a1", "read"), tool("a2", "read", { toolStatus: "failed" }), tool("a3", "read"), tool("a4", "read"));
    expect(buildEntries(lone.order, lone.lookup, { density: "compact", open: closed }).keys).toEqual(["a1", "a2", "group:run:a3"]);
  });

  test("group keys cannot collide with model ids, some of which start with `run:`", () => {
    const m = model({ id: "run:agent_message:1", kind: "agent_message", status: "final", origin: "self", text: "a" }, tool("r1", "read"), tool("r2", "read"));
    const list = buildEntries(m.order, m.lookup, { density: "compact", open: closed });
    expect(list.keys).toEqual(["run:agent_message:1", "group:run:r1"]);
    expect(list.entries[0]!.kind).toBe("item");
    expect(groupKeyItem("group:run:r1")).toBe("r1");
    expect(groupKeyItem("group:gap:run:thought:2")).toBe("run:thought:2");
    expect(groupKeyItem("run:agent_message:1")).toBeNull();
  });

  test("the group line: glyph, counts by kind in first-seen order, and the run's duration", () => {
    const m = model(
      tool("r1", "read", { startedAt: 0, endedAt: 1000 }),
      tool("s1", "search", { startedAt: 500, endedAt: 1200 }),
      tool("r2", "read", { startedAt: 1200, endedAt: 3100 }),
      thought("t1"),
      tool("s2", "search", { startedAt: 2000, endedAt: 2500 }),
    );
    const entry = buildEntries(m.order, m.lookup, { density: "compact", open: closed }).entries[0] as GroupEntry;
    expect(entry.kind).toBe("group");
    expect(groupLine(entry, m.lookup).map((s) => s.text).join("")).toBe("▸ 2 reads · 2 searches · 1 thought · 3.1s");
    const open = buildEntries(m.order, m.lookup, { density: "compact", open: () => true }).entries[0] as GroupEntry;
    expect(groupLine(open, m.lookup)[0]!.text).toBe("▾ ");
    // Durations under 100 ms are not shown, as on tool lines.
    const quick = model(tool("q1", "read", { startedAt: 0, endedAt: 10 }), tool("q2", "read", { startedAt: 10, endedAt: 20 }));
    const q = buildEntries(quick.order, quick.lookup, { density: "compact", open: closed }).entries[0] as GroupEntry;
    expect(groupLine(q, quick.lookup).map((s) => s.text).join("")).toBe("▸ 2 reads");
  });

  test("an open group lists its members below its line; a closed one holds them (holder)", () => {
    const m = model(user("u"), tool("r1", "read"), tool("r2", "read"), agent("m"));
    const shut = buildEntries(m.order, m.lookup, { density: "compact", open: closed });
    expect(shut.keys).toEqual(["u", "group:run:r1", "m"]);
    expect(shut.holder.get("r2")).toBe(1);
    const open = buildEntries(m.order, m.lookup, { density: "compact", open: (k) => k === "group:run:r1" });
    expect(open.keys).toEqual(["u", "group:run:r1", "r1", "r2", "m"]);
    expect(open.holder.get("r2")).toBe(3);
    expect(open.entries[2]).toMatchObject({ kind: "item", group: "group:run:r1", margin: 0 });
    // Spacing: a blank row before the group (after the user message) and before the agent message.
    expect(open.entries.map((e) => e.margin)).toEqual([0, 1, 0, 0, 1]);
  });
});

describe("densities (task 12.5)", () => {
  const m = model(
    user("u1"),
    thought("t1"),
    tool("r1", "read"),
    tool("r2", "read"),
    agent("a1"),
    tool("e1", "edit", { toolStatus: "failed" }),
    tool("x1", "execute"),
    agent("a2"),
    turnEnd("end1"),
    user("u2"),
    tool("r3", "read"),
    agent("a3"),
  );

  test("v cycles compact, verbose, focus", () => {
    expect(nextDensity("compact")).toBe("verbose");
    expect(nextDensity("verbose")).toBe("focus");
    expect(nextDensity("focus")).toBe("compact");
  });

  test("compact groups runs; verbose shows every item; focus hides tools and thoughts behind one line per gap", () => {
    expect(buildEntries(m.order, m.lookup, { density: "compact", open: closed }).keys).toEqual([
      "u1",
      "group:run:t1",
      "a1",
      "e1",
      "x1",
      "a2",
      "end1",
      "u2",
      "r3",
      "a3",
    ]);
    expect(buildEntries(m.order, m.lookup, { density: "verbose", open: closed }).keys).toEqual(m.order);
    const focus = buildEntries(m.order, m.lookup, { density: "focus", open: closed });
    // Several gaps in one turn: before the first answer, between two answers, in the next turn.
    expect(focus.keys).toEqual(["u1", "group:gap:t1", "a1", "group:gap:e1", "a2", "end1", "u2", "group:gap:r3", "a3"]);
    expect((focus.entries[1] as GroupEntry).members).toEqual(["t1", "r1", "r2"]);
    expect((focus.entries[3] as GroupEntry).members).toEqual(["e1", "x1"]);
    expect((focus.entries[1] as GroupEntry).mode).toBe("gap");
    // Every hidden item is held by its gap's line.
    expect(focus.holder.get("x1")).toBe(3);
    expect(focus.holder.get("r2")).toBe(1);
    expect(focus.holder.get("a2")).toBe(4);
  });

  test("a gap line counts tool calls with their states in brackets, then thoughts, and the duration; a failure belongs to its own gap", () => {
    const focus = buildEntries(m.order, m.lookup, { density: "focus", open: closed });
    const text = (i: number) => groupLine(focus.entries[i] as GroupEntry, m.lookup).map((s) => s.text).join("");
    expect(text(1)).toBe("▸ 2 tool calls · 1 thought · 0.1s");
    expect(text(3)).toBe("▸ 2 tool calls (1 failed) · 0.1s");
    const failed = groupLine(focus.entries[3] as GroupEntry, m.lookup).find((s) => s.text === "1 failed");
    expect(failed?.token).toBe("tool.fail");
  });

  test("gaps: each maximal run of hidden items between shown ones; a marker ends a gap; a message with its own id and nothing between gets no line", () => {
    const n = model(user("u"), tool("a", "read"), turnEnd("end"), tool("b", "read"), user("u2"), tool("c", "read"), agent("m1"), agent("m2"));
    expect(focusGaps(n.order, n.lookup).map((s) => (s.kind === "group" ? `${s.key}=${s.members.join(",")}` : s.id))).toEqual([
      "u",
      "group:gap:a=a",
      "end",
      "group:gap:b=b",
      "u2",
      "group:gap:c=c",
      "m1",
      "m2",
    ]);
  });

  test("a failure in a middle gap, a marker in the middle of a turn, and a gap that grows keeping its key", () => {
    const n = model(user("u"), tool("r1", "read"), thought("t1"), agent("a1"), tool("x1", "execute"), tool("x2", "execute", { toolStatus: "failed" }), tool("r4", "read"), agent("a2"), tool("e1", "edit"), agent("a3"), tool("r6", "read"));
    const focus = buildEntries(n.order, n.lookup, { density: "focus", open: closed });
    expect(focus.keys).toEqual(["u", "group:gap:r1", "a1", "group:gap:x1", "a2", "group:gap:e1", "a3", "group:gap:r6"]);
    const line = (i: number) => groupLine(focus.entries[i] as GroupEntry, n.lookup).map((s) => s.text).join("");
    expect(line(3)).toBe("▸ 3 tool calls (1 failed) · 0.1s");
    expect([1, 5, 7].map((i) => line(i).includes("failed"))).toEqual([false, false, false]);
    // The gap grows at its end: same key, same row.
    const grown = model(user("u"), tool("r1", "read"), thought("t1"), tool("r1b", "read"), agent("a1"));
    const before = buildEntries(grown.order.slice(0, 3), grown.lookup, { density: "focus", open: closed });
    const after = buildEntries(grown.order, grown.lookup, { density: "focus", open: closed });
    expect(before.keys).toEqual(["u", "group:gap:r1"]);
    expect(after.keys).toEqual(["u", "group:gap:r1", "a1"]);
    expect((after.entries[1] as GroupEntry).members).toEqual(["r1", "t1", "r1b"]);
    // An error marker splits a gap.
    const err: Item = { id: "err", kind: "marker", status: "final", origin: "self", markerKind: "error", message: "boom" } as unknown as Item;
    const split = model(user("u"), tool("r1", "read"), err, tool("r2", "read"));
    expect(buildEntries(split.order, split.lookup, { density: "focus", open: closed }).keys).toEqual(["u", "group:gap:r1", "err", "group:gap:r2"]);
  });

  test("a wordless thought and a pending permission record are no members: no line where nothing was hidden", () => {
    const pending: Item = { id: "p", kind: "permission_record", status: "final", origin: "self", toolCallId: "x", outcome: { type: "pending" } } as unknown as Item;
    const n = model(user("u"), thought("t", { text: "  " }), pending, agent("a"));
    expect(buildEntries(n.order, n.lookup, { density: "focus", open: closed }).keys).toEqual(["u", "a"]);
    // Next to a real member they are left out of the count and the members.
    const mixed = model(user("u"), thought("t", { text: "" }), tool("r", "read"), pending, agent("a"));
    const list = buildEntries(mixed.order, mixed.lookup, { density: "focus", open: closed });
    expect((list.entries[1] as GroupEntry).members).toEqual(["r"]);
  });

  test("spacing of focus lines: no blank row between a line and an agent message, a blank row to a user message or a turn-end line", () => {
    // Scenario "At the start and the end of a turn": user, blank, line, answer, line, blank, turn end.
    const t = model(user("u"), tool("r1", "read"), agent("a"), tool("r2", "read"), turnEnd("end"));
    const list = buildEntries(t.order, t.lookup, { density: "focus", open: closed });
    expect(list.keys).toEqual(["u", "group:gap:r1", "a", "group:gap:r2", "end"]);
    expect(list.entries.map((e) => e.margin)).toEqual([0, 1, 0, 0, 1]);
    // Between two messages: three consecutive rows.
    const between = model(agent("a"), tool("r1", "read"), agent("b"));
    expect(buildEntries(between.order, between.lookup, { density: "focus", open: closed }).entries.map((e) => e.margin)).toEqual([0, 0, 0]);
    // Opened: the members follow directly, one blank row before the next message.
    const open = buildEntries(
      model(agent("a"), tool("r1", "read"), tool("r2", "read"), tool("r3", "read"), agent("b")).order,
      model(agent("a"), tool("r1", "read"), tool("r2", "read"), tool("r3", "read"), agent("b")).lookup,
      { density: "focus", open: () => true },
    );
    expect(open.keys).toEqual(["a", "group:gap:r1", "r1", "r2", "r3", "b"]);
    expect(open.entries.map((e) => e.margin)).toEqual([0, 0, 0, 0, 0, 1]);
    // A line after a user message or a marker keeps its blank row; an agent message after a
    // closed line takes none, but a user message does.
    const edges = model(user("u"), tool("r1", "read"), user("u2"), turnEnd("e0"), tool("r2", "read"), user("u3"));
    expect(buildEntries(edges.order, edges.lookup, { density: "focus", open: closed }).entries.map((e) => e.margin)).toEqual([0, 1, 1, 1, 1, 1]);
  });

  test("compact and verbose spacing is unchanged by gaps", () => {
    const n = model(agent("a"), tool("r1", "read"), tool("r2", "read"), agent("b"), tool("e1", "edit"), user("u"));
    expect(buildEntries(n.order, n.lookup, { density: "compact", open: closed }).entries.map((e) => e.margin)).toEqual([0, 1, 1, 1, 1]);
    expect(buildEntries(n.order, n.lookup, { density: "verbose", open: closed }).entries.map((e) => e.margin)).toEqual([0, 1, 0, 1, 1, 1]);
  });
});

describe("counting items (focus-groups D3)", () => {
  const text = (segments: { text: string }[]) => segments.map((s) => s.text).join("");

  test("the form: tool calls with states in brackets in the order failed, stopped, running, then thoughts, plans, permissions", () => {
    const counts = countItems([
      tool("a", "read"),
      tool("b", "read", { toolStatus: "failed" }),
      tool("c", "read", { toolStatus: "in_progress" }),
      tool("d", "read", { status: "live", toolStatus: "in_progress" }),
      tool("e", "read", { status: "live", toolStatus: "pending" }),
      thought("t1"),
      { id: "p1", kind: "plan", status: "final", origin: "self", entries: [{ content: "x", priority: "low", status: "pending" }] } as unknown as Item,
      { id: "k1", kind: "permission_record", status: "final", origin: "self", toolCallId: "a", outcome: { type: "selected", optionId: "x" } } as unknown as Item,
      { id: "k2", kind: "permission_record", status: "final", origin: "self", toolCallId: "a", outcome: { type: "cancelled" } } as unknown as Item,
    ]);
    expect(counts).toMatchObject({ tools: 5, failed: 1, stopped: 1, running: 2, thoughts: 1, plans: 1, permissions: 2 });
    expect(text(countSegments(counts))).toBe("5 tool calls (1 failed, 1 stopped, 2 running) · 1 thought · 1 plan · 2 permissions");
    const segments = countSegments(counts);
    expect(segments.find((s) => s.text === "1 failed")?.token).toBe("tool.fail");
    expect(segments.find((s) => s.text === "2 running")?.token).toBe("tool.running");
    expect(segments.find((s) => s.text === "1 stopped")?.token).toBe("muted");
    expect(segments.find((s) => s.text === "5 tool calls")?.token).toBe("muted");
  });

  test("each part only when not zero, singular and plural, and nothing for nothing", () => {
    expect(text(countSegments(EMPTY_COUNTS))).toBe("");
    expect(text(countSegments(countItems([tool("a", "read")])))).toBe("1 tool call");
    expect(text(countSegments(countItems([thought("t"), thought("u")])))).toBe("2 thoughts");
    expect(text(countSegments(countItems([tool("a", "read", { toolStatus: "failed" })])))).toBe("1 tool call (1 failed)");
  });

  test("a wordless thought, an empty plan and a pending permission count for nothing", () => {
    const none = countItems([
      thought("t", { text: " " }),
      { id: "p", kind: "plan", status: "final", origin: "self", entries: [] } as unknown as Item,
      { id: "k", kind: "permission_record", status: "final", origin: "self", toolCallId: "a", outcome: { type: "pending" } } as unknown as Item,
      agent("m"),
    ]);
    expect(none).toEqual(EMPTY_COUNTS);
  });

  test("options choose the states, the kinds and the separator; addCounts is incremental", () => {
    const counts = countItems([tool("a", "read", { toolStatus: "failed" }), tool("b", "read", { toolStatus: "in_progress" }), thought("t")]);
    expect(text(countSegments(counts, { states: ["failed"], kinds: [], separator: " | " }))).toBe("2 tool calls (1 failed)");
    expect(text(countSegments(counts, { states: [], separator: " | " }))).toBe("2 tool calls | 1 thought");
    expect(addCounts(addCounts(EMPTY_COUNTS, tool("a", "read")), thought("t"))).toEqual({ ...EMPTY_COUNTS, tools: 1, thoughts: 1 });
    expect(addCounts(EMPTY_COUNTS, agent("m"))).toBe(EMPTY_COUNTS);
  });

  test("running and stopped are the live and final unfinished calls", () => {
    expect(isRunningTool(tool("a", "read", { status: "live", toolStatus: "pending" }))).toBe(true);
    expect(isStoppedTool(tool("a", "read", { status: "live", toolStatus: "pending" }))).toBe(false);
    expect(isStoppedTool(tool("a", "read", { toolStatus: "in_progress" }))).toBe(true);
    expect(isStoppedTool(tool("a", "read"))).toBe(false);
  });
});

describe("densities, empty items", () => {
  test("items with nothing to show are left out in every density (an empty message, an open permission)", () => {
    const empty: Item = { id: "e", kind: "agent_message", status: "live", origin: "self", text: "" };
    const n = model(user("u"), empty, agent("a"));
    for (const density of ["compact", "verbose", "focus"] as const) expect(buildEntries(n.order, n.lookup, { density, open: closed }).keys).toEqual(["u", "a"]);
  });
});

describe("jumps between prompts and tool calls (task 3.3)", () => {
  // Scenario "Previous prompt far back": the previous user message is 400 entries back.
  test("the previous prompt 400 entries back is the target from the last entry", () => {
    const items: Item[] = [user("u0"), ...Array.from({ length: 400 }, (_, i) => agent(`a${i}`)), user("u1"), ...Array.from({ length: 598 }, (_, i) => agent(`b${i}`))];
    const m = model(...items);
    const list = buildEntries(m.order, m.lookup, { density: "compact", open: closed });
    expect(list.entries).toHaveLength(1000);
    expect(list.index.get("u1")).toBe(401);
    const far = list.keys.at(-1)!;
    expect(jumpTarget(list, m.lookup, "b397", -1, "prompt")).toBe("u1");
    expect(jumpTarget(list, m.lookup, far, -1, "prompt")).toBe("u1");
    expect(jumpTarget(list, m.lookup, "u1", -1, "prompt")).toBe("u0");
    expect(jumpTarget(list, m.lookup, "u0", -1, "prompt")).toBeNull();
    expect(jumpTarget(list, m.lookup, "u0", 1, "prompt")).toBe("u1");
    expect(jumpTarget(list, m.lookup, "u1", 1, "prompt")).toBeNull();
    // No cursor yet: it starts past the end, so the previous prompt is the last one.
    expect(jumpTarget(list, m.lookup, null, -1, "prompt")).toBe("u1");
  });

  // Scenario "No next tool call".
  test("with no tool call in that direction there is no target", () => {
    const m = model(user("u"), tool("e1", "edit"), agent("a"), tool("e2", "edit"), agent("b"));
    const list = buildEntries(m.order, m.lookup, { density: "compact", open: closed });
    expect(jumpTarget(list, m.lookup, "e2", 1, "tool")).toBeNull();
    expect(jumpTarget(list, m.lookup, "e2", -1, "tool")).toBe("e1");
    expect(jumpTarget(list, m.lookup, "b", -1, "tool")).toBe("e2");
    expect(jumpTarget(list, m.lookup, "e1", -1, "tool")).toBeNull();
  });

  test("a tool call hidden in a closed group is reached by its group line; an open group's line is passed over", () => {
    const m = model(user("u"), tool("r1", "read"), thought("t"), tool("r2", "read"), agent("a"), tool("e1", "edit"));
    const shut = buildEntries(m.order, m.lookup, { density: "compact", open: closed });
    expect(shut.keys).toEqual(["u", "group:run:r1", "a", "e1"]);
    expect(jumpTarget(shut, m.lookup, "u", 1, "tool")).toBe("group:run:r1");
    expect(jumpTarget(shut, m.lookup, "group:run:r1", 1, "tool")).toBe("e1");
    expect(jumpTarget(shut, m.lookup, "e1", -1, "tool")).toBe("group:run:r1");
    const open = buildEntries(m.order, m.lookup, { density: "compact", open: () => true });
    expect(open.keys).toEqual(["u", "group:run:r1", "r1", "t", "r2", "a", "e1"]);
    expect(jumpTarget(open, m.lookup, "u", 1, "tool")).toBe("r1");
    expect(jumpTarget(open, m.lookup, "r1", 1, "tool")).toBe("r2");
    expect(jumpTarget(open, m.lookup, "r1", -1, "tool")).toBeNull();
    // A group of thoughts alone holds no tool call.
    const thoughts = model(user("u"), thought("t1"), thought("t2"), agent("a"));
    const quiet = buildEntries(thoughts.order, thoughts.lookup, { density: "compact", open: closed });
    expect(quiet.keys).toEqual(["u", "group:run:t1", "a"]);
    expect(jumpTarget(quiet, thoughts.lookup, "u", 1, "tool")).toBeNull();
    // In `focus` a gap's line holds its tool calls.
    const focus = buildEntries(m.order, m.lookup, { density: "focus", open: closed });
    expect(jumpTarget(focus, m.lookup, "u", 1, "tool")).toBe("group:gap:r1");
    // A call behind a closed gap line is reached by the line; `[` from the last answer too.
    expect(jumpTarget(focus, m.lookup, "group:gap:r1", 1, "tool")).toBe("group:gap:e1");
    expect(jumpTarget(focus, m.lookup, "a", -1, "tool")).toBe("group:gap:r1");
  });

  test("the count of shown items does not depend on the density or on runs forming (the ↓ N new indicator counts items)", () => {
    const a = model(user("u"), tool("r1", "read"), tool("r2", "read"), agent("a"));
    const b = model(user("u"), tool("r1", "read"), tool("r2", "read"), agent("a"), tool("r3", "read"), tool("r4", "read"), tool("r5", "read"), agent("b"));
    for (const density of ["compact", "verbose", "focus"] as const) {
      const before = buildEntries(a.order, a.lookup, { density, open: closed }).holder.size;
      const after = buildEntries(b.order, b.lookup, { density, open: closed }).holder.size;
      expect({ density, added: after - before }).toEqual({ density, added: 4 });
    }
  });
});
