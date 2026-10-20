// Undo and redo in the prompt box under the real CLI (day-two-feedback task 9.2; spec tui-keymap
// "Undo and redo in the prompt box"): the keys through a PTY, where a chunk of typing reaches the
// textarea key by key before its change events do, a bracketed paste, a cut, a sent prompt, and
// Ctrl+Z, which never suspends acp-tui.
import { afterEach, describe, expect, test } from "bun:test";
import type { PtySession } from "../pty/harness.ts";
import { configEnv } from "../pty/config-home.ts";
import { promptText, READY } from "../pty/regions.ts";
import { sendPrompt, startCli, type CliRun } from "../conversation/cli.ts";
import { localEnv, osc52Payloads } from "../selection/pty.ts";

let run: CliRun | undefined;
afterEach(async () => {
  run?.session.kill("SIGKILL");
  await run?.session.dispose();
  run = undefined;
});

const CTRL_Z = "\x1a";
const CTRL_Y = "\x19";
const CTRL_X = "\x18";
const SHIFT_LEFT = "\x1b[1;2D";

function start(scenario = "basic"): PtySession {
  run = startCli({ scenario, cols: 100, rows: 30, env: { ...configEnv({ density: "compact" }), ...localEnv() } });
  return run.session;
}

const rows = (s: PtySession) => promptText(s).filter((r) => r !== "");

describe("Undo and redo (task 9.2)", () => {
  test("Undo by word: `fix the router` typed in one go, three presses of Ctrl+Z empty it, and Ctrl+Y brings the words back", async () => {
    const s = start();
    await s.waitFor(READY, 10000);
    s.sendKeys({ text: "fix the router" });
    await s.waitFor(() => rows(s)[0] === "fix the router", 5000);
    s.sendKeys({ text: CTRL_Z });
    await s.waitFor(() => rows(s)[0] === "fix the", 5000);
    s.sendKeys({ text: CTRL_Z });
    await s.waitFor(() => rows(s)[0] === "fix", 5000);
    s.sendKeys({ text: CTRL_Z });
    await s.waitFor(() => rows(s).length === 0, 5000);
    // Nothing is left: another press changes nothing.
    s.sendKeys({ text: CTRL_Z });
    await Bun.sleep(300);
    expect(rows(s)).toEqual([]);
    s.sendKeys({ text: CTRL_Y });
    await s.waitFor(() => rows(s)[0] === "fix", 5000);
    s.sendKeys({ text: CTRL_Y + CTRL_Y });
    await s.waitFor(() => rows(s)[0] === "fix the router", 5000);
  }, 30000);

  test("Undo a paste: after `see ` a three-line paste, Ctrl+Z leaves `see ` and Ctrl+Y brings the paste back", async () => {
    const s = start();
    await s.waitFor(READY, 10000);
    s.sendKeys({ text: "see " });
    await s.waitFor(() => rows(s)[0] === "see", 5000);
    s.paste("three\nlines\nhere");
    await s.waitFor(() => rows(s).join("|") === "see three|lines|here", 5000);
    s.sendKeys({ text: CTRL_Z });
    await s.waitFor(() => rows(s).join("|") === "see", 5000);
    s.sendKeys({ text: CTRL_Y });
    await s.waitFor(() => rows(s).join("|") === "see three|lines|here", 5000);
  }, 30000);

  test("Undo a cut: Ctrl+X takes `world` out, Ctrl+Z puts it back", async () => {
    const s = start();
    await s.waitFor(READY, 10000);
    s.sendKeys({ text: "hello world" });
    await s.waitFor(() => rows(s)[0] === "hello world", 5000);
    s.sendKeys({ text: SHIFT_LEFT.repeat(5) });
    await Bun.sleep(200);
    s.sendKeys({ text: CTRL_X });
    await s.waitFor(() => rows(s)[0] === "hello", 5000);
    expect(osc52Payloads(s.rawOutput())).toEqual(["world"]);
    s.sendKeys({ text: CTRL_Z });
    await s.waitFor(() => rows(s)[0] === "hello world", 5000);
  }, 30000);

  test("Undo a run of deletions and a word typed after a pause: a pause of over a second ends a run", async () => {
    const s = start();
    await s.waitFor(READY, 10000);
    s.sendKeys({ text: "abc" });
    await s.waitFor(() => rows(s)[0] === "abc", 5000);
    await Bun.sleep(1200);
    s.sendKeys({ text: "def" });
    await s.waitFor(() => rows(s)[0] === "abcdef", 5000);
    s.sendKeys({ text: CTRL_Z });
    await s.waitFor(() => rows(s)[0] === "abc", 5000);
    s.sendKeys("Backspace");
    s.sendKeys("Backspace");
    await s.waitFor(() => rows(s)[0] === "a", 5000);
    s.sendKeys({ text: CTRL_Z });
    await s.waitFor(() => rows(s)[0] === "abc", 5000);
  }, 30000);

  test("Nothing to undo after sending: the sent prompt does not come back", async () => {
    const s = start("copy-fixtures");
    await sendPrompt(s, "fix the router");
    await s.waitFor("end turn", 10000);
    await s.waitFor(READY, 10000);
    expect(rows(s)).toEqual([]);
    s.sendKeys({ text: CTRL_Z });
    await Bun.sleep(400);
    expect(rows(s)).toEqual([]);
  }, 30000);

  test("Ctrl+Z does not suspend: acp-tui keeps running on the alternate screen and nothing changes", async () => {
    const s = start();
    await s.waitFor(READY, 10000);
    const before = s.screenText();
    s.sendKeys({ text: CTRL_Z });
    await Bun.sleep(500);
    expect(s.exitCode).toBeNull();
    expect(s.term.buffer.active.type).toBe("alternate");
    expect(s.screenText()).toEqual(before);
    // And it is still alive: it takes typing.
    s.sendKeys({ text: "ok" });
    await s.waitFor(() => rows(s)[0] === "ok", 5000);
  }, 30000);

  test("Undo, Redo and Cut are palette entries", async () => {
    const s = start();
    await s.waitFor(READY, 10000);
    // Each entry is found by filtering the palette, whose list is longer than the screen.
    for (const [filter, title] of [["undo", "Undo the last edit"], ["redo", "Redo the edit"], ["cut", "Cut the selection"]] as const) {
      s.sendKeys("Ctrl+P");
      await Bun.sleep(300);
      s.sendKeys({ text: filter });
      await s.waitFor((p) => p.screenText().some((l) => l.includes(title)), 5000);
      s.sendKeys("Esc");
      await s.waitFor((p) => !p.screenText().some((l) => l.includes(title)), 5000);
    }
  }, 30000);

  test("Undo from the palette: the entry runs with the prompt box focused", async () => {
    const s = start();
    await s.waitFor(READY, 10000);
    s.sendKeys({ text: "fix the router" });
    await s.waitFor(() => rows(s)[0] === "fix the router", 5000);
    s.sendKeys("Ctrl+P");
    await Bun.sleep(300);
    s.sendKeys({ text: "Undo" });
    await s.waitFor((p) => p.screenText().some((l) => l.includes("Undo the last edit")), 5000);
    s.sendKeys("Enter");
    await s.waitFor(() => rows(s)[0] === "fix the", 5000);
  }, 30000);
});
