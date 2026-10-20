// Syntax highlighting of code blocks (mvp-rendering tasks 8.3 and 8.6; spec tui-rendering
// "Syntax highlighting", tui-theme "Code scope tokens"): captures to `code.*` runs, the runs onto
// the rows without changing them, PHP with and without `<?php` over the gallery's two samples and
// `fence-first`, and a highlight that arrives after the first frame recolouring without changing
// any row count. Uses OpenTUI's tree-sitter worker with the bundled grammars (offline).
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { getTreeSitterClient, type SimpleHighlight } from "@opentui/core";
import { testRender } from "@opentui/solid";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { App } from "../../../src/app/App.tsx";
import type { AppActions, AppContextValue } from "../../../src/app/context.ts";
import { registerGrammars } from "../../../src/conversation/grammars.ts";
import { DEFAULT_GLYPHS } from "../../../src/conversation/glyphs.ts";
import { codeRows } from "../../../src/conversation/markdown/code.ts";
import {
  cachedHighlight,
  clearHighlightCache,
  codeSources,
  highlightNow,
  highlightRows,
  highlightRuns,
  requestHighlights,
  setHighlighter,
} from "../../../src/conversation/markdown/highlight.ts";
import { MessageLayout } from "../../../src/conversation/markdown/layout.ts";
import { projectRows, rowText, type Row, type Span } from "../../../src/conversation/markdown/types.ts";
import { DEFAULT_LAYOUT, resolveLayout } from "../../../src/layout/layout.ts";
import { createSessionStore, type SessionStore } from "../../../src/session/store.ts";
import { DEFAULT_THEME, resolveTheme, type TokenName } from "../../../src/theme/index.ts";
import { runUpdates } from "../../selection/fixtures.ts";
import { gallerySource } from "./golden.ts";

const { FENCE_FIRST_TEXT } = (await import(join(import.meta.dir, "../../../../fake-agent/src/index.ts"))) as { FENCE_FIRST_TEXT: string };

const GLYPHS = DEFAULT_GLYPHS.markdown;

/** Every code block of `markdown` laid out at `width`, highlighted by the real worker. */
async function highlighted(markdown: string, width = 61): Promise<Row[][]> {
  const blocks = new MessageLayout(markdown, width, DEFAULT_GLYPHS).blocks().filter((b) => b.token.type === "code");
  const rows = blocks.map((b) => b.rows);
  const sources = rows.flatMap((r) => codeSources(r));
  await new Promise<void>((resolve) => {
    let left = sources.filter((s) => !cachedHighlight(s)).length;
    if (left === 0) return resolve();
    requestHighlights(sources, () => true, () => {
      left -= 1;
      if (left === 0) resolve();
    });
  });
  return rows.map((r) => [...highlightNow(r)]);
}

/** The token each occurrence of `word` (as one span or inside one) is drawn in. */
function tokensOf(rows: readonly Row[], word: string): TokenName[] {
  const out: TokenName[] = [];
  for (const row of rows) for (const s of row.spans) if (s.projection === undefined && s.text.includes(word)) out.push(s.token);
  return out;
}

/** The tokens the characters of the first occurrence of `word` are drawn in, in order, without
 *  repeats (`$x` in PHP: `$` is captured as an operator, `x` as a variable). */
function wordTokens(rows: readonly Row[], word: string): TokenName[] | undefined {
  for (const row of rows) {
    let text = "";
    const tokens: TokenName[] = [];
    for (const s of row.spans) {
      text += s.text;
      for (let i = 0; i < s.text.length; i++) tokens.push(s.token);
    }
    const at = text.search(new RegExp(`(?<![\\w$])${word.replace(/[$]/g, "\\$")}(?!\\w)`));
    if (at >= 0) return [...new Set(tokens.slice(at, at + word.length))];
  }
  return undefined;
}

/** The one token `word` is drawn in (undefined when it is in several or absent). */
function spanExactly(rows: readonly Row[], word: string): { token: TokenName } | undefined {
  const tokens = wordTokens(rows, word);
  return tokens?.length === 1 ? { token: tokens[0]! } : undefined;
}

afterEach(() => setHighlighter(undefined));

describe("highlight runs (task 8.3)", () => {
  test("overlapping captures: the more specific scope wins, then the later one; a scope with no token takes no part", () => {
    const text = "abcdef";
    const caps: SimpleHighlight[] = [
      [0, 6, "variable"],
      [2, 4, "function.call"],
      [2, 4, "keyword"], // less specific than function.call: loses
      [4, 6, "label"], // no token: variable stays
      [0, 1, "string"], // as specific as variable, later: wins
    ];
    expect(highlightRuns(text, caps)).toEqual([
      { start: 0, end: 1, token: "code.string" },
      { start: 1, end: 2, token: "code.variable" },
      { start: 2, end: 4, token: "code.function" },
      { start: 4, end: 6, token: "code.variable" },
    ]);
    // Text no capture colours keeps code.default (no run).
    expect(highlightRuns("xy", [[0, 1, "label"]])).toEqual([]);
  });

  test("runs recolour spans by their place in the source and never change the rows, across breaks and tabs", () => {
    const text = "ab\tcdefghijkl\nxyz";
    // The padding before day-one-feedback task group 13 except for the right column (one each side,
    // no padding rows), so the rows break where this test's comments say.
    const rows = codeRows(text, "php", { width: 9, glyphs: GLYPHS, flags: { codePadding: { rows: 0, columns: 1 } } });
    const runs = [
      { start: 0, end: 2, token: "code.keyword" as TokenName },
      { start: 5, end: 11, token: "code.string" as TokenName },
      { start: 14, end: 16, token: "code.number" as TokenName },
    ];
    const out = highlightRows(rows, () => runs);
    expect(out.map(rowText)).toEqual(rows.map(rowText));
    expect(out.map((r) => r.joined)).toEqual(rows.map((r) => r.joined));
    expect(projectRows(out)).toBe(text);
    const coloured = out.flatMap((r) => r.spans).filter((s) => s.projection === undefined).map((s) => [s.text, s.token]);
    expect(coloured).toEqual([
      ["ab", "code.keyword"],
      // The tab (offset 2) takes a row of its own at this width; then c (3) d (4) e (5) ...
      ["cd", "code.default"],
      ["efgh", "code.string"],
      ["ij", "code.string"],
      ["kl", "code.default"],
      ["xy", "code.number"],
      ["z", "code.default"],
    ]);
  });
});

describe("Syntax highlighting with the bundled grammars (task 8.6)", () => {
  test("PHP without the tag: in `$x = strlen($y);` strlen and $x are drawn in tokens other than code.default", async () => {
    const [rows] = await highlighted("```php\n$x = strlen($y);\n```\n");
    expect(spanExactly(rows!, "strlen")?.token).toBe("code.function");
    // `$` is captured as an operator and the name as a variable: neither is code.default.
    expect(wordTokens(rows!, "$x")).toEqual(["code.operator", "code.variable"]);
  }, 20000);

  test("PHP with the tag: the class keyword is drawn in code.keyword (the gallery's first PHP sample)", async () => {
    const source = gallerySource();
    const m21 = source.slice(source.indexOf("M21 "), source.indexOf("M22 "));
    const blocks = await highlighted(m21);
    const [withTag, withoutTag] = blocks;
    // The first row is the block's padding row; the code follows it.
    expect(rowText(withTag![1]!)).toContain("<?php");
    expect(spanExactly(withTag!, "class")?.token).toBe("code.keyword");
    expect(spanExactly(withTag!, "function")?.token).toBe("code.keyword");
    expect(tokensOf(withTag!, "// A comment")).toEqual(["code.comment"]);
    expect(spanExactly(withTag!, "sprintf")?.token).toBe("code.function");
    // The gallery's PHP without the tag.
    expect(spanExactly(withoutTag!, "array_sum")?.token).toBe("code.function");
    expect(spanExactly(withoutTag!, "fn")?.token).toBe("code.keyword");
    // The other languages of M21 are highlighted too; diff and the bare fence are not.
    const keywordIn = (rows: readonly Row[]) => rows.flatMap((r) => r.spans).some((s) => s.token !== "code.default" && s.code);
    const highlightedBlocks = blocks.map(keywordIn);
    // php, php, ts, json, bash, diff, sql, none, python
    expect(highlightedBlocks).toEqual([true, true, true, true, true, false, true, false, true]);
  }, 20000);

  test("fence-first: both PHP fences highlighted, with and without <?php, and the tag's block has class in code.keyword", async () => {
    const [first, second] = await highlighted(FENCE_FIRST_TEXT);
    expect(spanExactly(first!, "class")?.token).toBe("code.keyword");
    expect(spanExactly(first!, "sprintf")?.token).toBe("code.function");
    expect(spanExactly(second!, "new")?.token).toBe("code.keyword");
    expect(wordTokens(second!, "$receipt")).toEqual(["code.operator", "code.variable"]);
  }, 20000);

  test("TSX element: const in code.keyword, the element name Box in code.tag, and the block's rows unchanged by the highlight (opentui-0-6 task 5.1)", async () => {
    const markdown = '```tsx\nconst el = <Box title="x" />;\n```\n';
    const before = new MessageLayout(markdown, 61, DEFAULT_GLYPHS).blocks().filter((b) => b.token.type === "code")[0]!.rows;
    const [rows] = await highlighted(markdown);
    expect(spanExactly(rows!, "const")?.token).toBe("code.keyword");
    expect(spanExactly(rows!, "Box")?.token).toBe("code.tag");
    // The highlight recolours the block's rows, never their number or text.
    expect(rows!.length).toBe(before.length);
    expect(rows!.map(rowText)).toEqual(before.map(rowText));
  }, 20000);

  test("offsets are UTF-16 code units: text after non-ASCII characters is coloured in the right place", async () => {
    const [rows] = await highlighted('```php\n$café = "naïve 🙂 ünïcode";\necho strlen($café);\n```\n');
    expect(spanExactly(rows!, "strlen")?.token).toBe("code.function");
    expect(spanExactly(rows!, "echo")?.token).toBe("code.keyword");
    expect(tokensOf(rows!, "naïve")).toEqual(["code.string"]);
  }, 20000);
});

describe("Highlighting arriving after the first frame (task 8.6)", () => {
  let setup: Awaited<ReturnType<typeof testRender>> | undefined;
  let store: SessionStore | undefined;
  afterEach(async () => {
    await setup?.dispose();
    store?.dispose();
    setup = undefined;
    store = undefined;
  });

  test("changes no row count: the frame's text is identical before and after, only the colours change", async () => {
    clearHighlightCache();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let asked = 0;
    setHighlighter(async (source) => {
      asked += 1;
      await gate;
      registerGrammars();
      const result = await getTreeSitterClient().highlightOnce(source.text, source.filetype);
      return result.highlights ?? [];
    });
    const markdown = "Before the code.\n\n```php\n<?php\nfinal class Late\n{\n    public function go(): void {}\n}\n```\n\nAfter the code.";
    const update: SessionUpdate = { sessionUpdate: "agent_message_chunk", messageId: "m", content: { type: "text", text: markdown } };
    const session = runUpdates([update], "go");
    store = createSessionStore({ home: "/w" });
    const actions: AppActions = { prompt: () => null, cancel() {}, answerPermission: () => false, exit() {} };
    const theme = resolveTheme(DEFAULT_THEME, { terminal: { foreground: "#bcbec4", background: "#191a1c" } });
    const context: AppContextValue = { store, actions, theme };
    setup = await testRender(() => <App context={context} layout={resolveLayout(DEFAULT_LAYOUT)} />, { width: 63, height: 40, screenMode: "alternate-screen" });
    store.attach({ getSession: () => session, subscribe: () => () => {} });
    const settle = async () => {
      for (let i = 0; i < 10; i++) {
        await setup!.flush();
        await setup!.renderOnce();
        await Bun.sleep(5);
      }
    };
    await settle();
    const before = setup.captureCharFrame();
    expect(before).toContain("After the code.");
    expect(asked).toBe(1);
    const classColour = () => {
      const frame = setup!.captureSpans();
      const line = frame.lines.find((l) => l.spans.map((s) => s.text).join("").includes("final class Late"))!;
      return line.spans.find((s) => s.text.includes("class"))!;
    };
    // First frame: not yet highlighted, the block already on its fill with its label.
    expect(classColour().fg.equals(theme.color("code.default"))).toBe(true);
    expect(classColour().bg.equals(theme.color("surface.code"))).toBe(true);
    expect(before.split("\n").find((l) => l.includes("<?php"))!.trimEnd().endsWith("php")).toBe(true);

    release();
    for (let i = 0; i < 200 && !classColour().fg.equals(theme.color("code.keyword")); i++) await settle();
    const after = setup.captureCharFrame();
    expect(classColour().fg.equals(theme.color("code.keyword"))).toBe(true);
    expect(classColour().text.trim()).toBe("class");
    expect(after).toBe(before);
  }, 30000);
});
