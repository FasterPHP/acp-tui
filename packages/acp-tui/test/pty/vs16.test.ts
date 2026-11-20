// The harness emulator's count of a narrow base with VS16 (test/pty/vs16.ts): `narrow` is xterm.js
// 6 as it is (1 cell, as Zed), `wide` counts as ConPTY and the terminals behind it (2 cells, as
// acp-tui and OpenTUI lay it out). Only VS16 sequences that Bun.stringWidth counts as 2 widen.
import { describe, expect, test } from "bun:test";
import { Terminal as XTerm } from "@xterm/headless";
import { widenVs16 } from "./vs16.ts";

async function columnOf(text: string, marker: string, wide: boolean): Promise<number> {
  const term = new XTerm({ cols: 20, rows: 2, allowProposedApi: true });
  if (wide) widenVs16(term);
  await new Promise<void>((r) => term.write(text, r));
  const line = term.buffer.active.getLine(0)!;
  for (let x = 0; x < term.cols; x++) if (line.getCell(x)?.getChars() === marker) return x;
  return -1;
}

describe("the PTY emulator's VS16 width", () => {
  test("narrow: xterm.js as it is counts ⚠️ and ❤️ in 1 cell", async () => {
    expect(await columnOf("⚠️X", "X", false)).toBe(1);
    expect(await columnOf("❤️X", "X", false)).toBe(1);
  });

  test("wide: ⚠️ and ❤️ take 2 cells, the sequence kept whole in the first", async () => {
    expect(await columnOf("⚠️X", "X", true)).toBe(2);
    expect(await columnOf("a❤️X", "X", true)).toBe(3);
    expect(await columnOf("⚠️X", "⚠️", true)).toBe(0);
  });

  test("wide: everything else is xterm.js's (a bare ⚠, 1 with VS16, a combining accent, CJK)", async () => {
    expect(await columnOf("⚠X", "X", true)).toBe(1);
    expect(await columnOf("1️X", "X", true)).toBe(1);
    expect(await columnOf("éX", "X", true)).toBe(1);
    expect(await columnOf("中X", "X", true)).toBe(2);
  });
});
