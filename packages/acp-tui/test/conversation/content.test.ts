// Task 9.1 (Phase 0): tool-card content as pure functions, written for the
// viewer and kept for the conversation's expanded cards: the Ctrl+O target
// rule (spec tui-conversation "Collapse and expand in place"), the header,
// content and wrapping (tui-agent-session "Unsupported client-side terminal
// content").
import { describe, expect, test } from "bun:test";
import { createSession, reduce, type Item, type ModelEvent, type Session, type ToolCallItem } from "acp-model";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { cardLines, contentLines, diffCardLines, expandTabs, headerSegments, VIEWER_TEXT, viewerTarget, wrapLine, wrapLines, wrapWords, wrapWordsAt, type ViewerSession } from "../../src/conversation/content.ts";
import { wordRows } from "../../src/conversation/window/heights.ts";
import { segmentsWidth } from "../../src/layout/segments.ts";

function run(events: ModelEvent[]): Session {
  let session = reduce(createSession(), { type: "session_created", response: { sessionId: "s" }, cwd: "/w", at: 0 });
  for (const e of events) session = reduce(session, e);
  return session;
}

const update = (u: SessionUpdate): ModelEvent => ({ type: "session_update", update: u, at: 1 });
const tool = (id: string, extra: Partial<Extract<SessionUpdate, { sessionUpdate: "tool_call" }>> = {}): ModelEvent =>
  update({ sessionUpdate: "tool_call", toolCallId: id, title: `Tool ${id}`, kind: "execute", status: "in_progress", ...extra });

/** The store's view of a session: items as a record. */
function view(session: Session): ViewerSession {
  const items: Record<string, Item> = {};
  for (const [id, item] of session.items) items[id] = item;
  const open = session.order.find((id) => {
    const item = items[id];
    return item?.kind === "permission_record" && item.outcome.type === "pending";
  });
  return { order: session.order, items, openPermissionId: open ?? null };
}

const toolItem = (session: Session, id: string) => session.items.get(`tool:${id}`) as ToolCallItem;
const texts = (rows: { text: string }[][]) => rows.map((r) => r.map((s) => s.text).join(""));

describe("viewerTarget", () => {
  test("no tool calls: null", () => {
    expect(viewerTarget(view(run([update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } })])))).toBeNull();
  });

  test("the most recent tool call (highest index)", () => {
    const s = run([tool("a"), tool("b"), update({ sessionUpdate: "tool_call_update", toolCallId: "a", status: "completed" })]);
    expect(viewerTarget(view(s))).toBe("tool:b");
  });

  test("the tool call behind the open permission request wins over a later one", () => {
    const s = run([
      tool("a"),
      tool("b"),
      {
        type: "permission_opened",
        toolCallId: "a",
        request: { sessionId: "s", toolCall: { toolCallId: "a" }, options: [{ optionId: "y", name: "Yes", kind: "allow_once" }] },
        at: 2,
      },
    ]);
    const v = view(s);
    expect(v.openPermissionId).not.toBeNull();
    expect(viewerTarget(v)).toBe("tool:a");
  });
});

describe("header and content", () => {
  test("header: index, kind, title, status; the title gives way to a narrow width", () => {
    const s = run([tool("a", { title: "Run the whole test suite", status: "completed" })]);
    expect(texts([headerSegments(toolItem(s, "a"), 80)])).toEqual(["#1  execute  Run the whole test suite  completed"]);
    expect(texts([headerSegments(toolItem(s, "a"), 80, true)])[0]).toEndWith("completed  awaiting permission");
    const narrow = texts([headerSegments(toolItem(s, "a"), 34)])[0]!;
    expect(narrow).toBe("#1  execute  Run the w…  completed");
    const tokens = headerSegments(toolItem(s, "a"), 80).map((seg) => seg.token);
    expect(tokens).toContain("tool.ok");
  });

  test("header never overflows width: the status gives way (dropped, not cut mid-word) once the title has none left, at 94 and 50 columns and narrower", () => {
    const s = run([tool("a", { title: "Run earlier check", kind: "execute", status: "in_progress" })]);
    for (const width of [94, 80, 50, 40, 34, 30, 24, 20, 15, 10, 1]) {
      const header = headerSegments(toolItem(s, "a"), width, true);
      // The row is never wider than the space it was given, so nothing can spill onto the row
      // below or overlap the next repaint: this is the regression a truncated `width - fixed`
      // calculation (clamped to a minimum of 1) used to allow.
      expect(segmentsWidth(header)).toBeLessThanOrEqual(width);
      // No segment is a word cut off mid-way with no ellipsis: every status-token segment is
      // either the full status text or absent (the old bug: "awaiting pe" with no boundary).
      const statusSeg = header.find((seg) => seg.token === "tool.running");
      if (statusSeg) expect(statusSeg.text).toBe("in progress");
      const permissionSeg = header.find((seg) => seg.token === "permission");
      if (permissionSeg) expect(permissionSeg.text).toBe(VIEWER_TEXT.awaitingPermission);
    }
    // At the real widths from the bug report, both status pieces still fit in full, beside a
    // truncated (but non-empty) title.
    const wide = texts([headerSegments(toolItem(s, "a"), 94, true)])[0]!;
    expect(wide).toBe("#1  execute  Run earlier check  in progress  awaiting permission");
    const mid = texts([headerSegments(toolItem(s, "a"), 50, true)])[0]!;
    expect(mid).toBe("#1  execute  Ru…  in progress  awaiting permission");
    // Narrower: "awaiting permission" is dropped first (it is the least essential piece), so the
    // title keeps more room than it would if the whole tail stayed and only 1 column were left.
    const narrower = texts([headerSegments(toolItem(s, "a"), 40, true)])[0]!;
    expect(narrower).toBe("#1  execute  Run earlier c…  in progress");
    expect(narrower).not.toContain("awaiting");
    // Narrower still: the status itself is dropped, and the title gets the rest of the room.
    const veryNarrow = texts([headerSegments(toolItem(s, "a"), 20, true)])[0]!;
    expect(veryNarrow).toBe("#1  execute  Run ea…");
    expect(veryNarrow).not.toMatch(/progress|awaiting/);
  });

  test("text, a diff and terminal content, blocks separated by a blank line", () => {
    const s = run([
      tool("a", {
        content: [
          { type: "content", content: { type: "text", text: "first\nsecond\n" } },
          { type: "diff", path: "/w/x.ts", oldText: "a\n", newText: "b\n" },
          { type: "terminal", terminalId: "term-1" },
          { type: "content", content: { type: "resource_link", name: "notes.md", uri: "file:///w/notes.md" } },
        ],
      }),
    ]);
    const lines = contentLines(toolItem(s, "a"));
    expect(texts(lines)).toEqual([
      "first",
      "second",
      "",
      "--- /w/x.ts",
      "+++ /w/x.ts",
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "",
      "terminal output unavailable (client terminals not supported)",
      "",
      "[resource: notes.md]",
    ]);
    expect(lines[6]![0]!.token).toBe("diff.remove");
    expect(lines[7]![0]!.token).toBe("diff.add");
    expect(lines[5]![0]!.token).toBe("diff.hunk");
    expect(lines[9]![0]!.token).toBe("muted");
  });

  test("no content: a placeholder", () => {
    expect(texts(contentLines(toolItem(run([tool("a")]), "a")))).toEqual(["(no content)"]);
  });

  test("hostile text arrives sanitised from the model", () => {
    const s = run([tool("a", { content: [{ type: "content", content: { type: "text", text: "ok\x1b]52;c;ZXZpbA==\x07 done" } }] })]);
    expect(texts(contentLines(toolItem(s, "a")))).toEqual(["ok done"]);
  });
});

describe("wrapping", () => {
  test("tabs expand to 8-column stops", () => {
    expect(expandTabs("a\tb")).toBe("a       b");
    expect(expandTabs("\tx")).toBe("        x");
  });

  test("long lines wrap at the width; wide characters are not split", () => {
    expect(texts(wrapLine([{ text: "abcdefghij", token: "text" }], 4))).toEqual(["abcd", "efgh", "ij"]);
    expect(texts(wrapLine([{ text: "ab日本", token: "text" }], 3))).toEqual(["ab", "日", "本"]);
    expect(texts(wrapLine([{ text: "ab", token: "muted" }, { text: "cdef", token: "text" }], 3))).toEqual(["abc", "def"]);
  });

  test("empty lines stay as one empty row", () => {
    expect(wrapLines([[{ text: "x", token: "text" }], [], [{ text: "", token: "text" }]], 10)).toHaveLength(3);
  });
});

describe("wrapping prose at spaces (a thought's card; S2, IDE session B2)", () => {
  const prose = (text: string) => [{ text, token: "thought" as const }];

  test("the B2 thought at 57 columns (61 less the gutter and the card's padding) breaks between words", () => {
    // fake-agent `basic`; the column wrap drew `... before runni` / `ng it.` in Zed.
    const text = "Considering the safest way to apply the edit before running it.";
    expect(texts(wrapLine(prose(text), 57))).toEqual(["Considering the safest way to apply the edit before runni", "ng it."]);
    const rows = texts(wrapWords(prose(text), 57));
    expect(rows).toEqual(["Considering the safest way to apply the edit before ", "running it."]);
    for (const row of rows) expect(segmentsWidth([{ text: row, token: "text" }])).toBeLessThanOrEqual(57);
  });

  test("a word that does not fit starts the next row; the spaces at a break are dropped unless they fit", () => {
    expect(texts(wrapWords(prose("before running it."), 12))).toEqual(["before ", "running it."]);
    expect(texts(wrapWords(prose("abc def ghi"), 7))).toEqual(["abc def", "ghi"]);
    expect(texts(wrapWords(prose("abc   def"), 4))).toEqual(["abc", "def"]);
    // Leading spaces (indentation) stay.
    expect(texts(wrapWords(prose("  indented line"), 10))).toEqual(["  indented", "line"]);
  });

  test("a word wider than a row is broken at the width, graphemes kept whole", () => {
    expect(texts(wrapWords(prose("see https://example.invalid/a/long/path now"), 10))).toEqual(["see ", "https://ex", "ample.inva", "lid/a/long", "/path now"]);
    expect(texts(wrapWords(prose("日本語日本語"), 5))).toEqual(["日本", "語日", "本語"]);
  });

  test("segments keep their tokens across a break, and each row knows its starting column", () => {
    const line = [
      { text: "one two ", token: "muted" as const },
      { text: "three four", token: "text" as const },
    ];
    const rows = wrapWordsAt(line, 9);
    expect(rows.map((r) => r.segments)).toEqual([
      [{ text: "one two ", token: "muted" }],
      [{ text: "three ", token: "text" }],
      [{ text: "four", token: "text" }],
    ]);
    expect(rows.map((r) => r.col)).toEqual([0, 8, 14]);
  });

  test("an empty line is one empty row; the windowed list's estimate counts the same rows", () => {
    expect(wrapWords(prose(""), 10)).toEqual([[]]);
    expect(wordRows("before running it.\n\nabc def ghi", 7)).toBe(3 + 1 + 2);
    expect(wordRows("Considering the safest way to apply the edit before running it.", 57)).toBe(2);
  });
});

describe("expanded tool cards (phase-1a task 7.3)", () => {
  const item = (content: ToolCallItem["content"]): ToolCallItem => ({
    id: "tool:t",
    status: "final",
    origin: "self",
    kind: "tool_call",
    toolCallId: "t",
    index: 1,
    title: "t",
    toolName: null,
    toolKind: "edit",
    toolStatus: "completed",
    content,
    locations: [],
    rawOutputText: null,
    startedAt: null,
    endedAt: null,
  });
  const rows = (lines: ReturnType<typeof cardLines>) => lines.map((l) => l.segments.map((s) => s.text).join(""));

  test("a diff: the path, the hunk header, numbered lines with signs; added and removed lines filled", () => {
    const lines = diffCardLines("src/a.ts", "one\ntwo\n", "one\n2\n");
    expect(rows(lines)).toEqual(["src/a.ts", "@@ -1,2 +1,2 @@", "1   one", "2 - two", "2 + 2"]);
    expect(lines.map((l) => l.fill ?? null)).toEqual([null, null, null, "diff.removed.bg", "diff.added.bg"]);
    expect(rows(diffCardLines("n.ts", null, "x\n"))[0]).toBe("n.ts (new file)");
    // Numbers are right-aligned to the widest.
    const wide = diffCardLines("w", Array.from({ length: 12 }, (_, i) => `l${i}`).join("\n") + "\n", Array.from({ length: 12 }, (_, i) => (i === 11 ? "x" : `l${i}`)).join("\n") + "\n");
    expect(rows(wide).slice(2)).toEqual([" 9   l8", "10   l9", "11   l10", "12 - l11", "12 + x"]);
  });

  test("text blocks, the terminal notice, blank rows between blocks, and a placeholder when empty", () => {
    const lines = cardLines(item([{ type: "text", text: "out 1\nout 2\n" }, { type: "terminal_unavailable" }]));
    expect(rows(lines)).toEqual(["out 1", "out 2", "", "terminal output unavailable (client terminals not supported)"]);
    expect(rows(cardLines(item([])))).toEqual([VIEWER_TEXT.noContent]);
  });
});
