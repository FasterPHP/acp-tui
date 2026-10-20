// day-one-feedback settings (spec tui-config "Busy indicator setting", "Terminal title setting"):
// their defaults, ranges and problems, through the real loader.
import { describe, expect, test } from "bun:test";
import { parseConfigText } from "../../src/config/load.ts";
import { defaultConfig } from "../../src/config/schema.ts";

const FILE = "/home/u/.config/acp-tui/config.jsonc";
const parse = (text: string) => parseConfigText(text, FILE);

describe("busy.track_percent", () => {
  test("defaults to 40 (Marcus, 15 October 2026)", () => {
    expect(defaultConfig().busy).toEqual({ track_percent: 40, style: "gap" });
  });

  test("a narrower sweep: 25 is accepted", () => {
    const parsed = parse(`{ "busy": { "track_percent": 25 } }`);
    expect(parsed.problems).toEqual([]);
    expect(parsed.sections["busy"]).toEqual({ track_percent: 25 });
  });

  test("outside 5 to 50, or not a whole number, is a problem naming the setting and the allowed values", () => {
    for (const bad of ["4", "51", "12.5", `"wide"`]) {
      const problems = parse(`{ "busy": { "track_percent": ${bad} } }`).problems;
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatchObject({ path: "busy.track_percent", severity: "error" });
      expect(problems[0]!.message).toContain("5 to 50");
    }
  });

  test("a project file may set it", () => {
    const parsed = parseConfigText(`{ "busy": { "track_percent": 30 } }`, "/repo/.acp-tui.jsonc", { kind: "project" });
    expect(parsed.problems).toEqual([]);
    expect(parsed.sections["busy"]).toEqual({ track_percent: 30 });
  });
});

describe("title.format", () => {
  test("defaults to the directory's name and the instance counter", () => {
    expect(defaultConfig().title).toEqual({ format: "{dir}{counter}" });
  });

  test("Agent title kept: a format with {title} is accepted", () => {
    const parsed = parse(`{ "title": { "format": "{dir}{counter} · {title}" } }`);
    expect(parsed.problems).toEqual([]);
    expect(parsed.sections["title"]).toEqual({ format: "{dir}{counter} · {title}" });
  });

  test("Unknown placeholder: a problem names title.format, {repo} and the allowed placeholders", () => {
    const parsed = parse(`{ "title": { "format": "{repo}" } }`);
    expect(parsed.problems).toHaveLength(1);
    const problem = parsed.problems[0]!;
    expect(problem.path).toBe("title.format");
    expect(problem.message).toContain("{repo}");
    expect(problem.message).toContain("{dir}, {counter}, {agent}, {title}");
    // The section keeps its last good value (here: absent, so the default applies).
    expect(parsed.sections["title"]).toBeUndefined();
  });

  test("an unparsable template is a problem too", () => {
    const problems = parse(`{ "title": { "format": "{dir" } }`).problems;
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ path: "title.format", severity: "error" });
  });
});
