// The projection's fast path for plain text (`plainParagraphs`, the find's first search over tool
// output an agent sends unfenced): it gives exactly what the lexed projection gives, and declines
// every text with something Markdown could read in it.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { DEFAULT_GLYPHS } from "../../../src/conversation/glyphs.ts";
import { plainParagraphs, projectMessage } from "../../../src/conversation/markdown/project.ts";
import { MARKDOWN_GALLERY } from "../../selection/fixtures.ts";

// Imported by a computed path: acp-tui does not depend on the fake-agent package.
const { generateLongSessionItems } = (await import(join(import.meta.dir, "../../../../fake-agent/src/long-session-items.ts"))) as {
  generateLongSessionItems: (n: number) => Iterable<{ kind: string; output?: string | null }>;
};

const lexed = (text: string) => projectMessage(text, DEFAULT_GLYPHS, false, false);
const fast = (text: string) => projectMessage(text, DEFAULT_GLYPHS, false, true);

const ACCEPTED: readonly string[] = [
  "",
  "one line",
  "PASS  src/Kernel.php > case 1 (12 ms)\nWARN  slow test: src/Http/Router.php (300 ms)\nExit code 0",
  "first paragraph\n\nsecond paragraph",
  "\n\nleading blank lines\nthen a soft break\n\n\n\nafter four blank lines\n\n",
  "trailing newline\n",
  "1234567890. ten digits is no list",
  "a mid-line # hash, > quote, = sign, + plus and - minus",
  "wide 日本語 and emoji 👨‍👩‍👧 and accents émoji",
  "Error! 100% done; {braces} \"quotes\" 'apostrophes' ^caret? (parentheses)",
  "FAIL  1 test failed\nExit code 1",
];

const DECLINED: readonly string[] = [
  "*emphasis*",
  "snake_case",
  "`code`",
  "~~struck~~",
  "[link](x)",
  "<b>tag</b>",
  "&amp;",
  "back\\slash",
  "$x$",
  "a | b",
  "someone@example.com",
  "see https://example.com",
  "see www.example.com",
  "# heading",
  "> quote",
  "- item",
  "+ item",
  "1. item",
  "2) item",
  "===",
  "    indented code",
  " one space in",
  "hard break  \nnext",
  "tab\there",
  "crlf\r\nline",
  `private ${String.fromCharCode(0xe000)} use`,
  `no-break${String.fromCharCode(0xa0)}space`,
  "Term\n: definition",
  "x".repeat(10_001),
];

describe("plainParagraphs: plain text projected without lexing", () => {
  test("accepted texts project as the lexed projection does", () => {
    for (const text of ACCEPTED) {
      expect(plainParagraphs(text), JSON.stringify(text)).not.toBeNull();
      expect(fast(text)).toEqual(lexed(text));
    }
  });

  test("texts with Markdown in them are left to marked", () => {
    for (const text of DECLINED) expect(plainParagraphs(text), JSON.stringify(text)).toBeNull();
  });

  test("long-session's tool output without its fences: every accepted text agrees with marked", () => {
    let accepted = 0;
    let total = 0;
    for (const item of generateLongSessionItems(1500)) {
      if (item.kind !== "tool" || !item.output) continue;
      const text = item.output.replace(/^```[^\n]*\n/, "").replace(/\n```$/, "");
      total += 1;
      if (!plainParagraphs(text)) continue;
      accepted += 1;
      expect(fast(text)).toEqual(lexed(text));
    }
    // Command output and search results are plain; PHP files (with `$`) are not.
    expect(accepted).toBeGreaterThan(total / 3);
  });

  test("random texts over an alphabet rich in Markdown: whenever accepted, equal to marked", () => {
    const alphabet = ["a", "b", " ", "  ", "\n", "\n\n", "1", "9.", ")", "#", ">", "-", "+", "=", ":", "/", ".", "!", "^", "(", ")", "é", "日", "*", "_", "`", "~", "[", "]", "<", "&", "\\", "$", "|", "@", "www.", "://", "\t"];
    let seed = 0x5eed;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    let accepted = 0;
    for (let n = 0; n < 4000; n++) {
      const length = 1 + (next() % 30);
      let text = "";
      for (let k = 0; k < length; k++) text += alphabet[next() % alphabet.length];
      if (!plainParagraphs(text)) continue;
      accepted += 1;
      expect(fast(text), JSON.stringify(text)).toEqual(lexed(text));
    }
    expect(accepted).toBeGreaterThan(100);
  });

  test("the gallery's paragraphs: whenever accepted, equal to marked", () => {
    for (const text of MARKDOWN_GALLERY.split(/\n{2,}/)) {
      if (!plainParagraphs(text)) continue;
      expect(fast(text)).toEqual(lexed(text));
    }
  });
});
