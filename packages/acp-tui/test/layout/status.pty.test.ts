// mvp-chrome-and-keys task 4.6 (spec tui-layout "Bar modules", "Key hints";
// design D5): the status row of the real CLI against fake-agent under the PTY
// harness. The cost (basic reports $0.01) outranks the cwd and the hints at
// IDE-pane width; the density mark; no send or newline hint; the hints of an
// empty prompt box. "Armed detach without a hints module" is in
// test/layout/screen.pty.test.ts ("armed detach without a hints module"), and
// `loading N` in test/session/ (mvp-sessions).
import { afterEach, describe, expect, test } from "bun:test";
import type { PtySession } from "../pty/harness.ts";
import { CARD_HEADER, promptText, READY, statusRow } from "../pty/regions.ts";
import { startCli, type CliRun } from "../keys/cli-pty.ts";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

/** Runs the basic scenario's turn to its end (it reports a cost of 0.014 USD). */
async function finishTurn(run: CliRun) {
  await run.s.waitFor(READY, 10000);
  run.s.sendKeys({ text: "go" }, "Enter");
  await run.s.waitFor(CARD_HEADER, 5000);
  await Bun.sleep(400);
  run.s.sendKeys("Enter");
  await run.s.waitFor("end turn", 5000);
  await run.s.waitFor(READY, 5000);
}

describe("status row (task 4.6)", () => {
  test("cost at IDE-pane width: at 63 columns, with a long temporary cwd, the status row shows the cost; cwd or the hints give way first", async () => {
    const run = startCli("basic", 0, { cols: 63, rows: 21 });
    session = run.s;
    await finishTurn(run);
    await run.s.waitFor((p) => statusRow(p).includes("$0.01"), 5000);
    const row = statusRow(run.s);
    expect(row).toMatch(/\bidle\b/);
    expect(row).toMatch(/connected {2}\$0\.01$/);
    // The usage gauge is in the prompt box's border, not the status row, at this width.
    expect(row).not.toContain("ctx ");
  }, 20000);

  test("density mark: switched to focus, the status row names focus; back at compact the mark is gone", async () => {
    const run = startCli("basic", 0, { cols: 100, rows: 30 });
    session = run.s;
    await finishTurn(run);
    run.s.sendKeys("Tab");
    // compact, verbose, focus: two presses of `v`.
    run.s.sendKeys({ text: "v" });
    await run.s.waitFor((p) => statusRow(p).includes("density: verbose"), 5000);
    run.s.sendKeys({ text: "v" });
    await run.s.waitFor((p) => statusRow(p).includes("density: focus"), 5000);
    run.s.sendKeys({ text: "v" });
    await run.s.waitFor((p) => !statusRow(p).includes("density"), 5000);
  }, 20000);

  test("no send or newline hint: with a draft in the focused prompt box at 120 columns, the status row names neither Enter nor Shift+Enter", async () => {
    const run = startCli("basic", 0, { cols: 120, rows: 24 });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "a draft" });
    await run.s.waitFor((p) => promptText(p)[0] === "a draft", 5000);
    await run.s.flush();
    const row = statusRow(run.s);
    expect(row).not.toContain("enter");
    expect(row).not.toContain("newline");
  }, 20000);

  test("empty prompt box: idle, focused and empty at 120 columns, the hints show / commands, ? help (task 12.1), the mode-cycle key with mode and Ctrl+D detach", async () => {
    const run = startCli("basic", 0, { cols: 120, rows: 24 });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    expect(statusRow(run.s)).toContain("shift+tab mode  / commands  ? help  ctrl+d detach");
    expect(statusRow(run.s)).not.toContain("enter");
  }, 20000);
});
