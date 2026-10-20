// mvp-chrome-and-keys tasks 3.2 and 12.2 (spec tui-keymap "Paste from the clipboard";
// design D11): Ctrl+V (`paste`, prompt context) reads text from the host
// clipboard through OpenTUI's clipboard `read` and inserts it at the prompt
// box's cursor as a bracketed paste would; an image or no clipboard gives a
// notice and leaves the draft alone; the terminal's own bracketed paste keeps
// working and reads nothing. The real CLI against fake-agent under the PTY
// harness. The host clipboard is never the user's: either a stub
// (test/keys/cli-with-keymap.ts, ACP_TUI_TEST_CLIPBOARD) or no display at all.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bracketedPaste, type PtySession } from "../pty/harness.ts";
import { promptText, READY } from "../pty/regions.ts";
import { startCli, tempDir } from "./cli-pty.ts";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

const WITH_STUBS = join(import.meta.dir, "cli-with-keymap.ts");
const CTRL_V = { text: "\x16" };
const NO_DISPLAY = { WAYLAND_DISPLAY: undefined, DISPLAY: undefined };
const ZED = { ...NO_DISPLAY, TERM_PROGRAM: "zed", TERMINAL_EMULATOR: undefined };
const JEDITERM = { ...NO_DISPLAY, TERMINAL_EMULATOR: "JetBrains-JediTerm", TERM_PROGRAM: undefined };

/** Starts the CLI with a stubbed host clipboard; returns the run and the stub's read log. */
function withClipboard(spec: { text?: string; image?: string }, env: Record<string, string | undefined>) {
  const log = join(tempDir(), "clipboard.log");
  const run = startCli("basic", 0, { entry: WITH_STUBS, env: { ...env, ACP_TUI_TEST_CLIPBOARD: JSON.stringify(spec), ACP_TUI_TEST_CLIPBOARD_LOG: log } });
  const reads = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : []);
  return { run, reads };
}

describe("Paste from the clipboard (task 3.2)", () => {
  test("Zed: with two lines on the clipboard, Ctrl+V (0x16) inserts them at the cursor and sends nothing", async () => {
    const { run, reads } = withClipboard({ text: "one\ntwo" }, ZED);
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "xy" }, "Left");
    await run.s.waitFor((p) => promptText(p)[0] === "xy", 5000);
    run.s.sendKeys(CTRL_V);
    await run.s.waitFor((p) => promptText(p).join("|") === "xone|twoy", 5000);
    expect(reads()).toHaveLength(1);
    expect(JSON.parse(reads()[0]!).preferredTypes[0]).toBe("text/plain");
    await Bun.sleep(300);
    expect(run.methods()).toEqual(["initialize", "session/new"]);
    // The cursor sits after the pasted text.
    run.s.sendKeys({ text: "Z" });
    await run.s.waitFor((p) => promptText(p).join("|") === "xone|twoZy", 5000);
  }, 20000);

  test("No clipboard: without WAYLAND_DISPLAY or DISPLAY, Ctrl+V shows a notice that suggests the terminal's paste and leaves the draft unchanged", async () => {
    const run = startCli("basic", 0, { env: NO_DISPLAY });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "draft" });
    await run.s.waitFor((p) => promptText(p)[0] === "draft", 5000);
    run.s.sendKeys(CTRL_V);
    await run.s.waitFor((p) => /no clipboard could be read/.test(p.screenText().join("\n")), 5000);
    expect(run.s.screenText().join("\n")).toContain("terminal's paste");
    expect(promptText(run.s)).toEqual(["draft"]);
    expect(run.methods()).toEqual(["initialize", "session/new"]);
  }, 20000);

  test("An image on the clipboard: a notice says image paste is not supported yet, the draft is unchanged", async () => {
    const { run } = withClipboard({ image: "image/png" }, ZED);
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "d" });
    await run.s.waitFor((p) => promptText(p)[0] === "d", 5000);
    run.s.sendKeys(CTRL_V);
    await run.s.waitFor((p) => /image paste is not supported yet/.test(p.screenText().join("\n")), 5000);
    expect(promptText(run.s)).toEqual(["d"]);
  }, 20000);

  // Task 12.2: Ctrl+Shift+V is the reader's named key (kitty-protocol terminals send it as
  // CSI 118;6u; in the legacy encoding it is Ctrl+V's 0x16), and Alt+V (ESC v) its route in
  // PhpStorm and Zed, which keep Ctrl+Shift+V (and PhpStorm Ctrl+V).
  for (const [name, bytes, env] of [
    ["ctrl+shift+v in the kitty encoding: CSI 118;6u", "\x1b[118;6u", ZED],
    ["alt+v where the IDE keeps both: ESC v under JediTerm's environment", "\x1bv", JEDITERM],
    ["alt+v where the IDE keeps both: ESC v under Zed's environment", "\x1bv", ZED],
  ] as const) {
    test(`${name} reads the stubbed host clipboard and inserts it at the cursor, sending nothing`, async () => {
      const { run, reads } = withClipboard({ text: "one\ntwo" }, env);
      session = run.s;
      await run.s.waitFor(READY, 10000);
      run.s.sendKeys({ text: "xy" }, "Left");
      await run.s.waitFor((p) => promptText(p)[0] === "xy", 5000);
      run.s.write(bytes);
      await run.s.waitFor((p) => promptText(p).join("|") === "xone|twoy", 5000);
      expect(reads()).toHaveLength(1);
      await Bun.sleep(300);
      expect(run.methods()).toEqual(["initialize", "session/new"]);
      // Nothing of the key was typed: the draft is the paste alone.
      expect(promptText(run.s).join("|")).toBe("xone|twoy");
    }, 20000);
  }

  // opentui-0-6 task 4.1 (spec tui-layout "Prompt box", "Clipboard with control characters"): the
  // clipboard's text takes the same rule as a bracketed paste.
  test("Clipboard with control characters: x BEL y read with Alt+V shows xy, with no ^ notation", async () => {
    const { run, reads } = withClipboard({ text: "x\u0007y" }, ZED);
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.write("\x1bv");
    await run.s.waitFor((p) => promptText(p)[0] === "xy", 5000);
    expect(reads()).toHaveLength(1);
    expect(run.s.screenText().join("\n")).not.toContain("^G");
    await Bun.sleep(300);
    expect(run.methods()).toEqual(["initialize", "session/new"]);
  }, 20000);

  test("PhpStorm's own paste: one bracketed paste is inserted once, and the clipboard is not read", async () => {
    const { run, reads } = withClipboard({ text: "from the stub" }, JEDITERM);
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.write(bracketedPaste("hello\rworld"));
    await run.s.waitFor((p) => promptText(p).join("|") === "hello|world", 5000);
    await Bun.sleep(300);
    await run.s.flush();
    expect(promptText(run.s)).toEqual(["hello", "world"]);
    expect(reads()).toEqual([]);
    expect(run.methods()).toEqual(["initialize", "session/new"]);
  }, 20000);
});
