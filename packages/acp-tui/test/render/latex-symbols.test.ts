import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { generate, OUTPUT_PATH } from "../../scripts/build-latex-symbols.ts";
import { ACCENTS, BLACKBOARD, OPERATOR_NAMES, SPACES, SUBSCRIPTS, SUPERSCRIPTS, SYMBOLS } from "../../src/render/math/latex-symbols.ts";

describe("LaTeX symbol table (mvp-rendering task 7.4)", () => {
  test("the committed module is exactly what the generator writes, and the generator is reproducible byte for byte", async () => {
    const first = await generate();
    const second = await generate();
    expect(second).toBe(first);
    expect(await readFile(OUTPUT_PATH, "utf8")).toBe(first);
  });

  test("the module is ASCII, carries the ISC notice, and has no en or em dash", async () => {
    const text = await readFile(OUTPUT_PATH, "utf8");
    expect(/[^\x00-\x7f]/.test(text)).toBe(false);
    expect(text).toContain("ISC License");
    expect(text).toContain("Copyright (c) Emiliano Heyns");
    expect(text).toContain("unicode2latex 7.0.35");
    for (const table of [SYMBOLS, BLACKBOARD, SUPERSCRIPTS, SUBSCRIPTS, ACCENTS, SPACES]) {
      for (const value of Object.values(table)) expect(/[\u2013\u2014]/.test(value)).toBe(false);
    }
  });

  test("symbols, Greek letters and operators", () => {
    expect(SYMBOLS["\\alpha"]).toBe("α");
    expect(SYMBOLS["\\beta"]).toBe("β");
    expect(SYMBOLS["\\Omega"]).toBe("Ω");
    expect(SYMBOLS["\\le"]).toBe("≤");
    expect(SYMBOLS["\\leq"]).toBe("≤");
    expect(SYMBOLS["\\neq"]).toBe("≠");
    expect(SYMBOLS["\\times"]).toBe("×");
    expect(SYMBOLS["\\sqrt"]).toBe("√");
    expect(SYMBOLS["\\infty"]).toBe("∞");
    expect(SYMBOLS["\\to"]).toBe("→");
    expect(SYMBOLS["\\sum"]).toBe("∑");
    // Normalised: the table's italic mu and bold nabla are the plain characters.
    expect(SYMBOLS["\\mu"]).toBe("μ");
    expect(SYMBOLS["\\nabla"]).toBe("∇");
    // Chosen for terminal fonts (U+22C5 is in neither JetBrains Mono nor Lilex).
    expect(SYMBOLS["\\cdot"]).toBe("·");
    expect(SYMBOLS["\\implies"]).toBe("⇒");
    // Font-style variants and text-mode commands are not symbols.
    expect(SYMBOLS["\\mbfA"]).toBeUndefined();
    expect(SYMBOLS["\\textbullet"]).toBeUndefined();
    expect(SYMBOLS["\\steaming"]).toBeUndefined();
  });

  test("blackboard bold covers A to Z, a to z and 0 to 9", () => {
    expect(BLACKBOARD["R"]).toBe("ℝ");
    expect(BLACKBOARD["N"]).toBe("ℕ");
    expect(BLACKBOARD["Z"]).toBe("ℤ");
    expect(Object.keys(BLACKBOARD)).toHaveLength(62);
  });

  test("superscript and subscript forms exist for digits and signs", () => {
    expect(SUPERSCRIPTS["2"]).toBe("²");
    expect(SUPERSCRIPTS["n"]).toBe("ⁿ");
    expect(SUPERSCRIPTS["+"]).toBe("⁺");
    expect(SUBSCRIPTS["0"]).toBe("₀");
    expect(SUBSCRIPTS["i"]).toBeUndefined();
  });

  test("accents are combining marks, operator names and spaces are text", () => {
    expect(ACCENTS["\\hat"]).toBe("\u0302");
    expect(ACCENTS["\\tilde"]).toBe("\u0303");
    expect(ACCENTS["\\dot"]).toBe("\u0307");
    expect(OPERATOR_NAMES).toContain("sin");
    expect(OPERATOR_NAMES).toContain("lim");
    expect(SPACES["\\,"]).toBe(" ");
    expect(SPACES["\\!"]).toBe("");
  });

  test("unicode2latex is not a run-time dependency: nothing under src imports it", async () => {
    const stack = [join(import.meta.dir, "../../src")];
    const pkg = JSON.parse(await readFile(join(import.meta.dir, "../../package.json"), "utf8")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(pkg.dependencies["unicode2latex"]).toBeUndefined();
    expect(pkg.devDependencies["unicode2latex"]).toBe("7.0.35");
    while (stack.length > 0) {
      const dir = stack.pop()!;
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) stack.push(path);
        else if (/\.(ts|tsx)$/.test(entry.name)) expect(await readFile(path, "utf8"), path).not.toMatch(/from\s+["']unicode2latex/);
      }
    }
  });
});
