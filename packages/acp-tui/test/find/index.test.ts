// SPIKE (phase-1a, S5): the find index over the plain-text projection (task
// 15.1): every content kind, collapsed content, both sides of diffs, smart
// case, hit order and stepping, incremental updates while an item streams,
// and the `long-session --items 5000` needle, timed.
//
// The 5000-item needle test, with its cold and warm times, is in index.timing.test.ts
// (parallel-tests: it runs in the serial pass).
import { describe, expect, test } from "bun:test";
import { createSession, reduce, type Item, type Session } from "acp-model";
import { expandedByDefault } from "../../src/conversation/view-model.ts";
import { FindIndex, firstHitFrom, hitsIn, isCaseSensitive, stepHit, type FindResult } from "../../src/find/index.ts";
import { itemText, lookupOf } from "../../src/selection/projection.ts";
import { agent, conversation, marker, permission, plan, thought, tool, turnEnd, user } from "../selection/items.ts";

const items: Item[] = [
  user("u", "Please fix the Router in src/Http"),
  agent("a", "The **culprit** is `resolveRoute`:\n\n| file | line |\n| --- | --- |\n| Router.php | 42 |\n"),
  thought("th", "**Tracing requests**\n\nThe request pipeline drops the trailing slash."),
  tool("tool:read", { title: "Read src/Http/Router.php", toolKind: "read", content: [{ type: "text", text: "```php\n<?php\nfinal class Router\n{\n}\n```\n" }] }),
  tool("tool:edit", {
    title: "Edit src/Http/Router.php",
    toolKind: "edit",
    content: [{ type: "diff", path: "/w/src/Http/Router.php", oldText: "keep\nreturn $legacyPath;\nkeep\n", newText: "keep\nreturn $normalisedPath;\nkeep\n" }],
  }),
  tool("tool:run", { title: "Run phpunit", content: [{ type: "terminal_unavailable" }] }),
  plan("plan", [
    { content: "Reproduce the slash bug", status: "completed", priority: "high" },
    { content: "Write a regression test", status: "pending", priority: "medium" },
  ]),
  permission("perm", { title: "Edit src/Http/Router.php" }),
  marker("err", "error", "agent exited (code 3)"),
  turnEnd("end"),
];
const { order, lookup } = conversation(...items);

function find(query: string): FindResult {
  return new FindIndex().search(query, order, lookup);
}

/** Each hit as `itemId:matched text`. */
function hitTexts(result: FindResult): string[] {
  return result.hits.map((hit) => `${hit.itemId}:${itemText(lookup(hit.itemId)!).slice(hit.start, hit.end)}`);
}

describe("find covers every content kind (phase-1a task 15.1)", () => {
  test("user text", () => {
    expect(hitTexts(find("src/http"))).toContain("u:src/Http");
  });

  test("agent Markdown, as drawn: markers concealed, table cells", () => {
    expect(hitTexts(find("culprit is resolveroute"))).toEqual(["a:culprit is resolveRoute"]);
    expect(hitTexts(find("router.php"))).toContain("a:Router.php");
    // The Markdown source's markers are not part of the searched text.
    expect(find("**culprit").hits).toHaveLength(0);
  });

  test("thought", () => {
    expect(hitTexts(find("trailing slash"))).toEqual(["th:trailing slash"]);
  });

  test("tool title", () => {
    expect(hitTexts(find("run phpunit"))).toEqual(["tool:run:Run phpunit"]);
  });

  test("tool text output", () => {
    expect(hitTexts(find("final class"))).toEqual(["tool:read:final class"]);
  });

  test("both sides of a diff: the removed and the added line", () => {
    expect(hitTexts(find("legacypath"))).toEqual(["tool:edit:legacyPath"]);
    expect(hitTexts(find("normalisedpath"))).toEqual(["tool:edit:normalisedPath"]);
    // And the diff's sign and file header are searchable text too.
    expect(hitTexts(find("-return $legacy"))).toEqual(["tool:edit:-return $legacy"]);
  });

  test("terminal content: the notice shown for it", () => {
    expect(hitTexts(find("terminal output unavailable"))).toEqual(["tool:run:terminal output unavailable"]);
  });

  test("plan entries", () => {
    expect(hitTexts(find("regression test"))).toEqual(["plan:regression test"]);
  });

  test("permission records and error markers; turn ends never match", () => {
    expect(find("allow once").hits.map((h) => h.itemId)).toEqual(["perm"]);
    expect(find("exited").hits.map((h) => h.itemId)).toEqual(["err"]);
    expect(find("end turn").hits).toHaveLength(0);
  });

  test("collapsed content is included: the view's collapse state is not an input", () => {
    for (const id of ["th", "tool:read", "tool:edit", "plan"]) expect(expandedByDefault(lookup(id)!)).toBe(false);
    expect(new Set(find("router").hits.map((h) => h.itemId))).toEqual(new Set(["u", "a", "tool:read", "tool:edit", "perm"]));
  });
});

describe("smart case", () => {
  test("all lower case matches any case; any capital matches exactly", () => {
    expect(isCaseSensitive("router")).toBe(false);
    expect(isCaseSensitive("Router")).toBe(true);
    expect(isCaseSensitive("42 -")).toBe(false);
    expect(find("router").caseSensitive).toBe(false);
    expect(hitTexts(find("router")).filter((h) => h.startsWith("tool:read:"))).toEqual([
      "tool:read:Router",
      "tool:read:Router",
    ]);
    expect(find("ROUTER").hits).toHaveLength(0);
    expect(hitTexts(find("Router")).every((h) => h.endsWith(":Router"))).toBe(true);
    expect(find("Router").hits.length).toBe(find("router").hits.length);
  });

  test("non-ASCII case folding without shifting offsets", () => {
    const { order: o, lookup: l } = conversation(user("x", "İstanbul and ÉCOLE and école"));
    const result = new FindIndex().search("école", o, l);
    expect(result.hits.map((h) => itemText(l(h.itemId)!).slice(h.start, h.end))).toEqual(["ÉCOLE", "école"]);
  });

  test("the query is literal text, not a pattern", () => {
    expect(hitTexts(find("$legacypath;"))).toEqual(["tool:edit:$legacyPath;"]);
    expect(find(".*").hits).toHaveLength(0);
  });
});

describe("hits: order, stepping and position", () => {
  test("in conversation order, then by offset, never overlapping", () => {
    const { order: o, lookup: l } = conversation(user("1", "aaaa"), user("2", "xaax"));
    const result = new FindIndex().search("aa", o, l);
    expect(result.hits).toEqual([
      { itemId: "1", start: 0, end: 2 },
      { itemId: "1", start: 2, end: 4 },
      { itemId: "2", start: 1, end: 3 },
    ]);
    expect(hitsIn(result, "1")).toHaveLength(2);
  });

  test("an empty query has no hits", () => {
    expect(find("").hits).toEqual([]);
  });

  test("next and previous wrap; none gives -1", () => {
    expect(stepHit(3, -1, 1)).toBe(0);
    expect(stepHit(3, -1, -1)).toBe(2);
    expect(stepHit(3, 2, 1)).toBe(0);
    expect(stepHit(3, 0, -1)).toBe(2);
    expect(stepHit(0, 0, 1)).toBe(-1);
  });

  test("the first hit at or after the reader's item, wrapping", () => {
    const result = find("router");
    expect(firstHitFrom(result, order, null)).toBe(0);
    expect(result.hits[firstHitFrom(result, order, "th")]!.itemId).toBe("tool:read");
    expect(firstHitFrom(result, order, "end")).toBe(0);
    expect(firstHitFrom(find("zzz"), order, "th")).toBe(-1);
  });
});

describe("incremental updates", () => {
  test("a streaming item is projected again per version; unchanged items are not", () => {
    let model: Session = reduce(createSession(), { type: "prompt_sent", text: "go", at: 0 });
    const index = new FindIndex();
    const search = (q: string) => index.search(q, model.order, lookupOf(model.items));
    const chunk = (text: string, at: number) =>
      reduce(model, { type: "session_update", at, update: { sessionUpdate: "agent_message_chunk", messageId: "m", content: { type: "text", text } } });

    model = chunk("the first half ", 1);
    expect(search("second").hits).toHaveLength(0);
    const after1 = index.cache.computed;
    expect(after1).toBe(2);

    model = chunk("and the second half", 2);
    const result = search("second");
    expect(result.hits).toEqual([{ itemId: model.order[1]!, start: 23, end: 29 }]);
    // Only the streamed message was projected again.
    expect(index.cache.computed).toBe(after1 + 1);

    search("half");
    expect(index.cache.computed).toBe(after1 + 1);
  });
});

// mvp-rendering task 10.1: find searches the text as the renderers draw it, so a word inside a
// decoded entity, a footnote definition (gathered at the end of the message) and converted maths
// are found as drawn, and their source forms are not.
describe("find over rendered Markdown (mvp-rendering task 10.1)", () => {
  const source =
    "The caf&eacute; menu&nbsp;list &amp; prices[^menu].\n\n" +
    "The bound is $\\alpha \\le \\beta^2$ for every input.\n\n" +
    "[^menu]: The footnote definition mentions zebracrossing pricing.\n";
  const { order: ids, lookup: find1 } = conversation(agent("rendered", source));
  const search = (query: string) => new FindIndex().search(query, ids, find1);
  const texts = (query: string) => search(query).hits.map((hit) => itemText(find1(hit.itemId)!).slice(hit.start, hit.end));

  test("a decoded entity: `café`, `menu list` (no-break space as a space) and `&`", () => {
    expect(texts("café")).toEqual(["café"]);
    expect(texts("menu list")).toEqual(["menu list"]);
    expect(texts("list & prices")).toEqual(["list & prices"]);
    expect(search("&eacute;").hits).toHaveLength(0);
    expect(search("&amp;").hits).toHaveLength(0);
  });

  test("a word in a footnote definition, and its reference as the superscript drawn", () => {
    expect(texts("zebracrossing")).toEqual(["zebracrossing"]);
    expect(texts("prices¹")).toEqual(["prices¹"]);
    expect(search("[^menu]").hits).toHaveLength(0);
  });

  test("converted maths: `α ≤ β²` found, the LaTeX source not", () => {
    expect(texts("α ≤ β²")).toEqual(["α ≤ β²"]);
    expect(texts("β²")).toEqual(["β²"]);
    expect(search("\\alpha").hits).toHaveLength(0);
    expect(search("$").hits).toHaveLength(0);
  });
});
