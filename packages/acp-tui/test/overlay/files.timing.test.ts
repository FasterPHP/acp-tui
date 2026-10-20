// parallel-tests task 3.3: the ranking time budget of files.test.ts (mvp-chrome-and-keys task 6.6):
// 50000 paths rank within 250 ms, a keystroke's budget. It depends on the machine's speed, so it
// runs in the serial pass.
import { describe, expect, test } from "bun:test";
import { rankFiles } from "../../src/overlay/files.ts";

describe("fuzzy ranking", () => {
  test("50000 paths rank within a keystroke's budget", () => {
    const many = Array.from({ length: 50000 }, (_, i) => `src/module${i % 500}/sub${i % 37}/File${i}.php`);
    const low = many.map((p) => p.toLowerCase());
    const t0 = performance.now();
    const ranked = rankFiles("mod12file", many, low);
    const ms = performance.now() - t0;
    expect(ranked.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(250);
  });
});
