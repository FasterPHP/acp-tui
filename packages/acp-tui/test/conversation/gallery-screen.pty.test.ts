// Golden screen dumps of the whole markdown-gallery (mvp-rendering task 4.7): the real acp-tui
// under the PTY harness at 63x600 and 100x600, with dark and with light OSC 10 and 11 answers,
// held per tag in test/conversation/golden/screen/ (format: gallery-screen.ts). `UPDATE_GOLDEN=1`
// rewrites them, and the diff is reviewed against docs/phase-1a-notes/markdown-audit.md section 3.
// Refreshed for OpenTUI 0.6.1 (opentui-0-6 task 5.2): its TypeScript grammar no longer captures a
// plain identifier as `variable`, so `insideList` (M18), `res` and `id` (M21) are drawn in
// `code.default`; keywords, functions, strings, constants and types keep their tokens.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DARK, LIGHT, runGallery, SCREEN_TAGS, screenGoldenText } from "./gallery-screen.ts";
import type { CliRun } from "./cli.ts";
import { WINDOWS } from "../windows.ts";

const SCREEN_GOLDEN_DIR = join(import.meta.dir, "golden", "screen");
const WIDTHS = [63, 100] as const;
const UPDATE = process.env["UPDATE_GOLDEN"] === "1";

const dumps = new Map<string, Map<string, string[]>>();
const runs: CliRun[] = [];

beforeAll(async () => {
  for (const width of WIDTHS) {
    for (const [name, colours] of [["dark", DARK], ["light", LIGHT]] as const) {
      const { run, dump } = await runGallery(width, colours);
      runs.push(run);
      run.session.kill("SIGTERM");
      await run.session.dispose();
      dumps.set(`${width}/${name}`, dump);
    }
  }
}, 240000);

afterAll(async () => {
  for (const run of runs) {
    run.session.kill("SIGTERM");
    await run.session.dispose();
  }
});

// Skipped on Windows: golden screen dumps: the light theme needs OSC 10/11 colour replies, which ConPTY never passes on (it passes only OSC 4), and ConPTY redraws some emoji at its own widths.
describe.skipIf(WINDOWS)("golden screen dumps of the markdown gallery (task 4.7)", () => {
  test("every tag is on screen at both widths, in both themes, and nothing else", () => {
    for (const [key, dump] of dumps) expect([...dump.keys()].sort(), key).toEqual([...SCREEN_TAGS].sort());
  });

  for (const tag of SCREEN_TAGS) {
    test(`${tag} at ${WIDTHS.join(" and ")} columns, dark and light`, () => {
      const text = screenGoldenText(tag, WIDTHS, dumps);
      const path = join(SCREEN_GOLDEN_DIR, `${tag}.txt`);
      if (UPDATE) {
        mkdirSync(SCREEN_GOLDEN_DIR, { recursive: true });
        writeFileSync(path, text);
      }
      if (!existsSync(path)) throw new Error(`missing golden file screen/${tag}.txt: run with UPDATE_GOLDEN=1 and review it`);
      expect(text).toBe(readFileSync(path, "utf8"));
    });
  }
});
