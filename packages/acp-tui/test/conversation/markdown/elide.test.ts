// Long bare URLs on one row where the terminal detects URLs itself (mvp-rendering task 14.5,
// review A1; spec tui-rendering "Links in every form"; src/conversation/markdown/elide.ts).
import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_GLYPHS } from "../../../src/conversation/glyphs.ts";
import { elideUrl, isBareUrl, setUrlElision, urlElision } from "../../../src/conversation/markdown/elide.ts";
import { MessageLayout } from "../../../src/conversation/markdown/layout.ts";
import { mapBlockRows, projectMessage } from "../../../src/conversation/markdown/project.ts";
import { rowText, type Row, type Span } from "../../../src/conversation/markdown/types.ts";
import { displayWidth } from "../../../src/layout/segments.ts";
import { detectedUrls } from "../../../src/links/detect.ts";
import { linkInRow } from "../../../src/links/hit.ts";

afterEach(() => setUrlElision(false));

const LONG = "https://example.com/a/very/long/path/that/keeps/going/and/going/well/past/the/width/of/the/terminal/pane?query=string";

const layout = (source: string, width = 60) => new MessageLayout(source, width, DEFAULT_GLYPHS, undefined, false);
const rows = (source: string, width = 60): Row[] => layout(source, width).blocks().flatMap((b) => [...b.rows]);
const text = (source: string, width = 60) => rows(source, width).map(rowText);

describe("elideUrl and isBareUrl", () => {
  test("the scheme and a leading www. go first; then the middle, with about a third kept at the end", () => {
    expect(elideUrl("https://example.com/a", 30)).toBe("example.com/a");
    expect(elideUrl("http://www.example.com/a", 30)).toBe("example.com/a");
    const short = elideUrl(LONG, 40)!;
    expect(displayWidth(short)).toBe(40);
    expect(short).toBe("example.com/a/very/long/pa…?query=string");
    expect(short.startsWith("example.com/")).toBe(true);
    expect(short.endsWith("?query=string")).toBe(true);
    expect(elideUrl(LONG, 7)).toBeNull();
  });

  test("a bare URL: http(s):// or www. text showing its own target; a label, a mail address or a path is not", () => {
    expect(isBareUrl("https://example.com/x", "https://example.com/x")).toBe(true);
    expect(isBareUrl("www.example.com", "http://www.example.com")).toBe(true);
    expect(isBareUrl("https://bank.example", "https://evil.example/login")).toBe(false);
    expect(isBareUrl("docs", "https://example.com")).toBe(false);
    expect(isBareUrl("team@example.com", "mailto:team@example.com")).toBe(false);
    expect(isBareUrl("docs/README.md", "docs/README.md")).toBe(false);
  });

  test("the switch is off unless the app turns it on", () => {
    expect(urlElision()).toBe(false);
  });
});

describe("Links in every form: a long bare URL in a terminal that detects URLs (A1)", () => {
  test("off (every other terminal): the URL breaks at the width over two rows, as before", () => {
    const drawn = text(`A long one: ${LONG}`);
    expect(drawn).toHaveLength(3);
    expect(drawn.join("")).toBe(`A long one:${LONG}`);
  });

  test("on: one row without the scheme, shortened in the middle with …, in the link token, and the terminal's patterns find nothing", () => {
    setUrlElision(true);
    const source = `A long one: ${LONG}`;
    const drawn = rows(source);
    expect(drawn).toHaveLength(2);
    const [first, second] = drawn.map(rowText);
    expect(first).toBe("A long one:");
    expect(displayWidth(second!)).toBe(60);
    expect(second).toMatch(/^example\.com\/a\/very\/long\/.*….*\?query=string$/);
    expect(detectedUrls(second!)).toEqual([]);
    const url = drawn[1]!.spans[0] as Span;
    expect(url.token).toBe("markdown.link");
    expect(url.link?.href).toBe(LONG);
    // Every cell opens the full URL.
    for (const col of [0, 30, 59]) expect(linkInRow(drawn[1]!, col)?.href).toBe(LONG);
    // The height follows (the estimate shares the layout).
    expect(layout(source).height()).toBe(2);
  });

  test("on: copy, find and export keep the full URL: the projection is unchanged and every cell maps onto the whole URL", () => {
    const source = `A long one: ${LONG}`;
    const before = projectMessage(source, DEFAULT_GLYPHS, false).text;
    setUrlElision(true);
    const after = projectMessage(source, DEFAULT_GLYPHS, false).text;
    expect(after).toBe(before);
    expect(after).toBe(source);
    const [block] = layout(source).blocks();
    const cells = mapBlockRows(block!.rows, after, 0)!;
    const row = cells[1]!;
    expect(after.slice(row.from[0]!, row.to[0]!)).toBe(LONG);
    expect(after.slice(row.from[40]!, row.to[40]!)).toBe(LONG);
  });

  test("on: punctuation around the URL stays, and www. text loses its www.; a URL that fits is left alone", () => {
    setUrlElision(true);
    const paren = text(`(${LONG}).`, 50);
    expect(paren).toHaveLength(1);
    expect(paren[0]!.startsWith("(example.com/")).toBe(true);
    expect(paren[0]!.endsWith("query=string).")).toBe(true);
    expect(displayWidth(paren[0]!)).toBe(50);
    const www = text(`www.example.com/${"x".repeat(80)}`, 40);
    expect(www).toHaveLength(1);
    expect(www[0]!.startsWith("example.com/xx")).toBe(true);
    expect(text("see https://example.com/bare/url today")).toEqual(["see https://example.com/bare/url today"]);
  });

  test("on: a labelled link, a deceptive label and a long word still break at the width", () => {
    setUrlElision(true);
    const label = "x".repeat(70);
    expect(text(`[${label}](https://example.com/a)`)).toEqual(["x".repeat(60), `${"x".repeat(10)} (example.com)`]);
    const deceptive = `https://bank.example/${"y".repeat(60)}`;
    expect(text(`[${deceptive}](https://evil.example/login)`).join("")).toContain(deceptive.slice(0, 60));
    expect(text("z".repeat(70))).toEqual(["z".repeat(60), "z".repeat(10)]);
  });
});
