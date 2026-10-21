// mvp-configuration task 1.2: the configuration schema (design D2 and D4; spec
// tui-config "Configuration schema"). The defaults parse and are design D2's,
// every setting has a description and a project-file classification, `theme`
// and `glyphs` take a bare name, and an invalid agent entry fails with its path.
import { describe, expect, test } from "bun:test";
import type { z } from "zod";
import { parseConfigText } from "../../src/config/load.ts";
import {
  ConfigSchema,
  defaultConfig,
  describeOf,
  PROJECT_FILE_RULES,
  projectRule,
  SECTION_NAMES,
  SECTIONS,
  ThemeFileSchema,
  unwrap,
} from "../../src/config/schema.ts";
import { KEY_CONTEXTS } from "../../src/keys/keymap.ts";

type AnySchema = z.core.$ZodType;
type Def = { type: string; shape?: Record<string, AnySchema>; valueType?: AnySchema; element?: AnySchema; options?: AnySchema[]; innerType?: AnySchema };
const defOf = (schema: AnySchema): Def => (schema as unknown as { def: Def }).def;

/** Every setting below `schema` (object properties, recursively, through records, arrays, unions
 *  and nullables), with its dotted path. */
function settings(schema: AnySchema, path: string, out: { path: string; schema: AnySchema }[] = []): { path: string; schema: AnySchema }[] {
  const def = defOf(unwrap(schema));
  if (def.type === "object") {
    for (const [key, child] of Object.entries(def.shape!)) {
      out.push({ path: path ? `${path}.${key}` : key, schema: child });
      settings(child, path ? `${path}.${key}` : key, out);
    }
  } else if (def.type === "record") settings(def.valueType!, `${path}.<name>`, out);
  else if (def.type === "array") settings(def.element!, `${path}[]`, out);
  else if (def.type === "nullable") settings(def.innerType!, path, out);
  else if (def.type === "union") for (const option of def.options!) settings(option, path, out);
  return out;
}

describe("defaults (design D2)", () => {
  test("an empty file parses to the defaults, which are design D2's", () => {
    expect(ConfigSchema.safeParse({}).success).toBe(true);
    const config = defaultConfig();
    expect(Object.keys(config).sort()).toEqual([...SECTION_NAMES].sort());
    expect(config).toEqual({
      agent_servers: {},
      default_agent_server: "auggie",
      agent_startup_timeout_seconds: 30,
      mouse: "full",
      wheel_lines: null,
      terminals: {},
      exit: { print: "summary" },
      clipboard: "auto",
      selection: { copy_on_release: true },
      prompt: { cursor: "block_at_end" },
      density: "focus",
      interrupt: "double",
      attention: { signal: "bell", long_turn_seconds: 30 },
      busy: { track_percent: 40, style: "gap" },
      activity: { linger_seconds: 1.5 },
      models: { group_by_provider: true, provider_separator: " / " },
      title: { format: "{dir}{counter}" },
      markdown: { heading_markers: false, table_min_column_width: 10, code_wrap: "word" },
      tool_output: { snippet_rows: 10 },
      cards: { padding: { rows: 1, columns: 2 } },
      theme: { name: "default", flat: false, surface_contrast: 1, tokens: {} },
      glyphs: { set: "unicode", overrides: {} },
      layout: { conversation_min_rows: 12, scrollbar: true },
      keys: {},
    });
  });

  test("each section's schema parses `undefined` to its default, so an omitted section is the default", () => {
    const defaults = defaultConfig() as Record<string, unknown>;
    for (const section of SECTION_NAMES) expect(SECTIONS[section].parse(undefined)).toEqual(defaults[section] as never);
  });

  test("theme and glyphs take a bare name", () => {
    expect(SECTIONS.theme.parse("mine")).toEqual({ name: "mine", flat: false, surface_contrast: 1, tokens: {} });
    expect(SECTIONS.glyphs.parse("ascii")).toEqual({ set: "ascii", overrides: {} });
    // A theme is a name, never a path (design D4).
    expect(SECTIONS.theme.safeParse("../evil").success).toBe(false);
    expect(SECTIONS.theme.safeParse({ name: "/etc/x" }).success).toBe(false);
  });

  test("$schema is accepted and ignored", () => {
    const parsed = parseConfigText(`{ "$schema": "./schema/config.schema.json", "density": "focus" }`, "/c.jsonc");
    expect(parsed.problems).toEqual([]);
    expect(parsed.sections).toEqual({ density: "focus" });
  });
});

describe("descriptions", () => {
  test("every setting, nested ones included, has a description", () => {
    const missing = [...settings(ConfigSchema, ""), ...settings(ThemeFileSchema, "<theme file>")]
      .filter((s) => !describeOf(s.schema))
      .map((s) => s.path);
    expect(missing).toEqual([]);
  });

  test("every section has a description", () => {
    for (const section of SECTION_NAMES) expect(describeOf(SECTIONS[section])).toBeTruthy();
  });
});

describe("project-file classification (design D4)", () => {
  test("every top-level setting is classified", () => {
    for (const key of Object.keys(ConfigSchema.shape)) expect(PROJECT_FILE_RULES).toHaveProperty(key);
    expect(Object.keys(PROJECT_FILE_RULES).sort()).toEqual(Object.keys(ConfigSchema.shape).sort());
  });

  test("the deny-list is design D4's, each entry with its reason", () => {
    const denied: string[] = [];
    const paths = [...SECTION_NAMES.map((s) => [s]), ...KEY_CONTEXTS.map((c) => ["keys", c])];
    for (const path of paths) {
      const rule = projectRule(path);
      if (typeof rule !== "string" && "denied" in rule) {
        expect(rule.denied.length).toBeGreaterThan(10);
        denied.push(path.join("."));
      }
    }
    expect(denied.sort()).toEqual(["agent_servers", "agent_startup_timeout_seconds", "clipboard", "default_agent_server", "keys.card", "keys.elicitation", "terminals"]);
    // Anything below a denied entry is denied; other keys contexts are allowed.
    expect(projectRule(["keys", "card", "escape"])).toEqual(projectRule(["keys", "card"]));
    expect(projectRule(["keys", "global", "ctrl+q"])).toBe("allowed");
    expect(projectRule(["layout", "screen"])).toBe("allowed");
  });
});

describe("agents (tui-sessions' meaning)", () => {
  test("agent_servers.fake.args as a string fails with its path, saying it takes an array of strings", () => {
    const parsed = parseConfigText(`{ "agent_servers": { "fake": { "command": "bun", "args": "--x" } } }`, "/c.jsonc");
    const problem = parsed.problems.find((p) => p.path === "agent_servers.fake.args");
    expect(problem).toBeDefined();
    expect(problem!.severity).toBe("error");
    expect(problem!.message).toBe('takes an array of strings, not "--x"');
    expect(parsed.invalidAgents["fake"]).toStartWith("has invalid args");
    expect(parsed.sections.agent_servers).toEqual({});
  });

  test("an entry in Zed's shape: command, args and env, args and env defaulted", () => {
    expect(SECTIONS.agent_servers.parse({ fake: { command: "bun" } })).toEqual({ fake: { command: "bun", args: [], env: {} } });
    expect(SECTIONS.default_agent_server.parse(undefined)).toBe("auggie");
  });
});
