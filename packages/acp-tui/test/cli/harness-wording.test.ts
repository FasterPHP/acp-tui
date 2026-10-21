// day-two-feedback task 4.5 (spec tui-agent-session "Harness as the user-facing term"): the program
// acp-tui launches is a harness in every user-facing string; the speaker in the conversation stays
// the agent, and configuration keys, action IDs, module names and placeholders keep their names.
// The in-process scenarios: the old phrases are gone from every string literal in src/, an unknown
// name is a "known harness" message, "The speaker stays the agent" and "Names kept". The PTY
// scenarios ("Still starting", "Harness fails to start") are harness-wording.pty.test.ts.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AgentNameError, buildAgentCatalogue, findAgent } from "../../src/agent/catalogue.ts";
import { runConfigCommand } from "../../src/config-command.ts";
import { conversationMarkdown } from "../../src/selection/export.ts";
import { DEFAULT_KEY_MAP, actionLabel } from "../../src/keys/keymap.ts";
import { agent, conversation, turnEnd, user } from "../selection/items.ts";

const SRC = resolve(import.meta.dir, "../../src");

/** Every `.ts` and `.tsx` file under `dir`, tests excluded. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("no string in src/ calls the launched program an agent (task 4.5)", () => {
  // Bun's transpiler drops comments and turns JSX text into string literals, so what is left to
  // search is code and string literals.
  const files = sourceFiles(SRC);
  const code = new Map<string, string>();
  for (const file of files) {
    const loader = file.endsWith("x") ? "tsx" : "ts";
    code.set(file, new Bun.Transpiler({ loader }).transformSync(readFileSync(file, "utf8")));
  }

  for (const phrase of ["agent command", "the agent is still starting", "not a known agent", "the agent has not started", "ad hoc agent", "agent commands are not", "the agent answered", "the agent offers no", "the agent could not list"]) {
    test(`no literal says '${phrase}'`, () => {
      const found = [...code].filter(([, text]) => text.includes(phrase)).map(([file]) => file.slice(SRC.length + 1));
      expect(found).toEqual([]);
    });
  }

  test("the scan sees the sources (a known phrase is found)", () => {
    expect(files.length).toBeGreaterThan(100);
    expect([...code.values()].some((text) => text.includes("is still starting"))).toBe(true);
  });
});

describe("Unknown name in the harness's words", () => {
  test("-a nosuch: the message reads that nosuch is not a known harness and lists the known harnesses", () => {
    const catalogue = buildAgentCatalogue(JSON.stringify({ agent_servers: { fake: { command: "bun" } } }), "/cfg/acp-tui/config.jsonc");
    expect(() => findAgent(catalogue, "nosuch")).toThrow(AgentNameError);
    try {
      findAgent(catalogue, "nosuch");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toStartWith("'nosuch' is not a known harness (known: 'auggie', 'claude', 'fake'; harnesses are defined in agent_servers in /cfg/acp-tui/config.jsonc)");
      expect(message).not.toContain("known agent");
    }
  });
});

describe("The speaker stays the agent", () => {
  test("a conversation with one prompt and one answer exports the answer under `## Agent`", () => {
    const { order, lookup } = conversation(user("u1", "hi"), agent("a1", "hello"), turnEnd("m1"));
    const markdown = conversationMarkdown(order, lookup);
    expect(markdown).toBe("## User\n\nhi\n\n## Agent\n\nhello\n");
    expect(markdown).not.toContain("Harness");
  });
});

describe("Names kept", () => {
  test("default_agent_server, the {agent} title placeholder and a key override for prompt.agentCommands are read, with no problem reported", async () => {
    const home = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-names-")));
    mkdirSync(join(home, "acp-tui"), { recursive: true });
    const cwd = join(home, "work");
    mkdirSync(cwd);
    writeFileSync(
      join(home, "acp-tui", "config.jsonc"),
      JSON.stringify({ default_agent_server: "fake", agent_servers: { fake: { command: "bun", args: ["x.ts"] } }, title: { format: "{agent}" }, keys: { prompt: { "alt+g": "agentCommands" } } }),
    );
    const out: string[] = [];
    const code = await runConfigCommand(["--check"], { stdout: { write: (t: string) => out.push(t) }, stderr: { write: (t: string) => out.push(t) } }, { cwd, env: { XDG_CONFIG_HOME: home, HOME: home } });
    const text = out.join("");
    expect(text).toBe("no configuration problems\n");
    expect(code).toBe(0);
  });

  test("the old default_agent still works, and `config --check` suggests the new name with a notice at the key (day-two-feedback task 13.5)", async () => {
    const home = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-names-")));
    mkdirSync(join(home, "acp-tui"), { recursive: true });
    const cwd = join(home, "work");
    mkdirSync(cwd);
    writeFileSync(join(home, "acp-tui", "config.jsonc"), JSON.stringify({ default_agent: "fake", agent_servers: { fake: { command: "bun", args: ["x.ts"] } } }));
    const out: string[] = [];
    const code = await runConfigCommand(["--check"], { stdout: { write: (t: string) => out.push(t) }, stderr: { write: (t: string) => out.push(t) } }, { cwd, env: { XDG_CONFIG_HOME: home, HOME: home } });
    expect(out.join("")).toBe(`${join(home, "acp-tui", "config.jsonc")}:1:2: notice: default_agent is the old name of default_agent_server, which it still works as; rename it (did you mean default_agent_server?)\n0 errors, 0 warnings\n`);
    expect(code).toBe(0);
  });

  test("the action keeps its ID and gets the new label", () => {
    expect(actionLabel(DEFAULT_KEY_MAP, "prompt", "agentCommands")).toBe("/");
  });
});
