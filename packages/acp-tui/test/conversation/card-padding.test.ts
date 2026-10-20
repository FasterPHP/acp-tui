// day-one-feedback tasks 5.2 to 5.4 (spec tui-rendering "Card padding", "Code blocks"): the padding
// of every card from the setting `cards.padding`, laid out without mounting anything: padding rows
// in thoughts, tool cards and plans, the user card's wrap width, a code block in a card drawing no
// pad of its own, heights equal to the layouts, and padding that is never projected.
import { afterEach, describe, expect, test } from "bun:test";
import type { PlanItem, ThoughtItem, ToolCallItem, UserMessageItem } from "acp-model";
import { thoughtCardLayout, toolCardHeight, toolCardLayout } from "../../src/conversation/card.ts";
import { DEFAULT_GLYPHS } from "../../src/conversation/glyphs.ts";
import { cardPadding, renderSettingsKey, setRenderSettings } from "../../src/conversation/markdown/context.ts";
import { rowText } from "../../src/conversation/markdown/types.ts";
import { estimateHeight } from "../../src/conversation/window/heights.ts";
import { cardCells } from "../../src/selection/rows.ts";
import { projectItem } from "../../src/selection/projection.ts";
import { itemsOf, runScenario } from "../selection/fixtures.ts";

afterEach(() => setRenderSettings(null));

const pad = (rows: number, columns: number) => setRenderSettings({ cardPadRows: rows, cardPadColumns: columns });
/** The inner width of a card at `cols` terminal columns with `columns` of padding on each side. */
const inner = (cols: number, columns = 1) => cols - 2 - 2 * columns;

const tool = (over: Partial<ToolCallItem> = {}): ToolCallItem => ({
  id: "tool:t",
  kind: "tool_call",
  status: "final",
  origin: "self",
  toolCallId: "t",
  index: 1,
  title: "Edit src/Billing/Receipt.php",
  toolName: null,
  toolKind: "edit",
  toolStatus: "completed",
  content: [],
  locations: [],
  rawOutputText: null,
  startedAt: 0,
  endedAt: 5,
  ...over,
});

/** Prose, a `console` fence, a text with a PHP fence and a diff: every kind of content a card holds. */
const mixed = tool({
  content: [
    { type: "text", text: "The receipt total was rounded twice, which is now fixed.\n\nSecond paragraph of the explanation." },
    { type: "text", text: "```console\nPHPUnit 11.4.3\nOK (2 tests, 2 assertions)\n```" },
    { type: "text", text: "```php\n$total = round($net + $tax, 2);\n```" },
    { type: "diff", path: "src/Billing/Receipt.php", oldText: "<?php\n$a = 1;\n", newText: "<?php\n$a = 2;\n" },
  ],
});

const thought: ThoughtItem = { id: "th", kind: "thought", status: "final", origin: "self", text: "**Checking the pool**\n\nLooking at the reuse path." };
const plan: PlanItem = {
  id: "pl",
  kind: "plan",
  status: "final",
  origin: "self",
  entries: [
    { content: "Read the pool", priority: "medium", status: "completed" },
    { content: "Write the test", priority: "medium", status: "pending" },
  ],
};

describe("the setting reaches the layouts (task 5.2)", () => {
  test("the defaults are one row and two columns (Marcus, 15 October 2026), and the settings key follows a change", () => {
    expect(cardPadding()).toEqual({ rows: 1, columns: 2 });
    const key = renderSettingsKey();
    pad(0, 2);
    expect(cardPadding()).toEqual({ rows: 0, columns: 2 });
    expect(renderSettingsKey()).not.toBe(key);
    setRenderSettings(null);
    expect(renderSettingsKey()).toBe(key);
  });

  test("Same left inset everywhere: a blank fill row above and below every card, content from the first column", () => {
    const layout = toolCardLayout(mixed, inner(90), false, DEFAULT_GLYPHS, false);
    const rows = layout.rows.map(rowText);
    expect(rows[0]).toBe("");
    expect(rows.at(-1)).toBe("");
    expect(layout.parts[0]!.kind).toBe("pad");
    expect(layout.parts.at(-1)!.kind).toBe("pad");
    const thoughtRows = thoughtCardLayout(thought, inner(90)).rows.map(rowText);
    expect(thoughtRows[0]).toBe("");
    expect(thoughtRows.at(-1)).toBe("");
    // Prose, the `console` fence, the PHP fence and the diff's path all start in the card's first
    // content column: no pad of the code block's own.
    const starts = (text: string) => rows.find((row) => row.startsWith(text) || row.trimStart().startsWith(text));
    for (const text of ["The receipt total", "PHPUnit 11.4.3", "$total = round", "src/Billing/Receipt.php"]) {
      const row = starts(text);
      expect(row, text).toBeDefined();
      expect(row!.length - row!.trimStart().length, text).toBe(0);
    }
  });

  test("Padding from the setting: no padding rows with rows 0, and the height still equals the layout", () => {
    pad(0, 2);
    const layout = toolCardLayout(mixed, inner(63, 2), false, DEFAULT_GLYPHS, false);
    expect(layout.parts.map((p) => p.kind)).not.toContain("pad");
    expect(layout.rows.map(rowText)[0]).not.toBe("");
    expect(toolCardHeight({ ...mixed }, inner(63, 2), false, DEFAULT_GLYPHS, false)).toBe(layout.rows.length);
    expect(thoughtCardLayout(thought, inner(63, 2)).rows.map(rowText)[0]).toBe("Checking the pool");
  });

  test("the counted height equals the layout's rows for every padding, width and card", async () => {
    const toolContent = await runScenario("tool-content", "go");
    const tools = [mixed, ...itemsOf(toolContent).filter((i): i is ToolCallItem => i.kind === "tool_call")];
    for (const rows of [0, 1]) {
      for (const columns of [1, 2, 3]) {
        pad(rows, columns);
        for (const cols of [40, 63, 100]) {
          for (const item of tools) {
            for (const full of [false, true]) {
              const w = inner(cols, columns);
              const counted = toolCardHeight({ ...item }, w, full, DEFAULT_GLYPHS, false);
              expect({ id: item.id, rows, columns, cols, full, counted }).toEqual({ id: item.id, rows, columns, cols, full, counted: toolCardLayout(item, w, full, DEFAULT_GLYPHS, false).rows.length });
            }
          }
        }
      }
    }
  });

  test("estimates: a user message wraps between the bar and the right padding and gains the padding rows; a plan gains them too", () => {
    const user: UserMessageItem = { id: "u", kind: "user_message", status: "final", origin: "self", text: "y".repeat(300) };
    // 63 columns: the text keeps 63 - 1 - 4 = 58 columns, 6 rows, and a padding row each way.
    expect(estimateHeight(user, 63, false)).toBe(6 + 2);
    expect(estimateHeight(plan, 63, true)).toBe(1 + 2 + 2);
    expect(estimateHeight(plan, 63, false)).toBe(1);
    pad(0, 2);
    // Two columns each side: 63 - 1 - 4 = 58 columns, 6 rows, no padding rows.
    expect(estimateHeight(user, 63, false)).toBe(6);
    expect(estimateHeight(plan, 63, true)).toBe(1 + 2);
    pad(1, 3);
    expect(estimateHeight(user, 63, false)).toBe(Math.ceil(300 / (63 - 1 - 6)) + 2);
  });
});

describe("a code block in a card (task 5.3)", () => {
  test("Code inside a card: no pad and no flat rule of its own, the mark and the label kept in the last column", () => {
    const layout = toolCardLayout(mixed, inner(63), false, DEFAULT_GLYPHS, false);
    const code = layout.parts.filter((p) => p.kind === "markdown").flatMap((p) => p.rows);
    for (const row of code) {
      for (const span of row.spans) {
        // The pad is the span that carries `flatText` (the flat theme's rule): there is none.
        expect(span.flatText).toBeUndefined();
      }
    }
    const fence = code.find((row) => rowText(row).startsWith("PHPUnit"))!;
    expect(fence.label?.text).toBe("console");
    // A long line breaks one column short of the width, with the continuation mark in the last column.
    const long = tool({ content: [{ type: "text", text: `\`\`\`php\n${"x".repeat(100)}\n\`\`\`` }] });
    const rows = toolCardLayout(long, 30, false, DEFAULT_GLYPHS, false).rows.map(rowText);
    const mark = DEFAULT_GLYPHS.markdown.codeContinuation;
    // (the label `php` has a row of its own above the code: the first line reaches it)
    const first = rows.find((row) => row.startsWith("x"));
    expect(first).toBe(`${"x".repeat(29)}${mark}`);
    expect(rows.filter((row) => row.endsWith(mark))).toHaveLength(3);
  });
});

describe("padding is never projected (task 5.4)", () => {
  test("copying a user card or a thought gives exactly its text, and padding rows map onto nothing", () => {
    const user: UserMessageItem = { id: "u", kind: "user_message", status: "final", origin: "self", text: "Please check the pool.\nThen run the tests." };
    expect(projectItem(user).text).toBe(user.text);
    expect(projectItem(thought).text).toBe("Checking the pool\n\nLooking at the reuse path.");
    const layout = thoughtCardLayout(thought, inner(63));
    const cells = cardCells(layout, projectItem(thought));
    expect(cells[0]).toBeNull();
    expect(cells.at(-1)).toBeNull();
    const toolLayout = toolCardLayout(mixed, inner(63), false, DEFAULT_GLYPHS, false);
    const toolCells = cardCells(toolLayout, projectItem(mixed));
    expect(toolCells[0]).toBeNull();
    expect(toolCells.at(-1)).toBeNull();
    // Every other row of the fenced content maps onto its characters.
    const at = toolLayout.rows.findIndex((row) => rowText(row).startsWith("PHPUnit 11.4.3"));
    expect(toolCells[at]).not.toBeNull();
  });
});
