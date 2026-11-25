// day-two-feedback task 7.1, spec tui-config "Prompt cursor setting": `prompt.cursor`, its default,
// its values, its place in the commented default and in a project file.
import { describe, expect, test } from "bun:test";
import { commentedDefault } from "../../src/config/default-file.ts";
import { parseConfigText } from "../../src/config/load.ts";
import { defaultConfig, projectRule, PROMPT_CURSORS, SECTIONS } from "../../src/config/schema.ts";

describe("prompt.cursor", () => {
  test("Default: a block after the end of the text and a bar inside it", () => {
    expect(defaultConfig().prompt).toEqual({ cursor: "block_at_end", keep_drafts: true });
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
    expect(SECTIONS.prompt.parse(undefined)).toEqual({ cursor: "block_at_end", keep_drafts: true });
  });

  test("a project file may set it", () => {
    expect(projectRule(["prompt", "cursor"])).toBe("allowed");
  });
});

// prompt-box-feedback task 6.2, spec tui-config "Draft keeping setting" and "What a project file may set".
describe("prompt.keep_drafts", () => {
  const parseKind = (text: string, kind: "user" | "project") => parseConfigText(text, "/c.jsonc", { kind });

  test("Default: true, and a session left with a draft gets it back (the default applies without a file)", () => {
    expect(defaultConfig().prompt.keep_drafts).toBe(true);
  });

  test("a boolean only: false loads, another type is a problem that keeps the section's last good value", () => {
    expect(parseKind(`{ "prompt": { "keep_drafts": false } }`, "user").sections.prompt).toEqual({ keep_drafts: false });
    const bad = parseKind(`{ "prompt": { "keep_drafts": "no" } }`, "user");
    expect(bad.problems[0]!.path).toBe("prompt.keep_drafts");
    expect(bad.rejected).toEqual(["prompt"]);
  });

  test("Commented default: the setting at true with the comment about the state directory, anything typed and the exit text", () => {
    const text = commentedDefault();
    expect(text).toContain('"keep_drafts": true');
    expect(text).toMatch(/\/\/ Keep an unsent draft per session[^"]*state directory[^"]*anything you typed[^"]*printed below the command line at exit/);
  });

  test("Draft keeping in a project file: keep_drafts is not allowed and the rest of the prompt section applies", () => {
    expect(projectRule(["prompt", "keep_drafts"])).toEqual({ denied: expect.stringContaining("project file") });
    expect(projectRule(["prompt", "cursor"])).toBe("allowed");
    const parsed = parseKind(`{ "prompt": { "keep_drafts": true, "cursor": "bar" } }`, "project");
    expect(parsed.problems.map((p) => p.path)).toEqual(["prompt.keep_drafts"]);
    expect(parsed.problems[0]!.message).toContain("is not allowed in a project file");
    expect(parsed.sections.prompt).toEqual({ cursor: "bar" });
  });
});
