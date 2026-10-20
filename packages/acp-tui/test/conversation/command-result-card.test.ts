// day-one-feedback tasks 4.2 to 4.4 (spec tui-rendering "Command results drawn", "Raw output shown
// when a call has no content"): a recognised command result drawn in an expanded tool card, its
// projection and row maps, the collapsed line's `exit <code>`, over fake-agent's `command-results`
// turn and built calls, without mounting anything.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type { Session, ToolCallItem } from "acp-model";
import { toolCardHeight, toolCardLayout, type CardLayout } from "../../src/conversation/card.ts";
import { toolLine, toolSummary } from "../../src/conversation/format.ts";
import { DEFAULT_GLYPHS } from "../../src/conversation/glyphs.ts";
import { rowText } from "../../src/conversation/markdown/types.ts";
import { cardCells } from "../../src/selection/rows.ts";
import { projectItem } from "../../src/selection/projection.ts";
import { DEFAULT_THEME, TOKENS, tokenStyle, withTokens } from "../../src/theme/index.ts";
import { itemsOf, runScenario, runUpdates } from "../selection/fixtures.ts";

// Imported by a computed path: acp-tui does not depend on the fake-agent package.
const FAKE_AGENT = join(import.meta.dir, "../../../fake-agent/src");
const CR = (await import(join(FAKE_AGENT, "scenarios/command-results.ts"))) as {
  COMMAND_RESULTS_IDS: Record<"auggieFailure" | "auggieSuccess" | "claudeFailure" | "claudeSuccess" | "nearMissEnvelope" | "nearMissRead", string>;
  COMMAND_RESULTS_TITLES: Record<"auggieFailure" | "auggieSuccess" | "claudeFailure" | "claudeSuccess" | "nearMissEnvelope" | "nearMissRead", string>;
  COMMAND_RESULTS_NEAR_MISS_ENVELOPE: string;
  COMMAND_RESULTS_NEAR_MISS_READ_BODY: string;
  auggieEnvelope(code: number, output: string): string;
};

const session = await runScenario("command-results", "go");

function tool(model: Session, toolCallId: string): ToolCallItem {
  const item = itemsOf(model).find((i) => i.kind === "tool_call" && i.toolCallId === toolCallId);
  if (item?.kind !== "tool_call") throw new Error(`no tool call ${toolCallId}`);
  return item;
}

/** The inner width of a card at `cols` terminal columns (the gutter, the padding and the right column off). */
const inner = (cols: number) => cols - 4;
const texts = (layout: CardLayout) => layout.rows.map(rowText);
/** The card without a repeated title (the scenario's commands fit their collapsed lines). */
const card = (item: ToolCallItem, cols: number, full = false) => toolCardLayout(item, inner(cols), full, DEFAULT_GLYPHS, false);

/** A call built from updates: started, then finished with `finish`. */
function built(kind: "execute" | "read", status: "completed" | "failed", finish: Record<string, unknown>): ToolCallItem {
  const updates: SessionUpdate[] = [
    { sessionUpdate: "tool_call", toolCallId: "t", title: "run it", kind, status: "in_progress" },
    { sessionUpdate: "tool_call_update", toolCallId: "t", status, ...finish } as SessionUpdate,
  ];
  return tool(runUpdates(updates, "go"), "t");
}

const fenced = (body: string) => `\`\`\`\n${body}\n\`\`\``;

describe("a command result in an expanded card (tasks 4.2)", () => {
  test("Auggie failure condensed: `Output: <line>` and `Return code: 127`, labels in tool.result.label, values in text, no blank row between", () => {
    const item = tool(session, CR.COMMAND_RESULTS_IDS.auggieFailure);
    const layout = card(item, 63);
    expect(layout.parts.map((p) => p.kind)).toEqual(["pad", "result", "code", "pad"]);
    expect(texts(layout)).toEqual(["", "Output: sh: model-selection: command not found", "Return code: 127", ""]);
    const [, output, code] = layout.rows;
    expect(output!.spans.map((s) => [s.text, s.token])).toEqual([
      ["Output: ", "tool.result.label"],
      ["sh: model-selection: command not found", "text"],
    ]);
    expect(code!.spans.map((s) => [s.text, s.token])).toEqual([
      ["Return code: ", "tool.result.label"],
      ["127", "text"],
    ]);
    // Nothing else of the envelope is on the card.
    expect(texts(layout).join("\n")).not.toMatch(/<\/?(return-code|output)>|Here are the results/);
  });

  test("Several output lines: `Output:`, each line indented two cells, `Return code: 2`", () => {
    const item = built("execute", "failed", { content: [{ type: "content", content: { type: "text", text: fenced("Exit code 2\nls: cannot access 'x'\nls: cannot access 'y'") } }] });
    expect(texts(card(item, 63))).toEqual(["", "Output:", "  ls: cannot access 'x'", "  ls: cannot access 'y'", "Return code: 2", ""]);
    const output = card(item, 63).rows[1]!;
    expect(output.spans.map((s) => s.token)).toEqual(["tool.result.label"]);
  });

  test("an empty output shows the return code alone", () => {
    const item = built("execute", "completed", { rawOutput: { output: CR.auggieEnvelope(0, "\n") } });
    expect(card(item, 63).parts.map((p) => p.kind)).toEqual(["pad", "code", "pad"]);
    expect(texts(card(item, 63))).toEqual(["", "Return code: 0", ""]);
  });

  test("Long output keeps its return code: the marker row, the last 10 output rows and `Return code`", () => {
    const lines = Array.from({ length: 400 }, (_, i) => `line ${i + 1}`);
    const item = built("execute", "completed", { rawOutput: { output: CR.auggieEnvelope(0, `${lines.join("\n")}\n`) } });
    const layout = card(item, 63);
    expect(layout.cuttable).toBe(true);
    expect(layout.marker).toBe(1);
    // 401 rows (the label and 400 lines), 10 shown.
    expect(layout.hidden).toBe(391);
    const rows = texts(layout);
    expect(rows.slice(2, 12)).toEqual(lines.slice(390).map((l) => `  ${l}`));
    expect(rows[12]).toBe("Return code: 0");
    expect(rows).toHaveLength(14);
    // Shown in full: the label, every line and the return code.
    const full = card(item, 63, true);
    expect(full.marker).toBe(-1);
    expect(texts(full)).toEqual(["", "Output:", ...lines.map((l) => `  ${l}`), "Return code: 0", ""]);
  });

  test("a result of a call that is not execute keeps its head: the marker follows the first rows", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    const item = built("read", "completed", { rawOutput: { output: CR.auggieEnvelope(0, lines.join("\n")) } });
    const layout = card(item, 63);
    expect(texts(layout)[1]).toBe("Output:");
    expect(layout.rows[layout.marker]!.decorative).toBe(true);
    expect(layout.marker).toBe(11);
    expect(texts(layout).at(-2)).toBe("Return code: 0");
  });

  test("a long output line wraps at spaces under the value, and a wide terminal does not wrap it", () => {
    const sentence = "the quick brown fox jumps over the lazy dog and keeps running through the whole afternoon";
    // Several lines: each wraps at spaces, its continuation rows indented as the line is.
    const item = built("execute", "failed", { content: [{ type: "content", content: { type: "text", text: fenced(`Exit code 1\n${sentence}\nend`) } }] });
    const narrow = texts(card(item, 40));
    expect(narrow[1]).toBe("Output:");
    const wrapped = narrow.slice(2, -3);
    expect(wrapped.length).toBeGreaterThan(1);
    for (const row of wrapped) expect(row.startsWith("  ")).toBe(true);
    expect(wrapped.map((r) => r.trim()).join(" ")).toBe(sentence);
    expect(narrow.slice(-3)).toEqual(["  end", "Return code: 1", ""]);
    for (const row of narrow) expect(row.length).toBeLessThanOrEqual(inner(40));
    // One output line: the value wraps under its first column.
    const single = built("execute", "completed", { rawOutput: { output: CR.auggieEnvelope(0, `${sentence}\n`) } });
    const rows = texts(card(single, 40));
    expect(rows[1]!.startsWith("Output: the quick")).toBe(true);
    for (const row of rows.slice(2, -2)) expect(row.startsWith(" ".repeat("Output: ".length))).toBe(true);
    expect(texts(card(single, 120))[1]).toBe(`Output: ${sentence}`);
  });

  test("Near misses are drawn as before: Markdown or a code block, no result parts", () => {
    const envelope = tool(session, CR.COMMAND_RESULTS_IDS.nearMissEnvelope);
    const layout = card(envelope, 63);
    expect(layout.parts.map((p) => p.kind)).not.toContain("result");
    expect(layout.parts.map((p) => p.kind)).not.toContain("code");
    expect(texts(layout).join("\n")).toContain("Here are the results from executing the command.");
    const read = tool(session, CR.COMMAND_RESULTS_IDS.nearMissRead);
    expect(card(read, 63).parts.map((p) => p.kind)).toEqual(["pad", "markdown", "pad"]);
    expect(texts(card(read, 63)).join("\n")).toContain("Exit code 1");
  });

  test("the claude success (a console fence) is drawn as code, as before", () => {
    const item = tool(session, CR.COMMAND_RESULTS_IDS.claudeSuccess);
    expect(card(item, 63).parts.map((p) => p.kind)).toEqual(["pad", "markdown", "pad"]);
  });

  test("Claude failure from the scenario: its output line and return code 127", () => {
    const item = tool(session, CR.COMMAND_RESULTS_IDS.claudeFailure);
    expect(texts(card(item, 63))).toEqual(["", "Output: /bin/bash: line 1: frobnicate: command not found", "Return code: 127", ""]);
  });
});

describe("raw output when a call has no content (task 4.2)", () => {
  test("Auggie success: `Output:` and the lines, `Return code: 0`", () => {
    const item = tool(session, CR.COMMAND_RESULTS_IDS.auggieSuccess);
    expect(item.content).toEqual([]);
    expect(item.rawOutputText).not.toBeNull();
    expect(texts(card(item, 63))).toEqual(["", "Output:", "  architecture.md", "  configuration.md", "  install-macos.md", "Return code: 0", ""]);
    const one = built("execute", "completed", { rawOutput: { output: CR.auggieEnvelope(0, "ok\n") } });
    expect(texts(card(one, 63))).toEqual(["", "Output: ok", "Return code: 0", ""]);
  });

  test("other raw text is rendered as Markdown, and no raw output keeps `(no content)`", () => {
    const text = built("execute", "completed", { rawOutput: "# Heading\n\nsome *words*" });
    const layout = card(text, 63);
    expect(layout.parts.map((p) => p.kind)).toEqual(["pad", "markdown", "pad"]);
    expect(texts(layout).join("\n")).toContain("Heading");
    const none = built("execute", "completed", { rawOutput: { exitCode: 0 } });
    expect(card(none, 63).parts.map((p) => p.kind)).toEqual(["pad", "none", "pad"]);
    expect(texts(card(none, 63)).join("\n")).toContain("(no content)");
  });

  test("Content wins: a call with a console fence and rawOutput shows the fence only", () => {
    const item = built("execute", "completed", {
      content: [{ type: "content", content: { type: "text", text: "```console\nfrom content\n```" } }],
      rawOutput: { output: CR.auggieEnvelope(0, "from raw output\n") },
    });
    const rows = texts(card(item, 63)).join("\n");
    expect(rows).toContain("from content");
    expect(rows).not.toContain("from raw output");
    expect(rows).not.toContain("Return code");
    expect(projectItem(item).text).not.toContain("from raw output");
  });
});

describe("heights (task 4.2)", () => {
  test("the counted height equals the layout's rows over the command-results turn and built calls, at 40, 63 and 100 columns", () => {
    const many = Array.from({ length: 400 }, (_, i) => `line ${i + 1} of the long output`).join("\n");
    const items: ToolCallItem[] = [
      ...itemsOf(session).filter((i): i is ToolCallItem => i.kind === "tool_call"),
      built("execute", "completed", { rawOutput: { output: CR.auggieEnvelope(0, `${many}\n`) } }),
      built("read", "failed", { rawOutput: { output: CR.auggieEnvelope(3, "one long line of output that wraps when the card is narrow enough to need it\n") } }),
      built("execute", "failed", { content: [{ type: "content", content: { type: "text", text: fenced("Exit code 2\na\n\n  b\nc") } }] }),
    ];
    expect(items.length).toBe(9);
    for (const cols of [40, 63, 100]) {
      for (const full of [false, true]) {
        for (const title of [false, true]) {
          for (const item of items) {
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

describe("the projection and the row maps of a result (task 4.3)", () => {
  test("Copy of a result: the call's title, a blank line, `Output: ...` and `Return code: 127`", () => {
    const item = tool(session, CR.COMMAND_RESULTS_IDS.auggieFailure);
    expect(projectItem(item).text).toBe(`${CR.COMMAND_RESULTS_TITLES.auggieFailure}\n\nOutput: sh: model-selection: command not found\nReturn code: 127`);
  });

  test("several lines and the raw-output fallback project as drawn", () => {
    const claude = built("execute", "failed", { content: [{ type: "content", content: { type: "text", text: fenced("Exit code 2\na\n\n  b") } }] });
    expect(projectItem(claude).text).toBe("run it\n\nOutput:\n  a\n\n    b\nReturn code: 2");
    const success = tool(session, CR.COMMAND_RESULTS_IDS.auggieSuccess);
    expect(projectItem(success).text).toBe(`${CR.COMMAND_RESULTS_TITLES.auggieSuccess}\n\nOutput:\n  architecture.md\n  configuration.md\n  install-macos.md\nReturn code: 0`);
    expect(projectItem(built("execute", "completed", {})).text).toBe("run it");
  });

  test("the whole result is projected even when the card shows a snippet", () => {
    const many = Array.from({ length: 60 }, (_, i) => `row ${i + 1}`);
    const item = built("execute", "completed", { rawOutput: { output: CR.auggieEnvelope(0, many.join("\n")) } });
    expect(projectItem(item).text).toBe(["run it", "", "Output:", ...many.map((l) => `  ${l}`), "Return code: 0"].join("\n"));
  });

  test("a drag across a result's rows gives the drawn text: every row's cells stand for its own characters", () => {
    const sentence = "the quick brown fox jumps over the lazy dog and keeps running through the whole afternoon";
    const items = [
      tool(session, CR.COMMAND_RESULTS_IDS.auggieFailure),
      tool(session, CR.COMMAND_RESULTS_IDS.auggieSuccess),
      built("execute", "completed", { rawOutput: { output: CR.auggieEnvelope(0, `${sentence}\n`) } }),
      built("execute", "failed", { content: [{ type: "content", content: { type: "text", text: fenced(`Exit code 4\n${sentence}\n\n  indented ${sentence}`) } }] }),
    ];
    for (const item of items) {
      for (const cols of [40, 63]) {
        const layout = card(item, cols);
        const projection = projectItem(item);
        const cells = cardCells(layout, projection);
        let covered = "";
        layout.rows.forEach((row, r) => {
          const c = cells[r];
          if (!c || c.blank) return;
          const mapped = [...new Set(c.from.filter((f) => f >= 0))].sort((a, b) => a - b).map((f) => projection.text[f]).join("");
          expect(rowText(row).replace(/\s+/g, "")).toBe(mapped.replace(/\s+/g, ""));
          covered += mapped;
        });
        // Every projected character after the title is covered by some row.
        const body = projection.text.slice(projection.text.indexOf("\n\n") + 2).replace(/\s+/g, "");
        expect(covered.replace(/\s+/g, "")).toBe(body);
      }
    }
  });

  test("a snippet's rows still map, the marker row onto nothing", () => {
    const many = Array.from({ length: 60 }, (_, i) => `row ${i + 1}`);
    const item = built("execute", "completed", { rawOutput: { output: CR.auggieEnvelope(0, many.join("\n")) } });
    const layout = card(item, 63);
    const cells = cardCells(layout, projectItem(item));
    expect(cells[layout.marker]).toBeNull();
    const last = layout.rows.length - 2;
    expect(rowText(layout.rows[last]!)).toBe("Return code: 0");
    expect(cells[last]).not.toBeNull();
  });
});

describe("the collapsed line of a failed command (task 4.4)", () => {
  test("a non-zero return code is the summary, `exit <code>` in tool.fail", () => {
    const auggie = tool(session, CR.COMMAND_RESULTS_IDS.auggieFailure);
    expect(toolSummary(auggie)).toEqual([{ text: "exit 127", token: "tool.fail" }]);
    const claude = built("execute", "failed", { content: [{ type: "content", content: { type: "text", text: fenced("Exit code 2\nls: cannot access 'x'\nls: cannot access 'y'") } }] });
    expect(toolSummary(claude)).toEqual([{ text: "exit 2", token: "tool.fail" }]);
    const line = toolLine(claude, 70, DEFAULT_GLYPHS, null);
    const summary = line.find((s) => s.text === "exit 2");
    expect(summary?.token).toBe("tool.fail");
    expect(line.map((s) => s.text).join("")).toHaveLength(70);
  });

  test("return code 0 gives the output line count as for other output; a near miss keeps its old summary", () => {
    expect(toolSummary(tool(session, CR.COMMAND_RESULTS_IDS.auggieSuccess))).toEqual([{ text: "3 lines", token: "tool.count" }]);
    expect(toolSummary(built("execute", "completed", { rawOutput: { output: CR.auggieEnvelope(0, "ok\n") } }))).toEqual([]);
    expect(toolSummary(tool(session, CR.COMMAND_RESULTS_IDS.nearMissRead)).some((s) => s.text.startsWith("exit"))).toBe(false);
    expect(toolSummary(tool(session, CR.COMMAND_RESULTS_IDS.claudeSuccess))).toEqual([{ text: "2 lines", token: "tool.count" }]);
  });
});

describe("the tool.result.label token (task 4.4)", () => {
  test("it is a text token whose default is the value of muted, and follows a theme that sets muted", () => {
    expect(TOKENS["tool.result.label"].role).toBe("fg");
    expect(tokenStyle(DEFAULT_THEME, "tool.result.label")).toEqual(tokenStyle(DEFAULT_THEME, "muted"));
    const themed = withTokens(DEFAULT_THEME, { muted: 5 });
    expect(tokenStyle(themed, "tool.result.label").color).toBe(5);
  });
});
