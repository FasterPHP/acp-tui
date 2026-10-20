// mvp-chrome-and-keys task 4.7 (spec tui-layout "Splash screen"; design D2):
// the real CLI against fake-agent under the PTY harness. The splash fills the
// conversation's 12 rows at 63x21 (and 61x20, task 12.3) with the wordmark, the graphic, the agent,
// model and `cwd`, and the hints that are not in the status row; it keeps the
// hints at 50x14; it is gone with the first prompt; and a hostile agent name
// reaches the terminal as its printable characters only. `test/pty/safe-sgr.test.ts`
// runs every scenario from its first frame, so it scans the splash too.
import { afterEach, describe, expect, test } from "bun:test";
import type { PtySession } from "../pty/harness.ts";
import { promptText, READY } from "../pty/regions.ts";
import { startCli } from "../keys/cli-pty.ts";
import { listWorld } from "../session/list-world.ts";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

/** The conversation's rows at 63x21: rows 2 to 13. */
const conversation = (s: PtySession): string[] => s.screenText().slice(1, 13);

describe("splash screen (task 4.7)", () => {
  test("new session at IDE-pane size: the wordmark, the graphic, fake-agent, the model, the cwd, Enter, Shift+Enter, /, @, Esc Esc and Ctrl+D, centred in the conversation's 12 rows", async () => {
    const run = startCli("config-options", 0, { cols: 63, rows: 21 });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    await run.s.waitFor((p) => conversation(p).join("\n").includes("Fake Aurora"), 5000);
    const rows = conversation(run.s);
    const all = rows.join("\n");
    for (const part of ["┏━┓ ┏━╸ ┏━┓", "IDE · terminal ━→ acp-tui ━→ claude · codex · opencode · …", "fake-agent", "Fake Aurora", "acp-tui-keys-", "enter send", "shift+enter newline", "/ commands", "@ files", "? help", "esc esc interrupt", "ctrl+d detach"]) {
      expect(all).toContain(part);
    }
    // Centred: the rows used sit in the middle of the 12, each row centred in 63 columns.
    const used = rows.map((r, i) => (r.trim() === "" ? -1 : i)).filter((i) => i >= 0);
    const above = used[0]!;
    const below = rows.length - 1 - used.at(-1)!;
    expect(Math.abs(above - below)).toBeLessThanOrEqual(1);
    const graphic = rows.find((r) => r.includes("IDE · terminal"))!;
    const left = graphic.length - graphic.trimStart().length;
    const right = 63 - graphic.length;
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
    // The status row no longer carries the send and newline keys.
    expect(run.s.screenText()[19]).not.toContain("enter");
  }, 20000);

  test("Marcus's narrower pane (task 12.3, task 13.2): at 61x20 the conversation has 11 rows (the activity line keeps its row), so the splash keeps the wordmark, identity and hints and drops the graphic (the chain and the tagline) first", async () => {
    const run = startCli("config-options", 0, { cols: 61, rows: 20 });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    await run.s.waitFor((p) => p.screenText().slice(1, 12).join("\n").includes("Fake Aurora"), 5000);
    const rows = run.s.screenText().slice(1, 12);
    const all = rows.join("\n");
    for (const part of ["┏━┓ ┏━╸ ┏━┓", "fake-agent", "Fake Aurora", "/ commands", "? help", "ctrl+d detach"]) {
      expect(all).toContain(part);
    }
    expect(all).not.toContain("IDE · terminal");
    expect(all).not.toContain("clear · concise");
    expect(all).not.toContain("PhpStorm");
  }, 20000);

  test("tiny pane: at 50x14 the hints without the graphic, nothing cut mid-word", async () => {
    const run = startCli("config-options", 0, { cols: 50, rows: 14 });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    await run.s.waitFor((p) => p.screenText().join("\n").includes("ctrl+d detach"), 5000);
    const all = run.s.screenText().slice(1, 8).join("\n");
    expect(all).not.toContain("IDE · terminal");
    for (const hint of ["enter send", "shift+enter newline", "/ commands", "@ files", "esc esc interrupt", "ctrl+d detach"]) expect(all).toContain(hint);
    expect(all).not.toContain("…");
  }, 20000);

  test("first prompt: the splash is gone and the user's message is the first item", async () => {
    // delay-scale 1000: the turn's first step waits 5 s, so the user's message is all there is.
    const run = startCli("basic", 1000, { cols: 63, rows: 21 });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    await run.s.waitFor((p) => p.screenText().join("\n").includes("esc esc interrupt"), 5000);
    run.s.sendKeys({ text: "hello splash" });
    await run.s.waitFor((p) => promptText(p)[0] === "hello splash", 5000);
    run.s.sendKeys("Enter");
    await run.s.waitFor((p) => !p.screenText().join("\n").includes("IDE · terminal"), 5000);
    await run.s.waitFor((p) => p.screenText().slice(1, 13).some((row) => row.includes("hello splash")), 5000);
    const conversation = run.s.screenText().slice(1, 13);
    expect(conversation.join("\n")).not.toContain("┏━┓ ┏━╸");
    expect(conversation.join("\n")).not.toContain("shift+enter newline");
    // The user's message is the first item: nothing above it.
    const first = conversation.findIndex((row) => row.trim() !== "");
    expect(conversation[first]).toContain("hello splash");
  }, 20000);

  test("hostile agent name: the splash shows the name's printable characters and the terminal receives no part of the OSC 8 sequence", async () => {
    const run = startCli("hostile", 0, { cols: 63, rows: 21 });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    // The name (`agentInfo.title` here, which the view prefers) starts with its label, then the
    // payloads, each followed by its tag.
    await run.s.waitFor((p) => p.screenText().join("\n").includes("agentInfo.title"), 5000);
    const raw = run.s.rawOutput();
    expect(raw).not.toContain("\u001b]8;;https://evil.example");
    expect(raw).not.toContain("evil.example/phish");
    expect(raw).not.toContain("\u001b]52;");
    expect(raw).not.toContain("\u001b]0;pwned");
  }, 20000);

  test("tagline: the graphic's second row reads `clear · concise · fast · customisable` and no row names the palette", async () => {
    const run = startCli("config-options", 0, { cols: 100, rows: 30 });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    await run.s.waitFor((p) => p.screenText().join("\n").includes("Fake Aurora"), 5000);
    const rows = run.s.screenText();
    const graphic = rows.findIndex((r) => r.includes("IDE · terminal"));
    expect(rows[graphic + 1]!.trim()).toBe("clear · concise · fast · customisable");
    expect(rows.slice(0, 22).join("\n")).not.toContain("palette");
  }, 20000);
});

/** A splash run with fake-agent as the harness `fake`, held back by `--start-delay`. */
function connecting(delayMs: number) {
  const w = listWorld();
  const repo = w.dir("repo");
  w.configure({ fake: ["--scenario", "basic", "--start-delay", String(delayMs)] });
  const s = w.start(["-a", "fake"], { cwd: repo, cols: 100, rows: 30 });
  session = s;
  return { w, s, repo };
}

describe("splash while the harness starts (day-two-feedback task group 2)", () => {
  test("Connecting: `Harness: fake` and `connecting…` on one row and the directory on the next; two screens 300 ms apart differ only in the spinner's cell", async () => {
    const { s, repo } = connecting(2500);
    await s.waitFor((p) => p.screenText().join("\n").includes("connecting…"), 10000);
    const rows = () => s.screenText();
    const at = rows().findIndex((r) => r.includes("connecting…"));
    expect(rows()[at]!.trim()).toMatch(/^Harness: fake · \S connecting…$/);
    expect(rows()[at + 1]!.trim()).toBe(repo);
    // Sample for a second: the spinner turns and nothing else on the screen changes.
    const seen: string[][] = [rows()];
    const stop = Date.now() + 1000;
    while (Date.now() < stop) {
      await Bun.sleep(100);
      await s.flush();
      seen.push(rows());
    }
    const cell = rows()[at]!.indexOf("connecting…") - 2;
    const without = (screen: string[]) => screen.map((r, y) => (y === at ? r.slice(0, cell) + r.slice(cell + 1) : r));
    const distinct = new Set(seen.map((screen) => screen[at]!.slice(cell, cell + 1)));
    expect(distinct.size).toBeGreaterThan(1);
    for (const screen of seen) {
      expect(without(screen)).toEqual(without(seen[0]!));
    }
  }, 30000);

  test("Nothing moves when the session starts: every splash row is on the same screen row before and after", async () => {
    const { s } = connecting(1500);
    await s.waitFor((p) => p.screenText().join("\n").includes("connecting…"), 10000);
    const before = s.screenText();
    await s.waitFor((p) => p.screenText().join("\n").includes("fake-agent"), 10000);
    await s.waitFor(READY, 5000);
    const after = s.screenText();
    const at = before.findIndex((r) => r.includes("connecting…"));
    // The first identity row now reads the agent's reported name, on the same screen row.
    expect(after[at]!.trim()).toBe("Harness: fake-agent");
    // The directory row below it, and every other row of the conversation region (the status row
    // and the prompt box's border differ), are where they were.
    for (let y = 1; y < 22; y++) {
      if (y === at) continue;
      expect([y, after[y]]).toEqual([y, before[y]]);
    }
  }, 30000);
});
