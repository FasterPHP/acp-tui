// day-two-feedback task 13.5 (spec tui-config "Agents in the configuration"; design D10): the
// setting that names the default harness is `default_agent_server`, and `default_agent` is still
// accepted as its old name, with a notice for `config --check` only, and a warning when both are set.
import { describe, expect, test } from "bun:test";
import { buildAgentCatalogue } from "../../src/agent/catalogue.ts";
import { commentedDefault } from "../../src/config/default-file.ts";
import { jsonSchemaText } from "../../src/config/json-schema.ts";
import { parseConfigText } from "../../src/config/load.ts";
import { defaultConfig, ConfigSchema } from "../../src/config/schema.ts";
import { checkProblems } from "../../src/config-command.ts";
import type { ConfigurationRead } from "../../src/config/read.ts";

const FILE = "/home/u/.config/acp-tui/config.jsonc";
const SERVERS = `"agent_servers": { "fake": { "command": "bun", "args": ["x.ts"] }, "other": { "command": "bun", "args": ["y.ts"] } }`;
const parse = (text: string, kind: "user" | "project" = "user") => parseConfigText(text, FILE, { kind, knownAgents: ["claude"] });

describe("default_agent_server", () => {
  test("claude by default, in the schema and the commented default; the old name is in neither", () => {
    expect(defaultConfig().default_agent_server).toBe("claude");
    const text = commentedDefault();
    expect(text).toContain(`"default_agent_server": "claude"`);
    expect(text).not.toMatch(/"default_agent"\s*:/);
    expect(JSON.parse(jsonSchemaText(ConfigSchema)).properties.default_agent_server).toBeDefined();
    expect(JSON.parse(jsonSchemaText(ConfigSchema)).properties.default_agent).toBeUndefined();
  });

  test("the new name names a harness: no problem, no notice, and the catalogue's default follows", () => {
    const parsed = parse(`{ ${SERVERS}, "default_agent_server": "fake" }`);
    expect(parsed.problems).toEqual([]);
    expect(parsed.notices).toEqual([]);
    expect(parsed.sections["default_agent_server"]).toBe("fake");
    expect(buildAgentCatalogue(`{ ${SERVERS}, "default_agent_server": "fake" }`, FILE).defaultAgent).toBe("fake");
  });

  test("the old name still works as the new setting; the notice is for config --check only", () => {
    const text = `{ ${SERVERS}, "default_agent": "fake" }`;
    const parsed = parse(text);
    expect(parsed.problems).toEqual([]);
    expect(parsed.sections["default_agent_server"]).toBe("fake");
    expect(parsed.sections).not.toHaveProperty("default_agent");
    expect(parsed.notices).toHaveLength(1);
    expect(parsed.notices[0]).toMatchObject({ file: FILE, line: 1, path: "default_agent", severity: "notice", suggestion: "default_agent_server" });
    expect(parsed.notices[0]!.message).toContain("old name of default_agent_server");
    expect(buildAgentCatalogue(text, FILE).defaultAgent).toBe("fake");
    // `config --check` adds the notice to the loader's problems.
    const read = { config: defaultConfig(), problems: parsed.problems, notices: parsed.notices, files: { user: FILE, project: null, themes: "/t" }, present: { user: true, project: false } } as unknown as ConfigurationRead;
    expect(checkProblems(read)).toContainEqual(parsed.notices[0]!);
  });

  test("both names: the new one wins and a warning says default_agent is ignored", () => {
    const text = `{ ${SERVERS}, "default_agent": "fake", "default_agent_server": "other" }`;
    const parsed = parse(text);
    expect(parsed.sections["default_agent_server"]).toBe("other");
    expect(parsed.problems).toHaveLength(1);
    expect(parsed.problems[0]).toMatchObject({ path: "default_agent", severity: "warning" });
    expect(parsed.problems[0]!.message).toContain("default_agent_server is set");
    expect(parsed.notices).toEqual([]);
    expect(buildAgentCatalogue(text, FILE).defaultAgent).toBe("other");
    // Whichever order they are written in.
    expect(buildAgentCatalogue(`{ ${SERVERS}, "default_agent_server": "other", "default_agent": "fake" }`, FILE).defaultAgent).toBe("other");
  });

  test("an unknown name is a problem at the value, under the key written, and claude is used", () => {
    for (const key of ["default_agent_server", "default_agent"]) {
      const parsed = parse(`{ "${key}": "ghost" }`);
      expect(parsed.problems).toHaveLength(1);
      expect(parsed.problems[0]).toMatchObject({ path: key, severity: "error" });
      expect(parsed.problems[0]!.message).toContain(`names "ghost", which is not a known harness; "claude" is used`);
      expect(parsed.rejected).toEqual(["default_agent_server"]);
    }
  });

  test("not allowed in a project file under either name", () => {
    for (const key of ["default_agent_server", "default_agent"]) {
      const parsed = parse(`{ "${key}": "evil", "glyphs": "ascii" }`, "project");
      expect(parsed.sections).not.toHaveProperty("default_agent_server");
      expect(parsed.sections["glyphs"]).toBeDefined();
      expect(parsed.problems.map((p) => p.path)).toEqual(["default_agent_server"]);
      expect(parsed.problems[0]!.message).toContain("is not allowed in a project file");
    }
  });
});
