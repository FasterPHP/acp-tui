// parallel-tests task 3.3: the large-tree tests of the @ file picker (first matches on screen within 300 ms of @, no key slower than 300 ms while the 50000-file list is built), which are budgets on the machine's speed, so they run in the serial pass.
// What the file covers is in the header of file-picker.pty.test.ts; its helpers are in file-picker-helpers.ts.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PtySession } from "../pty/harness.ts";
import { READY } from "../pty/regions.ts";
import { startChrome, type ChromeRun } from "./cli.ts";
import { tree, picker, pickerList, draft, screen } from "./file-picker-helpers.ts";

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

describe("Large tree (tui-palette \"File picker\")", () => {
  // 50000 files outside .gitignore (500 directories of 100), plus an ignored directory.
  let dir = "";

  beforeAll(() => {
    dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-large-"));
    for (let d = 0; d < 500; d++) {
      const sub = join(dir, `pkg${String(d).padStart(3, "0")}`, "src");
      mkdirSync(sub, { recursive: true });
      for (let f = 0; f < 100; f++) writeFileSync(join(sub, `Module${f}Service.php`), "");
    }
    mkdirSync(join(dir, "node_modules", "dep"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "dep", "index.js"), "");
    writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  async function largeTree(label: string): Promise<void> {
    const run = start(dir);
    await run.s.waitFor(READY, 10000);
    await run.s.flush();
    const t0 = performance.now();
    run.s.sendKeys({ text: "@" });
    await run.s.waitFor(() => pickerList(run.s).some((r) => r.endsWith(".php")), 3000);
    const firstMatches = performance.now() - t0;
    // Typing while the list is built: each key shows in the draft at once.
    let slowestKey = 0;
    for (const ch of "mod7serv") {
      const k0 = performance.now();
      run.s.sendKeys({ text: ch });
      const expected = draft(run.s) + ch;
      await run.s.waitFor(() => draft(run.s) === expected, 3000);
      slowestKey = Math.max(slowestKey, performance.now() - k0);
    }
    await run.s.waitFor(() => run.events("file_picker").some((e) => e["action"] === "listed"), 10000);
    await run.s.waitFor(() => /─ Files \d+ /.test(screen(run.s)) && pickerList(run.s)[0]?.includes("Module7Service.php") === true, 5000);
    const listed = run.events("file_picker").find((e) => e["action"] === "listed")!;
    const first = run.events("file_picker").find((e) => e["action"] === "first")!;
    expect(listed["count"]).toBe(50001); // the 50000 and .gitignore; node_modules left out
    expect(pickerList(run.s).join("\n")).not.toContain("node_modules");
    console.log(
      `Large tree (${label}): first matches on screen ${firstMatches.toFixed(0)} ms after @ (first batch ${first["ms"]} ms in the app), ` +
        `whole list ${listed["ms"]} ms (${listed["source"]}), slowest key while listing ${slowestKey.toFixed(0)} ms`,
    );
    expect(listed["source"]).toBe(label);
    expect(firstMatches).toBeLessThan(300);
    expect(slowestKey).toBeLessThan(300);
  }

  test("first matches within 300 ms of `@`, typing responsive while it lists (directory walk)", async () => {
    await largeTree("walk");
  }, 60000);

  test.if(Bun.spawnSync(["git", "--version"]).exitCode === 0)("the same in a git work tree (git ls-files)", async () => {
    expect(Bun.spawnSync(["git", "init", "-q"], { cwd: dir }).exitCode).toBe(0);
    try {
      await largeTree("git");
    } finally {
      rmSync(join(dir, ".git"), { recursive: true, force: true });
    }
  }, 60000);
});
