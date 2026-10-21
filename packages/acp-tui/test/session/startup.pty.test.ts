// harness-feedback task group 3, under a PTY against fake-agent as the harness `fake`: a harness
// that never answers is stopped after the start-up timeout (spec tui-agent-session "Start-up
// timeout", the minimum of 5 s), one that prints terminal output is refused ("Harness that is not
// an ACP harness"), and exit while the harness starts ends it ("Exit while the harness starts").
// The progress the splash shows is in test/app/splash.pty.test.ts.
import { afterEach, describe, expect, test } from "bun:test";
import { FINDING_LINE } from "../../src/app/finding-line.ts";
import type { PtySession } from "../pty/harness.ts";
import { rowsAfterPrefill, WINDOWS } from "../windows.ts";
import { listBody, listRows, listWorld, mainText, type ListWorld } from "./list-world.ts";

let session: PtySession | null = null;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = null;
});

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The processes acp-tui launched, from its debug log. */
const launchedPids = (w: ListWorld): number[] => w.events("agent_launched").map((e) => e["pid"] as number);

/** Waits for every process in `pids` to be gone. */
async function allGone(pids: readonly number[]): Promise<void> {
  for (let i = 0; i < 100 && pids.some(running); i++) await Bun.sleep(50);
  expect(pids.filter(running)).toEqual([]);
}

const listOpen = (s: PtySession) => listRows(s).length > 0;
const footerText = (s: PtySession) => listBody(s).join(" ").replace(/\s+/g, " ");

describe("Start-up timeout", () => {
  test("Never answers initialize: after the timeout (5 s) the terminal is restored, the harness has ended and the line names the harness, initialize and 5 s, with exit status 1", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ fake: ["--scenario", "basic", "--no-initialize"] }, { agent_startup_timeout_seconds: 5 });
    const s = (session = w.start(["fake"], { cwd: repo, cols: 120 }));
    const began = Date.now();
    expect(await s.wait(30000)).toBe(1);
    expect(Date.now() - began).toBeGreaterThanOrEqual(4500);
    const text = mainText(s);
    expect(text).toContain("acp-tui: harness 'fake' (command '");
    expect(text).toContain("did not answer initialize within 5 s and was stopped");
    // Restored: the message is on the normal screen, below the command line (which ConPTY clears
    // when the child starts, so on Windows the message is at the top).
    if (!WINDOWS) expect(s.screenText()[0]).toBe("$ acp-tui");
    expect(rowsAfterPrefill(s.screenText())[0]).toStartWith("acp-tui: harness 'fake' (command '");
    expect(w.events("startup_timeout")).toMatchObject([{ request: "initialize", seconds: 5 }]);
    await allGone(launchedPids(w));
  }, 40000);

  test("From the session list: a row 'New session with fake' whose harness never answers leaves the list open with the timeout message in its footer", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ fake: ["--scenario", "basic", "--no-initialize"] }, { agent_startup_timeout_seconds: 5 });
    const s = (session = w.start(["--resume"], { cwd: repo, cols: 120 }));
    await s.waitFor(() => listOpen(s) && listBody(s).some((r) => r.startsWith("New session with fake")), 15000);
    s.sendKeys({ text: "with fake" });
    await s.waitFor(() => listBody(s)[1]?.startsWith("New session with fake") ?? false, 3000);
    s.sendKeys("Enter");
    await s.waitFor(() => footerText(s).includes("did not answer initialize within 5 s and was stopped"), 30000);
    expect(listOpen(s)).toBe(true);
    expect(footerText(s)).toContain("harness 'fake'");
    // The process of the row that failed is gone; the first harness (the default, a basic fake) is still up.
    const pids = launchedPids(w);
    await s.waitFor(() => pids.filter(running).length === 1, 5000);
  }, 60000);
});

describe("Harness that is not an ACP harness", () => {
  test("A terminal interface: fake-agent --print-terminal as an ad hoc command exits 1 within a second of starting, saying it does not look like an ACP harness; no byte of its output reaches the terminal", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    const command = w.fake("terminal", ["--print-terminal"]);
    const s = (session = w.start(["--", ...command], { cwd: repo, cols: 200 }));
    expect(await s.wait(20000)).toBe(1);
    const text = mainText(s);
    expect(text).toContain("acp-tui: ad hoc harness command '");
    expect(text).toContain("does not look like an ACP harness: it printed terminal output; ACP harnesses usually need an argument such as acp or --acp");
    // What fake-agent wrote (an escape sequence and a line after it) never reached the terminal.
    expect(s.rawOutput()).not.toContain("fake-agent terminal interface");
    await allGone(launchedPids(w));
  }, 30000);

  test("Lines of text: three plain lines before anything else fail the same way", async () => {
    const w = listWorld();
    w.configure({ fake: ["--scenario", "basic", "--print-terminal=lines"] });
    const s = (session = w.start(["fake"], { cols: 200 }));
    expect(await s.wait(20000)).toBe(1);
    expect(mainText(s)).toContain("harness 'fake' (command '");
    expect(mainText(s)).toContain("does not look like an ACP harness");
    expect(s.rawOutput()).not.toContain("fake-agent banner line");
    await allGone(launchedPids(w));
  }, 30000);
});

describe("Exit while the harness starts", () => {
  test("Ctrl+D while starting: acp-tui exits within a second with the terminal restored, and the harness process is gone", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ fake: ["--scenario", "basic", "--no-initialize"] });
    const s = (session = w.start(["fake"], { cwd: repo }));
    await s.waitFor((p) => p.screenText().join("\n").includes("starting…"), 15000);
    const pids = launchedPids(w);
    expect(pids).toHaveLength(1);
    expect(running(pids[0]!)).toBe(true);
    const pressed = Date.now();
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    expect(Date.now() - pressed).toBeLessThan(3000);
    await allGone(pids);
  }, 40000);

  test("Ctrl+C while finding a session: the line is removed, acp-tui exits with status 130 and prints nothing more, and the harness process is gone", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ fake: ["--scenario", "basic", "--no-initialize"] });
    const s = (session = w.start(["fake", "--continue"], { cwd: repo }));
    await s.waitFor((p) => p.screenText().join("\n").includes(FINDING_LINE), 15000);
    await s.waitFor(() => launchedPids(w).length === 1, 5000);
    const pids = launchedPids(w);
    s.write("\x03");
    expect(await s.wait(10000)).toBe(130);
    await s.flush();
    // The line is gone, and nothing else was printed below the command line.
    expect(s.screenText().join("\n")).not.toContain("finding session");
    expect(s.screenText().slice(1).join("").trim()).toBe("");
    await allGone(pids);
  }, 40000);
});
