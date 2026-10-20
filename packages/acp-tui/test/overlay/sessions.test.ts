// mvp-sessions task 7.1: the session list's rows (src/overlay/sessions.ts) and
// their layout on the pure list module (src/overlay/list.ts): spec
// tui-sessions "Session list" scenarios "Merged and ordered", "Correct
// relative time" (in Europe/London during British Summer Time) and "Filter",
// the agent selector's rows, the detail columns (aligned across the list,
// whole columns dropped when narrow, the time before the directory with all
// directories shown; IDE check 10.2, F2), and the footer row.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SessionInfo } from "@agentclientprotocol/sdk";
import { displayWidth, shortenHome } from "../../src/layout/segments.ts";
import { detailColumns, filterItems, overlayLayout, wrapText, type ListItem, type OverlayView } from "../../src/overlay/list.ts";
import {
  activityTime,
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
  type SessionScope,
} from "../../src/overlay/sessions.ts";
import type { SessionRecord } from "../../src/session/session-index.ts";

const FAKE: CurrentAgent = { name: "fake", command: null };
const text = (row: { text: string }[]) => row.map((s) => s.text).join("");

function record(sessionId: string, agent: string, directory: string, updatedAt: string, extra: Partial<SessionRecord> = {}): SessionRecord {
  return { sessionId, agent, directory, title: `${sessionId} from the index`, createdAt: updatedAt, updatedAt, ...extra };
}

describe("Merged and ordered (spec tui-sessions)", () => {
  test("the agent lists a (10:00) and b (09:00), the index holds c of another agent (11:00): c, a, b, c with its own agent", () => {
    const listed: SessionInfo[] = [
      { sessionId: "a", cwd: "/work/repo", title: "Session a", updatedAt: "2026-10-04T10:00:00Z" },
      { sessionId: "b", cwd: "/work/repo", title: "Session b", updatedAt: "2026-10-04T09:00:00Z" },
    ];
    const rows = mergeSessions(listed, [record("c", "other", "/work/repo", "2026-10-04T11:00:00Z")], FAKE, "/work/repo");
    expect(rows.map((r) => [r.sessionId, r.agent, r.current])).toEqual([
      ["c", "other", false],
      ["a", "fake", true],
      ["b", "fake", true],
    ]);
  });

  test("one row per (agent, session ID): the index's title wins over the agent's, the agent's only fills in, the later updatedAt wins", () => {
    const listed: SessionInfo[] = [
      { sessionId: "a", cwd: "/work/repo", title: "The agent's title", updatedAt: "2026-10-04T10:00:00Z" },
      { sessionId: "b", cwd: "/work/repo", updatedAt: "2026-10-04T12:00:00Z" },
    ];
    const records = [
      record("a", "fake", "/work/repo", "2026-10-04T13:00:00Z", { title: "The index's title" }),
      record("b", "fake", "/work/repo", "2026-10-04T08:00:00Z", { title: "Only the index has one" }),
      // The same ID with another agent is another session.
      record("a", "other", "/work/repo", "2026-10-04T07:00:00Z"),
    ];
    const rows = mergeSessions(listed, records, FAKE, "/work/repo");
    expect(rows.map((r) => [r.sessionId, r.agent, r.title, r.updatedAt])).toEqual([
      ["a", "fake", "The index's title", "2026-10-04T13:00:00Z"],
      ["b", "fake", "Only the index has one", "2026-10-04T12:00:00Z"],
      ["a", "other", "a from the index", "2026-10-04T07:00:00Z"],
    ]);
  });

  test("an index title is kept when the harness's page arrives with a different title; the harness's fills in only without one", () => {
    const listed: SessionInfo[] = [
      { sessionId: "a", cwd: "/w", title: "# For this specific question, follow ...", updatedAt: "2026-10-04T10:00:00Z" },
      { sessionId: "n", cwd: "/w", title: "Listed title", updatedAt: "2026-10-04T09:00:00Z" },
      { sessionId: "h", cwd: "/w", title: "Only the harness knows", updatedAt: "2026-10-04T08:00:00Z" },
    ];
    const records = [
      record("a", "fake", "/w", "2026-10-04T10:00:00Z", { title: "Explain this repository's structure" }),
      record("n", "fake", "/w", "2026-10-04T09:00:00Z", { title: null }),
    ];
    const rows = mergeSessions(listed, records, FAKE, "/w");
    expect(rows.map((r) => [r.sessionId, r.title])).toEqual([
      ["a", "Explain this repository's structure"],
      ["n", "Listed title"],
      ["h", "Only the harness knows"],
    ]);
  });

  test("with a named harness only its sessions are listed, and only its own `New session with` row", () => {
    const records = [
      record("a", "fake", "/w", "2026-10-04T10:00:00Z"),
      record("b", "other", "/w", "2026-10-04T11:00:00Z"),
    ];
    expect(mergeSessions([], records, FAKE, "/w", "fake").map((r) => r.sessionId)).toEqual(["a"]);
    expect(mergeSessions([], records, FAKE, "/w", null).map((r) => r.sessionId)).toEqual(["b", "a"]);
    expect(mergeSessions([], records, FAKE, "/w", "other").map((r) => r.sessionId)).toEqual(["b"]);
  });

  test("the directory scope keeps that directory's sessions only (an agent that ignores the filter too); all directories keep every one", () => {
    const listed: SessionInfo[] = [
      { sessionId: "here", cwd: "/work/repo", updatedAt: "2026-10-04T10:00:00Z" },
      { sessionId: "there", cwd: "/work/other", updatedAt: "2026-10-04T11:00:00Z" },
    ];
    const records = [record("far", "other", "/elsewhere", "2026-10-04T12:00:00Z")];
    expect(mergeSessions(listed, records, FAKE, "/work/repo").map((r) => r.sessionId)).toEqual(["here"]);
    expect(mergeSessions(listed, records, FAKE, null).map((r) => r.sessionId)).toEqual(["far", "there", "here"]);
  });

  test("an ad hoc session is the agent in use's only with the same command; sessions without a time sort last", () => {
    const adHoc: CurrentAgent = { name: "ad hoc", command: ["bun", "agent.ts"] };
    const records = [
      record("same", "ad hoc", "/w", "2026-10-04T10:00:00Z", { command: ["bun", "agent.ts"] }),
      record("other", "ad hoc", "/w", "2026-10-04T11:00:00Z", { command: ["bun", "other.ts"] }),
    ];
    const listed: SessionInfo[] = [{ sessionId: "untimed", cwd: "/w" }];
    const rows = mergeSessions(listed, records, adHoc, "/w");
    expect(rows.map((r) => [r.sessionId, r.current])).toEqual([
      ["other", false],
      ["same", true],
      ["untimed", true],
    ]);
    expect(rows[0]!.command).toEqual(["bun", "other.ts"]);
  });

  test("agent-supplied titles, directories and IDs are sanitised and held on one line", () => {
    const listed: SessionInfo[] = [{ sessionId: "s\x1b[31m1", cwd: "/w", title: "\x1b]8;;http://evil\x07Click\x1b]8;;\x07 me‮\nnow" }];
    const [row] = mergeSessions(listed, [], FAKE, "/w");
    expect(row!.title).toBe("Click me now");
    expect(row!.sessionId).not.toContain("\x1b");
    const item = sessionListItem(row!, { now: Date.parse("2026-10-04T12:00:00Z"), home: null });
    for (const part of [item.title, ...(item.details ?? [])]) {
      expect(part).not.toMatch(/[\x00-\x1f\x7f‪-‮⁦-⁩]/);
    }
  });
});

describe("Correct relative time (spec tui-sessions), in Europe/London during British Summer Time", () => {
  let saved: string | undefined;
  beforeAll(() => {
    saved = process.env.TZ;
    process.env.TZ = "Europe/London";
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  });

  test("the zone is in BST on the date used (UTC+1)", () => {
    expect(new Date("2026-07-01T12:00:00Z").getTimezoneOffset()).toBe(-60);
  });

  test("updatedAt two minutes before now, given in UTC, reads `2 minutes ago` (not an hour out)", () => {
    const now = Date.parse("2026-07-01T12:00:00Z");
    expect(activityTime("2026-07-01T11:58:00Z", now)).toBe("2 minutes ago");
    // The same instant written with the local offset reads the same.
    expect(activityTime("2026-07-01T12:58:00+01:00", now)).toBe("2 minutes ago");
    expect(activityTime("2026-07-01T11:59:30Z", now)).toBe("just now");
    expect(activityTime("2026-07-01T11:59:00Z", now)).toBe("1 minute ago");
    expect(activityTime("2026-07-01T09:00:00Z", now)).toBe("3 hours ago");
    expect(activityTime("2026-06-30T12:00:01Z", now)).toBe("23 hours ago");
  });

  test("a day or more ago: the local date (23:30 UTC is already the next day in BST); another year shows the year", () => {
    const now = Date.parse("2026-07-05T12:00:00Z");
    expect(activityTime("2026-07-01T23:30:00Z", now)).toBe("2 Jul");
    expect(activityTime("2026-07-01T22:30:00Z", now)).toBe("1 Jul");
    expect(activityTime("2025-12-31T23:30:00Z", now)).toBe("31 Dec 2025");
    expect(activityTime(null, now)).toBe("");
    expect(activityTime("not a time", now)).toBe("");
  });

  test("the session's row shows it", () => {
    const now = Date.parse("2026-07-01T12:00:00Z");
    const [row] = mergeSessions([{ sessionId: "a", cwd: "/w", title: "Recent", updatedAt: "2026-07-01T11:58:00.000Z" }], [], FAKE, "/w");
    expect(sessionListItem(row!, { now, home: null }).details).toEqual(["fake", "2 minutes ago", "/w"]);
  });
});

describe("Filter (spec tui-sessions)", () => {
  test("typing `render` keeps only sessions whose title, agent or directory contain it, ignoring case", () => {
    const now = Date.parse("2026-10-04T12:00:00Z");
    const records = [
      record("t", "fake", "/work/app", "2026-10-04T11:00:00Z", { title: "Render the template" }),
      record("d", "fake", "/work/Renderer", "2026-10-04T10:00:00Z", { title: "Fix the router" }),
      record("g", "renderbot", "/work/app", "2026-10-04T09:00:00Z", { title: "Tidy the config" }),
      record("x", "fake", "/work/app", "2026-10-04T08:00:00Z", { title: "Add the appointment model" }),
    ];
    const items = [
      ...newSessionEntries(["claude", "fake"], FAKE),
      ...mergeSessions([], records, FAKE, null),
    ].map((entry) => sessionListItem(entry, { now, home: null }));
    expect(filterItems(items, "render").map((i) => i.title)).toEqual(["Render the template", "Fix the router", "Tidy the config"]);
    expect(filterItems(items, "RENDER").length).toBe(3);
    expect(filterItems(items, "").length).toBe(items.length);
  });
});

describe("agent selector rows (design decision 6)", () => {
  test("one `New session with <agent>` row per named agent, the current agent first", () => {
    const rows = newSessionEntries(["claude", "fake", "other"], { name: "other", command: null });
    expect(rows.map((r) => [r.agent, r.current])).toEqual([
      ["other", true],
      ["claude", false],
      ["fake", false],
    ]);
    expect(sessionListItem(rows[0]!, { now: 0, home: null }).title).toBe("New session with other");
    // An ad hoc agent in use is not a named agent: no row of its own.
    expect(newSessionEntries(["claude"], { name: "ad hoc", command: ["x"] }).map((r) => r.agent)).toEqual(["claude"]);
  });

  test("a session without a title is listed under its ID; the home directory reads `~`", () => {
    const [row] = mergeSessions([{ sessionId: "s-untitled", cwd: "/home/marcus/work" }], [], FAKE, null);
    const item = sessionListItem(row!, { now: 0, home: "/home/marcus" });
    expect(item.title).toBe("s-untitled");
    // No time: an empty detail, so the directory stays in its column.
    expect(item.details).toEqual(["fake", "", "~/work"]);
    expect(shortenHome("/home/marcus", "/home/marcus")).toBe("~");
    expect(shortenHome("/home/marcusx/a", "/home/marcus")).toBe("/home/marcusx/a");
  });

  test("Windows: a session under the profile reads `~\\...`; an ad hoc command is named by its file", () => {
    expect(shortenHome("C:\\Users\\u\\work", "C:\\Users\\u", "win32")).toBe("~\\work");
    expect(harnessName({ name: "ad hoc", command: ["C:\\tools\\my agent\\agent.cmd", "--x"] }, "win32")).toBe("agent.cmd");
    expect(harnessName({ name: "ad hoc", command: ["/usr/local/bin/bun"] }, "linux")).toBe("bun");
  });
});

describe("rows and footer on the list module", () => {
  const view = (items: ListItem[], width: number, extra: Partial<OverlayView> = {}): OverlayView => ({
    title: "Sessions in ~/work",
    filter: "",
    placeholder: "type to filter",
    items,
    grouped: false,
    selected: 0,
    offset: 0,
    width,
    rows: 21,
    closeLabel: "esc",
    hints: [],
    marks: false,
    ...extra,
  });
  const item: ListItem = { id: "s", group: null, title: "Render the template for the invoice", details: ["fake", "2 minutes ago", "~/work/invoices"] };
  // A list as the session list builds it: an agent selector row, then sessions with titles,
  // agents, times (one missing) and directories of different widths.
  const list: ListItem[] = [
    { id: "n", group: null, title: "New session with fake" },
    { id: "a", group: null, title: "Render the template", details: ["fake", "2 minutes ago", "~/work/app"] },
    { id: "b", group: null, title: "Tidy the config loader", details: ["other", "3 hours ago", "~/Projects/acp-tui"] },
    { id: "c", group: null, title: "Fix the router", details: ["fake", "", "~/work/app"] },
    { id: "d", group: null, title: "Speed up the test suite for the invoice service", details: ["fake", "3 Oct", "~/work/invoices"] },
  ];
  const listRowsAt = (width: number, scope: SessionScope = "directory") =>
    overlayLayout(view(list, width, { detailDrop: detailDropOrder(scope) })).lines.slice(2, 2 + list.length).map(text);

  test("detail columns line up across the list: each as wide as its widest value (the time at least 14), after a title column that takes what they leave", () => {
    expect(listRowsAt(100)).toEqual([
      "│ New session with fake                                                                            │",
      "│ Render the template                                     fake   2 minutes ago  ~/work/app         │",
      "│ Tidy the config loader                                  other  3 hours ago    ~/Projects/acp-tui │",
      "│ Fix the router                                          fake                  ~/work/app         │",
      "│ Speed up the test suite for the invoice service         fake   3 Oct          ~/work/invoices    │",
    ]);
  });

  test("rows that arrive later do not move the columns (task 12.5): a longer title, a longer time, another agent's row of the same widths", () => {
    const before = detailColumns(list.slice(0, 3), 96, detailDropOrder("directory"), DETAIL_MIN_WIDTHS);
    const later: ListItem[] = [
      ...list.slice(0, 3),
      { id: "e", group: null, title: "Add the appointment model for the clinic booking flow and its migrations", details: ["fake", "59 minutes ago", "~/work/app"] },
      { id: "f", group: null, title: "Short", details: ["other", "1 minute ago", "~/work/app"] },
    ];
    expect(detailColumns(later, 96, detailDropOrder("directory"), DETAIL_MIN_WIDTHS)).toEqual(before);
    // The same through the whole layout: each detail starts on the same screen column.
    const startOf = (rows: ListItem[], needle: string) => {
      const line = overlayLayout(view(rows, 100, { detailDrop: detailDropOrder("directory"), detailMin: DETAIL_MIN_WIDTHS })).lines.map(text).find((l) => l.includes(needle))!;
      return line.indexOf(needle);
    };
    expect(startOf(later, "~/Projects/acp-tui")).toBe(startOf(list.slice(0, 3), "~/Projects/acp-tui"));
    expect(startOf(later, "3 hours ago")).toBe(startOf(list.slice(0, 3), "3 hours ago"));
    // A title longer than the column is cut at it.
    expect(overlayLayout(view(later, 100, { detailMin: DETAIL_MIN_WIDTHS })).lines.map(text).find((l) => l.includes("Add the appointment"))).toContain("…");
  });

  test("when narrow, whole columns are dropped right to left for every row at once; the title is cut, never dropped", () => {
    // 64 and 61 columns: the IDE panes of check 10.2.
    expect(listRowsAt(64)).toEqual([
      "│ New session with fake                                        │",
      "│ Render the template                     fake   2 minutes ago │",
      "│ Tidy the config loader                  other  3 hours ago   │",
      "│ Fix the router                          fake                 │",
      "│ Speed up the test suite for the invoi…  fake   3 Oct         │",
    ]);
    expect(listRowsAt(61)).toEqual([
      "│ New session with fake                                     │",
      "│ Render the template                  fake   2 minutes ago │",
      "│ Tidy the config loader               other  3 hours ago   │",
      "│ Fix the router                       fake                 │",
      "│ Speed up the test suite for the in…  fake   3 Oct         │",
    ]);
    // The title column keeps DETAIL_TITLE_MIN columns: the time goes too, then the agent.
    expect(listRowsAt(44)[4]).toBe("│ Speed up the test suite for the …  fake  │");
    expect(listRowsAt(30)[4]).toBe("│ Speed up the test suite f… │");
    for (const width of [100, 64, 61, 54, 44, 30]) {
      for (const line of overlayLayout(view(list, width)).lines) expect(displayWidth(text(line))).toBe(width);
    }
  });

  test("all directories: the time column is dropped before the directory column, for every row", () => {
    expect(detailDropOrder("all")).toEqual([1, 2, 0]);
    expect(detailDropOrder("directory")).toEqual([2, 1, 0]);
    expect(listRowsAt(64, "all")).toEqual([
      "│ New session with fake                                        │",
      "│ Render the template                fake   ~/work/app         │",
      "│ Tidy the config loader             other  ~/Projects/acp-tui │",
      "│ Fix the router                     fake   ~/work/app         │",
      "│ Speed up the test suite for the …  fake   ~/work/invoices    │",
    ]);
    expect(listRowsAt(61, "all")[2]).toBe("│ Tidy the config loader          other  ~/Projects/acp-tui │");
    // Narrower still, the directory goes as well; the agent stays longest.
    expect(listRowsAt(54, "all")[2]).toBe("│ Tidy the config loader                       other │");
    expect(detailColumns(list, 50, detailDropOrder("all"))).toEqual({ title: 43, columns: [{ index: 0, width: 5 }] });
  });

  test("a column no row has a value for takes no room; a list without details has no columns (the palette)", () => {
    const untimed: ListItem[] = [
      { id: "a", group: null, title: "One", details: ["fake", "", "~/a"] },
      { id: "b", group: null, title: "Two", details: ["fake", "", "~/b"] },
    ];
    expect(detailColumns(untimed, 60)).toEqual({ title: 49, columns: [{ index: 0, width: 4 }, { index: 2, width: 3 }] });
    expect(text(overlayLayout(view(untimed, 50)).lines[2]!)).toBe("│ One                                  fake  ~/a │");
    expect(detailColumns([{ id: "p", group: null, title: "Repaint" }], 60)).toBeNull();
  });

  test("the footer row: one row kept while empty, an error wrapped to at most four rows above the bottom border", () => {
    const empty = overlayLayout(view([item], 63, { footer: { text: "", token: "muted" } }));
    expect(empty.lines.length).toBe(5);
    expect(text(empty.lines[3]!)).toMatch(/^│ +│$/);
    const message =
      "cannot open session s-9 with harness 'fake': the harness answered Resource not found: the agent keeps no session s-9 in its store, or it was removed since the list was read (-32002)";
    const layout = overlayLayout(view([item], 54, { footer: { text: message, token: "danger" } }));
    const footer = layout.lines.slice(3, -1).map((l) => text(l).replace(/^│ /, "").replace(/ │$/, "").trimEnd());
    expect(footer.length).toBe(4);
    expect(footer.join(" ")).toContain("(-32002)");
    expect(layout.lines.at(-2)!.some((s) => s.token === "danger")).toBe(true);
    // Without a footer the palette's layout is unchanged.
    expect(overlayLayout(view([item], 63)).lines.length).toBe(4);
  });

  test("wrapText cuts long words and marks a cut", () => {
    expect(wrapText("", 10, 4)).toEqual([""]);
    expect(wrapText("one two three", 7, 4)).toEqual(["one two", "three"]);
    expect(wrapText("abcdefghijkl", 5, 4)).toEqual(["abcde", "fghij", "kl"]);
    expect(wrapText("a b c d e f g h", 3, 2)).toEqual(["a b", "c …"]);
  });
});

describe("the list at start-up (day-two-feedback D2)", () => {
  test("the footer says what the list waits for, after the spinner's glyph, in the harness's name", () => {
    expect(waitText("starting", "auggie", "▖")).toBe("▖ starting auggie…");
    expect(waitText("reading", "auggie", "▘")).toBe("▘ reading auggie's sessions…");
    expect(waitText("waiting", "auggie", "▝")).toBe("▝ waiting for auggie to start…");
  });

  test("the harness is named, or for an ad hoc command its first word without the directory", () => {
    expect(harnessName({ name: "auggie", command: null })).toBe("auggie");
    expect(harnessName({ name: "ad hoc", command: ["/usr/bin/bun", "agent.ts"] })).toBe("bun");
  });

  test("No sessions: `no sessions yet in <dir>` (`~` for home), `no matches` while filtering", () => {
    expect(noSessionsLine("directory", "/work/new", "/home/marcus", false)).toBe("no sessions yet in /work/new");
    expect(noSessionsLine("directory", "/home/marcus/Projects/x", "/home/marcus", false)).toBe("no sessions yet in ~/Projects/x");
    expect(noSessionsLine("directory", "/work/new", null, true)).toBe("no matches");
    expect(noSessionsLine("all", "/work/new", null, false)).toBe("no sessions yet");
  });

  test("the tail line sits in the first list row after the entries, under the `New session with` rows", () => {
    const list: ListItem[] = [
      { id: "n1", group: null, title: "New session with fake" },
      { id: "n2", group: null, title: "New session with claude" },
    ];
    const lines = overlayLayout({
      title: "Sessions in /work/new",
      filter: "",
      placeholder: "type to filter",
      items: list,
      grouped: false,
      selected: 0,
      offset: 0,
      width: 63,
      rows: 21,
      closeLabel: "esc",
      hints: [],
      marks: false,
      minRows: 21,
      tail: "no sessions yet in /work/new",
      footer: { text: "", token: "muted" },
    }).lines.map(text);
    expect(lines.slice(1, 5).map((l) => l.replace(/^│ /, "").replace(/ *│$/, ""))).toEqual(["›  type to filter", "New session with fake", "New session with claude", "no sessions yet in /work/new"]);
  });

  test("full height: the panel is rows - 4 tall with one entry or twenty, with a footer or none", () => {
    const entries = (n: number): ListItem[] => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, group: null, title: `Session ${i}`, details: ["fake", "1 hour ago", "~/x"] }));
    const heights = [1, 3, 8, 16, 40].flatMap((n) => [undefined, "reading fake's sessions…"].map((text) => overlayLayout({
      title: "Sessions",
      filter: "",
      placeholder: "type to filter",
      items: entries(n),
      grouped: false,
      selected: 0,
      offset: 0,
      width: 100,
      rows: 30,
      closeLabel: "esc",
      hints: [],
      marks: false,
      minRows: 30,
      footer: { text: text ?? "", token: "muted" },
    }).lines.length));
    expect(new Set(heights)).toEqual(new Set([26]));
  });

  describe("merged in place: the selected entry keeps its key and, where it can, its screen row", () => {
    const ids = (...names: string[]) => names;
    test("rows arrive above the selected entry: its index moves down and so does the first row shown", () => {
      // Selected s-5 at index 8 (screen row 8, nothing scrolled); three sessions newer than it arrive.
      const before = ids("n1", "n2", "n3", "s-a", "s-b", "s-c", "s-d", "s-e", "s-5");
      const after = ids("n1", "n2", "n3", "x1", "x2", "x3", "s-a", "s-b", "s-c", "s-d", "s-e", "s-5");
      expect(indexOfKey("s-5", before)).toBe(8);
      expect(keepSelection("s-5", after, { index: 8, offset: 0 })).toEqual({ index: 11, offset: 3 });
      // Scrolled: screen row 8 - 2 = 6 stays 6.
      expect(keepSelection("s-5", after, { index: 8, offset: 2 })).toEqual({ index: 11, offset: 5 });
    });

    test("rows arrive below the selected entry, or the entry moves up: the offset follows, never below 0", () => {
      expect(keepSelection("s-b", ids("n1", "s-a", "s-b", "s-c"), { index: 2, offset: 0 })).toEqual({ index: 2, offset: 0 });
      expect(keepSelection("s-b", ids("n1", "s-b", "s-a"), { index: 2, offset: 1 })).toEqual({ index: 1, offset: 0 });
      expect(keepSelection("s-b", ids("s-b", "s-a"), { index: 4, offset: 1 })).toEqual({ index: 0, offset: 0 });
    });

    test("with no move yet the first row stays selected and nothing scrolls", () => {
      expect(keepSelection(null, ids("n1", "x1", "x2"), { index: 0, offset: 0 })).toEqual({ index: 0, offset: 0 });
      expect(indexOfKey(null, ids("n1", "x1"))).toBe(0);
    });

    test("an entry that is gone leaves the first row selected", () => {
      expect(keepSelection("s-5", ids("n1", "s-a"), { index: 8, offset: 3 })).toEqual({ index: 0, offset: 0 });
      expect(indexOfKey("s-5", ids("n1", "s-a"))).toBe(0);
    });
  });
});
