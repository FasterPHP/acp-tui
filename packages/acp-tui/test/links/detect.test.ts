// The JetBrains URL patterns acp-tui runs over a clicked row (mvp-rendering task 14.5, review C9;
// src/links/detect.ts): the cases of docs/mvp-notes/rendering-research.md, C9.
import { describe, expect, test } from "bun:test";
import { OptimizedBuffer, ResourceContext, RGBA } from "@opentui/core";
import { classifyTarget } from "../../src/conversation/markdown/links.ts";
import type { LinkTarget } from "../../src/conversation/markdown/types.ts";
import { bufferRow, detectedUrlAt, detectedUrls, opensTarget } from "../../src/links/detect.ts";

const texts = (row: string) => detectedUrls(row).map((m) => m.text);

const target = (href: string): LinkTarget => {
  const v = classifyTarget(href, "/w");
  if (!v.allowed) throw new Error(`refused: ${href}`);
  return { href, open: v.open, url: v.url, kind: v.kind, shown: v.shown };
};

describe("the terminal's URL patterns (C9)", () => {
  test("the schemes and www.; a final dot, comma or closing parenthesis is not part of the URL", () => {
    expect(texts("see https://example.com/bare/url today")).toEqual(["https://example.com/bare/url"]);
    expect(texts("at http://a.example/x.")).toEqual(["http://a.example/x"]);
    expect(texts("ftp://f.example/a, ftps://g.example and news://n.example")).toEqual(["ftp://f.example/a", "ftps://g.example", "news://n.example"]);
    expect(texts("write to mailto:team@example.com now")).toEqual(["mailto:team@example.com"]);
    expect(texts("go to www.example.com/a?b=c#d")).toEqual(["www.example.com/a?b=c#d"]);
    expect(texts("(file:///etc/passwd)")).toEqual(["file:///etc/passwd"]);
    expect(texts("file:C:/x/y.txt;")).toEqual(["file:C:/x/y.txt"]);
  });

  test("not matched: other schemes, upper case, www. after a letter, a mail address, a host alone, an elided URL", () => {
    expect(texts("javascript:alert(1) data:text/html,x ssh://h gemini://g")).toEqual([]);
    expect(texts("HTTPS://EXAMPLE.COM Http://x.example")).toEqual([]);
    expect(texts("awww.example.com x.www.example.com _www.example.com")).toEqual([]);
    expect(texts("someone@example.com docs (example.com)")).toEqual([]);
    expect(texts("example.com/a/very/long/…/and-a-fragment")).toEqual([]);
  });

  test("a match stops at `…` and other characters outside its class", () => {
    expect(texts("https://example.com/a…b")).toEqual(["https://example.com/a"]);
    expect(texts("https://example.com/a\ufffcb")).toEqual(["https://example.com/a"]);
  });

  test("detectedUrlAt: the match under a column, none beside it", () => {
    const row = "  label https://bank.example and more";
    expect(detectedUrlAt(row, 7)).toBeNull();
    expect(detectedUrlAt(row, 8)).toEqual({ from: 8, to: 28, text: "https://bank.example" });
    expect(detectedUrlAt(row, 27)?.text).toBe("https://bank.example");
    expect(detectedUrlAt(row, 28)).toBeNull();
  });

  test("opensTarget: a bare URL or www. text opens the link's own target; a deceptive or cut-off label does not", () => {
    expect(opensTarget("https://example.com/bare/url", target("https://example.com/bare/url"))).toBe(true);
    expect(opensTarget("www.example.com", target("http://www.example.com"))).toBe(true);
    expect(opensTarget("https://example.com/", target("https://example.com"))).toBe(true);
    expect(opensTarget("https://bank.example", target("https://evil.example/login"))).toBe(false);
    expect(opensTarget("https://example.com/a/very", target("https://example.com/a/very/long"))).toBe(false);
  });

  test("bufferRow: one string unit per cell, empty cells as spaces and wide characters as U+FFFC, so an index is a column", () => {
    // OpenTUI 0.6: a buffer needs an owner; a context of its own here, as no renderer is needed.
    const owner = new ResourceContext({ objectCapacity: 16, renderCellsMax: 64 });
    const buffer = OptimizedBuffer.create(30, 2, "unicode", { owner });
    const fg = RGBA.fromInts(255, 255, 255, 255);
    const bg = RGBA.fromInts(0, 0, 0, 255);
    buffer.drawText("漢 https://x.example/a", 2, 1, fg, bg);
    const row = bufferRow(buffer, 1);
    expect(row.length).toBe(30);
    expect(row.slice(0, 5)).toBe("  \ufffc\ufffc ");
    expect(detectedUrlAt(row, 5)).toEqual({ from: 5, to: 24, text: "https://x.example/a" });
    expect(bufferRow(buffer, 5)).toBe("");
    buffer.destroy();
    owner.destroy();
  });
});
