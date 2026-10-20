// Task 5.2: agent launch failure handling. A missing command must fail
// synchronously and name the command, without acp-tui ever getting as far
// as speaking ACP to it.
import { describe, expect, test } from "bun:test";
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
