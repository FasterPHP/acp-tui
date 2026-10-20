// day-two-feedback task 7.1, spec tui-config "Prompt cursor setting": `prompt.cursor`, its default,
// its values, its place in the commented default and in a project file.
import { describe, expect, test } from "bun:test";
import { commentedDefault } from "../../src/config/default-file.ts";
import { parseConfigText } from "../../src/config/load.ts";
import { defaultConfig, projectRule, PROMPT_CURSORS, SECTIONS } from "../../src/config/schema.ts";

describe("prompt.cursor", () => {
  test("Default: a block after the end of the text and a bar inside it", () => {
    expect(defaultConfig().prompt).toEqual({ cursor: "block_at_end" });
    expect(PROMPT_CURSORS).toEqual(["bar", "block", "block_at_end"]);
  });

  test("every value loads, and another is a problem that keeps the section's last good value", () => {
    for (const cursor of PROMPT_CURSORS) {
      const parsed = parseConfigText(`{ "prompt": { "cursor": "${cursor}" } }`, "/c.jsonc");
      expect(parsed.problems).toEqual([]);
      expect(parsed.sections.prompt).toEqual({ cursor });
    }
    const bad = parseConfigText(`{ "prompt": { "cursor": "line" } }`, "/c.jsonc");
    expect(bad.problems.map((p) => p.severity)).toEqual(["error"]);
    expect(bad.problems[0]!.path).toBe("prompt.cursor");
    expect(bad.rejected).toEqual(["prompt"]);
  });

  test("Commented default: the setting, its default and its values with their meaning", () => {
    const text = commentedDefault();
    expect(text).toMatch(/^ {2}"prompt": \{\n {4}\/\/ The shape of the cursor in the prompt box:/m);
    expect(text).toContain('"cursor": "block_at_end"');
    for (const value of PROMPT_CURSORS) expect(text).toContain(`"${value}" - `);
    expect(SECTIONS.prompt.parse(undefined)).toEqual({ cursor: "block_at_end" });
  });

  test("a project file may set it", () => {
    expect(projectRule(["prompt", "cursor"])).toBe("allowed");
  });
});
