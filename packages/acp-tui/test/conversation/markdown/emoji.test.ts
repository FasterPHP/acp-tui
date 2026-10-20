// Emoji drawn as their names by the Markdown renderers (mvp-rendering task 14.5, review C11; spec
// tui-rendering "Other extensions stay text"): where the flags' emoji classes (the capability
// table's, per terminal) hold a sequence's class, its rows show the name in `muted`, the
// projection keeps the emoji, the cell maps send every cell of the name to the emoji, and the
// rows never exceed the width.
import { describe, expect, test } from "bun:test";
import { DEFAULT_GLYPHS } from "../../../src/conversation/glyphs.ts";
import { DEFAULT_FLAGS, type MarkdownFlags } from "../../../src/conversation/markdown/context.ts";
import { rowsToChunks } from "../../../src/conversation/markdown/draw.ts";
import { MessageLayout } from "../../../src/conversation/markdown/layout.ts";
import { mapBlockRows, projectMessage } from "../../../src/conversation/markdown/project.ts";
import { rowText, type Row, type Span } from "../../../src/conversation/markdown/types.ts";
import { displayWidth } from "../../../src/layout/segments.ts";
import type { EmojiClass } from "../../../src/render/emoji/emoji.ts";
import { JETBRAINS_EMOJI, NO_CAPABILITIES, ZED_EMOJI } from "../../../src/renderer/capabilities.ts";
import { DEFAULT_THEME, resolveTheme } from "../../../src/theme/index.ts";

const FAMILY = "\u{1F468}‍\u{1F469}‍\u{1F467}";
const FLAG = "\u{1F1EC}\u{1F1E7}";
const ENGLAND = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}";
const KEYCAP = "1️⃣";
const TONE = "\u{1F44D}\u{1F3FD}";
const HEART = "❤️";
const BARE = "❤";
const GRIN = "\u{1F600}";

const flagsOf = (emoji: readonly EmojiClass[]): MarkdownFlags => ({ ...DEFAULT_FLAGS, emoji });
const PHPSTORM = flagsOf(JETBRAINS_EMOJI);
const ZED = flagsOf(ZED_EMOJI);
const UNKNOWN = flagsOf(NO_CAPABILITIES.emoji);

function layout(source: string, width: number, flags: MarkdownFlags): MessageLayout {
  return new MessageLayout(source, width, DEFAULT_GLYPHS, flags, false);
}

function allRows(source: string, width: number, flags: MarkdownFlags): Row[] {
  return layout(source, width, flags).blocks().flatMap((b) => b.rows);
}

const named = (rows: readonly Row[]): Span[] => rows.flatMap((r) => r.spans).filter((s) => s.named && s.projection);
const shown = (rows: readonly Row[]) => rows.map(rowText).join("\n");

/** Every block's rows map onto the message's projection (the selection's contract), and no row
 *  is wider than `width`. */
function checkMaps(source: string, width: number, flags: MarkdownFlags): void {
  const l = layout(source, width, flags);
  const projection = projectMessage(source, DEFAULT_GLYPHS, false, false);
  for (const block of l.blocks()) {
    for (const row of block.rows) expect(displayWidth(rowText(row)), rowText(row)).toBeLessThanOrEqual(width);
    const own = projection.blocks.find((b) => b.index === block.index);
    if (!own) continue;
    const cells = mapBlockRows(block.rows, projection.text.slice(own.start, own.end), own.start, block.token.type === "table");
    expect(cells, `${block.token.type} at ${width}`).not.toBeNull();
  }
}

describe("emoji drawn as their names (task 14.5)", () => {
  test("Family in PhpStorm: the row shows :family_man_woman_girl: in muted, and its projection is the emoji", () => {
    const source = `A family ${FAMILY} here.`;
    const rows = allRows(source, 60, PHPSTORM);
    expect(shown(rows)).toBe("A family :family_man_woman_girl: here.");
    const [name] = named(rows);
    expect(name).toMatchObject({ token: "muted", text: ":family_man_woman_girl:", projection: FAMILY });
    expect(projectMessage(source, DEFAULT_GLYPHS).text).toBe(source);
    // Every cell of the name stands for the whole emoji, so a drag over any of it copies it.
    const cells = mapBlockRows(rows, source, 0)!;
    const at = source.indexOf(FAMILY);
    const from = "A family ".length;
    for (let c = from; c < from + name!.text.length; c++) {
      expect(cells[0]!.from[c]).toBe(at);
      expect(cells[0]!.to[c]).toBe(at + FAMILY.length);
    }
  });

  test("PhpStorm names ZWJ sequences, flags (subdivision flags too), keycaps, tones and bare symbols; VS16 and plain emoji stay", () => {
    const rows = allRows(`${FAMILY} ${FLAG} ${ENGLAND} ${KEYCAP} ${TONE} ${HEART} ${BARE} ${GRIN}`, 200, PHPSTORM);
    expect(shown(rows)).toBe(`:family_man_woman_girl: :flag_united_kingdom: :flag_england: :keycap_1: :thumbs_up_medium_skin_tone: ${HEART} :red_heart: ${GRIN}`);
  });

  test("Zed names ZWJ sequences, keycaps, tones, VS16 and bare symbols; flags stay", () => {
    const rows = allRows(`${FAMILY} ${FLAG} ${ENGLAND} ${KEYCAP} ${TONE} ${HEART} ${BARE} ${GRIN}`, 200, ZED);
    expect(shown(rows)).toBe(`:family_man_woman_girl: ${FLAG} ${ENGLAND} :keycap_1: :thumbs_up_medium_skin_tone: :red_heart: :red_heart: ${GRIN}`);
    expect(named(rows).map((s) => s.projection)).toEqual([FAMILY, KEYCAP, TONE, HEART, BARE]);
  });

  test("an unknown terminal: everything drawn as it is but what OpenTUI itself mis-measures", () => {
    const rows = allRows(`${FAMILY} ${FLAG} ${KEYCAP} ${TONE} ${HEART} ${BARE} ✌\u{1F3FD}`, 200, UNKNOWN);
    expect(shown(rows)).toBe(`${FAMILY} ${FLAG} ${KEYCAP} ${TONE} ${HEART} :red_heart: :victory_hand_medium_skin_tone:`);
    // And with no class at all (DEFAULT_FLAGS, the projection's), nothing is named.
    expect(shown(allRows(`${BARE} ${FAMILY}`, 200, DEFAULT_FLAGS))).toBe(`${BARE} ${FAMILY}`);
  });

  test("a name wraps as one word, and breaks at the width only when longer than a row; the projection is unchanged", () => {
    const source = `See ${FAMILY} and ${TONE} now`;
    for (const width of [8, 12, 20, 30]) {
      const rows = allRows(source, width, PHPSTORM);
      for (const row of rows) expect(displayWidth(rowText(row))).toBeLessThanOrEqual(width);
      // The drawn names, rejoined, are whole.
      expect(rows.map(rowText).join("")).toContain(":family_man_woman_girl:".slice(0, width));
      checkMaps(source, width, PHPSTORM);
    }
    // At 30 columns the family's name moves whole to the next row.
    expect(allRows(source, 30, PHPSTORM).map(rowText)).toEqual(["See :family_man_woman_girl:", "and", ":thumbs_up_medium_skin_tone:", "now"]);
    // At 12 it breaks: the first piece projects the emoji, the others nothing.
    const broken = allRows(source, 12, PHPSTORM);
    expect(broken.map(rowText).slice(0, 3)).toEqual(["See", ":family_man_", "woman_girl:"]);
    expect(broken[1]!.spans[0]).toMatchObject({ projection: FAMILY, named: true });
    expect(broken[2]!.spans[0]).toMatchObject({ projection: "", named: true });
  });

  test("everywhere the renderers draw text: emphasis, links, headings, lists, quotes, tables and inline code", () => {
    const source = [
      `# Title ${FAMILY}`,
      "",
      `*em ${FAMILY}* and [link ${FAMILY}](https://example.com) and \`code ${FAMILY}\``,
      "",
      `- item ${FAMILY}`,
      "",
      `> quote ${FAMILY}`,
      "",
      "| a | b |",
      "| - | - |",
      `| ${FAMILY} | x |`,
      "",
    ].join("\n");
    for (const width of [24, 80]) {
      const rows = allRows(source, width, PHPSTORM);
      expect(named(rows).length).toBe(7);
      for (const s of named(rows)) expect(s).toMatchObject({ token: "muted", projection: FAMILY });
      checkMaps(source, width, PHPSTORM);
    }
    // A link's name keeps the link, so a click on it opens the target.
    const link = named(allRows(source, 80, PHPSTORM)).find((s) => s.link);
    expect(link?.link?.href).toBe("https://example.com");
  });

  test("code blocks: the name on the block's fill, never highlighted, copied as the emoji", () => {
    const source = "```ts\nconst f = '" + FAMILY + "'; // " + HEART + "\n```\n";
    const rows = allRows(source, 40, ZED);
    const names = named(rows);
    expect(names.map((s) => s.text)).toEqual([":family_man_woman_girl:", ":red_heart:"]);
    for (const s of names) {
      expect(s.fill).toBe("surface.code");
      expect(s.code).toBeUndefined();
    }
    for (const width of [12, 20, 40]) checkMaps(source, width, ZED);
    // The code around the names keeps its place in the source for the highlighter.
    const code = rows.flatMap((r) => r.spans).filter((s) => s.code);
    for (const s of code) expect(s.code!.source.text.slice(s.code!.at, s.code!.at + s.text.length)).toBe(s.text);
  });

  test("the name's chunk is drawn as the muted token is, on dark and light backgrounds (the muted-on-light rule)", () => {
    const rows = allRows(`x ${FAMILY} y`, 40, PHPSTORM);
    for (const terminal of [
      { foreground: "#bcbec4", background: "#191a1c" },
      { foreground: "#383a42", background: "#fafafa" },
    ]) {
      const theme = resolveTheme(DEFAULT_THEME, { terminal });
      const chunk = rowsToChunks(rows, 40, theme, NO_CAPABILITIES).find((c) => c.text === ":family_man_woman_girl:")!;
      const muted = theme.text("muted");
      expect(chunk.fg).toEqual(theme.color("muted"));
      expect((chunk.attributes ?? 0) & muted.attributes).toBe(muted.attributes);
      // Distinct from the text around it: another colour, or (on a light background) dimmed.
      expect(!Bun.deepEquals(chunk.fg, theme.color("text")) || muted.attributes !== theme.text("text").attributes).toBe(true);
    }
  });

  test("the M10 sample (markdown-gallery) projects the same text under every terminal's classes", () => {
    const source = `M10 literal ${GRIN} ${HEART} ${FAMILY} ${FLAG} (variation selector, ZWJ sequence and flag).`;
    const text = projectMessage(source, DEFAULT_GLYPHS).text;
    for (const flags of [PHPSTORM, ZED, UNKNOWN]) {
      const l = layout(source, 30, flags);
      let read = "";
      for (const block of l.blocks()) {
        for (const [i, row] of block.rows.entries()) {
          if (i > 0) read += row.joined ?? "\n";
          for (const s of row.spans) read += s.projection ?? s.text;
        }
      }
      expect(read).toBe(text);
    }
  });
});
