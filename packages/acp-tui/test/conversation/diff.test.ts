// Task 9.1 (Phase 0): the local line diff for tool cards (design D9). Fixed cases for the
// unified format, and a property test: the edit script turns the old text
// into the new one and is minimal (its length matches an LCS by dynamic
// programming) over generated inputs.
//
// The timing tests of this file are in diff.timing.test.ts (parallel-tests: they run in the serial pass).
import { describe, expect, test } from "bun:test";
import { diffLines, numberedDiff, toHunks, unifiedDiff } from "../../src/conversation/diff.ts";
import { text, printed, apply, lcs } from "./diff-helpers.ts";

describe("unifiedDiff", () => {
  test("a replacement in the middle, with three lines of context", () => {
    const before = text("a", "b", "c", "d", "e", "f", "g", "h", "i");
    const after = text("a", "b", "c", "d", "E", "f", "g", "h", "i");
    expect(printed("f.txt", before, after)).toEqual([
      "--- f.txt",
      "+++ f.txt",
      "@@ -2,7 +2,7 @@",
      " b",
      " c",
      " d",
      "-e",
      "+E",
      " f",
      " g",
      " h",
    ]);
  });

  test("three lines replaced by twelve, with context on both sides", () => {
    const before = text(...Array.from({ length: 15 }, (_, i) => `line ${i + 1}`));
    const after = text(
      ...Array.from({ length: 7 }, (_, i) => `line ${i + 1}`),
      ...Array.from({ length: 12 }, (_, i) => `new line ${i + 1}`),
      ...Array.from({ length: 5 }, (_, i) => `line ${i + 11}`),
    );
    const out = printed("/work/src/index.ts", before, after);
    expect(out[2]).toBe("@@ -5,9 +5,18 @@");
    expect(out.filter((l) => l.startsWith("-") && !l.startsWith("---"))).toEqual(["-line 8", "-line 9", "-line 10"]);
    expect(out.filter((l) => l.startsWith("+") && !l.startsWith("+++"))).toHaveLength(12);
  });

  test("distant changes make separate hunks; close ones merge", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `l${i + 1}`);
    const changed = lines.map((l, i) => (i === 2 || i === 25 ? `${l}!` : l));
    const hunks = toHunks(diffLines(text(...lines), text(...changed)));
    expect(hunks.map((h) => [h.oldStart, h.oldLines, h.newStart, h.newLines])).toEqual([
      [1, 6, 1, 6],
      [23, 7, 23, 7],
    ]);
    const near = lines.map((l, i) => (i === 2 || i === 8 ? `${l}!` : l));
    expect(toHunks(diffLines(text(...lines), text(...near)))).toHaveLength(1);
  });

  test("a new file (oldText null) and a deleted body", () => {
    expect(printed("n.txt", null, text("one", "two"))).toEqual(["--- /dev/null", "+++ n.txt", "@@ -0,0 +1,2 @@", "+one", "+two"]);
    expect(printed("d.txt", text("one", "two"), "")).toEqual(["--- d.txt", "+++ d.txt", "@@ -1,2 +0,0 @@", "-one", "-two"]);
  });

  test("ranges of one line omit the count (as GNU diff -u prints them)", () => {
    expect(printed("t.txt", text("b"), text("a", "b"))).toEqual(["--- t.txt", "+++ t.txt", "@@ -1 +1,2 @@", "+a", " b"]);
  });

  test("identical texts: no hunks, a note", () => {
    expect(printed("s.txt", text("x"), text("x"))).toEqual(["--- s.txt", "+++ s.txt", "(no changes)"]);
  });

  test("a missing final newline is a change and is marked", () => {
    expect(printed("n.txt", "a\nb\n", "a\nb")).toEqual([
      "--- n.txt",
      "+++ n.txt",
      "@@ -1,2 +1,2 @@",
      " a",
      "-b",
      "+b",
      "\\ No newline at end of file",
    ]);
  });
});

describe("diffLines property", () => {
  test("reconstructs both sides and is minimal, over 500 generated pairs", () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const alphabet = ["a", "b", "c", "d", ""];
    const gen = (n: number) => Array.from({ length: n }, () => alphabet[Math.floor(random() * alphabet.length)]!);
    for (let k = 0; k < 500; k++) {
      const a = gen(Math.floor(random() * 25));
      const b = random() < 0.3 ? a.map((l) => (random() < 0.2 ? `${l}x` : l)) : gen(Math.floor(random() * 25));
      const ops = diffLines(text(...a), text(...b));
      expect(apply(ops)).toEqual({ before: a, after: b });
      const changes = ops.filter((op) => op.kind !== "equal").length;
      expect(changes).toBe(a.length + b.length - 2 * lcs(a, b));
    }
  });
});

describe("numberedDiff (phase-1a task 7.3: expanded cards with signs and line numbers)", () => {
  test("context and added lines carry the new line number, removed lines the old one", () => {
    const rows = numberedDiff(text("a", "b", "c", "d"), text("a", "x", "c", "d", "e"));
    expect(rows.map((r) => [r.kind, r.number, r.sign, r.text])).toEqual([
      ["hunk", null, "", "@@ -1,4 +1,5 @@"],
      ["equal", 1, " ", "a"],
      ["remove", 2, "-", "b"],
      ["add", 2, "+", "x"],
      ["equal", 3, " ", "c"],
      ["equal", 4, " ", "d"],
      ["add", 5, "+", "e"],
    ]);
  });

  test("no changes, and a missing final newline", () => {
    expect(numberedDiff("a\n", "a\n")).toEqual([{ kind: "note", number: null, sign: "", text: "(no changes)" }]);
    expect(numberedDiff("a\n", "a\nb").at(-1)!.text).toBe("\\ No newline at end of file");
  });
});
