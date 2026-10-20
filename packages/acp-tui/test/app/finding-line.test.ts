// mvp-sessions task 12.11: the line printed while `--resume <id>` and `--continue` find their
// session, and its removal.
import { describe, expect, test } from "bun:test";
import { FINDING_LINE, showFinding } from "../../src/app/finding-line.ts";

function output(isTTY: boolean | undefined) {
  const writes: string[] = [];
  return { isTTY, write: (text: string) => writes.push(text), writes };
}

describe("The finding line", () => {
  test("the text, with the Unicode ellipsis", () => {
    expect(FINDING_LINE).toBe("acp-tui: finding session…");
  });

  test("on a terminal: printed without a newline, removed with a carriage return and erase line, once", () => {
    const out = output(true);
    const remove = showFinding(out);
    expect(out.writes).toEqual([FINDING_LINE]);
    remove();
    remove();
    expect(out.writes).toEqual([FINDING_LINE, "\r\x1b[2K"]);
  });

  test("without a terminal: nothing is written, not even the erase", () => {
    for (const isTTY of [false, undefined]) {
      const out = output(isTTY);
      showFinding(out)();
      expect(out.writes).toEqual([]);
    }
  });
});
