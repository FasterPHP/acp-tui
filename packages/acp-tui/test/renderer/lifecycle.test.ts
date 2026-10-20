// Task 6.1 verification (Phase 0), on the alternate screen since phase-1a
// task 3.5: every exit path leaves the alternate screen, restores the
// terminal and leaves the main screen as it was, under the PTY harness
// against test/renderer/lifecycle.tsx (the real renderer factory, lifecycle and
// default footer, with 40 numbered rows filling the screen above it). The
// main screen is prefilled, so `mainDiff()` shows anything written to it.
// Phase-1a tasks 4.1 and 4.2: mouse reporting on at SIGTERM, a failed
// teardown (the alternate screen left exactly once on both paths; since
// OpenTUI 0.6 by the native session's restoration, opentui-0-6 task 3.2), the cursor on the row below the command line, and SIGUSR2
// handled without exiting.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FINAL_RESET } from "../../src/renderer/lifecycle.ts";
import { startPty, type PtySession } from "../pty/harness.ts";

const ROOT = resolve(import.meta.dir, "../../../..");
const SPIKE = "packages/acp-tui/test/renderer/lifecycle.tsx";
/** The main screen before start: a shell prompt with the command, and a coloured line. */
const PREFILL = "BEFORE-LIFECYCLE\r\n\x1b[32mgreen line\x1b[0m\r\n$ lifecycle\r\n";

let session: PtySession | undefined;
afterEach(async () => {
  await session?.dispose();
  session = undefined;
});

interface Run {
  s: PtySession;
  code: number;
  /** Raw output from the moment the exit was triggered. */
  tail: string;
  raw: string;
  hook: { reason: string; signal: string | null; destroyed: boolean }[];
}

async function run(
  trigger: "q" | "SIGHUP" | "SIGTERM" | "fail-start",
  opts: { kitty?: boolean; mouse?: boolean; destroyThrows?: boolean; closed?: "rejects" | "hangs"; before?: (s: PtySession, log: string) => Promise<void> } = {},
): Promise<Run> {
  const log = join(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-lifecycle-")), "hook.log");
  const args = trigger === "fail-start" ? ["--fail-start"] : [];
  if (opts.mouse) args.push("--mouse");
  if (opts.destroyThrows) args.push("--destroy-throws");
  if (opts.closed) args.push(`--closed-${opts.closed}`);
  const s = startPty(["bun", SPIKE, "40", ...args], { cols: 80, rows: 24, cwd: ROOT, env: { LIFECYCLE_LOG: log }, prefill: PREFILL });
  session = s;
  if (opts.kitty) {
    // Answer the kitty keyboard query as a kitty-protocol terminal would, so
    // OpenTUI pushes its flags (xterm.js does not implement the protocol).
    s.term.parser.registerCsiHandler({ prefix: "?", final: "u" }, () => {
      s.write("\x1b[?0u");
      return true;
    });
  }
  let mark = 0;
  if (trigger !== "fail-start") {
    await s.waitFor("READY", 10000);
    await Bun.sleep(100);
    await s.flush();
    // The app is on the alternate screen: its rows and footer are there, not on the main screen.
    expect(s.term.buffer.active.type).toBe("alternate");
    expect(s.screenText()).toContain("row 001");
    expect(s.screenText().some((l) => l.startsWith(" spike-agent"))).toBe(true);
    await opts.before?.(s, log);
    mark = s.rawOutput().length;
    if (trigger === "q") s.sendKeys({ text: "q" });
    else s.kill(trigger);
  }
  const code = await s.wait(10000);
  const raw = s.rawOutput();
  const hook = readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
    .filter((e) => !("theme" in e));
  return { s, code, tail: raw.slice(mark), raw, hook };
}

/** Index just past the last match of `re` in `text`, or -1. */
function lastIndex(text: string, re: RegExp): number {
  let at = -1;
  for (const m of text.matchAll(new RegExp(re.source, "g"))) at = m.index! + m[0].length;
  return at;
}

function expectRestored({ s, raw, tail }: Run) {
  // Back on the main screen, having left the alternate screen once.
  expect(s.term.buffer.active.type).toBe("normal");
  expect(s.modesSet()).not.toContain(1049);
  expect(s.countModeChanges(1049, false)).toBe(1);
  // No scrollback clear anywhere, and no screen clear after leaving the alternate screen.
  expect(raw).not.toContain("\x1b[3J");
  expect(raw.slice(raw.lastIndexOf("\x1b[?1049l"))).not.toContain("\x1b[2J");
  // A scroll region, if one was set, is reset after its last use.
  const lastRegion = lastIndex(raw, /\x1b\[\d+;\d+r/);
  if (lastRegion >= 0) expect(raw.indexOf("\x1b[r", lastRegion)).toBeGreaterThan(0);
  // Cursor shown after the last hide.
  expect(raw.indexOf("\x1b[?25h", lastIndex(raw, /\x1b\[\?25l/))).toBeGreaterThan(0);
  // Bracketed paste and focus reporting off after they were last turned on.
  expect(raw.indexOf("\x1b[?2004l", lastIndex(raw, /\x1b\[\?2004h/))).toBeGreaterThan(0);
  expect(raw.indexOf("\x1b[?1004l", lastIndex(raw, /\x1b\[\?1004h/))).toBeGreaterThan(0);
  // Keyboard mode: modifyOtherKeys reset, or kitty flags popped, whichever was set.
  if (raw.includes("\x1b[>5u")) expect(tail).toContain("\x1b[<u");
  else expect(raw.indexOf("\x1b[>4;0m", lastIndex(raw, /\x1b\[>4;1m/))).toBeGreaterThan(0);
  // The output ends with the lifecycle's own reset (scroll region kept cursor, cursor shown).
  expect(tail).toContain("\x1b7\x1b[r\x1b8\x1b[0m\x1b[0 q\x1b[?25h");
  // The emulator agrees: no scroll region, cursor visible, bracketed paste off.
  const core = (s.term as unknown as { _core: { buffer: { scrollTop: number; scrollBottom: number }; coreService: { isCursorHidden: boolean } } })._core;
  expect(core.buffer.scrollTop).toBe(0);
  expect(core.buffer.scrollBottom).toBe(s.rows - 1);
  expect(core.coreService.isCursorHidden).toBe(false);
  expect(s.term.modes.bracketedPasteMode).toBe(false);
  expect(s.mouseModesSet()).toEqual([]);
  // The app's rows never reached the main screen.
  expect(s.mainSnapshot().lines.some((l) => l.startsWith("row "))).toBe(false);
}

/** The cursor at the start of the row below the command line (row 2, the third prefill line). */
function expectCursorBelowCommand(s: PtySession, extraRows = 0) {
  expect(s.mainSnapshot().cursor).toEqual({ x: 0, y: 3 + extraRows });
}

describe("terminal restored on every exit path, without clearing", () => {
  test("normal exit", async () => {
    const r = await run("q");
    expect(r.code).toBe(0);
    expect(r.hook).toEqual([{ reason: "user", signal: null, destroyed: false }]);
    expectRestored(r);
    expect(await r.s.mainDiff()).toEqual([]);
    expectCursorBelowCommand(r.s);
  });

  test("SIGHUP", async () => {
    const r = await run("SIGHUP");
    expect(r.code).toBe(129);
    expect(r.hook).toEqual([{ reason: "signal", signal: "SIGHUP", destroyed: false }]);
    expectRestored(r);
    expect(await r.s.mainDiff()).toEqual([]);
  });

  test("SIGTERM", async () => {
    const r = await run("SIGTERM");
    expect(r.code).toBe(143);
    expect(r.hook).toEqual([{ reason: "signal", signal: "SIGTERM", destroyed: false }]);
    expectRestored(r);
    expect(await r.s.mainDiff()).toEqual([]);
    expectCursorBelowCommand(r.s);
  });

  test("SIGTERM with the mouse captured: every mouse mode off, status 143 (spec tui-screen)", async () => {
    const r = await run("SIGTERM", { mouse: true });
    // Mouse reporting was on while it ran.
    const on = r.s.modeChanges().filter((c) => c.on && [1000, 1002, 1003, 1006].includes(c.mode));
    expect(on.length).toBeGreaterThan(0);
    expect(r.code).toBe(143);
    expectRestored(r);
    expect(r.s.mouseModesSet()).toEqual([]);
    // The final reset turns them off after the teardown, whatever the teardown did.
    expect(r.tail.lastIndexOf("\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l")).toBeGreaterThan(r.tail.lastIndexOf("\x1b[?1049l"));
    expect(await r.s.mainDiff()).toEqual([]);
    expectCursorBelowCommand(r.s);
  });

  // OpenTUI 0.6 (opentui-0-6 task 3.2, design D3): when the teardown fails, the lifecycle has the
  // native session write its restoration at once and disposes it, so OpenTUI's own exit handler
  // writes nothing more; the alternate screen is left exactly once, by that restoration (the
  // fallback reset, which would leave it a second time, is not written), and the final reset
  // follows. Under 0.6.1 without this, "destroy() throws" left it twice.
  for (const [name, opts] of [
    ["destroy() throws", { destroyThrows: true }],
    ["closed rejects", { closed: "rejects" }],
    ["closed never settles (the 1 s bound expires)", { closed: "hangs" }],
  ] as const) {
    test(`${name}: the alternate screen is left exactly once (task 4.2)`, async () => {
      const r = await run("q", opts);
      expect(r.code).toBe(0);
      expect(r.s.countModeChanges(1049, false)).toBe(1);
      expect(r.tail).not.toContain("\x1b[?1049l\x1b[<u\x1b[>4;0m\x1b[?2004l\x1b[?1004l");
      expect(r.tail.indexOf(FINAL_RESET)).toBeGreaterThan(r.tail.indexOf("\x1b[?1049l"));
      expectRestored(r);
      expect(await r.s.mainDiff()).toEqual([]);
      expectCursorBelowCommand(r.s);
    });
  }

  test("SIGUSR2 reaches the theme listeners and does not exit", async () => {
    const r = await run("q", {
      before: async (s, log) => {
        s.kill("SIGUSR2");
        const deadline = Date.now() + 5000;
        while (!(existsSync(log) && readFileSync(log, "utf8").includes('"theme":true'))) {
          if (Date.now() > deadline) throw new Error("no theme signal logged");
          await Bun.sleep(20);
        }
        await Bun.sleep(100);
        expect(s.exitCode).toBeNull();
        expect(s.term.buffer.active.type).toBe("alternate");
      },
    });
    expect(r.code).toBe(0);
    expect(r.hook).toEqual([{ reason: "user", signal: null, destroyed: false }]);
    expectRestored(r);
  });

  test("SIGTERM with kitty keyboard flags pushed: they are popped", async () => {
    const r = await run("SIGTERM", { kitty: true });
    expect(r.raw).toContain("\x1b[>5u");
    expect(r.code).toBe(143);
    expectRestored(r);
    expect(await r.s.mainDiff()).toEqual([]);
  });

  test("start-up failure after the renderer exists: the error below the earlier lines", async () => {
    const r = await run("fail-start");
    expect(r.code).toBe(1);
    expect(r.hook).toEqual([{ reason: "error", signal: null, destroyed: false }]);
    expectRestored(r);
    const before = (await r.s.mainBefore()).lines.filter((l) => l !== "");
    const after = r.s.mainSnapshot().lines.filter((l) => l !== "");
    expect(after).toEqual([...before, "acp-tui: start-up failed on purpose"]);
    expectCursorBelowCommand(r.s, 1);
  });
});
