// The `@` file picker and file mentions (mvp-chrome-and-keys tasks 6.6 and
// 6.7; spec tui-palette "File picker" and "File mentions are sent as resource
// links", tui-agent-session "Prompt turns"). The real CLI against fake-agent's
// `basic`, started in a directory of its own under $TMPDIR (the session's
// `cwd`), without `--spike`. `basic` echoes the prompt's block types
// (`Prompt blocks: text, resource_link file:///...`) for a prompt that is not
// a single text block, and fake-agent's `--log` records each prompt's block
// count.
//
// The timing tests of this file are in file-picker.pty.timing.test.ts (parallel-tests: they run in the serial pass).
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { PtySession } from "../pty/harness.ts";
import { READY } from "../pty/regions.ts";
import { startChrome, type ChromeRun } from "./cli.ts";
import { tree, picker, pickerOpen, pickerList, draft, prompts, screen, SECRET, PROJECT, mentionFirst } from "./file-picker-helpers.ts";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

/** At 63x21 by default; `wide` gives room for the whole echo line and reply (200x60); `args` are
 *  acp-tui's options. */
function start(cwd: string, wide = false, args: string[] = []): ChromeRun {
  const run = startChrome({ scenario: "basic", args, cwd, ...(wide ? { cols: 200, rows: 60 } : {}) });
  session = run.s;
  return run;
}

describe("the @ file picker (tui-palette \"File picker\")", () => {
  test("Ignored files left out: `@conn` lists src/Db/Connection.php and nothing under vendor/", async () => {
    const run = start(tree(PROJECT));
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "@" });
    await run.s.waitFor(() => pickerOpen(run.s) && pickerList(run.s).includes("README.md"), 3000);
    expect(pickerList(run.s).some((r) => r.startsWith("vendor/"))).toBe(false);
    // Above the prompt box: the picker's bottom border is the row above the prompt box's top.
    const rows = run.s.screenText();
    const bottom = rows.findIndex((r) => r.startsWith("╰─ ↑↓ select"));
    expect(rows[bottom + 1]!.startsWith("╭")).toBe(true);
    expect(picker(run.s).length).toBeLessThanOrEqual(8);
    run.s.sendKeys({ text: "conn" });
    await run.s.waitFor(() => pickerList(run.s)[0] === "src/Db/Connection.php", 3000);
    // The typed text stays in the draft and filters the list.
    expect(draft(run.s)).toBe("@conn");
    expect(picker(run.s).join("\n")).not.toContain("vendor/");
    // Esc closes the picker, leaving the typed text.
    run.s.sendKeys("Esc");
    await run.s.waitFor(() => !pickerOpen(run.s), 3000);
    expect(draft(run.s)).toBe("@conn");
  }, 30000);

  test("Not after a word: `me@example.com` opens no picker; `@` after a space does", async () => {
    const run = start(tree(PROJECT));
    await run.s.waitFor(READY, 10000);
    for (const ch of "me@example.com") run.s.sendKeys({ text: ch });
    await run.s.waitFor(() => draft(run.s) === "me@example.com", 3000);
    // A negative: give a picker time to have opened (it opens within a frame of the key).
    await Bun.sleep(300);
    await run.s.flush();
    expect(pickerOpen(run.s)).toBe(false);
    expect(run.events("file_picker")).toHaveLength(0);
    run.s.sendKeys({ text: " @" });
    await run.s.waitFor(() => pickerOpen(run.s), 3000);
  }, 30000);

  test("a pasted `@` opens no picker", async () => {
    const run = start(tree(PROJECT));
    await run.s.waitFor(READY, 10000);
    run.s.paste("see @src");
    await run.s.waitFor(() => draft(run.s) === "see @src", 3000);
    await Bun.sleep(300);
    await run.s.flush();
    expect(pickerOpen(run.s)).toBe(false);
  }, 30000);
});

describe("mentions sent as resource links (tui-palette, tui-agent-session \"Prompt turns\")", () => {
  test("Link, not content: `Explain @src/Db/Connection.php` is a text block and a resource_link with the file's URI", async () => {
    const cwd = tree(PROJECT);
    const run = start(cwd, true);
    await run.s.waitFor(READY, 10000);
    await mentionFirst(run, "Explain ", "conn", "src/Db/Connection.php");
    // The mention is marked in the draft: drawn in another colour than the text before it.
    await run.s.flush();
    const y = run.s.screenText().findIndex((r) => r.includes("│ Explain @src/Db/Connection.php"));
    const x = run.s.screenText()[y]!.indexOf("Explain");
    const colour = (cx: number) => {
      const cell = run.s.cell(y, cx)!;
      return `${cell.getFgColorMode()}:${cell.getFgColor()}`;
    };
    expect(colour(x + 8)).not.toBe(colour(x));
    expect(colour(x + 8 + "@src/Db/Connection.php".length - 1)).toBe(colour(x + 8));
    run.s.sendKeys("Enter");
    const uri = pathToFileURL(join(cwd, "src/Db/Connection.php")).href;
    await run.s.waitFor(`Prompt blocks: text, resource_link ${uri}`, 5000);
    // Exactly two blocks: the text and the link, no `resource` (content) block.
    expect(prompts(run).map((p) => p.params.promptBlockCount)).toEqual([2]);
    expect(screen(run.s)).toContain("Explain @src/Db/Connection.php");
    expect(screen(run.s)).not.toContain(SECRET);
  }, 30000);

  // opentui-0-6 task 4.2: the draft holds no control character the paste carried, so the
  // mention's range (counted in the draft's text) and the editor's offsets agree.
  test("A mention chosen after a paste with control characters is highlighted over exactly its text and sent as its resource_link", async () => {
    const cwd = tree(PROJECT);
    const run = start(cwd, true);
    await run.s.waitFor(READY, 10000);
    run.s.paste("Look\x07 at\x00\x7f\u0085");
    await run.s.waitFor(() => draft(run.s) === "Look at", 3000);
    await mentionFirst(run, " ", "conn", "src/Db/Connection.php");
    await run.s.flush();
    const y = run.s.screenText().findIndex((r) => r.includes("│ Look at @src/Db/Connection.php"));
    expect(y).toBeGreaterThanOrEqual(0);
    const x = run.s.screenText()[y]!.indexOf("Look at");
    const colour = (cx: number) => {
      const cell = run.s.cell(y, cx)!;
      return `${cell.getFgColorMode()}:${cell.getFgColor()}`;
    };
    const at = x + "Look at ".length;
    const end = at + "@src/Db/Connection.php".length - 1;
    // The text before the mention and after it in the plain colour; the mention, and only it, marked.
    expect(colour(at - 1)).toBe(colour(x));
    expect(colour(at)).not.toBe(colour(x));
    expect(colour(end)).toBe(colour(at));
    run.s.sendKeys({ text: "!" });
    await run.s.waitFor(() => draft(run.s) === "Look at @src/Db/Connection.php!", 3000);
    expect(colour(end + 1)).toBe(colour(x));
    run.s.sendKeys("Enter");
    const uri = pathToFileURL(join(cwd, "src/Db/Connection.php")).href;
    await run.s.waitFor(`Prompt blocks: text, resource_link ${uri}`, 5000);
    expect(prompts(run).map((p) => p.params.promptBlockCount)).toEqual([2]);
  }, 30000);

  // opentui-0-6-6 design D4, scenario "Mention after a typed emoji": a terminal delivers an emoji
  // with a skin tone, or a ZWJ family, one code point at a time. OpenTUI 0.6.1's editor added the
  // chunks' widths (4 for the skin tone, 8 for the family, where `Bun.stringWidth` and
  // `mentions.ts` say 2); 0.6.2 measures the merged grapheme (#1650). In the CLI the divergence
  // shows in the editor's cursor offset, which `mentions.ts` reads in `Bun.stringWidth` columns:
  // after the emoji and the space the terminal's cursor was two (four) columns too far right on
  // 0.6.1, and that check fails there (run once on 0.6.1, 18 October 2026). The marking itself
  // came out right on 0.6.1 as well, since choosing the file replaces the whole draft, which the
  // editor measures afresh. The text block is read back from the
  // conversation's export, which has the user's message verbatim as the model holds it, the text
  // the prompt was sent with (fake-agent's log redacts prompt text, and the exit transcript drops
  // zero-width characters such as the ZWJ).
  for (const [name, codePoints] of [
    ["a thumbs up with a skin tone", ["\u{1F44D}", "\u{1F3FD}"]],
    ["a three-person ZWJ family", ["\u{1F468}", "\u200D", "\u{1F469}", "\u200D", "\u{1F467}"]],
  ] as const) {
    test(`Mention after a typed emoji (${name}): marked over exactly its text and sent as text and its resource_link`, async () => {
      const cwd = tree(PROJECT);
      const run = start(cwd, true);
      await run.s.waitFor(READY, 10000);
      const emoji = codePoints.join("");
      // One write per code point, each given time to be read on its own, as a terminal delivers them.
      for (const cp of [...codePoints, " "]) {
        run.s.sendKeys({ text: cp });
        await Bun.sleep(120);
        await run.s.flush();
      }
      // The cursor stands right after the space: the editor's offset is `Bun.stringWidth`'s. The
      // prompt box's text starts in column 2 (the frame and its padding column).
      expect(run.s.term.buffer.active.cursorX).toBe(2 + Bun.stringWidth(emoji) + 1);
      run.s.sendKeys({ text: "@" });
      await run.s.waitFor(() => pickerOpen(run.s), 3000);
      run.s.sendKeys({ text: "conn" });
      await run.s.waitFor(() => pickerList(run.s)[0] === "src/Db/Connection.php", 3000);
      run.s.sendKeys("Enter");
      await run.s.waitFor(() => !pickerOpen(run.s) && draft(run.s).endsWith(" @src/Db/Connection.php"), 3000);
      run.s.sendKeys({ text: "!" });
      await run.s.waitFor(() => draft(run.s).endsWith("@src/Db/Connection.php!"), 3000);
      await run.s.flush();
      // The prompt box's row, cell by cell: the `@` is found by its cell, not by a string index.
      const y = run.s.screenText().findIndex((r) => r.startsWith("│") && r.includes("@src/Db/Connection.php!"));
      expect(y).toBeGreaterThanOrEqual(0);
      const cells = Array.from({ length: run.s.term.cols }, (_, x) => run.s.cell(y, x)!);
      const at = cells.findIndex((c) => c.getChars() === "@");
      expect(at).toBeGreaterThan(0);
      const first = cells.findIndex((c, x) => x > 0 && c.getChars() !== "" && c.getChars() !== " ");
      expect(cells[first]!.getChars()).toStartWith(codePoints[0]);
      const colour = (x: number) => `${cells[x]!.getFgColorMode()}:${cells[x]!.getFgColor()}`;
      const plain = colour(first);
      const end = at + "@src/Db/Connection.php".length - 1;
      // The mention, and only it, is marked: every cell from the emoji to the space before the `@`
      // is plain, each of the mention's cells marked, and the `!` after it plain again.
      for (let x = first; x < at; x++) expect(`${x} ${colour(x)}`).toBe(`${x} ${plain}`);
      expect(colour(at)).not.toBe(plain);
      for (let x = at; x <= end; x++) expect(`${x} ${colour(x)}`).toBe(`${x} ${colour(at)}`);
      expect(cells.slice(at, end + 1).map((c) => c.getChars()).join("")).toBe("@src/Db/Connection.php");
      expect(colour(end + 1)).toBe(plain);
      // Sent: the text block as typed and the file's resource_link, two blocks.
      run.s.sendKeys("Backspace");
      await run.s.waitFor(() => draft(run.s).endsWith("@src/Db/Connection.php"), 3000);
      run.s.sendKeys("Enter");
      const uri = pathToFileURL(join(cwd, "src/Db/Connection.php")).href;
      await run.s.waitFor(`Prompt blocks: text, resource_link ${uri}`, 5000);
      expect(prompts(run).map((p) => p.params.promptBlockCount)).toEqual([2]);
      run.s.sendKeys("Ctrl+P");
      await run.s.waitFor(/Commands \d+/, 3000);
      run.s.sendKeys({ text: "export" });
      await run.s.waitFor(/Export the conversation as Markdown to a file/, 3000);
      run.s.sendKeys("Enter");
      await run.s.waitFor(() => run.events("export").length === 1, 5000);
      const exported = readFileSync(String(run.events("export")[0]!["path"]), "utf8").split("\n");
      expect(exported[exported.indexOf("## User") + 2]).toBe(`${emoji} @src/Db/Connection.php`);
    }, 30000);
  }

  test("Edited mention: a character deleted inside the mention sends the text block only", async () => {
    const run = start(tree(PROJECT), true);
    await run.s.waitFor(READY, 10000);
    await mentionFirst(run, "Explain ", "conn", "src/Db/Connection.php");
    // Back into the mention (`.p|hp`) and delete the `p` of `.php`.
    for (let i = 0; i < 2; i++) run.s.sendKeys("Left");
    run.s.sendKeys("Backspace");
    await run.s.waitFor(() => draft(run.s) === "Explain @src/Db/Connection.hp", 3000);
    run.s.sendKeys("Enter");
    await run.s.waitFor(() => prompts(run).length === 1, 5000);
    await run.s.waitFor("Streamed answer", 5000);
    expect(prompts(run)[0]!.params.promptBlockCount).toBe(1);
    expect(screen(run.s)).not.toContain("Prompt blocks:");
  }, 30000);

  test("Plain prompt: a prompt without mentions is exactly one text block", async () => {
    const run = start(tree(PROJECT), true);
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "hello there" });
    await run.s.waitFor(() => draft(run.s) === "hello there", 3000);
    run.s.sendKeys("Enter");
    await run.s.waitFor(() => prompts(run).length === 1, 5000);
    await run.s.waitFor("Streamed answer", 5000);
    expect(prompts(run)[0]!.params.promptBlockCount).toBe(1);
    expect(screen(run.s)).not.toContain("Prompt blocks:");
  }, 30000);

  test("text typed after a mention keeps it; two mentions send two links in order", async () => {
    const cwd = tree(PROJECT);
    const run = start(cwd, true);
    await run.s.waitFor(READY, 10000);
    await mentionFirst(run, "Compare ", "query", "src/Db/Query.php");
    await mentionFirst(run, ", ", "readme", "README.md");
    run.s.sendKeys({ text: " please" });
    await run.s.waitFor(() => draft(run.s).endsWith("please"), 3000);
    run.s.sendKeys("Enter");
    const uri = (p: string) => pathToFileURL(join(cwd, p)).href;
    await run.s.waitFor(`Prompt blocks: text, resource_link ${uri("src/Db/Query.php")}, resource_link ${uri("README.md")}`, 5000);
    expect(prompts(run).map((p) => p.params.promptBlockCount)).toEqual([3]);
  }, 30000);

  // day-two-feedback task 9.1, tui-keymap "Undo and redo in the prompt box": an inserted mention is
  // one undo step, which brings back the `@` and the filter typed.
  test("a mention is one undo step: Ctrl+Z gives back `Explain @conn`, and Ctrl+Y the mention", async () => {
    const cwd = tree(PROJECT);
    const run = start(cwd, true);
    await run.s.waitFor(READY, 10000);
    await mentionFirst(run, "Explain ", "conn", "src/Db/Connection.php");
    run.s.sendKeys({ text: "\x1a" });
    await run.s.waitFor(() => draft(run.s) === "Explain @conn", 3000);
    run.s.sendKeys({ text: "\x19" });
    await run.s.waitFor(() => draft(run.s) === "Explain @src/Db/Connection.php", 3000);
  }, 30000);
});
