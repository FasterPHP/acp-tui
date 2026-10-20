// The user card's height estimate (mvp-rendering task 10.2): `wordWrappedRows` against the rows
// OpenTUI's `<text wrapMode="word">` really lays out, over sample prompts (Japanese, Korean and
// full-width text included) and random texts rich in the punctuation OpenTUI breaks after, at
// widths from 5 to 98. Found by the "Gallery estimates" scenario at 40 columns, where a prompt
// with a path wrapped after a `/` and the old character-wrap estimate was a row short. Random
// mixes of wide characters, full-width forms and punctuation with no spaces are not modelled
// exactly (OpenTUI's rules there were not worth reproducing: an estimate only needs to be close,
// and the anchor absorbs a row). Needs the root bunfig `[test] preload`.
import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import type { Renderable } from "@opentui/core";
import { wordWrappedRows } from "../../../src/conversation/window/heights.ts";

const SAMPLES = [
  "Can you look at how src/Http/Router.php handles this and tell me what you find?",
  "The tests around tests/Unit/QueryBuilderTest.php are flaky. What is going on?",
  "a-very-long-hyphenated-word-that-keeps-going and some more words after it here",
  "path/with/slashes/that/is/longer/than/the/width/of/the/pane/for/sure ok",
  "日本語のテキスト and 中文字符 mixed with English words in one line here",
  "multiple   spaces   between   words   that   need   wrapping   somewhere   now",
  "emoji 😀 🚀 👍 ✅ and more words to wrap around the edge of it",
  "comma,separated,values,without,spaces,that,go,on,and,on,and,on",
  "two lines\nthe second one is a little longer than the first one is",
  "ends with spaces   ",
  "日本語の文章は単語の間に空白を入れないので、行の途中で折り返されます。",
  "한국어 문장은 단어 사이에 공백을 넣어서 씁니다 그리고 계속됩니다",
  "full-width ＡＢＣ１２３ and mixed English 混合 text in one line",
  "",
];

function randomTexts(n: number): string[] {
  const parts = ["word", "a", "longerword", "x", " ", "  ", "-", "/", ",", ".", "(", ")", "[", "]", "{", "}", "!", "?", ":", ";", "\\", "_", "=", "+", "@", "#", "😀", "é", "\n"];
  let seed = 0x5eed_77;
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
  return Array.from({ length: n }, () => {
    let text = "";
    const length = 3 + (next() % 40);
    for (let k = 0; k < length; k++) text += parts[next() % parts.length];
    return text;
  });
}

async function opentuiRows(texts: readonly string[], width: number): Promise<number[]> {
  const setup = await testRender(
    () => (
      <box flexDirection="column" width={width}>
        {texts.map((text, i) => (
          <text id={`t${i}`} wrapMode="word" width={width}>
            {text}
          </text>
        ))}
      </box>
    ),
    { width, height: 40 },
  );
  await setup.renderOnce();
  const rows = texts.map((_, i) => (setup.renderer.root.findDescendantById(`t${i}`) as Renderable).getLayout().height);
  await setup.dispose();
  return rows;
}

describe("wordWrappedRows: OpenTUI's word wrap without mounting", () => {
  const texts = [...SAMPLES, ...randomTexts(300)];
  for (const width of [5, 8, 13, 23, 38, 40, 61, 98]) {
    test(`${width} columns`, async () => {
      const real = await opentuiRows(texts, width);
      const wrong = texts.flatMap((text, i) => {
        // An empty text is one row in the card (its accent), whatever OpenTUI gives an empty node.
        const expected = Math.max(1, real[i]!);
        const estimate = wordWrappedRows(text, width);
        return expected === estimate ? [] : [`${JSON.stringify(text)}: OpenTUI ${expected}, estimate ${estimate}`];
      });
      expect(wrong).toEqual([]);
    });
  }
});
