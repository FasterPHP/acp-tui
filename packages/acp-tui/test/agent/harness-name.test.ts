// The name an ad hoc harness command is shown by (windows-support "Decisions during apply";
// spec tui-layout "Windows paths in the chrome", scenario "Harness name without its extension").
import { describe, expect, test } from "bun:test";
import { commandDisplayName, shortHarnessName } from "../../src/agent/harness-name.ts";
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

describe("shortHarnessName (auggie-1x-support 7.6)", () => {
  test("Claude through bunx, with or without a version", () => {
    expect(shortHarnessName(["bunx", "--bun", "@agentclientprotocol/claude-agent-acp@0.94.0"], "linux")).toBe("claude");
    expect(shortHarnessName(["npx", "@agentclientprotocol/claude-agent-acp"], "linux")).toBe("claude");
    expect(shortHarnessName(["claude-agent-acp"], "linux")).toBe("claude");
  });

  test("Known programs", () => {
    expect(shortHarnessName(["/usr/bin/auggie", "--acp"], "linux")).toBe("auggie");
    expect(shortHarnessName(["opencode", "acp"], "linux")).toBe("opencode");
  });

  test("Script through a runner: the script's base name without its extension", () => {
    expect(shortHarnessName(["bun", "packages/fake-agent/src/main.ts", "--scenario", "basic"], "linux")).toBe("main");
    expect(shortHarnessName(["node", "--inspect", "dist/agent.mjs"], "linux")).toBe("agent");
    expect(shortHarnessName(["bun", "run", "src/x.ts"], "linux")).toBe("x");
    expect(shortHarnessName(["bunx", "some-agent@1.2.3"], "linux")).toBe("some-agent");
    expect(shortHarnessName(["bunx", "@scope/some-agent@1.2.3"], "linux")).toBe("some-agent");
  });

  test("Unknown program, and a runner with nothing to name", () => {
    expect(shortHarnessName(["/opt/tools/my-agent", "--acp"], "linux")).toBe("my-agent");
    expect(shortHarnessName(["bun", "--version"], "linux")).toBe("bun");
  });

  test("Windows program", () => {
    expect(shortHarnessName(["C:\\Tools\\Auggie.CMD", "--acp"], "win32")).toBe("auggie");
    expect(shortHarnessName(["C:\\Tools\\my-agent.exe"], "win32")).toBe("my-agent");
    expect(shortHarnessName(["bun.exe", "C:\\work\\agent.ts"], "win32")).toBe("agent");
  });
});
