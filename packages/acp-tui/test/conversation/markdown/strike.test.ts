// Strikethrough per terminal (mvp-rendering task 7.2; spec tui-rendering "Strikethrough per
// terminal", tui-theme "Safe text attributes only"): the rows carry `strike` and the muted
// `markdown.strike` token everywhere; draw.ts adds SGR 9 (OpenTUI's STRIKETHROUGH attribute) where
// the capability table says `sgr9`, else U+0336 where it says `combiningStrike`, else italic (review
// C8), and nothing else in acp-tui sets the strikethrough attribute.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { TextAttributes, type TextChunk } from "@opentui/core";
import { DEFAULT_GLYPHS } from "../../../src/conversation/glyphs.ts";
import { rowsToChunks, STRIKE_OVERLAY } from "../../../src/conversation/markdown/draw.ts";
import { MessageLayout } from "../../../src/conversation/markdown/layout.ts";
import { projectMessage } from "../../../src/conversation/markdown/project.ts";
import { rowText, type Row } from "../../../src/conversation/markdown/types.ts";
import { NO_CAPABILITIES, terminalCapabilities, type TerminalCapabilities } from "../../../src/renderer/capabilities.ts";
import { DEFAULT_THEME, resolveTheme } from "../../../src/theme/index.ts";

const theme = resolveTheme(DEFAULT_THEME, { terminal: { foreground: "#bcbec4", background: "#191a1c" } });
const ZED = terminalCapabilities({ TERM_PROGRAM: "zed" });
const PHPSTORM = terminalCapabilities({ TERMINAL_EMULATOR: "JetBrains-JediTerm" });
const COMPOSING: TerminalCapabilities = { sgr9: false, combiningStrike: true, osc8: false, detectsUrls: false, emoji: [] };

function rows(source: string, width = 60): Row[] {
  return new MessageLayout(source, width, DEFAULT_GLYPHS).blocks().flatMap((b) => [...b.rows]);
}

function chunks(source: string, capabilities: TerminalCapabilities): TextChunk[] {
  return rowsToChunks(rows(source), 60, theme, capabilities).filter((c) => c.text !== "\n");
}

const struck = (c: TextChunk) => ((c.attributes ?? 0) & TextAttributes.STRIKETHROUGH) !== 0;
const italic = (c: TextChunk) => ((c.attributes ?? 0) & TextAttributes.ITALIC) !== 0;
const sameColour = (c: TextChunk, token: Parameters<typeof theme.color>[0]) => c.fg!.equals(theme.color(token));

describe("Strikethrough per terminal", () => {
  test("Zed: `struck` with SGR 9 and in the markdown.strike token, without the tildes", () => {
    expect(ZED.sgr9).toBe(true);
    const all = chunks("a ~~struck~~ word", ZED);
    expect(all.map((c) => c.text).join("")).toBe("a struck word");
    const hit = all.filter(struck);
    expect(hit.map((c) => c.text)).toEqual(["struck"]);
    expect(sameColour(hit[0]!, "markdown.strike")).toBe(true);
    expect(all.some((c) => c.text.includes(STRIKE_OVERLAY))).toBe(false);
  });

  test("PhpStorm: no SGR 9, `struck` in the markdown.strike token and italic, and no U+0336 while the table does not mark JetBrains as composing it", () => {
    expect({ ...PHPSTORM, emoji: [] }).toEqual({ ...NO_CAPABILITIES, detectsUrls: true, emoji: [] });
    const all = chunks("a ~~struck~~ word", PHPSTORM);
    expect(all.some(struck)).toBe(false);
    const piece = all.find((c) => c.text === "struck")!;
    expect(sameColour(piece, "markdown.strike")).toBe(true);
    expect(all.filter(italic).map((c) => c.text)).toEqual(["struck"]);
    expect(all.some((c) => c.text.includes(STRIKE_OVERLAY))).toBe(false);
  });

  test("an unknown terminal: no SGR 9 and no overlay, italic instead", () => {
    const all = chunks("a ~~struck~~ word", terminalCapabilities({}));
    expect(all.some(struck)).toBe(false);
    expect(all.filter(italic).map((c) => c.text)).toEqual(["struck"]);
    expect(all.some((c) => c.text.includes(STRIKE_OVERLAY))).toBe(false);
  });

  test("italic only where neither SGR 9 nor U+0336 is drawn", () => {
    expect(chunks("a ~~struck~~ word", ZED).some(italic)).toBe(false);
    expect(chunks("a ~~struck~~ word", COMPOSING).some(italic)).toBe(false);
  });

  test("a composing terminal: U+0336 after each struck character, drawn only; the projection never holds it", () => {
    const all = chunks("a ~~two words~~ b", COMPOSING);
    expect(all.some(struck)).toBe(false);
    const piece = all.find((c) => c.text.includes(STRIKE_OVERLAY))!;
    expect(piece.text).toBe([..."two words"].map((ch) => ch + STRIKE_OVERLAY).join(""));
    // The rows (which the projection, the selection's cell maps, find and export read) are unchanged.
    expect(rows("a ~~two words~~ b").map(rowText)).toEqual(["a two words b"]);
    expect(projectMessage("a ~~two words~~ b", DEFAULT_GLYPHS, false).text).toBe("a two words b");
  });

  test("Single tilde: `H~2~O` reads as written with nothing struck, in every terminal", () => {
    expect(rows("H~2~O").map(rowText)).toEqual(["H~2~O"]);
    expect(rows("H~2~O").flatMap((r) => r.spans).some((s) => s.strike)).toBe(false);
    for (const caps of [ZED, PHPSTORM, COMPOSING]) {
      const all = chunks("H~2~O", caps);
      expect(all.some(struck)).toBe(false);
      expect(all.some((c) => c.text.includes(STRIKE_OVERLAY))).toBe(false);
    }
  });

  test("struck code and bold keep their own styles and are struck too", () => {
    const all = chunks("~~x `code`~~ and **~~b~~**", ZED);
    expect(all.filter(struck).map((c) => c.text)).toEqual(["x ", "code", "b"]);
    const code = all.find((c) => c.text === "code")!;
    expect(sameColour(code, "markdown.code")).toBe(true);
    const bold = all.find((c) => c.text === "b")!;
    expect((bold.attributes ?? 0) & TextAttributes.BOLD).toBe(TextAttributes.BOLD);
  });

  test("HTML <del> takes the strike style (spec \"HTML in Markdown\"), inline and in an HTML block", () => {
    for (const source of ["a <del>gone</del> b", "<div>a <del>gone</del> b</div>"]) {
      const all = chunks(source, ZED);
      const hit = all.filter(struck);
      expect(hit.map((c) => c.text.trim())).toEqual(["gone"]);
      expect(sameColour(hit[0]!, "markdown.strike")).toBe(true);
    }
  });

  test("nothing but struck spans ever carries SGR 9, whatever the source", () => {
    const source = readFileSync(join(import.meta.dir, "../../../../fake-agent/src/scenarios/markdown-gallery.md"), "utf8");
    const all = rowsToChunks(rows(source, 80), 80, theme, ZED);
    const spans = rows(source, 80).flatMap((r) => [...r.spans, ...(r.label ? [r.label] : [])]);
    const struckTexts = new Set(spans.filter((s) => s.strike).map((s) => s.text));
    expect(struckTexts.size).toBeGreaterThan(0);
    for (const c of all.filter(struck)) expect(struckTexts.has(c.text)).toBe(true);
  });
});

describe("only draw.ts sets the strikethrough attribute", () => {
  test("no other source file under src/ names TextAttributes.STRIKETHROUGH", () => {
    const root = join(import.meta.dir, "../../../src");
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name) && /STRIKETHROUGH|strikethrough\s*:/.test(readFileSync(path, "utf8"))) found.push(relative(root, path).split(sep).join("/"));
      }
    };
    walk(root);
    expect(found).toEqual(["conversation/markdown/draw.ts"]);
  });
});
