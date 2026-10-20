// Unit tests for the theme scenarios of spec tui-theme (phase-0 task 6.3; mvp-rendering task 3.1).
// The PTY counterparts are in test/pty/theme.test.ts.
import { describe, expect, test } from "bun:test";
import { RGBA, TextAttributes } from "@opentui/core";
import {
  DEFAULT_THEME,
  SURFACE_NAMES,
  TOKENS,
  TOKEN_NAMES,
  TOOL_KINDS,
  resolveTheme,
  styleColour,
  tokenStyle,
  toolKindToken,
  validateTheme,
  withTokens,
  type TokenName,
} from "./index.ts";

/** A default-theme token's colour on a dark background (references followed). */
const colorOf = (name: TokenName) => tokenStyle(DEFAULT_THEME, name).color;
/** Every colour a default-theme token may take: its dark and, when given, its light colour. */
const coloursOf = (name: TokenName) => {
  const style = tokenStyle(DEFAULT_THEME, name);
  return [styleColour(style, false), styleColour(style, true)];
};
/** Foreground tokens: the text tokens (background tokens are surfaces or plain fills). */
const TEXT_NAMES = TOKEN_NAMES.filter((name) => TOKENS[name].role === "fg");

describe("Default text tokens use only the terminal palette", () => {
  test("every text token maps to an ANSI index 0 to 15 or to default, on dark and light backgrounds, and none to hex", () => {
    expect(TEXT_NAMES.length).toBeGreaterThan(60);
    for (const name of TEXT_NAMES) {
      for (const color of coloursOf(name)) {
        if (color === "default") continue;
        expect(typeof color, name).toBe("number");
        expect(Number.isInteger(color), name).toBe(true);
        expect(color as number, name).toBeGreaterThanOrEqual(0);
        expect(color as number, name).toBeLessThanOrEqual(15);
      }
    }
  });

  test("the mvp-rendering text tokens exist and are text tokens", () => {
    const added = [
      "tool.kind",
      "tool.title",
      "tool.count",
      "tool.duration",
      "tool.index",
      ...TOOL_KINDS.map((k) => `tool.kind.${k}`),
      ...[1, 2, 3, 4, 5, 6].map((n) => `markdown.heading.${n}`),
      "markdown.list",
      "markdown.task.done",
      "markdown.task.open",
      "markdown.table.border",
      "markdown.table.header",
      "markdown.strike",
      "markdown.math",
      ...["note", "tip", "important", "warning", "caution"].map((k) => `markdown.alert.${k}`),
      ...["keyword", "string", "comment", "number", "constant", "type", "function", "variable", "property", "operator", "punctuation", "tag", "attribute", "default"].map((k) => `code.${k}`),
    ];
    expect(added).toHaveLength(5 + 10 + 6 + 7 + 5 + 14);
    for (const name of added) expect(TOKENS[name as TokenName]?.role, name).toBe("fg");
  });

  test("design decisions 8 and 10 and tui-rendering's heading levels are the defaults (dark background)", () => {
    const resolved = resolveTheme(DEFAULT_THEME);
    const of = (name: TokenName) => {
      const { color, attributes } = resolved.token(name);
      return [color.intent === "default" ? "default" : color.slot, attributes];
    };
    const { BOLD, ITALIC, NONE } = TextAttributes;
    // Tool lines: kind cyan, title default, count magenta, duration blue, index bright black.
    expect(["tool.kind", "tool.title", "tool.count", "tool.duration", "tool.index"].map((n) => of(n as TokenName)[0])).toEqual([6, "default", 5, 4, 8]);
    // Headings: 1 to 3 bold accent, 4 bold default, 5 bold italic muted, 6 italic muted.
    expect([1, 2, 3, 4, 5, 6].map((n) => of(`markdown.heading.${n}` as TokenName))).toEqual([
      [4, BOLD],
      [4, BOLD],
      [4, BOLD],
      ["default", BOLD],
      [8, BOLD | ITALIC],
      [8, ITALIC],
    ]);
    // Code: keyword magenta, string green, comment bright black italic, number and constant cyan,
    // type yellow, function blue, tag red, attribute yellow, the rest default.
    expect(of("code.comment")).toEqual([8, ITALIC]);
    expect(
      ["keyword", "string", "number", "constant", "type", "function", "tag", "attribute", "variable", "property", "operator", "punctuation", "default"].map(
        (k) => of(`code.${k}` as TokenName)[0],
      ),
    ).toEqual([5, 2, 6, 6, 3, 4, 1, 3, "default", "default", "default", "default", "default"]);
    expect(of("code.keyword")[1]).toBe(NONE);
    // Alerts: note blue, tip green, important magenta, warning yellow, caution red (audit M24).
    expect(["note", "tip", "important", "warning", "caution"].map((k) => of(`markdown.alert.${k}` as TokenName)[0])).toEqual([4, 2, 5, 3, 1]);
  });

  test("the default theme defines every token and nothing else", () => {
    expect(validateTheme(DEFAULT_THEME)).toEqual([]);
    expect(Object.keys(DEFAULT_THEME.tokens).sort()).toEqual([...TOKEN_NAMES].sort());
  });

  test("resolved text colours carry indexed or default intent, never rgb", () => {
    const theme = resolveTheme(DEFAULT_THEME);
    for (const name of TEXT_NAMES) {
      const { color } = theme.token(name);
      const expected = colorOf(name);
      if (expected === "default") {
        expect(color.intent).toBe("default");
      } else {
        expect(color.intent).toBe("indexed");
        expect(color.slot).toBe(expected as number);
      }
    }
  });

  test("the spec's named tokens exist", () => {
    const named = ["accent", "muted", "user", "agent", "thought", "tool.ok", "tool.fail", "permission", "warning", "danger", "status.fg"];
    for (const name of [...named, ...SURFACE_NAMES]) expect(name in TOKENS).toBe(true);
    for (const name of ["surface.user", "surface.card", "surface.code", "surface.cursor", "surface.selection", "surface.permission", "status.bg", "diff.added.bg", "diff.removed.bg"]) {
      expect(TOKENS[name as keyof typeof TOKENS].role).toBe("bg");
    }
  });

  test("every surface token is derived, and derived is accepted nowhere else", () => {
    for (const name of SURFACE_NAMES) expect(colorOf(name)).toBe("derived");
    expect(validateTheme(withTokens(DEFAULT_THEME, { accent: "derived" }))).toEqual([
      'token "accent": "derived" is only valid for surface tokens',
    ]);
  });
});

describe("Tool kinds alike by default", () => {
  test("every tool.kind.<kind> resolves to the value of tool.kind", () => {
    const theme = resolveTheme(DEFAULT_THEME);
    const kind = theme.token("tool.kind");
    for (const k of TOOL_KINDS) {
      const t = theme.token(`tool.kind.${k}`);
      expect(t.color.equals(kind.color), k).toBe(true);
      expect(t.attributes, k).toBe(kind.attributes);
    }
  });

  test("a theme that sets only tool.kind changes every kind; one kind can still be set apart", () => {
    const one = resolveTheme(withTokens(DEFAULT_THEME, { "tool.kind": { color: 3, bold: true } }));
    for (const k of TOOL_KINDS) {
      expect(one.color(`tool.kind.${k}`).slot, k).toBe(3);
      expect(one.token(`tool.kind.${k}`).attributes, k).toBe(TextAttributes.BOLD);
    }
    const apart = resolveTheme(withTokens(DEFAULT_THEME, { "tool.kind.execute": 1 }));
    expect(apart.color("tool.kind.execute").slot).toBe(1);
    expect(apart.color("tool.kind.read").slot).toBe(6);
  });

  test("toolKindToken: each ACP kind has its token, a missing or unknown kind takes other", () => {
    for (const k of TOOL_KINDS) expect(toolKindToken(k)).toBe(`tool.kind.${k}`);
    expect(toolKindToken(undefined)).toBe("tool.kind.other");
    expect(toolKindToken("telepathy")).toBe("tool.kind.other");
  });

  test("references are validated: unknown target, other role, cycle", () => {
    const bad = (overrides: Record<string, unknown>) => validateTheme(withTokens(DEFAULT_THEME, overrides as never));
    expect(bad({ "tool.kind.read": { ref: "nope" } })).toEqual(['token "tool.kind.read": refers to unknown token "nope"']);
    expect(bad({ "tool.kind.read": { ref: "surface.card" } })).toEqual(['token "tool.kind.read": refers to "surface.card", a background token']);
    const cycle = bad({ "tool.kind": { ref: "tool.kind.read" } });
    expect(cycle.length).toBe(1 + TOOL_KINDS.length);
    for (const e of cycle) expect(e).toMatch(/reference cycle/);
  });
});

describe("Retired token", () => {
  // The retired name is built, so that a search of src/ for it finds no user (task 3.2).
  const retiredSurface = ["surface", "selected"].join(".");
  test(`the token set holds surface.cursor, surface.selection and the six heading levels, and neither ${retiredSurface} nor markdown.heading`, () => {
    for (const name of ["surface.cursor", "surface.selection", ...[1, 2, 3, 4, 5, 6].map((n) => `markdown.heading.${n}`)]) {
      expect(TOKEN_NAMES as string[]).toContain(name);
    }
    expect(TOKEN_NAMES as string[]).not.toContain(retiredSurface);
    expect(TOKEN_NAMES as string[]).not.toContain("markdown.heading");
    expect(validateTheme(withTokens(DEFAULT_THEME, { [retiredSurface]: "derived" } as never))).toContain(`unknown token "${retiredSurface}"`);
  });
});

describe("Default foreground is not forced to white (resolver side)", () => {
  test("default foreground tokens resolve to a default-intent colour, not rgb white", () => {
    const theme = resolveTheme(DEFAULT_THEME);
    const text = theme.text("text");
    expect(text.fg.intent).toBe("default");
    expect(text.fg.equals(RGBA.fromInts(255, 255, 255))).toBe(false);
    // No terminal colours yet: a derived surface is the terminal's default background.
    expect(theme.flat).toBe(true);
    for (const name of SURFACE_NAMES) expect(theme.color(name).intent).toBe("default");
    expect(theme.token("status.bg").role).toBe("bg");
  });

  test("background tokens cannot be used as text styles", () => {
    expect(() => resolveTheme(DEFAULT_THEME).text("status.bg")).toThrow(/background token/);
  });
});

describe("The user card's bar token (mvp-configuration, 13 October 2026)", () => {
  const DARK = { foreground: "#bcbec4", background: "#191a1c" };
  const LIGHT = { foreground: "#1f2328", background: "#ffffff" };

  test("user defaults to what accent resolves to, on dark and light backgrounds and with no terminal answer", () => {
    for (const terminal of [DARK, LIGHT, null]) {
      const theme = resolveTheme(DEFAULT_THEME, { terminal });
      expect(theme.color("user").equals(theme.color("accent"))).toBe(true);
      expect(theme.color("user").intent).toBe(theme.color("accent").intent);
      expect(theme.color("user").slot).toBe(theme.color("accent").slot);
      expect(theme.token("user").attributes).toBe(theme.token("accent").attributes);
    }
    expect(tokenStyle(DEFAULT_THEME, "user")).toEqual(tokenStyle(DEFAULT_THEME, "accent"));
  });

  test("a theme setting user recolours it and leaves accent alone", () => {
    const theme = resolveTheme(withTokens(DEFAULT_THEME, { user: 5 }));
    expect(theme.color("user").slot).toBe(5);
    expect(theme.color("accent").slot).toBe(4);
  });
});

describe("Token styling can be swapped", () => {
  test("remapping accent changes accent and nothing else", () => {
    const base = resolveTheme(DEFAULT_THEME);
    const swapped = resolveTheme(withTokens(DEFAULT_THEME, { accent: 5 }));
    expect(base.color("accent").slot).toBe(4);
    expect(swapped.color("accent").slot).toBe(5);
    expect(swapped.color("accent").intent).toBe("indexed");
    for (const name of TOKEN_NAMES) {
      if (name === "accent") continue;
      expect(swapped.color(name).equals(base.color(name))).toBe(true);
      expect(swapped.token(name).attributes).toBe(base.token(name).attributes);
    }
  });

  test("attributes come from the theme", () => {
    const theme = resolveTheme(withTokens(DEFAULT_THEME, { accent: { color: 2, bold: true, underline: true } }));
    expect(theme.text("accent").attributes).toBe(TextAttributes.BOLD | TextAttributes.UNDERLINE);
    expect(theme.text("text").attributes).toBe(TextAttributes.NONE);
  });

  test("later themes may use hex values", () => {
    const theme = resolveTheme(withTokens(DEFAULT_THEME, { accent: "#ff8800" }));
    expect(theme.color("accent").intent).toBe("rgb");
    expect(theme.color("accent").toInts()).toEqual([255, 136, 0, 255]);
  });

  test("an optional palette snapshot only changes stored RGB, not the intent", () => {
    const palette = Array.from({ length: 16 }, () => null as string | null);
    palette[4] = "#112233";
    const theme = resolveTheme(DEFAULT_THEME, { palette: { palette, defaultForeground: "#101010", defaultBackground: "#fafafa" } });
    expect(theme.color("accent").intent).toBe("indexed");
    expect(theme.color("accent").toInts().slice(0, 3)).toEqual([0x11, 0x22, 0x33]);
    expect(theme.color("text").intent).toBe("default");
    expect(theme.color("text").toInts().slice(0, 3)).toEqual([0x10, 0x10, 0x10]);
  });
});

describe("validation", () => {
  test("rejects unknown tokens, missing tokens and bad colours", () => {
    const bad = {
      name: "bad",
      tokens: { ...DEFAULT_THEME.tokens, accent: 300, muted: "blue", nope: 1 } as unknown as typeof DEFAULT_THEME.tokens,
    };
    delete (bad.tokens as Record<string, unknown>).hint;
    const errors = validateTheme(bad);
    expect(errors).toContain('missing token "hint"');
    expect(errors).toContain('unknown token "nope"');
    expect(errors.some((e) => e.includes('"accent"'))).toBe(true);
    expect(errors.some((e) => e.includes('"muted"'))).toBe(true);
    expect(() => resolveTheme(bad)).toThrow(/invalid theme "bad"/);
  });
});
