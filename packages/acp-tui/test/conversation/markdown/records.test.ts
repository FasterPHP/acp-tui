// Wide tables as records (mvp-rendering task 5.2; spec tui-rendering "Wide tables as records"):
// below the minimum column width a table is drawn as `Header: value` lines per body row, records
// separated by a rule, and no cell text is ever lost.
import { describe, expect, test } from "bun:test";
import type { Tokens } from "marked";
import { DEFAULT_GLYPHS } from "../../../src/conversation/glyphs.ts";
import { DEFAULT_FLAGS, TABLE_MIN_COLUMN_WIDTH } from "../../../src/conversation/markdown/context.ts";
import { MessageLayout } from "../../../src/conversation/markdown/layout.ts";
import { mapBlockRows, projectMessage } from "../../../src/conversation/markdown/project.ts";
import { rowText, type Row } from "../../../src/conversation/markdown/types.ts";
import { displayWidth } from "../../../src/layout/segments.ts";
import { gallerySource } from "./golden.ts";

const tableRows = (source: string, width: number, flags = DEFAULT_FLAGS): Row[] => {
  const block = new MessageLayout(source, width, DEFAULT_GLYPHS, flags).blocks().find((b) => b.token.type === "table")!;
  return block.rows as Row[];
};

/** The gallery's M20 table. */
const M20 = (() => {
  const source = gallerySource();
  const from = source.indexOf("| Identifier |");
  return source.slice(from, source.indexOf("\n\n", from));
})();

describe("Wide tables as records", () => {
  test("the minimum column width is 10, a setting-shaped flag", () => {
    expect(TABLE_MIN_COLUMN_WIDTH).toBe(10);
    expect(DEFAULT_FLAGS.tableMinColumnWidth).toBe(10);
  });

  test("Seven columns at 63: records, every cell's full text, no word cut with an ellipsis", () => {
    const natural = tableRows(M20, 1000).map((r) => displayWidth(rowText(r)));
    expect(Math.max(...natural)).toBeGreaterThan(140);
    const drawn = tableRows(M20, 61).map(rowText);
    expect(drawn.join("\n")).not.toContain("…");
    expect(drawn.every((r) => displayWidth(r) <= 61)).toBe(true);
    expect(drawn.slice(0, 8)).toEqual([
      "Identifier: 1001",
      "Customer name: Alice Smith",
      "Email address: alice.smith@example.com",
      "Created at: 2026-10-04 09:15",
      "Status: active",
      "Total (GBP): 1,234.56",
      "Notes: First order, paid by card",
      "─".repeat(61),
    ]);
    // The long note wraps with its continuation indented.
    expect(drawn.slice(-2)).toEqual(["Notes: Awaiting a reply from the customer about the refund", "  they asked for"]);
  });

  test("headers in markdown.table.header, the rule between records muted (markdown.table.border) and not copied", () => {
    const rows = tableRows(M20, 61);
    expect(rows[0]!.spans.map((s) => [s.text, s.token])).toEqual([
      ["Identifier", "markdown.table.header"],
      [": ", "markdown.table.header"],
      ["1001", "text"],
    ]);
    const rule = rows[7]!;
    expect(rule).toMatchObject({ decorative: true });
    expect(rule.spans[0]!.token).toBe("markdown.table.border");
    // No rule before the first record or after the last.
    expect(rows[0]!.decorative).toBeUndefined();
    expect(rows.at(-1)!.decorative).toBeUndefined();
  });

  test("the grid is kept while every column fits at the smaller of its natural width and the minimum", () => {
    // Three columns of natural width 12: they fit at 3 * 10 + 10 = 40 columns of chrome and text.
    const source = "| aaaaaaaaaaaa | bbbbbbbbbbbb | cccccccccccc |\n| - | - | - |\n| x | y | z |";
    expect(rowText(tableRows(source, 40)[0]!)).toStartWith("╭");
    expect(rowText(tableRows(source, 39)[0]!)).toBe("aaaaaaaaaaaa: x");
    // A narrow column (natural width 1) keeps its own width, not the minimum.
    expect(rowText(tableRows("| a | bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb |\n| - | - |\n| 1 | 2 |", 24)[0]!)).toStartWith("╭───┬");
    // A larger minimum turns the same table into records.
    expect(rowText(tableRows(source, 40, { ...DEFAULT_FLAGS, tableMinColumnWidth: 11 })[0]!)).toBe("aaaaaaaaaaaa: x");
  });
});

// A seeded generator, so a failure reproduces.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("no cell text is lost (property)", () => {
  const WORDS = ["a", "bb", "ccc", "word", "longer", "verylongwordindeed", "日本語", "x|y", "**bold**", "`code`", "1,234.56", "alice.smith@example.com"];

  function randomTable(random: () => number): string {
    const columns = 1 + Math.floor(random() * 8);
    const body = 1 + Math.floor(random() * 4);
    const cell = () => {
      const n = Math.floor(random() * 5);
      return Array.from({ length: n }, () => WORDS[Math.floor(random() * WORDS.length)]!.replace("|", "\\|")).join(" ");
    };
    const row = () => `| ${Array.from({ length: columns }, cell).join(" | ")} |`;
    const align = Array.from({ length: columns }, () => [":--", ":-:", "--:", "---"][Math.floor(random() * 4)]).join(" | ");
    return [row().replace(/\|\s+\|/g, "| h |"), `| ${align} |`, ...Array.from({ length: body }, row)].join("\n");
  }

  test("at every width from 20 to 200, every character of every cell is drawn and maps to itself", () => {
    const random = rng(5021);
    for (let round = 0; round < 40; round++) {
      const source = randomTable(random);
      const whole = projectMessage(source, DEFAULT_GLYPHS);
      const block = whole.blocks.find((b) => b.kind === "table")!;
      const table = new MessageLayout(source, 100, DEFAULT_GLYPHS).blocks().find((b) => b.token.type === "table")!.token as Tokens.Table;
      expect(table.type).toBe("table");
      const text = whole.text.slice(block.start, block.end);
      for (let width = 20; width <= 200; width += 1) {
        const laid = new MessageLayout(source, width, DEFAULT_GLYPHS).blocks().find((b) => b.token.type === "table")!;
        const cells = mapBlockRows(laid.rows, text, block.start, true)!;
        const seen = new Set<number>();
        laid.rows.forEach((row, r) => {
          if (displayWidth(rowText(row)) > width) throw new Error(`width ${width}: ${JSON.stringify(rowText(row))}\n${source}`);
          const map = cells[r];
          if (!map) return;
          for (const at of map.from) if (at >= 0) seen.add(at);
        });
        expect(laid.rows.map(rowText).join("\n")).not.toContain("…");
        // Every non-space character of the projection (the cells' text) is drawn somewhere.
        for (let k = 0; k < text.length; k++) {
          if (/\s/.test(text[k]!)) continue;
          if (!seen.has(block.start + k)) throw new Error(`width ${width}: ${JSON.stringify(text[k])} at ${k} of ${JSON.stringify(text)} not drawn\n${source}`);
        }
      }
    }
  });
});
