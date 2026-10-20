// mvp-rendering task 9.2: the projection's fast path for a text that is exactly one fence
// (`singleFence`) gives what the lexed projection gives, and declines everything else.
import { describe, expect, test } from "bun:test";
import { DEFAULT_GLYPHS } from "../../../src/conversation/glyphs.ts";
import { projectMessage, singleFence } from "../../../src/conversation/markdown/project.ts";
import { join } from "node:path";
import { MARKDOWN_GALLERY } from "../../selection/fixtures.ts";

// Imported by a computed path: acp-tui does not depend on the fake-agent package.
const { toolContentTexts } = (await import(join(import.meta.dir, "../../../../fake-agent/src/scenarios/tool-content.ts"))) as {
  toolContentTexts: () => Readonly<Record<string, string>>;
};

const SAMPLES: readonly string[] = [
  ...Object.values(toolContentTexts()),
  "```php\n<?php\n\tfinal class A {}\n```",
  "```\nplain\n\n  indented\n```\n",
  "```sh   extra words\necho hi\n```\n\n\n",
  "~~~\ntilde fence\n```\nnot a close\n~~~",
  "````\n```\ninner fence shorter\n```\n````",
  "```\nwide 日本語 and émoji 👨‍👩‍👧\n```",
  "```console\n" + Array.from({ length: 300 }, (_, i) => `line ${i} ${"x".repeat(i % 120)}`).join("\n") + "\n```",
  "```\n  trailing spaces   \n```   \n",
];

const DECLINED: readonly string[] = [
  "no fence at all",
  "text before\n```\ncode\n```",
  "```\ncode\n```\ntext after",
  "```\nunclosed",
  "```\nfirst\n```\n```\nsecond\n```",
  " ```\nindented opening\n```",
  "```\n\n```",
  "```a`b\ncode\n```",
  "```\nwith  private use\n```",
  "```\r\ncrlf\r\n```",
];

describe("singleFence (mvp-rendering task 9.2)", () => {
  test("a text that is one fence projects as the lexed projection does", () => {
    for (const text of SAMPLES) {
      expect(singleFence(text)).not.toBeNull();
      expect(projectMessage(text, DEFAULT_GLYPHS, false, true)).toEqual(projectMessage(text, DEFAULT_GLYPHS, false, false));
    }
  });

  test("anything else is left to marked", () => {
    for (const text of DECLINED) expect(singleFence(text)).toBeNull();
  });

  test("the gallery's code blocks, each alone, agree", () => {
    const fences = MARKDOWN_GALLERY.match(/^(```|~~~)[^\n]*\n[\s\S]*?\n\1$/gm) ?? [];
    expect(fences.length).toBeGreaterThan(3);
    for (const text of fences) {
      if (!singleFence(text)) continue;
      expect(projectMessage(text, DEFAULT_GLYPHS, false, true)).toEqual(projectMessage(text, DEFAULT_GLYPHS, false, false));
    }
  });
});
