// auggie-1x-support task group 9, spec tui-sessions "Sessions recorded by another harness
// generation", "Rows of another harness generation muted" and "Older entries that Auggie 1.x
// cannot find", under a PTY against fake-agent: the index's `harness` field decides before
// `session/load` is sent, from the command line and from the list.
import { afterEach, describe, expect, test } from "bun:test";
import type { PtySession } from "../pty/harness.ts";
import { listBody, listRows, listWorld, mainText, type ListWorld } from "./list-world.ts";

let session: PtySession | null = null;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = null;
});

const AUGGIE_1 = ["--scenario", "auggie-1", "--load"];
const AUGGIE_0 = ["--scenario", "basic", "--load", "--agent-info", "auggie@0.37.1 (commit 1a2b3c4d)", "--agent-title", "Auggie Agent"];
const listOpen = (s: PtySession) => listRows(s).length > 0;
const methods = (w: ListWorld) => w.received("auggie").map((e) => e.method);
const NOW = "2026-11-20T09:00:00.000Z";

/** A world whose `auggie` entry runs fake-agent with `agentArgs`, and with `stored` session ids in its store. */
function world(agentArgs: readonly string[], stored: readonly string[] = []): ListWorld {
  const w = listWorld();
  const store = w.sessions(
    "store",
    stored.map((sessionId) => ({ sessionId, cwd: w.base, title: `Title of ${sessionId}`, updatedAt: NOW, turns: [{ user: "question", agent: "answer" }] })),
  );
  w.configure({ auggie: [...agentArgs, "--sessions", store] }, { default_agent_server: "auggie" });
  return w;
}

function recordIn(w: ListWorld, sessionId: string, version: string | null, directory = w.base) {
  w.record({ agent: "auggie", sessionId, directory, title: `Title of ${sessionId}`, at: Date.parse(NOW), ...(version ? { harness: { name: "auggie", version } } : {}) });
}

describe("Sessions recorded by another harness generation (PTY)", () => {
  test("0.x session under 1.x from the command line: no session/load, the advice below the command line, status 1", async () => {
    const w = world(AUGGIE_1);
    recordIn(w, "s-0", "0.36.0 (commit 7c61e5bb)");
    session = w.start(["-r", "s-0"]);
    expect(await session.wait(20000)).toBe(1);
    await session.flush();
    expect(mainText(session)).toContain("session s-0 was recorded with Auggie 0.36.0, and Auggie 1.2.2 cannot open Auggie 0.x sessions; import them in auggie with /import-legacy-sessions (they get new IDs)");
    expect(methods(w)).not.toContain("session/load");
  }, 40000);

  test("1.x session under 0.x: no session/load, the way back", async () => {
    const w = world(AUGGIE_0);
    recordIn(w, "s-1", "1.2.2");
    session = w.start(["-r", "s-1"]);
    expect(await session.wait(20000)).toBe(1);
    await session.flush();
    expect(mainText(session)).toContain("session s-1 was recorded with Auggie 1.2.2, and Auggie 0.37.1 cannot open Auggie 1.x sessions; to use Auggie 1.x again: npm install -g @augmentcode/auggie@latest");
    expect(methods(w)).not.toContain("session/load");
  }, 40000);

  test("--continue refuses the latest session when another generation recorded it", async () => {
    const w = world(AUGGIE_1);
    recordIn(w, "s-0", "0.36.0 (commit 7c61e5bb)");
    session = w.start(["-c"]);
    expect(await session.wait(20000)).toBe(1);
    await session.flush();
    expect(mainText(session)).toContain("cannot open Auggie 0.x sessions");
    expect(methods(w)).not.toContain("session/load");
  }, 40000);

  test("Same generation: session/load is sent for 1.2.0 under 1.2.2", async () => {
    const w = world(AUGGIE_1, ["s-3"]);
    recordIn(w, "s-3", "1.2.0");
    session = w.start(["-r", "s-3"]);
    await session.waitFor("answer", 20000);
    expect(methods(w)).toContain("session/load");
    session.sendKeys("Ctrl+D");
    expect(await session.wait(10000)).toBe(0);
  }, 40000);

  test("Older entry not found: the message names the session, the harness's reason and /import-legacy-sessions", async () => {
    const w = world(AUGGIE_1);
    recordIn(w, "s-2", null);
    session = w.start(["-r", "s-2"]);
    expect(await session.wait(20000)).toBe(1);
    await session.flush();
    const text = mainText(session);
    expect(text).toContain("s-2");
    expect(text).toContain("Internal error: Session s-2 not found (-32603)");
    expect(text).toContain("if it was recorded with Auggie 0.x, import it in auggie with /import-legacy-sessions (it gets a new ID)");
    expect(methods(w)).toContain("session/load");
  }, 40000);

  test("Older entry not found under a harness without a profile: no advice", async () => {
    const w = world(["--scenario", "auggie-1", "--load", "--agent-info", "other@1.2.2"]);
    recordIn(w, "s-2", null);
    session = w.start(["-r", "s-2"]);
    expect(await session.wait(20000)).toBe(1);
    await session.flush();
    expect(mainText(session)).not.toContain("import-legacy-sessions");
  }, 40000);

  test("the session is recorded with the harness's name and version", async () => {
    const w = world(AUGGIE_1, ["s-3"]);
    recordIn(w, "s-3", null);
    session = w.start(["-r", "s-3"]);
    await session.waitFor("answer", 20000);
    expect(w.index().find("s-3").record?.harness).toEqual({ name: "auggie", version: "1.2.2" });
    session.sendKeys("Ctrl+D");
    expect(await session.wait(10000)).toBe(0);
  }, 40000);

  test("Muted in the list: the 0.x row is drawn in muted, the 1.x row is not, and choosing it keeps the list open with the message", async () => {
    const w = world(AUGGIE_1);
    recordIn(w, "s-0", "0.36.0 (commit 7c61e5bb)");
    w.record({ agent: "auggie", sessionId: "s-1", directory: w.base, title: "Title of s-1", at: Date.parse(NOW) - 1000, harness: { name: "auggie", version: "1.2.2" } });
    session = w.start(["--resume"], { cols: 120 });
    const s = session;
    await s.waitFor(() => listOpen(s), 15000);
    // Once the harness has answered `initialize` the row is muted.
    const rowOf = (title: string) => {
      const top = s.screenText().findIndex((r) => r.startsWith("╭─ Sessions"));
      const at = listBody(s).findIndex((r) => r.startsWith(title));
      return at < 0 ? -1 : s.term.buffer.active.baseY + top + 1 + at;
    };
    const fg = (title: string, x: number) => s.cell(rowOf(title), x)?.getFgColor();
    await s.waitFor(() => rowOf("Title of s-0") > 0 && rowOf("Title of s-1") > 0 && fg("Title of s-0", 2) !== fg("Title of s-1", 2), 15000);
    // The other row is selected, so compare the unselected 1.x title with a muted detail: the 0.x title has that colour.
    const detailX = listBody(s)[listBody(s).findIndex((r) => r.startsWith("Title of s-1"))]!.indexOf("auggie") + 3;
    expect(fg("Title of s-0", 2)).toBe(fg("Title of s-0", detailX));
    expect(fg("Title of s-1", 2)).not.toBe(fg("Title of s-1", detailX));
    // Choosing it shows the message and leaves the list open.
    // Past the three "New session with" rows to s-0.
    s.sendKeys("Down", "Down", "Down");
    await s.flush();
    s.sendKeys("Enter");
    await s.waitFor(() => listBody(s).join(" ").replace(/\s+/g, " ").includes("cannot open Auggie 0.x sessions"), 10000);
    expect(listOpen(s)).toBe(true);
    expect(methods(w)).not.toContain("session/load");
  }, 60000);

  test("Muted when the list opens before `initialize`: the rows are muted as soon as the generation is known", async () => {
    const w = world([...AUGGIE_1, "--list", "--start-delay", "1"], ["s-0", "s-1"]);
    recordIn(w, "s-0", "0.36.0 (commit 7c61e5bb)");
    w.record({ agent: "auggie", sessionId: "s-1", directory: w.base, title: "Title of s-1", at: Date.parse(NOW) - 1000, harness: { name: "auggie", version: "1.2.2" } });
    const s = (session = w.start(["--resume"], { cols: 120 }));
    await s.waitFor(() => listOpen(s), 15000);
    const rowOf = (title: string) => {
      const top = s.screenText().findIndex((r) => r.startsWith("╭─ Sessions"));
      const at = listBody(s).findIndex((r) => r.startsWith(title));
      return at < 0 ? -1 : s.term.buffer.active.baseY + top + 1 + at;
    };
    const fg = (title: string, x: number) => s.cell(rowOf(title), x)?.getFgColor();
    const detailX = () => listBody(s)[listBody(s).findIndex((r) => r.startsWith("Title of s-1"))]!.indexOf("auggie") + 3;
    await s.waitFor(() => rowOf("Title of s-0") > 0 && rowOf("Title of s-1") > 0, 15000);
    // Whether the harness has answered by now depends on the machine (on Windows CI it already has),
    // so nothing is asserted about the rows before the generation is known.
    await s.waitFor(() => fg("Title of s-0", 2) === fg("Title of s-0", detailX()), 15000);
    expect(fg("Title of s-1", 2)).not.toBe(fg("Title of s-1", detailX()));
  }, 60000);
});
