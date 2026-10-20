// Phase-1a task 4.5 (design D6, spec tui-screen "Relayout and settle repaint
// on resize"): the real acp-tui CLI against fake-agent under the PTY harness.
// A resize storm ends with every cell equal to a fresh render at the final
// size, even when cells are disturbed behind the renderer's back after the
// relayout; resizing never writes to the main screen; and the forced full
// repaint (renderer/repaint.ts, OpenTUI's private `forceFullRepaintRequested`)
// really rewrites every cell: the Ctrl+L test fails if the flag stops working.
// The basic scenario's tools are still running while its permission card is
// open, so their spinners animate (spec tui-conversation "Running tool"):
// spinner cells are masked when waiting for quiet and when comparing screens.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DEFAULT_GLYPHS } from "../../src/conversation/glyphs.ts";
import { readEvents } from "../conversation/cli.ts";
import { diffSnapshots, freshRender, startPty, type PtySession, type ScreenSnapshot } from "../pty/harness.ts";
import { CARD_HEADER, promptText, READY } from "../pty/regions.ts";

const ROOT = resolve(import.meta.dir, "../../../..");
const CLI = join(ROOT, "packages/acp-tui/src/cli.ts");
const FAKE_AGENT = join(ROOT, "packages/fake-agent/src/main.ts");
const COMMAND = ["bun", CLI, "--", "bun", FAKE_AGENT, "--scenario", "basic", "--delay-scale", "0"];
const PREFILL = "BEFORE-ACP-TUI\r\n\x1b[32mgreen line\x1b[0m\r\n$ acp-tui\r\n";

let session: PtySession | undefined;
afterEach(async () => {
  await session?.dispose();
  session = undefined;
});

function tempDir(): string {
  return realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-resize-")));
}

function start(dir: string, cols: number, rows: number): { s: PtySession; log: string } {
  const log = join(dir, `acp-tui-${cols}x${rows}.log`);
  const s = startPty(COMMAND, { cols, rows, cwd: dir, env: { ACP_TUI_LOG: log }, prefill: PREFILL });
  session = s;
  return { s, log };
}

function repaints(log: string, cause: "settle" | "key"): number {
  return readEvents(log, "repaint").filter((e) => e["cause"] === cause).length;
}

async function waitForRepaint(log: string, cause: "settle" | "key", count: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (repaints(log, cause) < count) {
    if (Date.now() > deadline) throw new Error(`no ${cause} repaint number ${count}`);
    await Bun.sleep(10);
  }
}

/** The running-tool spinner's frames (src/conversation/glyphs.ts), masked in comparisons. */
const SPINNER = new RegExp(`[${DEFAULT_GLYPHS.spinner.join("")}]`, "g");
const masked = (snapshot: ScreenSnapshot): ScreenSnapshot => ({ ...snapshot, lines: snapshot.lines.map((l) => l.replace(SPINNER, "*")) });

/** Waits until the screen, spinners aside, has been unchanged for `ms`. */
async function quiet(s: PtySession, ms = 250): Promise<void> {
  let seen = "";
  let since = Date.now();
  for (;;) {
    await s.flush();
    const now = masked(s.screenSnapshot());
    const key = JSON.stringify([now.lines, now.attrs]);
    if (key !== seen) {
      seen = key;
      since = Date.now();
    } else if (Date.now() - since >= ms) {
      return;
    }
    await Bun.sleep(10);
  }
}

/** Compared with a fresh render: every cell (spinner frames aside), and the cursor too when it
 *  is shown. */
function diffWithFresh(fresh: ScreenSnapshot, s: PtySession): string[] {
  const core = (s.term as unknown as { _core: { coreService: { isCursorHidden: boolean } } })._core;
  return diffSnapshots(masked(fresh), masked(s.screenSnapshot()), { cursor: !core.coreService.isCursorHidden });
}

/** Writes into the emulator only, as a terminal rearranging cells would: the app never knows. */
function disturb(s: PtySession, data: string): Promise<void> {
  return new Promise((r) => s.term.write(data, r));
}

const GARBAGE = "\x1b7\x1b[2;3H\x1b[31mSTALE-CELLS-STALE\x1b[0m\x1b[5;1HXXXXXXXXXXXXXXXX\x1b8";

/** A prompt, then the permission request of the basic scenario: conversation, tools and card. */
async function toPermission(s: PtySession): Promise<void> {
  await s.waitFor(READY, 10000);
  s.sendKeys({ text: "hello" });
  await s.waitFor((p) => promptText(p)[0] === "hello", 5000);
  s.sendKeys("Enter");
  await s.waitFor(CARD_HEADER, 10000);
  await quiet(s);
}

describe("relayout and settle repaint on resize (task 4.5)", () => {
  test("resize storm leaves no stale cell: 120x25, 80x20, 150x30, 63x21 within a second", async () => {
    const dir = tempDir();
    const { s, log } = start(dir, 120, 25);
    await toPermission(s);
    const settles = repaints(log, "settle");

    for (const [cols, rows] of [
      [80, 20],
      [150, 30],
    ] as const) {
      s.resize(cols, rows);
      await Bun.sleep(120);
    }
    const mark = s.rawOutput().length;
    s.resize(63, 21);
    // Once the relayout at 63x21 has been written, and before the settle repaint, disturb cells
    // behind the renderer's back: only the settle repaint puts them right.
    await s.waitFor((p) => p.rawOutput().length > mark, 2000);
    await quiet(s, 30);
    expect(repaints(log, "settle")).toBe(settles);
    await disturb(s, GARBAGE);
    expect(s.screenText().join("\n")).toContain("STALE-CELLS-STALE");
    await waitForRepaint(log, "settle", settles + 1);
    await quiet(s);
    // One settle repaint for the whole storm.
    expect(repaints(log, "settle")).toBe(settles + 1);

    const fresh = await freshRender(COMMAND, 63, 21, { cwd: dir, drive: toPermission, ready: CARD_HEADER });
    expect(diffWithFresh(fresh, s)).toEqual([]);
  }, 60000);

  test("main screen untouched by resizing: ten resizes, then detach", async () => {
    const dir = tempDir();
    const { s, log } = start(dir, 100, 24);
    await s.waitFor(READY, 10000);
    const before = await s.mainBefore();
    const sizes = [
      [80, 20],
      [120, 30],
      [63, 21],
      [40, 12],
      [150, 40],
      [90, 24],
      [70, 18],
      [110, 26],
      [60, 21],
      [100, 24],
    ] as const;
    for (const [cols, rows] of sizes) {
      s.resize(cols, rows);
      await Bun.sleep(60);
    }
    await waitForRepaint(log, "settle", 1);
    await quiet(s);
    expect(s.term.buffer.active.type).toBe("alternate");
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    await s.flush();
    const after = s.mainSnapshot();
    // The rows above the command line's next row are as they were, and nothing follows: no exit
    // text for a session that cannot be resumed (mvp-sessions design decision 12).
    expect(after.lines.slice(0, 3)).toEqual(before.lines.slice(0, 3));
    expect(after.attrs.filter((a) => Number(a.split(":")[0]) < 3)).toEqual(before.attrs.filter((a) => Number(a.split(":")[0]) < 3));
    expect(after.lines.slice(3).filter((l) => l !== "")).toEqual([]);
    expect(after.cursor).toEqual({ x: 0, y: 3 });
    expect(s.countModeChanges(1049, false)).toBe(1);
  }, 60000);

  test("Ctrl+L rewrites every cell (the private flag works): disturbed cells are put right", async () => {
    const dir = tempDir();
    const { s, log } = start(dir, 80, 24);
    await toPermission(s);
    await disturb(s, GARBAGE);
    expect(s.screenText().join("\n")).toContain("STALE-CELLS-STALE");
    s.sendKeys("Ctrl+L");
    await waitForRepaint(log, "key", 1);
    await quiet(s);
    expect(s.screenText().join("\n")).not.toContain("STALE-CELLS-STALE");
    expect(s.screenText().join("\n")).not.toContain("XXXXXXXXXXXXXXXX");
    const fresh = await freshRender(COMMAND, 80, 24, { cwd: dir, drive: toPermission, ready: CARD_HEADER });
    expect(diffWithFresh(fresh, s)).toEqual([]);
  }, 60000);
});
