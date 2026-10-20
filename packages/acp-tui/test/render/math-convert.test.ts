// The maths converter (mvp-rendering task 7.5; spec tui-rendering "Maths as best-effort
// Unicode"): symbols, Greek, operators, blackboard letters, digit scripts, fractions and roots,
// with per-fragment fallback to the LaTeX form and per-span fallback to the source.
import { describe, expect, test } from "bun:test";
import { DEFAULT_GLYPHS } from "../../src/conversation/glyphs.ts";
import { MATH_INDENT } from "../../src/conversation/markdown/inline.ts";
import { MessageLayout } from "../../src/conversation/markdown/layout.ts";
import { projectMessage } from "../../src/conversation/markdown/project.ts";
import { rowText, type Row } from "../../src/conversation/markdown/types.ts";
import { convertMath, simpleOperand } from "../../src/render/math/convert.ts";

function rows(source: string, width = 60): Row[] {
  return new MessageLayout(source, width, DEFAULT_GLYPHS, undefined, false).blocks().flatMap((b) => [...b.rows]);
}

describe("convertMath", () => {
  test("symbols, Greek letters, operators and operator names", () => {
    expect(convertMath("\\alpha \\le \\beta^2")).toBe("α ≤ β²");
    expect(convertMath("E = mc^2")).toBe("E = mc²");
    expect(convertMath("\\sin x + \\log_2 n \\to \\infty")).toBe("sin x + log₂ n → ∞");
    expect(convertMath("a \\times b \\ne c \\cdot d \\pm e")).toBe("a × b ≠ c · d ± e");
    expect(convertMath("\\forall x \\in A, \\exists y")).toBe("∀ x ∈ A, ∃ y");
  });

  test("blackboard letters only where the BMP has them (C, H, N, P, Q, R, Z); the others keep their source", () => {
    expect(["C", "H", "N", "P", "Q", "R", "Z"].map((l) => convertMath(`\\mathbb{${l}}`)).join(" ")).toBe("ℂ ℍ ℕ ℙ ℚ ℝ ℤ");
    expect(convertMath("\\mathbb{A}")).toBe("\\mathbb{A}");
    expect(convertMath("\\mathbb{1}")).toBe("\\mathbb{1}");
    expect(convertMath("x \\in \\mathbb R")).toBe("x ∈ ℝ");
  });

  test("scripts: digits only (the forms in both fonts); anything else keeps its LaTeX form around converted content", () => {
    expect(convertMath("x^{10} + y_{23}")).toBe("x¹⁰ + y₂₃");
    expect(convertMath("x^{k+1}")).toBe("x^(k+1)");
    expect(convertMath("a_{ij}")).toBe("a_(ij)");
    expect(convertMath("x^n")).toBe("x^n");
    expect(convertMath("x^{-1}")).toBe("x^(-1)");
    expect(convertMath("e^{-x^2}")).toBe("e^(-x²)");
    expect(convertMath("x^{+}")).toBe("x^+");
    expect(convertMath("90^\\circ")).toBe("90°");
    expect(convertMath("f'(x) = g^\\prime")).toBe("f′(x) = g′");
  });

  test("fractions as a slash, operands in parentheses when compound", () => {
    expect(convertMath("\\frac{a}{b}")).toBe("a/b");
    expect(convertMath("\\frac12")).toBe("1/2");
    expect(convertMath("\\frac{a+b}{c}")).toBe("(a+b)/c");
    expect(convertMath("\\frac{n(n+1)}{2}")).toBe("n(n+1)/2");
    expect(convertMath("\\frac{\\sqrt{\\pi}}{2}")).toBe("√π/2");
    expect(convertMath("\\dfrac{-b \\pm \\sqrt{b^2-4ac}}{2a}")).toBe("(-b ± √(b²-4ac))/2a");
    expect(simpleOperand("x²")).toBe(true);
    expect(simpleOperand("-x")).toBe(false);
    expect(simpleOperand("a b")).toBe(false);
  });

  test("roots with √, an index in superscript digits", () => {
    expect(convertMath("\\sqrt{x}")).toBe("√x");
    expect(convertMath("\\sqrt{x^2 + y^2}")).toBe("√(x² + y²)");
    expect(convertMath("\\sqrt[3]{8}")).toBe("³√8");
  });

  test("accents only as precomposed Latin letters; otherwise the fragment's source", () => {
    expect(convertMath("\\hat{a} + \\tilde{n} + \\ddot{u}")).toBe("â + ñ + ü");
    expect(convertMath("\\hat{x}")).toBe("\\hat{x}");
  });

  test("delimiters, \\left and \\right, spacing, text and faces", () => {
    expect(convertMath("\\left( a \\right)")).toBe("( a )");
    expect(convertMath("\\left\\{ x \\right.")).toBe("{ x");
    expect(convertMath("\\langle u, v \\rangle")).toBe("⟨ u, v ⟩");
    expect(convertMath("a\\,b\\quad c\\!d")).toBe("a b  cd");
    expect(convertMath("\\text{if } x > 0")).toBe("if x > 0");
    expect(convertMath("\\mathbf{v} = \\mathrm{d}x")).toBe("v = dx");
    expect(convertMath("a \\equiv b \\pmod{n}")).toBe("a ≡ b (mod n)");
  });

  test("source lines stay lines", () => {
    expect(convertMath("a = 1\nb = 2")).toBe("a = 1\nb = 2");
  });

  test("anything unknown makes the whole span unconvertible", () => {
    for (const tex of ["\\begin{pmatrix} a \\\\ b \\end{pmatrix}", "\\unknown{x}", "a & b", "\\frac{a}", "{x", "x}", "x^", "\\mathcal{L}", "\\vec{v}", "\\\\"]) {
      expect(convertMath(tex)).toBeNull();
    }
  });

  test("no output character is U+2013 or U+2014", () => {
    for (const tex of ["a - b", "\\frac{-1}{2}", "x^{-1}"]) expect(convertMath(tex)).not.toMatch(/[\u2013\u2014]/);
  });
});

describe("Maths as best-effort Unicode", () => {
  test("Inline maths: `$\\alpha \\le \\beta^2$` shows `α ≤ β²` in the maths token, with no dollar signs", () => {
    const drawn = rows("so $\\alpha \\le \\beta^2$ holds");
    expect(drawn.map(rowText)).toEqual(["so α ≤ β² holds"]);
    expect(drawn[0]!.spans.find((s) => s.text === "α ≤ β²")!.token).toBe("markdown.math");
  });

  test("Prices stay text: `prices $5 and $10` unchanged", () => {
    const drawn = rows("prices $5 and $10");
    expect(drawn.map(rowText)).toEqual(["prices $5 and $10"]);
    expect(drawn[0]!.spans.every((s) => s.token === "text")).toBe(true);
  });

  test("Unknown environment: a `$$` block holding `\\begin{pmatrix}` shows its source, indented, in the code token", () => {
    const source = "$$\n\\begin{pmatrix} a & b \\end{pmatrix}\n$$";
    const drawn = rows(source);
    const indent = " ".repeat(MATH_INDENT);
    expect(drawn.map(rowText)).toEqual([`${indent}$$`, `${indent}\\begin{pmatrix} a & b \\end{pmatrix}`, `${indent}$$`]);
    for (const row of drawn) {
      expect(row.spans[0]).toMatchObject({ text: indent, projection: "" });
      expect(row.spans[1]!.token).toBe("markdown.code");
    }
  });

  test("an unknown macro in an inline span: the span's source in the code token", () => {
    const drawn = rows("see $\\vec{v}$ here");
    expect(drawn.map(rowText)).toEqual(["see $\\vec{v}$ here"]);
    expect(drawn[0]!.spans.find((s) => s.text === "$\\vec{v}$")!.token).toBe("markdown.code");
  });

  test("block maths is indented, one converted line per source line", () => {
    const drawn = rows("\\[\n\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}\n\\]");
    expect(drawn.map(rowText)).toEqual(["  ∫₀^∞ e^(-x²) dx = √π/2"]);
    expect(drawn[0]!.spans[1]!.token).toBe("markdown.math");
  });

  test("the projection holds maths as drawn, without the block indent", () => {
    expect(projectMessage("x $\\alpha$ y\n\n$$\na^2\n$$", DEFAULT_GLYPHS, false).text).toBe("x α y\n\na²");
    expect(projectMessage("***x*** &copy; $\\alpha$", DEFAULT_GLYPHS, false).text).toBe("x © α");
  });
});
