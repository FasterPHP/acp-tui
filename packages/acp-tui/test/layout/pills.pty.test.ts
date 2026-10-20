// mvp-chrome-and-keys task 4.5 (spec tui-layout "Config option pills"; design
// D4): the real CLI against fake-agent's `config-options` (mode `Ask`, model
// `Fake Aurora`, the `thought_level` option `Thinking` at `Medium`) and
// `config-options-legacy` (a legacy mode, no config options) under the PTY
// harness, and (session-models) `config-options-models` (the older model state: a legacy mode and a
// legacy model, no config options). The width policy at narrow widths and the gauge are unit-tested in
// test/layout/border.test.ts.
//
// The click opens the palette overlay's picker, without `--spike` since task
// 6.1 promoted it.
import { afterEach, describe, expect, test } from "bun:test";
import type { PtySession } from "../pty/harness.ts";
import { promptBox, promptText, READY } from "../pty/regions.ts";
import { startCli } from "../keys/cli-pty.ts";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

const bottom = (s: PtySession): string => promptBox(s).at(-1) ?? "";

describe("config option pills (task 4.5)", () => {
  test("effort shown: the bottom border reads Mode Ask, Model Fake Aurora and Thinking Medium in that order (120 columns)", async () => {
    const run = startCli("config-options", 0, { cols: 120, rows: 21 });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    await run.s.waitFor((p) => bottom(p).includes("Medium"), 5000);
    expect(bottom(run.s)).toStartWith("╰─ Mode Ask ─ Model Fake Aurora ─ Thinking Medium ─");
  }, 20000);

  test("narrow pane: at 61 columns the three values are visible", async () => {
    const run = startCli("config-options", 0, { cols: 61, rows: 20 });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    await run.s.waitFor((p) => bottom(p).includes("Medium"), 5000);
    const row = bottom(run.s);
    expect(Bun.stringWidth(row)).toBe(61);
    for (const value of ["Ask", "Fake Aurora", "Medium"]) expect(row).toContain(value);
  }, 20000);

  test("no effort option: the legacy mode alone, named Mode, and no effort pill", async () => {
    const run = startCli("config-options-legacy", 0, { cols: 63, rows: 21 });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    await run.s.waitFor((p) => bottom(p).includes("Mode "), 5000);
    expect(bottom(run.s)).toMatch(/^╰─ Mode \S+ ─+╯$/);
    expect(bottom(run.s)).not.toContain("Thinking");
  }, 20000);

  test("Model from the legacy model state: Mode Default then Model Fake Small, and no effort pill; Ctrl+T says the harness offers no thinking levels", async () => {
    const run = startCli("config-options-models", 0, { cols: 80, rows: 21 });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    await run.s.waitFor((p) => bottom(p).includes("Model "), 5000);
    expect(bottom(run.s)).toStartWith("╰─ Mode Default ─ Model Fake Small ─");
    expect(bottom(run.s)).not.toContain("Thinking");
    expect(bottom(run.s)).not.toContain("Effort");
    run.s.write("\x14");
    await run.s.waitFor((p) => (promptBox(p)[0] ?? "").includes("the harness offers no thinking levels"), 3000);
    expect(run.methods().some((method) => method === "session/set_config_option" || method === "session/set_model")).toBe(false);
  }, 20000);

  test("click opens the picker: a click on the effort pill with a draft in the focused prompt box opens the effort picker; after Esc the prompt box has focus with the draft unchanged", async () => {
    const run = startCli("config-options", 0, { cols: 80, rows: 24 });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    await run.s.waitFor((p) => bottom(p).includes("Medium"), 5000);
    run.s.sendKeys({ text: "draft" });
    await run.s.waitFor((p) => promptText(p)[0] === "draft", 5000);

    const rows = run.s.screenText();
    const y = rows.lastIndexOf(bottom(run.s));
    run.s.mouseClick(bottom(run.s).indexOf("Medium") + 1, y);
    // The picker lists the option's values, with the current one.
    await run.s.waitFor((p) => p.screenText().some((row) => row.includes("High")) && p.screenText().some((row) => row.includes("Off")), 5000);
    expect(run.methods()).not.toContain("session/set_config_option");

    run.s.sendKeys("Esc");
    await run.s.waitFor((p) => !p.screenText().some((row) => row.includes("Off")), 5000);
    // Focus is back in the prompt box: typing goes on after the draft.
    run.s.sendKeys({ text: "!" });
    await run.s.waitFor((p) => promptText(p)[0] === "draft!", 5000);
  }, 20000);
});
