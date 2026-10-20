// Code scope tokens (mvp-rendering task 8.3; spec tui-theme "Code scope tokens"): highlight
// captures resolve to the fourteen `code.*` tokens by their first segment that names one.
import { describe, expect, test } from "bun:test";
import { CODE_SCOPE_SEGMENTS, codeScopeToken, codeToken } from "./code.ts";
import { DEFAULT_THEME } from "./default-theme.ts";
import { resolveTheme } from "./resolve.ts";
import { TOKEN_NAMES } from "./tokens.ts";

const CODE_TOKENS = TOKEN_NAMES.filter((n) => n.startsWith("code."));

describe("Code scope tokens", () => {
  test("there are fourteen code tokens, and every one but code.default is some segment's", () => {
    expect(CODE_TOKENS).toHaveLength(14);
    const mapped = new Set(CODE_SCOPE_SEGMENTS.values());
    for (const name of CODE_TOKENS) if (name !== "code.default") expect(mapped.has(name), name).toBe(true);
    for (const token of mapped) expect(CODE_TOKENS as string[]).toContain(token);
  });

  test("Scope fallback: keyword.control.return is drawn in code.keyword", () => {
    expect(codeToken("keyword.control.return")).toBe("code.keyword");
    expect(codeToken("keyword")).toBe("code.keyword");
    expect(codeToken("function.method.call")).toBe("code.function");
    expect(codeToken("variable.builtin")).toBe("code.variable");
    expect(codeToken("string.special.url")).toBe("code.string");
    expect(codeToken("punctuation.bracket")).toBe("code.punctuation");
    // Aliases the bundled queries use.
    expect(codeToken("boolean")).toBe("code.constant");
    expect(codeToken("float")).toBe("code.number");
    expect(codeToken("constructor")).toBe("code.type");
    expect(codeToken("field")).toBe("code.property");
  });

  test("Unknown scope: label is drawn in code.default, which is the terminal's default foreground, never an explicit white", () => {
    expect(codeScopeToken("label")).toBeNull();
    expect(codeToken("label")).toBe("code.default");
    expect(codeToken("spell")).toBe("code.default");
    // Object.prototype names are not segments.
    expect(codeScopeToken("toString")).toBeNull();
    expect(codeScopeToken("hasOwnProperty.x")).toBeNull();
    const theme = resolveTheme(DEFAULT_THEME, { terminal: { foreground: "#bcbec4", background: "#191a1c" } });
    const fg = theme.color("code.default");
    expect(fg.intent).toBe("default");
  });

  test("variables keep the default colour in their own token (design decision 8, spec 'PHP without the tag')", () => {
    expect(codeToken("variable")).toBe("code.variable");
    expect(DEFAULT_THEME.tokens["code.variable"]).toBe("default");
  });
});
