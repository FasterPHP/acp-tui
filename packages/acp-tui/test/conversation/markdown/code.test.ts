// Code blocks as rows (mvp-rendering tasks 8.4 and 8.5; spec tui-rendering "Code blocks",
// "Syntax highlighting" (Unknown language), "Diff fences"): the fill, the label, continuation
// marks, tab stops, the flat theme's rule, the card fill option, and diff fences by line role.
import { describe, expect, test } from "bun:test";
import { RGBA } from "@opentui/core";
import { DEFAULT_GLYPHS } from "../../../src/conversation/glyphs.ts";
import { codeRows, diffLineTokens } from "../../../src/conversation/markdown/code.ts";
import { rowsToChunks } from "../../../src/conversation/markdown/draw.ts";
import { codeFiletype } from "../../../src/conversation/markdown/filetype.ts";
import { MessageLayout } from "../../../src/conversation/markdown/layout.ts";
import { projectRows, rowText, type Row } from "../../../src/conversation/markdown/types.ts";
import { displayWidth } from "../../../src/layout/segments.ts";
import { DEFAULT_THEME, resolveTheme } from "../../../src/theme/index.ts";
import { gallerySource } from "./golden.ts";
import { setRenderSettings, terminalFlags } from "../../../src/conversation/markdown/context.ts";
import { mapBlockRows, projectMessage } from "../../../src/conversation/markdown/project.ts";
import { markdownRows } from "../../../src/conversation/window/heights.ts";

const GLYPHS = DEFAULT_GLYPHS.markdown;
const layout = (width: number) => ({ width, glyphs: GLYPHS });
/** The padding before day-one-feedback's task group 13 (no padding rows, one column), for the
 *  tests about how lines break, tabs and diff tokens rather than the padding. */
const tight = (width: number) => ({ width, glyphs: GLYPHS, flags: { codePadding: { rows: 0, columns: 1 } } });
const DARK = { foreground: "#bcbec4", background: "#191a1c" };

/** The rows of the first code block in `markdown` at `width` (a message's own layout). */
function blockRows(markdown: string, width: number): readonly Row[] {
  const block = new MessageLayout(markdown, width, DEFAULT_GLYPHS).blocks().find((b) => b.token.type === "code");
  if (!block) throw new Error("no code block");
  return block.rows;
}

/** The text drawn per row by `rowsToChunks`, and the background of each chunk. */
function drawn(rows: readonly Row[], width: number, flat: boolean) {
  const theme = resolveTheme(DEFAULT_THEME, flat ? {} : { terminal: DARK });
  const lines: { text: string; bgs: (RGBA | undefined)[] }[] = [{ text: "", bgs: [] }];
  for (const c of rowsToChunks(rows, width, theme)) {
    if (c.text === "\n") {
      lines.push({ text: "", bgs: [] });
      continue;
    }
    const line = lines[lines.length - 1]!;
    line.text += c.text;
    for (let i = 0; i < displayWidth(c.text); i++) line.bgs.push(c.bg);
  }
  return { theme, lines };
}

describe("Code blocks", () => {
  test("Visible block: every row on surface.code across the content width, the first (the top padding row) ending with the muted label php", () => {
    const rows = blockRows("```php\n$x = strlen($y);\necho $x;\n```\n", 61);
    // The cards' padding (day-one-feedback task group 13): a padding row above and below, two
    // columns at each side.
    expect(rows.map(rowText)).toEqual(["  ", "  $x = strlen($y);", "  echo $x;", "  "]);
    expect(rows[0]).toMatchObject({ decorative: true, labelInset: 2, label: { text: "php", token: "muted" } });
    expect(rows.at(-1)!.decorative).toBe(true);
    expect(rows.every((r) => r.fill === "surface.code")).toBe(true);
    const { theme, lines } = drawn(rows, 61, false);
    const code = theme.color("surface.code");
    for (const line of lines) {
      expect(displayWidth(line.text)).toBe(61);
      for (const bg of line.bgs) expect(bg?.equals(code)).toBe(true);
    }
    // The label keeps the right padding's two columns, as the code keeps the left's.
    expect(lines[0]!.text.endsWith(" php  ")).toBe(true);
    expect(projectRows(rows)).toBe("$x = strlen($y);\necho $x;");
  });

  test("Flat theme: a muted left rule and the label, and no fill", () => {
    const rows = blockRows("```php\n$x = 1;\n```\n", 61);
    const { lines } = drawn(rows, 61, true);
    // The rule on every row, the padding rows too, then the second padding column.
    expect(lines.map((l) => l.text.trimEnd())).toEqual([`${GLYPHS.codeRule}${" ".repeat(55)}php`, `${GLYPHS.codeRule} $x = 1;`, GLYPHS.codeRule]);
    for (const line of lines) for (const bg of line.bgs) expect(bg).toBeUndefined();
    // The rule is decoration: the projection is the code alone.
    expect(projectRows(rows)).toBe("$x = 1;");
    // Same rows, so the same height, whatever the theme.
    expect(rows.length).toBe(3);
  });

  test("with a padding row the label sits on it, and never takes a row of its own", () => {
    const rows = codeRows("x".repeat(19), "python", layout(30));
    expect(rows.map(rowText)).toEqual(["  ", `  ${"x".repeat(19)}`, "  "]);
    expect(rows[0]).toMatchObject({ decorative: true, label: { text: "python" }, labelInset: 2 });
    expect(projectRows(rows)).toBe("x".repeat(19));
  });

  test("without padding rows the label takes a row of its own when the first line would reach it, and that row is not projected", () => {
    const rows = codeRows("x".repeat(20), "python", tight(24));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ decorative: true, label: { text: "python" } });
    expect(rowText(rows[1]!)).toBe(` ${"x".repeat(20)}`);
    expect(projectRows(rows)).toBe("x".repeat(20));
  });

  test("long lines break at the column with the continuation mark, and the projection rejoins them", () => {
    const line = "abcdefghijklmnopqrstuvwxyz";
    const rows = codeRows(line, "", tight(12));
    // One column of padding at each side, and the mark's column before the right one.
    expect(rows.map(rowText)).toEqual([` abcdefghi${GLYPHS.codeContinuation}`, ` jklmnopqr${GLYPHS.codeContinuation}`, " stuvwxyz"]);
    expect(projectRows(rows)).toBe(line);
    // The ascii set's mark.
    expect(codeRows(line, "", { ...tight(12), glyphs: { ...GLYPHS, codeContinuation: "\\" } })[0]!.spans.at(-1)!.text).toBe("\\");
    // With the default padding the code keeps two columns at each side, and the mark the column
    // before the right padding.
    expect(codeRows(line, "", layout(12)).map(rowText)).toEqual(["  ", `  abcdefg${GLYPHS.codeContinuation}`, `  hijklmn${GLYPHS.codeContinuation}`, `  opqrstu${GLYPHS.codeContinuation}`, "  vwxyz", "  "]);
  });

  test("tabs expand to stops every 8 columns and are copied as tabs", () => {
    const rows = codeRows("a\tb\n\tc", "", tight(40));
    expect(rows.map(rowText)).toEqual([" a       b", "         c"]);
    expect(projectRows(rows)).toBe("a\tb\n\tc");
  });

  test("Unknown language: cobol is drawn in code.default with the label cobol, and is never highlighted", () => {
    const rows = codeRows("DISPLAY 'HELLO'.", "cobol", layout(40));
    expect(rows[0]!.label!.text).toBe("cobol");
    const code = rows.flatMap((r) => r.spans).filter((s) => s.projection === undefined);
    expect(code.map((s) => s.token)).toEqual(["code.default"]);
    expect(code.some((s) => s.code)).toBe(false);
    expect(codeFiletype("cobol")).toBeNull();
  });

  test("a mermaid fence is a code block with its label and no highlighting", () => {
    const rows = blockRows("```mermaid\ngraph LR\n  A --> B\n```\n", 61);
    expect(rows[0]!.label!.text).toBe("mermaid");
    expect(rows.every((r) => r.fill === "surface.code")).toBe(true);
    expect(rows.flatMap((r) => r.spans).some((s) => s.code)).toBe(false);
  });

  test("languages with a grammar mark their code for the highlighter; aliases resolve", () => {
    for (const [lang, filetype] of [
      ["php", "php"],
      ["ts", "typescript"],
      // OpenTUI 0.6 has a TSX grammar of its own (opentui-0-6 design D6).
      ["tsx", "typescriptreact"],
      ["jsx", "javascript"],
      ["js", "javascript"],
      ["json", "json"],
      ["sh", "bash"],
      ["shell", "bash"],
      ["sql", "sql"],
      ["mysql", "sql"],
      ["py", "python"],
      ["yml", "yaml"],
      ["PHP", "php"],
    ] as const) {
      expect(codeFiletype(lang), lang).toBe(filetype);
    }
    for (const lang of ["", "text", "diff", "patch", "console", "markdown"]) expect(codeFiletype(lang), lang).toBeNull();
    const rows = codeRows("$x = 1;\n$y = 2;", "php", layout(40));
    const refs = rows.flatMap((r) => r.spans).filter((s) => s.code);
    expect(refs.map((s) => [s.text, s.code!.at])).toEqual([
      ["$x = 1;", 0],
      ["$y = 2;", 8],
    ]);
    expect(refs[0]!.code!.source).toEqual({ filetype: "php", text: "$x = 1;\n$y = 2;" });
  });

  test("inside an expanded card the card's fill serves (option fill)", () => {
    const rows = codeRows("ls -la", "console", layout(30), { fill: "surface.card" });
    expect(rows.every((r) => r.fill === "surface.card")).toBe(true);
    expect(rows.flatMap((r) => r.spans).every((s) => s.fill === "surface.card")).toBe(true);
    expect(rows[0]!.label).toMatchObject({ text: "console", fill: "surface.card" });
  });

  test("a code block in a list or quote: the container's prefix stays off the fill", () => {
    const rows = new MessageLayout("> ```\n> code\n> ```\n", 30, DEFAULT_GLYPHS).blocks()[0]!.rows;
    const { theme, lines } = drawn(rows, 30, false);
    // The quote's bar and space, then the block's padding row and its two padding columns.
    expect(lines[0]!.text.trimEnd()).toBe("│");
    expect(lines[1]!.text.startsWith("│   code")).toBe(true);
    for (const line of lines) expect(line.bgs[0]).toBeUndefined();
    expect(lines[0]!.bgs[2]?.equals(theme.color("surface.code"))).toBe(true);
    expect(lines[1]!.bgs[2]?.equals(theme.color("surface.code"))).toBe(true);
  });
});

describe("Diff fences", () => {
  test("Diff fence: the gallery's diff sample is coloured by line role, not by a grammar", () => {
    const source = gallerySource();
    const start = source.indexOf("```diff\n");
    const fence = source.slice(start, source.indexOf("```\n", start + 8) + 4);
    const rows = blockRows(fence, 61);
    const tokenOf = (text: string) => rows.find((r) => rowText(r).includes(text))!.spans.find((s) => s.projection === undefined)!.token;
    expect(tokenOf("@@ -3,3 +3,3 @@")).toBe("diff.hunk");
    expect(tokenOf("-    public function greet($name)")).toBe("diff.remove");
    expect(tokenOf("+    public function greet(string $name): string")).toBe("diff.add");
    expect(tokenOf("--- a/src/Greeter.php")).toBe("muted");
    expect(tokenOf("+++ b/src/Greeter.php")).toBe("muted");
    expect(tokenOf(" final class Greeter")).toBe("code.default");
    expect(rows[0]!.label!.text).toBe("diff");
    expect(rows.flatMap((r) => r.spans).some((s) => s.code)).toBe(false);
  });

  test("patch is a diff too; git's header lines are muted; a lone --- line is a removal", () => {
    expect(diffLineTokens(["diff --git a/x b/x", "index 1..2 100644", "--- a/x", "+++ b/x", "@@ -1 +1 @@", "--- removed dashes", "+added", "\\ No newline at end of file"])).toEqual([
      "muted",
      "muted",
      "muted",
      "muted",
      "diff.hunk",
      "diff.remove",
      "diff.add",
      "muted",
    ]);
    const rows = codeRows("@@ -1 +1 @@\n-a\n+b", "patch", tight(30));
    expect(rows.map((r) => r.spans[1]!.token)).toEqual(["diff.hunk", "diff.remove", "diff.add"]);
  });
});

// day-one-feedback task group 13 (Marcus, 15 October 2026; spec tui-rendering "Code blocks"): a
// code block in an answer takes the cards' padding (`cards.padding`), its padding rows decorative.
describe("code block padding in an answer (day-one-feedback 13)", () => {
  test("Padding in an answer: a two-line text fence at 63 columns has a fill row above and below, its lines two columns in, the label two columns from the right, and copying gives the two lines exactly", () => {
    const source = "Before.\n\n```text\nfirst line\nsecond line\n```\n\nAfter.";
    const layout = new MessageLayout(source, 61, DEFAULT_GLYPHS);
    const rows = layout.blocks().find((b) => b.token.type === "code")!.rows;
    expect(rows.map(rowText)).toEqual(["  ", "  first line", "  second line", "  "]);
    expect(rows.map((r) => r.decorative ?? false)).toEqual([true, false, false, true]);
    expect(rows.every((r) => r.fill === "surface.code")).toBe(true);
    const { lines } = drawn(rows, 61, false);
    expect(lines[0]!.text).toBe(`${" ".repeat(61 - 4 - 2)}text  `);
    expect(projectRows(rows)).toBe("first line\nsecond line");
    // The message's copy: the padding rows add no line.
    expect(projectMessage(source, DEFAULT_GLYPHS).text).toBe("Before.\n\nfirst line\nsecond line\n\nAfter.");
    // The drawn rows map onto that text (the selection's row maps), padding rows to nothing.
    const map = mapBlockRows(rows, "first line\nsecond line", 0);
    expect(map).not.toBeNull();
    expect(map![0]).toBeNull();
    expect(map![3]).toBeNull();
  });

  test("Padding from the setting in an answer: rows 0 and columns 3 give no padding rows and the code three columns in, and the height estimate equals the rows", () => {
    setRenderSettings({ cardPadRows: 0, cardPadColumns: 3 });
    try {
      const source = "```php\n$x = 1;\n```\n";
      const layout = new MessageLayout(source, 61, DEFAULT_GLYPHS, terminalFlags(), false);
      const rows = layout.blocks()[0]!.rows;
      expect(rows.map(rowText)).toEqual(["   $x = 1;"]);
      expect(rows[0]).toMatchObject({ label: { text: "php" }, labelInset: 3 });
      expect(markdownRows(source, 61, DEFAULT_GLYPHS, false)).toBe(layout.height());
      expect(layout.height()).toBe(1);
    } finally {
      setRenderSettings(null);
    }
  });

  test("inside a card the block draws no padding of its own, whatever the setting", () => {
    const rows = codeRows("ls", "console", layout(30), { fill: "surface.card", inCard: true });
    expect(rows.map(rowText)).toEqual(["ls"]);
  });
});
