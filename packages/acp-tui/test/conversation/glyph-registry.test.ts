// The glyph registry (mvp-configuration tasks 7.1 and 7.2; spec tui-config "Glyph sets" and
// "Glyph validation"): every set defines every name, every built-in glyph passes the validation an
// override does, the permission marker is used by nothing else, overrides are checked by the width
// OpenTUI draws with and the layout counts with, and the active set follows `applyGlyphs`.
import { afterEach, describe, expect, test } from "bun:test";
import { createEffect, createRoot } from "solid-js";
import {
  ASCII_GLYPHS,
  checkGlyph,
  checkOverrides,
  DEFAULT_GLYPHS,
  glyphGroup,
  GLYPH_NAMES,
  GLYPH_SET_NAMES,
  GLYPH_SETS,
  openTuiCells,
  resolveGlyphs,
  type GlyphSetName,
} from "../../src/conversation/glyphs.ts";
import { activeGlyphs, applyGlyphs, glyphsKey, LIVE_CHROME_GLYPHS, LIVE_GLYPHS, LIVE_PERMISSION_GLYPHS, resetGlyphs } from "../../src/conversation/live-glyphs.ts";
import { DEFAULT_CHROME_GLYPHS } from "../../src/layout/glyphs.ts";
import { PERMISSION_GLYPHS } from "../../src/app/permission.ts";
import { TITLE_MARKER, terminalTitle } from "../../src/renderer/title.ts";
import { parseConfigText } from "../../src/config/load.ts";

afterEach(() => resetGlyphs());

const MARKER = GLYPH_SETS.unicode["permission.marker"]!;
const unicode = (overrides: Record<string, string>) => resolveGlyphs({ set: "unicode", overrides });

describe("Glyph registry (task 7.1)", () => {
  test("every set defines every name, and the names are the registry's", () => {
    expect(GLYPH_NAMES.length).toBeGreaterThan(70);
    expect(new Set(GLYPH_NAMES).size).toBe(GLYPH_NAMES.length);
    for (const set of GLYPH_SET_NAMES) {
      expect(Object.keys(GLYPH_SETS[set]).sort()).toEqual([...GLYPH_NAMES].sort());
      for (const name of GLYPH_NAMES) expect([set, name, typeof GLYPH_SETS[set][name]]).toEqual([set, name, "string"]);
    }
  });

  test("the registry names every glyph acp-tui draws (spec tui-config 'Glyph sets')", () => {
    const groups = new Set(GLYPH_NAMES.map(glyphGroup));
    for (const group of [
      "gutter", "tool.kind", "tool.status", "spinner", "thought", "plan", "separator", "card", "cursor", "list.bullet", "task", "heading.rule", "table", "quote", "code",
      "footnote", "superscript", "subscript", "frame", "permission", "busy", "splash", "title", "scrollbar",
    ]) {
      expect([group, groups.has(group)]).toEqual([group, true]);
    }
    expect(GLYPH_NAMES).toContain("scrollbar.track");
    expect(GLYPH_NAMES).toContain("scrollbar.thumb");
    expect(GLYPH_NAMES).toContain("list.bullet.4");
    expect(GLYPH_NAMES).toContain("title.marker");
    expect(GLYPH_NAMES).toContain("title.attention");
  });

  test("every glyph of every set passes the validation an override does", () => {
    for (const set of GLYPH_SET_NAMES) {
      for (const name of GLYPH_NAMES) {
        expect([set, name, checkGlyph(name, GLYPH_SETS[set][name]!)]).toEqual([set, name, null]);
      }
    }
  });

  test("the ascii set is ASCII and no wider than the unicode glyph it stands for (the footnote brackets apart)", () => {
    for (const name of GLYPH_NAMES) {
      const glyph = GLYPH_SETS.ascii[name]!;
      expect([name, /^[\x20-\x7e]*$/.test(glyph)]).toEqual([name, true]);
      // The busy half glyphs are empty in ascii: whole-cell steps (day-two-feedback design D4).
      if (/^busy\.(segment|gap)\.(lead|trail)$/.test(name)) {
        expect([name, glyph]).toEqual([name, ""]);
        continue;
      }
      if (/^footnote\.(open|close)$/.test(name) || name === "splash.more") continue;
      expect([name, Bun.stringWidth(glyph)]).toEqual([name, Bun.stringWidth(GLYPH_SETS.unicode[name]!)]);
    }
  });

  test("nerd-font: tool kinds and statuses are Nerd Font icons, everything else falls back to unicode", () => {
    const nerd = GLYPH_SETS["nerd-font"];
    const different = GLYPH_NAMES.filter((name) => nerd[name] !== GLYPH_SETS.unicode[name]);
    expect(different.length).toBeGreaterThan(8);
    for (const name of different) {
      expect([name, /^(tool\.(kind|status)\.|title\.attention$)/.test(name)]).toEqual([name, true]);
      expect([name, /^[-]$/u.test(nerd[name]!)]).toEqual([name, true]);
    }
    expect(nerd["tool.status.stopped"]).toBe("stop");
    expect(nerd["list.bullet.1"]).toBe("●");
    expect(nerd["permission.marker"]).toBe(MARKER);
  });

  test("the permission marker is used by no other glyph of any set, the title marker apart, which is the marker", () => {
    for (const set of GLYPH_SET_NAMES) {
      const values = GLYPH_SETS[set];
      const marker = values["permission.marker"]!;
      expect(marker.length).toBeGreaterThan(0);
      for (const name of GLYPH_NAMES) {
        if (name === "permission.marker" || name === "title.marker") continue;
        expect([set, name, values[name]!.includes(marker)]).toEqual([set, name, false]);
      }
      expect(values["title.marker"]).toBe(marker);
    }
  });

  test("title.attention is defined by every set", () => {
    expect(GLYPH_SETS.unicode["title.attention"]).toBe("\u25cf");
    expect(GLYPH_SETS.ascii["title.attention"]).toBe("*");
    expect(GLYPH_SETS["nerd-font"]["title.attention"]).toBe("\uf0f3");
    expect(resolveGlyphs({ set: "unicode", overrides: {} }).glyphs.titleAttention).toBe("\u25cf");
  });

  test("title.attention may be overridden, but not blank or the permission marker", () => {
    expect(unicode({ "title.attention": "!" }).glyphs.titleAttention).toBe("!");
    const blank = unicode({ "title.attention": " " });
    expect(blank.problems).toEqual([{ name: "title.attention", message: expect.stringContaining("cannot be blank") }]);
    expect(blank.glyphs.titleAttention).toBe("\u25cf");
    const marker = unicode({ "title.attention": MARKER });
    expect(marker.problems).toEqual([{ name: "title.attention", message: expect.stringContaining("permission marker, which may not be used elsewhere") }]);
    expect(unicode({ "title.attention": "ab" }).problems).toHaveLength(1);
  });

  test("the unicode set's marker is not the ◈ that Lilex lacks", () => {
    expect(MARKER).not.toBe("◈");
    expect(MARKER).toBe("◊");
  });

  test("the fixed sets are built from the registry", () => {
    expect(DEFAULT_GLYPHS.toolKind["read"]).toBe(GLYPH_SETS.unicode["tool.kind.read"]!);
    expect(DEFAULT_GLYPHS.markdown.bullets).toEqual(["●", "○", "•", "◦"]);
    expect(ASCII_GLYPHS.toolKind["read"]).toBe(">");
    expect(DEFAULT_CHROME_GLYPHS.busy).toEqual({ track: "─", segment: "━", segmentLead: "╼", segmentTrail: "╾", gapLead: "╴", gapTrail: "╶" });
    expect(PERMISSION_GLYPHS.marker).toBe(MARKER);
    expect(PERMISSION_GLYPHS.topLeft).toBe("╭");
    expect(TITLE_MARKER).toBe(MARKER);
  });
});

describe("Glyph overrides and their validation (task 7.2)", () => {
  test("Bullet override: first-level bullets are ▸ and second-level bullets stay ○", () => {
    const { glyphs, problems } = unicode({ "list.bullet.1": "▸" });
    expect(problems).toEqual([]);
    expect(glyphs.conversation.markdown.bullets).toEqual(["▸", "○", "•", "◦"]);
    expect(glyphs.values["list.bullet.1"]).toBe("▸");
  });

  test("Wide glyph refused: ✅ for tool.status.ok takes two cells where one is required, and ✓ stays in use", () => {
    const { glyphs, problems } = unicode({ "tool.status.ok": "✅" });
    expect(problems).toEqual([{ name: "tool.status.ok", message: expect.stringContaining("takes 2 cells where 1 is required") }]);
    expect(problems[0]!.message).toContain('"✓" stays in use');
    expect(glyphs.conversation.toolStatus.ok).toBe("✓");
  });

  test("Marker reused: an override holding the permission marker is refused and the bullet keeps its glyph", () => {
    const { glyphs, problems } = unicode({ "list.bullet.1": MARKER });
    expect(problems).toEqual([{ name: "list.bullet.1", message: expect.stringContaining("permission marker, which may not be used elsewhere") }]);
    expect(glyphs.conversation.markdown.bullets[0]).toBe("●");
    // Also inside a longer glyph, and in the ascii set with its own marker.
    expect(unicode({ separator: ` ${MARKER} ` }).problems).toHaveLength(1);
    expect(resolveGlyphs({ set: "ascii", overrides: { "list.bullet.1": "!" } }).problems).toHaveLength(1);
  });

  test("the marker may be set, to a glyph nothing else uses, and the title marker follows it", () => {
    const { glyphs, problems } = unicode({ "permission.marker": "§" });
    expect(problems).toEqual([]);
    expect(glyphs.permission.marker).toBe("§");
    expect(glyphs.titleMarker).toBe("§");
    const separate = unicode({ "permission.marker": "§", "title.marker": "¶" });
    expect(separate.glyphs.titleMarker).toBe("¶");
    // The title marker is exempt from uniqueness: it may be a glyph the set uses.
    expect(unicode({ "title.marker": "●" }).problems).toEqual([]);
  });

  test("a marker another glyph of the set holds is refused, and the marker stays", () => {
    const { glyphs, problems } = unicode({ "permission.marker": "●" });
    expect(problems).toEqual([{ name: "permission.marker", message: expect.stringContaining("is used by list.bullet.1") }]);
    expect(glyphs.permission.marker).toBe(MARKER);
  });

  test("both a new marker and another override holding it: the other glyph is the one refused", () => {
    const { glyphs, problems } = unicode({ "permission.marker": "§", "list.bullet.2": "§" });
    expect(problems.map((p) => p.name)).toEqual(["list.bullet.2"]);
    expect(glyphs.permission.marker).toBe("§");
    expect(glyphs.conversation.markdown.bullets[1]).toBe("○");
  });

  test("a glyph that OpenTUI and the layout count differently (❤) is refused", () => {
    // OpenTUI draws ❤ two cells wide, the layout counts one: drawn, it would be misaligned.
    expect(openTuiCells("❤")).not.toBe(Bun.stringWidth("❤"));
    const { glyphs, problems } = unicode({ "tool.kind.other": "❤" });
    expect(problems).toEqual([{ name: "tool.kind.other", message: expect.stringMatching(/is drawn 2 cells wide by the renderer and counted as 1 cell by the layout/) }]);
    expect(glyphs.conversation.toolKind.other).toBe("•");
  });

  test("a glyph whose width differs from its name's class is refused: too wide, too narrow, empty", () => {
    expect(unicode({ "tool.status.ok": "ab" }).problems[0]!.message).toContain("takes 2 cells where 1 is required");
    expect(unicode({ "tool.status.ok": "" }).problems[0]!.message).toContain("takes 0 cells where 1 is required");
    expect(unicode({ "plan.completed": "[x" }).problems[0]!.message).toContain("takes 2 cells where 3 are required");
    expect(unicode({ "footnote.open": "[[" }).problems[0]!.message).toContain("takes 2 cells where 0 to 1 cells are required");
    expect(unicode({ "footnote.open": "" }).problems).toEqual([]);
    // The busy half glyphs take one cell or none (empty: whole-cell steps; day-two-feedback task 5.1).
    expect(unicode({ "busy.gap.lead": "" }).problems).toEqual([]);
    expect(unicode({ "busy.gap.lead": "" }).glyphs.chrome.busy.gapLead).toBe("");
    expect(unicode({ "busy.segment.trail": "━━" }).problems[0]!.message).toContain("takes 2 cells where 0 to 1 cells are required");
    expect(unicode({ "gutter.agent": "   " }).problems).toHaveLength(1);
  });

  test("not printable: control and format characters are refused, private use (Nerd Font) is not", () => {
    for (const bad of ["\x1b", "\x07", "\t", "\x7f", "\u0085", " ", "​", "‮"]) {
      expect([JSON.stringify(bad), unicode({ "list.bullet.1": bad }).problems.length]).toEqual([JSON.stringify(bad), 1]);
    }
    expect(unicode({ "list.bullet.1": "" }).problems).toEqual([]);
    expect(unicode({ "list.bullet.1": "" }).glyphs.values["list.bullet.1"]).toBe("");
  });

  test("frame glyphs and the marker cannot be blank", () => {
    for (const name of ["frame.top_left", "frame.horizontal", "frame.vertical", "permission.marker"]) {
      expect([name, unicode({ [name]: " " }).problems.length]).toEqual([name, 1]);
      expect(unicode({ [name]: " " }).problems[0]!.message).toContain("cannot be blank");
    }
    expect(unicode({ "frame.vertical": "║" }).problems).toEqual([]);
  });

  test("digit strings take ten one-cell digits", () => {
    expect(unicode({ "footnote.digits": "abcdefghij" }).problems).toEqual([]);
    expect(unicode({ "footnote.digits": "abc" }).problems[0]!.message).toContain("ten digits");
    expect(unicode({ "superscript.digits": "abcdefghi✅" }).problems).toHaveLength(1);
  });

  test("an unknown glyph name is reported with the closest name, and ignored", () => {
    const { problems, glyphs } = unicode({ "list.bullet.9": "x", "tool.status.okk": "x" });
    expect(problems).toEqual([
      { name: "list.bullet.9", message: "is not a glyph name and is ignored", suggestion: expect.stringMatching(/^list\.bullet\./) },
      { name: "tool.status.okk", message: "is not a glyph name and is ignored", suggestion: "tool.status.ok" },
    ]);
    expect(glyphs.values["list.bullet.1"]).toBe("●");
  });

  test("gutter.user is gone (the user card draws a bar): an override naming it gets the unknown-name warning (no name is within the suggestion distance)", () => {
    expect(GLYPH_NAMES).not.toContain("gutter.user");
    const { problems } = unicode({ "gutter.user": "x" });
    expect(problems).toEqual([{ name: "gutter.user", message: "is not a glyph name and is ignored" }]);
  });

  test("each invalid override is dropped on its own; the valid ones apply", () => {
    const { glyphs, problems } = unicode({ "list.bullet.1": "▸", "tool.status.ok": "✅", "list.bullet.2": "▹" });
    expect(problems.map((p) => p.name)).toEqual(["tool.status.ok"]);
    expect(glyphs.conversation.markdown.bullets.slice(0, 2)).toEqual(["▸", "▹"]);
  });

  test("overrides apply over the ascii and nerd-font sets too", () => {
    expect(resolveGlyphs({ set: "ascii", overrides: { "list.bullet.1": "-" } }).glyphs.conversation.markdown.bullets[0]).toBe("-");
    expect(resolveGlyphs({ set: "nerd-font", overrides: { "tool.kind.read": "R" } }).glyphs.conversation.toolKind["read"]).toBe("R");
    expect(checkOverrides("ascii", { "tool.status.ok": "ok" }).problems[0]!.message).toContain('"v" stays in use');
  });
});

describe("The loader reports invalid overrides at their place (task 7.2)", () => {
  const text = ['{', '  "glyphs": {', '    "set": "unicode",', '    "overrides": {', '      "list.bullet.1": "▸",', '      "tool.status.ok": "✅",', '      "list.bullet.2": "◊"', '    }', '  }', '}'].join("\n");

  test("a wide glyph and a reused marker are warnings with line, column and path, and are left out of the section", () => {
    const parsed = parseConfigText(text, "/c/config.jsonc");
    expect(parsed.status).toBe("ok");
    expect(parsed.problems.map((p) => [p.line, p.path, p.severity])).toEqual([
      [6, "glyphs.overrides.tool.status.ok", "warning"],
      [7, "glyphs.overrides.list.bullet.2", "warning"],
    ]);
    expect(parsed.problems[0]!.message).toContain("takes 2 cells where 1 is required");
    expect(parsed.sections["glyphs"]).toEqual({ set: "unicode", overrides: { "list.bullet.1": "▸" } });
    expect(parsed.rejected).toEqual([]);
  });

  test("a bare set name still loads", () => {
    const parsed = parseConfigText('{ "glyphs": "ascii" }', "/c/config.jsonc");
    expect(parsed.problems).toEqual([]);
    expect(parsed.sections["glyphs"]).toEqual({ set: "ascii" });
  });
});

describe("The active set (task 7.2, live reload)", () => {
  test("the live objects follow applyGlyphs, and nothing changes when the glyphs do not", () => {
    expect(LIVE_GLYPHS.markdown.bullets[0]).toBe("●");
    expect(glyphsKey(LIVE_GLYPHS)).toBe("");
    expect(applyGlyphs({ set: "ascii", overrides: {} })).toEqual([]);
    expect(LIVE_GLYPHS.markdown.bullets[0]).toBe("*");
    expect(LIVE_GLYPHS.toolStatus.ok).toBe("v");
    expect(LIVE_CHROME_GLYPHS.busy).toEqual({ track: "-", segment: "=", segmentLead: "", segmentTrail: "", gapLead: "", gapTrail: "" });
    expect(LIVE_PERMISSION_GLYPHS.marker).toBe("!");
    expect(activeGlyphs().titleMarker).toBe("!");
    expect(terminalTitle({ title: "t", agent: null, cwd: null, waiting: true, attention: false, format: "{title}" })).toBe("! t");
    const ascii = glyphsKey(LIVE_GLYPHS);
    expect(ascii).not.toBe("");
    applyGlyphs({ set: "unicode", overrides: { "list.bullet.1": "▸" } });
    expect(LIVE_GLYPHS.markdown.bullets[0]).toBe("▸");
    expect(glyphsKey(LIVE_GLYPHS)).not.toBe(ascii);
    resetGlyphs();
    expect(glyphsKey(LIVE_GLYPHS)).toBe("");
  });

  test("applyGlyphs returns the problems of the overrides left out, and keeps the rest", () => {
    const problems = applyGlyphs({ set: "unicode", overrides: { "tool.status.ok": "✅", "list.bullet.1": "▸" } });
    expect(problems.map((p) => p.name)).toEqual(["tool.status.ok"]);
    expect(LIVE_GLYPHS.toolStatus.ok).toBe("✓");
    expect(LIVE_GLYPHS.markdown.bullets[0]).toBe("▸");
  });

  test("a computation reading a live glyph re-runs when the set changes, and not when the same set is applied again", () => {
    const seen: string[] = [];
    const dispose = createRoot((dispose) => {
      createEffect(() => seen.push(LIVE_GLYPHS.toolStatus.ok));
      return dispose;
    });
    expect(seen).toEqual(["✓"]);
    applyGlyphs({ set: "ascii", overrides: {} });
    applyGlyphs({ set: "ascii", overrides: {} });
    applyGlyphs({ set: "unicode", overrides: {} });
    dispose();
    expect(seen).toEqual(["✓", "v", "✓"]);
  });

  test("the cache key of a glyph object: '' for the unicode set, the live key for the live object, one per other object", () => {
    expect(glyphsKey(DEFAULT_GLYPHS)).toBe("");
    const mine = { ...DEFAULT_GLYPHS };
    expect(glyphsKey(mine)).toBe(glyphsKey(mine));
    expect(glyphsKey(mine)).not.toBe("");
    expect(glyphsKey({ ...DEFAULT_GLYPHS })).not.toBe(glyphsKey(mine));
  });

  test("set names are the schema's", () => {
    const names: readonly GlyphSetName[] = GLYPH_SET_NAMES;
    expect(names).toEqual(["unicode", "ascii", "nerd-font"]);
  });
});
