// mvp-configuration tasks 5.1, 5.2, 5.3 and 5.6 as unit tests (specs/tui-theme "Theme files",
// "Token values in a theme", "Theme validation", "Permission card distinct under any theme" and
// "Legibility report for user themes"): theme files read from a themes directory held in memory,
// composed and resolved as the live theme does, and their problems as the store receives them.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { RGBA, TextAttributes } from "@opentui/core";
import { parseConfigText } from "../../src/config/load.ts";
import { defaultConfig, SECTIONS, type Config } from "../../src/config/schema.ts";
import type { ConfigProblem } from "../../src/config/problems.ts";
import type { FileRead } from "../../src/config/sources.ts";
import { checkTheme, createConfiguredTheme, loadConfiguredTheme, themeLegibilityWarnings, type ThemeFiles } from "../../src/theme/configured.ts";
import { bindTerminalColours, createLiveTheme, createThemeRefresh, DEFAULT_THEME, deriveSurfaces, lightness, parseHex, resolveTheme, styleColour, tokenStyle, withTokens, type TerminalColours, type TokenName } from "../../src/theme/index.ts";
import { ZED_AYU_LIGHT, ZED_ONE_LIGHT } from "../../src/theme/palettes.fixture.ts";
import { SURFACE_NAMES, TOKEN_NAMES, TOKENS } from "../../src/theme/tokens.ts";

// Built with the platform's rules, as the loader joins a theme's file to the themes directory.
const THEMES = join("/cfg", "acp-tui", "themes");
const FILES: ThemeFiles = { themes: THEMES, user: join("/cfg", "acp-tui", "config.jsonc"), project: null };
const DARK: TerminalColours = { foreground: "#bcbec4", background: "#191a1c" };
const ONE_LIGHT: TerminalColours = { foreground: ZED_ONE_LIGHT.foreground, background: ZED_ONE_LIGHT.background };

/** A file reader over `files` (absolute paths to text). */
const reader =
  (files: Record<string, string>) =>
  (path: string): FileRead => ({ text: files[path] ?? null, unsafe: null, error: null });

/** The effective configuration a user's file text gives (its theme section). */
function configOf(text: string): Config {
  const parsed = parseConfigText(text, FILES.user);
  expect(parsed.problems).toEqual([]);
  return { ...defaultConfig(), theme: SECTIONS.theme.parse(parsed.sections.theme) };
}

/** A configuration's theme with its defaults filled in. */
function themeConfig(theme: Partial<Config["theme"]>): Config["theme"] {
  return { ...defaultConfig().theme, ...theme };
}

/** A store stand-in for `createConfiguredTheme`. */
function store(theme: Config["theme"]) {
  let config: Config = { ...defaultConfig(), theme };
  const channels = new Map<string, readonly ConfigProblem[]>();
  return {
    config: () => config,
    files: () => FILES,
    setProblems: (channel: string, problems: readonly ConfigProblem[]) => void channels.set(channel, problems),
    problems: (channel = "theme") => channels.get(channel) ?? [],
    set(next: Partial<Config["theme"]>) {
      config = { ...config, theme: themeConfig(next) };
    },
  };
}

const indexOf = (rgba: RGBA): number | null => (rgba.intent === "indexed" ? [...Array(256).keys()].find((i) => JSON.stringify(RGBA.fromIndex(i).toInts()) === JSON.stringify(rgba.toInts())) ?? null : null);
const defaultIndex = (name: TokenName, light: boolean) => styleColour(tokenStyle(DEFAULT_THEME, name), light);

describe("Theme files (task 5.1)", () => {
  test("Theme from a file: themes/mine.jsonc sets accent to 5; accent is ANSI 5 and every other token keeps the default theme's value", () => {
    const read = reader({ [join(THEMES, "mine.jsonc")]: `{ "tokens": { "accent": 5 } }` });
    const loaded = loadConfiguredTheme(themeConfig({ name: "mine" }), FILES, { read });
    expect(loaded.problems).toEqual([]);
    const theme = createLiveTheme(loaded.source!);
    theme.setTerminalColours(DARK);
    expect(indexOf(theme.color("accent"))).toBe(5);
    const composed = theme.composed.theme;
    for (const name of Object.keys(DEFAULT_THEME.tokens) as TokenName[]) {
      if (name !== "accent") expect(composed.tokens[name], name).toEqual(DEFAULT_THEME.tokens[name]);
    }
  });

  test("Light section: tool.duration is ANSI 4 under Zed One Light's background, and the default theme's value after a dark background is reported and Ctrl+L re-queries", async () => {
    const read = reader({ [join(THEMES, "mine.jsonc")]: `{ "light": { "tokens": { "tool.duration": 4 } }, "dark": { "tokens": { "tool.count": 13 } } }` });
    const theme = createLiveTheme(loadConfiguredTheme(themeConfig({ name: "mine" }), FILES, { read }).source!);
    // The terminal as the colour tracker sees it: OSC 10 and 11 replies through the renderer.
    const subscribers = new Set<(sequence: string) => void>();
    const renderer = { subscribeOsc: (h: (s: string) => void) => (subscribers.add(h), () => void subscribers.delete(h)) };
    const answer = (colours: TerminalColours) => {
      for (const [code, hex] of [[10, colours.foreground], [11, colours.background]] as const) {
        const [r, g, b] = parseHex(hex).map((c) => c.toString(16).padStart(2, "0"));
        for (const h of subscribers) h(`\x1b]${code};rgb:${r}/${g}/${b}\x07`);
      }
    };
    let reply = ONE_LIGHT;
    const colours = bindTerminalColours(renderer, theme, { write: () => queueMicrotask(() => answer(reply)) });
    expect(await colours.refresh(1000)).toEqual(ONE_LIGHT);
    expect(indexOf(theme.color("tool.duration"))).toBe(4);
    expect(indexOf(theme.color("tool.count"))).toBe(defaultIndex("tool.count", true) as number);

    // The IDE switches to a dark theme; Ctrl+L (the refresh) re-queries and the dark section applies.
    reply = DARK;
    let repaints = 0;
    const refresh = createThemeRefresh({ colours, theme, repaint: () => repaints++ });
    await refresh.run();
    expect(theme.terminal).toEqual(DARK);
    expect(indexOf(theme.color("tool.duration"))).toBe(defaultIndex("tool.duration", false) as number);
    expect(indexOf(theme.color("tool.count"))).toBe(13);
    expect(repaints).toBeGreaterThan(0);
    refresh.dispose();
    colours.dispose();
  });

  test("no reply applies neither section; the flat style forced keeps the section of the background reported (IDE check 12.1)", () => {
    const read = reader({ [join(THEMES, "mine.jsonc")]: `{ "light": { "tokens": { "accent": 1 } }, "dark": { "tokens": { "accent": 2 } } }` });
    const theme = createLiveTheme(loadConfiguredTheme(themeConfig({ name: "mine" }), FILES, { read }).source!);
    expect(indexOf(theme.color("accent"))).toBe(4);
    theme.setTerminalColours(DARK);
    expect(indexOf(theme.color("accent"))).toBe(2);
    theme.setForceFlat(true);
    expect(theme.flat).toBe(true);
    expect(indexOf(theme.color("accent"))).toBe(2);
    // A light background reported while forced: the light section, still flat.
    expect(theme.setTerminalColours(ONE_LIGHT)).toBe(true);
    expect(indexOf(theme.color("accent"))).toBe(1);
    expect(theme.flat).toBe(true);
    expect(theme.color("surface.card").intent).toBe("default");
  });

  test("Flat style recolours no text (IDE check 12.1, Zed Ayu Light): every text token keeps the light-background choice of the default theme; only the fills go", () => {
    const ayu: TerminalColours = { foreground: ZED_AYU_LIGHT.foreground, background: ZED_AYU_LIGHT.background };
    const lit = createLiveTheme(DEFAULT_THEME);
    lit.setTerminalColours(ayu);
    const forced = createLiveTheme(DEFAULT_THEME, { forceFlat: true });
    forced.setTerminalColours(ayu);
    expect(lit.flat).toBe(false);
    expect(forced.flat).toBe(true);
    // Inline code is the light choice (magenta, Ayu's blue), not the dark one (yellow, Ayu's orange).
    expect(indexOf(forced.color("markdown.code"))).toBe(defaultIndex("markdown.code", true) as number);
    expect(defaultIndex("markdown.code", true)).not.toBe(defaultIndex("markdown.code", false));
    for (const name of TOKEN_NAMES) {
      if (TOKENS[name].role !== "fg") continue;
      expect(forced.text(name), name).toEqual(lit.text(name));
    }
    for (const name of SURFACE_NAMES) expect(forced.color(name).intent, name).toBe("default");
  });

  test("Inline override: theme.tokens.accent 2 over mine's accent 5", () => {
    const read = reader({ [join(THEMES, "mine.jsonc")]: `{ "tokens": { "accent": 5 } }` });
    const config = configOf(`{ "theme": { "name": "mine", "tokens": { "accent": 2 } } }`);
    const theme = createLiveTheme(loadConfiguredTheme(config.theme, FILES, { read }).source!);
    expect(indexOf(theme.color("accent"))).toBe(2);
  });

  test("extends: a theme over another, each file's sections in order, the child last", () => {
    const read = reader({
      [join(THEMES, "base.jsonc")]: `{ "tokens": { "accent": 5, "danger": 9 }, "surface_contrast": 1.2 }`,
      [join(THEMES, "mine.jsonc")]: `{ "extends": "base", "tokens": { "accent": 6 } }`,
    });
    const loaded = loadConfiguredTheme(themeConfig({ name: "mine" }), FILES, { read });
    const composed = loaded.source!.compose("dark");
    expect(composed.theme.tokens.accent).toEqual({ color: 6 });
    expect(composed.theme.tokens.danger).toEqual({ color: 9 });
    expect(composed.surfaceContrast).toBeCloseTo(1.2);
  });

  test("a bare colour keeps the token's attributes and drops its light-background alternative; a style without a colour keeps both", () => {
    const read = reader({ [join(THEMES, "mine.jsonc")]: `{ "tokens": { "permission": 1, "warning": { "underline": true } } }` });
    const composed = loadConfiguredTheme(themeConfig({ name: "mine" }), FILES, { read }).source!.compose(null);
    expect(composed.theme.tokens.permission).toEqual({ color: 1, bold: true });
    expect(composed.theme.tokens.warning).toEqual({ color: 3, light: 9, underline: true });
  });
});

describe("Token values in a theme (task 5.2)", () => {
  test("Attributes: tool.index { color 8, dim } is drawn in ANSI 8, dim", () => {
    const read = reader({ [join(THEMES, "mine.jsonc")]: `{ "tokens": { "tool.index": { "color": 8, "dim": true } } }` });
    const theme = createLiveTheme(loadConfiguredTheme(themeConfig({ name: "mine" }), FILES, { read }).source!);
    theme.setTerminalColours(ONE_LIGHT);
    expect(indexOf(theme.color("tool.index"))).toBe(8);
    expect(theme.text("tool.index").attributes & TextAttributes.DIM).toBe(TextAttributes.DIM);
  });

  test("Excluded attribute: strikethrough on tool.title is named as not allowed, with its place, and the token keeps its previous style", () => {
    const text = `{\n  "tokens": {\n    "tool.title": { "color": 7, "strikethrough": true },\n    "accent": 5\n  }\n}`;
    const loaded = loadConfiguredTheme(themeConfig({ name: "mine" }), FILES, { read: reader({ [join(THEMES, "mine.jsonc")]: text }) });
    expect(loaded.problems).toEqual([
      { file: join(THEMES, "mine.jsonc"), line: 3, column: 33, path: "tokens.tool.title.strikethrough", severity: "error", message: "is not allowed here" },
    ]);
    const composed = loaded.source!.compose("dark");
    expect(composed.theme.tokens["tool.title"]).toEqual(DEFAULT_THEME.tokens["tool.title"]);
    expect(composed.theme.tokens.accent).toEqual({ color: 5 });
  });

  test("a value of the wrong kind is named with what the token takes: derived for a text token", () => {
    const loaded = loadConfiguredTheme(themeConfig({ name: "mine" }), FILES, { read: reader({ [join(THEMES, "mine.jsonc")]: `{ "tokens": { "accent": "derived", "surface.code": "derived" } }` }) });
    expect(loaded.problems.map((p) => [p.path, p.message])).toEqual([["tokens.accent", 'takes a whole number from 0 to 255, "default" or a "#rrggbb" colour or an object, not "derived"']]);
  });

  test("an inline token with an excluded attribute rejects the theme section (the configuration's rule), with its line and column", () => {
    const parsed = parseConfigText(`{ "theme": { "tokens": { "tool.title": { "color": 7, "strikethrough": true } } } }`, FILES.user);
    expect(parsed.rejected).toEqual(["theme"]);
    expect(parsed.problems).toMatchObject([{ path: "theme.tokens.tool.title.strikethrough", line: 1, column: 54, message: "is not allowed here" }]);
  });
});

describe("Theme validation (task 5.2)", () => {
  test("Retired token: surface.selected is retired, naming surface.cursor and surface.selection; the cursor and selection keep their derived surfaces", () => {
    const loaded = loadConfiguredTheme(themeConfig({ name: "mine" }), FILES, { read: reader({ [join(THEMES, "mine.jsonc")]: `{ "tokens": { "surface.selected": "#333333" } }` }) });
    expect(loaded.problems).toMatchObject([{ path: "tokens.surface.selected", severity: "error", message: "is retired: use surface.cursor and surface.selection; it is ignored", line: 1, column: 15 }]);
    const theme = createLiveTheme(loaded.source!);
    theme.setTerminalColours(DARK);
    const derived = deriveSurfaces(DARK);
    for (const name of ["surface.cursor", "surface.selection"] as const) {
      expect(theme.color(name).toInts().slice(0, 3)).toEqual(parseHex(derived[name]) as never);
    }
    // markdown.heading names its six successors; the inline form is retired too.
    const heading = loadConfiguredTheme(themeConfig({ name: "mine" }), FILES, { read: reader({ [join(THEMES, "mine.jsonc")]: `{ "tokens": { "markdown.heading": 4 } }` }) });
    expect(heading.problems[0]!.message).toBe("is retired: use markdown.heading.1 to markdown.heading.6; it is ignored");
    const inline = parseConfigText(`{ "theme": { "tokens": { "surface.selected": 1 } } }`, FILES.user);
    expect(inline.problems[0]).toMatchObject({ path: "theme.tokens.surface.selected", message: "is retired: use surface.cursor and surface.selection" });
  });

  test("an unknown token name is reported with the closest known name and left out", () => {
    const loaded = loadConfiguredTheme(themeConfig({ name: "mine" }), FILES, { read: reader({ [join(THEMES, "mine.jsonc")]: `{ "tokens": { "acent": 5 } }` }) });
    expect(loaded.problems).toMatchObject([{ path: "tokens.acent", message: "is not a known token; it is ignored", suggestion: "accent" }]);
    expect(loaded.source).not.toBeNull();
  });

  test("Extends cycle: a extends b and b extends a; a problem names the cycle and the previous theme stays in use", () => {
    const files = { [join(THEMES, "a.jsonc")]: `{ "extends": "b" }`, [join(THEMES, "b.jsonc")]: `{\n  "extends": "a"\n}`, [join(THEMES, "good.jsonc")]: `{ "tokens": { "accent": 6 } }` };
    const s = store(themeConfig({ name: "good" }));
    const configured = createConfiguredTheme(s, { read: reader(files) });
    const theme = createLiveTheme(configured.source);
    configured.attach(theme);
    expect(indexOf(theme.color("accent"))).toBe(6);
    s.set({ name: "a" });
    configured.reload();
    expect(s.problems()).toMatchObject([{ file: join(THEMES, "b.jsonc"), line: 2, column: 14, path: "extends", severity: "error", message: "makes a cycle: a extends b extends a; the previous theme stays in use" }]);
    expect(indexOf(theme.color("accent"))).toBe(6);
  });

  test("an unknown theme name leaves the previous theme in use, with a problem naming the file", () => {
    const s = store(themeConfig({ name: "good" }));
    const configured = createConfiguredTheme(s, { read: reader({ [join(THEMES, "good.jsonc")]: `{ "tokens": { "accent": 6 } }` }) });
    const theme = createLiveTheme(configured.source);
    configured.attach(theme);
    s.set({ name: "missing" });
    configured.reload();
    expect(s.problems()).toMatchObject([{ file: join(THEMES, "missing.jsonc"), severity: "error" }]);
    expect(s.problems()[0]!.message).toContain('theme "missing" cannot be used');
    expect(indexOf(theme.color("accent"))).toBe(6);
  });
});

describe("Permission card distinct under any theme (task 5.3)", () => {
  test("Code fill pinned to the card's: a problem names surface.code, code blocks use the derived surface.code, the card keeps #3a2f24", () => {
    const text = `{\n  "tokens": {\n    "surface.permission": "#3a2f24",\n    "surface.code": "#3a2f24"\n  }\n}`;
    const s = store(themeConfig({ name: "mine" }));
    const configured = createConfiguredTheme(s, { read: reader({ [join(THEMES, "mine.jsonc")]: text }) });
    const theme = createLiveTheme(configured.source);
    configured.attach(theme);
    // Zed One Light: every derived surface is far from #3a2f24 (L* 20), so only surface.code
    // violates. (On a dark terminal the derived fills come within 3 L* of it too, and the card would
    // take its derived fill as well: "no other surface token" includes the derived ones.)
    theme.setTerminalColours(ONE_LIGHT);
    expect(theme.color("surface.permission").toInts().slice(0, 3)).toEqual([0x3a, 0x2f, 0x24]);
    expect(theme.color("surface.code").toInts().slice(0, 3)).toEqual(parseHex(deriveSurfaces(ONE_LIGHT)["surface.code"]) as never);
    expect(s.problems()).toMatchObject([{ file: join(THEMES, "mine.jsonc"), line: 4, column: 21, path: "tokens.surface.code", severity: "error" }]);
    expect(s.problems()[0]!.message).toContain("within 3 L* of surface.permission");
    // Checked without a terminal too (pinned values at load), as config --check does.
    const config = { ...defaultConfig(), theme: themeConfig({ name: "mine" }) };
    expect(checkTheme(config, FILES, { read: reader({ [join(THEMES, "mine.jsonc")]: text }), palettes: [] }).filter((p) => p.severity === "error").map((p) => p.path)).toEqual(["tokens.surface.code"]);
  });

  test("Fill removed: surface.permission default while the terminal answers; a problem names surface.permission and the card keeps its derived fill", () => {
    const resolved = resolveTheme(withTokens(DEFAULT_THEME, { "surface.permission": "default" }), { terminal: DARK });
    expect(resolved.adjustments.map((a) => a.token)).toEqual(["surface.permission"]);
    expect(resolved.color("surface.permission").toInts().slice(0, 3)).toEqual(parseHex(deriveSurfaces(DARK)["surface.permission"]) as never);
    // Through the configuration: the problem is at the inline token's place.
    const s = store(themeConfig({ tokens: { "surface.permission": "default" } as never }));
    const configured = createConfiguredTheme(s, { read: reader({ [FILES.user]: `{\n  "theme": { "tokens": { "surface.permission": "default" } }\n}` }) });
    const theme = createLiveTheme(configured.source);
    configured.attach(theme);
    theme.setTerminalColours(DARK);
    expect(s.problems()).toMatchObject([{ file: FILES.user, line: 2, column: 48, path: "theme.tokens.surface.permission", severity: "error" }]);
    expect(theme.color("surface.permission").intent).toBe("rgb");
  });

  test("a pinned surface close to the derived card takes its derived value; a derived one close to a pinned card makes the card fall back", () => {
    const card = deriveSurfaces(DARK)["surface.permission"] as `#${string}`;
    const near = resolveTheme(withTokens(DEFAULT_THEME, { "surface.user": card }), { terminal: DARK });
    expect(near.adjustments.map((a) => a.token)).toEqual(["surface.user"]);
    const cursor = deriveSurfaces(DARK)["surface.cursor"] as `#${string}`;
    const pinnedCard = resolveTheme(withTokens(DEFAULT_THEME, { "surface.permission": cursor }), { terminal: DARK });
    expect(pinnedCard.adjustments.map((a) => a.token)).toEqual(["surface.permission"]);
    // The selected option pinned to the card's own fill.
    const same = resolveTheme(withTokens(DEFAULT_THEME, { "surface.permission": "#5a3a10", "surface.permission.selected": "#5a3a10" }), { terminal: ONE_LIGHT });
    expect(same.adjustments.map((a) => a.token)).toEqual(["surface.permission.selected"]);
    // A card far from everything is kept.
    const far = resolveTheme(withTokens(DEFAULT_THEME, { "surface.permission": "#7a4a10" }), { terminal: DARK });
    expect(far.adjustments).toEqual([]);
    expect(Math.abs(lightness(parseHex("#7a4a10")) - lightness(parseHex(cursor)))).toBeGreaterThan(3);
  });

  test("the default theme needs no adjustment on any terminal colours", () => {
    for (const terminal of [DARK, ONE_LIGHT, null]) expect(resolveTheme(DEFAULT_THEME, { terminal }).adjustments).toEqual([]);
  });
});

describe("Legibility report for user themes (task 5.6)", () => {
  test("Weak token on One Light: tool.duration as ANSI 11 gives a warning naming tool.duration, Zed One Light and the ratio below 3:1; no error", () => {
    const text = `{\n  "tokens": { "tool.duration": 11 }\n}`;
    const config = { ...defaultConfig(), theme: themeConfig({ name: "mine" }) };
    const read = reader({ [join(THEMES, "mine.jsonc")]: text });
    const warnings = themeLegibilityWarnings(config, FILES, { read });
    const oneLight = warnings.filter((w) => w.message.includes("Zed One Light"));
    expect(oneLight).toHaveLength(1);
    expect(oneLight[0]).toMatchObject({ file: join(THEMES, "mine.jsonc"), line: 2, column: 32, path: "tokens.tool.duration", severity: "warning" });
    const ratio = Number(/is ([0-9.]+):1/.exec(oneLight[0]!.message)![1]);
    expect(ratio).toBeLessThan(3);
    expect(oneLight[0]!.message).toBe(`is ${ratio.toFixed(2)}:1 against the background on Zed One Light, below the 3:1 floor for text; it may be hard to read there`);
    expect(warnings.every((w) => w.severity === "warning")).toBe(true);
    expect(checkTheme(config, FILES, { read }).some((p) => p.severity === "error")).toBe(false);
  });

  test("the default theme, and tokens a theme leaves alone, give no warning", () => {
    expect(themeLegibilityWarnings(defaultConfig(), FILES)).toEqual([]);
    const read = reader({ [join(THEMES, "mine.jsonc")]: `{ "tokens": { "accent": 4 } }` });
    expect(themeLegibilityWarnings({ ...defaultConfig(), theme: themeConfig({ name: "mine" }) }, FILES, { read })).toEqual([]);
  });

  test("a pinned surface that leaves the default foreground under 4.5:1 is a warning", () => {
    const read = reader({ [join(THEMES, "mine.jsonc")]: `{ "tokens": { "surface.card": "#808080" } }` });
    const warnings = themeLegibilityWarnings({ ...defaultConfig(), theme: themeConfig({ name: "mine" }) }, FILES, { read });
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.every((w) => w.path === "tokens.surface.card" && /leaves the default foreground [0-9.]+:1 on .*, below 4.5:1/.test(w.message))).toBe(true);
  });
});
