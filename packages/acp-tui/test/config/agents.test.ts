// mvp-configuration tasks 1.5 and 1.6: agents read through the configuration
// loader (spec tui-config "Invalid settings keep the last good value", scenario
// "Named agent in a broken file"; "Agents in the configuration", scenarios
// "Validated entry" and "World-writable file"). The real `main` with an
// injected `startApp`, so "launches nothing" means the app never started.
import { describe, expect, mock, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAgentCatalogue } from "../../src/agent/catalogue.ts";
import { main, type StartAppOptions } from "../../src/cli.ts";
import { createConfigStore } from "../../src/config/store.ts";
import { WINDOWS } from "../windows.ts";

function temp(prefix: string): string {
  return realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), prefix)));
}

/** A temporary XDG_CONFIG_HOME with `acp-tui/config.jsonc` holding `text`. */
function configHome(text: string, modes: { file?: number; dir?: number } = {}): { home: string; file: string } {
  const home = temp("acp-tui-config-");
  const dir = join(home, "acp-tui");
  mkdirSync(dir);
  const file = join(dir, "config.jsonc");
  writeFileSync(file, text);
  chmodSync(file, modes.file ?? 0o644);
  chmodSync(dir, modes.dir ?? 0o755);
  return { home, file };
}

async function run(argv: string[], home: string) {
  const stderr: string[] = [];
  const startApp = mock(async (_options: StartAppOptions) => 0);
  const io = { stdout: { isTTY: true, write: () => true }, stderr: { write: (t: string) => stderr.push(t) } };
  const code = await main(argv, io, startApp, { cwd: temp("acp-tui-launch-"), catalogue: () => loadAgentCatalogue({ env: { XDG_CONFIG_HOME: home } }) });
  return { code, stderr: stderr.join(""), started: startApp.mock.calls.length > 0, launch: (startApp.mock.calls[0]?.[0] as StartAppOptions | undefined)?.launch };
}

const FAKE = `{ "agent_servers": { "fake": { "command": "bun", "args": ["fake.ts"] } }, "density": "focus" }`;

describe("Named agent in a broken file", () => {
  test("acp-tui -a fake with a file that does not parse exits non-zero, launching nothing, naming fake and the file's problem at its line and column", async () => {
    const { home, file } = configHome(`{\n  "agent_servers": { "fake": { "command": "bun" } }\n  "density": "focus"\n}`);
    const r = await run(["-a", "fake"], home);
    expect(r.code).not.toBe(0);
    expect(r.started).toBe(false);
    expect(r.stderr).toContain("'fake' is not a known harness");
    expect(r.stderr).toContain(`the configuration file has a problem: ${file}:3:3: is not valid JSONC here: a comma was expected`);
  });

  test("without -a, a file that does not parse gives no harness: acp-tui exits non-zero, naming the file's problem (a file that exists is taken as written)", async () => {
    const { home, file } = configHome(`{ "agent_servers": `);
    const r = await run([], home);
    expect(r.code).not.toBe(0);
    expect(r.started).toBe(false);
    expect(r.stderr).toContain("harness 'auggie' is not configured; add its entry to");
    expect(r.stderr).toContain(`the configuration file has a problem: ${file}:1:`);
  });
});

describe("Validated entry", () => {
  test("args as a string: a problem names agent_servers.fake.args and says it takes an array of strings; fake cannot be launched", async () => {
    const { home } = configHome(`{ "agent_servers": { "fake": { "command": "bun", "args": "fake.ts" } } }`);
    const catalogue = loadAgentCatalogue({ env: { XDG_CONFIG_HOME: home } });
    expect(catalogue.problems.some((p) => p.includes("agent_servers.fake.args takes an array of strings"))).toBe(true);
    const r = await run(["-a", "fake"], home);
    expect(r.code).not.toBe(0);
    expect(r.started).toBe(false);
    expect(r.stderr).toContain("harness 'fake'");
    expect(r.stderr).toContain("has invalid args: it takes an array of strings");
  });
});

describe("Zed's entry shape", () => {
  test(`an entry copied from Zed with "type": "custom" loads without a problem and launches`, async () => {
    const { home } = configHome(`{ "agent_servers": { "fake": { "type": "custom", "command": "bun", "args": ["fake.ts"], "env": {} } } }`);
    const catalogue = loadAgentCatalogue({ env: { XDG_CONFIG_HOME: home } });
    expect(catalogue.problems).toEqual([]);
    expect(catalogue.agents.get("fake")).toMatchObject({ command: "bun", args: ["fake.ts"] });
    const r = await run(["-a", "fake"], home);
    expect(r.code).toBe(0);
    expect(r.launch).toMatchObject({ agentName: "fake", command: "bun", args: ["fake.ts"] });
  });

  test("another type is an error naming the entry's type", () => {
    const { home } = configHome(`{ "agent_servers": { "fake": { "type": "extension", "command": "bun" } } }`);
    const catalogue = loadAgentCatalogue({ env: { XDG_CONFIG_HOME: home } });
    expect(catalogue.problems.some((p) => p.includes("agent_servers.fake.type"))).toBe(true);
    expect(catalogue.agents.has("fake")).toBe(false);
  });
});

describe("World-writable file (task 1.6)", () => {
  // Skipped on Windows: mode bits decide this check on POSIX; Windows checks the file owner instead (test/config/writers.test.ts).
  test.skipIf(WINDOWS)("a user's file of mode 0666 defining agent_servers.fake: acp-tui -a fake exits non-zero, saying harness commands are not read from a file other users can write", async () => {
    const { home, file } = configHome(FAKE, { file: 0o666 });
    const r = await run(["-a", "fake"], home);
    expect(r.code).not.toBe(0);
    expect(r.started).toBe(false);
    expect(r.stderr).toContain("harness commands are not read from a file other users can write");
    expect(r.stderr).toContain(`the file ${file} has mode 0666`);
  });

  // Skipped on Windows: mode bits decide this check on POSIX; Windows checks the file owner instead (test/config/writers.test.ts).
  test.skipIf(WINDOWS)("a group-writable directory (0775) refuses them too", async () => {
    const { home } = configHome(FAKE, { dir: 0o775 });
    const r = await run(["-a", "fake"], home);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("harness commands are not read from a file other users can write");
    expect(r.stderr).toContain("has mode 0775");
  });

  // Skipped on Windows: mode bits decide this check on POSIX; Windows checks the file owner instead (test/config/writers.test.ts).
  test.skipIf(WINDOWS)("no harness is available, the refusal is a problem, and other sections still apply", async () => {
    const { home } = configHome(FAKE, { file: 0o666 });
    const catalogue = loadAgentCatalogue({ env: { XDG_CONFIG_HOME: home } });
    expect([...catalogue.agents.keys()]).toEqual([]);
    expect(catalogue.problems.some((p) => p.includes("agent_servers is refused: harness commands are not read from a file other users can write"))).toBe(true);
    const store = createConfigStore({ env: { XDG_CONFIG_HOME: home, HOME: home }, sessionDirectory: null });
    expect(store.config().density).toBe("focus");
    expect(store.config().agent_servers).toEqual({});
    expect(store.problems().map((p) => p.path)).toEqual(["agent_servers"]);
    // Without -a there is no default entry to start, and the refusal is said.
    const r = await run([], home);
    expect(r.code).not.toBe(0);
    expect(r.started).toBe(false);
    expect(r.stderr).toContain("harness commands are not read from a file other users can write");
  });

  test("a file only its owner can write is read as usual", async () => {
    const { home } = configHome(FAKE, { file: 0o600, dir: 0o700 });
    const r = await run(["-a", "fake"], home);
    expect(r.code).toBe(0);
    expect(r.launch?.agentName).toBe("fake");
  });
});
