// auggie-1x-support task 6.2 (spec tui-rendering "Tool titles from raw input"): the title a tool
// call is drawn, projected and found under.
import { describe, expect, test } from "bun:test";
import type { ToolCallItem } from "acp-model";
import { toolTitleText } from "../../src/conversation/tool-title.ts";
import { toolLine, activityLine } from "../../src/conversation/format.ts";
import { toolTitle } from "../../src/selection/projection.ts";
import { cardTitle } from "../../src/conversation/card.ts";
import { tool } from "../selection/items.ts";
import type { Segment } from "../../src/layout/segments.ts";

const text = (segments: Segment[]) => segments.map((s) => s.text).join("");
const call = (overrides: Partial<ToolCallItem>): ToolCallItem => tool("tool:t", { toolKind: "execute", ...overrides });

describe("toolTitleText", () => {
  test("a one-word title is replaced by the input text", () => {
    expect(toolTitleText({ title: "bash", inputText: "ls -la" })).toBe("ls -la");
    expect(toolTitleText({ title: "read", inputText: "notes.txt" })).toBe("notes.txt");
  });

  test("a descriptive title is kept", () => {
    expect(toolTitleText({ title: "Read src/a.ts", inputText: "src/a.ts" })).toBe("Read src/a.ts");
  });

  test("no input text, or an empty one, keeps the title; a missing title stays empty", () => {
    expect(toolTitleText({ title: "bash", inputText: null })).toBe("bash");
    expect(toolTitleText({ title: "bash", inputText: "  " })).toBe("bash");
    expect(toolTitleText({ title: "", inputText: "ls" })).toBe("");
  });

  test("the input is put on one line", () => {
    expect(toolTitleText({ title: "bash", inputText: "echo a\n  echo b" })).toBe("echo a echo b");
  });
});

describe("the title in every place", () => {
  const item = call({ title: "bash", inputText: "ls -la", toolStatus: "in_progress", status: "live" });

  test("collapsed line shows the kind and the command, not bash", () => {
    const line = text(toolLine(item, 60));
    expect(line).toContain("execute");
    expect(line).toContain("ls -la");
    expect(line).not.toContain("bash");
  });

  test("a read call titled read shows the path, not `read read`", () => {
    const line = text(toolLine(call({ title: "read", toolKind: "read", inputText: "notes.txt" }), 60));
    expect(line).toContain("notes.txt");
    expect(line).not.toContain("read read");
  });

  test("activity line, card title and projection agree", () => {
    expect(text(activityLine(item, 60))).toContain("ls -la");
    expect(cardTitle(item)).toBe("ls -la");
    expect(toolTitle(item)).toBe("ls -la");
  });

  test("a descriptive title is untouched everywhere", () => {
    const named = call({ title: "Read src/a.ts", toolKind: "read", inputText: "src/a.ts" });
    expect(cardTitle(named)).toBe("Read src/a.ts");
    expect(toolTitle(named)).toBe("Read src/a.ts");
  });
});
