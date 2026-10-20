// Group headings that say where keys work, and only entries that can run now being active
// (day-two-feedback tasks 13.11 and 13.12; spec tui-palette "Group headings say where keys work"
// and "Only entries that can run now are active"; design D11). The real CLI under the PTY harness
// against fake-agent. The pure parts are in test/overlay/palette.test.ts and list.test.ts.
import { afterEach, describe, expect, test } from "bun:test";
import type { PtySession } from "../pty/harness.ts";
import { promptText, READY, statusRow } from "../pty/regions.ts";
import { boxRows, inner, rowOf, startChrome, type ChromeRun } from "./cli.ts";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

function start(opts: Parameters<typeof startChrome>[0]): ChromeRun {
  const run = startChrome(opts);
  session = run.s;
  return run;
}

const paletteOpen = (s: PtySession) => boxRows(s, "Commands").length > 0;
const listRows = (s: PtySession, title: string | RegExp) => boxRows(s, title).slice(2, -1).map(inner);
const cellAt = (s: PtySession, y: number, x: number) => s.cell(s.term.buffer.active.baseY + y, x)!;
const inverse = (s: PtySession, y: number, x: number) => cellAt(s, y, x).isInverse() !== 0;
/** How a row's first title cell is drawn: colour mode, colour and dim. */
function look(s: PtySession, y: number): string {
  const c = cellAt(s, y, 2);
  return JSON.stringify({ mode: c.getFgColorMode(), fg: c.getFgColor(), dim: c.isDim() !== 0 });
}
const sent = (run: ChromeRun, method: string) => run.agent().filter((e) => e.method === method);

/** Every row of a list, paging down through it. */
async function allRows(s: PtySession, title: string | RegExp): Promise<string[]> {
  const seen: string[] = [];
  for (let i = 0; i < 40; i++) {
    const page = listRows(s, title);
    for (const row of page) if (!seen.includes(row)) seen.push(row);
    const before = page.join("\n");
    s.sendKeys("PageDown");
    const moved = await s.waitFor(() => listRows(s, title).join("\n") !== before, 1000).then(
      () => true,
      () => false,
    );
    if (!moved) break;
  }
  return seen;
}

const HINTS = [
  "Conversation (shortcuts apply while selected)",
  "Prompt (shortcuts apply while selected)",
];

describe("group headings carry the hint (task 13.11)", () => {
  for (const [cols, rows] of [
    [63, 21],
    [100, 110],
  ] as const) {
    test(`Palette and key help at ${cols}x${rows}: the key column holds the key alone, the Conversation and Prompt headings say where their keys work, and Session and Selection say nothing`, async () => {
      const run = start({ scenario: "config-options", cols, rows });
      await run.s.waitFor(READY, 10000);
      run.s.sendKeys("Ctrl+P");
      await run.s.waitFor(/Commands \d+/, 3000);
      const palette = await allRows(run.s, "Commands");
      for (const heading of HINTS) expect(palette).toContain(heading);
      expect(palette).toContain("Session");
      expect(palette).toContain("Selection");
      expect(palette.filter((r) => r.includes(" · "))).toEqual([]);
      expect(palette).toContainEqual(expect.stringMatching(/^Cycle the density +v$/));
      expect(palette).toContainEqual(expect.stringMatching(/^Cut the selection +ctrl\+x$/));
      run.s.sendKeys("Esc");
      await run.s.waitFor(() => !paletteOpen(run.s), 3000);

      run.s.sendKeys("F1");
      await run.s.waitFor(/Keys \d+/, 3000);
      const help = await allRows(run.s, /Keys \d+/);
      for (const heading of [
        "Prompt box (shortcuts apply while selected)",
        "Conversation (shortcuts apply while selected)",
        "Permission card (shortcuts apply while it is open)",
        "Find bar (shortcuts apply while it is open)",
        "Lists (shortcuts apply while one is open)",
      ]) {
        expect(help).toContain(heading);
      }
      expect(help).toContain("Anywhere");
      expect(help).toContain("Selection");
      expect(help.filter((r) => r.includes(" · "))).toEqual([]);
      expect(help).toContainEqual(expect.stringMatching(/^Cycle the density +v$/));
      expect(help).toContainEqual(expect.stringMatching(/^Send the prompt +enter$/));
    }, 60000);
  }
});

describe("only entries that can run now are active (task 13.12)", () => {
  test("Idle: `Interrupt the turn` is drawn muted, the keyboard selection passes over it, and Enter and a click on it run nothing; a running turn makes it active", async () => {
    const run = start({ scenario: "slow-turn", delayScale: 1, cols: 100, rows: 70 });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Commands \d+/, 3000);
    await run.s.flush();
    const interrupt = rowOf(run.s, /^│ Interrupt the turn\b/);
    const sessions = rowOf(run.s, /^│ Open the session list\b/);
    const find = rowOf(run.s, /^│ Find in the conversation\b/);
    expect(interrupt).toBeGreaterThan(0);
    expect(look(run.s, interrupt)).not.toBe(look(run.s, sessions));
    // The selection goes from the entry above it to the one below, never resting on it.
    // (the first entry that can run is selected when the list opens: Next mode; Down twice)
    run.s.sendKeys("Down", "Down");
    await run.s.waitFor(() => inverse(run.s, sessions, 4), 3000);
    run.s.sendKeys("Down");
    await run.s.waitFor(() => inverse(run.s, find, 4), 3000);
    expect(inverse(run.s, interrupt, 4)).toBe(false);
    run.s.sendKeys("Up");
    await run.s.waitFor(() => inverse(run.s, sessions, 4), 3000);
    // Pointing at it selects nothing, and a click on it neither runs it nor closes the list.
    run.s.mouseMove(8, interrupt);
    run.s.mouseClick(8, interrupt);
    await run.s.flush();
    await Bun.sleep(300);
    expect(paletteOpen(run.s)).toBe(true);
    expect(inverse(run.s, interrupt, 4)).toBe(false);
    expect(inverse(run.s, sessions, 4)).toBe(true);
    expect(sent(run, "session/cancel")).toEqual([]);

    // Filtered to the muted entry alone: Enter does nothing either.
    run.s.sendKeys({ text: "interrupt the" });
    await run.s.waitFor(/Commands 1 /, 3000);
    run.s.sendKeys("Enter");
    await Bun.sleep(400);
    expect(paletteOpen(run.s)).toBe(true);
    expect(sent(run, "session/cancel")).toEqual([]);
    run.s.sendKeys("Esc");
    await run.s.waitFor(() => !paletteOpen(run.s), 3000);

    // While a turn runs the same entry is drawn as the others are and Enter on it interrupts.
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor(() => statusRow(run.s).includes("running"), 5000);
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Commands \d+/, 3000);
    await run.s.flush();
    expect(look(run.s, rowOf(run.s, /^│ Interrupt the turn\b/))).toBe(look(run.s, rowOf(run.s, /^│ Open the session list\b/)));
    run.s.sendKeys({ text: "interrupt the" });
    await run.s.waitFor(/Commands 1 /, 3000);
    run.s.sendKeys("Enter");
    await run.s.waitFor(() => sent(run, "session/cancel").length === 1, 5000);
  }, 40000);

  test("A click on an active entry runs it where the conversation had not been selected: the palette gives the command its region, so `Cycle the density` acts at once from the prompt box", async () => {
    const run = start({ scenario: "config-options", cols: 100, rows: 70 });
    await run.s.waitFor(READY, 10000);
    expect(statusRow(run.s)).not.toContain("density");
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Commands \d+/, 3000);
    await run.s.flush();
    const density = rowOf(run.s, /^│ Cycle the density\b/);
    // Not drawn as unavailable: the same look as an entry that is not selected and can run.
    expect(look(run.s, density)).toBe(look(run.s, rowOf(run.s, /^│ Open the session list\b/)));
    run.s.mouseClick(8, density);
    await run.s.waitFor(() => !paletteOpen(run.s), 3000);
    await run.s.waitFor(() => statusRow(run.s).includes("density"), 3000);
  }, 20000);

  test("Nothing selected: `Clear the selection` and `Cut the selection` are muted and run nothing; with a selection in the prompt box both are active, and Cut removes it", async () => {
    const run = start({ scenario: "config-options", cols: 100, rows: 70 });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "hello world" });
    await run.s.waitFor((p) => promptText(p)[0] === "hello world", 5000);
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Commands \d+/, 3000);
    await run.s.flush();
    const active = look(run.s, rowOf(run.s, /^│ Open the session list\b/));
    expect(look(run.s, rowOf(run.s, /^│ Cut the selection\b/))).not.toBe(active);
    expect(look(run.s, rowOf(run.s, /^│ Clear the selection\b/))).not.toBe(active);
    run.s.sendKeys({ text: "cut the selection" });
    await run.s.waitFor(/Commands 1 /, 3000);
    run.s.sendKeys("Enter");
    await Bun.sleep(400);
    expect(paletteOpen(run.s)).toBe(true);
    run.s.sendKeys("Esc");
    await run.s.waitFor(() => !paletteOpen(run.s), 3000);
    expect(promptText(run.s)[0]).toBe("hello world");

    // Select the last word (Shift+Ctrl+Left), then open the palette again.
    run.s.sendKeys({ text: "\x1b[1;6D" });
    await Bun.sleep(300);
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Commands \d+/, 3000);
    await run.s.flush();
    const live = look(run.s, rowOf(run.s, /^│ Open the session list\b/));
    expect(look(run.s, rowOf(run.s, /^│ Cut the selection\b/))).toBe(live);
    expect(look(run.s, rowOf(run.s, /^│ Clear the selection\b/))).toBe(live);
    run.s.sendKeys({ text: "cut the selection" });
    await run.s.waitFor(/Commands 1 /, 3000);
    run.s.sendKeys("Enter");
    await run.s.waitFor(() => !paletteOpen(run.s), 3000);
    await run.s.waitFor((p) => promptText(p)[0] === "hello", 5000);
  }, 40000);

  test("Key help runs nothing and mutes nothing: a click on an entry leaves it open", async () => {
    const run = start({ scenario: "config-options", cols: 100, rows: 70 });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys("F1");
    await run.s.waitFor(/Keys \d+/, 3000);
    await run.s.flush();
    const rows = rowOf(run.s, /^│ Anywhere\b/);
    expect(rows).toBeGreaterThan(0);
    const body = listRows(run.s, /Keys \d+/).filter((r) => r !== "" && !/^[A-Z][A-Za-z ]+( \(shortcuts apply[^)]*\))?$/.test(r));
    expect(body.length).toBeGreaterThan(5);
    const first = rowOf(run.s, new RegExp(`^│ ${body[0]!.slice(0, 12).replace(/[^A-Za-z ]/g, ".")}`));
    run.s.mouseClick(8, first);
    await run.s.flush();
    await Bun.sleep(300);
    expect(boxRows(run.s, /Keys \d+/).length).toBeGreaterThan(0);
  }, 20000);
});
