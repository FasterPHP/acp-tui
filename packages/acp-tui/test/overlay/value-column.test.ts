// A picker's descriptions use the room between the names and the row's end (a1x follow-up 4).
import { describe, expect, test } from "bun:test";
import { pickerNote } from "../../src/overlay/palette.ts";
import { overlayLayout, type ListItem } from "../../src/overlay/list.ts";

const ITEMS: ListItem[] = [
  { id: "a", group: null, title: "Claude Sonnet 4.5", value: "Best for everyday coding, balanced speed and quality across large repositories", current: true },
  { id: "b", group: null, title: "GPT-5", value: "OpenAI's flagship model, strongest at long multi-step reasoning tasks and planning" },
  { id: "c", group: null, title: "Haiku", value: "Fast" },
];

function rows(width: number): string[] {
  const layout = overlayLayout({ title: "Model", filter: null, placeholder: "", items: ITEMS, grouped: false, selected: 0, offset: 0, width, rows: 30, closeLabel: "esc", hints: [], marks: true, valueColumn: true });
  return layout.lines.map((r) => r.map((s) => s.text).join(""));
}

describe("picker value column", () => {
  for (const width of [80, 63]) {
    test(`at ${width} columns: descriptions start in one column and are cut only at the row's end`, () => {
      const text = rows(width);
      const sonnet = text.find((r) => r.includes("Claude Sonnet 4.5"))!;
      const gpt = text.find((r) => r.includes("GPT-5"))!;
      const haiku = text.find((r) => r.includes("Haiku"))!;
      expect(sonnet).toContain("● Claude Sonnet 4.5");
      const at = sonnet.indexOf("Best");
      expect(gpt.indexOf("OpenAI")).toBe(at);
      expect(haiku.indexOf("Fast")).toBe(at);
      // Long descriptions fill the row up to the frame, with an ellipsis at the end only.
      expect(sonnet).toMatch(/…\s*│$/);
      expect(sonnet.indexOf("Best for everyday coding, balanced")).toBe(at);
      expect(haiku).not.toContain("…");
      for (const r of [sonnet, gpt, haiku]) expect([...r].length).toBe(width);
    });
  }
});

describe("picker note for an unnamed current model", () => {
  const option = (currentValue: string, category = "model") =>
    ({ type: "select", id: "m", name: "Model", category, currentValue, options: [{ value: "a", name: "A" }] }) as Parameters<typeof pickerNote>[0];
  test("an empty current model is explained; a named one or another category is not", () => {
    expect(pickerNote(option(""))).toBe("● default: the harness's own choice");
    expect(pickerNote(option(""), "Auggie")).toBe("● default: Auggie's own choice");
    expect(pickerNote(option("a"), "Auggie")).toBeNull();
    expect(pickerNote(option("a"))).toBeNull();
    expect(pickerNote(option("", "mode"))).toBeNull();
  });
});
