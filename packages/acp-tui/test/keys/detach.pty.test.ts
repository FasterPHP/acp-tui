// Ctrl+D always detaches (spec tui-keymap "Detach and prompt box editing keys", "No single
// keypress exits"; tui-layout "Detach hint with a draft"): whatever the prompt box holds and
// wherever focus is (the prompt box, the `@` file picker, the command palette, the session list,
// key help), idle at once and during a turn on a second press within 2 s; Delete deletes forward.
// Detach sends neither session/cancel nor session/close.
import { afterEach, describe, expect, test } from "bun:test";
import type { PtySession } from "../pty/harness.ts";
import { promptText, READY, RUNNING, statusRow } from "../pty/regions.ts";
import { boxRows, startChrome, type ChromeRun } from "../overlay/cli.ts";
import { draft, pickerOpen, PROJECT, tree } from "../overlay/file-picker-helpers.ts";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

const DETACH_CONFIRM = "ctrl+d again to detach and stop the turn";

function start(scenario = "basic", extra: Partial<Parameters<typeof startChrome>[0]> = {}): ChromeRun {
  const run = startChrome({ scenario, cols: 100, rows: 30, ...extra });
  session = run.s;
  return run;
}

function noCancelOrClose(run: ChromeRun): void {
  const sent = run.agent().map((e) => e.method);
  expect(sent).not.toContain("session/cancel");
  expect(sent).not.toContain("session/close");
}

describe("Ctrl+D with a draft", () => {
  test("Ctrl+D with a draft while idle: detaches at once, without cancel or close", async () => {
    const run = start();
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "half a thought" });
    await run.s.waitFor(() => draft(run.s) === "half a thought", 5000);
    run.s.sendKeys("Ctrl+D");
    expect(await run.s.wait(10000)).toBe(0);
    noCancelOrClose(run);
  }, 30000);

  test("Draft not edited by Ctrl+D: with the cursor before `b`, Ctrl+D detaches and the logged effect is a detach", async () => {
    const run = start();
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "abc" }, "Left", "Left");
    await run.s.waitFor(() => draft(run.s) === "abc", 5000);
    await Bun.sleep(100);
    run.s.sendKeys("Ctrl+D");
    expect(await run.s.wait(10000)).toBe(0);
    expect(run.events("exit_effect").map((e) => e["effect"])).toEqual(["detach"]);
    // The screen the last frames drew still held the whole draft: nothing was deleted forward.
    expect(run.s.rawOutput()).not.toMatch(/│ ac\s/);
  }, 30000);

  test("Delete deletes forward: `abc` with the cursor before `b` reads `ac` and acp-tui stays open", async () => {
    const run = start();
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "abc" }, "Left", "Left");
    await Bun.sleep(100);
    run.s.sendKeys("Delete");
    await run.s.waitFor(() => promptText(run.s)[0] === "ac", 5000);
    await Bun.sleep(200);
    expect(run.s.exitCode).toBeNull();
  }, 30000);

  test("Detach during a turn with a draft: the first press arms without changing the draft, the second detaches", async () => {
    const run = start("basic", { delayScale: 1000 });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor(RUNNING, 5000);
    run.s.sendKeys({ text: "next step" });
    await run.s.waitFor(() => promptText(run.s)[0] === "next step", 5000);
    run.s.sendKeys("Ctrl+D");
    await run.s.waitFor((p) => statusRow(p).includes(DETACH_CONFIRM), 5000);
    expect(run.s.exitCode).toBeNull();
    expect(promptText(run.s)[0]).toBe("next step");
    run.s.sendKeys("Ctrl+D");
    expect(await run.s.wait(10000)).toBe(0);
    noCancelOrClose(run);
  }, 30000);

  test("Detach hint with a draft: the status row keeps `ctrl+d detach` while the prompt box holds text", async () => {
    const run = start();
    await run.s.waitFor(READY, 10000);
    expect(statusRow(run.s)).toContain("ctrl+d detach");
    run.s.sendKeys({ text: "abc" });
    await run.s.waitFor(() => draft(run.s) === "abc", 5000);
    await run.s.flush();
    expect(statusRow(run.s)).toContain("ctrl+d detach");
    expect(statusRow(run.s)).not.toContain("? help");
  }, 30000);
});

describe("Ctrl+D from the file picker and the overlays", () => {
  test("From the file picker: `see @src/ma` with the picker open, Ctrl+D detaches", async () => {
    const run = start("basic", { cwd: tree(PROJECT) });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "see @src/ma" });
    await run.s.waitFor(() => pickerOpen(run.s), 5000);
    run.s.sendKeys("Ctrl+D");
    expect(await run.s.wait(10000)).toBe(0);
    noCancelOrClose(run);
  }, 30000);

  test("From an overlay: the command palette with the filter `mod`, the session list and key help each detach", async () => {
    // The palette, with a filter that must not end up in the draft.
    const palette = start();
    await palette.s.waitFor(READY, 10000);
    palette.s.sendKeys("Ctrl+P");
    await palette.s.waitFor(/Commands \d+/, 5000);
    palette.s.sendKeys({ text: "mod" });
    await palette.s.waitFor(() => boxRows(palette.s, "Commands").some((r) => r.includes("mod")), 5000);
    palette.s.sendKeys("Ctrl+D");
    expect(await palette.s.wait(10000)).toBe(0);
    noCancelOrClose(palette);
    await palette.s.dispose();

    // The session list, opened with `/sessions`.
    const list = start();
    await list.s.waitFor(READY, 10000);
    list.s.sendKeys({ text: "/" });
    await list.s.waitFor(/Slash commands \d+/, 5000);
    list.s.sendKeys({ text: "sessions" });
    await list.s.waitFor(/Slash commands 1 /, 5000);
    list.s.sendKeys("Enter");
    await list.s.waitFor(() => boxRows(list.s, /Sessions in /).length > 0, 5000);
    list.s.sendKeys("Ctrl+D");
    expect(await list.s.wait(10000)).toBe(0);
    noCancelOrClose(list);
    await list.s.dispose();

    // Key help.
    const help = start();
    await help.s.waitFor(READY, 10000);
    help.s.sendKeys("F1");
    await help.s.waitFor(/Keys \d+/, 5000);
    help.s.sendKeys("Ctrl+D");
    expect(await help.s.wait(10000)).toBe(0);
    noCancelOrClose(help);
  }, 60000);
});
