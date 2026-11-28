// install-harness-choice: the harness choice for a new configuration (src/config/harness-choice.ts)
// and the default file rendered with it (commentedDefault's `choice`; spec tui-config "Harness
// choice at install"). Nothing here reads or writes a configuration file.
import { describe, expect, test } from "bun:test";
import { AGENT_EXAMPLES, commentedDefault, EXAMPLE } from "../../src/config/default-file.ts";
import { harnessChoice, harnessList, isShippedChoice, selectableHarnesses, shippedChoice, splitHarnessNames } from "../../src/config/harness-choice.ts";
import { parseConfigText } from "../../src/config/load.ts";
import { exampleServerEntry } from "../../src/agent/examples.ts";

describe("splitHarnessNames", () => {
  test("a name, a comma-separated list and repeated values, trimmed, first occurrence kept", () => {
    expect(splitHarnessNames(["claude"])).toEqual(["claude"]);
    expect(splitHarnessNames(["claude,codex"])).toEqual(["claude", "codex"]);
    expect(splitHarnessNames(["claude, codex", "auggie,claude"])).toEqual(["claude", "codex", "auggie"]);
  });

  test("an empty item is an error", () => {
    for (const bad of [[""], ["claude,"], ["claude,,codex"], [",claude"]]) expect(() => splitHarnessNames(bad)).toThrow(/separated by commas/);
  });
});

describe("harnessChoice", () => {
  test("the default is --default, else the first name; enabled follows the default file's order", () => {
    expect(harnessChoice(["codex", "claude"])).toEqual({ enabled: ["claude", "codex"], defaultName: "codex" });
    expect(harnessChoice(["codex", "claude"], "claude")).toEqual({ enabled: ["claude", "codex"], defaultName: "claude" });
  });

  test("an unknown name is refused, listing the names it takes", () => {
    expect(() => harnessChoice(["claude", "nope"])).toThrow("unknown harness 'nope'; --harness takes auggie, auggie-v2, claude, opencode, codex, pi, gemini");
    expect(() => harnessChoice(["x", "y"])).toThrow("unknown harnesses 'x', 'y'");
  });

  test("deepseek, whose entry holds a placeholder path, is not offered", () => {
    expect(selectableHarnesses()).not.toContain("deepseek");
    expect(() => harnessChoice(["deepseek"])).toThrow("unknown harness 'deepseek'");
  });

  test("a default that is not among the names is refused", () => {
    expect(() => harnessChoice(["claude"], "codex")).toThrow("--default codex is not among the harnesses given with --harness (claude)");
  });

  test("the shipped choice is auggie alone, the default", () => {
    expect(shippedChoice()).toEqual({ enabled: ["auggie"], defaultName: "auggie" });
    expect(isShippedChoice(harnessChoice(["auggie"]))).toBe(true);
    expect(isShippedChoice(harnessChoice(["auggie", "claude"]))).toBe(false);
  });

  test("harnessList joins with commas and a final and", () => {
    expect(harnessList(["claude"])).toBe("claude");
    expect(harnessList(["claude", "codex"])).toBe("claude and codex");
    expect(harnessList(["auggie", "claude", "codex"])).toBe("auggie, claude and codex");
  });
});

describe("commentedDefault with a harness choice", () => {
  test("no choice, and the shipped choice, give exactly the default file on each platform", () => {
    for (const platform of ["linux", "darwin", "win32"] as const) {
      expect(commentedDefault(platform, shippedChoice())).toBe(commentedDefault(platform));
      expect(commentedDefault(platform, harnessChoice(["auggie"]))).toBe(commentedDefault(platform));
    }
  });

  test("every selectable harness alone loads without problems, with exactly its entry and as the default", () => {
    for (const name of selectableHarnesses()) {
      const text = commentedDefault("linux", harnessChoice([name]));
      const parsed = parseConfigText(text, "/x/config.jsonc", { knownAgents: [] });
      expect(parsed.problems).toEqual([]);
      const example = AGENT_EXAMPLES.find((e) => e.name === name)!;
      expect(parsed.sections.agent_servers).toEqual({ [name]: exampleServerEntry(example.entry) });
      expect(parsed.sections.default_agent_server).toBe(name);
    }
  });

  test("claude and codex with claude the default: both in effect, auggie an example, the header and agent_servers say so", () => {
    const text = commentedDefault("linux", harnessChoice(["claude", "codex"], "claude"));
    const parsed = parseConfigText(text, "/x/config.jsonc", { knownAgents: [] });
    expect(parsed.problems).toEqual([]);
    expect(Object.keys(parsed.sections.agent_servers as object)).toEqual(["claude", "codex"]);
    expect(parsed.sections.default_agent_server).toBe("claude");
    const lines = text.split("\n");
    expect(lines).toContain('  "default_agent_server": "claude",');
    expect(lines).toContain('    "codex": { "command": "codex-acp", "args": [] },');
    // auggie is commented out and introduced as an example; its workspace alternative goes with it.
    const auggie = lines.findIndex((l) => l.startsWith('    // "auggie": {'));
    expect(auggie).toBeGreaterThan(-1);
    expect(lines.slice(auggie - 20, auggie).join(" ")).toContain(`${EXAMPLE} Auggie, installed with`);
    expect(text).not.toContain("/path/to/projects");
    expect(text).not.toContain("The default harness, Auggie");
    expect(text).toContain("// The default harness, Claude Code through the claude-agent-acp adapter");
    const flat = lines.map((l) => l.replace(/^\s*\/\/ ?/, "")).join(" ");
    expect(flat).toContain("install-cli wrote this file with claude and codex in effect under agent_servers and default_agent_server set to claude");
    expect(flat).toContain("This file was written with the harnesses you chose in effect, claude and codex;");
    expect(flat).not.toContain("so this file as printed changes nothing");
  });

  test("a second entry in effect starts its comment with a capital and is not called the default", () => {
    const text = commentedDefault("linux", harnessChoice(["claude", "pi"]));
    expect(text).toContain("    // The pi coding agent through pi-acp");
    expect(text).toContain('    "pi": { "command": "pi-acp", "args": [] },');
  });

  test("auggie beside another harness keeps its workspace alternative, commented out", () => {
    const text = commentedDefault("linux", harnessChoice(["claude", "auggie"]));
    expect(text).toContain('    "auggie": { "command": "auggie", "args": ["--acp"], "additional_directory_args": ["--add-workspace", "{dir}"] },');
    expect(text).toContain('"additional_directories": ["/path/to/projects"]');
    const parsed = parseConfigText(text, "/x/config.jsonc", { knownAgents: [] });
    expect(parsed.problems).toEqual([]);
    expect(parsed.sections.default_agent_server).toBe("claude");
  });

  test("the Windows header still names %APPDATA% with a choice", () => {
    const text = commentedDefault("win32", harnessChoice(["claude"]));
    expect(text).toContain("%APPDATA%\\acp-tui\\config.jsonc");
    expect(parseConfigText(text, "C:\\x\\config.jsonc", { knownAgents: [], platform: "win32" }).problems).toEqual([]);
  });
});
