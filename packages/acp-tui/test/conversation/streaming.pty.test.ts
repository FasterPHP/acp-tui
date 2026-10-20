// Stable rendering while streaming (tui-rendering; mvp-rendering task 10.3), under the PTY harness
// against fake-agent with `--chunk 7` and `--chunk 64`:
//
// - "Message opening with a fence": `fence-first` (a message that opens with a `php` fence, then
//   a line of prose and a second `php` fence). After every write the emulator parses, every row
//   showing a line of a fence is inside a code block (on `surface.code`) whose first row carries
//   the label `php`, and no row shows three backticks.
// - "Streamed gallery": the streamed `markdown-gallery`, once finished, gives exactly the screen
//   of the gallery sent whole: the golden dumps of task 4.7 (test/conversation/golden/screen/).
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deriveSurfaces } from "../../src/theme/index.ts";
import type { PtySession } from "../pty/harness.ts";
import { READY } from "../pty/regions.ts";
import { sendPrompt, startCli, type CliRun } from "./cli.ts";
import { DARK, LIGHT, runGallery, SCREEN_ROWS, SCREEN_TAGS } from "./gallery-screen.ts";

// Imported by a computed path: acp-tui does not depend on the fake-agent package.
const { FENCE_FIRST_TEXT } = (await import(join(import.meta.dir, "../../../fake-agent/src/scenarios/fence-first.ts"))) as { FENCE_FIRST_TEXT: string };

let run: CliRun | undefined;
afterEach(async () => {
  run?.session.kill("SIGTERM");
  await run?.session.dispose();
  run = undefined;
});

const COLS = 63;
const CODE_BG = deriveSurfaces(DARK)["surface.code"].toLowerCase();
const PROSE = "And the same idea without the opening tag:";
/** The lines inside the two fences (blank lines left out). */
const FENCE_LINES = FENCE_FIRST_TEXT.split("\n")
  .filter((line) => !line.startsWith("```") && line !== PROSE)
  .map((line) => line.trim())
  .filter((line) => line !== "");

function onCode(s: PtySession, y: number, codeBg: string): boolean {
  const cell = s.cell(s.term.buffer.active.baseY + y, 2);
  return !!cell && cell.isBgRGB() && `#${cell.getBgColor().toString(16).padStart(6, "0")}` === codeBg;
}

/** What breaks the scenario on the screen as it is now; empty when nothing does. `codeBg` is the
 *  code blocks' fill. */
function violations(s: PtySession, codeBg = CODE_BG): string[] {
  const lines = s.screenText();
  const out: string[] = [];
  lines.forEach((line, y) => {
    if (line.includes("```")) out.push(`row ${y} shows three backticks: ${JSON.stringify(line)}`);
  });
  const prompt = lines.findIndex((l) => /^ {2}go$/.test(l) || l.includes(" go "));
  const box = lines.findIndex((l, y) => y > prompt && l.startsWith("╭"));
  let blockStart = -1;
  for (let y = Math.max(0, prompt + 1); y < (box < 0 ? lines.length : box); y++) {
    const text = lines[y]!.trim();
    if (onCode(s, y, codeBg)) {
      if (blockStart < 0) {
        blockStart = y;
        if (!/(^|\s)php$/.test(text)) out.push(`row ${y} starts a code block without the label php: ${JSON.stringify(lines[y])}`);
      }
      continue;
    }
    blockStart = -1;
    if (text === "" || PROSE.startsWith(text)) continue;
    if (FENCE_LINES.some((fence) => fence.startsWith(text) || text.startsWith(fence))) out.push(`row ${y} shows a fence's line outside a code block: ${JSON.stringify(lines[y])}`);
  }
  return out;
}

describe("Message opening with a fence (task 10.3)", () => {
  for (const chunk of [7, 64]) {
    test(`fence-first in chunks of ${chunk}: in every frame the fence's lines are in a code block labelled php, and no row shows three backticks`, async () => {
      // Slowed down (30 ms between chunks, 100 ms for the larger ones), so most chunks get a frame.
      run = startCli({ scenario: "fence-first", cols: COLS, rows: 60, colours: DARK, delayScale: chunk === 7 ? 3 : 10, agentArgs: ["--chunk", String(chunk)] });
      const s = run.session;
      const seen: string[] = [];
      let checks = 0;
      let showing = 0;
      const listener = s.term.onWriteParsed(() => {
        checks += 1;
        if (s.screenText().some((l) => l.includes("<?php") || l.includes("$receipt"))) showing += 1;
        for (const v of violations(s)) if (seen.length < 20 && !seen.includes(v)) seen.push(v);
      });
      try {
        await sendPrompt(s, "go");
        await s.waitFor((p) => p.screenText().some((l) => /^ {2}end turn\b/.test(l)) && READY.test(p.screenText().join("\n")), 30000);
        await s.flush();
      } finally {
        listener.dispose();
      }
      const screen = s.screenText();
      expect(screen.some((l) => l.includes("echo $receipt->format() . PHP_EOL;"))).toBe(true);
      console.log(`fence-first --chunk ${chunk}: ${checks} parsed writes checked, ${showing} with the code on screen`);
      expect(showing).toBeGreaterThan(chunk === 7 ? 40 : 6);
      expect(seen).toEqual([]);
      // The check itself: with another fill taken for the code's, the code rows count as prose.
      expect(violations(s, "#000000").length).toBeGreaterThan(5);
    }, 60000);
  }
});

/** The golden dump of `tag` at `width` columns under `theme`, from test/conversation/golden/screen/. */
function goldenDump(tag: string, width: number, theme: "dark" | "light"): string {
  const text = readFileSync(join(import.meta.dir, "golden", "screen", `${tag}.txt`), "utf8");
  const sections = text.split("\n\n").slice(1);
  const prefix = `at ${width}x${SCREEN_ROWS}, `;
  const section =
    sections.find((s) => s.startsWith(prefix) && s.split("\n")[0]!.includes(" alike:")) ??
    sections.find((s) => s.startsWith(`${prefix}${theme} (`));
  if (!section) throw new Error(`no ${width}-column ${theme} section in screen/${tag}.txt`);
  return section.split("\n").slice(1).join("\n").replace(/\n$/, "");
}

describe("Streamed gallery (task 10.3)", () => {
  for (const [chunk, width, theme] of [
    [7, 63, "dark"],
    [64, 100, "light"],
  ] as const) {
    test(`markdown-gallery in chunks of ${chunk} at ${width} columns (${theme}): the final screen equals the gallery sent whole`, async () => {
      const result = await runGallery(width, theme === "dark" ? DARK : LIGHT, chunk);
      run = result.run;
      expect([...result.dump.keys()].sort()).toEqual([...SCREEN_TAGS].sort());
      for (const tag of SCREEN_TAGS) expect(result.dump.get(tag)!.join("\n"), tag).toBe(goldenDump(tag, width, theme));
    }, 300000);
  }
});
