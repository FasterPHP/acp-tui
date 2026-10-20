// mvp-sessions task group 7, under a PTY against fake-agent only: the session
// list (7.1: rows at 63x21 and 54x20 with every title visible and the details
// in aligned columns, the `surface.overlay` fill, Tab for all directories
// with the time column dropped before the directory, paging), `--resume`
// without an ID (formerly `--pick`, task 12.7) and the `sessions` action (7.2:
// "List at start-up", "Esc at start-up", the command
// in the palette), the agent selector (7.3: "New session with another
// agent"), switching (7.4: "Switch while idle", "Switch refused while
// running") and the errors the list shows (7.5: an agent that cannot reopen,
// `Resource not found`, an agent no longer configured, "Ad hoc agent in the
// list"). Every run has its own XDG_CONFIG_HOME and XDG_STATE_HOME
// (test/session/list-world.ts), and `claude` is overridden by a fake-agent
// command, so the real claude-agent-acp is never launched.
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SESSIONS_FIXTURE_PATH, SESSIONS_HOSTILE_FIXTURE_PATH } from "fake-agent";
import { RESOURCE_NOT_FOUND } from "../../src/session/start.ts";
import { SWITCH_REFUSED_RUNNING } from "../../src/session/switch.ts";
import { deriveSurfaces } from "../../src/theme/index.ts";
import type { OscColours, PtySession } from "../pty/harness.ts";
import { READY, RUNNING, statusRow } from "../pty/regions.ts";
import { listBody, listRows, listWorld, mainText, unframe, type ListWorld } from "./list-world.ts";

let session: PtySession | null = null;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = null;
});

const DARK = { foreground: "#bcbec4", background: "#191a1c" } satisfies OscColours;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** A short history: one turn with a tool call and an answer. */
function turn(user: string, agent: string) {
  return { user, tools: [{ title: "Read src/Example.php", kind: "read", output: "<?php" }], agent };
}

/** Two sessions of the fake agent in `repo`: s-a (2 minutes ago) and s-b (3 hours ago). */
function twoSessions(w: ListWorld, repo: string, more: unknown[] = []): string {
  return w.sessions("store", [
    { sessionId: "s-a", cwd: repo, title: "Render the template", updatedAt: ago(2 * MINUTE), turns: [turn("question a", "answer a")] },
    { sessionId: "s-b", cwd: repo, title: "Fix the router", updatedAt: ago(3 * HOUR), turns: [turn("question b", "answer b")] },
    ...more,
  ]);
}

function start(w: ListWorld, args: readonly string[], options: Parameters<ListWorld["start"]>[1] = {}): PtySession {
  session = w.start(args, options);
  return session;
}

const listOpen = (s: PtySession) => listRows(s).length > 0;
const methods = (w: ListWorld, agent: string) => w.received(agent).map((e) => e.method);
/** The footer: the list's body rows after the entries, joined (a wrapped message reads whole). */
const footerText = (s: PtySession) => listBody(s).join(" ").replace(/\s+/g, " ");

/** Opens the session list from the palette: the `sessions` action has no key. */
async function openFromPalette(s: PtySession): Promise<void> {
  s.sendKeys("Ctrl+P");
  await s.waitFor(/Commands \d+/, 3000);
  s.sendKeys({ text: "session list" });
  await s.waitFor(/Commands 1 /, 3000);
  s.sendKeys("Enter");
  await s.waitFor(() => listOpen(s), 5000);
}

describe("Session list (task 7.1)", () => {
  for (const size of [
    { cols: 63, rows: 21 },
    { cols: 54, rows: 20 },
  ]) {
    test(`at ${size.cols}x${size.rows} every row's title is visible, above the status row, at most rows - 4 tall, on the surface.overlay fill`, async () => {
      const w = listWorld();
      const repo = w.dir("repo");
      const titles = ["Render the template", "Fix the router", "Add the invoice model", "Tidy the config loader", "Speed up the test suite", "Rename the HTTP client"];
      const fixture = w.sessions(
        "store",
        titles.map((title, i) => ({ sessionId: `s-${i}`, cwd: repo, title, updatedAt: ago((i + 1) * 7 * MINUTE + i * 3 * HOUR), turns: [turn(`question ${i}`, `answer ${i}`)] })),
      );
      w.configure({ fake: ["--scenario", "copy-fixtures", "--load", "--list", "--sessions", fixture], other: ["--scenario", "basic"] }, { default_agent_server: "fake" });
      // Another agent's session, from the index only.
      w.record({ agent: "other", sessionId: "o-1", directory: repo, title: "Session of another agent", at: Date.now() - 30 * MINUTE });

      const s = start(w, ["--resume"], { cwd: repo, ...size, colours: DARK });
      await s.waitFor(() => listBody(s).some((r) => r.startsWith("Rename the HTTP client")), 15000);
      await s.flush();
      const rows = listRows(s);
      const body = listBody(s);
      // The snapshot, for the record.
      console.log(`session list at ${size.cols}x${size.rows}:\n${s.screenText().join("\n")}`);
      expect(rows.length).toBeLessThanOrEqual(size.rows - 4);
      // Anchored above the status row.
      // (The status row is above the bottom margin since mvp-chrome-and-keys task 4.1.)
      expect(s.screenText().findIndex((r) => r.startsWith("╰─ ↑↓ select"))).toBe(size.rows - 3);
      expect(rows[0]).toMatch(/^╭─ Sessions in .* esc ─╮$/);
      expect(body[0]).toContain("type to filter by title, harness or directory");
      const expected = ["New session with fake", "New session with claude", "New session with other", "Session of another agent", ...titles];
      for (const title of expected) expect(body.some((r) => r.startsWith(title))).toBe(true);
      // The agent selector heads the list, the current agent first; then newest first.
      expect(body.slice(1, 4)).toEqual(["New session with fake", "New session with claude", "New session with other"].map((t) => expect.stringMatching(new RegExp(`^${t}`))));
      // The details in aligned columns over the whole list (IDE check 10.2, F2): the title column
      // takes what the agent and time columns leave (the time at least 14 wide, day-two-feedback
      // task 12.5), the directory column (a long temporary path here) is dropped from every row at once.
      const titleWidth = size.cols - 4 - (2 + 5) - (2 + 14);
      const row = (title: string, agent: string, time: string) => `${title.padEnd(titleWidth)}  ${agent.padEnd(5)}  ${time}`;
      expect(body.slice(4, 11)).toEqual([
        row("Render the template", "fake", "7 minutes ago"),
        row("Session of another agent", "other", "30 minutes ago"),
        row("Fix the router", "fake", "3 hours ago"),
        row("Add the invoice model", "fake", "6 hours ago"),
        row("Tidy the config loader", "fake", "9 hours ago"),
        row("Speed up the test suite", "fake", "12 hours ago"),
        row("Rename the HTTP client", "fake", "15 hours ago"),
      ]);
      // No agent but the current one was started to build the list.
      expect(methods(w, "other")).toEqual([]);
      expect(methods(w, "fake")).toEqual(["initialize", "session/list"]);
      // The fill: surface.overlay (at surface.card's step), not the terminal's background.
      const top = s.screenText().findIndex((r) => r.startsWith("╭─ Sessions"));
      const cell = s.cell(s.term.buffer.active.baseY + top + 3, size.cols - 3)!;
      expect(`#${cell.getBgColor().toString(16).padStart(6, "0")}`).toBe(deriveSurfaces(DARK)["surface.overlay"]);
    }, 30000);
  }

  test("agent-supplied titles are sanitised: the hostile fixture's title is listed without its escape sequences or bidi controls", async () => {
    const w = listWorld();
    w.configure({ fake: ["--scenario", "copy-fixtures", "--load", "--list", "--sessions", SESSIONS_HOSTILE_FIXTURE_PATH] });
    const s = start(w, ["-a", "fake", "--resume"], { cols: 120 });
    await s.waitFor(() => listOpen(s), 15000);
    // The fixture's sessions are in /work/alpha: all directories.
    s.sendKeys("Tab");
    await s.waitFor(() => listBody(s).some((r) => r.startsWith("An ordinary session")), 5000);
    const row = listBody(s).find((r) => r.startsWith("Release notes"));
    expect(row).toBeDefined();
    expect(row).toContain("second line");
    const raw = s.rawOutput();
    expect(raw).not.toContain("\x1b]8;");
    expect(raw).not.toMatch(/[‪-‮⁦-⁩]/);
  }, 30000);

  test("all directories at 63x21: the time column is dropped before the directory column, from every row (IDE check 10.2, F2)", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    const elsewhere = w.dir("elsewhere");
    const fixture = twoSessions(w, repo, [{ sessionId: "s-far", cwd: elsewhere, title: "Tidy the config loader", updatedAt: ago(MINUTE * 3) }]);
    w.configure({ fake: ["--scenario", "copy-fixtures", "--load", "--list", "--sessions", fixture] }, { default_agent_server: "fake" });
    w.record({ agent: "other", sessionId: "o-far", directory: elsewhere, title: "Indexed elsewhere", at: Date.now() - 10 * MINUTE });

    const s = start(w, ["--resume"], { cwd: repo, cols: 63, rows: 21 });
    await s.waitFor(() => listBody(s).some((r) => r.startsWith("Fix the router")), 15000);
    // This directory: the time is kept and the (long, temporary) directory dropped.
    expect(listBody(s).find((r) => r.startsWith("Render the template"))).toMatch(/^Render the template +fake {2}2 minutes ago$/);
    s.sendKeys("Tab");
    await s.waitFor(() => listBody(s).some((r) => r.startsWith("Tidy the config loader")), 5000);
    await s.flush();
    console.log(`all directories at 63x21:\n${s.screenText().join("\n")}`);
    const rows = listBody(s).filter((r) => /^(Tidy the config loader|Indexed elsewhere|Render the template|Fix the router) /.test(r));
    expect(rows.length).toBe(4);
    // Every session row: the title column, the agent column, then the directory (cut in the
    // middle), all starting in the same columns; no time.
    const agentAt = rows[0]!.search(/ (fake|other) /) + 1;
    for (const row of rows) {
      expect(row).not.toContain("ago");
      expect(row.slice(agentAt)).toMatch(/^(fake |other) {2}\/tmp\/.*(repo|elsewhere)$/);
    }
    const directoryAt = rows.map((r) => r.indexOf("/tmp/"));
    expect(new Set(directoryAt).size).toBe(1);
  }, 30000);

  test("Tab shows all directories (session/list without cwd, the whole index); the next page is read when the selection reaches the end", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    const elsewhere = w.dir("elsewhere");
    const fixture = twoSessions(w, repo, [
      { sessionId: "s-c", cwd: repo, title: "Third in repo", updatedAt: ago(5 * HOUR) },
      { sessionId: "s-far", cwd: elsewhere, title: "In another directory", updatedAt: ago(MINUTE * 3) },
    ]);
    w.configure({ fake: ["--scenario", "copy-fixtures", "--load", "--list", "--page-size", "2", "--sessions", fixture] }, { default_agent_server: "fake" });
    w.record({ agent: "other", sessionId: "o-far", directory: elsewhere, title: "Indexed elsewhere", at: Date.now() - 10 * MINUTE });

    const s = start(w, ["--resume"], { cwd: repo });
    await s.waitFor(() => listBody(s).some((r) => r.startsWith("Fix the router")), 15000);
    // The first page only, filtered by the session directory.
    let lists = w.received("fake").filter((e) => e.method === "session/list");
    expect(lists.map((e) => e.params)).toEqual([{ cwd: repo }]);
    expect(listBody(s).some((r) => r.startsWith("Third in repo"))).toBe(false);
    // The selection at the end reads the next page by its cursor.
    s.sendKeys("End");
    await s.waitFor(() => listBody(s).some((r) => r.startsWith("Third in repo")), 5000);
    lists = w.received("fake").filter((e) => e.method === "session/list");
    expect(lists[1]?.params).toEqual({ cwd: repo, cursor: expect.any(String) });
    expect(listBody(s).some((r) => r.startsWith("In another directory") || r.startsWith("Indexed elsewhere"))).toBe(false);

    s.sendKeys("Tab");
    await s.waitFor(() => listRows(s)[0]?.includes("Sessions in all directories") ?? false, 3000);
    await s.waitFor(() => listBody(s).some((r) => r.startsWith("In another directory")), 5000);
    expect(listBody(s).some((r) => r.startsWith("Indexed elsewhere"))).toBe(true);
    lists = w.received("fake").filter((e) => e.method === "session/list");
    expect(lists[2]?.params).toEqual({});
    // Tab again: back to the session directory.
    s.sendKeys("Tab");
    await s.waitFor(() => !listBody(s).some((r) => r.startsWith("Indexed elsewhere")), 3000);
    expect(listRows(s)[0]).toContain("Sessions in");
    expect(listRows(s)[0]).not.toContain("all directories");
  }, 30000);
});

describe("Reaching the session list (task 7.2)", () => {
  test("List at start-up: the second session row is opened by load and the list closes", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ fake: ["--scenario", "copy-fixtures", "--load", "--list", "--sessions", twoSessions(w, repo)] });
    const s = start(w, ["-a", "fake", "--resume"], { cwd: repo });
    await s.waitFor(() => listBody(s).some((r) => r.startsWith("Fix the router")), 15000);
    // No session exists while the list is open.
    expect(methods(w, "fake")).toEqual(["initialize", "session/list"]);
    // New session with fake, New session with claude, then the sessions: the second is s-b.
    s.sendKeys("Down", "Down", "Down", "Enter");
    await s.waitFor("answer b", 5000);
    await s.waitFor(READY, 5000);
    expect(listOpen(s)).toBe(false);
    const received = w.received("fake");
    expect(received.find((e) => e.method === "session/load")?.params).toEqual({ sessionId: "s-b", cwd: repo, mcpServers: [] });
    expect(received.some((e) => e.method === "session/new")).toBe(false);
    // Recorded in the index as for --resume <id>.
    expect(w.index().find("s-b").record).toMatchObject({ agent: "fake", directory: repo, title: "Fix the router" });
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    // The resume line alone (mvp-sessions design decision 12).
    expect(mainText(s)).toContain("resume: acp-tui --resume s-b");
    expect(mainText(s)).not.toContain("acp-tui: session");
  }, 30000);

  test("Esc at start-up: a new session starts in the session directory with agent fake", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ fake: ["--scenario", "copy-fixtures", "--load", "--list", "--sessions", twoSessions(w, repo)] });
    const s = start(w, ["-a", "fake", "--resume"], { cwd: repo });
    await s.waitFor(() => listOpen(s), 15000);
    s.sendKeys("Esc");
    // The status row says connected once the harness is up, before the session is (task 12.7).
    await s.waitFor(() => !listOpen(s) && w.received("fake").some((e) => e.method === "session/new"), 5000);
    await s.waitFor(READY, 5000);
    expect(listOpen(s)).toBe(false);
    const received = w.received("fake");
    expect(received.find((e) => e.method === "session/new")?.params).toEqual({ cwd: repo, mcpServers: [] });
    expect(received.some((e) => e.method === "session/load")).toBe(false);
    await s.waitFor(() => statusRow(s).includes("repo"), 5000);
  }, 30000);

  test("Ctrl+D while the list is open at start-up detaches with no session: nothing but initialize and session/list sent, nothing printed", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ fake: ["--scenario", "copy-fixtures", "--load", "--list", "--sessions", twoSessions(w, repo)] });
    const s = start(w, ["-a", "fake", "--resume"], { cwd: repo });
    await s.waitFor(() => listOpen(s), 15000);
    // The list opens before the harness is up (day-two-feedback D2): wait for its page.
    await s.waitFor(() => methods(w, "fake").includes("session/list"), 15000);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    expect(methods(w, "fake")).toEqual(["initialize", "session/list"]);
    expect(mainText(s)).not.toContain("resume:");
  }, 30000);

  test("the `sessions` command is in the palette (no key) and opens the list; Esc returns to the session in use", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ fake: ["--scenario", "copy-fixtures", "--load", "--list", "--sessions", twoSessions(w, repo)] });
    const s = start(w, ["-a", "fake"], { cwd: repo, cols: 63, rows: 21 });
    await s.waitFor(READY, 15000);
    s.sendKeys("Ctrl+P");
    await s.waitFor(/Commands \d+/, 3000);
    s.sendKeys({ text: "session list" });
    await s.waitFor("Open the session list", 3000);
    // No key is bound to it: the entry shows its title alone.
    const entry = s.screenText().find((r) => r.includes("Open the session list"))!;
    expect(unframe(entry)).toBe("Open the session list");
    s.sendKeys("Enter");
    await s.waitFor(() => listBody(s).some((r) => r.startsWith("Fix the router")), 5000);
    s.sendKeys("Esc");
    await s.waitFor(() => !listOpen(s), 3000);
    // The session in use carries on: typing goes into the prompt box, nothing else was sent.
    const sent = methods(w, "fake");
    expect(sent.filter((m) => m === "session/new").length).toBe(1);
    expect(sent.filter((m) => ["session/load", "session/resume", "session/close", "session/cancel"].includes(m))).toEqual([]);
    s.sendKeys({ text: "typed" });
    await s.waitFor("typed", 3000);
  }, 30000);
});

describe("Agent selector (task 7.3)", () => {
  test("New session with another agent: it is launched, session/new is sent to it with the session directory, the conversation is empty, and the old agent is closed as on exit", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({
      fake: ["--scenario", "copy-fixtures", "--load", "--list", "--sessions", twoSessions(w, repo)],
      other: ["--scenario", "basic"],
    });
    w.record({ agent: "fake", sessionId: "s-a", directory: repo, title: "Render the template" });
    const s = start(w, ["--resume", "s-a"], { cwd: repo });
    await s.waitFor("answer a", 15000);
    await s.waitFor(READY, 5000);
    await openFromPalette(s);
    s.sendKeys({ text: "with other" });
    await s.waitFor(() => listBody(s).some((r) => r.startsWith("New session with other")), 3000);
    s.sendKeys("Enter");
    await s.waitFor(() => !listOpen(s), 10000);
    await s.waitFor(READY, 5000);
    const other = w.received("other");
    expect(other.map((e) => e.method).slice(0, 2)).toEqual(["initialize", "session/new"]);
    expect(other.find((e) => e.method === "session/new")?.params).toEqual({ cwd: repo, mcpServers: [] });
    // The conversation is the new session's: empty.
    expect(s.screenText().join("\n")).not.toContain("answer a");
    // The old agent: no session/close, no session/cancel; its process closed as on exit.
    expect(methods(w, "fake").filter((m) => m === "session/close" || m === "session/cancel")).toEqual([]);
    await s.waitFor(() => w.events("agent_exited_after_detach").length === 1, 5000);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
  }, 30000);
});

describe("Switching sessions is detach (task 7.4)", () => {
  test("Switch while idle: no session/close or session/cancel for a, the conversation shows b, the agent process is kept, and the resume line names b", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ fake: ["--scenario", "copy-fixtures", "--load", "--list", "--sessions", twoSessions(w, repo)] });
    const s = start(w, ["-a", "fake", "--resume", "s-a"], { cwd: repo });
    await s.waitFor("answer a", 15000);
    await s.waitFor(READY, 5000);
    await openFromPalette(s);
    s.sendKeys({ text: "router" });
    await s.waitFor(() => listBody(s)[1]?.startsWith("Fix the router") ?? false, 3000);
    s.sendKeys("Enter");
    await s.waitFor("answer b", 5000);
    await s.waitFor(READY, 5000);
    expect(listOpen(s)).toBe(false);
    expect(s.screenText().join("\n")).not.toContain("answer a");
    const received = methods(w, "fake");
    // One agent process throughout: one initialize.
    expect(received.filter((m) => m === "initialize").length).toBe(1);
    expect(w.received("fake").filter((e) => e.method === "session/load").map((e) => e.params?.["sessionId"])).toEqual(["s-a", "s-b"]);
    expect(received.filter((m) => m === "session/close" || m === "session/cancel")).toEqual([]);
    expect(w.events("agent_exited_after_detach")).toEqual([]);
    // The switched-to session is recorded as for --resume <id>.
    expect(w.index().find("s-b").record).toMatchObject({ agent: "fake", directory: repo });
    // A prompt goes to b.
    s.sendKeys({ text: "next" }, "Enter");
    await s.waitFor(() => w.received("fake").some((e) => e.method === "session/prompt"), 5000);
    expect(w.received("fake").find((e) => e.method === "session/prompt")?.params?.["sessionId"]).toBe("s-b");
    await s.waitFor(READY, 10000);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    expect(mainText(s)).toContain("resume: acp-tui --resume s-b");
    expect(mainText(s)).not.toContain("s-a");
  }, 30000);

  test("After a switch (task 12.3): a session of another directory ends with the marker naming both directories", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    const elsewhere = w.dir("elsewhere");
    const third = { sessionId: "s-c", cwd: elsewhere, title: "Tidy the loader", updatedAt: ago(4 * HOUR), turns: [turn("question c", "answer c")] };
    w.configure({ fake: ["--scenario", "copy-fixtures", "--load", "--list", "--sessions", twoSessions(w, repo, [third])] });
    const s = start(w, ["-a", "fake", "--resume", "s-a"], { cwd: repo });
    await s.waitFor("answer a", 15000);
    await s.waitFor(READY, 5000);
    // s-a is in the launch directory: no marker.
    expect(s.screenText().join("\n")).not.toContain("opened in");
    await openFromPalette(s);
    // All directories (Tab), then the session in the other one.
    s.sendKeys("Tab");
    s.sendKeys({ text: "loader" });
    await s.waitFor(() => listBody(s)[1]?.startsWith("Tidy the loader") ?? false, 3000);
    s.sendKeys("Enter");
    await s.waitFor("answer c", 5000);
    await s.waitFor(READY, 5000);
    const squeezed = (text: string) => text.replace(/\s+/g, "");
    const marker = squeezed(`opened in ${elsewhere} (launched from ${repo})`);
    await s.waitFor(() => squeezed(s.screenText().join("")).includes(marker), 5000);
    // The marker is the conversation's last item: the answer comes before it.
    const screen = squeezed(s.screenText().join(""));
    expect(screen.indexOf(squeezed("answer c"))).toBeLessThan(screen.indexOf(marker));
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
  }, 30000);

  test("Switch refused while running: the list stays open with the notice, and nothing is sent to the agent", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ fake: ["--scenario", "stream-long", "--delay-scale", "1", "--load", "--list", "--sessions", twoSessions(w, repo)] });
    const s = start(w, ["-a", "fake"], { cwd: repo });
    await s.waitFor(READY, 15000);
    s.sendKeys({ text: "go" }, "Enter");
    await s.waitFor(RUNNING, 5000);
    await openFromPalette(s);
    s.sendKeys({ text: "router" });
    await s.waitFor(() => listBody(s)[1]?.startsWith("Fix the router") ?? false, 3000);
    const before = methods(w, "fake").length;
    s.sendKeys("Enter");
    await s.waitFor(() => footerText(s).includes("must finish or be interrupted"), 3000);
    expect(footerText(s)).toContain(SWITCH_REFUSED_RUNNING.split(";")[0]!);
    expect(listOpen(s)).toBe(true);
    await Bun.sleep(300);
    const after = w.received("fake").slice(before).map((e) => e.method);
    expect(after.filter((m) => m.startsWith("session/") && m !== "session/update")).toEqual([]);
    expect(methods(w, "fake").filter((m) => m === "session/load" || m === "session/cancel" || m === "session/close")).toEqual([]);
  }, 30000);
});

// IDE check 10.2: run through the launcher (every spike on, no-op names since mvp-chrome-and-keys task 7.5), a switch away from an open session
// failed in the list's footer with `undefined is not an object (evaluating 'tool().status')` (from
// sess-alpha, with tool calls) or `... 'user().text'` (from sess-beta, without): the conversation
// block was never remounted, so the windowed list's components read the items `store.replace` had
// removed.
describe("Switching away from an open session (IDE check 10.2)", () => {
  /** fake-agent's session fixture, its directories rewritten to `repo` and `other`. */
  function fixtureIn(w: ListWorld, repo: string, other: string): string {
    const { sessions } = JSON.parse(readFileSync(SESSIONS_FIXTURE_PATH, "utf8")) as { sessions: { cwd: string }[] };
    return w.sessions("store", sessions.map((entry) => ({ ...entry, cwd: entry.cwd === "/work/alpha" ? repo : other })));
  }

  /** The sessions opened first: sess-alpha ("Fix the router": a thought, a read, an edit and an
   *  execute), sess-beta ("Add the appointment model": a user message and an answer). */
  const ALPHA = { filter: "router", title: "Fix the router", shows: ["Run vendor/bin/phpunit", "expects the query string to be kept"] };
  const BETA = { filter: "appointment", title: "Add the appointment model", shows: ["Added src/Model/Appointment.php"] };

  /** `--resume` (no ID) with agent fake (and `other` configured), then `first` chosen from the list. */
  async function pick(w: ListWorld, first: typeof ALPHA): Promise<PtySession> {
    const repo = w.dir("repo");
    const fixture = fixtureIn(w, repo, w.dir("beta"));
    const fake = (store: string) => ["--scenario", "copy-fixtures", "--load", "--list", "--persist", "--title-update", "--sessions", store];
    w.configure({ fake: fake(fixture), other: fake(w.sessions("other-store", [])) }, { default_agent_server: "fake" });
    const s = start(w, ["--resume"], { cwd: repo });
    await s.waitFor(() => listBody(s).some((r) => r.startsWith(first.title)), 15000);
    s.sendKeys({ text: first.filter });
    await s.waitFor(() => listBody(s)[1]?.startsWith(first.title) ?? false, 3000);
    s.sendKeys("Enter");
    for (const text of first.shows) await s.waitFor(text, 5000);
    await s.waitFor(READY, 5000);
    expect(listOpen(s)).toBe(false);
    return s;
  }
  const pickAlpha = (w: ListWorld) => pick(w, ALPHA);

  /** Opens the session list as in the IDE check, through the command palette: `?` in the empty prompt box (`/` until mvp-chrome-and-keys task 12.1 gave `/` the agent's commands alone), `session list` (`session` alone also matches the `Session` group now that the palette lists every action), Enter. */
  async function openFromSlash(s: PtySession): Promise<void> {
    s.sendKeys({ text: "?" });
    await s.waitFor(/Commands \d+/, 3000);
    s.sendKeys({ text: "session list" });
    // The filter has applied once the palette lists one entry (the unfiltered list shows it too).
    await s.waitFor(/Commands 1 /, 3000);
    s.sendKeys("Enter");
    await s.waitFor(() => listOpen(s), 5000);
  }

  /** Enter on the list's first entry; the list closes, or its footer shows why not. */
  async function chooseFirst(s: PtySession): Promise<void> {
    s.sendKeys("Enter");
    await s.waitFor(() => !listOpen(s) || footerText(s).includes("cannot"), 10000);
    expect(listOpen(s) ? footerText(s) : "").toBe("");
  }

  {
    for (const first of [ALPHA, BETA]) {
      test(`from "${first.title}", New session with another agent opens it with no error, and the old agent is closed`, async () => {
        const w = listWorld();
        const s = await pick(w, first);
        await openFromSlash(s);
        s.sendKeys({ text: "with other" });
        await s.waitFor(() => listBody(s)[1]?.startsWith("New session with other") ?? false, 3000);
        await chooseFirst(s);
        await s.waitFor(READY, 5000);
        expect(methods(w, "other").slice(0, 2)).toEqual(["initialize", "session/new"]);
        // The conversation is the new session's: empty.
        const screen = s.screenText().join("\n");
        for (const text of first.shows) expect(screen).not.toContain(text);
        await s.waitFor(() => w.events("agent_exited_after_detach").length === 1, 5000);
        // The new session works: a prompt goes to the other agent.
        s.sendKeys({ text: "next" }, "Enter");
        await s.waitFor(() => w.received("other").some((e) => e.method === "session/prompt"), 5000);
        await s.waitFor(READY, 10000);
        s.sendKeys("Ctrl+D");
        expect(await s.wait(10000)).toBe(0);
      }, 30000);
    }

    test(`back to the session list after a switch to another agent, a session of the first agent opens again`, async () => {
      const w = listWorld();
      const s = await pickAlpha(w);
      await openFromSlash(s);
      s.sendKeys({ text: "with other" });
      await s.waitFor(() => listBody(s)[1]?.startsWith("New session with other") ?? false, 3000);
      await chooseFirst(s);
      await s.waitFor(READY, 5000);
      await s.waitFor(() => w.events("agent_exited_after_detach").length === 1, 5000);
      // sess-alpha again, from the index (fake is no longer running, so it is launched again).
      await openFromSlash(s);
      s.sendKeys({ text: ALPHA.filter });
      await s.waitFor(() => listBody(s)[1]?.startsWith(ALPHA.title) ?? false, 3000);
      await chooseFirst(s);
      for (const text of ALPHA.shows) await s.waitFor(text, 5000);
      await s.waitFor(READY, 5000);
      expect(methods(w, "fake").filter((m) => m === "initialize").length).toBe(2);
      expect(w.received("fake").filter((e) => e.method === "session/load").map((e) => e.params?.["sessionId"])).toEqual(["sess-alpha", "sess-alpha"]);
      // Now the other agent's process is closed as on exit.
      await s.waitFor(() => w.events("agent_exited_after_detach").length === 2, 5000);
      s.sendKeys("Ctrl+D");
      expect(await s.wait(10000)).toBe(0);
    }, 30000);

    test(`another session of the same agent opens with no error, its history in place of the old one, and back again`, async () => {
      const w = listWorld();
      const s = await pickAlpha(w);
      await openFromSlash(s);
      s.sendKeys({ text: "appointment" });
      await s.waitFor(() => listBody(s)[1]?.startsWith("Add the appointment model") ?? false, 3000);
      await chooseFirst(s);
      await s.waitFor("Added src/Model/Appointment.php", 5000);
      await s.waitFor(READY, 5000);
      const screen = s.screenText().join("\n");
      expect(screen).not.toContain("Run vendor/bin/phpunit");
      expect(screen).not.toContain("query string");
      // And back to the session with tool calls, which shows its history again.
      await openFromSlash(s);
      s.sendKeys({ text: "router" });
      await s.waitFor(() => listBody(s)[1]?.startsWith("Fix the router") ?? false, 3000);
      await chooseFirst(s);
      await s.waitFor("Run vendor/bin/phpunit", 5000);
      await s.waitFor(READY, 5000);
      expect(s.screenText().join("\n")).not.toContain("Added src/Model/Appointment.php");
      expect(w.received("fake").filter((e) => e.method === "session/load").map((e) => e.params?.["sessionId"])).toEqual(["sess-alpha", "sess-beta", "sess-alpha"]);
      expect(methods(w, "fake").filter((m) => m === "initialize").length).toBe(1);
      s.sendKeys("Ctrl+D");
      expect(await s.wait(10000)).toBe(0);
    }, 30000);
  }
});

describe("Honest errors in the list (task 7.5)", () => {
  test("an agent that cannot reopen sessions: the message names the session and the agent, the list stays open, nothing is sent", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    // Lists its sessions, but advertises neither session/load nor session/resume.
    w.configure({ fake: ["--scenario", "copy-fixtures", "--list", "--sessions", twoSessions(w, repo)] });
    const s = start(w, ["-a", "fake", "--resume"], { cwd: repo });
    await s.waitFor(() => listBody(s).some((r) => r.startsWith("Fix the router")), 15000);
    s.sendKeys({ text: "router" }, "Enter");
    await s.waitFor(() => footerText(s).includes("cannot reopen sessions"), 5000);
    expect(footerText(s)).toContain("cannot open session s-b: harness 'fake' cannot reopen sessions (no session/load or session/resume)");
    expect(listOpen(s)).toBe(true);
    expect(methods(w, "fake")).toEqual(["initialize", "session/list"]);
    expect(footerText(s)).not.toMatch(/install/i);
  }, 30000);

  test("Resource not found (-32002): the agent's answer alone, never a hint or an install message; the list stays open and Esc still starts a new session", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ fake: ["--scenario", "copy-fixtures", "--load", "--list", "--load-error", "s-b", "--sessions", twoSessions(w, repo)] });
    const s = start(w, ["-a", "fake", "--resume"], { cwd: repo, cols: 63, rows: 21 });
    await s.waitFor(() => listBody(s).some((r) => r.startsWith("Fix the router")), 15000);
    s.sendKeys({ text: "router" }, "Enter");
    await s.waitFor(() => footerText(s).includes(`(${RESOURCE_NOT_FOUND})`), 5000);
    const footer = footerText(s);
    expect(footer).toContain("cannot open session s-b with harness 'fake': the harness answered Resource not found (-32002)");
    expect(footer).not.toContain("may not have saved");
    expect(footer).not.toContain("acp-tui --resume");
    expect(footer).not.toMatch(/install/i);
    expect(listOpen(s)).toBe(true);
    expect(methods(w, "fake").includes("session/new")).toBe(false);
    // Back to `connecting` while there is no session.
    expect(statusRow(s)).toContain("connecting");
    s.sendKeys("Esc");
    await s.waitFor(() => w.received("fake").some((e) => e.method === "session/new"), 5000);
    await s.waitFor(READY, 5000);
    expect(w.received("fake").find((e) => e.method === "session/new")?.params).toEqual({ cwd: repo, mcpServers: [] });
  }, 30000);

  test("an agent no longer configured: the message names the session and the agent; nothing is launched", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ fake: ["--scenario", "copy-fixtures", "--load", "--list", "--sessions", twoSessions(w, repo)] }, { default_agent_server: "fake" });
    w.record({ agent: "gone", sessionId: "s-gone", directory: repo, title: "Session of a removed agent", at: Date.now() - MINUTE });
    const s = start(w, ["--resume"], { cwd: repo });
    await s.waitFor(() => listBody(s).some((r) => r.startsWith("Session of a removed agent")), 15000);
    s.sendKeys({ text: "removed" }, "Enter");
    await s.waitFor(() => footerText(s).includes("cannot be launched now"), 5000);
    expect(footerText(s)).toContain("session s-gone was recorded with harness 'gone', which cannot be launched now: 'gone' is not a known harness");
    expect(listOpen(s)).toBe(true);
    expect(methods(w, "gone")).toEqual([]);
    expect(methods(w, "fake")).toEqual(["initialize", "session/list"]);
  }, 30000);

  test("Ad hoc agent in the list: the message gives the command line that reopens it, and nothing is run", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ fake: ["--scenario", "copy-fixtures", "--load", "--list", "--sessions", twoSessions(w, repo)] }, { default_agent_server: "fake" });
    const adHoc = w.fake("adhoc", ["--scenario", "basic", "--load"]);
    w.record({ agent: "ad hoc", command: adHoc, sessionId: "s-adhoc", directory: repo, title: "Started ad hoc", at: Date.now() - MINUTE });
    const s = start(w, ["--resume"], { cwd: repo, cols: 160 });
    await s.waitFor(() => listBody(s).some((r) => r.startsWith("Started ad hoc")), 15000);
    expect(listBody(s).find((r) => r.startsWith("Started ad hoc"))).toContain("ad hoc");
    s.sendKeys({ text: "started ad hoc" }, "Enter");
    await s.waitFor(() => footerText(s).includes("ad hoc harness command"), 5000);
    const footer = footerText(s);
    expect(footer).toContain("session s-adhoc was started with an ad hoc harness command, which acp-tui never runs from its index; reopen it with: acp-tui --resume s-adhoc -- bun");
    expect(listOpen(s)).toBe(true);
    // Nothing run: the ad hoc command's log was never written.
    expect(methods(w, "adhoc")).toEqual([]);
    expect(methods(w, "fake")).toEqual(["initialize", "session/list"]);
  }, 30000);
});
