// The two lists (spec tui-palette "Opening the palette", "Agent commands in
// the slash menu" and "acp-tui commands in the slash menu"; mvp-chrome-and-keys
// task 12.1, Marcus, 11 October 2026, design D8; day-one-feedback task 10):
// `/` in the empty prompt box opens the slash menu, the agent's commands first
// (a line naming `?` while the agent has none) and then acp-tui's own under
// their group, `?` at the start of an empty
// prompt box opens acp-tui's own commands and shortcuts, and Ctrl+P opens the
// same list as `?`. The opening character is consumed, and the first Esc closes
// either list and leaves it in the prompt box as text; in a draft both are
// text. `/` opened the one palette from 3 October 2026 (phase-1a S6, product
// since task 6.3) until then. The real CLI against fake-agent at 63x21, without
// `--spike`: `config-options` (the agent's `review` and `compact`) and `basic`
// (no commands).
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { configEnv } from "../pty/config-home.ts";
import { startPty, type PtySession } from "../pty/harness.ts";
import { promptBox, promptText, READY, statusRow } from "../pty/regions.ts";
import { tempDir } from "../keys/cli-pty.ts";
import { boxRows, inner, startChrome, type ChromeRun } from "./cli.ts";

const CLI = join(import.meta.dir, "../../src/cli.ts");
const SLASH_AGENT = join(import.meta.dir, "slash-agent.ts");

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

function start(scenario = "config-options", opts: { cols?: number; env?: Record<string, string | undefined> } = {}): ChromeRun {
  const run = startChrome({ scenario, ...opts });
  session = run.s;
  return run;
}

/** The command palette (`?`, Ctrl+P) and the agent's commands (`/`). */
const palette = (s: PtySession) => boxRows(s, "Commands");
const paletteOpen = (s: PtySession) => palette(s).length > 0;
const agentList = (s: PtySession) => boxRows(s, "Slash commands");
const agentOpen = (s: PtySession) => agentList(s).length > 0;
/** A list's rows inside its frame, without the blank rows that pad a short list to the prompt box's
 *  height (task 12.7). */
const listRows = (rows: string[]) => {
  const list = rows.slice(2, -1).map(inner);
  while (list.length > 0 && list.at(-1) === "") list.pop();
  return list;
};
/** The prompt box's text, its rows joined. */
const draft = (s: PtySession) => promptText(s).join("\n").trim();
const sentPrompts = (run: ChromeRun) => run.agent().filter((e) => e.method === "session/prompt");

describe("`/` opens the slash menu (task 12.1; day-one-feedback task 10)", () => {
  test("Slash in an empty prompt box: the agent's commands first, then acp-tui's, with an empty filter; Agent slash command typed as text: Esc leaves `/`, then `s7` and Enter send `/s7`", async () => {
    // 90 columns: at 63 the border has no room left for the `esc types /` hint after the completion hints.
    const run = start("config-options", { cols: 90 });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "/" });
    await run.s.waitFor(() => listRows(agentList(run.s)).some((r) => r.startsWith("/compact")), 3000);
    await run.s.flush();
    const rows = agentList(run.s);
    // The slash was consumed: the filter is empty (its placeholder shows).
    expect(inner(rows[1]!)).toContain("type to filter the commands");
    // The agent's commands under no header, then a blank row and acp-tui's under their group.
    const list = listRows(rows);
    expect(list.slice(0, 5)).toEqual([
      expect.stringMatching(/^\/review {2}Review a pull request$/),
      expect.stringMatching(/^\/compact {2}Compact the conversation$/),
      "",
      "acp-tui",
      expect.stringMatching(/^\/model {2}Choose the model/),
    ]);
    expect(list.filter((r) => r.startsWith("/")).map((r) => r.split(/\s/)[0])).toEqual(["/review", "/compact", "/model", "/mode", "/effort", "/sessions", "/find", "/export", "/add-dir", "/help", "/exit"]);
    expect(rows[0]).toMatch(/Slash commands 11 /);
    expect(paletteOpen(run.s)).toBe(false);
    // The border names what Esc does.
    expect(rows.at(-1)).toContain("esc types /");

    run.s.sendKeys("Esc");
    await run.s.waitFor(() => !agentOpen(run.s), 3000);
    await run.s.waitFor(() => draft(run.s) === "/", 3000);
    // The `/` is text now: the next keys type after it, and no list opens.
    run.s.sendKeys({ text: "s7" });
    await run.s.waitFor(() => draft(run.s) === "/s7", 3000);
    expect(agentOpen(run.s)).toBe(false);
    run.s.sendKeys("Enter");
    // Sent as prompt text: the user card shows it, and the prompt box is empty again.
    await run.s.waitFor(() => run.s.screenText().some((r) => r.includes("/s7")) && draft(run.s) === "", 5000);
    await run.s.waitFor(READY, 5000);
    expect(sentPrompts(run)).toHaveLength(1);

    // In the empty prompt box again, `/` opens the list again.
    run.s.sendKeys({ text: "/" });
    await run.s.waitFor(() => agentOpen(run.s), 3000);
  }, 30000);

  test("No agent commands: against `basic`, `/` opens a list whose first line names `?` for acp-tui's commands, with acp-tui's slash commands below; Esc leaves `/`", async () => {
    const run = start("basic");
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "/" });
    await run.s.waitFor(() => agentOpen(run.s), 3000);
    await run.s.flush();
    const rows = agentList(run.s);
    expect(rows[0]).toMatch(/Slash commands 6 /);
    // The note is a line of its own under the filter, not an entry; `basic` has no config
    // options, so /model, /mode and /effort are left out.
    expect(inner(rows[2]!)).toBe("the harness offers no commands; ? opens acp-tui's commands");
    const list = listRows(rows).slice(1);
    expect(list[0]).toBe("acp-tui");
    expect(list.slice(1).map((r) => r.split(/\s/)[0])).toEqual(["/sessions", "/find", "/export", "/add-dir", "/help", "/exit"]);
    expect(rows.join("\n")).not.toContain("no matches");
    expect(rows.join("\n")).not.toContain("/review");
    // Enter on the first entry runs it: /sessions opens the session list, and no prompt is sent.
    run.s.sendKeys("Esc");
    await run.s.waitFor(() => !agentOpen(run.s) && draft(run.s) === "/", 3000);
    expect(sentPrompts(run)).toHaveLength(0);
  }, 20000);

  test("in a draft `/` is text: `src/app` types; deleting back to empty makes `/` open the slash menu", async () => {
    const run = start();
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "src/app" });
    await run.s.waitFor(() => draft(run.s) === "src/app", 3000);
    expect(agentOpen(run.s)).toBe(false);
    for (let i = 0; i < "src/app".length; i++) run.s.sendKeys("Backspace");
    await run.s.waitFor(() => draft(run.s) === "", 3000);
    run.s.sendKeys({ text: "/" });
    await run.s.waitFor(() => agentOpen(run.s), 3000);
    run.s.sendKeys("Esc");
    await run.s.waitFor(() => !agentOpen(run.s), 3000);
    expect(draft(run.s)).toBe("/");
  }, 20000);

  test("Ctrl+P from the slash menu shows the command palette in its place", async () => {
    const run = start();
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "/" });
    await run.s.waitFor(() => agentOpen(run.s), 3000);
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(() => paletteOpen(run.s) && !agentOpen(run.s), 3000);
    expect(listRows(palette(run.s))[0]).toBe("Session");
    // Opened by Ctrl+P: Esc leaves nothing in the prompt box.
    run.s.sendKeys("Esc");
    await run.s.waitFor(() => !paletteOpen(run.s), 3000);
    await Bun.sleep(200);
    expect(draft(run.s)).toBe("");
  }, 20000);
});

describe("`?` and Ctrl+P open the command palette (task 12.1)", () => {
  test("Question mark in an empty prompt box: acp-tui's commands grouped with their keys, none of the agent's; Esc leaves the character: `?`, Esc, `?` reads `??`", async () => {
    const run = start();
    await run.s.waitFor(READY, 10000);
    // Wait for the agent's commands, so their absence below means something.
    await run.s.waitFor(() => run.agent().some((e) => e.method === "session/update/sent"), 5000);
    run.s.sendKeys({ text: "?" });
    await run.s.waitFor(/Commands \d+/, 3000);
    await run.s.flush();
    const rows = palette(run.s);
    expect(inner(rows[1]!)).toContain("type to filter commands");
    const list = listRows(rows);
    expect(list[0]).toBe("Session");
    expect(list).toContainEqual(expect.stringMatching(/^Next mode +shift\+tab$/));
    expect(rows.join("\n")).not.toContain("/review");
    expect(rows.at(-1)).toContain("esc types ?");
    // Filtered to the agent's command: nothing.
    run.s.sendKeys({ text: "/review" });
    await run.s.waitFor(/Commands 0 /, 3000);
    run.s.write("\x15");
    await run.s.waitFor(() => listRows(palette(run.s))[0] === "Session", 3000);

    run.s.sendKeys("Esc");
    await run.s.waitFor(() => !paletteOpen(run.s), 3000);
    await run.s.waitFor(() => draft(run.s) === "?", 3000);
    run.s.sendKeys({ text: "?" });
    await run.s.waitFor(() => draft(run.s) === "??", 3000);
    expect(paletteOpen(run.s)).toBe(false);
  }, 20000);

  test("Ctrl+P opens the same list: from the conversation, the entries `?` opens it with; Esc returns focus to the conversation", async () => {
    // 100 columns: the status row has room for the conversation's hints.
    const run = start("config-options", { cols: 100 });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "?" });
    await run.s.waitFor(/Commands \d+/, 3000);
    await run.s.flush();
    const fromQuestion = listRows(palette(run.s));
    const count = /Commands (\d+)/.exec(palette(run.s)[0]!)?.[1];
    run.s.sendKeys("Esc");
    await run.s.waitFor(() => !paletteOpen(run.s) && draft(run.s) === "?", 3000);
    run.s.sendKeys("Backspace");
    await run.s.waitFor(() => draft(run.s) === "", 3000);

    run.s.sendKeys({ text: "hello" }, "Enter");
    await run.s.waitFor(READY, 5000);
    run.s.sendKeys("Tab");
    await run.s.waitFor(() => statusRow(run.s).includes("toggle"), 3000);
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Commands \d+/, 3000);
    await run.s.flush();
    expect(/Commands (\d+)/.exec(palette(run.s)[0]!)?.[1]).toBe(count);
    expect(listRows(palette(run.s))).toEqual(fromQuestion);
    // Opened by Ctrl+P: the border names no character for Esc.
    expect(palette(run.s).at(-1)).not.toContain("esc types");
    run.s.sendKeys("Esc");
    await run.s.waitFor(() => !paletteOpen(run.s), 3000);
    // The conversation's own hints: it has focus again.
    await run.s.waitFor(() => statusRow(run.s).includes("toggle"), 3000);
  }, 20000);

  test("the model picker is reachable from the palette `?` opened, and applies the choice", async () => {
    const run = start();
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "?" });
    await run.s.waitFor(/Commands \d+/, 3000);
    run.s.sendKeys({ text: "model" });
    await run.s.waitFor(/Commands 1 /, 3000);
    run.s.sendKeys("Enter");
    await run.s.waitFor(/Model 20/, 3000);
    run.s.sendKeys({ text: "kest" });
    await run.s.waitFor(/Model 1 /, 3000);
    run.s.sendKeys("Enter");
    await run.s.waitFor(() => (promptBox(run.s).at(-1) ?? "").includes("Fake Kestrel"), 5000);
    expect(run.agent().filter((e) => e.method === "session/set_config_option").map((e) => e.params)).toEqual([
      expect.objectContaining({ configId: "model", value: "model-11" }),
    ]);
    // Closed by choosing, not Esc: nothing was left in the prompt box, and `?` opens it again.
    expect(draft(run.s)).toBe("");
    run.s.sendKeys({ text: "?" });
    await run.s.waitFor(/Commands \d+/, 3000);
  }, 20000);
});

describe("Opening the palette (mvp-chrome-and-keys tasks 6.3 and 12.1)", () => {
  test("Slash in a draft: `see a` then `/b` reads `see a/b` and no list opens", async () => {
    const run = start();
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "see a" });
    await run.s.waitFor(() => draft(run.s) === "see a", 3000);
    run.s.sendKeys({ text: "/b" });
    await run.s.waitFor(() => draft(run.s) === "see a/b", 3000);
    expect(agentOpen(run.s) || paletteOpen(run.s)).toBe(false);
  }, 20000);

  test("Question mark in a draft: `why` then `?` reads `why?` and no list opens", async () => {
    const run = start();
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "why" });
    await run.s.waitFor(() => draft(run.s) === "why", 3000);
    run.s.sendKeys({ text: "?" });
    await run.s.waitFor(() => draft(run.s) === "why?", 3000);
    await Bun.sleep(200);
    expect(agentOpen(run.s) || paletteOpen(run.s)).toBe(false);
  }, 20000);

  test("Esc closes: the palette opened by Ctrl+P from the prompt box with a draft closes on Esc, focus back in the prompt box, the draft unchanged", async () => {
    const run = start();
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "keep me" });
    await run.s.waitFor(() => draft(run.s) === "keep me", 3000);
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Commands \d+/, 3000);
    run.s.sendKeys("Esc");
    await run.s.waitFor(() => !paletteOpen(run.s), 3000);
    expect(draft(run.s)).toBe("keep me");
    run.s.sendKeys({ text: "!" });
    await run.s.waitFor(() => draft(run.s) === "keep me!", 3000);
  }, 20000);

  test("the status row names `/ commands` and `? help` while the prompt box has focus and is empty (120 columns: at 63 the hints give way)", async () => {
    const run = start("config-options", { cols: 120 });
    await run.s.waitFor(READY, 10000);
    await run.s.waitFor(() => statusRow(run.s).includes("ctrl+d detach"), 3000);
    expect(statusRow(run.s)).toContain("/ commands  ? help");
    run.s.sendKeys({ text: "x" });
    await run.s.waitFor(() => draft(run.s) === "x", 3000);
    await run.s.waitFor(() => !statusRow(run.s).includes("/ commands") && !statusRow(run.s).includes("? help"), 3000);
  }, 20000);
});

describe("acp-tui commands in the slash menu (day-one-feedback task 10)", () => {
  test("Choosing an acp-tui command: `/`, `mod`, Enter on /model opens the model picker in the overlay's place and sends no prompt", async () => {
    const run = start("config-options-models");
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "/" });
    await run.s.waitFor(() => agentOpen(run.s), 3000);
    run.s.sendKeys({ text: "mod" });
    // Only the entries that match: /model and /mode.
    await run.s.waitFor(/Slash commands 2 /, 3000);
    expect(listRows(agentList(run.s)).filter((r) => r.startsWith("/")).map((r) => r.split(/\s/)[0])).toEqual(["/model", "/mode"]);
    run.s.sendKeys("Enter");
    await run.s.waitFor(() => !agentOpen(run.s) && boxRows(run.s, "Model").length > 0, 5000);
    expect(sentPrompts(run)).toHaveLength(0);
    // Nothing is left in the prompt box, and Esc closes the picker.
    run.s.sendKeys("Esc");
    await run.s.waitFor(() => boxRows(run.s, "Model").length === 0, 3000);
    expect(draft(run.s)).toBe("");
  }, 30000);

  test("Exit typed: /exit typed and sent while idle detaches, as Ctrl+D does, and sends no prompt", async () => {
    const run = start("basic");
    await run.s.waitFor(READY, 10000);
    // Esc after `/` leaves it as text; the rest types after it.
    run.s.sendKeys({ text: "/" });
    await run.s.waitFor(() => agentOpen(run.s), 3000);
    run.s.sendKeys("Esc");
    await run.s.waitFor(() => draft(run.s) === "/", 3000);
    run.s.sendKeys({ text: "exit" });
    await run.s.waitFor(() => draft(run.s) === "/exit", 3000);
    run.s.sendKeys("Enter");
    expect(await run.s.wait(10000)).toBe(0);
    expect(sentPrompts(run)).toHaveLength(0);
  }, 30000);

  test("Arguments are text: /model sonnet is sent to the agent as a prompt", async () => {
    const run = start("config-options");
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "/" });
    await run.s.waitFor(() => agentOpen(run.s), 3000);
    run.s.sendKeys("Esc");
    await run.s.waitFor(() => draft(run.s) === "/", 3000);
    run.s.sendKeys({ text: "model sonnet" }, "Enter");
    await run.s.waitFor(() => sentPrompts(run).length === 1, 5000);
    // The user card shows the text that was sent, and no picker opened.
    await run.s.waitFor(() => run.s.screenText().some((r) => r.includes("/model sonnet")), 3000);
    expect(boxRows(run.s, "Model")).toEqual([]);
  }, 30000);
});

/** The bottom border of the open slash menu. */
const hintsOf = (s: PtySession): string => boxRows(s, "Slash commands").at(-1) ?? "";

describe("Completing a slash command (slash-command-completion)", () => {
  test("Tab on an agent command: `/`, `rev`, Tab closes the menu, sends nothing and leaves `/review ` with `PR number` as its placeholder; what is typed next follows the space", async () => {
    const run = start();
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "/" });
    await run.s.waitFor(() => listRows(agentList(run.s)).some((r) => r.startsWith("/review")), 3000);
    run.s.sendKeys({ text: "rev" });
    await run.s.waitFor(/Slash commands 1 /, 3000);
    run.s.sendKeys("Tab");
    await run.s.waitFor(() => !agentOpen(run.s) && (promptText(run.s)[0] ?? "").startsWith("/review PR number"), 3000);
    expect(sentPrompts(run)).toHaveLength(0);
    // The prompt box has focus: the next keys type after the completed name.
    run.s.sendKeys({ text: "12" });
    await run.s.waitFor(() => draft(run.s) === "/review 12", 3000);
    expect(sentPrompts(run)).toHaveLength(0);
  }, 30000);

  test("Tab on an acp-tui command: `/`, `mod`, Tab leaves `/model ` in the prompt box and opens no picker; Enter then opens the model picker, with no prompt sent", async () => {
    const run = start();
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "/" });
    await run.s.waitFor(() => agentOpen(run.s), 3000);
    run.s.sendKeys({ text: "mod" });
    await run.s.waitFor(/Slash commands 2 /, 3000);
    run.s.sendKeys("Tab");
    await run.s.waitFor(() => !agentOpen(run.s) && draft(run.s).startsWith("/model"), 3000);
    await run.s.flush();
    expect(boxRows(run.s, "Model")).toEqual([]);
    // The space after the name is there: the next characters follow it, no hint is drawn.
    run.s.sendKeys({ text: "x" });
    await run.s.waitFor(() => draft(run.s) === "/model x", 3000);
    run.s.sendKeys("Backspace");
    await run.s.waitFor(() => draft(run.s) === "/model", 3000);
    run.s.sendKeys("Enter");
    await run.s.waitFor(() => boxRows(run.s, "Model").length > 0, 5000);
    expect(sentPrompts(run)).toHaveLength(0);
  }, 30000);

  test("Nothing selected: a filter that matches no entry and Tab leave the menu open with its filter unchanged and the prompt box empty", async () => {
    const run = start();
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "/" });
    await run.s.waitFor(() => agentOpen(run.s), 3000);
    run.s.sendKeys({ text: "zzzq" });
    await run.s.waitFor(() => inner(agentList(run.s)[1] ?? "").includes("zzzq"), 3000);
    run.s.sendKeys("Tab");
    await run.s.flush();
    await Bun.sleep(300);
    expect(agentOpen(run.s)).toBe(true);
    expect(inner(agentList(run.s)[1]!)).toContain("zzzq");
    expect(sentPrompts(run)).toHaveLength(0);
    // Nothing was put in the prompt box: Esc leaves only the `/` that opened the menu.
    run.s.sendKeys("Esc");
    await run.s.waitFor(() => !agentOpen(run.s) && draft(run.s) === "/", 3000);
  }, 30000);

  test("Rebound key: with keys.slash setting tab to null and ctrl+l to complete, Tab in the slash menu completes nothing and Ctrl+L completes `/review `", async () => {
    const run = start("config-options", { env: configEnv({ keys: { slash: { tab: null, "ctrl+l": "complete" } } }) });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "/" });
    await run.s.waitFor(() => listRows(agentList(run.s)).some((r) => r.startsWith("/review")), 3000);
    run.s.sendKeys({ text: "rev" });
    await run.s.waitFor(/Slash commands 1 /, 3000);
    // The hint names the configured key and not Tab.
    expect(hintsOf(run.s)).toContain("ctrl+l complete");
    expect(hintsOf(run.s)).not.toContain("tab complete");
    run.s.sendKeys("Tab");
    await Bun.sleep(300);
    expect(agentOpen(run.s)).toBe(true);
    expect(inner(agentList(run.s)[1]!)).toContain("rev");
    run.s.sendKeys("Ctrl+L");
    await run.s.waitFor(() => !agentOpen(run.s) && (promptText(run.s)[0] ?? "").startsWith("/review PR number"), 3000);
    expect(sentPrompts(run)).toHaveLength(0);
  }, 30000);

  test("Session list keeps Tab: the list opened with `/sessions` switches to all directories on Tab", async () => {
    const run = start();
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "/" });
    await run.s.waitFor(() => agentOpen(run.s), 3000);
    run.s.sendKeys({ text: "sessions" });
    await run.s.waitFor(/Slash commands 1 /, 3000);
    run.s.sendKeys("Enter");
    await run.s.waitFor(() => boxRows(run.s, /Sessions in /).length > 0 && !agentOpen(run.s), 5000);
    expect(boxRows(run.s, /Sessions in /)[0]).not.toContain("all directories");
    run.s.sendKeys("Tab");
    await run.s.waitFor(() => (boxRows(run.s, /Sessions in /)[0] ?? "").includes("all directories"), 3000);
    // The prompt box was not completed into.
    run.s.sendKeys("Esc");
    await run.s.waitFor(() => boxRows(run.s, /Sessions in /).length === 0, 3000);
    expect(draft(run.s)).toBe("");
  }, 30000);

  test("Undo: Tab on `/review` and Ctrl+Z leave the prompt box empty (the completion is one undo step)", async () => {
    const run = start();
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "/" });
    await run.s.waitFor(() => listRows(agentList(run.s)).some((r) => r.startsWith("/review")), 3000);
    run.s.sendKeys({ text: "rev" });
    await run.s.waitFor(/Slash commands 1 /, 3000);
    run.s.sendKeys("Tab");
    await run.s.waitFor(() => !agentOpen(run.s) && (promptText(run.s)[0] ?? "").startsWith("/review"), 3000);
    run.s.sendKeys({ text: "\x1a" });
    await run.s.waitFor(() => draft(run.s) === "", 3000);
    expect(sentPrompts(run)).toHaveLength(0);
  }, 30000);
});

describe("The slash menu names its keys (slash-command-completion)", () => {
  test("Default hints: with an agent command selected the border reads `enter complete` and `tab complete`; with /help selected `enter run`; with /add-dir `enter complete`", async () => {
    const run = start("config-options", { cols: 90 });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "/" });
    await run.s.waitFor(() => listRows(agentList(run.s)).some((r) => r.startsWith("/review")), 3000);
    await run.s.waitFor(() => hintsOf(run.s).includes("enter complete") && hintsOf(run.s).includes("tab complete"), 3000);
    // The hints keep their order: select, enter, tab, clear, then the bypass.
    expect(hintsOf(run.s)).toMatch(/select · enter complete · tab complete · ctrl\+u clear · esc types \//);
    run.s.sendKeys({ text: "help" });
    await run.s.waitFor(() => hintsOf(run.s).includes("enter run"), 3000);
    expect(hintsOf(run.s)).toContain("tab complete");
    run.s.sendKeys({ text: "\x15" });
    run.s.sendKeys({ text: "add-dir" });
    await run.s.waitFor(() => hintsOf(run.s).includes("enter complete"), 3000);
  }, 30000);

  test("Narrow border: at 63 columns the bypass hint `esc types /` goes first and `tab complete` stays", async () => {
    const run = start();
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "/" });
    await run.s.waitFor(() => listRows(agentList(run.s)).some((r) => r.startsWith("/review")), 3000);
    await run.s.waitFor(() => hintsOf(run.s).includes("tab complete"), 3000);
    expect(hintsOf(run.s)).toContain("enter complete");
    expect(hintsOf(run.s)).not.toContain("esc types /");
  }, 30000);

  test("Key unbound: with keys.slash setting tab to null no `complete` key is named, and Enter's hint stays", async () => {
    const run = start("config-options", { cols: 90, env: configEnv({ keys: { slash: { tab: null } } }) });
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "/" });
    await run.s.waitFor(() => hintsOf(run.s).includes("enter complete"), 3000);
    expect(hintsOf(run.s)).not.toContain("tab complete");
  }, 30000);
});

/** acp-tui against slash-agent.ts, which records the exact text of every prompt it receives. */
function startSlashAgent(): { s: PtySession; prompts(): string[] } {
  const file = join(tempDir(), "prompts.jsonl");
  const s = startPty(["bun", CLI, "--", "--", "bun", SLASH_AGENT], { cols: 90, rows: 21, cwd: tempDir(), env: { SLASH_AGENT_PROMPTS: file } });
  session = s;
  return { s, prompts: () => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as string) : []) };
}
const slashMenu = (s: PtySession) => boxRows(s, "Slash commands");
const menuHas = (s: PtySession, name: string) => listRows(slashMenu(s)).some((r) => r.startsWith(name));

describe("Slash prompts as sent (slash-command-completion)", () => {
  test("Arguments for a command without input: `/`, `apply`, Enter, an argument, Enter sends one prompt, `/openspec-apply-change slash-command-completion`", async () => {
    const run = startSlashAgent();
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "/" });
    await run.s.waitFor(() => menuHas(run.s, "/openspec-apply-change"), 5000);
    run.s.sendKeys({ text: "apply" });
    await run.s.waitFor(/Slash commands 1 /, 3000);
    run.s.sendKeys("Enter");
    await run.s.waitFor(() => slashMenu(run.s).length === 0 && draft(run.s) === "/openspec-apply-change", 3000);
    expect(run.prompts()).toEqual([]);
    run.s.sendKeys({ text: "slash-command-completion" });
    await run.s.waitFor(() => draft(run.s) === "/openspec-apply-change slash-command-completion", 3000);
    run.s.sendKeys("Enter");
    await run.s.waitFor(() => run.prompts().length === 1, 5000);
    expect(run.prompts()).toEqual(["/openspec-apply-change slash-command-completion"]);
  }, 30000);

  test("Completed and sent: `/compact` chosen with Enter, then Enter again, reaches the agent as `/compact` with no trailing space", async () => {
    const run = startSlashAgent();
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "/" });
    await run.s.waitFor(() => menuHas(run.s, "/compact"), 5000);
    run.s.sendKeys({ text: "compact" });
    await run.s.waitFor(/Slash commands 1 /, 3000);
    run.s.sendKeys("Enter");
    await run.s.waitFor(() => slashMenu(run.s).length === 0 && draft(run.s) === "/compact", 3000);
    // Nothing was sent by the first Enter (this holds the whole window for it).
    await Bun.sleep(300);
    expect(run.prompts()).toEqual([]);
    run.s.sendKeys("Enter");
    await run.s.waitFor(() => run.prompts().length === 1, 5000);
    expect(run.prompts()).toEqual(["/compact"]);
  }, 30000);

  test("Tab then Enter sends the same: `/compact` completed with Tab and sent is `/compact`", async () => {
    const run = startSlashAgent();
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "/" });
    await run.s.waitFor(() => menuHas(run.s, "/compact"), 5000);
    run.s.sendKeys({ text: "compact" });
    await run.s.waitFor(/Slash commands 1 /, 3000);
    run.s.sendKeys("Tab");
    await run.s.waitFor(() => slashMenu(run.s).length === 0 && draft(run.s) === "/compact", 3000);
    run.s.sendKeys("Enter");
    await run.s.waitFor(() => run.prompts().length === 1, 5000);
    expect(run.prompts()).toEqual(["/compact"]);
  }, 30000);

  test("Other prompts untouched: `see the diff ` is sent with its trailing space", async () => {
    const run = startSlashAgent();
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "see the diff " }, "Enter");
    await run.s.waitFor(() => run.prompts().length === 1, 5000);
    expect(run.prompts()).toEqual(["see the diff "]);
  }, 30000);

  test("Completed command run: Tab on `/exit` and Enter detaches as Ctrl+D does (the agent advertises no `exit`), and sends no prompt", async () => {
    const run = startSlashAgent();
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "/" });
    await run.s.waitFor(() => menuHas(run.s, "/compact"), 5000);
    run.s.sendKeys({ text: "exit" });
    await run.s.waitFor(/Slash commands 1 /, 3000);
    run.s.sendKeys("Tab");
    await run.s.waitFor(() => slashMenu(run.s).length === 0 && draft(run.s) === "/exit", 3000);
    run.s.sendKeys("Enter");
    expect(await run.s.wait(10000)).toBe(0);
    expect(run.prompts()).toEqual([]);
  }, 30000);

  test("During a turn: Enter on `/compact` while a turn runs leaves `/compact ` in the prompt box and sends nothing", async () => {
    const run = startSlashAgent();
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "wait" }, "Enter");
    await run.s.waitFor(() => run.prompts().length === 1, 5000);
    await run.s.waitFor(/\brunning\b/, 5000);
    run.s.sendKeys({ text: "/" });
    await run.s.waitFor(() => menuHas(run.s, "/compact"), 5000);
    run.s.sendKeys({ text: "compact" });
    await run.s.waitFor(/Slash commands 1 /, 3000);
    run.s.sendKeys("Enter");
    await run.s.waitFor(() => slashMenu(run.s).length === 0 && draft(run.s) === "/compact", 3000);
    await Bun.sleep(300);
    expect(run.prompts()).toEqual(["wait"]);
  }, 30000);
});
