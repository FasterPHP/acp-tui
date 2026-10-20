// SPIKE (phase-1a, S4 and S5): golden files for the plain-text projection
// (task 14.1) and the Markdown export (task 15.3's format), over fake-agent's
// `copy-fixtures` scenario driven through the acp-model reducer. Each golden
// file holds the copy text followed by one newline. `UPDATE_GOLDEN=1 bun test
// packages/acp-tui/test/selection` rewrites them; review the diff before
// committing.
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessageItem, Item, Session, ToolCallItem } from "acp-model";
import { conversationMarkdown, itemMarkdown } from "../../src/selection/export.ts";
import {
  conversationText,
  itemText,
  lineColumnAt,
  lookupOf,
  offsetAt,
  projectItem,
  rangeText,
} from "../../src/selection/projection.ts";
import { buildEntries } from "../../src/conversation/window/entries.ts";
import { collapsible, expandedByDefault } from "../../src/conversation/view-model.ts";
import { COPY_FIXTURES, COPY_PROMPT, itemsOf, runScenario } from "./fixtures.ts";
import { agent, conversation, plan, tool as toolItem } from "./items.ts";

const GOLDEN = join(import.meta.dir, "golden");
const UPDATE = process.env["UPDATE_GOLDEN"] === "1";

function golden(name: string, text: string): void {
  const path = join(GOLDEN, name);
  if (UPDATE) writeFileSync(path, `${text}\n`);
  if (!existsSync(path)) throw new Error(`missing golden file ${name}: run with UPDATE_GOLDEN=1 and review it`);
  expect(`${text}\n`).toBe(readFileSync(path, "utf8"));
}

let model: Session;
let items: Item[];
let messages: AgentMessageItem[];
let tool: ToolCallItem;

function message(source: string): AgentMessageItem {
  const found = messages.find((m) => m.text === source);
  if (!found) throw new Error(`no agent message with the fixture text: ${JSON.stringify(source.slice(0, 20))}`);
  return found;
}

beforeAll(async () => {
  model = await runScenario("copy-fixtures", COPY_PROMPT);
  items = itemsOf(model);
  messages = items.filter((i): i is AgentMessageItem => i.kind === "agent_message");
  tool = items.find((i): i is ToolCallItem => i.kind === "tool_call")!;
});

describe("plain-text projection of copy-fixtures (phase-1a task 14.1)", () => {
  test("the scenario reaches the model as expected: a prompt, four answers, one edit, a turn end", () => {
    expect(items.map((i) => i.kind)).toEqual([
      "user_message",
      "agent_message",
      "agent_message",
      "agent_message",
      "tool_call",
      "agent_message",
      "marker",
    ]);
    expect(tool.content).toEqual([{ type: "diff", ...COPY_FIXTURES.diff }]);
  });

  test("code: the fenced block's body without fences or gutters", () => {
    const text = itemText(message(COPY_FIXTURES.phpBlock));
    expect(text).toBe(COPY_FIXTURES.phpCode.replace(/\n$/, ""));
    expect(text).not.toContain("```");
    // No gutter: the first line is the code's own first line, indentation kept.
    expect(text.split("\n")[0]).toBe("<?php");
    expect(text).toContain("\n    public function net(): float\n");
    golden("code.txt", text);
  });

  test("table: every column on every row, aligned, no pipes or delimiter row", () => {
    const text = itemText(message(COPY_FIXTURES.table));
    const rows = text.split("\n");
    expect(rows).toHaveLength(4);
    expect(text).not.toContain("|");
    expect(text).not.toContain("---");
    for (const [field, type, notes] of [
      ["Field", "Type", "Notes"],
      ["id", "int", "primary key"],
      ["name", "string", "up to 80 characters, indexed"],
      ["created_at", "datetime", "UTC"],
    ] as const) {
      const row = rows.find((r) => r.startsWith(`${field} `))!;
      expect(row.split(/ {2,}/)).toEqual([field, type, notes]);
    }
    // Columns line up: the second and third columns start at the same place on every row.
    const second = rows.map((r) => r.search(/(?<= {2})\S/));
    expect(new Set(second).size).toBe(1);
    golden("table.txt", text);
  });

  test("paragraphs: three paragraphs with one blank line between them; the code span's text kept", () => {
    const text = itemText(message(COPY_FIXTURES.paragraphs));
    expect(text.split("\n\n")).toHaveLength(3);
    expect(text).not.toContain("\n\n\n");
    expect(text).toContain("including a code span that must survive a copy");
    golden("paragraphs.txt", text);
  });

  test("diff: the title line, then unified diff text with signs and hunk headers, no line numbers", () => {
    const projection = projectItem(tool);
    const text = projection.text;
    const lines = text.split("\n");
    expect(lines[0]).toBe("Edit src/InvoiceTotal.php");
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe(`--- ${COPY_FIXTURES.diff.path}`);
    expect(lines[3]).toBe(`+++ ${COPY_FIXTURES.diff.path}`);
    expect(lines[4]).toMatch(/^@@ -\d+(,\d+)? \+\d+(,\d+)? @@$/);
    for (const line of lines.slice(5)) expect(line).toMatch(/^[-+ ]/);
    // Both sides are there: the removed loop and the added one-liner.
    expect(lines).toContain("-        foreach ($this->lines as $line) {");
    expect(lines).toContain("+        return array_sum(array_map(fn (array $line): float => $line['qty'] * $line['price'], $this->lines));");
    // No line-number gutter: no line starts with digits.
    expect(lines.some((line) => /^\s*\d+\s/.test(line))).toBe(false);
    // The diff is its own block, so a copy of the block alone is pure unified diff text.
    const block = projection.blocks.find((b) => b.kind === "diff")!;
    expect(text.slice(block.start, block.end).split("\n")[0]).toBe(`--- ${COPY_FIXTURES.diff.path}`);
    expect(projection.summaryEnd).toBe("Edit src/InvoiceTotal.php".length);
    golden("diff.txt", text);
  });

  test("list: the markers kept, the bold markers dropped", () => {
    const text = itemText(message(COPY_FIXTURES.list));
    expect(text).toBe("● first item\n● second item, with bold text\n● third item");
    golden("list.txt", text);
  });

  test("the whole conversation: every item joined with a blank line, the turn end left out", () => {
    const text = conversationText(model.order, lookupOf(model.items));
    expect(text.startsWith(`${COPY_PROMPT}\n\n<?php`)).toBe(true);
    expect(text.endsWith("● third item")).toBe(true);
    golden("conversation.txt", text);
  });

  test("a range from inside the table to inside the diff", () => {
    const table = message(COPY_FIXTURES.table);
    const tableProjection = projectItem(table);
    const toolProjection = projectItem(tool);
    // From the start of the `name` row to the end of the hunk header, dragged upwards.
    const anchor = { itemId: tool.id, offset: offsetAt(toolProjection, 4, Number.MAX_SAFE_INTEGER) };
    const focus = { itemId: table.id, offset: offsetAt(tableProjection, 2, 0) };
    expect(lineColumnAt(tableProjection, focus.offset)).toEqual({ line: 2, column: 0 });
    const text = rangeText(model.order, lookupOf(model.items), { anchor, focus });
    const parts = text.split("\n\n");
    expect(parts[0]!.startsWith("name ")).toBe(true);
    expect(parts[1]).toBe(itemText(message(COPY_FIXTURES.paragraphs)).split("\n\n")[0]);
    expect(text.endsWith("@@")).toBe(true);
    golden("range.txt", text);
  });
});

describe("ranges across collapsed lines (mvp-conversation tasks 5.1, 5.2)", () => {
  test("across a collapsed plan: the plan's four entries, one per line, between the two messages", () => {
    const { order, lookup } = conversation(
      agent("a1", "I will fix the **router** in four steps."),
      plan("p", [
        { content: "Read the router", status: "completed", priority: "medium" },
        { content: "Find the failing route", status: "completed", priority: "high" },
        { content: "Fix the match order", status: "completed", priority: "high" },
        { content: "Run the tests", status: "in_progress", priority: "medium" },
      ]),
      agent("a2", "Step one: the router reads routes in file order."),
    );
    // The plan is drawn collapsed (`plan 3/4`): its default.
    const collapsed = (id: string) => collapsible(lookup(id)!) && !expandedByDefault(lookup(id)!);
    const text = rangeText(order, lookup, { anchor: { itemId: "a1", offset: 2 }, focus: { itemId: "a2", offset: 8 } }, { collapsed });
    expect(text.split("\n\n")[1]!.split("\n")).toHaveLength(4);
    golden("range-plan.txt", text);
  });

  test("across a closed group line of three reads: each read's title line, blank lines between, no content", () => {
    const read = (id: string, title: string) =>
      toolItem(id, { title, toolKind: "read", content: [{ type: "text", text: `contents of ${title.slice(5)}\n<?php // more` }] });
    const items = [
      agent("a1", "Let me read the three files."),
      read("tool:r1", "Read src/Router.php"),
      read("tool:r2", "Read src/Route.php"),
      read("tool:r3", "Read tests/RouterTest.php"),
      agent("a2", "The router matches in file order."),
    ];
    const { order, lookup } = conversation(...items);
    // The compact density groups the three reads behind one closed line.
    const list = buildEntries(order, lookup, { density: "compact", open: () => false });
    const group = list.entries.find((e) => e.kind === "group");
    expect(group).toMatchObject({ kind: "group", open: false, members: ["tool:r1", "tool:r2", "tool:r3"] });
    // What the conversation reports as collapsed: a member of a closed group line.
    const collapsed = (id: string) => {
      const at = list.holder.get(id);
      const holder = at === undefined ? undefined : list.entries[at];
      return holder?.kind === "group" && !holder.open;
    };
    const text = rangeText(order, lookup, { anchor: { itemId: "a1", offset: 0 }, focus: { itemId: "a2", offset: 10 } }, { collapsed });
    expect(text).not.toContain("contents of");
    golden("range-group.txt", text);
  });
});

describe("Markdown export of copy-fixtures (phase-1a task 15.3's format)", () => {
  test("the export: role headings, agent Markdown verbatim, the edit as a diff fence", () => {
    const text = conversationMarkdown(model.order, lookupOf(model.items));
    expect(text.startsWith(`## User\n\n${COPY_PROMPT}\n\n## Agent\n\n`)).toBe(true);
    expect(text).toContain(COPY_FIXTURES.phpBlock.trimEnd());
    expect(text).toContain(COPY_FIXTURES.table.trimEnd());
    expect(text).toContain("**Tool** (edit, completed): Edit src/InvoiceTotal.php\n\n```diff\n--- ");
    expect(text.match(/^## Agent$/gm)).toHaveLength(1);
    expect(text.endsWith("- third item\n")).toBe(true);
    // Golden files hold the text plus a newline; the export already ends with one.
    golden("export.md", text.replace(/\n$/, ""));
  });

  test("Y copies an item as its Markdown source", () => {
    expect(itemMarkdown(message(COPY_FIXTURES.table))).toBe(COPY_FIXTURES.table.trimEnd());
    expect(itemMarkdown(message(COPY_FIXTURES.list))).toBe(COPY_FIXTURES.list.trimEnd());
  });
});
