// Phase-1a S6, chrome at 20 rows (tasks 13.1 to 13.4; design D13 row S6),
// promoted by mvp-chrome-and-keys (no `--spike` since task 7.5). The real CLI
// against fake-agent at 63x21, PhpStorm reworked's pane size: the permission
// card's preview scrolled to the last line of the 60-line diff by keyboard and
// grown with Ctrl+O; the command palette with at least 12 items, running a
// chosen command; the model picker with at least 12 values, applying
// `session/set_config_option` so the prompt box border shows the new model;
// the elicitation card against fake-agent's `elicitation` scenario, and the
// capability advertised.
import { afterEach, describe, expect, test } from "bun:test";
import { deriveSurfaces } from "../../src/theme/index.ts";
import type { OscColours, PtySession } from "../pty/harness.ts";
import { cardRows, promptBox, READY, statusRow, uncard } from "../pty/regions.ts";
import { boxRows, inner, rowOf, SIZE, startChrome, type ChromeRun } from "./cli.ts";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

const DARK = { foreground: "#bcbec4", background: "#191a1c" } satisfies OscColours;
const PERMISSION_FG = 3;

function start(opts: Parameters<typeof startChrome>[0]): ChromeRun {
  const run = startChrome(opts);
  session = run.s;
  return run;
}

async function prompt(run: ChromeRun, text = "go") {
  await run.s.waitFor(READY, 10000);
  run.s.sendKeys({ text }, "Enter");
}

const responses = (run: ChromeRun, method: string) => run.agent().filter((e) => e.method === method).map((e) => e.params);
const bgHex = (s: PtySession, y: number, x: number) => {
  const cell = s.cell(s.term.buffer.active.baseY + y, x)!;
  return cell.isBgDefault() ? "default" : `#${cell.getBgColor().toString(16).padStart(6, "0")}`;
};
const afterGuard = () => Bun.sleep(400);
/** Ctrl+U (the harness's key table has no entry for it). */
const CTRL_U = "\x15";

// The preview and grow are product since mvp-chrome-and-keys task 5.1: these run without `--spike`.
// The headings of groups whose keys work in one place say so (task 13.11); the others carry no hint.
const conversationHeading = "Conversation (shortcuts apply while selected)";
const permissionHeading = "Permission (shortcuts apply while it is open)";

describe("permission card preview (task 13.1; mvp-chrome-and-keys task 5.1, without --spike)", () => {
  test("the 60-line diff of permission-diff scrolls to its last line by keyboard at 63x21; PgUp, PgDn, Up, Down, Home; the conversation keeps 4 rows", async () => {
    const run = start({ scenario: "permission-diff", args: [] });
    await prompt(run);
    await run.s.waitFor(() => cardRows(run.s).length > 0, 5000);
    await run.s.flush();
    const body = () => cardRows(run.s).slice(1, -1).map((r) => uncard(r));
    const bottom = () => cardRows(run.s).at(-1) ?? "";
    // At rest: the title, the first two preview rows (the path, the hunk header), the four
    // options stacked; below the top margin the conversation keeps 4 rows above the activity bar
    // (its line: at 63x21 every blank row around the card has given way, day-one-feedback 13).
    expect(rowOf(run.s, "◊ Permission")).toBe(1 + 4 + 1);
    expect(body()[0]).toBe("Edit src/Http/Router.php");
    expect(body()[1]).toBe("/work/src/Http/Router.php");
    expect(body()[2]).toMatch(/^@@ -3,\d+ \+3,\d+ @@/);
    expect(body().slice(-4)).toEqual(["1 allow once", "2 allow always", "3 reject once", "4 reject always"]);
    expect(bottom()).toContain(" 1-2 of 53 ");
    expect(run.s.screenText().join("\n")).not.toContain("unchanged tail line 3");

    // The card has focus (the prompt box was empty): End shows the diff's last line.
    run.s.sendKeys("End");
    await run.s.waitFor(() => bottom().includes(" 52-53 of 53 "), 3000);
    expect(body()[2]).toBe("38       unchanged tail line 3");
    // Down at the end stays at the end; Up moves one row; PgUp a page (one row, of two); PgDn back.
    run.s.sendKeys("Down");
    await run.s.flush();
    expect(bottom()).toContain(" 52-53 of 53 ");
    run.s.sendKeys("Up");
    await run.s.waitFor(() => bottom().includes(" 51-52 of 53 "), 3000);
    run.s.sendKeys("PageUp");
    await run.s.waitFor(() => bottom().includes(" 50-51 of 53 "), 3000);
    run.s.sendKeys("PageDown", "PageDown");
    await run.s.waitFor(() => bottom().includes(" 52-53 of 53 "), 3000);
    run.s.sendKeys("Home");
    await run.s.waitFor(() => bottom().includes(" 1-2 of 53 "), 3000);
    // Nothing was answered by scrolling.
    expect(responses(run, "session/request_permission/response")).toEqual([]);
  }, 20000);

  test("Ctrl+O grows the card to all but one conversation row and back; the offset stays valid; 3 then Enter answers option 3", async () => {
    const run = start({ scenario: "permission-diff", args: [] });
    await prompt(run);
    await run.s.waitFor(() => cardRows(run.s).length > 0, 5000);
    await run.s.flush();
    const bottom = () => cardRows(run.s).at(-1) ?? "";
    run.s.sendKeys("End");
    await run.s.waitFor(() => bottom().includes(" 52-53 of 53 "), 3000);
    run.s.sendKeys("Ctrl+O");
    // The margins, the activity bar, the prompt box's three rows, the spacer and the status row
    // leave 13; the card takes 12.
    await run.s.waitFor(() => cardRows(run.s).length === 12, 3000);
    // Eight preview rows now, still ending at the last line; the conversation keeps a row.
    await run.s.waitFor(() => bottom().includes(" 49-53 of 53 "), 3000);
    expect(rowOf(run.s, "unchanged tail line 3")).toBeGreaterThan(0);
    expect(rowOf(run.s, "◊ Permission")).toBe(1 + 1 + 1);
    // Ctrl+O did not toggle the tool call in the conversation (the card's own binding outranks it).
    run.s.sendKeys("Ctrl+O");
    await run.s.waitFor(() => cardRows(run.s).length === 9, 3000);
    await run.s.waitFor(() => bottom().includes(" 52-53 of 53 "), 3000);

    await afterGuard();
    run.s.sendKeys("3", "Enter");
    await run.s.waitFor(() => responses(run, "session/request_permission/response").length === 1, 5000);
    expect(responses(run, "session/request_permission/response")).toEqual([{ outcome: { outcome: "selected", optionId: "reject-once" } }]);
    await run.s.waitFor(READY, 5000);
    expect(cardRows(run.s)).toEqual([]);
  }, 20000);

  test("with surfaces: every cell of the card is filled (permission fill, diff fills, the selection), framed in the warning colour", async () => {
    const run = start({ scenario: "permission-diff", args: [], colours: DARK, env: { COLORTERM: "truecolor" } });
    await prompt(run);
    await run.s.waitFor(() => cardRows(run.s).length > 0, 5000);
    // Down to the first removed lines (two preview rows at rest).
    run.s.sendKeys("Down", "Down", "Down", "Down", "Down");
    await run.s.waitFor(() => (cardRows(run.s).at(-1) ?? "").includes(" 6-7 of 53 "), 3000);
    await run.s.flush();
    const surfaces = deriveSurfaces(DARK);
    const allowed = new Set([surfaces["surface.permission"], surfaces["surface.permission.selected"], surfaces["diff.added.bg"], surfaces["diff.removed.bg"]]);
    const top = rowOf(run.s, "◊ Permission");
    const rows = cardRows(run.s).length;
    for (let y = top; y < top + rows; y++) {
      for (let x = 0; x < 63; x++) expect(allowed.has(bgHex(run.s, y, x))).toBe(true);
      // The frame's edges are always the permission fill and the warning colour.
      expect(bgHex(run.s, y, 0)).toBe(surfaces["surface.permission"]);
      expect(run.s.cell(run.s.term.buffer.active.baseY + y, 0)!.getFgColor()).toBe(PERMISSION_FG);
    }
    // Removed lines carry the removed-line fill inside the frame.
    const removed = rowOf(run.s, "-     removed line 1");
    expect(removed).toBeGreaterThan(top);
    expect(bgHex(run.s, removed, 10)).toBe(surfaces["diff.removed.bg"]);
  }, 20000);
});

/** The palette's entry count from its top border (`Commands 41`). */
const paletteCount = (s: PtySession): number => Number(/Commands (\d+)/.exec(s.screenText().join("\n"))?.[1] ?? -1);

describe("command palette (task 13.2; mvp-chrome-and-keys tasks 6.1 and 6.2, without --spike)", () => {
  test("Ctrl+P shows at least 12 items at 63x21, grouped, with key labels and current values, in the prompt box's place, at most rows - 4", async () => {
    const run = start({ scenario: "config-options" });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Commands \d+/, 3000);
    await run.s.flush();
    const rows = boxRows(run.s, "Commands");
    expect(rows.length).toBeLessThanOrEqual(21 - 4);
    // In the prompt box's place (mvp-chrome-and-keys task 12.7): its bottom border is on the
    // prompt box's bottom border row, 17, above the spacer, the status row (19) and the bottom
    // margin; until task 12.7 it was the row above the status row.
    expect(rowOf(run.s, /^╰─ ↑↓ select/)).toBe(17);
    expect(statusRow(run.s)).toMatch(/idle/);
    const list = rows.slice(2, -1).map(inner);
    const headers = ["Session", conversationHeading, "Selection", permissionHeading, "Prompt (shortcuts apply while selected)"];
    const items = list.filter((r) => !headers.includes(r) && r !== "");
    expect(items.length).toBeGreaterThanOrEqual(12);
    expect(list[0]).toBe("Session");
    // The pickers have no default key: their route is a click on their pill, and the cycle keys
    // stay on their own entries (day-two-feedback task 13.7).
    expect(list[1]).toMatch(/^Choose the model +Fake Aurora {2}click the pill$/);
    expect(list[2]).toMatch(/^Choose the mode +Ask {2}click the pill$/);
    expect(list[3]).toMatch(/^Choose the thinking level +Medium {2}click the pill$/);
    // No permission commands while no request is open.
    expect(list.some((r) => r.startsWith("Select "))).toBe(false);
    expect(inner(rows[1]!)).toContain("type to filter commands");
    // Flat theme (no colour replies): the selected item is in inverse video, the others are not,
    // and no cell of the overlay has a fill.
    const cellAt = (y: number, x: number) => run.s.cell(run.s.term.buffer.active.baseY + y, x)!;
    const first = rowOf(run.s, "Choose the model");
    expect(cellAt(first, 3).isInverse()).toBeTruthy();
    expect(cellAt(first + 1, 3).isInverse()).toBeFalsy();
    const top = rowOf(run.s, "Commands");
    for (let y = top; y < top + rows.length; y++) {
      for (let x = 0; x < 63; x++) if (!cellAt(y, x).isInverse()) expect(bgHex(run.s, y, x)).toBe("default");
    }

    // Down through the whole list: every group and the entries the MVP changes add, each with its
    // keys from the key map; none of the agent's commands, which `/` lists (task 12.1).
    const seen = new Set<string>();
    const page = () => boxRows(run.s, "Commands").slice(2, -1).map(inner);
    for (let i = 0; i < 20; i++) {
      const before = page().join("\n");
      for (const row of page()) seen.add(row);
      run.s.sendKeys("PageDown");
      const moved = await run.s.waitFor(() => page().join("\n") !== before, 1000).then(
        () => true,
        () => false,
      );
      if (!moved) break;
    }
    const all = [...seen];
    for (const header of headers.filter((h) => h !== permissionHeading)) expect(all).toContain(header);
    for (const entry of [
      /^Turn mouse reporting off or on +full {2}f2$/,
      // Keyless entries show their route; the session list has none (task 12.7).
      /^Interrupt the turn +esc esc$/,
      /^Open the session list$/,
      /^Next mode +shift\+tab$/,
      /^Next thinking level +ctrl\+t$/,
      /^Key help +f1$/,
      // The key column shows the key alone; where it works is in the group heading (task 13.11).
      // At 63 columns a title is cut before its key column is.
      /^Next tool call +\]$/,
      /^Cycle the density +v$/,
      /^First item +home g$/,
      /^Open the item's link.* +o$/,
      /^Copy the selection, or the item under the cursor +ctrl\+c$/,
      /^Paste from the clipboard +ctrl\+v ctrl\+shift\+v alt\+v$/,
    ]) {
      expect(all).toContainEqual(expect.stringMatching(entry));
    }
    expect(all).not.toContain("Agent commands");
    expect(all.some((r) => r.startsWith("/review") || r.startsWith("Open the command palette") || r.startsWith("Back to the prompt box"))).toBe(false);
  }, 30000);

  test("filter, Ctrl+U, Up, Down, Home, End, Esc; Enter runs the chosen command (the mouse toggle), and focus returns to the prompt box", async () => {
    const run = start({ scenario: "config-options" });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Commands \d+/, 3000);
    const total = paletteCount(run.s);
    run.s.sendKeys({ text: "item" });
    await run.s.waitFor(() => paletteCount(run.s) > 0 && paletteCount(run.s) < total, 3000);
    // Filtered: each group with a match keeps its header (task 12.8), here the conversation's.
    expect(boxRows(run.s, "Commands").slice(2, 4).map(inner)).toEqual([conversationHeading, expect.stringMatching(/^First item/)]);
    run.s.write(CTRL_U);
    await run.s.waitFor(() => paletteCount(run.s) === total, 3000);
    run.s.sendKeys("Esc");
    await run.s.waitFor(() => boxRows(run.s, "Commands").length === 0, 3000);

    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Commands \d+/, 3000);
    run.s.sendKeys({ text: "mouse" }, "Enter");
    await run.s.waitFor(() => statusRow(run.s).includes("mouse off"), 3000);
    expect(boxRows(run.s, "Commands")).toEqual([]);
    // Focus is back in the prompt box: typing goes into it.
    run.s.sendKeys({ text: "typed" });
    await run.s.waitFor(() => promptBox(run.s).some((r) => r.includes("typed")), 3000);
  }, 20000);

  test("Ctrl+P does not clash with the prompt box: a two-line draft keeps Up and Down as line moves, and survives the palette", async () => {
    const run = start({ scenario: "config-options" });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "one" }, "Shift+Enter", { text: "two" }, "Up", { text: "X" });
    await run.s.waitFor(() => promptBox(run.s).some((r) => r.includes("oneX")), 3000);
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Commands \d+/, 3000);
    run.s.sendKeys("Esc");
    await run.s.waitFor(() => boxRows(run.s, "Commands").length === 0, 3000);
    run.s.sendKeys("Down", { text: "Y" });
    await run.s.waitFor(() => promptBox(run.s).some((r) => r.includes("twoY") || r.includes("tYwo") || /tw?o?Y/.test(r)), 3000);
    expect(promptBox(run.s).some((r) => r.includes("oneX"))).toBe(true);
  }, 20000);
});

describe("model picker (task 13.3; mvp-chrome-and-keys task 6.5, without --spike)", () => {
  test("at least 12 values at 63x21, searchable, current marked; applying sends session/set_config_option and the prompt box border shows the new model", async () => {
    const run = start({ scenario: "config-options" });
    await run.s.waitFor(READY, 10000);
    // The pills (mvp-chrome-and-keys task 4.5).
    expect(promptBox(run.s).at(-1)).toMatch(/Mode Ask ─ Model Fake Aurora/);
    // Reached from the palette.
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Commands \d+/, 3000);
    run.s.sendKeys("Enter");
    await run.s.waitFor(/Model 20/, 3000);
    await run.s.flush();
    const rows = boxRows(run.s, "Model 20");
    const values = rows.slice(2, -1).map(inner);
    expect(values.length).toBeGreaterThanOrEqual(12);
    expect(values[0]).toBe("● Fake Aurora");
    expect(values[1]).toBe("  Fake Basalt");
    expect(inner(rows[1]!)).toContain("type to search");
    // Down a page and back, End and Home move within the list.
    run.s.sendKeys("End");
    await run.s.waitFor(() => boxRows(run.s, "Model 20").some((r) => r.includes("Fake Tundra")), 3000);
    run.s.sendKeys("Home");
    await run.s.waitFor(() => boxRows(run.s, "Model 20").some((r) => r.includes("● Fake Aurora")), 3000);

    run.s.sendKeys({ text: "kest" });
    await run.s.waitFor(/Model 1 /, 3000);
    run.s.sendKeys("Enter");
    await run.s.waitFor(() => (promptBox(run.s).at(-1) ?? "").includes("Fake Kestrel"), 5000);
    expect(responses(run, "session/set_config_option")).toEqual([expect.objectContaining({ configId: "model", value: "model-11" })]);
    // The full list the agent returned replaced the session's: the palette shows the new value.
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Choose the model +Fake Kestrel/, 3000);
    run.s.sendKeys("Esc");
    // And the agent sees it.
    await run.s.waitFor(() => boxRows(run.s, "Commands").length === 0, 3000);
    await prompt(run, "values?");
    await run.s.waitFor("model=model-11", 5000);
  }, 20000);

  test("four choices (mode): no filter field; the picker command is unbound but reachable from the palette", async () => {
    const run = start({ scenario: "config-options" });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys("Ctrl+P", "Down", "Enter");
    await run.s.waitFor(/Mode 4/, 3000);
    const values = boxRows(run.s, "Mode 4").slice(1, -1).map(inner);
    expect(values).toEqual(["● Ask", "  Plan", "  Accept edits", "  Auto"]);
    run.s.sendKeys("Down", "Down", "Enter");
    await run.s.waitFor(() => (promptBox(run.s).at(-1) ?? "").includes("Accept edits"), 5000);
  }, 20000);
});

// The elicitation card is product since mvp-chrome-and-keys task 5.6: these run without `--spike`.
describe("elicitation card (task 13.4; mvp-chrome-and-keys task 5.6, without --spike)", () => {
  test("form: one question at a time, Question 1 of 3, review, submit; then the URL request with the URL; the agent receives the answers", async () => {
    // 24 rows: the activity bar keeps its line and blank row (day-two-feedback task 13.2), so the card keeps its padding rows here.
    const run = start({ scenario: "elicitation", args: [], rows: 24 });
    await prompt(run);
    await run.s.waitFor("Question 1 of 3", 5000);
    await run.s.flush();
    // Its rows without the frame and its padding columns; the padding rows read "".
    const card = () => boxRows(run.s, "◊ ").map((r) => uncard(r));
    expect(card()).toEqual([
      expect.stringContaining("◊ Question 1 of 3  Set up the change"),
      "",
      "A few questions before I start.",
      "Strategy (required)",
      "How should the migration run?",
      "1 ○ In place",
      "2 ○ Copy, then swap",
      "",
      expect.stringContaining("enter next"),
    ]);
    await afterGuard();
    // Esc on a required question arms decline; another key disarms. Choose 2, Enter.
    run.s.sendKeys("Esc");
    await run.s.waitFor("again declines", 3000);
    run.s.sendKeys("2", "Enter");
    await run.s.waitFor("Question 2 of 3", 3000);
    expect(card()).toContain("1 [ ] Unit tests");
    // Space ticks the choice under the cursor; a digit ticks that choice.
    run.s.sendKeys("Space", "2", "Enter");
    await run.s.waitFor("Question 3 of 3", 3000);
    run.s.sendKeys({ text: "be careful" });
    await run.s.waitFor("› be careful", 3000);
    run.s.sendKeys("Backspace", { text: "l" }, "Enter");
    await run.s.waitFor("Review your answers", 3000);
    expect(card().slice(2, 5)).toEqual(["1 Strategy: Copy, then swap", "2 Checks: Unit tests, Type check", "3 Notes: be careful"]);
    // A digit goes back to that question; Esc there skips it (optional).
    run.s.sendKeys("3");
    await run.s.waitFor("Question 3 of 3", 3000);
    run.s.sendKeys("Esc");
    await run.s.waitFor("Review your answers", 3000);
    expect(card()[4]).toBe("3 Notes: (skipped)");
    run.s.sendKeys("Enter");
    await run.s.waitFor(() => responses(run, "elicitation/create/response").length === 1, 5000);
    expect(responses(run, "elicitation/create/response")[0]).toEqual({ action: "accept", content: { strategy: "copy", checks: ["tests", "types"] } });

    // URL mode: the message and the whole URL; open, copy, accept, decline (3 accepts without opening).
    await run.s.waitFor("Open a link", 5000);
    expect(card().slice(2, 5)).toEqual(["Sign in to continue.", "https://example.invalid/fake-agent/authorise", "1 open   2 copy   3 accept   4 decline"]);
    await afterGuard();
    run.s.sendKeys("3", "Enter");
    await run.s.waitFor(() => responses(run, "elicitation/create/response").length === 2, 5000);
    expect(responses(run, "elicitation/create/response")[1]).toEqual({ action: "accept" });
    // elicitation/complete closes the waiting card; the turn ends.
    await run.s.waitFor(READY, 5000);
    await run.s.waitFor("URL: accepted", 5000);
    expect(boxRows(run.s, "◊ ")).toEqual([]);
    expect(run.events("elicitation_completed")).toHaveLength(1);
  }, 30000);

  test("Esc twice on the required question declines; Esc on the URL request cancels", async () => {
    const run = start({ scenario: "elicitation", args: [] });
    await prompt(run);
    await run.s.waitFor("Question 1 of 3", 5000);
    await afterGuard();
    // Two Esc bytes in one write read as Alt+Esc, so the second press is sent on its own.
    run.s.sendKeys("Esc");
    await run.s.waitFor("again declines", 3000);
    run.s.sendKeys("Esc");
    await run.s.waitFor(() => responses(run, "elicitation/create/response").length === 1, 5000);
    expect(responses(run, "elicitation/create/response")[0]).toEqual({ action: "decline" });
    await run.s.waitFor("Open a link", 5000);
    run.s.sendKeys("Esc");
    await run.s.waitFor(() => responses(run, "elicitation/create/response").length === 2, 5000);
    expect(responses(run, "elicitation/create/response")[1]).toEqual({ action: "cancel" });
    await run.s.waitFor(READY, 5000);
  }, 30000);

  test("the capability is advertised without the spike too (mvp-chrome-and-keys task 5.6): initialize names form and url", async () => {
    const run = start({ scenario: "elicitation", args: [] });
    await run.s.waitFor(READY, 10000);
    expect(responses(run, "initialize")[0]).toMatchObject({ clientCapabilities: { elicitation: { form: {}, url: {} } } });
  }, 30000);
});
