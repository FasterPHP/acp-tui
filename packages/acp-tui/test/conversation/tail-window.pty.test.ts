// A running call whose output is a moving window (spec tui-rendering "Counts for a moving output
// window") through the real CLI against fake-agent `tail-window`: the collapsed line reads
// `last N lines` and the expanded card's marker `M of the last N lines hidden`, counting lines
// (not the rows long lines wrap onto). Waits end on the screen's text.
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { PtySession } from "../pty/harness.ts";
import { withoutBar } from "../pty/regions.ts";
import { sendPrompt, startCli, type CliRun } from "./cli.ts";

// Imported by a computed path: acp-tui does not depend on the fake-agent package.
const { tailWindow, TAIL_WINDOW_UPDATES } = (await import(join(import.meta.dir, "../../../fake-agent/src/scenarios/tail-window.ts"))) as {
  tailWindow: (n: number) => { first: number; lines: readonly string[] };
  TAIL_WINDOW_UPDATES: number;
};

let run: CliRun | undefined;
afterEach(async () => {
  run?.session.kill("SIGTERM");
  await run?.session.dispose();
  run = undefined;
});

const rowsOf = (s: PtySession): string[] => withoutBar(s.screenText());

describe("a moving output window (task 8c)", () => {
  test("the collapsed count reads `last N lines` and the expanded marker counts lines of the same window", async () => {
    run = startCli({ scenario: "tail-window", cols: 100, rows: 40 });
    const s = run.session;
    await sendPrompt(s, "go");
    const final = tailWindow(TAIL_WINDOW_UPDATES).lines.length;
    // The last update has arrived: the count is of the latest window, with `last`.
    await s.waitFor((p) => rowsOf(p).some((r) => r.includes(`last ${final} lines`)), 20000);
    expect(rowsOf(s).join("\n")).not.toMatch(/\b\d+ rows hidden/);
    s.sendKeys("Tab");
    s.sendKeys("Enter");
    await s.waitFor((p) => rowsOf(p).some((r) => new RegExp(`\\d+ of the last ${final} lines hidden`).test(r)), 10000);
    const marker = rowsOf(s).find((r) => /of the last \d+ lines hidden/.test(r))!;
    const hidden = Number(/(\d+) of the last/.exec(marker)![1]);
    expect(hidden).toBeGreaterThan(0);
    expect(hidden).toBeLessThan(final);
  }, 40000);
});
