// day-one-feedback task 6.2 (spec tui-rendering "Code blocks"; tui-config "Rendering settings"):
// code lines break at the last space that fits, with the continuation mark on code fences only, at
// the column for a word longer than a row and under `markdown.code_wrap` `column`; the break keeps
// every character, so the rows read back as the text, and the counted height equals the rows.
import { afterEach, describe, expect, test } from "bun:test";
import type { ToolCallItem } from "acp-model";
import { toolCardHeight, toolCardLayout } from "../../../src/conversation/card.ts";
import { DEFAULT_GLYPHS } from "../../../src/conversation/glyphs.ts";
import { codeRows } from "../../../src/conversation/markdown/code.ts";
import { setRenderSettings, type CodeWrap } from "../../../src/conversation/markdown/context.ts";
import { mapBlockRows } from "../../../src/conversation/markdown/project.ts";
import { rowText, type Row } from "../../../src/conversation/markdown/types.ts";

afterEach(() => setRenderSettings(null));

const MARK = DEFAULT_GLYPHS.markdown.codeContinuation;
/** The columns of padding at each side of a code block outside a card (`cards.padding.columns`). */
const PAD = 2;
const SENTENCE = "The quick brown fox jumps over the lazy dog while the afternoon light slowly fades behind the hills and the river keeps running to the sea.";

function rows(text: string, lang: string, width: number, wrap: CodeWrap = "word", inCard = false): Row[] {
  return codeRows(text, lang, { width, glyphs: DEFAULT_GLYPHS.markdown, flags: { emoji: [], codeWrap: wrap } }, inCard ? { inCard: true } : {});
}

/** The drawn code of each row: without the pad (and the mark), the padding and label rows left out. */
function drawn(list: readonly Row[], inCard = false): string[] {
  return list
    .filter((row) => !row.decorative)
    .map((row) => rowText(row).slice(inCard ? 0 : PAD))
    .map((t) => (t.endsWith(MARK) ? t.slice(0, -MARK.length) : t));
}

const marked = (list: readonly Row[]) => list.filter((row) => !row.decorative && rowText(row).endsWith(MARK)).length;

describe("Prose fence wraps at words", () => {
  test("a 150-character sentence in a `text` fence at 63 columns: every break at a space, no word split, no mark, copy gives it on one line", () => {
    expect(SENTENCE.length).toBeGreaterThan(130);
    const list = rows(SENTENCE, "text", 63);
    const lines = drawn(list);
    expect(lines.length).toBeGreaterThan(2);
    expect(marked(list)).toBe(0);
    // No word is split: every drawn row is whole words, and they are the sentence's words in order.
    for (const line of lines) {
      expect(line).not.toMatch(/^ | $/);
      // 63 columns less the padding at each side and the mark's column.
      expect(line.length).toBeLessThanOrEqual(58);
    }
    expect(lines.join(" ")).toBe(SENTENCE);
    // The rows read back as the sentence on one line, exactly as written.
    expect(mapBlockRows(list, SENTENCE, 0)).not.toBeNull();
    // The rows are as full as the words allow: no word would have fitted on the row above.
    lines.slice(0, -1).forEach((line, i) => {
      const next = lines[i + 1]!.split(" ")[0]!;
      expect(line.length + 1 + next.length).toBeGreaterThan(58);
    });
  });

  test("every prose language word is prose: text, txt, plaintext, plain, markdown, md (any case)", () => {
    for (const lang of ["text", "txt", "plaintext", "plain", "markdown", "md", "Text", "MD"]) {
      expect(marked(rows(SENTENCE, lang, 40)), lang).toBe(0);
    }
    for (const lang of ["", "php", "console", "ts", "textual"]) expect(marked(rows(SENTENCE, lang, 40)), lang).toBeGreaterThan(0);
  });
});

describe("Code keeps its mark", () => {
  test("a `php` fence with a 120-character line with spaces breaks at spaces, each broken row ends with the mark, copy gives the line unbroken", () => {
    const line = "$total = array_sum(array_map(fn($line) => $line->net() + $line->tax(), $this->lines)) - $this->discount->amount();";
    expect(line.length).toBeGreaterThan(110);
    const list = rows(line, "php", 63);
    const lines = drawn(list);
    expect(lines.length).toBeGreaterThan(1);
    // All rows but the last end with the mark; none is split inside a word.
    const body = list.filter((row) => !row.decorative);
    body.slice(0, -1).forEach((row) => expect(rowText(row).endsWith(MARK)).toBe(true));
    expect(rowText(body.at(-1)!).endsWith(MARK)).toBe(false);
    expect(lines.join(" ")).toBe(line);
    expect(lines.every((l) => !/^ | $/.test(l))).toBe(true);
    expect(mapBlockRows(list, line, 0)).not.toBeNull();
  });
});

describe("Column wrap on request", () => {
  test("with `column` the same `text` fence breaks at the column, mid-word, with the continuation mark", () => {
    const list = rows(SENTENCE, "text", 63, "column");
    const body = list.filter((row) => !row.decorative);
    // 63 - 2 * 2 - 1 = 58 columns of code behind the pad, then the mark (the right padding is fill).
    body.slice(0, -1).forEach((row) => {
      expect(rowText(row).length).toBe(PAD + 58 + MARK.length);
      expect(rowText(row).endsWith(MARK)).toBe(true);
    });
    expect(drawn(list).join("")).toBe(SENTENCE);
    expect(mapBlockRows(list, SENTENCE, 0)).not.toBeNull();
  });

  test("`prose` breaks a `text` fence at spaces without a mark and a `php` fence at the column with it", () => {
    const text = rows(SENTENCE, "text", 63, "prose");
    const php = rows(SENTENCE, "php", 63, "prose");
    expect(marked(text)).toBe(0);
    expect(drawn(text).join(" ")).toBe(SENTENCE);
    expect(drawn(php).join("")).toBe(SENTENCE);
    expect(marked(php)).toBe(drawn(php).length - 1);
    // The default is `word`: a `php` fence breaks at spaces.
    expect(drawn(rows(SENTENCE, "php", 63)).join(" ")).toBe(SENTENCE);
  });
});

describe("a word longer than a row, leading spaces and runs of spaces", () => {
  const LONG = "x".repeat(150);

  test("a long word breaks at the column (with the mark on code, without on prose), and the words around it still wrap at spaces", () => {
    const line = `see ${LONG} and then a few more words after it`;
    const code = rows(line, "php", 40);
    const prose = rows(line, "text", 40);
    for (const list of [code, prose]) {
      expect(mapBlockRows(list, line, 0)).not.toBeNull();
      expect(drawn(list).join("").replace(/\s+/g, "")).toBe(line.replace(/\s+/g, ""));
    }
    expect(drawn(code)[0]).toBe("see");
    expect(marked(prose)).toBe(0);
    expect(drawn(prose).slice(-1)[0]).toMatch(/words after it$/);
    // 40 columns less the padding at each side and the mark's column.
    expect(drawn(prose).some((l) => l === "x".repeat(35))).toBe(true);
  });

  test("a leading indentation is kept, and a break opportunity needs a word before it", () => {
    const line = `        ${"word ".repeat(12).trim()}`;
    const list = rows(line, "php", 30);
    const lines = drawn(list);
    expect(lines[0]!.startsWith("        word")).toBe(true);
    expect(mapBlockRows(list, line, 0)).not.toBeNull();
    // Only spaces: nothing to break at, so the column decides (and the rows still read back).
    const blank = " ".repeat(90);
    expect(mapBlockRows(rows(blank, "php", 30), blank, 0)).not.toBeNull();
  });

  test("copy rejoins each line exactly: tabs, runs of spaces, trailing spaces and a long word, in every mode and for code and prose", () => {
    const lines = [
      "\tif ($a)   {\t return   $b;  }  // a comment with   several    runs of    spaces   in it",
      `${LONG} ${LONG}`,
      "short",
      "",
      "trailing spaces after the words that wrap around the rows        ",
      "    indented    code    with    wide    gaps    between    the    words    of    the    line",
      `  ${"ab ".repeat(40)}`,
      "wide characters 日本語のテキスト and emoji 😀 words wrap around the narrow rows of the block",
    ];
    const text = lines.join("\n");
    for (const wrap of ["word", "prose", "column"] as const) {
      for (const lang of ["php", "text", ""]) {
        for (const width of [20, 31, 63, 100]) {
          const list = rows(text, lang, width, wrap);
          expect(mapBlockRows(list, text, 0), `${wrap} ${lang} ${width}`).not.toBeNull();
          for (const row of list) expect(rowText(row).length, `${wrap} ${lang} ${width}`).toBeLessThanOrEqual(width + 20);
        }
      }
    }
  });
});

describe("heights (task 6.2)", () => {
  const tool = (text: string): ToolCallItem => ({
    id: "tool:t",
    kind: "tool_call",
    status: "final",
    origin: "self",
    toolCallId: "t",
    index: 1,
    title: "Run",
    toolName: null,
    toolKind: "execute",
    toolStatus: "completed",
    content: [{ type: "text", text }],
    locations: [],
    rawOutputText: null,
    startedAt: 0,
    endedAt: 1,
  });

  test("the counted height equals the layout's rows for fences of printable text, in every mode, at several widths", () => {
    const fences = [
      `\`\`\`text\n${SENTENCE}\n${SENTENCE.slice(20)}\n\`\`\``,
      `\`\`\`php\n$total = array_sum(array_map(fn($line) => $line->net(), $this->lines)) - $this->discount;\n\`\`\``,
      `\`\`\`\n${"word ".repeat(40)}\n${"x".repeat(200)}\n    indented ${"y ".repeat(50)}\n\`\`\``,
      `\`\`\`console\n${"a".repeat(37)} ${"b".repeat(25)}\n\`\`\``,
    ];
    for (const wrap of ["word", "prose", "column"] as const) {
      setRenderSettings({ codeWrap: wrap });
      for (const inner of [20, 36, 59, 96]) {
        for (const fence of fences) {
          const item = tool(fence);
          const counted = toolCardHeight({ ...item }, inner, false, DEFAULT_GLYPHS, false);
          expect({ wrap, inner, fence: fence.slice(0, 20), counted }).toEqual({ wrap, inner, fence: fence.slice(0, 20), counted: toolCardLayout(item, inner, false, DEFAULT_GLYPHS, false).rows.length });
        }
      }
    }
  });
});
