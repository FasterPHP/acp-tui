// Task 5.1: the literal `acp-tui | cat` scenario from the tui-agent-session
// spec ("Interactive terminal required"), run as a real subprocess with
// piped (non-TTY) stdout. Runs fast and needs no network: the whole point
// is that the agent is never launched, so there is nothing to wait on.
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_PATH = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));

describe("acp-tui | cat (task 5.1)", () => {
  test("piped stdout exits non-zero with a clear message, without launching the agent", async () => {
    const proc = Bun.spawn({
      cmd: ["bun", CLI_PATH, "--"],
      // Without arguments the default agent is looked up in the configuration: never the user's own.
      env: { ...process.env, XDG_CONFIG_HOME: mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-tty-")) },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });

    const [code, stderrText] = await Promise.all([
      proc.exited,
      new Response(proc.stderr).text(),
      new Response(proc.stdout).text(),
    ]).then(([c, err]) => [c, err] as const);

    expect(code).not.toBe(0);
    expect(stderrText.toLowerCase()).toContain("interactive terminal");
  });

  test("--help exits 0 and prints help even with piped stdout", async () => {
    const proc = Bun.spawn({
      cmd: ["bun", CLI_PATH, "--", "--help"],
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdoutText = await new Response(proc.stdout).text();
    const code = await proc.exited;
    expect(code).toBe(0);
    expect(stdoutText).toContain("acp-tui");
    expect(stdoutText).toContain("--help");
    expect(stdoutText).not.toMatch(/replay/i);
  });
});
