// mvp-configuration tasks 3.4, 6.3 and 8.1 under the PTY harness: the real CLI
// against fake-agent with a configuration home of its own per test (spec
// tui-layout "Declarative screen layout", "Bar modules" and "Protected chrome
// in configured layouts"; tui-config "Configuration problems are visible";
// tui-keymap "Key overrides from the configuration"). The live reload of a
// layout and of the scroll bar are in config.pty.test.ts and
// test/conversation/scrollbar-layout.pty.test.ts.
import { afterEach, describe, expect, test } from "bun:test";
import type { PtySession } from "../pty/harness.ts";
import { configHome } from "../pty/config-home.ts";
import { JEDITERM_ENV } from "../pty/jediterm.ts";
import { CARD_HEADER, promptBox, READY, REQUIRES_ACTION, statusRow } from "../pty/regions.ts";
import { cliHome, startCli, type CliRun } from "../keys/cli-pty.ts";
import { shortenHome } from "../../src/layout/segments.ts";
import { homeEnv } from "../windows.ts";
import { userHome } from "../../src/platform/paths.ts";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

function start(env: Record<string, string | undefined>, cols: number, rows: number): CliRun {
  const run = startCli("basic", 0, { cols, rows, env });
  session = run.s;
  return run;
}

/** Runs the basic scenario's turn to its end (it reports a cost of 0.014 USD). */
async function finishTurn(run: CliRun) {
  await run.s.waitFor(READY, 10000);
  run.s.sendKeys({ text: "go" }, "Enter");
  await run.s.waitFor(CARD_HEADER, 5000);
  await Bun.sleep(400);
  run.s.sendKeys("Enter");
  await run.s.waitFor("end turn", 5000);
  await run.s.waitFor(READY, 5000);
}

/** Two problems: an invalid density (an error) and a misspelt name (a warning). */
const TWO_PROBLEMS = ['{ "density": "sideways",', '  "wheel_line": 2 }'].join("\n");

describe("the config module and the problem list (task 3.4)", () => {
  test("Configuration mark in the default layout: one problem shows the config mark on the right of the status row at 63x21, and it disappears once the problem is fixed", async () => {
    const cfg = configHome(`{ "density": "sideways" }`);
    const run = start(cfg.env, 63, 21);
    await run.s.waitFor(READY, 10000);
    await run.s.waitFor((p) => /config 1 .*connected$/.test(statusRow(p)), 5000);
    // The load notice names the first problem, cut at this width before where to read it in full.
    expect(promptBox(run.s)[0]).toMatch(/config\.jsonc:1:14: density .*… \(see \? configuration\)/);
    expect(run.s.screenText()[19]).toBe(statusRow(run.s));
    cfg.write(`{ "density": "compact" }`);
    await run.s.waitFor((p) => !statusRow(p).includes("config"), 3000);
    expect(statusRow(run.s)).toMatch(READY);
  }, 30000);

  test("Configuration problems at IDE-pane width: at 63 columns, with a long cwd and a reported cost, the status row shows config 2 and the cost; cwd or the hints give way first", async () => {
    const cfg = configHome(TWO_PROBLEMS);
    // The real home, so the temporary cwd stays long on Windows too (keys/cli-pty.ts shortens it there).
    const run = start({ ...cfg.env, ...homeEnv(userHome()) }, 63, 21);
    await finishTurn(run);
    await run.s.waitFor((p) => statusRow(p).includes("$0.01"), 5000);
    const row = statusRow(run.s);
    expect(row).toMatch(/config 2 {2}connected {2}\$0\.01$/);
    expect(row).toMatch(/\bidle\b/);
    // The long temporary cwd gave way.
    expect(row).not.toContain("acp-tui-keys-");
  }, 30000);

  test("Problems listed in the palette: Configuration problems lists both, each with its file, line and setting", async () => {
    const cfg = configHome(TWO_PROBLEMS);
    const run = start(cfg.env, 100, 30);
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor("Commands", 5000);
    run.s.sendKeys({ text: "configuration" });
    await run.s.waitFor("Configuration problems", 5000);
    run.s.sendKeys("Enter");
    await run.s.waitFor((p) => p.screenText().some((l) => l.includes("Configuration problems 2")), 5000);
    const text = run.s.screenText().join("\n");
    // The file as the list shows it, with `~` for home.
    const shown = shortenHome(cfg.file, cliHome());
    expect(text).toContain(shown.length < 90 ? shown : "config.jsonc");
    expect(text).toMatch(/1:14 density .*takes .*error/);
    expect(text).toMatch(/2:3 wheel_line .*not a known setting .*warning/);
  }, 30000);
});

/** The text inside the overlay's frame, its rows joined by spaces (a wrapped detail reads whole). */
function overlayText(rows: readonly string[]): string {
  const top = rows.findIndex((r) => r.startsWith("╭─ Configuration problems"));
  const bottom = rows.findIndex((r, i) => i > top && r.startsWith("╰"));
  return rows
    .slice(top + 1, bottom)
    .map((r) => r.replace(/^│ /, "").replace(/ │$/, "").trim())
    .filter(Boolean)
    .join(" ");
}

// IDE check 12.5: the kept-key warning's routes come after what one row shows; the notice ends with
// where to read it in full, and the problems list shows the selected problem whole under the list.
describe("kept-key warnings readable inside acp-tui (IDE check 12.5)", () => {
  const KEPT = { keys: { global: { "ctrl+p": "palette", "ctrl+f": "find" } } };
  const terminals = [
    ["PhpStorm", JEDITERM_ENV, "keys.global.ctrl+f: PhpStorm keeps ctrl+f, so it may never reach acp-tui there; the routes to find there are f3 and the palette"],
    ["Zed", { TERM_PROGRAM: "zed", TERMINAL_EMULATOR: undefined, TERM_PROGRAM_VERSION: undefined }, "keys.global.ctrl+p: Zed keeps ctrl+p, so it may never reach acp-tui there; the route to palette there is ?"],
  ] as const;
  for (const [name, env, warning] of terminals) {
    for (const cols of [101, 79]) {
      test(`${name} at ${cols}x21: the notice says where to read the rest, and ? configuration shows the warning with its routes`, async () => {
        const cfg = configHome(KEPT);
        const run = start({ ...env, ...cfg.env }, cols, 21);
        await run.s.waitFor(READY, 10000);
        await run.s.waitFor((p) => promptBox(p)[0]?.includes("(see ? configuration)") === true, 5000);
        // Cut: the problem without its `configuration:`, then where to read it in full.
        expect(promptBox(run.s)[0]).toMatch(/^╭─ config\.jsonc:\d+:\d+: keys\.global\.ctrl\+[fp] .*… \(see \? configuration\) ─+╮$/);
        run.s.sendKeys({ text: "?" });
        await run.s.waitFor("Commands", 5000);
        run.s.sendKeys({ text: "configuration" });
        await run.s.waitFor("Configuration problems", 5000);
        run.s.sendKeys("Enter");
        await run.s.waitFor((p) => p.screenText().some((l) => l.includes("Configuration problems 1")), 5000);
        const rows = run.s.screenText();
        // The list keeps one row per problem, cut with `…`; the detail under it has the message
        // alone, so the place and the setting are on the screen once and the message whole once.
        const message = warning.replace(/^[\w.+]+: /, "");
        expect(rows.filter((r) => /^│ \d+:\d+ keys\.global\.ctrl\+[fp] .*…/.test(r))).toHaveLength(1);
        const text = overlayText(rows);
        expect(text.split("keys.global.ctrl+")).toHaveLength(2);
        expect(text.split(message)).toHaveLength(2);
        expect(text.split(message.slice(-20))).toHaveLength(2);
      }, 30000);
    }
  }
});

describe("Protected chrome in configured layouts (task 6.3)", () => {
  test("a layout without the card is rejected on reload, the layout in use stays, and a permission request still docks a card", async () => {
    const cfg = configHome(`{}`);
    const run = start(cfg.env, 80, 30);
    await run.s.waitFor(READY, 10000);
    cfg.write(JSON.stringify({ layout: { screen: ["conversation", "activity", "prompt", { spacer: 1 }, "find", { left: ["turn-state"], right: ["connection"] }] } }));
    await run.s.waitFor((p) => promptBox(p)[0]?.includes("config.jsonc:1:") === true, 3000);
    expect(promptBox(run.s)[0]).toMatch(/config\.jsonc:1:\d+: layout\.screen is not a valid/);
    await run.s.waitFor((p) => /config 1 .*connected$/.test(statusRow(p)), 3000);
    // The default layout is still in use (the status row still has the cwd and hints).
    expect(statusRow(run.s)).toMatch(/^ \S*acp-tui-keys-\S* +idle\b/);
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor(CARD_HEADER, 5000);
    expect(statusRow(run.s)).toMatch(REQUIRES_ACTION);
    const rows = run.s.screenText();
    expect(rows.some((r) => r.startsWith(`╭─ ${CARD_HEADER}`))).toBe(true);
  }, 30000);
});

describe("Key overrides from the configuration (task 8.1)", () => {
  test("Default removed and rebound: Ctrl+D arms nothing during a turn with an empty prompt box, and Ctrl+Q arms detach with a notice naming ctrl+q", async () => {
    const cfg = configHome({ keys: { global: { "ctrl+d": null, "ctrl+q": "detach" } } });
    const run = start(cfg.env, 100, 30);
    await run.s.waitFor(READY, 10000);
    // A turn waiting on its permission request: running, with the prompt box empty and focused.
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor(CARD_HEADER, 5000);
    await run.s.waitFor((p) => REQUIRES_ACTION.test(statusRow(p)), 5000);
    run.s.sendKeys("Ctrl+D");
    await Bun.sleep(300);
    await run.s.flush();
    expect(statusRow(run.s)).not.toContain("again to detach");
    run.s.sendKeys({ text: "\x11" });
    await run.s.waitFor((p) => statusRow(p).includes("ctrl+q again to detach"), 3000);
    // The second press detaches.
    run.s.sendKeys({ text: "\x11" });
    expect(await run.s.wait(10000)).toBe(0);
  }, 30000);
});
