// A row that ends with a wide character at the screen's edge (src/conversation/markdown/wrap.ts
// `endsWide`; mvp-rendering; the OpenTUI note's stub 6). OpenTUI 0.5.12 lost the screen row below
// one that ended with a wide character in the terminal's last column, so acp-tui never lets a row
// that can reach the edge end with one at its full width. opentui-0-6 task 5.4: the rule's own
// checks, and OpenTUI's behaviour in-process, on the version installed.
import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { displayWidth } from "../../../src/layout/segments.ts";
import { endsWide, fitsRow, span, wrapSpans } from "../../../src/conversation/markdown/wrap.ts";
import { rowText } from "../../../src/conversation/markdown/types.ts";

describe("endsWide and the rows it keeps from the edge", () => {
  test("a wide final grapheme, emoji and CJK alike; not a narrow one or a wide one earlier", () => {
    for (const text of ["abc中", "x😀", "日本", "👍🏽"]) expect(endsWide(text), text).toBe(true);
    for (const text of ["abc", "中a", "", "é"]) expect(endsWide(text), text).toBe(false);
  });

  test("fitsRow: exactly at the limit only when the row does not end wide", () => {
    expect(fitsRow(6, 2, "中", 8)).toBe(false);
    expect(fitsRow(6, 2, "ab", 8)).toBe(true);
    expect(fitsRow(5, 2, "中", 8)).toBe(true);
  });

  test("wrapSpans never lets an edge row reach the width with a wide character, at any width", () => {
    const line = [span("漢字 かな mixed with words 中文 and 😀 emoji 日本語のテキスト", { token: "text" })];
    for (let width = 4; width <= 40; width++) {
      for (const row of wrapSpans(line, width)) {
        const text = rowText(row);
        if (displayWidth(text) === width) expect(endsWide(text), `${width}: ${text}`).toBe(false);
        expect(displayWidth(text)).toBeLessThanOrEqual(width);
      }
    }
  });
});

describe("OpenTUI in-process: the row below one ending wide in the last column", () => {
  // On 0.5.12 this check fails at 8 columns: the frame reads `aaaaaa中next row` on one row and the
  // rows below move up, the loss endsWide avoids. On 0.6.1 every row is drawn (opentui-0-6 task
  // 5.4, 12 October 2026). endsWide stays until the IDE checks show the terminals agree.
  test("each row under a row that ends with a wide character in the last column is drawn", async () => {
    for (const width of [8, 9, 20]) {
      const first = `${"a".repeat(width - 2)}中`;
      const setup = await testRender(
        () => (
          <box flexDirection="column" width={width}>
            <text wrapMode="none">{first}</text>
            <text wrapMode="none">next row</text>
            <text wrapMode="none">{first}</text>
            <text wrapMode="none">last</text>
          </box>
        ),
        { width, height: 6 },
      );
      try {
        await setup.renderOnce();
        await setup.renderOnce();
        const rows = setup.captureCharFrame().split("\n");
        expect(rows[1]!.startsWith("next row".slice(0, width)), `${width}: ${JSON.stringify(rows)}`).toBe(true);
        expect(rows[3]!.startsWith("last"), `${width}: ${JSON.stringify(rows)}`).toBe(true);
      } finally {
        await setup.dispose();
      }
    }
  });
});
