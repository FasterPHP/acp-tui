// The maths converter (mvp-rendering task 7.5, design decision 7; spec
// tui-rendering "Maths as best-effort Unicode"; audit section 8). LaTeX from a
// maths span the pre-pass found (conversation/markdown/prepass.ts) to plain
// Unicode text for a terminal cell grid, from the generated symbol table
// (latex-symbols.ts, from unicode2latex; unicodeit's approach was a reference
// only).
//
// What converts:
//
// - Symbols, Greek letters, operators, arrows and delimiters (`SYMBOLS`),
//   upright operator names (`\sin`, `\lim`), spacing commands, `\left` and
//   `\right` (dropped, their delimiter kept), `\text{...}` and the font
//   commands that only change the face (`\mathrm`, `\mathbf`, ...).
// - `\mathbb{X}` for the letters with a double-struck form in the Basic
//   Multilingual Plane: C, H, N, P, Q, R and Z (`ℂ ℍ ℕ ℙ ℚ ℝ ℤ`). They are in
//   JetBrains Mono, not in Lilex, so Zed takes them from a fallback font, as it
//   does `∈` or `∀`. The other letters and the digits exist only outside the
//   BMP (Mathematical Alphanumeric Symbols), in neither font, so they fall back.
// - Superscripts and subscripts only where every character has a form in both
//   fonts, which is the digits alone (`⁰` to `⁹`, `₀` to `₉`; checked with
//   tools/glyph-check.py against JetBrains Mono and Lilex: `⁺ ⁼` are in
//   JetBrains Mono only, the signs, brackets and letters in neither). Also
//   `^\circ` as `°` and `^\prime` (or `'`) as `′`, both in both fonts.
// - `\frac{a}{b}` as `a/b`, an operand in parentheses when it is compound
//   (`(x+1)/2`); `\sqrt{x}` as `√x` or `√(x+y)`, `\sqrt[3]{x}` as `³√x`.
// - Accents only where Unicode has the accented letter precomposed in Latin-1
//   or Latin Extended-A (`\hat{a}` is `â`): a combining mark on its own may
//   take a cell of its own in JediTerm (unverified, as for U+0336), so `\hat{x}`
//   falls back.
//
// Fallback is per fragment, then per span. A script or accent that cannot be
// drawn exactly keeps its LaTeX form around converted content: `x^{k+1}` is
// `x^(k+1)`, `a_{ij}` is `a_(ij)`, `e^{-x^2}` is `e^(-x²)`. Anything else the
// converter does not know (a macro outside the table, an environment, `&`,
// an unbalanced brace) makes `convertMath` return null, and the caller shows
// the whole span's source instead.
import { ACCENTS, BLACKBOARD, OPERATOR_NAMES, SPACES, SUBSCRIPTS, SUPERSCRIPTS, SYMBOLS } from "./latex-symbols.ts";
import { displayWidth } from "../../layout/segments.ts";

/** The span cannot be converted (see the module header). */
class Unconvertible extends Error {}

/** `\mathbb` letters drawn: those in the BMP (see the module header). */
const BLACKBOARD_LETTERS = new Set(["C", "H", "N", "P", "Q", "R", "Z"]);

/** Characters whose super- or subscript form is in both fonts: the digits. */
const SCRIPT_SAFE = new Set(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);

/** Commands that only change the face: their argument is converted as maths. */
const FACES = new Set(["mathrm", "mathbf", "mathit", "mathsf", "mathtt", "boldsymbol", "bm", "mathnormal", "operatorname"]);
/** Commands whose argument is text, kept as written. */
const TEXTS = new Set(["text", "textrm", "textbf", "textit", "textsf", "texttt", "textnormal", "mbox", "hbox"]);
/** Commands drawn as nothing. */
const IGNORED = new Set(["displaystyle", "textstyle", "scriptstyle", "scriptscriptstyle", "limits", "nolimits", "left", "right", "middle", "big", "Big", "bigg", "Bigg", "bigl", "bigr", "Bigl", "Bigr", "biggl", "biggr", "Biggl", "Biggr"]);
const FRACTIONS = new Set(["frac", "dfrac", "tfrac", "cfrac"]);
const OPERATORS = new Set(OPERATOR_NAMES);

/** Characters an operand may hold and still be written without parentheses around it. */
const SIMPLE = /^[\p{L}\p{N}\p{M}.!∞∂√′″°]*$/u;

/** Whether `text` reads as one operand: no space, operator or sign outside its brackets. */
export function simpleOperand(text: string): boolean {
  let depth = 0;
  let outside = "";
  for (const ch of text) {
    if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") {
      depth -= 1;
      if (depth < 0) return false;
    } else if (depth === 0) outside += ch;
  }
  return depth === 0 && outside !== "" && SIMPLE.test(outside);
}

/** `text` in parentheses unless it is a simple operand. */
function operand(text: string): string {
  return simpleOperand(text) ? text : `(${text})`;
}

/** One grapheme (so a script needs no parentheses in its fallback). */
function single(text: string): boolean {
  return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].length === 1;
}

class Parser {
  private at = 0;

  constructor(private readonly src: string) {}

  /** Converted text up to the end, or up to the closing brace of a group when `group`. */
  sequence(group: boolean): string {
    let out = "";
    while (this.at < this.src.length) {
      const c = this.src[this.at]!;
      if (c === "}") {
        if (!group) throw new Unconvertible();
        return out;
      }
      if (c === " " || c === "\t" || c === "\n") {
        let k = this.at;
        let newline = false;
        while (k < this.src.length && /[ \t\n]/.test(this.src[k]!)) {
          if (this.src[k] === "\n") newline = true;
          k += 1;
        }
        this.at = k;
        // Source spaces are one space, and none after a space already drawn (`\text{if } x`).
        if (newline) out += "\n";
        else if (!out.endsWith(" ")) out += " ";
        continue;
      }
      if (c === "^" || c === "_") {
        this.at += 1;
        out += this.script(c);
        continue;
      }
      out += this.atom();
    }
    if (group) throw new Unconvertible();
    return out;
  }

  private skipSpaces(): void {
    while (this.at < this.src.length && /[ \t\n]/.test(this.src[this.at]!)) this.at += 1;
  }

  /** The argument of a command or script: a group, a command, or one character. */
  argument(): string {
    this.skipSpaces();
    if (this.at >= this.src.length) throw new Unconvertible();
    const c = this.src[this.at]!;
    if (c === "^" || c === "_" || c === "}" || c === "&") throw new Unconvertible();
    return this.atom();
  }

  /** A group's raw source (for `\text`), braces excluded. */
  private rawGroup(): string {
    this.skipSpaces();
    if (this.src[this.at] !== "{") throw new Unconvertible();
    let depth = 0;
    for (let k = this.at; k < this.src.length; k++) {
      const ch = this.src[k]!;
      if (ch === "\\") {
        k += 1;
        continue;
      }
      if (ch === "{") depth += 1;
      else if (ch === "}" && --depth === 0) {
        const raw = this.src.slice(this.at + 1, k);
        this.at = k + 1;
        return raw;
      }
    }
    throw new Unconvertible();
  }

  /** One atom: a group, a command, or a character. */
  atom(): string {
    const c = this.src[this.at]!;
    if (c === "{") {
      this.at += 1;
      const inner = this.sequence(true);
      this.at += 1;
      return inner;
    }
    if (c === "\\") return this.command();
    this.at += 1;
    if (c === "&" || c === "#" || c === "%") throw new Unconvertible();
    if (c === "~") return " ";
    if (c === "'") return "′";
    return c;
  }

  /** A script after `^` or `_` (see the module header). */
  private script(kind: "^" | "_"): string {
    this.skipSpaces();
    // `^\circ` (degrees) and `^\prime` have forms of their own.
    if (kind === "^" && /^\\circ(?![a-zA-Z])/.test(this.src.slice(this.at))) {
      this.at += 5;
      return "°";
    }
    if (kind === "^" && /^\\prime(?![a-zA-Z])/.test(this.src.slice(this.at))) {
      this.at += 6;
      return "′";
    }
    const text = this.argument();
    const forms = kind === "^" ? SUPERSCRIPTS : SUBSCRIPTS;
    const chars = [...text];
    if (chars.length > 0 && chars.every((ch) => SCRIPT_SAFE.has(ch) && forms[ch] !== undefined)) return chars.map((ch) => forms[ch]!).join("");
    if (text === "") throw new Unconvertible();
    return kind + (single(text) ? text : `(${text})`);
  }

  /** A command after a backslash. */
  private command(): string {
    const rest = this.src.slice(this.at);
    const word = /^\\([a-zA-Z]+)/.exec(rest);
    if (!word) {
      // A control symbol: `\,`, `\{`, `\|`, ...
      const sym = rest.slice(0, 2);
      this.at += sym.length;
      if (SPACES[sym] !== undefined) return SPACES[sym]!;
      if (SYMBOLS[sym] !== undefined) return SYMBOLS[sym]!;
      throw new Unconvertible();
    }
    const name = word[1]!;
    this.at += word[0].length;
    if (IGNORED.has(name)) {
      // `\left.` and `\right.` stand for no delimiter.
      if ((name === "left" || name === "right" || name === "middle") && this.src[this.at] === ".") this.at += 1;
      return "";
    }
    if (FRACTIONS.has(name)) {
      const num = this.argument();
      const den = this.argument();
      return `${operand(num)}/${operand(den)}`;
    }
    if (name === "sqrt") {
      let index = "";
      this.skipSpaces();
      if (this.src[this.at] === "[") {
        const close = this.src.indexOf("]", this.at);
        const n = close < 0 ? "" : this.src.slice(this.at + 1, close).trim();
        if (!/^\d+$/.test(n)) throw new Unconvertible();
        index = [...n].map((d) => SUPERSCRIPTS[d]!).join("");
        this.at = close + 1;
      }
      return `${index}√${operand(this.argument())}`;
    }
    if (name === "mathbb") {
      const letter = this.argument();
      if (BLACKBOARD_LETTERS.has(letter) && BLACKBOARD[letter] !== undefined) return BLACKBOARD[letter]!;
      return `\\mathbb{${letter}}`;
    }
    if (FACES.has(name)) return this.argument();
    if (TEXTS.has(name)) return this.rawGroup();
    if (name === "bmod") return "mod";
    if (name === "pmod") return `(mod ${this.argument()})`;
    if (ACCENTS[`\\${name}`] !== undefined) {
      const base = this.argument();
      const composed = (base + ACCENTS[`\\${name}`]!).normalize("NFC");
      const cp = composed.codePointAt(0)!;
      if ([...composed].length === 1 && cp >= 0xc0 && cp <= 0x17f) return composed;
      return `\\${name}{${base}}`;
    }
    if (OPERATORS.has(name)) return name;
    const key = `\\${name}`;
    if (SPACES[key] !== undefined) return SPACES[key]!;
    const symbol = SYMBOLS[key];
    // Two symbols in the table are emoji-width squares: not drawn.
    if (symbol !== undefined && displayWidth(symbol) === 1) return symbol;
    throw new Unconvertible();
  }
}

/**
 * `tex` (a maths span's LaTeX, delimiters removed) as Unicode text, its source lines kept as lines;
 * null when the span holds something the converter does not know (see the module header).
 */
export function convertMath(tex: string): string | null {
  try {
    const text = new Parser(tex).sequence(false);
    return text
      .split("\n")
      .map((line) => line.trim())
      .join("\n")
      .trim();
  } catch (e) {
    if (e instanceof Unconvertible) return null;
    throw e;
  }
}
