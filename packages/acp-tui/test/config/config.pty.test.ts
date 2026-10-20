// mvp-configuration tasks 2.1, 2.3, 2.4 and 3.2, under the PTY harness: the real
// CLI against fake-agent, with a configuration home and a session directory of
// its own per test (spec tui-config "Configuration file", "What a project file
// may set", "Precedence of settings" and "Live reload").
//
// The timing tests of this file are in config.pty.timing.test.ts (parallel-tests: they run in the serial pass).
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FINAL_RESET } from "../../src/renderer/lifecycle.ts";
import { CARD_HEADER, promptText, READY, statusRow } from "../pty/regions.ts";
import { temp, configHome, start, problemsLogged, disposeSession } from "./config-pty-helpers.ts";

afterEach(disposeSession);

describe("Configuration file (task 2.1)", () => {
  test("XDG location: a JSONC file with a comment and a trailing comma setting mouse off starts with no mouse reporting mode enabled", async () => {
    const cfg = configHome();
    writeFileSync(cfg.file, `{ // keyboard only\n  "mouse": "off", }\n`);
    const run = start({ home: cfg.home });
    await run.s.waitFor(READY, 10000);
    await run.s.waitFor(() => run.events("config_loaded").length === 1, 5000);
    expect(run.s.mouseModesSet()).toEqual([]);
    expect(problemsLogged(run)).toEqual([]);
    expect(run.events("config_loaded")[0]?.["files"]).toMatchObject({ user: cfg.file, project: null });
  }, 20000);

  test("No file: every setting has its default (mouse reporting on) and no configuration notice is shown", async () => {
    const cfg = configHome();
    const run = start({ home: cfg.home });
    await run.s.waitFor(READY, 10000);
    await run.s.waitFor(() => run.events("config_loaded").length === 1, 5000);
    expect(run.s.mouseModesSet()).toContain(1000);
    expect(problemsLogged(run)).toEqual([]);
    const shown = run.s.screenText().join("\n");
    expect(shown).not.toContain("configuration:");
    expect(shown).not.toContain("? configuration)");
  }, 20000);
});

describe("What a project file may set (task 2.3)", () => {
  test("Agent in a project file: evil is not a known harness, nothing is launched from it, the problem names agent_servers, and the rest of the file applies", async () => {
    const cfg = configHome();
    const project = temp("acp-tui-project-");
    const marker = join(project, "evil-ran");
    writeFileSync(join(project, ".acp-tui.jsonc"), JSON.stringify({ agent_servers: { evil: { command: "touch", args: [marker] } }, glyphs: "ascii", mouse: "off" }));

    // -a evil: refused before anything is launched.
    const refused = start({ home: cfg.home, dir: project, agent: ["-a", "evil"] });
    expect(await refused.s.wait(10000)).not.toBe(0);
    expect(refused.s.rawOutput()).toContain("'evil' is not a known harness");
    expect(existsSync(marker)).toBe(false);
    await refused.s.dispose();

    // A session in that directory: the problem is reported, and the allowed settings apply.
    const run = start({ home: cfg.home, dir: project });
    await run.s.waitFor(READY, 10000);
    await run.s.waitFor(() => run.events("config_loaded").length === 1, 5000);
    expect(problemsLogged(run)).toEqual([expect.objectContaining({ path: "agent_servers", severity: "error", file: join(project, ".acp-tui.jsonc") })]);
    // The notice in the prompt box's top border (cut to its width).
    await run.s.waitFor((p) => p.screenText().join("\n").includes(".acp-tui.jsonc:1:2: agent_servers is not allowed"), 5000);
    // `mouse: off` from the project file applied (glyph sets are drawn from the setting by task 7.1).
    expect(run.s.mouseModesSet()).toEqual([]);
    expect(existsSync(marker)).toBe(false);
  }, 30000);

  test("Card keys in a project file: escape bound to choose2 in the card context is ignored and reported, and Esc on a focused card keeps its meaning", async () => {
    const cfg = configHome();
    const project = temp("acp-tui-project-");
    writeFileSync(join(project, ".acp-tui.jsonc"), JSON.stringify({ keys: { card: { escape: "choose2" } } }));
    const run = start({ home: cfg.home, dir: project, cols: 100, rows: 40 });
    await run.s.waitFor(READY, 10000);
    await run.s.waitFor(() => run.events("config_loaded").length === 1, 5000);
    expect(problemsLogged(run)).toEqual([expect.objectContaining({ path: "keys.card", severity: "error" })]);
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor(CARD_HEADER, 5000);
    await Bun.sleep(400); // the card's 300 ms guard
    run.s.sendKeys("Tab");
    await run.s.waitFor((p) => /select/.test(statusRow(p)), 5000);
    run.s.sendKeys("Esc");
    // Esc returns focus to the prompt box (and arms interrupt, tui-keymap "Escape") and answers
    // nothing: the card stays open.
    await run.s.waitFor((p) => !/select/.test(statusRow(p)), 5000);
    await Bun.sleep(300);
    expect(run.agentMethods()).not.toContain("session/request_permission/response");
    expect(run.s.screenText().join("\n")).toContain(CARD_HEADER);
  }, 30000);

  test("a session started with a directory argument reads that directory's project file", async () => {
    const cfg = configHome();
    const project = temp("acp-tui-project-");
    writeFileSync(join(project, ".acp-tui.jsonc"), `{ "mouse": "off" }`);
    const run = start({ home: cfg.home, args: [project] });
    await run.s.waitFor(READY, 10000);
    await run.s.waitFor(() => run.events("config_loaded").length === 1, 5000);
    expect(run.events("config_loaded")[0]?.["files"]).toMatchObject({ project: join(project, ".acp-tui.jsonc") });
    expect(run.s.mouseModesSet()).toEqual([]);
  }, 20000);
});

describe("Precedence of settings (task 2.4)", () => {
  test("Command line wins: the user's file sets mouse off and acp-tui --mouse wheel uses wheel", async () => {
    const cfg = configHome();
    writeFileSync(cfg.file, `{ "mouse": "off" }`);
    const run = start({ home: cfg.home, args: ["--mouse", "wheel"] });
    await run.s.waitFor(READY, 10000);
    await run.s.waitFor((p) => /\bwheel\b/.test(statusRow(p)), 5000);
    // Wheel and buttons reported (1000, 1006), no all-motion (1003, which only `full` turns on).
    expect(run.s.mouseModesSet()).toContain(1000);
    expect(run.s.mouseModesSet()).not.toContain(1003);
    expect(run.events("config_loaded")[0]?.["pinned"]).toEqual(["mouse"]);
  }, 20000);

  test("Reload keeps the option: with --exit-print transcript, a file edited to print none still prints the transcript on exit", async () => {
    const cfg = configHome();
    writeFileSync(cfg.file, `{}`);
    const run = start({ home: cfg.home, args: ["--exit-print", "transcript"], scenario: "copy-fixtures" });
    await run.s.waitFor(READY, 10000);
    const prompt = "give me things to copy";
    run.s.sendKeys({ text: prompt });
    await run.s.waitFor((p) => (promptText(p)[0] ?? "").startsWith(prompt), 5000);
    run.s.sendKeys("Enter");
    await run.s.waitFor((p) => /end turn/.test(p.screenText().join("\n")) && READY.test(p.screenText().join("\n")), 15000);
    cfg.write(`{ "exit": { "print": "none" }, "density": "verbose" }`);
    await run.s.waitFor(() => run.events("config_reload").length >= 1, 3000);
    expect(run.events("config_reload")[0]?.["changed"]).toEqual(["density"]);
    run.s.sendKeys("Ctrl+D");
    expect(await run.s.wait(10000)).toBe(0);
    const raw = run.s.rawOutput();
    const after = raw.slice(raw.lastIndexOf(FINAL_RESET) + FINAL_RESET.length);
    expect(after).toContain(prompt);
  }, 30000);
});
