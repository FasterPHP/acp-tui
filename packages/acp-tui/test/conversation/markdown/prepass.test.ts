// The source pre-pass (mvp-rendering task 7.1, design decision 2): maths spans and footnote
// references outside code become placeholders, footnote definitions move to a side table, and
// agent private-use characters are escaped so a placeholder cannot be forged.
import { describe, expect, test } from "bun:test";
import {
  PLACEHOLDER_OPEN,
  prepass,
  restoreSource,
  splitPlaceholders,
  type Placeholder,
  type Prepared,
} from "../../../src/conversation/markdown/prepass.ts";

const placeholders = (text: string, p: Prepared) => splitPlaceholders(text, p).filter((x): x is Placeholder => typeof x !== "string");
const maths = (source: string) => prepass(source).maths.map((m) => m.tex);

describe("maths detection", () => {
  test("inline dollars, with no space inside the delimiters", () => {
    expect(maths("energy $E = mc^2$ here")).toEqual(["E = mc^2"]);
    expect(maths("$\\alpha \\le \\beta^2$")).toEqual(["\\alpha \\le \\beta^2"]);
    expect(maths("a $ spaced$ and $spaced $ b")).toEqual([]);
  });

  test("prices stay text (no digit after the closing dollar)", () => {
    const p = prepass("prices $5 and $10 that are not maths");
    expect(p.maths).toEqual([]);
    expect(p.source).toBe("prices $5 and $10 that are not maths");
  });

  test("a dollar run, an escaped dollar and a closing dollar before a digit are not maths", () => {
    expect(maths("costs $$ and \\$x$ and $y$5")).toEqual([]);
  });

  test("two spans on a line are two placeholders in order", () => {
    const p = prepass("$a_1$ and $b_2$");
    expect(p.maths.map((m) => m.raw)).toEqual(["$a_1$", "$b_2$"]);
    expect(placeholders(p.source, p).map((x) => x.kind)).toEqual(["math", "math"]);
    expect(p.source.replace(/\uE000[^\uE001]*\uE001/g, "#")).toBe("# and #");
  });

  test("inline parentheses", () => {
    const p = prepass("inline parentheses \\(a^2 + b^2 = c^2\\), done");
    expect(p.maths).toEqual([{ tex: "a^2 + b^2 = c^2", display: false, raw: "\\(a^2 + b^2 = c^2\\)" }]);
  });

  test("block maths on their own lines, in both forms", () => {
    const p = prepass("Before:\n\n$$\n\\sum_{i=1}^{n} i\n$$\n\n\\[\n\\int_0^\\infty x\n\\]\n\nAfter.");
    expect(p.maths).toEqual([
      { tex: "\\sum_{i=1}^{n} i", display: true, raw: "$$\n\\sum_{i=1}^{n} i\n$$" },
      { tex: "\\int_0^\\infty x", display: true, raw: "\\[\n\\int_0^\\infty x\n\\]" },
    ]);
    expect(p.source.split("\n").length).toBe(7);
  });

  test("a one-line block and a block inside a quote", () => {
    const p = prepass("$$ x^2 $$\n\n> $$\n> y\n> $$");
    expect(p.maths.map((m) => [m.tex, m.display])).toEqual([
      ["x^2", true],
      ["y", true],
    ]);
    expect(p.source.startsWith("> " + PLACEHOLDER_OPEN) || p.source.split("\n")[2]!.startsWith(">")).toBe(true);
  });

  test("an unclosed block stays text", () => {
    expect(maths("$$\n\\sum i\n")).toEqual([]);
  });

  test("nothing inside code spans or fences", () => {
    const source = "`$x$` and ``$y$ ` `` then\n\n```tex\n$z$ [^1]\n$$\nw\n$$\n```\n\n~~~\n\\(q\\)\n~~~";
    const p = prepass(source);
    expect(p.maths).toEqual([]);
    expect(p.refs).toEqual([]);
    expect(p.source).toBe(source);
  });

  test("a fence inside a quote is code too", () => {
    expect(maths("> ```\n> $x$\n> ```\n\n$y$")).toEqual(["y"]);
  });

  test("an unclosed fence runs to the end (a streamed message opening with a fence)", () => {
    expect(maths("```php\n$x = $y;\n$z$")).toEqual([]);
  });
});

describe("footnotes", () => {
  const gallery = "a numbered footnote[^1] and a named one[^note].\n\n[^1]: The first footnote definition.\n[^note]: A named footnote, with **bold** text.\n\nAfter.";

  test("references become placeholders and definitions move to the side table", () => {
    const p = prepass(gallery);
    expect(p.refs.map((r) => r.raw)).toEqual(["[^1]", "[^note]"]);
    expect(p.footnoteOrder).toEqual(["1", "note"]);
    expect([...p.definitions.values()].map((d) => [d.label, d.text])).toEqual([
      ["1", "The first footnote definition."],
      ["note", "A named footnote, with **bold** text."],
    ]);
    expect(p.source).not.toContain("[^");
    expect(p.source).not.toContain("definition");
    // The definitions are drawn where the source's last paragraph, a section placeholder, stands.
    const lines = p.source.split("\n");
    expect(lines.at(-3)).toBe("After.");
    expect(lines.at(-2)).toBe("");
    expect(splitPlaceholders(lines.at(-1)!, p)).toEqual([{ kind: "section" }]);
  });

  test("no section while the source ends inside a fence", () => {
    const p = prepass("a[^1]\n\n[^1]: one\n\n```php\n$x = 1;");
    expect(p.definitions.size).toBe(1);
    expect(p.source.endsWith("$x = 1;")).toBe(true);
  });

  test("order of first reference, labels matched without case", () => {
    const p = prepass("x[^B] y[^a] z[^b]\n\n[^a]: A\n[^b]: B");
    expect(p.footnoteOrder).toEqual(["b", "a"]);
    expect(p.refs.map((r) => r.key)).toEqual(["b", "a", "b"]);
    expect(p.definitions.get("b")?.text).toBe("B");
  });

  test("a reference without a definition is still a placeholder (the renderer keeps it literal)", () => {
    const p = prepass("see [^x]");
    expect(p.refs).toEqual([{ label: "x", key: "x", raw: "[^x]" }]);
    expect(p.definitions.size).toBe(0);
    expect(restoreSource(p.source, p)).toBe("see [^x]");
  });

  test("continuation lines and indented paragraphs belong to the definition", () => {
    const p = prepass("t[^1]\n\n[^1]: First line\n  lazy second\n\n    Second paragraph $x$.\n\nNot part.");
    expect(p.definitions.get("1")?.text.replace(/\uE000[^\uE001]*\uE001/g, "#")).toBe("First line\nlazy second\n\nSecond paragraph #.");
    expect(p.maths.map((m) => m.tex)).toEqual(["x"]);
    expect(restoreSource(p.source, p).trim().endsWith("Not part.")).toBe(true);
  });

  test("numbers are stable while the message streams", () => {
    const whole = "one[^a] two[^b] three[^c]\n\n[^c]: C\n[^b]: B\n[^a]: A";
    for (let n = 1; n <= whole.length; n++) {
      const p = prepass(whole.slice(0, n));
      expect(whole.slice(0, n).startsWith("one[^a]") ? p.footnoteOrder[0] : "a").toBe("a");
      const full = prepass(whole);
      expect(full.footnoteOrder.slice(0, p.footnoteOrder.length)).toEqual([...p.footnoteOrder]);
    }
  });
});

describe("restoring the source", () => {
  test("restoreSource undoes every placeholder", () => {
    const source = "m $x^2$ \\(y\\) f[^1] and \uE000\uE003\uE010\uE001 forged\n\n$$\nz\n$$";
    const p = prepass(source);
    expect(restoreSource(p.source, p)).toBe(source);
  });
});

// A seeded generator, so a failure reproduces.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("forged placeholders (fuzz)", () => {
  // The characters a forgery needs, other private-use characters, and Markdown around them.
  const pua = ["\uE000", "\uE001", "\uE002", "\uE003", "\uE004", "\uE005", "\uE010", "\uE011", "\uE01F", "\uE020", "\uF8FF", "\uE100"];
  const syntax = ["$", "$$", "\\(", "\\)", "[^", "]", "`", "\n", "\n\n", " ", "x", "1", "*", "> ", "```\n", ":", "\\"];

  test("random private-use runs in agent text never become placeholders", () => {
    const random = rng(20261008);
    for (let round = 0; round < 3000; round++) {
      let text = "";
      const parts = 1 + Math.floor(random() * 30);
      for (let k = 0; k < parts; k++) {
        const pool = random() < 0.6 ? pua : syntax;
        text += pool[Math.floor(random() * pool.length)];
      }
      const p = prepass(text);
      const agentPrivate = [...text].filter((ch) => ch >= "\uE000" && ch <= "\uF8FF");
      const found = placeholders(p.source, p);
      // Every private-use character the agent sent comes back: as a literal placeholder in the
      // lexed text (the source and the definitions), or as itself in maths and references, which
      // are never lexed...
      const defined = [...p.definitions.values()].flatMap((d) => placeholders(d.text, p));
      const literals = [...found, ...defined].filter((x) => x.kind === "literal").length;
      const unlexed = [...p.maths.map((m) => m.raw), ...p.refs.map((r) => r.raw)].join("");
      expect(literals + [...unlexed].filter((ch) => ch >= "\uE000" && ch <= "\uF8FF").length).toBe(agentPrivate.length);
      if (p.maths.length === 0 && p.refs.length === 0 && p.definitions.size === 0) {
        expect(found.map((x) => (x as { char: string }).char)).toEqual(agentPrivate);
      }
      // ...every other placeholder is one the pass made...
      expect([...found, ...defined].filter((x) => x.kind === "math").length).toBe(p.maths.length);
      expect([...found, ...defined].filter((x) => x.kind === "footnote").length).toBe(p.refs.length);
      // ...and no private-use character is left outside a placeholder.
      const rest = [p.source, ...[...p.definitions.values()].map((d) => d.text)].join("\n").replace(/\uE000[\uE002-\uE005][\uE010-\uE01F]+\uE001/g, "");
      expect(/[\uE000-\uF8FF]/.test(rest)).toBe(false);
      // Without definitions, the pass is exactly reversible.
      if (p.definitions.size === 0) expect(restoreSource(p.source, p)).toBe(text.replace(/\r\n?/g, "\n"));
    }
  });
});
