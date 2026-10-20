// mvp-configuration tasks 9.1 to 9.3 through the real CLI under the PTY harness: the `config`
// subcommand wins over a directory of its name and never starts the full screen or an agent, an
// agent named `config` is reached after the separator, the check, paths, schema and commented
// default from the shell (spec tui-config "Configuration subcommands on the command line",
// "Configuration problems are visible", "Configuration paths", "Configuration schema",
// "Commented default configuration"; tui-theme "Legibility report for user themes"), and the
// retired spike switch (spec tui-config "Spike switch retired": "Old launcher"). The crash hook's
// scenarios are in test/renderer/exit.pty.test.ts.
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { OBSOLETE_SPIKE_NOTICE } from "../../src/cli.ts";
import { commentedDefault } from "../../src/config/default-file.ts";
import { startCli } from "../conversation/cli.ts";
import { startPty, type PtySession } from "../pty/harness.ts";
import { READY } from "../pty/regions.ts";
import { WINDOWS } from "../windows.ts";

const ROOT = resolve(import.meta.dir, "../../../..");
const CLI = join(ROOT, "packages/acp-tui/src/cli.ts");
const LAUNCHER = join(ROOT, "packages/acp-tui/bin/acp-tui");
const FAKE_AGENT = join(ROOT, "packages/fake-agent/src/main.ts");

let sessions: PtySession[] = [];
afterEach(async () => {
  for (const s of sessions) {
    s.kill("SIGTERM");
    await s.dispose();
  }
  sessions = [];
});

/** A home with a configuration directory and `themes/`, and an empty working directory in it. */
function world(files: { config?: string; themes?: Record<string, string> } = {}) {
  const home = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-subcommands-")));
  const dir = join(home, "acp-tui");
  mkdirSync(join(dir, "themes"), { recursive: true });
  if (files.config !== undefined) writeFileSync(join(dir, "config.jsonc"), files.config);
  for (const [name, text] of Object.entries(files.themes ?? {})) writeFileSync(join(dir, "themes", `${name}.jsonc`), text);
  const cwd = join(home, "work");
  mkdirSync(cwd);
  return { home, cwd, dir, env: { XDG_CONFIG_HOME: home, HOME: home } };
}

/** `acp-tui <args>` (through `bun cli.ts`) under the PTY until it exits: its status and output. */
async function run(args: string[], w: ReturnType<typeof world>, command: string[] = ["bun", CLI]): Promise<{ code: number; raw: string; text: string }> {
  const s = startPty([...command, ...args], { cols: 200, rows: 60, cwd: w.cwd, env: w.env });
  sessions.push(s);
  const code = await s.wait(20000);
  const raw = s.rawOutput();
  return { code, raw, text: raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "") };
}

/** Nothing of the full screen: no alternate screen and no mouse reporting. */
function expectMainScreenOnly(raw: string): void {
  expect(raw).not.toContain("\x1b[?1049h");
  expect(raw).not.toMatch(/\x1b\[\?100[0-6]h/);
}

describe("subcommands on the command line (task 9.1)", () => {
  test("Subcommand wins: with a directory named config in the current directory, acp-tui config --check checks the configuration and no session starts", async () => {
    const w = world();
    mkdirSync(join(w.cwd, "config"));
    const r = await run(["config", "--check"], w);
    expect(r.code).toBe(0);
    expect(r.text).toContain("no configuration problems");
    expectMainScreenOnly(r.raw);
  }, 30000);

  // Skipped on Windows: it runs the POSIX sh launcher and a #!/bin/sh stub.
  test.skipIf(WINDOWS)("Agent after the separator: acp-tui -- config, with a program named config on the PATH, launches config as the agent command", async () => {
    const w = world();
    const bin = join(w.home, "bin");
    mkdirSync(bin);
    const marker = join(w.home, "config-launched");
    // `config`: records that it ran, then is the fake agent.
    writeFileSync(join(bin, "config"), `#!/bin/sh\ntouch '${marker}'\nexec bun '${FAKE_AGENT}' --scenario basic --delay-scale 0\n`);
    chmodSync(join(bin, "config"), 0o755);
    // Through the package launcher, as the installed command runs it: Bun drops a `--` straight
    // after the script, so only the launcher's own `--` lets the user's reach acp-tui.
    const s = startPty([LAUNCHER, "--", "config"], { cols: 100, rows: 30, cwd: w.cwd, env: { ...w.env, PATH: `${bin}:${process.env.PATH}` } });
    sessions.push(s);
    await s.waitFor(READY, 15000);
    expect(existsSync(marker)).toBe(true);
    expect(s.term.buffer.active.type).toBe("alternate");
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
  }, 30000);

  test("Check from the shell: an unknown token name in a theme file prints the theme file, the line and column and the token name, and exits non-zero without the full screen", async () => {
    const w = world({ config: `{ "theme": "mine" }`, themes: { mine: `{\n  "tokens": {\n    "acent": 4\n  }\n}\n` } });
    const r = await run(["config", "--check"], w);
    expect(r.code).toBe(1);
    expect(r.text).toContain(`${join(w.dir, "themes", "mine.jsonc")}:3:5: error: `);
    expect(r.text).toContain("acent");
    expectMainScreenOnly(r.raw);
  }, 30000);

  test("Weak token on One Light (task 5.6): the warning names tool.duration, Zed One Light and a ratio below 3:1, and the exit status is 0", async () => {
    const w = world({ config: `{ "theme": "weak" }`, themes: { weak: `{ "tokens": { "tool.duration": 11 } }` } });
    const r = await run(["config", "--check"], w);
    expect(r.code).toBe(0);
    const line = r.text.split("\n").find((l) => l.includes("tool.duration") && l.includes("Zed One Light"));
    expect(line).toContain(": warning: ");
    expect(Number(/is ([0-9.]+):1/.exec(line ?? "")?.[1])).toBeLessThan(3);
  }, 30000);

  test("Paths printed: in a directory with no project file, the user's file, the themes directory and that no project file applies", async () => {
    const w = world();
    const r = await run(["config", "--path"], w);
    expect(r.code).toBe(0);
    expect(r.text).toContain(`user file:    ${join(w.dir, "config.jsonc")} (absent)`);
    expect(r.text).toContain(`themes:       ${join(w.dir, "themes")} (present)`);
    expect(r.text).toContain(`project file: none applies for ${w.cwd}`);
    expectMainScreenOnly(r.raw);
  }, 30000);

  test("Editor completion: config --print-schema prints a JSON Schema in which mouse is an enumeration of full, wheel and off with the default full and a description", async () => {
    const w = world();
    const r = await run(["config", "--print-schema"], w);
    expect(r.code).toBe(0);
    const schema = JSON.parse(r.text) as { properties: Record<string, { enum?: string[]; default?: unknown; description?: string }> };
    expect(schema.properties["mouse"]).toMatchObject({ enum: ["full", "wheel", "off"], default: "full" });
    expect(schema.properties["mouse"]!.description).toBeTruthy();
  }, 30000);

  test("Default loads as the default: config --print-default saved as the user's file, config --check reports no problem (task 9.2)", async () => {
    const w = world();
    const printed = await run(["config", "--print-default"], w);
    expect(printed.code).toBe(0);
    expect(printed.text).toBe(commentedDefault());
    writeFileSync(join(w.dir, "config.jsonc"), printed.text);
    const r = await run(["config", "--check"], w);
    expect(r.code).toBe(0);
    expect(r.text).toBe("no configuration problems\n");
  }, 30000);

  test("a glyph override in the user's file does not stop the launch: the session starts (the glyph width needs OpenTUI loaded before the catalogue is read)", async () => {
    const w = world({ config: `{ "glyphs": { "overrides": { "list.bullet.1": "▸" } } }` });
    const r = startCli({ scenario: "basic", cols: 100, rows: 30, env: w.env });
    sessions.push(r.session);
    await r.session.waitFor(READY, 15000);
    r.session.sendKeys("Ctrl+D");
    expect(await r.session.wait(10000)).toBe(0);
  }, 30000);
});

describe("the spike switch is retired (task 9.3)", () => {
  test("Old launcher: acp-tui --spike window,select,find,chrome starts the session with the product behaviour and a notice naming --spike as obsolete with the reinstall command", async () => {
    const w = world();
    const r = startCli({ scenario: "basic", cols: 120, rows: 30, args: ["--spike", "window,select,find,chrome"], env: w.env });
    sessions.push(r.session);
    const s = r.session;
    await s.waitFor(READY, 15000);
    await s.waitFor(OBSOLETE_SPIKE_NOTICE, 3000);
    expect(OBSOLETE_SPIKE_NOTICE).toBe("--spike is obsolete and ignored; reinstall the command with bun run install-cli");
    // The product behaviour: the mouse modes of `full` (hover included) and the session usable.
    expect(s.mouseModesSet()).toEqual([1000, 1002, 1003, 1006]);
    expect(r.events("screen_options")[0]).not.toHaveProperty("spikes");
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
  }, 30000);
});
