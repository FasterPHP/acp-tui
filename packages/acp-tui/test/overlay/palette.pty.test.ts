// The palette, the slash menu with the agent's commands, the config pickers,
// the mode and effort keys and key help (mvp-chrome-and-keys tasks 3.6, 6.1 to
// 6.5 and 6.8; specs tui-palette and tui-keymap "Mode and effort keys",
// "Alternatives for keys an IDE keeps"). The real CLI under the PTY harness,
// without `--spike`, against fake-agent (`config-options`,
// `config-options-legacy`, `basic`, `slow-turn`) and the test agent
// `palette-agent.ts` (a hostile command description, a refused option). The
// palette's layout and the catalogue check are unit-tested in
// test/overlay/palette.test.ts; the S6 palette and picker tests are in
// chrome.pty.test.ts and slash.pty.test.ts.
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { SELECTION_HELP } from "../../src/selection/help.ts";
import { startPty, type OscColours, type PtySession } from "../pty/harness.ts";
import { promptBox, promptText, READY, statusRow } from "../pty/regions.ts";
import { startCli, tempDir } from "../keys/cli-pty.ts";
import { boxRows, inner, rowOf, startChrome, type ChromeRun } from "./cli.ts";
import { HOSTILE_OSC52, PALETTE_AGENT_REFUSAL } from "./palette-agent.ts";
import { WINDOWS } from "../windows.ts";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

/** Ctrl+T (the harness's key table has no entry for it). */
const CTRL_T = "\x14";
const DARK = { foreground: "#bcbec4", background: "#191a1c" } satisfies OscColours;
const ROOT = join(import.meta.dir, "../../../..");
const CLI = join(ROOT, "packages/acp-tui/src/cli.ts");
const KEYMAP_CLI = join(import.meta.dir, "../keys/cli-with-keymap.ts");
const PALETTE_AGENT = join(import.meta.dir, "palette-agent.ts");

function start(opts: Parameters<typeof startChrome>[0]): ChromeRun {
  const run = startChrome(opts);
  session = run.s;
  return run;
}

/** acp-tui against palette-agent.ts, at 63x21. */
function startPaletteAgent(): PtySession {
  const s = startPty(["bun", CLI, "--", "--", "bun", PALETTE_AGENT], { cols: 63, rows: 21, cwd: tempDir() });
  session = s;
  return s;
}

const palette = (s: PtySession) => boxRows(s, "Commands");
const paletteOpen = (s: PtySession) => palette(s).length > 0;
/** A list's rows inside its frame, without the blank rows that pad a short list to the prompt box's
 *  height (task 12.7). */
const listRows = (s: PtySession, title: string | RegExp) => trimBlank(boxRows(s, title).slice(2, -1).map(inner));
function trimBlank(rows: string[]): string[] {
  while (rows.length > 0 && rows.at(-1) === "") rows.pop();
  return rows;
}
/** The prompt box's top border, where notices are shown. */
const topBorder = (s: PtySession) => promptBox(s)[0] ?? "";
const bottomBorder = (s: PtySession) => promptBox(s).at(-1) ?? "";
const params = (run: ChromeRun, method: string) => run.agent().filter((e) => e.method === method).map((e) => e.params as Record<string, unknown>);
/** A prompt `text` was sent: fake-agent logs `session/prompt` without its text, so the user card in
 *  the conversation (above the prompt box) shows what was sent, and the prompt box is empty. */
const sent = (run: ChromeRun, text: string): boolean => {
  if (!run.agent().some((e) => e.method === "session/prompt")) return false;
  const rows = run.s.screenText();
  const box = rows.findIndex((r, y) => y > 0 && r.startsWith("╭") && promptBox(run.s)[0] === r);
  return rows.slice(0, box < 0 ? rows.length : box).some((r) => r.includes(text)) && promptText(run.s).join("").trim() === "";
};

/** Every row a list shows from its first to its last page (PgDn until it stops moving). */
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

/** A palette group heading: the group's name, with its hint when its keys work in one place (task 13.11). */
const isPaletteHeading = (row: string): boolean => /^(Session|Selection|(Conversation|Prompt) \(shortcuts apply while selected\)|Permission \(shortcuts apply while it is open\))$/.test(row);

describe("palette (task 6.1)", () => {
  test("Twelve entries at IDE-pane size: at 63x21 against config-options, at least 12 entries with their group headers; the model entry shows the current model", async () => {
    const run = start({ scenario: "config-options" });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Commands \d+/, 3000);
    await run.s.flush();
    const rows = listRows(run.s, "Commands");
    expect(rows.filter((r) => r !== "Session" && r !== "").length).toBeGreaterThanOrEqual(12);
    expect(rows[0]).toBe("Session");
    expect(rows).toContainEqual(expect.stringMatching(/^Choose the model +Fake Aurora {2}click the pill$/));
  }, 20000);

  // Skipped on Windows: it needs the terminal's OSC 10/11 colour replies (derived surfaces, light theme), which ConPTY never passes on (it passes only OSC 4).
  test.skipIf(WINDOWS)("Headers do not read as disabled: on the terminal's default background (task 12.7), each group header is bold in the default foreground, not in the key hints' muted colour", async () => {
    const run = start({ scenario: "config-options", colours: DARK, env: { COLORTERM: "truecolor" } });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Commands \d+/, 3000);
    await run.s.flush();
    const cell = (y: number, x: number) => run.s.cell(run.s.term.buffer.active.baseY + y, x)!;
    const fg = (y: number, x: number) => `${cell(y, x).getFgColorMode()}:${cell(y, x).getFgColor()}`;
    const header = rowOf(run.s, /^│ Session +│$/);
    expect(header).toBeGreaterThan(0);
    // An unselected entry's title (the `text` token) and its keys (`muted`).
    const entry = rowOf(run.s, "Next mode");
    const keysAt = run.s.screenText()[entry]!.indexOf("shift+tab");
    for (let x = 2; x < 2 + "Session".length; x++) {
      expect(cell(header, x).isBold()).toBeTruthy();
      expect(fg(header, x)).toBe(fg(entry, 2));
    }
    expect(fg(entry, keysAt)).not.toBe(fg(header, 2));
    expect(cell(entry, keysAt).isBold()).toBeFalsy();
    // Once the surfaces are derived (the selected entry takes `surface.cursor`), the header and
    // the entries stay on the terminal's default background: no `surface.overlay` fill since task
    // 12.7 (until then the overlay was filled).
    const selected = rowOf(run.s, "Choose the model");
    await run.s.waitFor(() => !cell(selected, 30).isBgDefault(), 3000);
    expect(cell(header, 30).isBgDefault()).toBeTruthy();
    expect(cell(entry, 2).isBgDefault()).toBeTruthy();
  }, 20000);

  test("Keys from the key map: with find bound to Alt+F instead of Ctrl+F, the find entry shows Alt+F and not Ctrl+F", async () => {
    const run = startCli("config-options", 0, {
      cols: 80,
      rows: 30,
      entry: KEYMAP_CLI,
      env: { ACP_TUI_TEST_KEYMAP: JSON.stringify({ global: { "meta+f": "find", "ctrl+f": null } }) },
    });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Commands \d+/, 3000);
    run.s.sendKeys({ text: "find conversation" });
    await run.s.waitFor(/Commands 1 /, 3000);
    // The one match under its group's header (task 12.8).
    const rows = listRows(run.s, "Commands");
    expect(rows[0]).toBe("Session");
    expect(rows[1]).toMatch(/^Find in the conversation +alt\+f$/);
    expect(rows[1]).not.toContain("ctrl+f");
  }, 20000);
});

describe("every action in the palette (task 6.2)", () => {
  test("Interrupt from the palette: while a turn runs, `Interrupt the turn` sends session/cancel", async () => {
    const run = start({ scenario: "slow-turn", delayScale: 1 });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor(() => statusRow(run.s).includes("running"), 5000);
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Commands \d+/, 3000);
    run.s.sendKeys({ text: "interrupt the" });
    await run.s.waitFor(/Commands 1 /, 3000);
    expect(listRows(run.s, "Commands").slice(0, 2)).toEqual(["Session", expect.stringMatching(/^Interrupt the turn +esc esc$/)]);
    run.s.sendKeys("Enter");
    await run.s.waitFor(() => run.agent().some((e) => e.method === "session/cancel"), 5000);
    await run.s.waitFor(READY, 5000);
  }, 20000);
});

describe("agent commands in the slash menu (tasks 6.4 and 12.1)", () => {
  test("Commands merged: `/` then `rev` lists /review with its description; Enter leaves `/review ` with `PR number` as its placeholder; `/` lists the agent's commands first", async () => {
    const run = start({ scenario: "config-options" });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "/" });
    await run.s.waitFor(/Slash commands \d+/, 3000);
    await run.s.waitFor(() => listRows(run.s, "Slash commands").length >= 2, 3000);
    // Opened by `/`: the agent's commands first, with no group header, then acp-tui's under theirs.
    const rows = listRows(run.s, "Slash commands");
    expect(rows[0]).toMatch(/^\/review {2}Review a pull request$/);
    expect(rows[1]).toMatch(/^\/compact {2}Compact the conversation$/);
    expect(rows).toContain("acp-tui");
    run.s.sendKeys({ text: "rev" });
    await run.s.waitFor(/Slash commands 1 /, 3000);
    expect(listRows(run.s, "Slash commands")[0]).toMatch(/^\/review {2}Review a pull request$/);
    run.s.sendKeys("Enter");
    await run.s.waitFor(() => boxRows(run.s, "Slash commands").length === 0 && (promptText(run.s)[0] ?? "").startsWith("/review PR number"), 3000);
    // The hint is a muted placeholder, not text: typing replaces it.
    const y = rowOf(run.s, "/review PR number");
    const x = run.s.screenText()[y]!.indexOf("PR number");
    const at = (cx: number) => run.s.cell(run.s.term.buffer.active.baseY + y, cx)!;
    expect(at(x).getFgColor()).not.toBe(at(x - 2).getFgColor());
    run.s.sendKeys({ text: "12" });
    await run.s.waitFor(() => (promptText(run.s)[0] ?? "").trim() === "/review 12", 3000);
    run.s.sendKeys("Enter");
    await run.s.waitFor(() => sent(run, "/review 12"), 5000);
  }, 20000);

  test("Command without input: while idle, /compact chosen from the slash menu with Enter is completed into the prompt box with no placeholder and nothing is sent; a second Enter sends the prompt `/compact`", async () => {
    const run = start({ scenario: "config-options" });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "/" });
    await run.s.waitFor(/Slash commands \d+/, 3000);
    run.s.sendKeys({ text: "/compact" });
    await run.s.waitFor(/Slash commands 1 /, 3000);
    run.s.sendKeys("Enter");
    await run.s.waitFor(() => boxRows(run.s, "Slash commands").length === 0 && (promptText(run.s)[0] ?? "").startsWith("/compact"), 3000);
    // No placeholder after the name, and no prompt sent.
    expect((promptText(run.s)[0] ?? "").trim()).toBe("/compact");
    await Bun.sleep(300);
    expect(run.agent().some((e) => e.method === "session/prompt")).toBe(false);
    run.s.sendKeys("Enter");
    await run.s.waitFor(() => sent(run, "/compact"), 5000);
    expect(promptText(run.s).join("").trim()).toBe("");
  }, 20000);

  test("Commands replaced: after the agent's second update lists only review, /compact is no longer in the slash menu", async () => {
    const run = start({ scenario: "config-options" });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "/" });
    await run.s.waitFor(/Slash commands \d+/, 3000);
    run.s.sendKeys({ text: "/compact" });
    await run.s.waitFor(/Slash commands 1 /, 3000);
    run.s.sendKeys("Esc");
    await run.s.waitFor(() => boxRows(run.s, "Slash commands").length === 0, 3000);
    // Esc left the `/` (task 12.1): clear it before the prompt.
    await run.s.waitFor(() => promptText(run.s).join("").trim() === "/", 3000);
    run.s.sendKeys("Backspace");
    await run.s.waitFor(() => promptText(run.s).join("").trim() === "", 3000);
    // The first turn ends with the second commands update (fake-agent `config-options`).
    run.s.sendKeys({ text: "hello" }, "Enter");
    await run.s.waitFor(() => run.agent().filter((e) => e.method === "session/update/sent").length >= 2, 5000);
    await run.s.waitFor(READY, 5000);
    run.s.sendKeys({ text: "/" });
    // The one agent command and acp-tui's nine.
    await run.s.waitFor(/Slash commands 10 /, 3000);
    expect(listRows(run.s, "Slash commands")[0]).toMatch(/^\/review {2}Review a pull request$/);
    expect(listRows(run.s, "Slash commands").filter((r) => r.startsWith("/compact"))).toEqual([]);
    run.s.sendKeys({ text: "/compact" });
    await run.s.waitFor(/Slash commands 0 /, 3000);
    run.s.write("\x15");
    run.s.sendKeys({ text: "/review" });
    await run.s.waitFor(/Slash commands 1 /, 3000);
  }, 20000);

  test("Hostile description: a command description with OSC 52 shows its printable text and the terminal receives no part of the sequence", async () => {
    const s = startPaletteAgent();
    await s.waitFor(READY, 10000);
    s.sendKeys({ text: "/" });
    await s.waitFor(/Slash commands \d+/, 3000);
    await s.waitFor(() => listRows(s, "Slash commands").some((r) => r.startsWith("/tidy")), 3000);
    expect(listRows(s, "Slash commands")).toContainEqual(expect.stringMatching(/^\/tidy {2}Tidy the workspace$/));
    expect(s.rawOutput()).not.toContain(HOSTILE_OSC52);
    expect(s.rawOutput()).not.toContain("\x1b]52");
    expect(s.rawOutput()).not.toContain("ZXZpbA==");
  }, 20000);
});

describe("config option pickers (task 6.5)", () => {
  test("Model chosen: the model picker against config-options, model-11 chosen: session/set_config_option with the model option's ID and model-11, and the model pill shows it", async () => {
    const run = start({ scenario: "config-options", cols: 120 });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Commands \d+/, 3000);
    run.s.sendKeys({ text: "choose the model" });
    await run.s.waitFor(/Commands 1 /, 3000);
    run.s.sendKeys("Enter");
    await run.s.waitFor(/Model 20/, 3000);
    run.s.sendKeys({ text: "kestrel" }, "Enter");
    await run.s.waitFor(() => bottomBorder(run.s).includes("Model Fake Kestrel"), 5000);
    expect(params(run, "session/set_config_option")).toEqual([expect.objectContaining({ configId: "model", value: "model-11" })]);
  }, 20000);

  test("Agent refuses: the agent's error leaves the pill at its value and a notice shows the message", async () => {
    const s = startPaletteAgent();
    await s.waitFor(READY, 10000);
    await s.waitFor(() => bottomBorder(s).includes("Alpha"), 5000);
    s.sendKeys("Ctrl+P");
    await s.waitFor(/Commands \d+/, 3000);
    s.sendKeys("Enter");
    await s.waitFor(/Model 2 /, 3000);
    s.sendKeys("Down", "Enter");
    await s.waitFor(() => topBorder(s).includes(PALETTE_AGENT_REFUSAL), 5000);
    expect(bottomBorder(s)).toContain("Alpha");
    expect(bottomBorder(s)).not.toContain("Beta");
  }, 20000);

  test("legacy modes: without a mode option the mode picker lists the agent's modes and applies the choice with session/set_mode", async () => {
    const run = start({ scenario: "config-options-legacy" });
    await run.s.waitFor(READY, 10000);
    await run.s.waitFor(() => bottomBorder(run.s).includes("Mode Default"), 5000);
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Choose the mode +Default/, 3000);
    run.s.sendKeys("Enter");
    await run.s.waitFor(/Mode 3/, 3000);
    expect(boxRows(run.s, /Mode 3/).slice(1, -1).map(inner)).toEqual(["● Default", "  Plan", "  Accept edits"]);
    run.s.sendKeys("Down", "Down", "Enter");
    await run.s.waitFor(() => bottomBorder(run.s).includes("Accept edits"), 5000);
    expect(params(run, "session/set_mode")).toEqual([expect.objectContaining({ modeId: "accept-edits" })]);
    expect(run.agent().some((e) => e.method === "session/set_config_option")).toBe(false);
  }, 20000);
});

describe("legacy models (session-models, spec tui-palette \"Config option pickers\")", () => {
  test("Legacy model chosen: the picker lists the three models, escape-free; Fake Large sends session/set_model and no config option, the pill and a notice follow the reply and the next turn names it", async () => {
    const run = start({ scenario: "config-options-models" });
    await run.s.waitFor(READY, 10000);
    await run.s.waitFor(() => bottomBorder(run.s).includes("Model Fake Small"), 5000);
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Choose the model +Fake Small/, 3000);
    run.s.sendKeys("Enter");
    await run.s.waitFor(/Model 3/, 3000);
    await run.s.flush();
    const rows = boxRows(run.s, /Model 3/).slice(1, -1).map(inner);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toStartWith("● Fake Small");
    expect(rows[0]).toContain("The small fake model");
    expect(rows[1]).toStartWith("  Fake Large");
    // The hostile name is printable and carries no escape sequence or part of one.
    expect(rows[2]).toStartWith("  FakeHostile");
    expect(rows[2]).toContain("Hostile red description");
    expect(rows.join("\n")).not.toMatch(/[\x1b\x07]|52;c|\[31m/);
    run.s.sendKeys("Down", "Enter");
    await run.s.waitFor(() => bottomBorder(run.s).includes("Model Fake Large"), 5000);
    await run.s.waitFor(() => topBorder(run.s).includes("Model: Fake Large"), 3000);
    expect(params(run, "session/set_model")).toEqual([expect.objectContaining({ modelId: "fake-large" })]);
    expect(run.agent().some((e) => e.method === "session/set_config_option")).toBe(false);
    run.s.sendKeys({ text: "which model" }, "Enter");
    await run.s.waitFor(() => run.s.screenText().some((row) => row.includes("Current model: fake-large")), 5000);
  }, 30000);

  test("No current model (currentModelId empty): the pill reads default and opens the picker with no choice marked; choosing Fake Large names it", async () => {
    const run = start({ scenario: "config-options-models-unset" });
    await run.s.waitFor(READY, 10000);
    await run.s.waitFor(() => bottomBorder(run.s).includes("Model default"), 5000);
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Choose the model +default/, 3000);
    run.s.sendKeys("Enter");
    await run.s.waitFor(/Model 3/, 3000);
    await run.s.flush();
    const rows = boxRows(run.s, /Model 3/).slice(1, -1).map(inner);
    expect(rows).toHaveLength(3);
    expect(rows.some((row) => row.startsWith("●"))).toBe(false);
    expect(rows[0]).toStartWith("  Fake Small");
    run.s.sendKeys("Down", "Enter");
    await run.s.waitFor(() => bottomBorder(run.s).includes("Model Fake Large"), 5000);
    expect(params(run, "session/set_model")).toEqual([expect.objectContaining({ modelId: "fake-large" })]);
  }, 30000);

  test("Legacy model refused: the agent's error leaves the pill at its value and a notice shows the message", async () => {
    const s = startPty(["bun", CLI, "--", "--", "bun", PALETTE_AGENT], { cols: 63, rows: 21, cwd: tempDir(), env: { PALETTE_AGENT_LEGACY: "1" } });
    session = s;
    await s.waitFor(READY, 10000);
    await s.waitFor(() => bottomBorder(s).includes("Model Alpha"), 5000);
    s.sendKeys("Ctrl+P");
    await s.waitFor(/Commands \d+/, 3000);
    s.sendKeys("Enter");
    await s.waitFor(/Model 2 /, 3000);
    s.sendKeys("Down", "Enter");
    await s.waitFor(() => topBorder(s).includes(`could not change Model: ${PALETTE_AGENT_REFUSAL}`), 5000);
    expect(bottomBorder(s)).toContain("Model Alpha");
    expect(bottomBorder(s)).not.toContain("Beta");
  }, 20000);
});

describe("mode and effort keys (task 3.6)", () => {
  test("Cycle effort: with the effort at Medium (values Off, Low, Medium, High), Ctrl+T sends `high` and a notice names High", async () => {
    const run = start({ scenario: "config-options", cols: 100 });
    await run.s.waitFor(READY, 10000);
    await run.s.waitFor(() => bottomBorder(run.s).includes("Thinking Medium"), 5000);
    run.s.write(CTRL_T);
    await run.s.waitFor(() => params(run, "session/set_config_option").length === 1, 5000);
    expect(params(run, "session/set_config_option")).toEqual([expect.objectContaining({ configId: "thought_level", value: "high" })]);
    await run.s.waitFor(() => topBorder(run.s).includes("Thinking: High"), 3000);
    await run.s.waitFor(() => bottomBorder(run.s).includes("Thinking High"), 3000);
    // The notice goes after about 3 seconds.
    await run.s.waitFor(() => !topBorder(run.s).includes("Thinking: High"), 5000);
  }, 20000);

  test("Shift+Tab cycles the mode from the prompt box: Ask to Plan, with a notice; inside an overlay it does nothing", async () => {
    const run = start({ scenario: "config-options", cols: 100 });
    await run.s.waitFor(READY, 10000);
    await run.s.waitFor(() => bottomBorder(run.s).includes("Mode Ask"), 5000);
    run.s.sendKeys("ShiftTab");
    await run.s.waitFor(() => bottomBorder(run.s).includes("Mode Plan"), 5000);
    await run.s.waitFor(() => topBorder(run.s).includes("Mode: Plan"), 3000);
    expect(params(run, "session/set_config_option")).toEqual([expect.objectContaining({ configId: "mode", value: "plan" })]);
    // In the palette Shift+Tab and Ctrl+T do nothing.
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Commands \d+/, 3000);
    run.s.sendKeys("ShiftTab");
    run.s.write(CTRL_T);
    await Bun.sleep(500);
    expect(params(run, "session/set_config_option")).toHaveLength(1);
    expect(paletteOpen(run.s)).toBe(true);
  }, 20000);

  test("legacy modes: Shift+Tab sends session/set_mode with the next mode and names it", async () => {
    const run = start({ scenario: "config-options-legacy" });
    await run.s.waitFor(READY, 10000);
    await run.s.waitFor(() => bottomBorder(run.s).includes("Mode Default"), 5000);
    run.s.sendKeys("ShiftTab");
    await run.s.waitFor(() => bottomBorder(run.s).includes("Mode Plan"), 5000);
    expect(params(run, "session/set_mode")).toEqual([expect.objectContaining({ modeId: "plan" })]);
    await run.s.waitFor(() => topBorder(run.s).includes("Mode: Plan"), 3000);
  }, 20000);

  test("No mode option: against an agent with neither a mode option nor legacy modes, Shift+Tab says the harness offers no modes and sends nothing; Ctrl+T says it offers no thinking levels", async () => {
    const run = start({ scenario: "basic" });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys("ShiftTab");
    await run.s.waitFor(() => topBorder(run.s).includes("the harness offers no modes"), 3000);
    run.s.write(CTRL_T);
    await run.s.waitFor(() => topBorder(run.s).includes("the harness offers no thinking levels"), 3000);
    expect(run.agent().some((e) => e.method === "session/set_config_option" || e.method === "session/set_mode")).toBe(false);
  }, 20000);

  for (const [terminal, env] of [
    ["JediTerm", { TERMINAL_EMULATOR: "JetBrains-JediTerm" }],
    ["Zed", { TERM_PROGRAM: "zed" }],
  ] as const) {
    test(`Shift+Tab from the conversation cycles the mode and leaves focus in the conversation (${terminal}; task 11.2, declined focus-back key)`, async () => {
      const run = start({ scenario: "config-options", cols: 100, env });
      await run.s.waitFor(READY, 10000);
      run.s.sendKeys({ text: "hello" }, "Enter");
      await run.s.waitFor(READY, 5000);
      run.s.sendKeys("Tab");
      await run.s.waitFor(() => statusRow(run.s).includes("toggle"), 3000);
      run.s.sendKeys("ShiftTab");
      await run.s.waitFor(() => bottomBorder(run.s).includes("Mode Plan"), 5000);
      // Still the conversation's hints: focus did not move.
      expect(statusRow(run.s)).toContain("toggle");
    }, 20000);
  }

  test("Effort in Zed: the effort pill's click and the palette's effort picker both change the effort, and key help names them as the routes", async () => {
    const run = start({ scenario: "config-options", cols: 100, rows: 30, env: { TERM_PROGRAM: "zed" } });
    await run.s.waitFor(READY, 10000);
    await run.s.waitFor(() => bottomBorder(run.s).includes("Thinking Medium"), 5000);
    // The pill.
    const y = run.s.screenText().lastIndexOf(bottomBorder(run.s));
    run.s.mouseClick(bottomBorder(run.s).indexOf("Medium") + 1, y);
    await run.s.waitFor(/Thinking 4/, 3000);
    run.s.sendKeys("Up", "Enter");
    await run.s.waitFor(() => bottomBorder(run.s).includes("Thinking Low"), 5000);
    // The palette's picker.
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Commands \d+/, 3000);
    run.s.sendKeys({ text: "choose the thinking" }, "Enter");
    await run.s.waitFor(/Thinking 4/, 3000);
    run.s.sendKeys("End", "Enter");
    await run.s.waitFor(() => bottomBorder(run.s).includes("Thinking High"), 5000);
    expect(params(run, "session/set_config_option").map((p) => p["value"])).toEqual(["low", "high"]);
    // Key help names the routes for the Ctrl+T that Zed keeps.
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Commands \d+/, 3000);
    run.s.sendKeys({ text: "key help" }, "Enter");
    await run.s.waitFor(/Keys \d+/, 3000);
    run.s.sendKeys({ text: "effort pill" });
    await run.s.waitFor(() => listRows(run.s, /Keys \d+/).some((r) => /^Kept by Zed: the effort pill, the palette +ctrl\+t$/.test(r)), 3000);
  }, 30000);
});

describe("key help (task 6.8)", () => {
  test("Newline key documented: opened from the palette, the prompt box group lists Shift+Enter as the newline key and Enter as send", async () => {
    const run = start({ scenario: "basic", cols: 100, rows: 30 });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Commands \d+/, 3000);
    run.s.sendKeys({ text: "key help" });
    // The filtered list itself, not only its count: under ConPTY a frame can arrive in parts.
    await run.s.waitFor(() => /^Key help +f1$/.test(listRows(run.s, "Commands")[1] ?? ""), 3000);
    expect(listRows(run.s, "Commands").slice(0, 2)).toEqual(["Session", expect.stringMatching(/^Key help +f1$/)]);
    run.s.sendKeys("Enter");
    await run.s.waitFor(/Keys \d+/, 3000);
    const rows = await allRows(run.s, /Keys \d+/);
    // The headings of the groups whose keys work in one place carry the hint (task 13.11).
    const group = rows.indexOf("Prompt box (shortcuts apply while selected)");
    expect(group).toBeGreaterThan(0);
    const next = rows.indexOf("Conversation (shortcuts apply while selected)");
    const prompt = rows.slice(group, next);
    expect(prompt).toContainEqual(expect.stringMatching(/^Send the prompt +enter$/));
    expect(prompt).toContainEqual(expect.stringMatching(/^Insert a newline +shift\+enter\b/));
    // Keystroke-only bindings are listed too: Tab and the double Esc.
    expect(rows).toContainEqual(expect.stringMatching(/^Move focus to the next region +tab$/));
    expect(rows).toContainEqual(expect.stringMatching(/^Interrupt the running turn \(press twice\) +esc$/));
    // Esc closes help, back to the prompt box.
    run.s.sendKeys("Esc");
    await run.s.waitFor(() => boxRows(run.s, /Keys \d+/).length === 0, 3000);
  }, 30000);

  test("Help names the selection fallback: F1 opens key help, which names plain drag as acp-tui's selection and Shift+drag and F2 as the terminal's native selection (SELECTION_HELP)", async () => {
    const run = start({ scenario: "basic", cols: 100, rows: 30 });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys("F1");
    await run.s.waitFor(/Keys \d+/, 3000);
    const rows = await allRows(run.s, /Keys \d+/);
    const group = rows.indexOf("Mouse and selection");
    expect(group).toBeGreaterThan(0);
    expect(rows.slice(group + 1).join(" ")).toBe(SELECTION_HELP.join(" "));
    // F1 again closes it.
    run.s.sendKeys("F1");
    await run.s.waitFor(() => boxRows(run.s, /Keys \d+/).length === 0, 3000);
  }, 30000);
});

/** The prompt box's border rows on screen and its rows as drawn; null when there is none. While
 *  the palette's overlay covers it, this reads the overlay (its frame ends on the same row). */
function promptPlace(s: PtySession): { top: number; bottom: number; rows: string[] } | null {
  const rows = promptBox(s);
  if (rows.length === 0) return null;
  const screen = s.screenText();
  for (let top = screen.length - rows.length; top >= 0; top--) {
    if (rows.every((row, i) => screen[top + i] === row)) return { top, bottom: top + rows.length - 1, rows };
  }
  return null;
}

/** The screen rows from `top` to `bottom` of a framed box whose top border matches `title`. */
function boxPlace(s: PtySession, title: RegExp): { top: number; bottom: number } {
  const top = rowOf(s, title);
  return { top, bottom: top + boxRows(s, title).length - 1 };
}

const overlayClosed = (s: PtySession) => !/^╭─ (Commands|Slash commands|Mode|Keys) \d+/m.test(s.screenText().join("\n"));

describe("the lists after Marcus's look (task 12.7)", () => {
  for (const [cols, rows] of [
    [63, 21],
    [61, 20],
  ] as const) {
    test(`In the prompt box's place at ${cols}x${rows}: Ctrl+P over a two-line draft ends on the prompt box's bottom border row and covers every row of it; after Esc the prompt box is back on the same rows with the same draft, and typing goes on at its end`, async () => {
      const run = start({ scenario: "config-options", cols, rows });
      await run.s.waitFor(READY, 10000);
      run.s.sendKeys({ text: "first line" }, "Shift+Enter", { text: "second" });
      await run.s.waitFor(() => promptText(run.s).join("\n") === "first line\nsecond", 3000);
      await run.s.flush();
      const before = promptPlace(run.s)!;
      expect(before).not.toBeNull();
      run.s.sendKeys("Ctrl+P");
      await run.s.waitFor(/Commands \d+/, 3000);
      await run.s.flush();
      const list = boxPlace(run.s, /^╭─ Commands \d+/);
      expect(list.bottom).toBe(before.bottom);
      expect(run.s.screenText()[list.bottom]).toMatch(/^╰─ ↑↓ select/);
      expect(list.top).toBeLessThanOrEqual(before.top);
      expect(list.bottom - list.top + 1).toBeLessThanOrEqual(rows - 4);
      const screen = run.s.screenText();
      for (let y = before.top; y <= before.bottom; y++) {
        expect(screen[y]).toMatch(/^[╭│╰]/);
        expect(screen[y]).not.toContain("first line");
        expect(screen[y]).not.toContain("second");
      }
      // The pills are covered too; the status row stays below.
      expect(screen.join("\n")).not.toContain("Mode Ask");
      expect(statusRow(run.s)).toMatch(/idle/);
      run.s.sendKeys("Esc");
      await run.s.waitFor(() => overlayClosed(run.s), 3000);
      await run.s.flush();
      expect(promptPlace(run.s)).toEqual(before);
      run.s.sendKeys({ text: "!" });
      await run.s.waitFor(() => promptText(run.s).join("\n") === "first line\nsecond!", 3000);
    }, 20000);
  }

  test("`?` and `/` lists in the prompt box's place at 63x21: each ends on the prompt box's bottom border row and covers it; Esc leaves the prompt box on its rows with the character", async () => {
    const run = start({ scenario: "config-options" });
    await run.s.waitFor(READY, 10000);
    await run.s.flush();
    const before = promptPlace(run.s)!;
    run.s.sendKeys({ text: "?" });
    await run.s.waitFor(/Commands \d+/, 3000);
    await run.s.flush();
    let list = boxPlace(run.s, /^╭─ Commands \d+/);
    expect(list.bottom).toBe(before.bottom);
    expect(list.top).toBeLessThanOrEqual(before.top);
    run.s.sendKeys("Esc");
    await run.s.waitFor(() => overlayClosed(run.s) && promptText(run.s).join("") === "?", 3000);
    expect(promptPlace(run.s)).toMatchObject({ top: before.top, bottom: before.bottom });
    run.s.sendKeys("Backspace");
    await run.s.waitFor(() => promptText(run.s).join("") === "", 3000);
    run.s.sendKeys({ text: "/" });
    await run.s.waitFor(/Slash commands \d+/, 3000);
    await run.s.flush();
    // The slash menu is longer than the prompt box (the agent's commands and acp-tui's), so it
    // ends on the same bottom border row and covers the box.
    list = boxPlace(run.s, /^╭─ Slash commands \d+/);
    expect(list.bottom).toBe(before.bottom);
    expect(list.top).toBeLessThanOrEqual(before.top);
    run.s.sendKeys("Esc");
    await run.s.waitFor(() => overlayClosed(run.s) && promptText(run.s).join("") === "/", 3000);
    expect(promptPlace(run.s)).toMatchObject({ top: before.top, bottom: before.bottom });
  }, 20000);

  test("Picker shorter than the prompt box: over a five-line draft at 63x21 (eight rows with the padding row), the four-choice mode picker is as tall as the prompt box and covers it; after a choice the prompt box shows the five lines on the same rows, with the new mode in its pill", async () => {
    const run = start({ scenario: "config-options" });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "one" }, "Shift+Enter", { text: "two" }, "Shift+Enter", { text: "three" }, "Shift+Enter", { text: "four" }, "Shift+Enter", { text: "five" });
    await run.s.waitFor(() => promptText(run.s).length === 5, 3000);
    await run.s.flush();
    const before = promptPlace(run.s)!;
    expect(before.bottom - before.top + 1).toBe(8);
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Commands \d+/, 3000);
    // `choose the mode` alone matches the model too.
    run.s.sendKeys({ text: "choose the mode ask" });
    await run.s.waitFor(/Commands 1 /, 3000);
    run.s.sendKeys("Enter");
    await run.s.waitFor(/Mode 4 /, 3000);
    await run.s.flush();
    expect(boxPlace(run.s, /^╭─ Mode 4 /)).toEqual({ top: before.top, bottom: before.bottom });
    const picker = boxRows(run.s, /^╭─ Mode 4 /).slice(1, -1).map(inner);
    expect(picker).toEqual(["● Ask", "  Plan", "  Accept edits", "  Auto", "", ""]);
    for (let y = before.top; y <= before.bottom; y++) expect(run.s.screenText()[y]).not.toMatch(/\b(one|two|three|four|five)\b/);
    run.s.sendKeys("Down", "Enter");
    await run.s.waitFor(() => overlayClosed(run.s) && /\bPlan\b/.test(bottomBorder(run.s)), 5000);
    await run.s.flush();
    expect(promptPlace(run.s)).toMatchObject({ top: before.top, bottom: before.bottom });
    expect(promptText(run.s)).toEqual(["one", "two", "three", "four", "five"]);
    expect(params(run, "session/set_config_option")).toEqual([expect.objectContaining({ configId: "mode", value: "plan" })]);
  }, 20000);

  // Skipped on Windows: it needs the terminal's OSC 10/11 colour replies (derived surfaces, light theme), which ConPTY never passes on (it passes only OSC 4).
  test.skipIf(WINDOWS)("Instructions apart from the entries: with OSC 10 and 11 answered, every cell of the palette outside the selected entry is on the default background (no surface.overlay fill), no character of the draft shows through, the frame is the prompt box's in its accent colour, and the instructions in the bottom border are muted", async () => {
    const run = start({ scenario: "config-options", colours: DARK, env: { COLORTERM: "truecolor" } });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "hello there" });
    await run.s.waitFor(() => promptText(run.s).join("") === "hello there", 3000);
    await run.s.flush();
    const cell = (y: number, x: number) => run.s.cell(run.s.term.buffer.active.baseY + y, x)!;
    const fg = (y: number, x: number) => `${cell(y, x).getFgColorMode()}:${cell(y, x).getFgColor()}`;
    const before = promptPlace(run.s)!;
    // The prompt box's frame while it has focus: `╭` in the accent colour.
    const frameFg = fg(before.top, 0);
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Commands \d+/, 3000);
    const selected = rowOf(run.s, "Choose the model");
    // The surfaces are derived once the selected entry is on its `surface.cursor` fill.
    await run.s.waitFor(() => !cell(selected, 30).isBgDefault(), 3000);
    const list = boxPlace(run.s, /^╭─ Commands \d+/);
    for (let y = list.top; y <= list.bottom; y++) {
      if (y === selected) continue;
      for (let x = 0; x < 63; x++) expect(cell(y, x).isBgDefault()).toBeTruthy();
    }
    const screen = run.s.screenText();
    expect(screen.join("\n")).not.toContain("hello");
    // The prompt box's rounded frame, in the same colour as the focused prompt box's.
    expect(screen[list.top]![0]).toBe("╭");
    expect(screen[list.bottom]![0]).toBe("╰");
    expect(fg(list.top, 0)).toBe(frameFg);
    expect(fg(list.bottom, 0)).toBe(frameFg);
    expect(fg(list.top + 3, 0)).toBe(frameFg);
    // The instructions, muted as the key labels are, in the bottom border.
    const hint = screen[list.bottom]!.indexOf("↑↓ select");
    expect(hint).toBeGreaterThan(0);
    const keyRow = rowOf(run.s, "Next mode");
    const keyAt = screen[keyRow]!.indexOf("shift+tab");
    expect(fg(list.bottom, hint + 3)).toBe(fg(keyRow, keyAt));
    expect(fg(list.bottom, hint + 3)).not.toBe(frameFg);
  }, 20000);

  test("Routes for keyless entries (day-two-feedback task 13.7): `Interrupt the turn` shows esc esc and the three pickers `click the pill`, the cycle keys stay on their own entries, the density cycle says where `v` works, and there are no single-density entries; `Open the session list` nothing", async () => {
    const run = start({ scenario: "config-options" });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Commands \d+/, 3000);
    const all = await allRows(run.s, "Commands");
    for (const entry of [
      /^Interrupt the turn +esc esc$/,
      /^Choose the mode +Ask {2}click the pill$/,
      /^Choose the thinking level +Medium {2}click the pill$/,
      /^Choose the model +Fake Aurora {2}click the pill$/,
      /^Next mode +shift\+tab$/,
      /^Next thinking level +ctrl\+t$/,
      /^Cycle the density +v$/,
    ]) {
      expect(all).toContainEqual(expect.stringMatching(entry));
    }
    expect(all.filter((r) => r.startsWith("Density:"))).toEqual([]);
    expect(all).toContain("Open the session list");
  }, 30000);

  test("Routes follow the key map: with the mode on Alt+M and Shift+Tab unbound, and the mouse off, the mode cycle shows Alt+M and the pickers no route", async () => {
    const run = startCli("config-options", 0, {
      cols: 63,
      rows: 21,
      entry: KEYMAP_CLI,
      args: ["--mouse", "off"],
      env: { ACP_TUI_TEST_KEYMAP: JSON.stringify({ global: { "shift+tab": null, "meta+m": "cycleMode" } }) },
    });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Commands \d+/, 3000);
    await run.s.flush();
    const rows = listRows(run.s, "Commands");
    expect(rows).toContainEqual(expect.stringMatching(/^Next mode +alt\+m$/));
    expect(rows).toContainEqual(expect.stringMatching(/^Choose the mode +Ask$/));
    expect(rows).toContainEqual(expect.stringMatching(/^Choose the model +Fake Aurora$/));
  }, 20000);

  test("Sections apart: with an empty filter the first group header is the list's first row and every later header has exactly one blank row above it", async () => {
    const run = start({ scenario: "config-options", rows: 70 });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Commands \d+/, 3000);
    await run.s.flush();
    const list = listRows(run.s, "Commands");
    const headers = { includes: (row: string) => isPaletteHeading(row) };
    const at = list.map((row, i) => (headers.includes(row) ? i : -1)).filter((i) => i >= 0);
    // The whole list is in view: every entry the count names.
    expect(list.filter((row) => row !== "" && !headers.includes(row)).length).toBe(Number(/Commands (\d+)/.exec(run.s.screenText().join("\n"))![1]));
    expect(at.length).toBeGreaterThanOrEqual(3);
    expect(at[0]).toBe(0);
    for (const i of at.slice(1)) {
      expect(list[i - 1]).toBe("");
      expect(list[i - 2]).not.toBe("");
    }
    // No blank row anywhere else.
    expect(list.filter((row) => row === "").length).toBe(at.length - 1);
  }, 20000);
});

/** A key label with an upper-case letter, as acp-tui drew them until task 12.8 (`Ctrl+F`,
 *  `Shift+Tab`, `Esc`, `Enter`, `Tab`, `PgUp`, `F1`). */
const TITLE_CASE_KEY = /\b(Ctrl|Shift|Alt|Super)\+|\b(Esc|Enter|Tab|PgUp|PgDn|F\d{1,2})\b/;
const PALETTE_HEADERS = { includes: (row: string) => isPaletteHeading(row) };

describe("the lists after Marcus's second look (task 12.8)", () => {
  test("Heading not matched: `?` then `session` lists only the entries whose own text holds `session`, under the Session header; no other entry of the Session group, and no header without a match", async () => {
    const run = start({ scenario: "config-options", cols: 80, rows: 30 });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "?" });
    await run.s.waitFor(/Commands \d+/, 3000);
    const all = await allRows(run.s, "Commands");
    const sessionGroup = all.slice(all.indexOf("Session") + 1, all.indexOf("Conversation")).filter((r) => r !== "");
    // The Session group holds entries that do not mention a session (find, detach and more).
    expect(sessionGroup.filter((r) => !/session/i.test(r)).length).toBeGreaterThan(3);
    run.s.sendKeys({ text: "session" });
    await run.s.waitFor(() => /^› session/.test(inner(boxRows(run.s, "Commands")[1] ?? "")), 3000);
    // The filtered list in full: under ConPTY a frame can arrive in parts.
    await run.s.waitFor(() => listRows(run.s, "Commands").some((r) => r === "Open the session list"), 3000);
    await run.s.flush();
    const shown = listRows(run.s, "Commands").filter((r) => r !== "");
    // Headers are kept above their matching entries, and are never matched themselves.
    expect(shown[0]).toBe("Session");
    expect(shown).toContainEqual(expect.stringMatching(/^Open the session list$/));
    shown.forEach((row, i) => {
      if (PALETTE_HEADERS.includes(row)) {
        // A header is followed by an entry of its own group that matches.
        expect(shown[i + 1]).toMatch(/session/i);
        return;
      }
      expect(row).toMatch(/session/i);
    });
    // The count in the top border is the entries, not the headers.
    const count = Number(/Commands (\d+)/.exec(boxRows(run.s, "Commands")[0] ?? "")?.[1]);
    expect(count).toBe(shown.filter((r) => !PALETTE_HEADERS.includes(r)).length);
  }, 30000);

  test("Lower-case keys: the status row's hints, the splash, the `?` list and key help name every key in lower case (`shift+tab`, `ctrl+d`, `esc esc`, `ctrl+f`, `f1`)", async () => {
    const run = start({ scenario: "config-options", cols: 120, rows: 30 });
    await run.s.waitFor(READY, 10000);
    await run.s.waitFor(() => run.s.screenText().join("\n").includes("esc esc interrupt"), 5000);
    await run.s.flush();
    // The status row and the splash (the conversation region while the session has no items).
    expect(statusRow(run.s)).toContain("shift+tab mode  / commands  ? help  ctrl+d detach");
    const screen = run.s.screenText().join("\n");
    for (const hint of ["enter send", "shift+enter newline", "esc esc interrupt", "ctrl+d detach"]) expect(screen).toContain(hint);
    expect(screen).not.toMatch(TITLE_CASE_KEY);
    // The `?` list: keys, routes and the close key.
    run.s.sendKeys({ text: "?" });
    await run.s.waitFor(/Commands \d+/, 3000);
    expect(boxRows(run.s, "Commands")[0]).toMatch(/ esc ─╮$/);
    const commands = await allRows(run.s, "Commands");
    expect(commands).toContainEqual(expect.stringMatching(/^Find in the conversation +ctrl\+f$/));
    expect(commands).toContainEqual(expect.stringMatching(/^Interrupt the turn +esc esc$/));
    expect(commands).toContainEqual(expect.stringMatching(/^Next mode +shift\+tab$/));
    for (const row of commands) expect(row).not.toMatch(TITLE_CASE_KEY);
    run.s.sendKeys("Esc");
    await run.s.waitFor(() => overlayClosed(run.s), 3000);
    run.s.sendKeys("Backspace");
    await run.s.waitFor(() => promptText(run.s).join("") === "", 3000);
    // Key help: every binding, the routes for kept keys and the selection's wording.
    run.s.sendKeys("F1");
    await run.s.waitFor(/Keys \d+/, 3000);
    const help = await allRows(run.s, /Keys \d+/);
    expect(help).toContainEqual(expect.stringMatching(/^Send the prompt +enter$/));
    expect(help).toContainEqual(expect.stringMatching(/^Key help +f1$/));
    expect(help).toContainEqual(expect.stringMatching(/^Kept by Zed: the effort pill, the palette +ctrl\+t$/));
    for (const row of help) expect(row).not.toMatch(TITLE_CASE_KEY);
  }, 40000);

  test("Mode hint with a draft: once the prompt box holds a draft the `/` and `?` hints leave and `shift+tab mode` stays", async () => {
    const run = start({ scenario: "config-options", cols: 120, rows: 30 });
    await run.s.waitFor(READY, 10000);
    await run.s.waitFor(() => statusRow(run.s).includes("shift+tab mode  / commands  ? help  ctrl+d detach"), 5000);
    run.s.sendKeys({ text: "hello" });
    await run.s.waitFor(() => !statusRow(run.s).includes("/ commands"), 3000);
    const row = statusRow(run.s);
    expect(row).toContain("shift+tab mode");
    expect(row).not.toContain("? help");
    expect(row).not.toContain("ctrl+d detach");
    // Emptied again, the four hints are back.
    run.s.sendKeys("Backspace", "Backspace", "Backspace", "Backspace", "Backspace");
    await run.s.waitFor(() => statusRow(run.s).includes("shift+tab mode  / commands  ? help  ctrl+d detach"), 3000);
  }, 20000);
});

describe("Cut, Undo and Redo as palette entries (day-two-feedback task 12.3)", () => {
  /** Opens the palette with Ctrl+P, filters to `word` and runs the first match. */
  async function runEntry(run: ChromeRun, word: string, opener: "Ctrl+P" | "?" = "Ctrl+P"): Promise<void> {
    if (opener === "?") run.s.sendKeys({ text: "?" });
    else run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Commands \d+/, 3000);
    run.s.sendKeys({ text: word });
    await run.s.waitFor(() => new RegExp(`^› ${word}`).test(inner(boxRows(run.s, "Commands")[1] ?? "")), 3000);
    run.s.sendKeys("Enter");
    await run.s.waitFor(() => !paletteOpen(run.s), 3000);
  }

  test("The Prompt group lists Cut, Undo and Redo, from the prompt box and from the conversation, with their keys and the IDE-proof alternative for redo", async () => {
    const run = start({ scenario: "config-options", cols: 80, rows: 40 });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "hello world" });
    await run.s.waitFor((p) => promptText(p)[0] === "hello world", 5000);
    for (const focus of ["prompt", "conversation"]) {
      if (focus === "conversation") {
        run.s.sendKeys("Tab");
        await Bun.sleep(300);
      }
      run.s.sendKeys("Ctrl+P");
      await run.s.waitFor(/Commands \d+/, 3000);
      const all = await allRows(run.s, "Commands");
      expect(all).toContainEqual(expect.stringMatching(/^Cut the selection +ctrl\+x$/));
      expect(all).toContainEqual(expect.stringMatching(/^Undo the last edit +ctrl\+z super\+z$/));
      expect(all).toContainEqual(expect.stringMatching(/^Redo the edit +ctrl\+y ctrl\+shift\+z shift\+super\+z$/));
      run.s.sendKeys("Esc");
      await run.s.waitFor(() => !paletteOpen(run.s), 3000);
    }
  }, 40000);

  test("Running them from the palette acts on the prompt box: Undo takes the typing back, Redo restores it, Cut removes the selection (and says that no clipboard took it)", async () => {
    const run = start({ scenario: "config-options", cols: 80, rows: 40 });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "hello world" });
    await run.s.waitFor((p) => promptText(p)[0] === "hello world", 5000);
    await Bun.sleep(1200);
    // Undo goes back a word at a time.
    await runEntry(run, "undo");
    await run.s.waitFor((p) => promptText(p)[0] === "hello", 5000);
    await runEntry(run, "undo");
    await run.s.waitFor((p) => (promptText(p)[0] ?? "") === "", 5000);
    await runEntry(run, "redo", "?");
    await run.s.waitFor((p) => promptText(p)[0] === "hello", 5000);
    await runEntry(run, "redo");
    await run.s.waitFor((p) => promptText(p)[0] === "hello world", 5000);
    run.s.sendKeys({ text: "\x1b[1;2D".repeat(5) });
    await Bun.sleep(300);
    await runEntry(run, "cut");
    await run.s.waitFor((p) => promptText(p)[0] === "hello", 5000);
    // And the prompt box has the keyboard again.
    run.s.sendKeys({ text: "x" });
    await run.s.waitFor((p) => promptText(p)[0] === "hello x", 5000);
  }, 40000);
});
