// parallel-tests task 3.4: the live-reload tests of config.pty.test.ts whose assertion is a time bound (the status row moved, or the theme switched, within one second of saving the file), which run in the serial pass.
// What the file covers is in the header of config.pty.test.ts; its helpers are in config-pty-helpers.ts.
import { afterEach, describe, expect, test } from "bun:test";
import { type PtySession } from "../pty/harness.ts";
import { CARD_HEADER, promptText, READY, REQUIRES_ACTION, statusRow, withoutBar } from "../pty/regions.ts";
import { DARK, configHome, start, disposeSession } from "./config-pty-helpers.ts";

afterEach(disposeSession);

describe("Live reload (task 3.2)", () => {
  /** The first conversation row: the row below the top margin, or below a bar at the top. */
  const SIZE = { cols: 120, rows: 21 };

  test("Status row moved and hints hidden: within one second the status row is at the top below the top margin, no hints, and the conversation keeps its reading position", async () => {
    const cfg = configHome();
    const run = start({ home: cfg.home, scenario: "long-session", agentArgs: ["--items", "200"], ...SIZE });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "go" });
    await run.s.waitFor((p) => (promptText(p)[0] ?? "") === "go", 5000);
    run.s.sendKeys("Enter");
    await run.s.waitFor((p) => READY.test(statusRow(p)) && p.screenText().join("\n").includes("end turn"), 20000);
    // Scrolled up, so the conversation no longer follows the bottom.
    run.s.sendKeys("PageUp", "PageUp");
    await run.s.waitFor((p) => /scrolled/.test(statusRow(p)), 5000);
    await Bun.sleep(200);
    await run.s.flush();
    const before = withoutBar(run.s.screenText());
    expect(before[0]).toBe("");
    // The default layout: the status row second from the bottom, with hints.
    expect(before[19]).toMatch(/\/ commands {2}\? help/);
    const topBefore = before[1];
    expect(topBefore).not.toBe("");

    const saved = Date.now();
    cfg.write(
      JSON.stringify({
        layout: { screen: [{ left: ["cwd", "turn-state"], right: ["position", "connection"] }, "conversation", "activity", "card", "prompt", { spacer: 1 }, "find"] },
      }),
    );
    await run.s.waitFor((p) => READY.test(p.screenText()[1] ?? ""), 1000);
    const elapsed = Date.now() - saved;
    await Bun.sleep(100);
    await run.s.flush();
    const after = withoutBar(run.s.screenText());
    expect(elapsed).toBeLessThan(1000);
    expect(after[0]).toBe("");
    expect(after[1]).toMatch(/^ \/\S+ {2}idle .*scrolled.*connected$/);
    expect(after.join("\n")).not.toMatch(/commands|\? help|shift\+tab/);
    // The conversation starts below the bar, at the same entry as before.
    expect(after[2]).toBe(topBefore);
    expect(after[20]).toBe("");
    expect(run.events("config_reload")[0]?.["changed"]).toEqual(["layout"]);
  }, 40000);

  test("Theme switched: within one second of saving theme.flat true no truecolour background is drawn, and the open permission card keeps its warning frame and marker", async () => {
    const cfg = configHome();
    const run = start({ home: cfg.home, cols: 80, rows: 40, colours: DARK });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor(CARD_HEADER, 5000);
    const rgbCells = (s: PtySession) => {
      let n = 0;
      for (let y = 0; y < s.rows; y++) for (let x = 0; x < s.cols; x++) if (s.cell(s.term.buffer.active.viewportY + y, x)?.isBgRGB()) n++;
      return n;
    };
    // Cards are filled: truecolour backgrounds on screen.
    await run.s.waitFor((p) => rgbCells(p) > 0, 5000);
    const saved = Date.now();
    cfg.write(`{ "theme": { "flat": true } }`);
    await run.s.waitFor((p) => rgbCells(p) === 0, 1000);
    expect(Date.now() - saved).toBeLessThan(1000);
    const rows = run.s.screenText();
    const top = rows.findIndex((row) => row.startsWith(`╭─ ${CARD_HEADER}`));
    expect(top).toBeGreaterThanOrEqual(0);
    expect(rows[top]).toContain("◊");
    expect(rows.slice(top + 1).some((row) => row.startsWith("╰"))).toBe(true);
    expect(REQUIRES_ACTION.test(statusRow(run.s))).toBe(true);
  }, 30000);
});
