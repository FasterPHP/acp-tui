// The name an ad hoc harness command is shown by (windows-support "Decisions during apply";
// spec tui-layout "Windows paths in the chrome", scenario "Harness name without its extension").
import { describe, expect, test } from "bun:test";
import { commandDisplayName } from "../../src/agent/harness-name.ts";
import { splashLaunch } from "../../src/app/splash.ts";
import { harnessName } from "../../src/overlay/sessions.ts";

describe("commandDisplayName", () => {
  test("Windows: the last component of either separator, without .cmd, .bat or .exe in any case", () => {
    for (const [command, name] of [
      ["auggie.cmd", "auggie"],
      ["AUGGIE.CMD", "AUGGIE"],
      ["C:\\Users\\u\\AppData\\Roaming\\npm\\auggie.cmd", "auggie"],
      ["C:/tools/agent.Bat", "agent"],
      ["D:\\x\\bun.exe", "bun"],
      ["claude-agent-acp.EXE", "claude-agent-acp"],
      ["bun", "bun"],
      ["agent.js", "agent.js"],
      ["agent.cmd.exe", "agent.cmd"],
      [".cmd", ".cmd"],
      ["C:\\x\\", "x"],
    ] as const) {
      expect(commandDisplayName(command, "win32"), command).toBe(name);
    }
  });

  test("Linux and macOS: the part after the last slash, extensions and backslashes kept", () => {
    for (const platform of ["linux", "darwin"] as const) {
      expect(commandDisplayName("/usr/local/bin/bun", platform)).toBe("bun");
      expect(commandDisplayName("agent.cmd", platform)).toBe("agent.cmd");
      expect(commandDisplayName("./tools/run.exe", platform)).toBe("run.exe");
      expect(commandDisplayName("a\\b.cmd", platform)).toBe("a\\b.cmd");
    }
  });

  test("the splash's launch row and the session list's footer use it; a configured name is never trimmed", () => {
    const launch = { agentName: "ad hoc", command: "C:\\npm\\auggie.cmd", directory: "C:\\work" };
    expect(splashLaunch(launch, "win32").harness).toBe("auggie");
    expect(splashLaunch(launch, "linux").harness).toBe("C:\\npm\\auggie.cmd");
    expect(splashLaunch({ ...launch, agentName: "auggie.cmd" }, "win32").harness).toBe("auggie.cmd");
    expect(harnessName({ name: "ad hoc", command: ["C:\\npm\\auggie.CMD", "--acp"] }, "win32")).toBe("auggie");
    expect(harnessName({ name: "ad hoc", command: ["/usr/bin/bun", "agent.ts"] }, "linux")).toBe("bun");
    expect(harnessName({ name: "auggie", command: null }, "win32")).toBe("auggie");
  });
});
