// The prompt box's cursor under the real CLI (day-two-feedback tasks 7.1 to 7.3; specs tui-layout
// "Prompt box cursor" and "The focused window can be told apart", tui-config "Prompt cursor
// setting", tui-screen "Cursor shape restored"): the last DECSCUSR (`CSI n SP q`) acp-tui wrote,
// read from the raw output, as it follows the setting, the cursor's place in the text, a reload,
// the terminal's focus reports and every exit path. 1 is OpenTUI's blinking block (the shape
// before `prompt.cursor`), 5 a blinking bar and 0 the terminal's default.
//
// The timing tests of this file are in prompt-cursor.pty.timing.test.ts (parallel-tests: they run in the serial pass).
import { afterEach, describe, expect, test } from "bun:test";
import { type PtySession } from "../pty/harness.ts";
import { configHome } from "../pty/config-home.ts";
import { promptText, READY } from "../pty/regions.ts";
import { LEFT, FOCUS_IN, FOCUS_OUT, F12, start, shapes, lastShape, shapeIs, typed, disposeSession } from "./prompt-cursor-helpers.ts";

afterEach(disposeSession);

describe("Prompt box cursor (task 7.1)", () => {
  test("Block at the end by default: a block after the text, a bar inside it", async () => {
    const s = start();
    await typed(s, "hello world");
    await s.waitFor(shapeIs("1"), 5000);
    s.sendKeys({ text: LEFT });
    await s.waitFor(shapeIs("5"), 5000);
    // And back: the End key moves the cursor to the end of the text.
    s.sendKeys("End");
    await s.waitFor(shapeIs("1"), 5000);
  }, 30000);

  test("Bar everywhere: a bar at the end of the text as inside it", async () => {
    const s = start({ config: configHome({ density: "compact", prompt: { cursor: "bar" } }) });
    await typed(s, "hello");
    await s.waitFor(shapeIs("5"), 5000);
    expect(shapes(s)).not.toContain("1");
    s.sendKeys({ text: LEFT });
    await Bun.sleep(300);
    expect(lastShape(s)).toBe("5");
  }, 30000);

  test("Block everywhere", async () => {
    const s = start({ config: configHome({ density: "compact", prompt: { cursor: "block" } }) });
    await typed(s, "hello");
    s.sendKeys({ text: LEFT });
    await Bun.sleep(300);
    expect(lastShape(s)).toBe("1");
    expect(shapes(s)).not.toContain("5");
  }, 30000);
});

/** The screen row and first column of the prompt box's `text` (its first row). */
function where(s: PtySession, text: string): { y: number; x: number } {
  const y = s.screenText().findIndex((l) => l.startsWith("│ ") && l.includes(text));
  if (y < 0) throw new Error(`no prompt row with ${JSON.stringify(text)}\n${s.screenText().join("\n")}`);
  return { y, x: s.screenText()[y]!.indexOf(text) };
}

describe("The shape follows every cursor move (task 12.1)", () => {
  test("A click into the text makes a bar, a click after the end a block", async () => {
    const s = start();
    await typed(s, "hello world");
    await s.waitFor(shapeIs("1"), 5000);
    const { y, x } = where(s, "hello world");
    s.mouseClick(x + 5, y);
    await s.waitFor(shapeIs("5"), 5000);
    s.mouseClick(x + 40, y);
    await s.waitFor(shapeIs("1"), 5000);
  }, 30000);

  test("A drag from the end into the text makes a bar", async () => {
    const s = start();
    await typed(s, "hello world");
    await s.waitFor(shapeIs("1"), 5000);
    const { y, x } = where(s, "hello world");
    s.mousePress(x + 11, y);
    for (let i = 10; i >= 6; i--) {
      s.mouseMove(x + i, y, "left");
      await Bun.sleep(15);
    }
    s.mouseRelease(x + 6, y);
    await s.waitFor(shapeIs("5"), 5000);
  }, 30000);

  test("Undo and redo: the shape follows where the cursor lands", async () => {
    const s = start();
    await typed(s, "hello world");
    await s.waitFor(shapeIs("1"), 5000);
    // Deleting in the middle leaves the cursor inside the text (a bar); undoing the deletion
    // restores the text with the cursor back where the deletion was, still inside.
    s.sendKeys({ text: LEFT.repeat(5) });
    await s.waitFor(shapeIs("5"), 5000);
    s.sendKeys("Backspace");
    await s.waitFor((p) => promptText(p)[0] === "helloworld", 5000);
    await Bun.sleep(1200);
    s.sendKeys({ text: "\x1a" });
    await s.waitFor((p) => promptText(p)[0] === "hello world", 5000);
    await s.waitFor(shapeIs("5"), 5000);
    // Redo takes the space out again: still inside the text.
    s.sendKeys({ text: "\x19" });
    await s.waitFor((p) => promptText(p)[0] === "helloworld", 5000);
    await Bun.sleep(300);
    expect(lastShape(s)).toBe("5");
  }, 30000);
});

describe("Cursor shape restored (task 7.2)", () => {
  /** The last shape is 0 and comes after the last bar (and every other shape). */
  function expectDefaultLast(s: PtySession): void {
    const all = shapes(s);
    expect(all.at(-1)).toBe("0");
    expect(all).toContain("5");
    expect(all.lastIndexOf("5")).toBeLessThan(all.length - 1);
  }

  for (const terminal of ["xterm", "jediterm"] as const) {
    test(`Ctrl+D (${terminal})`, async () => {
      const s = start({ config: configHome({ density: "compact", prompt: { cursor: "bar" } }), terminal });
      await s.waitFor(READY, 10000);
      await s.waitFor(shapeIs("5"), 5000);
      s.sendKeys("Ctrl+D");
      expect(await s.wait(10000)).toBe(0);
      expectDefaultLast(s);
    }, 30000);
  }

  test("SIGTERM", async () => {
    const s = start({ config: configHome({ density: "compact", prompt: { cursor: "bar" } }) });
    await s.waitFor(READY, 10000);
    await s.waitFor(shapeIs("5"), 5000);
    s.kill("SIGTERM");
    expect(await s.wait(10000)).toBe(143);
    expectDefaultLast(s);
  }, 30000);

  test("Uncaught error (ACP_TUI_TEST_HOOKS=crash)", async () => {
    const s = start({ config: configHome({ density: "compact", prompt: { cursor: "bar" } }), env: { ACP_TUI_TEST_HOOKS: "crash" } });
    await s.waitFor(READY, 10000);
    await s.waitFor(shapeIs("5"), 5000);
    s.sendKeys({ text: F12 });
    expect(await s.wait(10000)).toBe(1);
    expectDefaultLast(s);
  }, 30000);
});

describe("The focused window can be told apart (task 7.3)", () => {
  test("Focus lost in a reporting terminal: the default shape on CSI O, the bar again on CSI I", async () => {
    const s = start();
    await typed(s, "hello");
    s.sendKeys({ text: LEFT });
    await s.waitFor(shapeIs("5"), 5000);
    s.sendKeys({ text: FOCUS_OUT });
    await s.waitFor(shapeIs("0"), 5000);
    s.sendKeys({ text: FOCUS_IN });
    await s.waitFor(shapeIs("5"), 5000);
  }, 30000);

  test("At the end of the text the block comes back on CSI I", async () => {
    const s = start();
    await typed(s, "hello");
    await s.waitFor(shapeIs("1"), 5000);
    s.sendKeys({ text: FOCUS_OUT });
    await s.waitFor(shapeIs("0"), 5000);
    s.sendKeys({ text: FOCUS_IN });
    await s.waitFor(shapeIs("1"), 5000);
  }, 30000);

  test("A terminal that never reports focus: no default shape is written, and the cursor at the end is a block", async () => {
    const s = start();
    await typed(s, "hello");
    await s.waitFor(shapeIs("1"), 5000);
    await Bun.sleep(300);
    expect(shapes(s)).not.toContain("0");
    expect(lastShape(s)).toBe("1");
  }, 30000);

  test("A focus-in report with no loss before it writes nothing", async () => {
    const s = start();
    await typed(s, "hello");
    await s.waitFor(shapeIs("1"), 5000);
    const before = shapes(s).length;
    s.sendKeys({ text: FOCUS_IN });
    await Bun.sleep(300);
    expect(shapes(s)).toHaveLength(before);
  }, 30000);
});
