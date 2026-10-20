// SPIKE (phase-1a, S4): the plain-text projection per item kind, positions,
// ranges across items, the cache, and the Markdown form (`Y`, export) of the
// kinds copy-fixtures does not cover (task 14.1).
import { describe, expect, test } from "bun:test";
import { TERMINAL_UNAVAILABLE_NOTICE } from "../../src/conversation/format.ts";
import { conversationMarkdown, fenceFor, itemMarkdown } from "../../src/selection/export.ts";
import {
  blockAt,
  conversationText,
  itemText,
  lastAnswerText,
  lineColumnAt,
  lineStarts,
  lookupOf,
  offsetAt,
  ProjectionCache,
  projectItem,
  rangeText,
  TERMINAL_NOTICE,
  textBetween,
} from "../../src/selection/projection.ts";
import { agent, conversation, marker, permission, plan, thought, tool, turnEnd, user } from "./items.ts";

describe("projection per item kind", () => {
  test("user message: its text, trailing newlines dropped", () => {
    expect(itemText(user("u", "fix the\n\nrouter\n\n"))).toBe("fix the\n\nrouter");
  });

  // tui-rendering "Projection follows the rendered text", scenario "Copy of rendered prose"
  // (mvp-rendering task 10.1): what `y`, Ctrl+C on the item and a selection over it copy.
  test("Copy of rendered prose: `x © docs (https://example.com/a) α`", () => {
    const item = agent("a", "***x*** &copy; [docs](https://example.com/a) $\\alpha$");
    expect(itemText(item)).toBe("x © docs (https://example.com/a) α");
    const { order, lookup } = conversation(item);
    expect(rangeText(order, lookup, { anchor: { itemId: "a", offset: 0 }, focus: { itemId: "a", offset: 1_000 } })).toBe("x © docs (https://example.com/a) α");
  });

  test("agent message: Markdown drawn as plain text", () => {
    const p = projectItem(agent("a", "# Plan\nDo **this**.\n\n```sh\nmake test\n```\nThen `that`."));
    expect(p.text).toBe("Plan\n\nDo this.\n\nmake test\n\nThen that.");
    expect(p.blocks.map((b) => [b.kind, p.text.slice(b.start, b.end)])).toEqual([
      ["heading", "Plan"],
      ["text", "Do this."],
      ["code", "make test"],
      ["text", "Then that."],
    ]);
    expect(p.blocks[2]!.lang).toBe("sh");
  });

  test("thought: its body as the card renders it (Markdown, mvp-rendering task 9.4); the summary is the first line", () => {
    const p = projectItem(thought("th", "**Checking the pool**\n\nThe pool is *small*.\n"));
    expect(p.text).toBe("Checking the pool\n\nThe pool is small.");
    expect(p.text.slice(0, p.summaryEnd)).toBe("Checking the pool");
  });

  test("tool call: the title line, then each block after a blank line; no glyphs, status or index", () => {
    const item = tool("tool:t", {
      index: 7,
      title: "Run\nthe   tests",
      content: [
        { type: "text", text: "```\nok 1\n\tindented\n```\n" },
        { type: "diff", path: "a.txt", oldText: null, newText: "new\n" },
        { type: "terminal_unavailable" },
      ],
    });
    const p = projectItem(item);
    expect(p.text).toBe(
      ["Run the tests", "", "ok 1", "\tindented", "", "--- /dev/null", "+++ a.txt", "@@ -0,0 +1 @@", "+new", "", TERMINAL_NOTICE].join("\n"),
    );
    expect(p.text.slice(0, p.summaryEnd)).toBe("Run the tests");
    // The text is Markdown (mvp-rendering task 9.2): one fence projects as its code.
    expect(p.blocks.map((b) => b.kind)).toEqual(["title", "code", "diff", "notice"]);
    expect(p.blocks.map((b) => b.content)).toEqual([undefined, 0, 1, 2]);
    expect(p.text).not.toMatch(/#7|✓|execute/);
  });

  test("tool call without a title or content: its kind", () => {
    expect(itemText(tool("tool:t", { title: "  ", toolKind: "read" }))).toBe("read");
    expect(itemText(tool("tool:t", { title: "", toolKind: null }))).toBe("tool");
  });

  test("the terminal notice is the conversation view's", () => {
    expect(TERMINAL_NOTICE).toBe(TERMINAL_UNAVAILABLE_NOTICE);
  });

  test("plan: its entries as a list, no status glyphs", () => {
    const p = projectItem(
      plan("p", [
        { content: "Read the router", status: "completed", priority: "medium" },
        { content: "Fix\nthe bug", status: "in_progress", priority: "high" },
        { content: "Run the tests", status: "pending", priority: "low" },
      ]),
    );
    expect(p.text).toBe("- Read the router\n- Fix the bug\n- Run the tests");
    // The collapsed line (`plan 1/3`) shows no entry.
    expect(p.summaryEnd).toBe(0);
  });

  test("summary ends: a tool call's title, a thought's first line; never-collapsing kinds whole", () => {
    expect(projectItem(tool("tool:t", { content: [{ type: "text", text: "out" }] })).summaryEnd).toBe("Run the tests".length);
    expect(projectItem(thought("th", "first\n\nsecond")).summaryEnd).toBe("first".length);
    for (const item of [user("u", "a\nb"), agent("a", "one\n\ntwo"), permission("r"), marker("e", "error", "boom")]) {
      expect(projectItem(item).summaryEnd).toBe(projectItem(item).text.length);
    }
  });

  test("permission record and markers", () => {
    expect(itemText(permission("r"))).toBe("Permission (allow once): Edit src/x.ts");
    expect(itemText(permission("r", { outcome: { type: "cancelled" }, title: "" }))).toBe("Permission (cancelled): t1");
    expect(itemText(marker("e", "error", "agent exited (code 1)\n"))).toBe("error: agent exited (code 1)");
    expect(itemText(marker("n", "notice", "detached"))).toBe("detached");
    expect(itemText(turnEnd("m"))).toBe("");
  });

  test("the projection adds no escape sequences", () => {
    for (const item of [agent("a", "a **b** `c` [d](e)\n| x | y |\n|-|-|\n| 1 | 2 |"), tool("tool:t", { content: [{ type: "diff", path: "p", oldText: "a\n", newText: "b\n" }] })]) {
      expect(itemText(item)).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
    }
  });
});

describe("positions", () => {
  const p = projectItem(user("u", "ab\ncde\n\nf"));

  test("line starts, line and column of an offset, and back", () => {
    expect(lineStarts(p.text)).toEqual([0, 3, 7, 8]);
    expect(lineColumnAt(p, 4)).toEqual({ line: 1, column: 1 });
    expect(lineColumnAt(p, 7)).toEqual({ line: 2, column: 0 });
    expect(lineColumnAt(p, 99)).toEqual({ line: 3, column: 1 });
    expect(offsetAt(p, 1, 1)).toBe(4);
    expect(offsetAt(p, 1, 50)).toBe(6);
    expect(offsetAt(p, 9, 0)).toBe(8);
    for (let offset = 0; offset <= p.text.length; offset++) {
      const { line, column } = lineColumnAt(p, offset);
      expect(offsetAt(p, line, column)).toBe(offset);
    }
  });

  test("text between two offsets, either order, clamped", () => {
    expect(textBetween(p, 4, 1)).toBe("b\nc");
    expect(textBetween(p, -5, 2)).toBe("ab");
    expect(textBetween(p, 8, 100)).toBe("f");
  });

  test("the block at an offset; null on a blank separator line", () => {
    const t = projectItem(tool("tool:t", { content: [{ type: "text", text: "out" }] }));
    expect(blockAt(t, 0)?.kind).toBe("title");
    expect(blockAt(t, t.summaryEnd + 1)).toBeNull();
    expect(blockAt(t, t.text.length)?.kind).toBe("text");
  });
});

describe("ranges across items", () => {
  const items = [user("u", "first prompt"), thought("th", "**Title**\n\nbody"), tool("tool:t", { content: [{ type: "text", text: "```\none\ntwo\n```" }] }), turnEnd("m"), agent("a", "the *answer*")];
  const { order, lookup } = conversation(...items);

  test("tail of the first, the middle whole, head of the last, a blank line between; empty parts skipped", () => {
    const text = rangeText(order, lookup, { anchor: { itemId: "u", offset: 6 }, focus: { itemId: "a", offset: 3 } });
    expect(text).toBe("prompt\n\nTitle\n\nbody\n\nRun the tests\n\none\ntwo\n\nthe");
  });

  test("the same text whichever end the drag started from", () => {
    const forward = rangeText(order, lookup, { anchor: { itemId: "th", offset: 2 }, focus: { itemId: "a", offset: 7 } });
    const backward = rangeText(order, lookup, { anchor: { itemId: "a", offset: 7 }, focus: { itemId: "th", offset: 2 } });
    expect(backward).toBe(forward);
  });

  test("within one item", () => {
    expect(rangeText(order, lookup, { anchor: { itemId: "tool:t", offset: 20 }, focus: { itemId: "tool:t", offset: 15 } })).toBe("one\nt");
  });

  test("collapsed items in the middle give their summary line only", () => {
    const text = rangeText(order, lookup, { anchor: { itemId: "u", offset: 0 }, focus: { itemId: "a", offset: 3 } }, { collapsed: (id) => id !== "a" && id !== "u" });
    expect(text).toBe("first prompt\n\nTitle\n\nRun the tests\n\nthe");
  });

  test("a collapsed plan covered whole gives its entries; a collapsed plan at an end gives what is covered", () => {
    const steps = plan("p", [
      { content: "Read the router", status: "completed", priority: "medium" },
      { content: "Fix the bug", status: "in_progress", priority: "high" },
    ]);
    const c = conversation(agent("a1", "before"), steps, agent("a2", "after"));
    const collapsed = { collapsed: (id: string) => id === "p" };
    const across = rangeText(c.order, c.lookup, { anchor: { itemId: "a1", offset: 0 }, focus: { itemId: "a2", offset: 5 } }, collapsed);
    expect(across).toBe("before\n\n- Read the router\n- Fix the bug\n\nafter");
    // Starting on the plan's line (offset 0): the plan is covered whole.
    expect(rangeText(c.order, c.lookup, { anchor: { itemId: "p", offset: 0 }, focus: { itemId: "a2", offset: 5 } }, collapsed)).toBe(
      "- Read the router\n- Fix the bug\n\nafter",
    );
    // Ending on the plan's line (offset 0, where the pointer resolves): nothing of it.
    expect(rangeText(c.order, c.lookup, { anchor: { itemId: "a1", offset: 0 }, focus: { itemId: "p", offset: 0 } }, collapsed)).toBe("before");
  });

  test("a collapsed item at an end gives no more than its summary", () => {
    // Started in the title of a collapsed tool call: the rest of the title, not its output.
    const text = rangeText(order, lookup, { anchor: { itemId: "tool:t", offset: 4 }, focus: { itemId: "a", offset: 3 } }, { collapsed: (id) => id === "tool:t" });
    expect(text).toBe("the tests\n\nthe");
    // An end left beyond the summary while the item was expanded gives nothing of the hidden part.
    const late = rangeText(order, lookup, { anchor: { itemId: "tool:t", offset: 17 }, focus: { itemId: "a", offset: 3 } }, { collapsed: (id) => id === "tool:t" });
    expect(late).toBe("the");
  });

  test("an end outside the order gives nothing", () => {
    expect(rangeText(order, lookup, { anchor: { itemId: "gone", offset: 0 }, focus: { itemId: "a", offset: 3 } })).toBe("");
  });

  test("the whole conversation and the last answer", () => {
    expect(conversationText(order, lookup)).toBe("first prompt\n\nTitle\n\nbody\n\nRun the tests\n\none\ntwo\n\nthe answer");
    expect(lastAnswerText(order, lookup)).toBe("the answer");
    expect(lastAnswerText(["u"], lookup)).toBeNull();
  });

  test("lookupOf reads the model's map and the store's record", () => {
    const map = new Map(items.map((i) => [i.id, i]));
    const record = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(conversationText(order, lookupOf(map))).toBe(conversationText(order, lookupOf(record)));
  });
});

describe("the projection cache", () => {
  test("reuses a projection while the item object is the same; a new version is projected again", () => {
    const cache = new ProjectionCache();
    const v1 = agent("a", "one");
    expect(cache.get(v1).text).toBe("one");
    expect(cache.get(v1).text).toBe("one");
    expect(cache.computed).toBe(1);
    const v2 = { ...v1, text: "one two" };
    expect(cache.get(v2).text).toBe("one two");
    expect(cache.computed).toBe(2);
    expect(cache.size).toBe(1);
  });

  test("prune drops items no longer in the order", () => {
    const cache = new ProjectionCache();
    cache.get(agent("a", "x"));
    cache.get(agent("b", "y"));
    cache.prune(["b"]);
    expect(cache.size).toBe(1);
  });
});

describe("Markdown form (`Y` and the export)", () => {
  test("thought as a block quote, plan as a task list, permission, error and notice lines, turn end left out", () => {
    expect(itemMarkdown(thought("th", "**T**\n\nbody\n"))).toBe("> **Thought**\n>\n> **T**\n>\n> body");
    expect(
      itemMarkdown(
        plan("p", [
          { content: "done", status: "completed", priority: "low" },
          { content: "doing", status: "in_progress", priority: "low" },
          { content: "todo", status: "pending", priority: "low" },
        ]),
      ),
    ).toBe("**Plan**\n\n- [x] done\n- [ ] doing (in progress)\n- [ ] todo");
    expect(itemMarkdown(permission("r", { outcome: { type: "answered", optionId: "x", optionKind: "reject_always" } }))).toBe(
      "**Permission** (reject always): Edit src/x.ts",
    );
    expect(itemMarkdown(marker("e", "error", "boom"))).toBe("**Error:** boom");
    expect(itemMarkdown(marker("n", "notice", "detached"))).toBe("**Notice:** detached");
    expect(itemMarkdown(turnEnd("m"))).toBe("");
  });

  test("tool output in a bare fence longer than any backtick run inside; terminal as a notice", () => {
    const item = tool("tool:t", {
      toolKind: "execute",
      toolStatus: "failed",
      content: [{ type: "text", text: "```\nnot a fence end\n````\n" }, { type: "terminal_unavailable" }],
    });
    expect(itemMarkdown(item)).toBe(
      `**Tool** (execute, failed): Run the tests\n\n\`\`\`\`\`\n\`\`\`\nnot a fence end\n\`\`\`\`\n\`\`\`\`\`\n\n*${TERMINAL_NOTICE}*`,
    );
    expect(fenceFor("no ticks")).toBe("```");
  });

  test("export: a title, role headings only when the speaker changes, one newline at the end", () => {
    const { order, lookup } = conversation(user("u1", "hi"), agent("a1", "hello"), thought("t", "hmm"), turnEnd("m1"), user("u2", "again"), agent("a2", "sure"));
    expect(conversationMarkdown(order, lookup, { title: "fake-agent in /work" })).toBe(
      "# fake-agent in /work\n\n## User\n\nhi\n\n## Agent\n\nhello\n\n> **Thought**\n>\n> hmm\n\n## User\n\nagain\n\n## Agent\n\nsure\n",
    );
    expect(conversationMarkdown([], lookup)).toBe("");
  });
});
