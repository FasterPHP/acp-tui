// auggie-1x-support 7.1 and 7.2 under a PTY (spec tui-sessions "Session index": "First prompt
// refused", "Detached during the first turn"; spec tui-screen "Exit text below the command line":
// "Nothing after a refused first prompt"): a session is recorded, and its resume line printed,
// only once the harness has answered a prompt.
import { afterEach, describe, expect, test } from "bun:test";
import type { PtySession } from "../pty/harness.ts";
import { READY } from "../pty/regions.ts";
import { listWorld } from "./list-world.ts";

let session: PtySession | null = null;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = null;
});

const screen = (s: PtySession) => s.screenText().join("\n");

/** The lines written below the command line after the final reset. */
function exitLines(s: PtySession): string[] {
  const raw = s.rawOutput();
  return raw
    .slice(raw.lastIndexOf("\x1b[?1049l"))
    .split(/\r?\n/)
    .map((line) => /(acp-tui: |resume: ).*$/.exec(line)?.[0])
    .filter((line): line is string => line !== undefined);
}

describe("Sessions recorded on the first answered prompt", () => {
  test("First prompt refused, and nothing after it: no index entry and no resume line", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ fake: ["--scenario", "prompt-error", "--load"] }, { default_agent_server: "fake" });
    const s = (session = w.start([], { cwd: repo, cols: 120 }));
    await s.waitFor(READY, 20000);
    s.sendKeys({ text: "hello" }, "Enter");
    await s.waitFor((p) => screen(p).includes("prompt-error scenario always fails"), 10000);
    await s.waitFor(READY, 10000);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    expect(w.index().listAll()).toEqual([]);
    expect(exitLines(s)).toEqual([]);
  }, 60000);

  test("Detached during the first turn: the first update records the session and the resume line is printed", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ fake: ["--scenario", "slow-turn", "--long-gap", "--delay-scale", "1", "--load"] }, { default_agent_server: "fake" });
    const s = (session = w.start([], { cwd: repo, cols: 120 }));
    await s.waitFor(READY, 20000);
    s.sendKeys({ text: "edit it" }, "Enter");
    // The turn has begun (an update arrived) and has not ended: the harness is in a long gap.
    await s.waitFor(() => w.index().listAll().length === 1, 15000);
    expect(screen(s)).not.toContain("end turn");
    // A running turn asks for the key twice.
    s.sendKeys("Ctrl+D");
    await s.waitFor((p) => screen(p).includes("ctrl+d again to detach"), 5000);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    const [entry] = w.index().listAll();
    expect(entry?.sessionId).toBe("fake-session-1");
    expect(exitLines(s)[0]).toStartWith("resume: acp-tui --resume fake-session-1");
  }, 60000);
});
