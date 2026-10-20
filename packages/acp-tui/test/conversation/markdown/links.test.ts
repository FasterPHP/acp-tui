// Links (mvp-rendering tasks 6.1 and 6.2; spec tui-rendering "Links in every form", "Link
// target safety", "Projection follows the rendered text"), over the gallery's link fixtures
// (M04, M30 to M33, M35) and the spec's scenarios.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_GLYPHS } from "../../../src/conversation/glyphs.ts";
import { rowsToChunks } from "../../../src/conversation/markdown/draw.ts";
import { MessageLayout } from "../../../src/conversation/markdown/layout.ts";
import { classifyTarget, labelShowsTarget, linkBase, MAX_LINK_TARGET, REFUSED_SHOWN_MAX, refusedShown, setLinkBase, type RefusedTarget } from "../../../src/conversation/markdown/links.ts";
import { mapBlockRows, projectMessage } from "../../../src/conversation/markdown/project.ts";
import { rowText, type Row, type Span } from "../../../src/conversation/markdown/types.ts";
import { NO_CAPABILITIES } from "../../../src/renderer/capabilities.ts";
import { DEFAULT_THEME, resolveTheme } from "../../../src/theme/index.ts";
import { galleryByTag, gallerySource } from "./golden.ts";

afterEach(() => setLinkBase(null));

const rows = (source: string, width = 60): Row[] => new MessageLayout(source, width, DEFAULT_GLYPHS, undefined, false).blocks().flatMap((b) => [...b.rows]);
const text = (source: string, width = 60) => rows(source, width).map(rowText);
const spans = (source: string, width = 60): Span[] => rows(source, width).flatMap((r) => r.spans as Span[]);
const linked = (source: string) => spans(source).filter((s) => s.link);
const plain = (source: string) => projectMessage(source, DEFAULT_GLYPHS, false).text;

describe("Links in every form", () => {
  test("Labelled link: `docs (example.com)`, the label in markdown.link, no title or path shown", () => {
    const source = '[docs](https://example.com/a/b "Title")';
    expect(text(source)).toEqual(["docs (example.com)"]);
    const [label, host] = linked(source);
    expect(label).toMatchObject({ text: "docs", token: "markdown.link", link: { href: "https://example.com/a/b", kind: "web", shown: "example.com" } });
    expect(host).toMatchObject({ text: "(example.com)", token: "muted", hint: true, link: { href: "https://example.com/a/b" } });
    expect(label!.hint).toBeUndefined();
    expect(text(source).join("")).not.toContain("Title");
  });

  test("OSC 8 covers the label only: the host hint stays clickable but carries no link in the drawn chunks (IDE follow-up 5)", () => {
    const source = "[docs](https://example.com/a/b) and https://example.com/bare/url";
    const drawn = (osc8: boolean) =>
      rowsToChunks(rows(source), 60, resolveTheme(DEFAULT_THEME, { terminal: { foreground: "#bcbec4", background: "#191a1c" } }), { ...NO_CAPABILITIES, osc8 });
    const withLink = drawn(true).filter((c) => c.link);
    expect(withLink.map((c) => [c.text, c.link!.url])).toEqual([
      ["docs", "https://example.com/a/b"],
      ["https://example.com/bare/url", "https://example.com/bare/url"],
    ]);
    // The hint's span still has its target (acp-tui's own click), and its text is drawn.
    expect(linked("[docs](https://example.com/a/b)").map((s) => s.text)).toEqual(["docs", "(example.com)"]);
    expect(drawn(true).map((c) => c.text).join("")).toContain("docs (example.com)");
    expect(drawn(false).some((c) => c.link)).toBe(false);
  });

  test("Bare URL: linked, no host suffix", () => {
    const source = "see https://example.com/bare/url today";
    expect(text(source)).toEqual(["see https://example.com/bare/url today"]);
    expect(linked(source).map((s) => s.text)).toEqual(["https://example.com/bare/url"]);
  });

  test("every form of M04 is linked: inline, reference, collapsed, shortcut, autolink, email, bare, www., relative", () => {
    const m04 = galleryByTag(100).get("M04")!;
    const targets = new Set(m04.flatMap((r) => (r?.spans ?? []).flatMap((s) => (s.link ? [s.link.href] : []))));
    expect([...targets]).toEqual([
      "https://example.com/inline",
      "https://example.com/reference",
      "https://example.com/autolink",
      "mailto:someone@example.com",
      "https://example.com/bare/url",
      "http://www.example.com/www",
      "./README.md",
    ]);
    const drawn = m04.map((r) => (r ? rowText(r) : "")).join(" ");
    // No title, and no host after a label that is its own target.
    expect(drawn).not.toContain("title");
    expect(drawn).toContain("someone@example.com, bare URL https://example.com/bare/url and www.example.com/www,");
    expect(drawn).toContain("README (./README.md)");
  });

  test("an email address with a different label shows the address; a bare email none", () => {
    expect(text("[write to us](mailto:team@example.com?subject=hi)")).toEqual(["write to us (team@example.com)"]);
    expect(text("mail someone@example.com now")).toEqual(["mail someone@example.com now"]);
  });

  test("a link wrapped over rows is one link on every row (M30's URL)", () => {
    const m30 = galleryByTag(63).get("M30")!;
    const urlRows = m30.filter((r) => r && rowText(r).match(/^(https|ng\/|=param)/));
    expect(urlRows.length).toBe(3);
    for (const row of urlRows) {
      expect(row!.spans).toHaveLength(1);
      expect(row!.spans[0]!.link?.href).toBe("https://example.com/a/very/long/path/that/keeps/going/and/going/well/past/the/width/of/the/terminal/pane?query=string&with=parameters#and-a-fragment");
    }
  });

  test("a wrapped label carries the link on each row, and the host is never broken", () => {
    const source = "[a label long enough to wrap over the rows](https://example.com/x)";
    const drawn = rows(source, 16);
    expect(drawn.map(rowText)).toEqual(["a label long", "enough to wrap", "over the rows", "(example.com)"]);
    for (const row of drawn) for (const s of row.spans) expect(s.link?.href).toBe("https://example.com/x");
  });

  test("labelShowsTarget: the target itself, without its scheme, mailto: or a trailing slash", () => {
    expect(labelShowsTarget("https://example.com/", "https://example.com")).toBe(true);
    expect(labelShowsTarget("www.example.com/www", "http://www.example.com/www")).toBe(true);
    expect(labelShowsTarget("a@b.example", "mailto:a@b.example")).toBe(true);
    expect(labelShowsTarget("README.md", "./README.md")).toBe(true);
    expect(labelShowsTarget("https://bank.example", "https://evil.example/login")).toBe(false);
    expect(labelShowsTarget("docs", "https://example.com/a")).toBe(false);
  });
});

describe("Link target safety", () => {
  test("Script scheme: `click me` plain, the target muted after it, nothing linked", () => {
    const source = "[click me](javascript:alert(1))";
    expect(text(source)).toEqual(["click me (javascript:alert(1))"]);
    expect(linked(source)).toEqual([]);
    expect(spans(source).find((s) => s.text.startsWith("click me"))?.token).toBe("text");
    expect(spans(source).find((s) => s.text.startsWith("(javascript"))?.token).toBe("muted");
  });

  test("M31: javascript (any case), data and file targets are never linked", () => {
    const m31 = galleryByTag(100).get("M31")!;
    expect(m31.flatMap((r) => r?.spans ?? []).some((s) => s.link || s.token === "markdown.link")).toBe(false);
    const drawn = m31.map((r) => (r ? rowText(r) : "")).join(" ");
    for (const shown of ["script link (javascript:alert(1))", "absolute file link (file:///etc/passwd)", "mixed-case scheme (JavaScript:alert(2))", "(data:text/html;base64,"]) expect(drawn).toContain(shown);
  });

  test("Deceptive label (M32): `(evil.example)` after the label; the honest one has no suffix", () => {
    const source = "[https://bank.example](https://evil.example/login) and [https://example.com/same](https://example.com/same)";
    expect(text(source, 100)).toEqual(["https://bank.example (evil.example) and https://example.com/same"]);
  });

  test("a user@ prefix never hides the host; an internationalised host is shown as punycode", () => {
    expect(text("[bank](https://bank.example@evil.example/)")).toEqual(["bank (evil.example)"]);
    expect(text("[shop](https://exаmple.com/)")).toEqual(["shop (xn--exmple-4nf.com)"]);
  });

  test("Relative path (M33): inside the working directory linked with the path after the label; outside and absolute refused", () => {
    const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-links-"));
    setLinkBase(dir);
    expect(linkBase()).toBe(dir);
    const source = "[readme](docs/README.md), [out](../../outside/secret.txt) and [abs](/etc/hosts)";
    expect(text(source, 100)).toEqual(["readme (docs/README.md), out (../../outside/secret.txt) and abs (/etc/hosts)"]);
    expect(linked(source).map((s) => s.text)).toEqual(["readme", "(docs/README.md)"]);
    expect(linked(source)[0]!.link).toMatchObject({ kind: "file", open: join(dir, "docs/README.md"), url: pathToFileURL(join(dir, "docs/README.md")).href, shown: "docs/README.md" });
    const m33 = galleryByTag(100).get("M33")!.flatMap((r) => r?.spans ?? []);
    expect(m33.filter((s) => s.link).map((s) => s.text).join(" ")).toBe("inside the working directory (src/index.ts)");
  });

  test("an absolute path inside the working directory is linked; the same text elsewhere is not", () => {
    const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-links-"));
    setLinkBase(dir);
    expect(classifyTarget(join(dir, "a/b.md"), dir)).toMatchObject({ allowed: true, kind: "file", open: join(dir, "a/b.md") });
    expect(classifyTarget(join(dir, "a/b.md"), "/somewhere/else")).toMatchObject({ allowed: false, reason: "outside" });
  });

  test("classifyTarget: the allow-list and every refusal", () => {
    // The POSIX rules, whatever the host (the Windows rules are in links-windows.test.ts).
    const cwd = "/work/project";
    const classify = (href: string, base: string) => classifyTarget(href, base, "linux");
    expect(classify("https://example.com/a?b#c", cwd)).toEqual({ allowed: true, kind: "web", open: "https://example.com/a?b#c", url: "https://example.com/a?b#c", shown: "example.com" });
    expect(classify("HTTP://Example.COM:8080/x", cwd)).toMatchObject({ allowed: true, shown: "example.com:8080" });
    expect(classify("mailto:a@b.example", cwd)).toMatchObject({ allowed: true, kind: "mail", shown: "a@b.example" });
    expect(classify("src/../README.md", cwd)).toMatchObject({ allowed: true, open: "/work/project/README.md" });
    expect(classify("my%20notes.md#top", cwd)).toMatchObject({ allowed: true, open: "/work/project/my notes.md", url: "file:///work/project/my%20notes.md" });
    expect(classify(".", cwd)).toMatchObject({ allowed: true, open: "/work/project" });
    const refusals: [string, RefusedTarget["reason"]][] = [
      ["javascript:alert(1)", "scheme"],
      ["JavaScript:alert(2)", "scheme"],
      ["data:text/html;base64,PHA+", "scheme"],
      ["file:///etc/passwd", "scheme"],
      ["vbscript:x", "scheme"],
      ["C:\\Windows", "scheme"],
      ["../secret.txt", "outside"],
      ["src/../../secret.txt", "outside"],
      ["%2e%2e/secret.txt", "outside"],
      ["/etc/hosts", "outside"],
      ["~/notes.md", "not-a-path"],
      ["//evil.example/x", "not-a-path"],
      ["#section", "not-a-path"],
      ["?q=1", "not-a-path"],
      ["https://exa mple.com", "whitespace"],
      ["https://example.com/\u0007", "whitespace"],
      ["a%00b", "whitespace"],
      ["https://", "invalid"],
      ["mailto:nobody", "invalid"],
      ["%E0%A4%A", "invalid"],
      ["", "empty"],
      [`https://example.com/${"a".repeat(MAX_LINK_TARGET)}`, "length"],
    ];
    for (const [href, reason] of refusals) expect([href, classify(href, cwd)]).toEqual([href, { allowed: false, reason }]);
    expect(classify(`https://example.com/${"a".repeat(MAX_LINK_TARGET - 20)}`, cwd).allowed).toBe(true);
  });

  test("a target over 2048 characters is refused and shown cut in the middle", () => {
    const href = `https://example.com/${"a".repeat(3000)}`;
    const drawn = text(`[long](${href})`, 400).join("");
    expect(drawn.startsWith("long (https://example.com/aaa")).toBe(true);
    expect(drawn).toContain("…");
    expect(Array.from(refusedShown(href)).length).toBe(REFUSED_SHOWN_MAX - 1);
    expect(linked(`[long](${href})`)).toEqual([]);
  });

  test("an image follows the same rules: linked when allowed (no host), plain with its target when refused", () => {
    expect(text("![diagram](https://example.com/d.png)")).toEqual(["[image: diagram]"]);
    expect(linked("![diagram](https://example.com/d.png)")).toHaveLength(1);
    expect(text("![x](javascript:alert(1))")).toEqual(["[image: x] (javascript:alert(1))"]);
    expect(linked("![x](javascript:alert(1))")).toEqual([]);
  });

  test("M35: HTML anchors keep their text and are never linked (attributes are never read)", () => {
    const m35 = galleryByTag(100).get("M35")!;
    expect(m35.flatMap((r) => r?.spans ?? []).some((s) => s.link)).toBe(false);
    expect(m35.map((r) => (r ? rowText(r) : "")).join(" ")).toContain("an anchor tag in a sentence, and an anchor with an unsafe target.");
  });

  test("the whole gallery: every linked span's target is allowed", () => {
    for (const s of spans(gallerySource(), 100)) if (s.link) expect(classifyTarget(s.link.href, linkBase()).allowed).toBe(true);
  });
});

describe("Projection follows the rendered text", () => {
  test("Copy of rendered prose: `x © docs (https://example.com/a) α`", () => {
    expect(plain("***x*** &copy; [docs](https://example.com/a) $\\alpha$")).toBe("x © docs (https://example.com/a) α");
  });

  test("a refused link is copied as drawn; a link that shows its target is copied once", () => {
    expect(plain("[click me](javascript:alert(1))")).toBe("click me (javascript:alert(1))");
    expect(plain("see https://example.com/bare/url today")).toBe("see https://example.com/bare/url today");
    expect(plain("[readme](docs/README.md)")).toBe("readme (docs/README.md)");
  });

  test("the host's cells map onto the whole target, in prose and in a table cell", () => {
    const source = "[docs](https://example.com/a)";
    const [block] = new MessageLayout(source, 60, DEFAULT_GLYPHS, undefined, false).blocks();
    const own = plain(source);
    const cells = mapBlockRows(block!.rows, own, 0)!;
    const col = "docs (".length;
    expect(own.slice(cells[0]!.from[col]!, cells[0]!.to[col]!)).toBe("(https://example.com/a)");
    const table = "| a | b |\n| - | - |\n| [docs](https://example.com/a) | c |";
    const projection = projectMessage(table, DEFAULT_GLYPHS, false);
    expect(projection.text).toContain("docs (https://example.com/a)");
  });
});
