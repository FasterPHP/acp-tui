// Row maps per element (mvp-conversation task 5.5, design D6): the agent
// messages of fake-agent's `copy-fixtures` and `markdown-gallery`, and a
// message of wrapped list items, nested quotes and tabs, drawn by the real App
// in OpenTUI's test renderer; for each element a pointer on a known cell must
// resolve (rows.ts `hitRows`) to the character drawn there. These tests are
// the contract `mvp-rendering` keeps green when it replaces the Markdown
// renderer. Needs the root bunfig `[test] preload`.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import type { Renderable } from "@opentui/core";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type { Item, Session } from "acp-model";
import { compactConfig } from "../app/compact-config.ts";
import { App } from "../../src/app/App.tsx";
import type { AppActions, AppContextValue } from "../../src/app/context.ts";
import { DEFAULT_GLYPHS } from "../../src/conversation/glyphs.ts";
import { CODE_TAB_WIDTH } from "../../src/conversation/markdown/code.ts";
import { DEFAULT_LAYOUT, resolveLayout } from "../../src/layout/layout.ts";
import { displayWidth } from "../../src/layout/segments.ts";
import { conversationBoxFinder, isItemNode, itemIdOf, RowMaps } from "../../src/selection/cells.ts";
import { hitRows, OPENTUI_TAB_COLUMNS, type ItemRows } from "../../src/selection/rows.ts";
import { createSessionStore, type SessionStore } from "../../src/session/store.ts";
import { DEFAULT_THEME, resolveTheme } from "../../src/theme/index.ts";
import { runScenario, runUpdates } from "./fixtures.ts";

let setup: Awaited<ReturnType<typeof testRender>> | undefined;
let store: SessionStore | undefined;
/** A drawing shared by several tests (the gallery) is kept until the end: its positions are read
 *  from the live renderables, which a destroyed renderer no longer lays out reliably (the prompt
 *  box's resting height follows the screen's, mvp-chrome-and-keys task 4.2). */
let kept: { setup: NonNullable<typeof setup>; store: SessionStore } | undefined;
afterEach(async () => {
  if (!kept || kept.setup !== setup) {
    await setup?.dispose();
    store?.dispose();
  }
  setup = undefined;
  store = undefined;
});
afterAll(async () => {
  await kept?.setup.dispose();
  kept?.store.dispose();
});

interface Drawn {
  /** The screen's rows. */
  readonly rows: string[];
  /** The projection text at the pointer on display column `x` of row `y`, `length` long. */
  at(x: number, y: number, length: number): string;
  /** The first cell of `text` on screen at or after row `from` (display columns). */
  find(text: string, from?: number): { x: number; y: number };
  /** The row holding `text`. */
  row(text: string, from?: number): number;
  /** The raw hit (projection offsets) at the cell. */
  hit(x: number, y: number): { from: number; to: number; text: string };
}

/** Mounts the App over `session` at `width` columns, tall enough for every item, and waits for
 *  `last` to be drawn. */
async function draw(session: Session, width: number, last: string): Promise<Drawn> {
  store = createSessionStore({ home: "/w" });
  const actions: AppActions = { prompt: () => null, cancel() {}, answerPermission: () => false, exit() {} };
  const context: AppContextValue = { store, actions, theme: resolveTheme(DEFAULT_THEME), config: compactConfig() };
  setup = await testRender(() => <App context={context} layout={resolveLayout(DEFAULT_LAYOUT)} />, { width, height: 500, screenMode: "alternate-screen" });
  store.attach({ getSession: () => session, subscribe: () => () => {} });
  let rows: string[] = [];
  let stable = 0;
  for (let i = 0; i < 400 && stable < 5; i++) {
    await setup.flush();
    await setup.renderOnce();
    const next = setup.captureCharFrame().split("\n");
    stable = next.some((l) => l.includes(last)) && next.join("\n") === rows.join("\n") ? stable + 1 : 0;
    rows = next;
    await Bun.sleep(5);
  }
  if (!rows.some((l) => l.includes(last))) throw new Error(`never drawn: ${last}`);
  const box = conversationBoxFinder(setup.renderer)()!;
  const maps = new RowMaps(DEFAULT_GLYPHS, () => true);
  const nodes = (box.content.getChildren() as Renderable[]).filter(isItemNode);
  const itemAt = (y: number): { node: Renderable; item: Item; rows: ItemRows } => {
    const node = nodes.find((n) => y >= n.y && y < n.y + n.height)!;
    const item = session.items.get(itemIdOf(node))!;
    return { node, item, rows: maps.rowsFor(item, node) };
  };
  const hit = (x: number, y: number) => {
    const { node, item, rows: r } = itemAt(y);
    const text = maps.projections.get(item).text;
    return { ...hitRows(r, x - node.x, y - node.y, text.length), text };
  };
  // Display column of a string index in a row (wide characters take two cells).
  const column = (line: string, index: number) => displayWidth(line.slice(0, index));
  const find = (text: string, from = 0) => {
    for (let y = from; y < rows.length; y++) {
      const i = rows[y]!.indexOf(text);
      if (i >= 0) return { x: column(rows[y]!, i), y };
    }
    throw new Error(`not on screen: ${JSON.stringify(text)}`);
  };
  return {
    rows,
    find,
    row: (text, from) => find(text, from).y,
    hit,
    at(x, y, length) {
      const h = hit(x, y);
      return h.text.slice(h.from, h.from + length);
    },
  };
}

/** The row of the gallery's sample tag `tag` (`M15`). */
const tagRow = (d: Drawn, tag: string) => d.row(`  ${tag} `);

/** Every cell of `text` on screen (from row `from`) resolves to its own character. */
function mapsExactly(d: Drawn, text: string, from = 0): void {
  const { x, y } = d.find(text, from);
  let col = x;
  for (const ch of text) {
    if (ch !== " ") expect(`${ch}@${col}`).toBe(`${d.at(col, y, ch.length)}@${col}`);
    col += displayWidth(ch);
  }
}

describe("row maps per element: copy-fixtures (task 5.5)", () => {
  test("code, table, paragraphs, list: a pointer on a cell resolves to the character drawn there", async () => {
    const d = await draw(await runScenario("copy-fixtures", "give me things to copy"), 63, "third item");
    mapsExactly(d, "declare(strict_types=1);");
    mapsExactly(d, "public function net(): float");
    mapsExactly(d, "up to 80 characters, indexed");
    for (const cell of ["created_at", "datetime", "UTC"]) mapsExactly(d, cell, d.row("│ created_at"));
    // Each row of a wrapped paragraph.
    const para = d.row("  The second paragraph");
    for (const y of [para, para + 1]) mapsExactly(d, d.rows[y]!.trim(), y);
    mapsExactly(d, "● second item, with bold text");
    // The tool call's title on its collapsed line; the glyphs and kind column are decoration.
    mapsExactly(d, "Edit src/InvoiceTotal.php");
  }, 30000);

  test("a blank line between two paragraphs maps its first cell to the newline", async () => {
    const d = await draw(await runScenario("copy-fixtures", "give me things to copy"), 63, "third item");
    const blank = d.row("  The second paragraph") - 1;
    expect(d.rows[blank]!.trim()).toBe("");
    const h = d.hit(2, blank);
    expect(h.text.slice(h.from, h.to)).toBe("\n");
    // The newline after the first paragraph's last line, then the blank line's own.
    expect(h.text.slice(0, h.from).endsWith("sentences.\n")).toBe(true);
  }, 30000);
});

describe("row maps per element: markdown-gallery at 63 columns (task 5.5)", () => {
  // Each sample: its tag, then text drawn in it that the projection holds the same way.
  const SAMPLES: readonly [string, string][] = [
    ["M01", "bold with nested italic inside"],
    ["M02", "double tilde"],
    ["M03", "plain code"],
    ["M04", "reference link"],
    ["M05", "Alt text of an inline image"],
    ["M06", "so this one also starts on a new row."],
    ["M07", "not a heading"],
    ["M08", "non-breaking"],
    ["M09", "span tag"],
    ["M10", "shortcodes"],
    ["M11", "中文字符"],
    ["M12", "Heading level 3"],
    ["M13", "Setext heading level 1"],
    ["M15", "Level 3 second"],
    ["M16", "Ten (the marker widens)"],
    ["M17", "Nested open"],
    ["M18", "Ordered grandchild"],
    ["M21", "return sprintf('Hello, %s!', $name);"],
    ["M22", "$indented = 'code block';"],
    ["M23", "Level three quote."],
    ["M24", "A warning alert."],
    ["M25", "The first footnote definition."],
    ["M26", "inline parentheses"],
    ["M27", "Hidden content with Markdown inside."],
    ["M28", "The definition of term one."],
    ["M29", "graph LR"],
    // At 61 columns (the right margin's two columns off 63) `word.` wraps to a row of its own, so
    // the probe is the end of the very long word and the words after it on its last row.
    ["M30", "coniosis is one"],
  ];
  let gallery: Drawn | undefined;
  const drawn = async () => {
    if (!gallery) {
      gallery = await draw(await runScenario("markdown-gallery", "show me"), 63, "M99 end of gallery");
      kept = { setup: setup!, store: store! };
    }
    return gallery;
  };

  for (const [tag, text] of SAMPLES) {
    test(`${tag}: ${text}`, async () => {
      const d = await drawn();
      mapsExactly(d, text, tagRow(d, tag));
    }, 30000);
  }

  test("M14: a thematic break's rule is decoration: a pointer on it resolves between the texts around it", async () => {
    // mvp-rendering: rules are not projected (spec tui-rendering "Projection follows the rendered
    // text"), so the rule maps no character.
    const d = await drawn();
    const y = d.row("─────", tagRow(d, "M14"));
    const h = d.hit(2, y);
    expect(h.from).toBe(h.to);
  }, 30000);

  test("M18: a loose item's second paragraph and its code", async () => {
    const d = await drawn();
    mapsExactly(d, "The second paragraph inside the item (a loose list).", tagRow(d, "M18"));
    mapsExactly(d, "const insideList = true;", tagRow(d, "M18"));
  }, 30000);

  test("M23: nested quotes: the text maps, the bars (one per level) are decoration", async () => {
    const d = await drawn();
    const from = tagRow(d, "M23");
    mapsExactly(d, "Level two quote.", from);
    mapsExactly(d, "Its second item", from);
    mapsExactly(d, "echo 'code in a quote';", from);
    const { x, y } = d.find("│ │ Level three quote.", from);
    // On an inner bar: the next character's start, so a drag from it starts at the text.
    const marker = d.hit(x, y);
    expect(marker.from).toBe(marker.to);
    expect(marker.text.slice(marker.from).startsWith("Level three quote.")).toBe(true);
    // The border: the line's start.
    const border = d.hit(2, y);
    expect(border.text.slice(border.from).startsWith("Level three quote.")).toBe(true);
  }, 30000);

  test("M30: a word wider than the pane maps on each of its rows", async () => {
    const d = await drawn();
    const y = d.row("  Supercalifragilistic", tagRow(d, "M30"));
    const next = d.rows[y + 1]!.slice(2, 12);
    mapsExactly(d, next, y + 1);
    expect(d.at(2, y + 1, 1)).toBe(next.charAt(0));
  }, 30000);
});

describe("row maps per element: tables (task 5.5)", () => {
  test("M19 at 100 columns, where it fits: every column maps", async () => {
    const d = await draw(await runScenario("markdown-gallery", "show me"), 100, "M99 end of gallery");
    const from = tagRow(d, "M19");
    mapsExactly(d, "link", from);
    mapsExactly(d, "1,234.56", from);
    mapsExactly(d, "an | escaped pipe", from);
  }, 30000);

  test("M20, wider than the pane: its cells map too (acp-tui draws the table itself)", async () => {
    const d = await draw(await runScenario("markdown-gallery", "show me"), 63, "M99 end of gallery");
    mapsExactly(d, "Alice", tagRow(d, "M20"));
  }, 30000);
});

/** A conversation of one prompt and one agent message holding `markdown`. */
function messageSession(markdown: string): Session {
  const update: SessionUpdate = { sessionUpdate: "agent_message_chunk", messageId: "m", content: { type: "text", text: markdown } };
  return runUpdates([update], "go");
}

describe("row maps per element: wrapped list items, deep quotes, tabs (task 5.5)", () => {
  const LONG_ITEM =
    "a list item long enough to wrap to three rows at sixty-three columns, so that a drag from its second row to its third must find the characters under the pointer";
  const MARKDOWN = [
    "Before the list.",
    "",
    `- ${LONG_ITEM}`,
    "- a short item",
    "  - a nested item that is also long enough to wrap onto a second row in the pane",
    "",
    "> one",
    "> > two levels deep, and long enough to wrap: the quote keeps going past the edge",
    "> > > three levels deep",
    "",
    "Tabs\tin\ta paragraph.",
    "",
    "```",
    "col1\tcol2",
    "\tindented",
    "```",
    "",
    "The end.",
  ].join("\n");

  test("Wrapped list item: each of its rows resolves to the characters under the pointer", async () => {
    const d = await draw(messageSession(MARKDOWN), 63, "The end.");
    const first = d.row(`  ● ${LONG_ITEM.slice(0, 20)}`);
    for (const y of [first, first + 1, first + 2]) {
      const line = d.rows[y]!;
      const text = line.slice(4).trimEnd();
      expect(text.length).toBeGreaterThan(0);
      mapsExactly(d, text, y);
    }
    // The marker maps to the projection's own marker.
    expect(d.at(2, first, 2)).toBe("● ");
    // The nested item, wrapped too.
    const nested = d.row("a nested item", first);
    for (const y of [nested, nested + 1]) mapsExactly(d, d.rows[y]!.replace(/^[ ○]+/, "").trimEnd(), y);
  }, 30000);

  test("Block quote: text at every depth maps, wrapped rows included; markers are not text", async () => {
    const d = await draw(messageSession(MARKDOWN), 63, "The end.");
    mapsExactly(d, "one");
    const two = d.row("two levels deep");
    mapsExactly(d, "two levels deep, and long enough to wrap", two);
    const wrapped = d.rows[two + 1]!.replace(/^[ │>]+/, "").trimEnd();
    mapsExactly(d, wrapped, two + 1);
    mapsExactly(d, "three levels deep", two);
  }, 30000);

  test("Tabs: two columns wide in prose, to stops of 8 in code; every column of a tab resolves to it", async () => {
    const d = await draw(messageSession(MARKDOWN), 63, "The end.");
    const p = d.find("Tabs");
    expect(d.rows[p.y]!.slice(p.x, p.x + 4 + OPENTUI_TAB_COLUMNS + 2)).toBe("Tabs  in");
    for (let k = 0; k < OPENTUI_TAB_COLUMNS; k++) expect(d.at(p.x + 4 + k, p.y, 1)).toBe("\t");
    expect(d.at(p.x + 4 + OPENTUI_TAB_COLUMNS, p.y, 2)).toBe("in");
    mapsExactly(d, "a paragraph.");
    // mvp-rendering: code blocks expand tabs to stops every 8 columns (spec tui-rendering "Code
    // blocks").
    const code = d.find("col1");
    for (let k = 4; k < CODE_TAB_WIDTH; k++) expect(d.at(code.x + k, code.y, 1)).toBe("\t");
    expect(d.at(code.x + CODE_TAB_WIDTH, code.y, 4)).toBe("col2");
    expect(d.at(code.x + CODE_TAB_WIDTH, code.y + 1, 8)).toBe("indented");
  }, 30000);
});
