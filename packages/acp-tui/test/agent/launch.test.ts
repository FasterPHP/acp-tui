// Task 5.2: agent launch failure handling. A missing command must fail
// synchronously and name the command, without acp-tui ever getting as far
// as speaking ACP to it.
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { AgentLaunchError, launchAgent } from "../../src/agent/launch.ts";
import { AgentStartupError } from "../../src/agent/connection.ts";
import { startSession } from "../../src/session/controller.ts";

describe("agent/launch (task 5.2)", () => {
  test("a missing command throws AgentLaunchError naming the command", () => {
    const command = ["this-command-does-not-exist-acp-tui-test"];
    expect(() => launchAgent(command)).toThrow(AgentLaunchError);
    try {
      launchAgent(command);
      throw new Error("expected launchAgent to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentLaunchError);
      expect((error as Error).message).toContain("this-command-does-not-exist-acp-tui-test");
    }
  });

  test("an empty command throws AgentLaunchError without calling Bun.spawn", () => {
    expect(() => launchAgent([])).toThrow(AgentLaunchError);
  });

  test("an agent that exits before initialize: AgentStartupError with the command, exit code and sanitised stderr tail", async () => {
    const script = "process.stderr.write('line 1\\n\\x1b]52;c;ZXZpbA==\\x07line 2\\n'); process.exit(2)";
    const command = ["bun", "-e", script];
    const error = await startSession({ command, cwd: process.cwd() }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AgentStartupError);
    const startup = error as AgentStartupError;
    expect(startup.exitCode).toBe(2);
    expect(startup.message).toContain("ad hoc harness command 'bun -e");
    expect(startup.message).toContain("exit code 2");
    expect(startup.message).toContain("line 1\nline 2");
    expect(startup.message).not.toContain("\x1b");
  });
});

// spec tui-agent-session "Programs resolved from the PATH only": the harness is started by the
// absolute path the PATH gives, never from its session directory.
describe.skipIf(process.platform === "win32")("agent/launch: the harness resolved from the PATH only", () => {
  function scriptIn(dir: string, name: string, marker: string): void {
    writeFileSync(join(dir, name), `#!/bin/sh\necho ran > '${marker}'\n`);
    chmodSync(join(dir, name), 0o755);
  }

  test("a harness name found only in the session directory is not run, even with `.` on the entry's PATH: not found, nothing started", () => {
    const base = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-launch-")));
    const marker = join(base, "ran");
    scriptIn(base, "acp-tui-cloned-harness", marker);
    let error: unknown = null;
    try {
      launchAgent(["acp-tui-cloned-harness", "--acp"], { cwd: base, env: { PATH: `.${delimiter}/usr/bin${delimiter}/bin` }, harness: "cloned" });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(AgentLaunchError);
    expect((error as Error).message).toBe(`could not start harness 'cloned' (command 'acp-tui-cloned-harness --acp'): Executable not found in $PATH: "acp-tui-cloned-harness"`);
    expect(existsSync(marker)).toBe(false);
  });

  test("the name is looked up on the PATH the harness gets (the entry's own PATH), and the messages keep the command as given", async () => {
    const base = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-launch-")));
    const bin = join(base, "bin");
    mkdirSync(bin);
    const marker = join(base, "ran");
    scriptIn(bin, "acp-tui-path-harness", marker);
    const agent = launchAgent(["acp-tui-path-harness"], { cwd: base, env: { PATH: `${bin}${delimiter}/usr/bin${delimiter}/bin` } });
    expect(await agent.exited).toBe(0);
    expect(existsSync(marker)).toBe(true);
  });
});
