// Blockquotes and GitHub alerts (mvp-rendering task 4.5; spec tui-rendering "Blockquotes",
// "GitHub alerts"): one bar per level in markdown.quote, the quoted text in markdown.quote, lists
// and code inside drawn as elsewhere; an alert's bar and header word in its kind's token, its
// marker line not shown.
import { describe, expect, test } from "bun:test";
import { ASCII_GLYPHS, DEFAULT_GLYPHS } from "../../../src/conversation/glyphs.ts";
import { MessageLayout } from "../../../src/conversation/markdown/layout.ts";
import { projectMessage } from "../../../src/conversation/markdown/project.ts";
import { rowText, type Row } from "../../../src/conversation/markdown/types.ts";

const rows = (source: string, width = 40, glyphs = DEFAULT_GLYPHS): Row[] =>
  new MessageLayout(source, width, glyphs).blocks().flatMap((b) => [...Array<Row>(b.marginTop).fill({ spans: [] }), ...b.rows]);
const text = (source: string, width = 40, glyphs = DEFAULT_GLYPHS) => rows(source, width, glyphs).map(rowText);

describe("Blockquotes", () => {
  test("Nested quote: the innermost rows begin with three bars and show no `>`", () => {
    const drawn = text("> one\n>\n> > two\n> >\n> > > three");
    expect(drawn).toEqual(["│ one", "│", "│ │ two", "│ │", "│ │ │ three"]);
    expect(drawn.some((r) => r.includes(">"))).toBe(false);
  });

  test("the bars and the quoted text are in markdown.quote; the bars are decoration", () => {
    const [row] = rows("> quoted *text*");
    expect(row!.spans.map((s) => [s.text, s.token, s.projection, !!s.italic])).toEqual([
      ["│ ", "markdown.quote", "", false],
      ["quoted ", "markdown.quote", undefined, false],
      ["text", "markdown.quote", undefined, true],
    ]);
  });

  test("lists and code inside a quote are drawn as elsewhere", () => {
    const drawn = rows("> - item\n>\n> ```\n> code\n> ```");
    // The code block's padding rows and two columns of padding (day-one-feedback task group 13).
    expect(drawn.map(rowText)).toEqual(["│ ● item", "│", "│   ", "│   code", "│   "]);
    expect(drawn[0]!.spans[1]).toMatchObject({ text: "● ", token: "markdown.list" });
    expect(drawn[3]!.spans[1]).toMatchObject({ text: " ", token: "muted", fill: "surface.code", projection: "" });
    expect(drawn[3]!.spans[2]).toMatchObject({ text: " ", token: "muted", fill: "surface.code", projection: "" });
    expect(drawn[3]!.spans[3]).toMatchObject({ text: "code", token: "code.default", fill: "surface.code" });
  });

  test("a wrapped quoted line keeps its bar on every row", () => {
    expect(text("> one two three four five six", 12)).toEqual(["│ one two", "│ three four", "│ five six"]);
  });

  test("the ascii glyph set's bar", () => {
    expect(text("> > q", 20, ASCII_GLYPHS)).toEqual(["| | q"]);
  });
});

describe("GitHub alerts", () => {
  test("Warning alert: `Warning` in the warning token, then `Be careful.`, no marker, no link style", () => {
    const drawn = rows("> [!WARNING]\n> Be careful.");
    expect(drawn.map(rowText)).toEqual(["│ Warning", "│ Be careful."]);
    expect(drawn[0]!.spans).toEqual([
      { text: "│ ", token: "markdown.alert.warning", projection: "" },
      { text: "Warning", token: "markdown.alert.warning", bold: true },
    ]);
    expect(drawn[1]!.spans[0]).toMatchObject({ text: "│ ", token: "markdown.alert.warning" });
    expect(drawn.flatMap((r) => r.spans).some((s) => s.link || s.token === "markdown.link")).toBe(false);
  });

  test("all five kinds, in any case, each in its own token", () => {
    for (const [marker, word] of [
      ["NOTE", "Note"],
      ["tip", "Tip"],
      ["Important", "Important"],
      ["warning", "Warning"],
      ["CAUTION", "Caution"],
    ] as const) {
      const [header, body] = rows(`> [!${marker}]\n> Body.`);
      expect(rowText(header!)).toBe(`│ ${word}`);
      expect(header!.spans[1]!.token as string).toBe(`markdown.alert.${word.toLowerCase()}`);
      expect(rowText(body!)).toBe("│ Body.");
    }
  });

  test("an alert whose text follows after a blank line (no blank row under the header), and an alert with nothing else", () => {
    expect(text("> [!TIP]\n>\n> Later.")).toEqual(["│ Tip", "│ Later."]);
    expect(text("> [!NOTE]")).toEqual(["│ Note"]);
  });

  test("any other bracketed first line leaves the quote ordinary", () => {
    for (const source of ["> [!FOO]\n> text", "> [x] text", "> [!NOTE] on the same line"]) {
      const [first] = rows(source);
      expect(first!.spans[0]!.token).toBe("markdown.quote");
      expect(rowText(first!).startsWith("│ [")).toBe(true);
    }
  });

  test("the header word is copied; the marker is not", () => {
    expect(projectMessage("> [!WARNING]\n> Be careful.", DEFAULT_GLYPHS).text).toBe("Warning\nBe careful.");
  });
});
