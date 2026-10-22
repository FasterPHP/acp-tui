// day-two-feedback task group 3 (design D2), under a PTY against fake-agent only: the session list
// of `--resume` opens with the app's first frame, from the index, while the harness starts
// (fake-agent's `--start-delay` and `--list-delay`); its footer says what it waits for; the panel has
// its full height from the first frame; the harness's sessions are merged in place; and a row chosen,
// or Esc, before the harness is up waits for it. Every run has its own XDG_CONFIG_HOME and
// XDG_STATE_HOME (test/session/list-world.ts), so the real claude-agent-acp is never launched.
//
// The timing tests of this file are in session-list-startup.pty.timing.test.ts (parallel-tests: they run in the serial pass).
import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PtySession } from "../pty/harness.ts";
import { READY, statusRow } from "../pty/regions.ts";
import { listBody, listRows, listWorld, type ListWorld } from "./list-world.ts";
import { MINUTE, ago, listOpen, methods, footerLine, topRow, rowOf, indexSessions, harnessSessions } from "./session-list-startup-helpers.ts";

let session: PtySession | null = null;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = null;
});

describe("the session list opens before the harness has started (tasks 3.1 to 3.5)", () => {
  test("Starting, then reading: the footer reads `starting fake…`, then `reading fake's sessions…`, then nothing, and the panel's height never changes", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    indexSessions(w, repo, 2);
    w.configure({ fake: ["--scenario", "basic", "--load", "--list", "--sessions", harnessSessions(w, repo, [{ id: "s-0", title: "Session 00", minutes: 1 }, { id: "s-1", title: "Session 01", minutes: 2 }, { id: "h-9", title: "Only the harness knows", minutes: 3 }]), "--start-delay", "1500", "--list-delay", "1500"] });
    const s = (session = w.start(["-a", "fake", "--resume"], { cwd: repo }));
    const seen: string[] = [];
    const heights = new Set<number>();
    const tops = new Set<number>();
    const began = Date.now();
    while (Date.now() - began < 15000) {
      await Bun.sleep(40);
      await s.flush();
      if (!listOpen(s)) continue;
      heights.add(listRows(s).length);
      tops.add(topRow(s));
      const footer = footerLine(s).replace(/^\S\s/, "");
      if (footer !== "" && seen.at(-1) !== footer) seen.push(footer);
      if (listBody(s).some((r) => r.startsWith("Only the harness knows")) && footer === "") break;
    }
    expect(seen).toEqual(["starting fake…", "reading fake's sessions…"]);
    expect(heights.size).toBe(1);
    expect(tops.size).toBe(1);
    expect([...heights][0]).toBe(26);
    expect(footerLine(s)).toBe("");
  }, 40000);

  test("Full height from the start: 8 index sessions, 16 listed, 100x30: the top border on one screen row throughout, 26 rows", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    indexSessions(w, repo, 8);
    const all = Array.from({ length: 16 }, (_, i) => ({ id: `s-${i}`, title: `Session ${String(i).padStart(2, "0")}`, minutes: i + 1 }));
    w.configure({ fake: ["--scenario", "basic", "--load", "--list", "--sessions", harnessSessions(w, repo, all), "--start-delay", "500", "--list-delay", "1000"] });
    const s = (session = w.start(["-a", "fake", "--resume"], { cwd: repo }));
    const tops = new Set<number>();
    const heights = new Set<number>();
    const began = Date.now();
    let complete = false;
    while (Date.now() - began < 15000) {
      await Bun.sleep(30);
      await s.flush();
      if (!listOpen(s)) continue;
      tops.add(topRow(s));
      heights.add(listRows(s).length);
      if (listBody(s).some((r) => r.startsWith("Session 15"))) {
        complete = true;
        break;
      }
    }
    expect(complete).toBe(true);
    expect([...tops]).toHaveLength(1);
    expect([...heights]).toEqual([26]);
  }, 30000);

  test("Selection kept while rows arrive: the user moves to the last row before the page comes, and it stays selected on its screen row; Enter opens it", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    indexSessions(w, repo, 30);
    // Three sessions only the harness knows, newer than every index session.
    const harness = [
      ...Array.from({ length: 30 }, (_, i) => ({ id: `s-${i}`, title: `Session ${String(i).padStart(2, "0")}`, minutes: i + 1 })),
      ...[0, 1, 2].map((i) => ({ id: `h-${i}`, title: `Harness only ${i}`, minutes: 0.1 + i * 0.01 })),
    ];
    // The page is held until the user has moved (fake-agent's `--list-gate`).
    const gate = join(w.dir("gate"), "open");
    w.configure({ fake: ["--scenario", "basic", "--load", "--list", "--sessions", harnessSessions(w, repo, harness), "--list-gate", gate] });
    const s = (session = w.start(["-a", "fake", "--resume"], { cwd: repo }));
    await s.waitFor(() => listOpen(s) && listBody(s).some((r) => r.startsWith("Session 00")), 15000);
    s.sendKeys("End");
    await s.waitFor(() => rowOf(s, "Session 29") >= 0, 5000);
    const before = rowOf(s, "Session 29");
    expect(w.events("session_list_response")).toEqual([]);
    writeFileSync(gate, "");
    // The page merged: the footer that read the sessions is empty again.
    await s.waitFor(() => w.events("session_list_response").length > 0 && footerLine(s) === "", 10000);
    // The three harness-only rows are above it now; it is selected where it was.
    expect(rowOf(s, "Session 29")).toBe(before);
    s.sendKeys("Enter");
    // The status row says connected from `initialize` on, before the session is opened (task 12.7).
    await s.waitFor(() => w.received("fake").some((e) => e.method === "session/load"), 10000);
    await s.waitFor(READY, 10000);
    const load = w.received("fake").find((e) => e.method === "session/load");
    expect(load?.params?.["sessionId"]).toBe("s-29");
  }, 40000);

  test("Choice waits for the harness: Enter on an index session before fake is up shows `waiting for fake to start…`, then opens it", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    indexSessions(w, repo, 1);
    const store = harnessSessions(w, repo, [{ id: "s-0", title: "Session 00", minutes: 1 }]);
    w.configure({ fake: ["--scenario", "basic", "--load", "--list", "--sessions", store, "--start-delay", "2000"] });
    const s = (session = w.start(["-a", "fake", "--resume"], { cwd: repo }));
    await s.waitFor(() => listBody(s).some((r) => r.startsWith("Session 00")), 15000);
    s.sendKeys("Down");
    s.sendKeys("Down");
    s.sendKeys("Enter");
    await s.waitFor(() => /waiting for fake to start…/.test(footerLine(s)), 5000);
    expect(methods(w)).not.toContain("session/load");
    await s.waitFor(READY, 15000);
    expect(listOpen(s)).toBe(false);
    expect(w.received("fake").find((e) => e.method === "session/load")?.params?.["sessionId"]).toBe("s-0");
  }, 40000);

  test("Esc at start-up is taken at once and the new session starts once the harness is up", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    indexSessions(w, repo, 1);
    w.configure({ fake: ["--scenario", "basic", "--load", "--list", "--start-delay", "2000"] });
    const s = (session = w.start(["-a", "fake", "--resume"], { cwd: repo }));
    await s.waitFor(() => listOpen(s), 15000);
    s.sendKeys("Esc");
    await s.waitFor(() => !listOpen(s), 2000);
    // Nothing has started yet: the splash waits for the harness.
    expect(w.received("fake").some((e) => e.method === "session/new")).toBe(false);
    // The status row reads `idle` and `connected` from `initialize` on (task 12.7), before the
    // session is asked for, so the wait is for the request itself.
    await s.waitFor(() => methods(w).includes("session/new"), 15000);
    await s.waitFor(READY, 15000);
  }, 40000);

  test("A start-up failure shows in the footer with the list open; Esc then ends acp-tui as a start-up failure", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    indexSessions(w, repo, 1);
    // An unknown scenario stops fake-agent at start-up, before it answers initialize.
    w.configure({ fake: ["--scenario", "no-such-scenario", "--load", "--list"] });
    const s = (session = w.start(["-a", "fake", "--resume"], { cwd: repo }));
    await s.waitFor(() => listOpen(s), 15000);
    await s.waitFor(() => footerLine(s) !== "" && !/starting fake…/.test(footerLine(s)), 15000);
    expect(listOpen(s)).toBe(true);
    expect(listBody(s).some((r) => r.startsWith("Session 00"))).toBe(true);
    expect(listBody(s).join("\n")).not.toContain("no sessions yet");
    s.sendKeys("Esc");
    expect(await s.wait(10000)).toBe(1);
  }, 40000);
});

describe("the columns stay where they are (task 12.5)", () => {
  test("A longer title and a longer time arriving with the harness's page do not move the harness, time or directory columns", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    indexSessions(w, repo, 3);
    const arriving = [
      { id: "h-1", title: "Add the appointment model for the clinic booking flow", minutes: 59 },
      { id: "h-2", title: "Split the portal views into smaller templates for the clinic", minutes: 58 },
    ];
    // The harness's page is held until the test has read the index's rows (fake-agent's
    // `--list-gate`): the columns read first are the index's alone, however slow the machine.
    const gate = join(w.dir("gate"), "open");
    w.configure({ fake: ["--scenario", "basic", "--load", "--list", "--sessions", harnessSessions(w, repo, arriving), "--start-delay", "300", "--list-gate", gate] });
    const s = (session = w.start(["-a", "fake", "--resume"], { cwd: repo }));
    const rowText = (title: string) => (listBody(s).find((r) => r.startsWith(title)) ?? "");
    /** The columns at which the harness name, the time and the directory start in a row. */
    const columns = (title: string): number[] => {
      const row = rowText(title);
      return [row.search(/ fake /) + 1, row.search(/ (\d+ minutes? ago|just now)/) + 1, row.search(/ ~|\/\S/)].filter((c) => c > 0);
    };
    // A row is read once all three columns are on it: on a slow machine a frame can reach the
    // terminal in parts (through ConPTY in particular), the title before the rest of the row.
    await s.waitFor(() => listOpen(s) && columns("Session 00").length === 3, 15000);
    const before = columns("Session 00");
    expect(before).toHaveLength(3);
    expect(listBody(s).some((r) => r.startsWith("Add the appointment"))).toBe(false);
    writeFileSync(gate, "");
    await s.waitFor(() => columns("Add the appointment").length === 3, 15000);
    expect(columns("Session 00")).toEqual(before);
    expect(columns("Add the appointment")).toEqual(before);
  }, 40000);
});

describe("Marcus's Mac review, 18 October 2026 (tasks 14.2 and 14.3)", () => {
  test("14.2: the index's title is kept when the harness's page arrives with a different title", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.record({ agent: "fake", sessionId: "s-0", directory: repo, title: "Explain this repository's structure", at: Date.now() - MINUTE });
    w.configure({ fake: ["--scenario", "basic", "--load", "--list", "--sessions", harnessSessions(w, repo, [{ id: "s-0", title: "# For this specific question, follow", minutes: 1 }, { id: "h-9", title: "Only the harness knows", minutes: 3 }]), "--start-delay", "300", "--list-delay", "1500"] });
    const s = (session = w.start(["-a", "fake", "--resume"], { cwd: repo }));
    await s.waitFor(() => listBody(s).some((r) => r.startsWith("Explain this repository")), 10000);
    await s.waitFor(() => listBody(s).some((r) => r.startsWith("Only the harness knows")), 15000);
    expect(listBody(s).some((r) => r.startsWith("Explain this repository"))).toBe(true);
    expect(listBody(s).some((r) => r.includes("# For this specific"))).toBe(false);
  }, 40000);

  const twoHarnesses = (w: ListWorld, repo: string): void => {
    w.record(
      { agent: "fake", sessionId: "f-1", directory: repo, title: "Fake session", at: Date.now() - MINUTE },
      { agent: "claude", sessionId: "c-1", directory: repo, title: "Claude session", at: Date.now() - 2 * MINUTE },
    );
  };

  test("14.3: a named harness (`fake -r`) lists only its sessions and its own new-session row", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    twoHarnesses(w, repo);
    w.configure({ fake: ["--scenario", "basic", "--load", "--list", "--start-delay", "300"] });
    const s = (session = w.start(["fake", "-r"], { cwd: repo }));
    await s.waitFor(() => listBody(s).some((r) => r.startsWith("Fake session")), 10000);
    await Bun.sleep(1500);
    const body = listBody(s).map((r) => r.trim());
    expect(body.some((r) => r.startsWith("Claude session"))).toBe(false);
    expect(body.filter((r) => r.startsWith("New session with"))).toEqual(["New session with fake"]);
  }, 40000);

  test("14.3: no harness named (default_agent_server) lists every harness's sessions and rows", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    twoHarnesses(w, repo);
    w.configure({ fake: ["--scenario", "basic", "--load", "--list", "--start-delay", "300"] }, { default_agent_server: "fake" });
    const s = (session = w.start(["-r"], { cwd: repo }));
    await s.waitFor(() => listBody(s).some((r) => r.startsWith("Fake session")) && listBody(s).some((r) => r.startsWith("Claude session")), 10000);
    const body = listBody(s).map((r) => r.trim());
    expect(body.filter((r) => r.startsWith("New session with"))).toEqual(["New session with fake", "New session with auggie", "New session with claude", "New session with opencode"]);
  }, 40000);
});

describe("the status row while the list is open (task 12.7)", () => {
  test("`starting` until the harness has answered initialize, `connected` after it, with the list still open and no session started", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    indexSessions(w, repo, 2);
    w.configure({ fake: ["--scenario", "basic", "--load", "--list", "--start-delay", "1200", "--list-delay", "2500"] });
    const s = (session = w.start(["-a", "fake", "--resume"], { cwd: repo }));
    await s.waitFor(() => listOpen(s) && /starting/.test(statusRow(s)), 10000);
    expect(footerLine(s)).toMatch(/starting fake…/);
    // initialize answered: the footer reads the sessions, the status row says connected.
    await s.waitFor(() => /reading fake's sessions…/.test(footerLine(s)), 10000);
    await s.waitFor(() => /connected/.test(statusRow(s)), 3000);
    expect(statusRow(s)).not.toMatch(/starting/);
    expect(listOpen(s)).toBe(true);
    expect(methods(w)).not.toContain("session/new");
  }, 40000);
});

describe("the splash behind the list (task 12.8)", () => {
  for (const [cols, rows] of [
    [100, 30],
    [80, 24],
    [63, 21],
  ] as const) {
    test(`Nothing of the splash above the list's top border at ${cols}x${rows}, and the splash is back when the list closes`, async () => {
      const w = listWorld();
      const repo = w.dir("repo");
      indexSessions(w, repo, 1);
      w.configure({ fake: ["--scenario", "basic", "--load", "--list", "--start-delay", "1500"] });
      const s = (session = w.start(["-a", "fake", "--resume"], { cwd: repo, cols, rows }));
      await s.waitFor(() => listOpen(s), 15000);
      // The splash has been drawn by now (it is, from the first frame, when no list is open).
      await Bun.sleep(300);
      expect(s.screenText().slice(0, topRow(s)).join("").trim()).toBe("");
      expect(s.screenText().join("\n")).not.toContain("┏━┓");
      // Esc starts a new session once the harness is up; the list is gone and the splash is back.
      s.sendKeys("Esc");
      await s.waitFor(READY, 15000);
      await s.waitFor(() => !listOpen(s) && s.screenText().join("\n").includes("clear · concise"), 5000);
    }, 40000);
  }
});
