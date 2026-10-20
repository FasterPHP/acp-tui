// Footnotes (mvp-rendering task 7.3; spec tui-rendering "Footnotes" and "Projection follows the
// rendered text"): superscript numbers in `markdown.link` in first-reference order, the
// definitions gathered at the end under a short muted rule, references without a definition
// literal, and numbers that never change while a message streams.
import { describe, expect, test } from "bun:test";
import { DEFAULT_GLYPHS } from "../../../src/conversation/glyphs.ts";
import { superscriptNumber } from "../../../src/conversation/markdown/footnotes.ts";
import { MessageLayout } from "../../../src/conversation/markdown/layout.ts";
import { projectMessage } from "../../../src/conversation/markdown/project.ts";
import { rowText, type Row, type Span } from "../../../src/conversation/markdown/types.ts";
import { gallerySource } from "./golden.ts";

function rows(source: string, width = 60): Row[] {
  return new MessageLayout(source, width, DEFAULT_GLYPHS, undefined, false).blocks().flatMap((b) => [...b.rows]);
}

/** The superscript references drawn in prose, in order (the definitions' markers are muted). */
function refNumbers(source: string): string[] {
  const spans: Span[] = rows(source).flatMap((r) => [...r.spans]);
  return spans.filter((s) => s.token === "markdown.link" && /^[⁰¹²³⁴-⁹]+$/.test(s.text)).map((s) => s.text);
}

describe("Footnotes", () => {
  test("superscript numbers from the digits in both fonts", () => {
    expect(superscriptNumber(1)).toBe("¹");
    expect(superscriptNumber(2)).toBe("²");
    expect(superscriptNumber(3)).toBe("³");
    expect(superscriptNumber(10)).toBe("¹⁰");
    expect(superscriptNumber(49)).toBe("⁴⁹");
  });

  test("Named footnote: `[^1]` then `[^note]` read ¹ and ², and the message ends with a rule and two definitions numbered ¹ and ²", () => {
    const source = "First[^1] and named[^note].\n\n[^1]: One.\n[^note]: Two.";
    const drawn = rows(source);
    expect(drawn.map(rowText)).toEqual(["First¹ and named².", "────────", "¹ One.", "² Two."]);
    const refs = drawn[0]!.spans.filter((s) => s.text === "¹" || s.text === "²");
    expect(refs.map((s) => s.token)).toEqual(["markdown.link", "markdown.link"]);
    expect(drawn[1]!.decorative).toBe(true);
    expect(drawn[2]!.spans[0]).toMatchObject({ token: "muted", text: "¹ " });
  });

  test("numbered in the order of first reference, not of definition; a repeated reference keeps its number", () => {
    const source = "a[^b] b[^a] c[^b]\n\n[^a]: A.\n[^b]: B.";
    expect(rows(source).map(rowText)).toEqual(["a¹ b² c¹", "────────", "¹ B.", "² A."]);
  });

  test("Missing definition: `[^x]` stays literal", () => {
    expect(rows("see [^x] here").map(rowText)).toEqual(["see [^x] here"]);
    expect(refNumbers("see [^x] here")).toEqual([]);
  });

  test("an undefined reference keeps its place in the numbering, so the numbers after it never move", () => {
    const source = "a[^1] b[^x] c[^2]\n\n[^1]: One.\n[^2]: Two.";
    expect(rows(source).map(rowText)).toEqual(["a¹ b[^x] c³", "────────", "¹ One.", "³ Two."]);
  });

  test("a definition no reference names keeps its label and is drawn after the numbered ones", () => {
    expect(rows("a[^1]\n\n[^z]: Orphan.\n[^1]: One.").map(rowText)).toEqual(["a¹", "────────", "¹ One.", "[^z]: Orphan."]);
  });

  test("the projection holds the numbers and the definitions as drawn, not the rule", () => {
    const source = "First[^1] and named[^note].\n\n[^1]: One.\n[^note]: Two with **bold**.";
    expect(projectMessage(source, DEFAULT_GLYPHS, false).text).toBe("First¹ and named².\n\n¹ One.\n² Two with bold.");
  });

  test("a long definition wraps under its text, not under its number", () => {
    const drawn = rows("x[^1]\n\n[^1]: one two three four five six", 12);
    expect(drawn.slice(2).map(rowText)).toEqual(["¹ one two", "  three four", "  five six"]);
  });
});

describe("numbers never change while a message streams", () => {
  /** Every reference's number (by its order among the references drawn) across the chunks. */
  function streamed(source: string, chunk: number): void {
    const seen = new Map<number, string>();
    for (let end = chunk; end < source.length + chunk; end += chunk) {
      const prefix = source.slice(0, end);
      // Each reference's number (by its place among the references), once its definition has arrived.
      const layout = new MessageLayout(prefix, 60, DEFAULT_GLYPHS, undefined, false);
      const { refs, definitions, footnoteOrder } = layout.prepared;
      refs.forEach((ref, i) => {
        if (!definitions.has(ref.key)) return;
        const n = superscriptNumber(footnoteOrder.indexOf(ref.key) + 1);
        const before = seen.get(i);
        if (before !== undefined) expect(`${i}: ${n}`).toBe(`${i}: ${before}`);
        seen.set(i, n);
      });
      // What is drawn agrees with those numbers: each defined reference's number, in order.
      const wanted = refs.filter((ref) => definitions.has(ref.key)).map((ref) => superscriptNumber(footnoteOrder.indexOf(ref.key) + 1));
      expect(refNumbers(prefix)).toEqual(wanted);
    }
    expect(seen.size).toBeGreaterThan(0);
  }

  // CPU-bound, with no wait to fix: about 2.2 s alone on a quiet machine (18 October 2026), 5.2 s in
  // a `--parallel=24` run, past Bun's default 5 s. The timeout is well above the worst seen under
  // load (parallel-tests D4; docs/mvp-notes/parallel-tests.md).
  test("the markdown gallery in 7- and 50-character chunks (fake-agent's `--chunk`)", () => {
    for (const chunk of [7, 50]) streamed(gallerySource(), chunk);
  }, 20000);

  test("definitions arriving in the reverse order of their references", () => {
    const source = "a[^b] b[^a] c[^b] d[^a].\n\n[^a]: Defined first, referenced second.\n[^b]: Defined second, referenced first.";
    streamed(source, 3);
    expect(refNumbers(source)).toEqual(["¹", "²", "¹", "²"]);
  });
});
