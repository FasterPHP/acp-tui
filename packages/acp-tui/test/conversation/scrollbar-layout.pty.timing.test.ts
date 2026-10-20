// parallel-tests task 3.4: the scroll bar reload test whose assertion is a time bound (switching layout.scrollbar on draws the bar within one second of saving the file), which runs in the serial pass.
// What the file covers is in the header of scrollbar-layout.pty.test.ts; its helpers are in scrollbar-layout-helpers.ts.
import { afterEach, describe, expect, test } from "bun:test";
import type { PtySession } from "../pty/harness.ts";
import { settle } from "./cli.ts";
import { configHome } from "../pty/config-home.ts";
import { SURFACES, PARAGRAPH, wrap, open, bgOf, TOP, conversationRows, paragraphRows, textWidth, run, disposeRun } from "./scrollbar-layout-helpers.ts";
import { WINDOWS } from "../windows.ts";

afterEach(disposeRun);

describe("Conversation scrollbar", () => {
  // Skipped on Windows: it needs the terminal's OSC 10/11 colour replies (derived surfaces, light theme), which ConPTY never passes on (it passes only OSC 4).
  test.skipIf(WINDOWS)("Scrollbar switched on by a reload: the next frame draws the bar, agent text wraps at column 60, and the same entry stays at the top", async () => {
    const cfg = configHome({ layout: { scrollbar: false } });
    const s = await open({ cols: 63, rows: 21, turns: 2500, env: cfg.env });
    // Away from both ends of the 5000 items: the first item (Home from the empty prompt box), then
    // three pages down.
    s.sendKeys("Home");
    await s.waitFor((p) => /scrolled 0%/.test(p.screenText().at(-2) ?? ""), 10000);
    s.sendKeys("PageDown", "PageDown", "PageDown");
    await settle(s);
    expect(s.screenText().at(-2)).toMatch(/scrolled \d+%/);
    const barCells = (p: PtySession) => {
      let n = 0;
      for (let y = TOP; y < conversationRows(p); y++) if ([SURFACES["scrollbar.track"], SURFACES["scrollbar.thumb"]].includes(bgOf(p, y, 62))) n++;
      return n;
    };
    expect(barCells(s)).toBe(0);
    const before = s.screenText().slice(TOP, conversationRows(s));
    const saved = Date.now();
    cfg.write({ layout: { scrollbar: true } });
    await s.waitFor((p) => barCells(p) === conversationRows(p) - TOP, 1000);
    expect(Date.now() - saved).toBeLessThan(1000);
    await settle(s);
    const after = s.screenText().slice(TOP, conversationRows(s));
    // The same entry at the top (short entries: nothing rewraps at one column less).
    expect(after[0]).toBe(before[0]);
    expect(run!.events("config_reload").map((e) => e["changed"])).toEqual([["layout"]]);
    // At the end, the paragraph wraps at column 60 now.
    s.sendKeys("End");
    await s.waitFor((p) => !/scrolled/.test(p.screenText().at(-2) ?? ""), 10000);
    await settle(s);
    expect(paragraphRows(s, wrap(PARAGRAPH, textWidth(63, true)))).toEqual(wrap(PARAGRAPH, 58));
  }, 180000);
});
