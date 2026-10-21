// parallel-tests task 3.4: the two session-list start-up tests with a time bound: three index sessions shown within one second of the first frame, and a choice made while a page loads opening the session within 5 s, which run in the serial pass.
// What the file covers is in the header of session-list-startup.pty.test.ts; its helpers are in session-list-startup-helpers.ts.
import { afterEach, describe, expect, test } from "bun:test";
import type { PtySession } from "../pty/harness.ts";
import { listBody, listWorld } from "./list-world.ts";
import { listOpen, methods, footerLine, indexSessions, harnessSessions } from "./session-list-startup-helpers.ts";

let session: PtySession | null = null;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = null;
});

describe("the session list opens before the harness has started (tasks 3.1 to 3.5)", () => {
  test("Open before the harness has started: three index sessions shown within one second of the first frame, before fake has answered initialize", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    indexSessions(w, repo, 3);
    w.configure({ fake: ["--scenario", "basic", "--load", "--list", "--start-delay", "3000"] });
    const s = (session = w.start(["-a", "fake", "--resume"], { cwd: repo }));
    const began = Date.now();
    let firstFrame = 0;
    let listed = 0;
    while (listed === 0 && Date.now() - began < 10000) {
      await Bun.sleep(25);
      await s.flush();
      const screen = s.screenText().join("\n");
      // The app's first frame: its status row or its list, whichever is drawn first.
      if (firstFrame === 0 && (/starting/.test(screen) || listOpen(s))) firstFrame = Date.now();
      if (listOpen(s) && ["Session 00", "Session 01", "Session 02"].every((t) => listBody(s).some((r) => r.startsWith(t)))) listed = Date.now();
    }
    expect(listed).toBeGreaterThan(0);
    expect(listed - firstFrame).toBeLessThan(1000);
    // The harness has not answered initialize yet.
    expect(w.events("initialize_response")).toEqual([]);
    // `-a fake` names the harness: its own row alone (task 14.3).
    expect(listBody(s).filter((r) => r.trim().startsWith("New session with")).map((r) => r.trim())).toEqual(["New session with fake"]);
  }, 30000);
});

describe("a choice made while the harness's pages load (task 14.5)", () => {
  test("Choosing an index row while a page is outstanding opens the session at once, cancels the request in flight and asks for no further page", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    indexSessions(w, repo, 3);
    w.configure({ fake: ["--scenario", "basic", "--load", "--list", "--sessions", harnessSessions(w, repo, [0, 1, 2].map((i) => ({ id: `s-${i}`, title: `Session ${String(i).padStart(2, "0")}`, minutes: i + 1 })).concat([{ id: "h-1", title: "Harness only", minutes: 9 }])), "--start-delay", "300", "--list-delay", "20000"] });
    const s = (session = w.start(["-a", "fake", "--resume"], { cwd: repo }));
    await s.waitFor(() => /reading fake's sessions…/.test(footerLine(s)), 10000);
    const chosenAt = Date.now();
    s.sendKeys("Down");
    s.sendKeys("Enter");
    // The session is open when the list has closed and the load has been sent.
    await s.waitFor(() => !listOpen(s) && methods(w).includes("session/load"), 15000);
    expect(Date.now() - chosenAt).toBeLessThan(5000);
    // Exactly the one request in flight; none after the choice.
    expect(methods(w).filter((m) => m === "session/list")).toHaveLength(1);
    // The request in flight was cancelled on the wire.
    await s.waitFor(() => methods(w).includes("$/cancel_request"), 5000);
    await Bun.sleep(500);
    expect(w.events("session_list_request")).toHaveLength(1);
  }, 40000);
});
