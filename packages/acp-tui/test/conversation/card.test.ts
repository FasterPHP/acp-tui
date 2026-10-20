// mvp-rendering tasks 9.1 to 9.4 (spec tui-rendering "Expanded tool card", "Output snippets",
// "Thoughts", "Heights computable without mounting", "Projection follows the rendered text"):
// tool cards and thoughts laid out as rows (conversation/card.ts), over fake-agent's
// `tool-content` and `short-answer` turns, without mounting anything.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createSession, reduce, type Session, type ThoughtItem, type ToolCallItem } from "acp-model";
import { CARD_FILL, markerSpans, markerText, SNIPPET_ROWS, thoughtCardLayout, toolCardHeight, toolCardLayout, type CardLayout } from "../../src/conversation/card.ts";
import { toolTitleShown } from "../../src/conversation/format.ts";
import { DEFAULT_GLYPHS } from "../../src/conversation/glyphs.ts";
import { rowText } from "../../src/conversation/markdown/types.ts";
import { createConversationViewModel, expandedByDefault } from "../../src/conversation/view-model.ts";
import { cardCells } from "../../src/selection/rows.ts";
import { projectItem } from "../../src/selection/projection.ts";
import { itemsOf, runScenario } from "../selection/fixtures.ts";
import { longSessionEvents } from "./window/session.ts";

// Imported by a computed path: acp-tui does not depend on the fake-agent package.
const FAKE_AGENT = join(import.meta.dir, "../../../fake-agent/src");
const TC = (await import(join(FAKE_AGENT, "scenarios/tool-content.ts"))) as {
  TOOL_CONTENT_COMMAND: string;
  TOOL_CONTENT_IDS: { command: string; read: string; big: string; refused: string };
  TOOL_CONTENT_OUTPUT_LINES: readonly string[];
  TOOL_CONTENT_REFUSAL: string;
};

const toolContent = await runScenario("tool-content", "go");
const shortAnswer = await runScenario("short-answer", "go");

function tool(session: Session, toolCallId: string): ToolCallItem {
  const item = itemsOf(session).find((i) => i.kind === "tool_call" && i.toolCallId === toolCallId);
  if (item?.kind !== "tool_call") throw new Error(`no tool call ${toolCallId}`);
  return item;
}

/** The inner width of a card at `cols` terminal columns: the gutter (2), the padding (1) and the
 *  right column (1) taken off. */
const inner = (cols: number) => cols - 4;
const texts = (layout: CardLayout) => layout.rows.map(rowText);
/** A tool card as the conversation lays it out at `cols` terminal columns: the title repeated only
 *  when the collapsed line (the width less the gutter) cut it. */
const card = (item: ToolCallItem, cols: number, full = false) => toolCardLayout(item, inner(cols), full, DEFAULT_GLYPHS, !toolTitleShown(item, cols - 2));

describe("expanded tool card (task 9.1)", () => {
  test("Long command: at 63 columns the card's first rows show the whole command wrapped, no ellipsis", () => {
    const command = tool(toolContent, TC.TOOL_CONTENT_IDS.command);
    expect(command.title).toBe(TC.TOOL_CONTENT_COMMAND);
    expect(TC.TOOL_CONTENT_COMMAND.length).toBe(140);
    // The collapsed line cuts it, so the card repeats it, after the padding row.
    expect(toolTitleShown(command, 61)).toBe(false);
    const layout = card(command, 63);
    expect(layout.parts[0]!.kind).toBe("pad");
    const title = layout.parts[1]!;
    expect(title.kind).toBe("title");
    const rows = title.rows.map(rowText);
    expect(rows.length).toBe(3);
    expect(rows.join(" ")).toBe(TC.TOOL_CONTENT_COMMAND);
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(inner(63));
    expect(rows.join("")).not.toContain("…");
    for (const row of title.rows) for (const span of row.spans) expect(span.token).toBe("tool.title");
    // Then a blank row before the content.
    expect(texts(layout)[4]).toBe("");
  });

  test("Short title not repeated: a read whose title fits on its collapsed line starts with its content after the padding", () => {
    const read = tool(toolContent, TC.TOOL_CONTENT_IDS.read);
    expect(toolTitleShown(read, 61)).toBe(true);
    const layout = card(read, 63);
    expect(layout.parts.map((p) => p.kind)).not.toContain("title");
    expect(layout.parts[1]!.kind).toBe("markdown");
    expect(texts(layout)[1]).not.toContain(read.title);
    expect(texts(layout)[1]!.trim()).not.toBe("");
    // At a width where the line cuts it, the title comes back.
    expect(toolTitleShown(read, 20)).toBe(false);
    expect(card(read, 22).parts[1]!.kind).toBe("title");
  });

  test("padding: one blank row inside the top and the bottom of every card, decoration only", () => {
    const tools = itemsOf(toolContent).filter((i): i is ToolCallItem => i.kind === "tool_call");
    expect(tools.length).toBeGreaterThan(2);
    for (const item of tools) {
      for (const layout of [card(item, 63), card(item, 40), toolCardLayout(item, inner(63))]) {
        for (const row of [layout.rows[0]!, layout.rows.at(-1)!]) {
          expect(rowText(row)).toBe("");
          expect(row.decorative).toBe(true);
        }
        expect(layout.parts[0]!.kind).toBe("pad");
        expect(layout.parts.at(-1)!.kind).toBe("pad");
        const cells = cardCells(layout, projectItem(item));
        expect([cells[0], cells.at(-1)]).toEqual([null, null]);
      }
    }
  });
});

describe("tool text as Markdown (task 9.2)", () => {
  test("Fenced output: the five lines with the label `console`, no backticks, on the card's fill", () => {
    const layout = toolCardLayout(tool(toolContent, TC.TOOL_CONTENT_IDS.command), inner(63));
    const code = layout.parts.find((p) => p.kind === "markdown")!;
    expect(code.kind === "markdown" && code.blocks.map((b) => b.token.type)).toEqual(["code"]);
    // A code block in a card draws no pad of its own: the card's padding serves (day-one-feedback).
    const drawn = code.rows.map(rowText).map((t) => t.trimEnd());
    // The first output line reaches the label, so the label has a row of its own.
    const lines = drawn.filter((t) => t !== "");
    expect(lines).toEqual([...TC.TOOL_CONTENT_OUTPUT_LINES]);
    expect(code.rows.some((row) => row.label?.text === "console")).toBe(true);
    expect(texts(layout).join("\n")).not.toContain("```");
    for (const row of code.rows) {
      expect(row.fill).toBe(CARD_FILL);
      for (const span of row.spans) expect(span.fill === undefined || span.fill === CARD_FILL).toBe(true);
    }
  });

  test("the refusal text is drawn without backticks", () => {
    const layout = toolCardLayout(tool(toolContent, TC.TOOL_CONTENT_IDS.refused), inner(63));
    expect(texts(layout).join("\n")).toContain(TC.TOOL_CONTENT_REFUSAL);
    expect(texts(layout).join("\n")).not.toContain("`");
  });

  test("other text is rendered as Markdown: a heading and a list, no markers", () => {
    const item = { ...tool(toolContent, TC.TOOL_CONTENT_IDS.command), content: [{ type: "text" as const, text: "## Result\n\n- **one**\n- two\n" }] };
    const drawn = texts(toolCardLayout(item, inner(63)));
    expect(drawn).toContain("Result");
    expect(drawn).toContain("● one");
    expect(drawn.join("\n")).not.toMatch(/##|\*\*/);
  });

  test("the projection holds the code without its fence, and every drawn row maps onto it", () => {
    const item = tool(toolContent, TC.TOOL_CONTENT_IDS.command);
    const projection = projectItem(item);
    expect(projection.text).toBe([TC.TOOL_CONTENT_COMMAND, "", ...TC.TOOL_CONTENT_OUTPUT_LINES].join("\n"));
    const layout = toolCardLayout(item, inner(63));
    const cells = cardCells(layout, projection);
    layout.rows.forEach((row, r) => {
      const c = cells[r];
      if (!c || c.blank) return;
      // The characters a row's cells stand for are the row's own text, in order.
      const mapped = [...new Set(c.from.filter((f) => f >= 0))].map((f) => projection.text[f]).join("");
      expect(rowText(row).replace(/\s+/g, "")).toContain(mapped.replace(/\s+/g, ""));
    });
    // The output's first line maps onto its place in the projection.
    const first = layout.rows.findIndex((row) => rowText(row).includes("PHPUnit"));
    const at = projection.text.indexOf("PHPUnit");
    expect(cells[first]!.from).toContain(at);
  });
});

describe("output snippets (task 9.3)", () => {
  test("Large output: the command, a marker saying 4990 rows are hidden, and the last 10 lines", () => {
    const big = tool(toolContent, TC.TOOL_CONTENT_IDS.big);
    // The command fits on the collapsed line (which shows it), so the card does not repeat it.
    expect(toolTitleShown(big, 61)).toBe(true);
    const layout = card(big, 63);
    const drawn = texts(layout);
    expect(drawn.join("\n")).not.toContain("Run the full test suite");
    expect(layout.hidden).toBe(4990);
    expect(layout.marker).toBe(1);
    expect(markerText(layout.hidden, "a")).toBe("4990 rows hidden · a or click here to show all");
    const shown = drawn.slice(layout.marker + 1, -1).map((t) => t.trim());
    expect(shown).toEqual(Array.from({ length: SNIPPET_ROWS }, (_, i) => `test ${4991 + i} ... ok`));
    // Padding, marker, snippet, padding.
    expect(drawn.length).toBe(1 + 1 + SNIPPET_ROWS + 1);
    // With the title (a narrower line that cuts it): padding, title, blank, marker, snippet, padding.
    expect(toolCardLayout(big, inner(63), false, DEFAULT_GLYPHS, true).rows.length).toBe(1 + 1 + 1 + 1 + SNIPPET_ROWS + 1);
  });

  test("the marker row underlines only the clickable word `here` (review C18), with or without a key, and when cut", () => {
    const underlined = (spans: ReturnType<typeof markerSpans>) => spans.filter((s) => s.underline).map((s) => s.text);
    const keyed = markerSpans(4990, "a", 61);
    expect(keyed.map((s) => s.text).join("")).toBe("4990 rows hidden · a or click here to show all");
    expect(underlined(keyed)).toEqual(["here"]);
    expect(keyed.every((s) => s.token === "muted" && s.projection === "")).toBe(true);
    const keyless = markerSpans(1, null, 61);
    expect(keyless.map((s) => s.text).join("")).toBe("1 row hidden · click here to show all");
    expect(underlined(keyless)).toEqual(["here"]);
    // Cut inside `here`: what is left of it is underlined; cut before it, nothing is.
    const at = "4990 rows hidden · a or click ".length;
    expect(underlined(markerSpans(4990, "a", at + 3))).toEqual(["he"]);
    expect(markerSpans(4990, "a", at + 3).map((s) => s.text).join("")).toBe("4990 rows hidden · a or click he…");
    expect(underlined(markerSpans(4990, "a", 20))).toEqual([]);
  });

  test("Show all: all 5000 lines and no marker row; the snippet again when not full", () => {
    const big = tool(toolContent, TC.TOOL_CONTENT_IDS.big);
    const full = toolCardLayout(big, inner(63), true);
    expect(full.marker).toBe(-1);
    expect(full.hidden).toBe(0);
    expect(texts(full).filter((t) => /^ ?test \d+ \.\.\. ok/.test(t))).toHaveLength(5000);
    expect(toolCardLayout(big, inner(63), false).hidden).toBe(4990);
  });

  test("a read shows its first rows, the marker after them", () => {
    const layout = card(tool(toolContent, TC.TOOL_CONTENT_IDS.read), 63);
    // The marker, then the bottom padding.
    expect(layout.marker).toBe(layout.rows.length - 2);
    expect(texts(layout).slice(1, 3).join("\n")).toMatch(/<\?php/);
    expect(layout.cuttable).toBe(true);
  });

  test("a short output and a diff are never cut", () => {
    expect(toolCardLayout(tool(toolContent, TC.TOOL_CONTENT_IDS.command), inner(63)).cuttable).toBe(false);
    const oldText = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    const newText = Array.from({ length: 40 }, (_, i) => `changed ${i}`).join("\n");
    const edit = { ...tool(toolContent, TC.TOOL_CONTENT_IDS.refused), content: [{ type: "diff" as const, path: "/w/a.txt", oldText, newText }] };
    const layout = toolCardLayout(edit, inner(63));
    expect(layout.marker).toBe(-1);
    expect(layout.rows.length).toBeGreaterThan(80);
  });

  test("a running command shows its latest rows", () => {
    const running = { ...tool(toolContent, TC.TOOL_CONTENT_IDS.big), status: "live" as const, toolStatus: "in_progress" as const };
    // The last row before the bottom padding.
    expect(texts(card(running, 63)).at(-2)!.trim()).toBe("test 5000 ... ok");
  });

  test("the marker row maps onto nothing in the projection", () => {
    const big = tool(toolContent, TC.TOOL_CONTENT_IDS.big);
    const layout = toolCardLayout(big, inner(63));
    expect(cardCells(layout, projectItem(big))[layout.marker]).toBeNull();
  });
});

describe("heights computable without mounting (tasks 9.1 to 9.3)", () => {
  test("the counted height equals the layout's rows: tool-content and 300 long-session items at 40, 63 and 100 columns", () => {
    let session = createSession();
    for (const event of longSessionEvents(300)) session = reduce(session, event);
    const tools = [...itemsOf(toolContent), ...session.order.map((id) => session.items.get(id)!)].filter((i): i is ToolCallItem => i.kind === "tool_call");
    expect(tools.length).toBeGreaterThan(80);
    for (const cols of [40, 63, 100]) {
      for (const full of [false, true]) {
        for (const title of [false, true]) {
          for (const item of tools) {
            // The layout is not cached for a copy, so the count is computed, not read back.
            const copy = { ...item };
            expect({ id: item.id, cols, full, title, rows: toolCardHeight(copy, inner(cols), full, DEFAULT_GLYPHS, title) }).toEqual({
              id: item.id,
              cols,
              full,
              title,
              rows: toolCardLayout(item, inner(cols), full, DEFAULT_GLYPHS, title).rows.length,
            });
          }
        }
      }
    }
  });
});

describe("thoughts (task 9.4)", () => {
  const thought = itemsOf(shortAnswer).find((i): i is ThoughtItem => i.kind === "thought")!;

  test("the body is Markdown in the thought token: the plan drawn as an ordered list, dim", () => {
    const layout = thoughtCardLayout(thought, inner(63));
    const drawn = texts(layout);
    // After the padding row (day-one-feedback, "Card padding").
    expect(drawn[0]).toBe("");
    expect(drawn.at(-1)).toBe("");
    expect(drawn[1]).toBe("Planning the S7 steps");
    expect(drawn.filter((t) => /^\d\. /.test(t))).toHaveLength(4);
    expect(drawn.join("\n")).not.toMatch(/\*\*|`/);
    const prose = layout.rows[1]!.spans;
    expect(prose.every((s) => s.dim === true)).toBe(true);
    expect(prose.some((s) => s.token === "thought")).toBe(true);
  });

  test("Short answer: a turn ending with a thought that holds a plan and a one-line answer leaves the thought collapsed", () => {
    // Thoughts always start collapsed (review C16); only the user's toggle expands one.
    expect(expandedByDefault(thought)).toBe(false);
    const vm = createConversationViewModel();
    for (const item of itemsOf(shortAnswer)) if (item.kind === "thought") expect(vm.expanded(item)).toBe(false);
    vm.toggle(thought);
    expect(vm.expanded(thought)).toBe(true);
  });

  test("the projection is the rendered body; its rows map onto it", () => {
    const projection = projectItem(thought);
    expect(projection.text.startsWith("Planning the S7 steps\n\n")).toBe(true);
    expect(projection.text.slice(0, projection.summaryEnd)).toBe("Planning the S7 steps");
    expect(projection.text).toContain("1. Read README.md and summarise it");
    const layout = thoughtCardLayout(thought, inner(63));
    const cells = cardCells(layout, projection);
    const plan = layout.rows.findIndex((row) => rowText(row).startsWith("1. "));
    expect(cells[plan]!.from[0]).toBe(projection.text.indexOf("1. Read"));
  });
});
