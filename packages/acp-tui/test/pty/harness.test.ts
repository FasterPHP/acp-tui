// Smoke tests for the PTY harness (task 6.2 of Phase 0): a program runs at the
// requested size, a resize reaches it as SIGWINCH, and the emulator records
// raw output and answers terminal queries. Run against the alternate-screen
// probe (test/pty/screen-probe.tsx); test/pty/screen-probe.test.ts covers the
// phase-1a extensions. The Phase 0 checks of inline scrollback commits
// went with the inline renderer.
import { afterEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { startPty, type PtySession } from "./harness.ts";

const ROOT = resolve(import.meta.dir, "../../../..");
const PROBE = "packages/acp-tui/test/pty/screen-probe.tsx";

let session: PtySession | undefined;
afterEach(async () => {
  await session?.dispose();
  session = undefined;
});

function start(cols = 80, rows = 24): PtySession {
  session = startPty(["bun", PROBE, "--no-mouse"], { cols, rows, cwd: ROOT });
  return session;
}

describe("PTY harness", () => {
  test("runs a full-screen program at 80x24 and reads its screen", async () => {
    const s = start();
    await s.waitFor((p) => p.screenText()[0]!.startsWith("SCREEN-PROBE ready 80x24"), 10000);
    expect(s.cols).toBe(80);
    expect(s.rows).toBe(24);
    expect(s.screenText()).toHaveLength(24);
    s.sendKeys("Ctrl+Q");
    expect(await s.wait()).toBe(0);
    expect(s.exitCode).toBe(0);
  }, 15000);

  test("resize reaches the child as SIGWINCH and resizes the emulator", async () => {
    const s = start();
    await s.waitFor("ready 80x24", 10000);
    s.resize(100, 30);
    await s.waitFor("ready 100x30");
    expect(s.screenText()).toHaveLength(30);
    s.resize(60, 20);
    await s.waitFor("ready 60x20");
    expect(s.screenText()).toHaveLength(20);
    s.sendKeys("Ctrl+Q");
    expect(await s.wait()).toBe(0);
  }, 15000);

  test("records raw output and answers terminal queries", async () => {
    const s = start();
    await s.waitFor("ready", 10000);
    // OpenTUI asks for the cursor position at start-up; the reply comes from xterm.
    expect(s.rawOutput()).toContain("\x1b[6n");
    // Synchronised output brackets every frame.
    expect(s.rawOutput()).toContain("\x1b[?2026h");
    s.sendKeys("Ctrl+Q");
    await s.wait();
  }, 15000);
});
