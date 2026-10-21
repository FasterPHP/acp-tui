// Install and login hints by program (configured-harnesses, spec tui-agent-session "Harness program
// not installed" and "Harness needs a login"): the program is the command's base name, or the
// Claude adapter's package among the arguments, whatever the entry is called.
import { describe, expect, test } from "bun:test";
import { AUGGIE_INSTALL_HINT, BUN_INSTALL_HINT, OPENCODE_INSTALL_HINT } from "../../src/agent/command.ts";
import { CLAUDE_ADAPTER_PACKAGE_NAME, commandBaseName, hintsFor, PROGRAM_HINTS, programHints, programOf } from "../../src/agent/hints.ts";

describe("commandBaseName", () => {
  test("a bare name is itself; a path gives its last component, on Linux and macOS", () => {
    expect(commandBaseName("auggie", "linux")).toBe("auggie");
    expect(commandBaseName("/usr/local/bin/auggie", "linux")).toBe("auggie");
    expect(commandBaseName("./bin/opencode", "darwin")).toBe("opencode");
  });

  test("on Linux a backslash is part of the name and the case and extension are kept", () => {
    expect(commandBaseName("a\\b", "linux")).toBe("a\\b");
    expect(commandBaseName("Auggie.cmd", "linux")).toBe("Auggie.cmd");
  });

  test("on Windows a program extension is stripped, the name is lower-cased and both separators count", () => {
    expect(commandBaseName("auggie.cmd", "win32")).toBe("auggie");
    expect(commandBaseName("C:\\Users\\u\\AppData\\Roaming\\npm\\Auggie.CMD", "win32")).toBe("auggie");
    expect(commandBaseName("C:/tools/OpenCode.exe", "win32")).toBe("opencode");
    expect(commandBaseName("opencode.bat", "win32")).toBe("opencode");
    expect(commandBaseName("auggie.ps1", "win32")).toBe("auggie");
    expect(commandBaseName("AUGGIE", "win32")).toBe("auggie");
    expect(commandBaseName("agent.txt", "win32")).toBe("agent.txt");
  });
});

describe("programOf", () => {
  test("the Claude adapter's package among the arguments, with or without a version, whatever runs it", () => {
    expect(programOf("bunx", ["--bun", CLAUDE_ADAPTER_PACKAGE_NAME], "linux")).toBe("claude-agent-acp");
    expect(programOf("bunx", ["--bun", `${CLAUDE_ADAPTER_PACKAGE_NAME}@0.94.0`], "linux")).toBe("claude-agent-acp");
    expect(programOf("npx", ["-y", `${CLAUDE_ADAPTER_PACKAGE_NAME}@latest`], "linux")).toBe("claude-agent-acp");
  });

  test("a package that only starts with the adapter's name is not the adapter", () => {
    expect(programOf("bunx", [`${CLAUDE_ADAPTER_PACKAGE_NAME}-fork`], "linux")).toBe("bunx");
  });

  test("otherwise the command's base name", () => {
    expect(programOf("/opt/auggie", ["--acp"], "linux")).toBe("auggie");
    expect(programOf("opencode", ["acp"], "linux")).toBe("opencode");
  });
});

describe("hintsFor", () => {
  test("auggie and opencode by command, each with an install and a login hint", () => {
    expect(hintsFor("auggie", ["--acp"], "linux")).toEqual({ installHint: AUGGIE_INSTALL_HINT, loginHint: "auggie login" });
    expect(hintsFor("/x/opencode", ["acp"], "linux")).toEqual({ installHint: OPENCODE_INSTALL_HINT, loginHint: "opencode auth login" });
  });

  test("on Windows the npm programs are named by their .cmd shims, which PowerShell's default execution policy runs; Linux and macOS are unchanged", () => {
    expect(hintsFor("C:\\npm\\auggie.cmd", ["--acp"], "win32")).toEqual({
      installHint: "npm.cmd install -g @augmentcode/auggie@0.36.0 (Node 20 or later), then run auggie.cmd login",
      loginHint: "auggie.cmd login",
    });
    expect(hintsFor("opencode", ["acp"], "win32")).toEqual({ installHint: "npm.cmd install -g @opencode/cli, or see opencode.ai/docs", loginHint: "opencode auth login" });
    expect(hintsFor("auggie", ["--acp"], "darwin")).toEqual({
      installHint: "npm install -g @augmentcode/auggie@0.36.0 (Node 20 or later), then run auggie login",
      loginHint: "auggie login",
    });
    expect(hintsFor("opencode", ["acp"], "darwin").installHint).toBe("npm install -g @opencode/cli, or see opencode.ai/docs");
    expect(PROGRAM_HINTS).toEqual(programHints(process.platform));
  });

  test("the Claude adapter has an install hint (Bun) and no login hint", () => {
    const hints = hintsFor("bunx", ["--bun", `${CLAUDE_ADAPTER_PACKAGE_NAME}@0.94.0`], "linux");
    expect(hints).toEqual({ installHint: BUN_INSTALL_HINT });
    expect(hints.loginHint).toBeUndefined();
  });

  test("an unknown program, or one only named like a known one, has none", () => {
    expect(hintsFor("my-auggie", ["--acp"], "linux")).toEqual({});
    expect(hintsFor("gemini", ["--acp"], "linux")).toEqual({});
    expect(hintsFor("auggie-wrapper", [], "linux")).toEqual({});
  });
});
