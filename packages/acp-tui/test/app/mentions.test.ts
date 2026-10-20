// File mentions in the prompt box (mvp-chrome-and-keys task 6.7, spec
// tui-palette "File mentions are sent as resource links"): ranges tracked
// across edits, the `@` word, and the links sent after the text.
import { describe, expect, test } from "bun:test";
import {
  columnOffset,
  highlightOffset,
  indexAtColumn,
  insertMention,
  mentionLinks,
  mentionQuery,
  startsMention,
  updateMentions,
  type LinkTarget,
  type Mention,
} from "../../src/app/mentions.ts";

const mention = (text: string, path: string): Mention => {
  const start = text.indexOf(`@${path}`);
  return { start, end: start + path.length + 1, path, text: `@${path}` };
};

describe("updateMentions", () => {
  const before = "Explain @src/a.php now";
  const m = mention(before, "src/a.php");

  test("an edit before a mention moves it; one after leaves it", () => {
    expect(updateMentions([m], before, `Please ${before}`)).toEqual([{ ...m, start: m.start + 7, end: m.end + 7 }]);
    expect(updateMentions([m], before, `${before}, thanks`)).toEqual([m]);
  });

  test("typing directly after or before a mention keeps it", () => {
    expect(updateMentions([m], before, "Explain @src/a.php, now")).toEqual([m]);
    expect(updateMentions([m], before, "Explain X@src/a.php now")).toEqual([{ ...m, start: m.start + 1, end: m.end + 1 }]);
  });

  test("an edit inside a mention turns it back into text", () => {
    expect(updateMentions([m], before, "Explain @src/aa.php now")).toEqual([]);
    expect(updateMentions([m], before, "Explain @src/.php now")).toEqual([]);
    expect(updateMentions([m], before, "Explain @src/a.ph now")).toEqual([]);
    // Deleting across its start.
    expect(updateMentions([m], before, "Explainsrc/a.php now")).toEqual([]);
  });

  test("clearing the draft drops every mention", () => {
    expect(updateMentions([m], before, "")).toEqual([]);
  });

  test("the other mentions survive an edit inside one", () => {
    const text = "@a.ts and @b.ts";
    const a = mention(text, "a.ts");
    const b = mention(text, "b.ts");
    expect(updateMentions([a, b], text, "@a.xs and @b.ts")).toEqual([b]);
  });
});

describe("the @ word", () => {
  test("`@` starts a mention at the start of the draft or after whitespace, not after a word", () => {
    expect(startsMention("@x", 0)).toBe(true);
    expect(startsMention("see @x", 4)).toBe(true);
    expect(startsMention("line\n@x", 5)).toBe(true);
    expect(startsMention("me@example.com", 2)).toBe(false);
  });

  test("the query is the text from the `@` to the cursor, while it has no whitespace", () => {
    expect(mentionQuery("see @con", 8, 4)).toBe("con");
    expect(mentionQuery("see @", 5, 4)).toBe("");
    expect(mentionQuery("see @con x", 10, 4)).toBeNull();
    expect(mentionQuery("see @con", 3, 4)).toBeNull();
    expect(mentionQuery("see con", 7, 4)).toBeNull();
  });
});

describe("insertMention", () => {
  test("replaces `@<filter>` with the mention and puts the cursor after it", () => {
    const result = insertMention("Explain @conn", 8, 13, "src/Db/Connection.php", "src/Db/Connection.php", []);
    expect(result.text).toBe("Explain @src/Db/Connection.php");
    expect(result.cursor).toBe(result.text.length);
    expect(result.mentions).toEqual([{ start: 8, end: 30, path: "src/Db/Connection.php", text: "@src/Db/Connection.php" }]);
  });

  test("keeps earlier mentions; the shown name may differ from the real path", () => {
    const first = insertMention("@a", 0, 2, "a.ts", "a.ts", []);
    const second = insertMention(`${first.text} @x`, 6, 8, "x‮.ts", "x.ts", first.mentions);
    expect(second.text).toBe("@a.ts @x.ts");
    expect(second.mentions.map((m) => [m.path, m.text])).toEqual([
      ["a.ts", "@a.ts"],
      ["x‮.ts", "@x.ts"],
    ]);
  });
});

describe("mentionLinks", () => {
  const target: LinkTarget = {
    uri: (path) => `file:///proj/${path}`,
    size: (path) => (path === "gone.txt" ? null : 42),
  };

  test("one resource_link per intact mention, in text order, with name and size, never content", () => {
    const text = "Compare @b.ts with @a.ts and @gone.txt";
    const links = mentionLinks(text, [mention(text, "a.ts"), mention(text, "b.ts"), mention(text, "gone.txt")], target);
    expect(links).toEqual([
      { type: "resource_link", uri: "file:///proj/b.ts", name: "b.ts", size: 42 },
      { type: "resource_link", uri: "file:///proj/a.ts", name: "a.ts", size: 42 },
      { type: "resource_link", uri: "file:///proj/gone.txt", name: "gone.txt" },
    ]);
  });

  test("a range that no longer holds its text sends no link", () => {
    expect(mentionLinks("Compare @b.tsx", [{ start: 8, end: 13, path: "b.ts", text: "@b.tz" }], target)).toEqual([]);
    expect(mentionLinks("no mentions", [], target)).toEqual([]);
  });
});

describe("textarea offsets", () => {
  test("display columns and newlines convert to UTF-16 indices and back", () => {
    const text = "日本 @a\nb @c";
    for (const index of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) expect(indexAtColumn(text, columnOffset(text, index))).toBe(index);
    expect(columnOffset(text, 3)).toBe(5);
    expect(highlightOffset(text, 9)).toBe(columnOffset(text, 9) - 1);
  });
});
