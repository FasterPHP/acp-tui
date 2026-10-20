// Shared by file-picker.pty.test.ts and file-picker.pty.timing.test.ts (split by the change parallel-tests, tasks 3.x). Not a test file.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PtySession } from "../pty/harness.ts";
import { promptText } from "../pty/regions.ts";
import { boxRows, inner, type ChromeRun } from "./cli.ts";

/** A directory under $TMPDIR holding `files` (relative path to content). */
export function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-files-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

export const picker = (s: PtySession) => boxRows(s, /─ Files \d/);
export const pickerOpen = (s: PtySession) => picker(s).length > 0;
/** The picker's list rows, without the frame. */
export const pickerList = (s: PtySession) => picker(s).slice(1, -1).map(inner);
export const draft = (s: PtySession) => promptText(s).join("\n").trim();
export const prompts = (run: ChromeRun) => run.agent().filter((e) => e.method === "session/prompt") as { params: { promptBlockCount: number } }[];
export const screen = (s: PtySession) => s.screenText().join("\n");

export const SECRET = "SECRET-FILE-CONTENT";
export const PROJECT = {
  "src/Db/Connection.php": `<?php\n// ${SECRET}\nclass Connection {}\n`,
  "src/Db/Query.php": "<?php\n",
  "vendor/autoload.php": "<?php\n",
  "vendor/conn/Connector.php": "<?php\n",
  ".gitignore": "vendor/\n",
  "README.md": "# project\n",
};

/** Types `before` and `@`, then mentions the picker's first match for `filter` with Enter; the
 *  draft then ends with the mention. */
export async function mentionFirst(run: ChromeRun, before: string, filter: string, expected: string): Promise<void> {
  const prefix = draft(run.s) + before;
  run.s.sendKeys({ text: `${before}@` });
  await run.s.waitFor(() => pickerOpen(run.s), 3000);
  run.s.sendKeys({ text: filter });
  await run.s.waitFor(() => pickerList(run.s)[0] === expected, 3000);
  run.s.sendKeys("Enter");
  await run.s.waitFor(() => !pickerOpen(run.s) && draft(run.s) === `${prefix}@${expected}`, 3000);
}
