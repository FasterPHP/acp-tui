// The setting `markdown.table_row_rules` (spec tui-config "Table row rules setting"): its default,
// its three values, the problem for a bad one, and that a project file may set it.
import { describe, expect, test } from "bun:test";
import { commentedDefault } from "../../src/config/default-file.ts";
import { parseConfigText } from "../../src/config/load.ts";
import { defaultConfig } from "../../src/config/schema.ts";

const parse = (text: string, kind?: "project") => parseConfigText(text, kind ? "/repo/.acp-tui.jsonc" : "/home/u/.config/acp-tui/config.jsonc", kind ? { kind } : undefined);

describe("markdown.table_row_rules", () => {
  test("auto by default", () => {
    expect(defaultConfig().markdown.table_row_rules).toBe("auto");
  });

  test("auto, always and never are accepted", () => {
    for (const value of ["auto", "always", "never"]) {
      const parsed = parse(`{ "markdown": { "table_row_rules": "${value}" } }`);
      expect(parsed.problems).toEqual([]);
      expect(parsed.sections["markdown"]).toMatchObject({ table_row_rules: value });
    }
  });

  test("a bad value is a problem naming the allowed values", () => {
    const parsed = parse(`{ "markdown": { "table_row_rules": "sometimes" } }`);
    expect(parsed.problems).toHaveLength(1);
    expect(parsed.problems[0]).toMatchObject({ path: "markdown.table_row_rules", severity: "error" });
    expect(parsed.problems[0]!.message).toContain(`"auto", "always" or "never"`);
  });

  test("a project file may set it", () => {
    const parsed = parse(`{ "markdown": { "table_row_rules": "never" } }`, "project");
    expect(parsed.problems).toEqual([]);
    expect(parsed.sections["markdown"]).toMatchObject({ table_row_rules: "never" });
  });

  test("the commented default lists it with its values", () => {
    const text = commentedDefault();
    expect(text).toContain(`"table_row_rules": "auto"`);
    expect(text).toContain("When a table draws rules between its body rows");
  });
});
