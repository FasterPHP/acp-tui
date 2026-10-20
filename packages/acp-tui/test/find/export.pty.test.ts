// Export of the conversation as Markdown to a file in the real CLI (phase-1a
// task 15.3): acp-tui under a PTY against fake-agent's `copy-fixtures`. The file lands in the session's working
// directory (the test's temporary directory) and equals the model's Markdown
// golden file (`test/selection/golden/export.md`, written by golden.test.ts
// from `conversationMarkdown` over the same scenario); a second export never
// overwrites the first; the palette runs it too.
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import type { PtySession } from "../pty/harness.ts";
import { WINDOWS } from "../windows.ts";
import { promptBox, READY } from "../pty/regions.ts";
import { sendPrompt, startCli, type CliRun } from "../conversation/cli.ts";

const GOLDEN = readFileSync(join(import.meta.dir, "../selection/golden/export.md"), "utf8");

let run: CliRun | undefined;
afterEach(async () => {
  run?.session.kill("SIGTERM");
  await run?.session.dispose();
  run = undefined;
});

/** Every Markdown block of `copy-fixtures` is on screen (they lay out over a few frames). */
const laidOut = (s: PtySession) =>
  ["  │ created_at", "  The third paragraph", "  ● third item"].every((prefix) => s.screenText().some((l) => l.startsWith(prefix))) &&
  // The code block's last line, after its pad column (the flat theme's rule, or the fill).
  // (After the code block's padding columns: the flat rule or the fill, and a second column.)
  s.screenText().some((l) => /^ {2}[ ▎] ?\}\s*$/.test(l));

async function start(args: string[] = [], env?: Record<string, string | undefined>): Promise<CliRun> {
  run = startCli({ scenario: "copy-fixtures", cols: 100, rows: 60, args, ...(env ? { env } : {}) });
  await sendPrompt(run.session, "give me things to copy");
  await run.session.waitFor((p) => laidOut(p) && READY.test(p.screenText().join("\n")), 15000);
  return run;
}

const exports = (r: CliRun) =>
  readdirSync(dirname(r.logPath))
    .filter((name) => /^acp-tui-.*\.md$/.test(name))
    .sort();

const toast = (s: PtySession) => promptBox(s)[0] ?? "";

describe("export as Markdown (task 15.3)", () => {
  test("`e` in the conversation writes the golden Markdown to a new file in the working directory; again, to another file", async () => {
    const r = await start();
    const s = r.session;
    const dir = dirname(r.logPath);
    s.sendKeys("Tab");
    await s.waitFor(/esc prompt/, 3000);
    s.sendKeys({ text: "e" });
    // The toast names the file relative to the working directory, with the platform's separator.
    await s.waitFor((p) => toast(p).includes(`exported to .${sep}acp-tui-`), 5000);
    expect(exports(r)).toHaveLength(1);
    const first = exports(r)[0]!;
    expect(first).toMatch(/^acp-tui-fake-session-\d{8}-\d{6}\.md$/);
    expect(readFileSync(join(dir, first), "utf8")).toBe(GOLDEN);
    const logged = r.events("export");
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ path: join(dir, first), bytes: Buffer.byteLength(GOLDEN), fallback: false });

    // A second export in the same second gets `-2`; the first file is untouched.
    s.sendKeys({ text: "e" });
    await s.waitFor(() => r.events("export").length === 2, 5000);
    const [a, b] = exports(r);
    expect(new Set([a, b]).size).toBe(2);
    for (const name of exports(r)) expect(readFileSync(join(dir, name), "utf8")).toBe(GOLDEN);
  }, 60000);

  test("the palette lists the export and runs it (no --spike since mvp-chrome-and-keys task 7.5)", async () => {
    const r = await start([]);
    const s = r.session;
    s.sendKeys("Ctrl+P");
    await s.waitFor(/Commands \d+/, 3000);
    // The find commands are in the catalogue too, with their keys.
    s.sendKeys({ text: "find" });
    await s.waitFor(/Find in the conversation\s+ctrl\+f/, 3000);
    await s.waitFor(/Find the next hit\s+f3/, 3000);
    s.write("\x15"); // Ctrl+U clears the filter
    s.sendKeys({ text: "export" });
    await s.waitFor(/Export the conversation as Markdown to a file/, 3000);
    s.sendKeys("Enter");
    // The file exists from its exclusive create on; the log event follows the write.
    await s.waitFor(() => r.events("export").length === 1, 5000);
    expect(exports(r)).toHaveLength(1);
    expect(readFileSync(join(dirname(r.logPath), exports(r)[0]!), "utf8")).toBe(GOLDEN);
  }, 60000);

  // A directory nobody can write to needs a user who is not root (root ignores the mode).
  // Skipped on Windows: needs POSIX modes (a read-only attribute does not stop files being created in a directory).
  test.skipIf(process.getuid?.() === 0 || WINDOWS)(
    "Read-only working directory: the file goes to $TMPDIR and the notice names that path",
    async () => {
      const base = process.env.TMPDIR ?? tmpdir();
      const readOnly = mkdtempSync(join(base, "acp-tui-export-ro-"));
      const fallback = mkdtempSync(join(base, "acp-tui-export-tmp-"));
      chmodSync(readOnly, 0o555);
      try {
        // The directory argument makes it the session's working directory.
        const r = await start([readOnly], { TMPDIR: fallback });
        const s = r.session;
        s.sendKeys("Tab");
        await s.waitFor(/esc prompt/, 3000);
        s.sendKeys({ text: "e" });
        await s.waitFor(() => r.events("export").length === 1, 5000);
        const files = readdirSync(fallback).filter((name) => /^acp-tui-.*\.md$/.test(name));
        expect(files).toHaveLength(1);
        expect(readFileSync(join(fallback, files[0]!), "utf8")).toBe(GOLDEN);
        expect(r.events("export")[0]).toMatchObject({ path: join(fallback, files[0]!), fallback: true });
        // Nothing was written into the working directory, and the notice names the file where it went.
        expect(readdirSync(readOnly)).toEqual([]);
        await s.waitFor((p) => toast(p).includes(files[0]!), 5000);
        expect(toast(s)).not.toContain(`.${sep}acp-tui-`);
      } finally {
        chmodSync(readOnly, 0o755);
        rmSync(readOnly, { recursive: true, force: true });
        rmSync(fallback, { recursive: true, force: true });
      }
    },
    60000,
  );
});
