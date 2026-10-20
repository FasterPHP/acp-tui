// parallel-tests task 3.4: the 5000-line diff test, which ends with a time bound (the diff of 5000 lines with scattered edits takes under 2 s), so it runs in the serial pass.
// What the file covers is in the header of diff.test.ts; its helpers are in diff-helpers.ts.
import { describe, expect, test } from "bun:test";
import { diffLines } from "../../src/conversation/diff.ts";
import { text, apply } from "./diff-helpers.ts";

describe("diffLines property", () => {
  test("a 5000-line file with scattered edits stays fast", () => {
    const a = Array.from({ length: 5000 }, (_, i) => `line ${i}`);
    const b = a.map((l, i) => (i % 97 === 0 ? `${l} changed` : l));
    const started = performance.now();
    const ops = diffLines(text(...a), text(...b));
    expect(performance.now() - started).toBeLessThan(2000);
    expect(apply(ops)).toEqual({ before: a, after: b });
  });
});
