// auggie-1x-support, spec tui-agent-session "Harness needs a login" after reopening: Auggie 1.x logged
// out answers `session/load` and `session/resume` with the model `unknown/unknown` and no choices, and
// that fails the start with the login step, from `-c`, `-r <id>` and the session list, with no session
// recorded and no prompt sent. Under a PTY against fake-agent `auggie-1-noauth` with stored sessions.
import { afterEach, describe, expect, test } from "bun:test";
import type { PtySession } from "../pty/harness.ts";
import { listBody, listRows, listWorld, mainText, type ListWorld } from "./list-world.ts";

let session: PtySession | null = null;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = null;
});

const NOW = "2026-11-20T09:00:00.000Z";
const LOGIN = "harness 'auggie' needs you to log in; run auggie auth login in a terminal, then start acp-tui again";
const methods = (w: ListWorld) => w.received("auggie").map((e) => e.method);

/** A world whose `auggie` is fake-agent logged out, holding the stored session `s-1` that the index knows. */
function world(extraArgs: readonly string[] = []): ListWorld {
  const w = listWorld();
  const store = w.sessions("store", [{ sessionId: "s-1", cwd: w.base, title: "Title of s-1", updatedAt: NOW, turns: [{ user: "question", agent: "answer" }] }]);
  w.configure({ auggie: ["--scenario", "auggie-1-noauth", "--sessions", store, ...extraArgs] }, { default_agent_server: "auggie" });
  w.record({ agent: "auggie", sessionId: "s-1", directory: w.base, title: "Title of s-1", at: Date.parse(NOW), harness: { name: "auggie", version: "1.2.2" } });
  return w;
}

/** The session's way in is the one the harness answered, and nothing was left behind. */
function expectNothingKept(w: ListWorld, opened: "session/load" | "session/resume"): void {
  const sent = methods(w);
  expect(sent).toContain(opened);
  expect(sent).not.toContain("session/prompt");
  expect(sent).not.toContain("session/new");
  expect(w.events("prompt_request")).toEqual([]);
  expect(w.index().listAll().map((r) => r.sessionId)).toEqual(["s-1"]);
}

describe.skipIf(process.platform === "win32")("Logged out after reopening (PTY)", () => {
  test("-r <id>: session/load answers the logged-out signature, status 1 with the login step", async () => {
    const w = world();
    session = w.start(["-r", "s-1"], { cols: 220, rows: 30 });
    expect(await session.wait(20000)).toBe(1);
    await session.flush();
    expect(mainText(session).replace(/\s+/g, " ")).toContain(LOGIN);
    expectNothingKept(w, "session/load");
  }, 40000);

  test("-r <id> by session/resume (no loadSession): the same signature fails the start", async () => {
    const w = world(["--resume-only"]);
    session = w.start(["-r", "s-1"], { cols: 220, rows: 30 });
    expect(await session.wait(20000)).toBe(1);
    await session.flush();
    expect(mainText(session).replace(/\s+/g, " ")).toContain(LOGIN);
    expect(methods(w)).not.toContain("session/load");
    expectNothingKept(w, "session/resume");
  }, 40000);

  test("-c: the latest session is loaded and the start fails with the login step", async () => {
    const w = world();
    session = w.start(["-c"], { cols: 220, rows: 30 });
    expect(await session.wait(20000)).toBe(1);
    await session.flush();
    expect(mainText(session).replace(/\s+/g, " ")).toContain(LOGIN);
    expectNothingKept(w, "session/load");
  }, 40000);

  test("the list: choosing the row keeps the list open with the login step in its footer", async () => {
    const w = world();
    session = w.start(["--resume"], { cols: 200, rows: 30 });
    const s = session;
    await s.waitFor(() => listRows(s).length > 0, 15000);
    await s.waitFor(() => listBody(s).some((r) => r.startsWith("Title of s-1")), 15000);
    // Past the "New session with" rows.
    s.sendKeys({ text: "Title of s-1" });
    await s.waitFor(() => listBody(s)[1]?.startsWith("Title of s-1") ?? false, 5000);
    s.sendKeys("Enter");
    await s.waitFor(() => listBody(s).join(" ").replace(/\s+/g, " ").includes(LOGIN), 10000);
    expect(listRows(s).length).toBeGreaterThan(0);
    expectNothingKept(w, "session/load");
  }, 60000);
});
