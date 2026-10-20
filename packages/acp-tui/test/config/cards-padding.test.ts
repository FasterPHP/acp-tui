// day-one-feedback task 5.1 (spec tui-config "Card padding setting"): `cards.padding.rows` and
// `cards.padding.columns`, their defaults and their ranges, and that a project file may set them.
import { describe, expect, test } from "bun:test";
import { parseConfigText } from "../../src/config/load.ts";
import { defaultConfig, projectRule, SECTIONS } from "../../src/config/schema.ts";

describe("cards.padding (task 5.1)", () => {
  test("one row and two columns by default (Marcus, 15 October 2026)", () => {
    expect(defaultConfig().cards).toEqual({ padding: { rows: 1, columns: 2 } });
    expect(SECTIONS.cards.parse(undefined)).toEqual({ padding: { rows: 1, columns: 2 } });
    expect(SECTIONS.cards.parse({ padding: { columns: 1 } })).toEqual({ padding: { rows: 1, columns: 1 } });
  });

  test("the allowed values are 0 or 1 rows and 1 to 3 columns", () => {
    for (const rows of [0, 1]) expect(SECTIONS.cards.safeParse({ padding: { rows } }).success).toBe(true);
    for (const columns of [1, 2, 3]) expect(SECTIONS.cards.safeParse({ padding: { columns } }).success).toBe(true);
    for (const rows of [-1, 2, 0.5, "1"]) expect(SECTIONS.cards.safeParse({ padding: { rows } }).success).toBe(false);
    for (const columns of [0, 4, 1.5, "2"]) expect(SECTIONS.cards.safeParse({ padding: { columns } }).success).toBe(false);
  });

  test("Out of range: a problem names cards.padding.rows and its allowed values, and the default padding stays", () => {
    const rows = parseConfigText(`{ "cards": { "padding": { "rows": 2 } } }`, "/c.jsonc");
    const problem = rows.problems.find((p) => p.path === "cards.padding.rows");
    expect(problem).toBeDefined();
    expect(problem!.severity).toBe("error");
    expect(problem!.message).toBe("takes a whole number from 0 to 1, not 2");
    // The section is rejected whole, so the last good value (here the default) stays in use.
    expect(rows.sections.cards).toBeUndefined();

    const columns = parseConfigText(`{ "cards": { "padding": { "columns": 4 } } }`, "/c.jsonc");
    expect(columns.problems.find((p) => p.path === "cards.padding.columns")?.message).toBe("takes a whole number from 1 to 3, not 4");
    expect(columns.sections.cards).toBeUndefined();
  });

  test("a valid file sets the section, and a project file may set it", () => {
    const parsed = parseConfigText(`{ "cards": { "padding": { "rows": 0, "columns": 2 } } }`, "/c.jsonc");
    expect(parsed.problems).toEqual([]);
    expect(parsed.sections.cards).toEqual({ padding: { rows: 0, columns: 2 } });
    expect(projectRule(["cards", "padding", "columns"])).toBe("allowed");
  });
});
