// Click to select in every list (day-two-feedback task 13.6, design D11; spec tui-palette "Click to
// select in lists", tui-sessions "Session list"): a primary click on a row does what Enter does on
// it, in the mode, model and effort pickers, the command palette, the `/` menu, the `@` file
// picker and the session list, and the pointer moving over a row selects it as the keyboard
// would. Only under `--mouse full`: `wheel` and `off` report neither clicks nor motion. The real
// CLI under the PTY harness against fake-agent; mouse reports are injected as SGR (0-based cells).
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PtySession } from "../pty/harness.ts";
import { promptBox, promptText, READY } from "../pty/regions.ts";
import { listBody, listRows, listWorld, type ListWorld } from "../session/list-world.ts";
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

const bottomBorder = (s: PtySession) => promptBox(s).at(-1) ?? "";
const params = (run: ChromeRun, method: string) => run.agent().filter((e) => e.method === method).map((e) => e.params as Record<string, unknown>);
const cellAt = (s: PtySession, y: number, x: number) => s.cell(s.term.buffer.active.baseY + y, x)!;
/** Whether a cell is drawn in inverse video (the flat theme's selected row). */
const inverse = (s: PtySession, y: number, x: number): boolean => cellAt(s, y, x).isInverse() !== 0;
const paletteOpen = (s: PtySession) => boxRows(s, "Commands").length > 0;

/** Clicks the pill whose text is `value` in the prompt box's bottom border. */
function clickPill(s: PtySession, value: string): void {
  const y = s.screenText().lastIndexOf(bottomBorder(s));
  s.mouseClick(bottomBorder(s).indexOf(value) + 1, y);
}

/** Clicks the first row of the screen that matches `text`, a few columns in. */
function clickRow(s: PtySession, text: string | RegExp, x = 4): void {
  const y = rowOf(s, text);
  expect(y).toBeGreaterThan(0);
  s.mouseClick(x, y);
}

describe("config option pickers (click to select)", () => {
  test("Mode: a click on a choice applies it as Enter would (session/set_mode), the picker closes and the prompt box has the keyboard with its draft", async () => {
    const run = start({ scenario: "config-options-legacy" });
    await run.s.waitFor(READY, 10000);
    await run.s.waitFor(() => bottomBorder(run.s).includes("Mode Default"), 5000);
    run.s.sendKeys({ text: "draft" });
    await run.s.waitFor((p) => promptText(p)[0] === "draft", 5000);
    clickPill(run.s, "Default");
    await run.s.waitFor(/Mode 3/, 3000);
    clickRow(run.s, /^│ {3}Plan\b/);
    await run.s.waitFor(() => bottomBorder(run.s).includes("Mode Plan"), 5000);
    expect(params(run, "session/set_mode")).toEqual([expect.objectContaining({ modeId: "plan" })]);
    expect(boxRows(run.s, /Mode 3/)).toEqual([]);
    run.s.sendKeys({ text: "!" });
    await run.s.waitFor((p) => promptText(p)[0] === "draft!", 5000);
  }, 20000);

  test("Model: a click on a choice of the searchable picker (the filter is empty) sends session/set_config_option for it", async () => {
    const run = start({ scenario: "config-options", cols: 120, rows: 40 });
    await run.s.waitFor(READY, 10000);
    await run.s.waitFor(() => bottomBorder(run.s).includes("Fake Aurora"), 5000);
    clickPill(run.s, "Fake Aurora");
    await run.s.waitFor(/Model 20/, 3000);
    clickRow(run.s, /^│ {3}Fake Kestrel\b/);
    await run.s.waitFor(() => bottomBorder(run.s).includes("Model Fake Kestrel"), 5000);
    expect(params(run, "session/set_config_option")).toEqual([expect.objectContaining({ configId: "model", value: "model-11" })]);
  }, 20000);

  test("Effort: a click on a choice applies it", async () => {
    const run = start({ scenario: "config-options", cols: 100, rows: 30 });
    await run.s.waitFor(READY, 10000);
    await run.s.waitFor(() => bottomBorder(run.s).includes("Medium"), 5000);
    clickPill(run.s, "Medium");
    await run.s.waitFor((p) => p.screenText().some((r) => /^│ {3}High\b/.test(r)), 3000);
    clickRow(run.s, /^│ {3}High\b/);
    await run.s.waitFor(() => bottomBorder(run.s).includes("Thinking High"), 5000);
    expect(params(run, "session/set_config_option")).toEqual([expect.objectContaining({ configId: "thought_level", value: "high" })]);
  }, 20000);

  test("Pointing selects: moving over a row marks it as the keyboard selection (inverse under the flat theme) and Enter then applies it", async () => {
    const run = start({ scenario: "config-options-legacy" });
    await run.s.waitFor(READY, 10000);
    await run.s.waitFor(() => bottomBorder(run.s).includes("Mode Default"), 5000);
    clickPill(run.s, "Default");
    await run.s.waitFor(/Mode 3/, 3000);
    const accept = rowOf(run.s, /^│ {3}Accept edits\b/);
    const current = rowOf(run.s, /^│ ● Default\b/);
    // The current choice is the keyboard selection when the picker opens.
    await run.s.flush();
    expect(inverse(run.s, current, 4)).toBeTruthy();
    expect(inverse(run.s, accept, 4)).toBeFalsy();
    run.s.mouseMove(6, accept);
    await run.s.waitFor(() => inverse(run.s, accept, 4), 3000);
    expect(inverse(run.s, current, 4)).toBeFalsy();
    run.s.sendKeys("Enter");
    await run.s.waitFor(() => bottomBorder(run.s).includes("Accept edits"), 5000);
    expect(params(run, "session/set_mode")).toEqual([expect.objectContaining({ modeId: "accept-edits" })]);
  }, 20000);
});

describe("the command palette and the slash menu (click to select)", () => {
  test("A click on an entry runs it as Enter would: `Key help` opens key help; a click on a group header, the filter or the frame does nothing", async () => {
    const run = start({ scenario: "config-options", cols: 100, rows: 40 });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Commands \d+/, 3000);
    // Not rows of entries: the header, the filter field and the top border.
    run.s.mouseClick(6, rowOf(run.s, /^│ Session\b/));
    run.s.mouseClick(6, rowOf(run.s, /type to filter commands/));
    run.s.mouseClick(6, rowOf(run.s, /^╭─ Commands/));
    await run.s.flush();
    await Bun.sleep(200);
    expect(paletteOpen(run.s)).toBe(true);
    clickRow(run.s, /^│ Key help\b/);
    await run.s.waitFor(/Keys \d+/, 3000);
    expect(paletteOpen(run.s)).toBe(false);
  }, 20000);

  test("A click on a filtered entry runs it: `choose the model` then a click opens the model picker", async () => {
    const run = start({ scenario: "config-options", cols: 100, rows: 40 });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Commands \d+/, 3000);
    run.s.sendKeys({ text: "choose the model" });
    await run.s.waitFor(/Commands 1 /, 3000);
    clickRow(run.s, /^│ Choose the model\b/);
    await run.s.waitFor(/Model 20/, 3000);
  }, 20000);

  test("Pointing selects: a row under a moving pointer is the selected row, so Enter runs it", async () => {
    const run = start({ scenario: "config-options", cols: 100, rows: 40 });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Commands \d+/, 3000);
    await run.s.flush();
    const help = rowOf(run.s, /^│ Key help\b/);
    expect(inverse(run.s, help, 4)).toBeFalsy();
    run.s.mouseMove(8, help);
    await run.s.waitFor(() => inverse(run.s, help, 4), 3000);
    // Only one row of the list is marked (not the filter field, whose cursor is inverse).
    const top = rowOf(run.s, /^╭─ Commands/);
    const height = boxRows(run.s, "Commands").length;
    const marked = run.s.screenText().flatMap((_, y) => (y >= top + 2 && y < top + height && inverse(run.s, y, 4) ? [y] : []));
    expect(marked).toEqual([help]);
    run.s.sendKeys("Enter");
    await run.s.waitFor(/Keys \d+/, 3000);
  }, 20000);

  test("The slash menu: a click on `/help` (one of acp-tui's own commands) opens key help", async () => {
    const run = start({ scenario: "config-options", cols: 100, rows: 40 });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "/" });
    await run.s.waitFor(/Slash commands \d+/, 3000);
    clickRow(run.s, /^│ \/help\b/);
    await run.s.waitFor(/Keys \d+/, 3000);
  }, 20000);

  test("Under --mouse wheel a click does nothing: the palette stays open on its selection and the entry is not run", async () => {
    const run = start({ scenario: "config-options", cols: 100, rows: 40, args: ["--mouse", "wheel"] });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Commands \d+/, 3000);
    await run.s.flush();
    const help = rowOf(run.s, /^│ Key help\b/);
    run.s.mouseMove(8, help);
    run.s.mouseClick(8, help);
    await Bun.sleep(400);
    await run.s.flush();
    expect(paletteOpen(run.s)).toBe(true);
    expect(boxRows(run.s, /Keys \d+/)).toEqual([]);
    expect(inverse(run.s, help, 4)).toBeFalsy();
    // The keyboard still works.
    run.s.sendKeys({ text: "key help" }, "Enter");
    await run.s.waitFor(/Keys \d+/, 3000);
  }, 20000);
});

describe("the @ file picker (click to select)", () => {
  function tree(files: Record<string, string>): string {
    const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-files-"));
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    return dir;
  }
  const picker = (s: PtySession) => boxRows(s, /─ Files \d/);
  const pickerList = (s: PtySession) => picker(s).slice(1, -1).map(inner);

  test("A click on a path mentions it as Enter would, closes the picker and leaves the keyboard in the prompt box; pointing marks the row", async () => {
    const cwd = tree({ "src/Db/Connection.php": "<?php\n", "src/Db/Query.php": "<?php\n", "README.md": "# project\n" });
    const run = start({ scenario: "basic", args: [], cwd, cols: 80, rows: 30 });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "see @" });
    await run.s.waitFor(() => pickerList(run.s).includes("src/Db/Query.php"), 3000);
    await run.s.flush();
    const query = rowOf(run.s, /^│ src\/Db\/Query\.php\s*│$/);
    run.s.mouseMove(6, query);
    await run.s.waitFor(() => inverse(run.s, query, 4), 3000);
    run.s.mouseClick(6, query);
    await run.s.waitFor(() => picker(run.s).length === 0, 3000);
    await run.s.waitFor(() => promptText(run.s).join("").trim() === "see @src/Db/Query.php", 3000);
    run.s.sendKeys({ text: "!" });
    await run.s.waitFor(() => promptText(run.s).join("").trim() === "see @src/Db/Query.php!", 3000);
  }, 20000);
});

describe("the session list (click to select)", () => {
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
  const turn = (user: string, agent: string) => ({ user, tools: [{ title: "Read src/Example.php", kind: "read", output: "<?php" }], agent });

  function world(): { w: ListWorld; repo: string } {
    const w = listWorld();
    const repo = w.dir("repo");
    const fixture = w.sessions("store", [
      { sessionId: "s-a", cwd: repo, title: "Render the template", updatedAt: ago(2 * MINUTE), turns: [turn("question a", "answer a")] },
      { sessionId: "s-b", cwd: repo, title: "Fix the router", updatedAt: ago(3 * HOUR), turns: [turn("question b", "answer b")] },
    ]);
    w.configure({ fake: ["--scenario", "copy-fixtures", "--load", "--list", "--sessions", fixture] });
    return { w, repo };
  }

  test("A click on a session opens it as Enter would; pointing at a row selects it first", async () => {
    const { w, repo } = world();
    session = w.start(["-a", "fake", "--resume"], { cwd: repo });
    const s = session;
    await s.waitFor(() => listBody(s).some((r) => r.startsWith("Fix the router")), 15000);
    await s.flush();
    const router = s.screenText().findIndex((r) => r.startsWith("│ Fix the router"));
    expect(router).toBeGreaterThan(0);
    s.mouseMove(6, router);
    await s.waitFor(() => inverse(s, router, 4), 3000);
    s.mouseClick(6, router);
    await s.waitFor("answer b", 10000);
    await s.waitFor(READY, 5000);
    expect(listRows(s)).toEqual([]);
    expect(w.received("fake").find((e) => e.method === "session/load")?.params?.["sessionId"]).toBe("s-b");
  }, 40000);

  test("A click on the list's frame or its filter row does nothing: the list stays open", async () => {
    const { w, repo } = world();
    session = w.start(["-a", "fake", "--resume"], { cwd: repo });
    const s = session;
    await s.waitFor(() => listBody(s).some((r) => r.startsWith("Fix the router")), 15000);
    await s.flush();
    s.mouseClick(6, s.screenText().findIndex((r) => r.startsWith("╭─ Sessions")));
    s.mouseClick(6, s.screenText().findIndex((r) => r.startsWith("│ › ")));
    await Bun.sleep(300);
    await s.flush();
    expect(listRows(s).length).toBeGreaterThan(0);
    expect(w.received("fake").some((e) => e.method === "session/load")).toBe(false);
  }, 40000);
});
