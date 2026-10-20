// spec tui-agent-session "Programs resolved from the PATH only", through the CLI under a PTY with a
// temporary XDG_CONFIG_HOME and XDG_STATE_HOME: scenario "Not on the PATH", and the Linux analogue
// of "Script in a cloned repository" (a relative `PATH` entry, `.`, which the system's own lookup
// reads against the session directory, as Windows reads the current directory first).
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { PtySession } from "../pty/harness.ts";
import { listWorld } from "../session/list-world.ts";

let session: PtySession | null = null;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = null;
});

describe.skipIf(process.platform === "win32")("Programs resolved from the PATH only", () => {
  test("Not on the PATH: a configured harness whose command `nosuch` is on no PATH entry: acp-tui exits non-zero saying it was not found, and nothing is started", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    writeFileSync(join(w.base, "config", "acp-tui", "config.jsonc"), JSON.stringify({ agent_servers: { nosuch: { command: "acp-tui-nosuch-harness", args: ["--acp"] } } }));
    const s = (session = w.start(["nosuch"], { cwd: repo, cols: 160, rows: 30 }));
    expect(await s.wait(20000)).toBe(1);
    const text = s.screenText().join("");
    expect(text).toContain(`acp-tui: could not start harness 'nosuch' (command 'acp-tui-nosuch-harness --acp'): Executable not found in $PATH: "acp-tui-nosuch-harness"`);
    expect(w.events("agent_launched")).toEqual([]);
  }, 40000);

  test("a harness program in the session directory is not run, even with `.` first on the entry's PATH: not found, no marker", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    const marker = join(w.base, "ran");
    writeFileSync(join(repo, "acp-tui-cloned-harness"), `#!/bin/sh\necho ran > '${marker}'\n`);
    chmodSync(join(repo, "acp-tui-cloned-harness"), 0o755);
    const PATH = [".", ...(process.env.PATH ?? "").split(delimiter)].join(delimiter);
    writeFileSync(join(w.base, "config", "acp-tui", "config.jsonc"), JSON.stringify({ agent_servers: { cloned: { command: "acp-tui-cloned-harness", args: ["--acp"], env: { PATH } } } }));
    const s = (session = w.start(["cloned"], { cwd: repo, cols: 160, rows: 30 }));
    expect(await s.wait(20000)).toBe(1);
    expect(s.screenText().join("")).toContain(`acp-tui: could not start harness 'cloned' (command 'acp-tui-cloned-harness --acp'): Executable not found in $PATH`);
    expect(existsSync(marker)).toBe(false);
    expect(w.events("agent_launched")).toEqual([]);
  }, 40000);
});
