// day-two-feedback settings `busy.style` and `activity.linger_seconds` (specs tui-config "Busy
// indicator setting", "Activity linger setting"): their defaults, values, ranges and problems,
// through the real loader.
import { describe, expect, test } from "bun:test";
import { commentedDefault } from "../../src/config/default-file.ts";
import { parseConfigText } from "../../src/config/load.ts";
import { defaultConfig } from "../../src/config/schema.ts";

const FILE = "/home/u/.config/acp-tui/config.jsonc";
const parse = (text: string) => parseConfigText(text, FILE);

describe("busy.style", () => {
  test("Gap by default", () => {
    expect(defaultConfig().busy.style).toBe("gap");
  });

  test("gap, colour and border are accepted", () => {
    for (const style of ["gap", "colour", "border"]) {
      const parsed = parse(`{ "busy": { "style": "${style}" } }`);
      expect(parsed.problems).toEqual([]);
      expect(parsed.sections["busy"]).toMatchObject({ style });
    }
  });

  test("Unknown style: a problem names busy.style and its three values, and the section keeps its last good value", () => {
    const parsed = parse(`{ "busy": { "style": "blink" } }`);
    expect(parsed.problems).toHaveLength(1);
    expect(parsed.problems[0]).toMatchObject({ path: "busy.style", severity: "error" });
    expect(parsed.problems[0]!.message).toContain(`"gap", "colour" or "border"`);
    expect(parsed.sections["busy"]).toBeUndefined();
  });

  test("a project file may set it", () => {
    const parsed = parseConfigText(`{ "busy": { "style": "border" } }`, "/repo/.acp-tui.jsonc", { kind: "project" });
    expect(parsed.problems).toEqual([]);
    expect(parsed.sections["busy"]).toMatchObject({ style: "border" });
  });
});

describe("activity.linger_seconds", () => {
  test("Default linger: 1.5 seconds", () => {
    expect(defaultConfig().activity).toEqual({ linger_seconds: 1.5 });
  });

  test("0 turns it off, fractions and 5 are accepted", () => {
    for (const seconds of ["0", "0.5", "1", "5"]) {
      const parsed = parse(`{ "activity": { "linger_seconds": ${seconds} } }`);
      expect(parsed.problems).toEqual([]);
      expect(parsed.sections["activity"]).toEqual({ linger_seconds: Number(seconds) });
    }
  });

  test("Out of range: a problem names activity.linger_seconds and says it takes a number from 0 to 5", () => {
    for (const bad of ["10", "-1", `"long"`]) {
      const parsed = parse(`{ "activity": { "linger_seconds": ${bad} } }`);
      expect(parsed.problems).toHaveLength(1);
      expect(parsed.problems[0]).toMatchObject({ path: "activity.linger_seconds", severity: "error" });
      expect(parsed.problems[0]!.message).toContain("a number from 0 to 5");
      expect(parsed.sections["activity"]).toBeUndefined();
    }
  });

  test("a project file may set it", () => {
    const parsed = parseConfigText(`{ "activity": { "linger_seconds": 2 } }`, "/repo/.acp-tui.jsonc", { kind: "project" });
    expect(parsed.problems).toEqual([]);
    expect(parsed.sections["activity"]).toEqual({ linger_seconds: 2 });
  });
});

describe("the commented default", () => {
  test("holds busy.style and activity.linger_seconds with their defaults and descriptions", () => {
    const text = commentedDefault();
    expect(text).toContain(`"style": "gap"`);
    expect(text).toContain("a moving gap in the border's line");
    expect(text).toContain(`"linger_seconds": 1.5`);
    expect(text).toContain("shows the finished call muted");
  });
});
