// Tests for the phase 1a harness extensions (tasks 2.1 to 2.5), run against
// test/pty/screen-probe.tsx: alternate-screen start and exit, configurable OSC 10
// and 11 replies, SGR mouse injection and fixture replay, the mode tracker and
// main-screen snapshots, and freshRender.
//
// The timing tests of this file are in screen-probe.timing.test.ts (parallel-tests: they run in the serial pass).
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { diffSnapshots, freshRender, startPty } from "./harness.ts";
import { modesSet, parseModeChanges } from "./modes.ts";
import { sgrMotion, sgrPress, sgrRelease, sgrWheel } from "./mouse.ts";
import { ROOT, PROBE, probe, quit, track, createDir, disposeSessions } from "./screen-probe-helpers.ts";
import { WINDOWS } from "../windows.ts";

beforeAll(createDir);
afterEach(disposeSessions);

describe("screen probe (2.1)", () => {
  test("starts on the alternate screen and exits cleanly with status 0", async () => {
    const p = probe();
    await p.s.waitFor("SCREEN-PROBE ready 80x24");
    await p.waitLog((e) => e.kind === "ready");
    expect(p.s.term.buffer.active.type).toBe("alternate");
    expect(p.s.modesSet()).toContain(1049);
    // Mouse on: X11 reporting with SGR encoding; hover (1003) is off.
    expect(p.s.mouseModesSet()).toEqual(expect.arrayContaining([1000, 1006]));
    expect(p.s.mouseModesSet()).not.toContain(1003);
    p.s.sendKeys("Ctrl+Q");
    expect(await p.s.wait()).toBe(0);
    expect(p.s.term.buffer.active.type).toBe("normal");
    expect(p.s.modesSet()).not.toContain(1049);
    expect(p.s.countModeChanges(1049, true)).toBe(1);
    expect(p.s.countModeChanges(1049, false)).toBe(1);
    expect(p.log().at(-1)?.kind).toBe("exit");
  }, 15000);

  test("logs keys and pastes", async () => {
    const p = probe();
    await p.waitLog((e) => e.kind === "ready");
    p.s.sendKeys({ text: "a" }, "Enter");
    p.s.paste("hello");
    const key = await p.waitLog((e) => e.kind === "key" && e.name === "a");
    expect(key).toMatchObject({ ctrl: false, meta: false, shift: false });
    await p.waitLog((e) => e.kind === "key" && e.name === "return");
    expect(await p.waitLog((e) => e.kind === "paste")).toMatchObject({ text: "hello" });
    expect(await quit(p)).toBe(0);
  }, 15000);
});

describe("OSC 10 and 11 replies (2.2)", () => {
  // Skipped on Windows: it needs the terminal's OSC 10/11 colour replies (derived surfaces, light theme), which ConPTY never passes on (it passes only OSC 4).
  test.skipIf(WINDOWS)("configured colours reach the probe by its own query; OSC 4 stays unanswered", async () => {
    const p = probe(["--colours"], { colours: { foreground: "#d4d4d4", background: "#1e1f22" } });
    const own = await p.waitLog((e) => e.kind === "colours" && e.path === "osc");
    expect(own).toMatchObject({ foreground: "#d4d4d4", background: "#1e1f22" });
    // getPalette() checks OSC 4 support first, and OSC 4 is unanswered.
    const palette = await p.waitLog((e) => e.kind === "colours" && e.path === "palette", 8000);
    expect(palette.foreground ?? null).toBeNull();
    expect(palette.background ?? null).toBeNull();
    expect(p.s.oscQueries).toContain(10);
    expect(p.s.oscQueries).toContain(11);
    expect(p.s.oscQueries).toContain(4);
    expect(await quit(p)).toBe(0);
  }, 20000);

  // Skipped on Windows: it needs the terminal's OSC 10/11 colour replies (derived surfaces, light theme), which ConPTY never passes on (it passes only OSC 4).
  test.skipIf(WINDOWS)("BEL-terminated replies and a colour changed with setColours", async () => {
    const p = probe(["--colours"], { colours: { foreground: "#ffffff", background: "#000000", terminator: "bel" } });
    expect(await p.waitLog((e) => e.kind === "colours" && e.path === "osc")).toMatchObject({
      foreground: "#ffffff",
      background: "#000000",
    });
    expect(await quit(p)).toBe(0);
    const q = probe(["--colours"], { colours: { foreground: "#ffffff" } });
    q.s.setColours({ foreground: "#101010", background: "#fafafa" });
    expect(await q.waitLog((e) => e.kind === "colours" && e.path === "osc")).toMatchObject({
      foreground: "#101010",
      background: "#fafafa",
    });
    expect(await quit(q)).toBe(0);
  }, 20000);

  // Skipped on Windows: it needs the terminal's OSC 10/11 colour replies (derived surfaces, light theme), which ConPTY never passes on (it passes only OSC 4).
  test.skipIf(WINDOWS)("no reply configured: the probe logs no colours", async () => {
    const p = probe(["--colours"]);
    const own = await p.waitLog((e) => e.kind === "colours" && e.path === "osc");
    expect(own.foreground).toBeNull();
    expect(own.background).toBeNull();
    const palette = await p.waitLog((e) => e.kind === "colours" && e.path === "palette", 8000);
    expect(palette.foreground ?? null).toBeNull();
    expect(p.s.oscQueries).toContain(10);
    expect(await quit(p)).toBe(0);
  }, 20000);
});

describe("SGR mouse injection (2.3)", () => {
  test("wire forms are 1-based SGR with the right codes", () => {
    expect(sgrPress(0, 0)).toBe("\x1b[<0;1;1M");
    expect(sgrPress(9, 4, "right", { ctrl: true })).toBe("\x1b[<18;10;5M");
    expect(sgrRelease(9, 4)).toBe("\x1b[<0;10;5m");
    expect(sgrMotion(1, 2)).toBe("\x1b[<35;2;3M");
    expect(sgrMotion(1, 2, "left")).toBe("\x1b[<32;2;3M");
    expect(sgrWheel(0, 0, 68)).toBe("\x1b[<68;1;1M");
    expect(() => sgrWheel(0, 0, 3)).toThrow();
  });

  test("press, release, drag, plain motion and the four wheel codes reach the probe", async () => {
    const p = probe(["--hover"]);
    await p.waitLog((e) => e.kind === "ready");
    p.s.mousePress(10, 5);
    p.s.mouseMove(12, 6, "left");
    p.s.mouseRelease(12, 6);
    p.s.mouseMove(20, 8);
    for (const code of [64, 65, 68, 69] as const) p.s.mouseWheel(3, 4, code);
    p.s.mouseWheel(3, 4, 64, { shift: true });
    await p.waitLog((e) => e.kind === "mouse" && e.type === "scroll" && e.shift === true);
    const events = p.log().filter((e) => e.kind === "mouse");
    const pick = (e: Record<string, any>) => [e.type, e.x, e.y, e.dir ?? null];
    expect(events.map(pick)).toEqual([
      ["down", 10, 5, null],
      ["drag", 12, 6, null],
      // OpenTUI 0.5.12 and 0.6.1 end a drag with drag-end, up, drop and a second up.
      ["drag-end", 12, 6, null],
      ["up", 12, 6, null],
      ["drop", 12, 6, null],
      ["up", 12, 6, null],
      ["move", 20, 8, null],
      ["scroll", 3, 4, "up"],
      ["scroll", 3, 4, "down"],
      ["scroll", 3, 4, "up"],
      ["scroll", 3, 4, "down"],
      ["scroll", 3, 4, "up"],
    ]);
    // The probe's own stdin listener sees the reports byte for byte, 1-based on the wire.
    const stdin = p.log().filter((e) => e.kind === "stdin").map((e) => e.data).join("");
    expect(stdin).toContain("\x1b[<0;11;6M\x1b[<32;13;7M\x1b[<0;13;7m\x1b[<35;21;9M\x1b[<64;4;5M");
    // 68 and 69 are wheel up and down with the shift bit set.
    expect(events.filter((e) => e.type === "scroll").map((e) => [e.dir, e.shift])).toEqual([
      ["up", false],
      ["down", false],
      ["up", true],
      ["down", true],
      ["up", true],
    ]);
    expect(await quit(p)).toBe(0);
  }, 15000);
});

describe("mode tracker and main-screen snapshot (2.4)", () => {
  test("parses single and multi-parameter set and reset sequences", () => {
    const out = "\x1b[?1049h\x1b[?1000;1006h\x1b[?25l text \x1b[?1000l\x1b[?1003;1002h\x1b[?1002l\x1b[?2026$p";
    expect(parseModeChanges(out).map((c) => [c.mode, c.on])).toEqual([
      [1049, true],
      [1000, true],
      [1006, true],
      [25, false],
      [1000, false],
      [1003, true],
      [1002, true],
      [1002, false],
    ]);
    expect(modesSet(parseModeChanges(out))).toEqual([7, 1003, 1006, 1049]);
  });

  // Skipped on Windows: it reads raw bytes of the PTY stream (sequences, modes or titles), which ConPTY rewrites.
  test.skipIf(WINDOWS)("a probe that leaves mode 1000 set is reported; a clean exit reports no mouse mode or 1049", async () => {
    const dirty = probe(["--leave-modes", "1000,1006"]);
    await dirty.waitLog((e) => e.kind === "ready");
    expect(await quit(dirty)).toBe(0);
    expect(dirty.s.mouseModesSet()).toEqual([1000, 1006]);
    expect(dirty.s.modesSet()).not.toContain(1049);

    const clean = probe();
    await clean.waitLog((e) => e.kind === "ready");
    expect(await quit(clean)).toBe(0);
    expect(clean.s.mouseModesSet()).toEqual([]);
    expect(clean.s.modesSet()).not.toContain(1049);
    for (const m of [1000, 1002, 1003, 1006, 1049]) expect(clean.s.modesSet()).not.toContain(m);
  }, 20000);

  const PREFILL = "$ bun probe\r\n\x1b[1;31mred bold\x1b[0m and \x1b[38;2;10;20;30mrgb\x1b[0m\r\n$ ";

  // Skipped on Windows: it compares main-screen snapshots or full renders of a PTY stream (ConPTY rewrites them), or runs sh.
  test.skipIf(WINDOWS)("the main screen is unchanged after a clean probe run", async () => {
    const p = probe([], { prefill: PREFILL });
    await p.waitLog((e) => e.kind === "ready");
    const before = await p.s.mainBefore();
    expect(before.lines.slice(0, 3)).toEqual(["$ bun probe", "red bold and rgb", "$"]);
    expect(before.cursor).toEqual({ x: 2, y: 2 });
    expect(before.attrs.length).toBeGreaterThan(0);
    // While the probe is on the alternate screen, the main screen is not touched either.
    expect(await p.s.mainDiff()).toEqual([]);
    expect(await quit(p)).toBe(0);
    expect(await p.s.mainDiff()).toEqual([]);
    expect(p.s.mainSnapshot().cursor).toEqual({ x: 2, y: 2 });
  }, 15000);

  // Skipped on Windows: it compares main-screen snapshots or full renders of a PTY stream (ConPTY rewrites them), or runs sh.
  test.skipIf(WINDOWS)("a change to the main screen is reported", async () => {
    const s = startPty(["sh", "-c", "printf '\\033[2Jx\\033[1;32mgreen\\033[0m'; sleep 0.1"], {
      cols: 40,
      rows: 5,
      prefill: PREFILL,
    });
    track(s);
    await s.wait();
    const diff = await s.mainDiff();
    expect(diff.some((d) => d.startsWith("row 0"))).toBe(true);
    expect(diff.some((d) => d.startsWith("cursor"))).toBe(true);
  }, 15000);
});

describe("freshRender (2.5)", () => {
  // Skipped on Windows: it compares main-screen snapshots or full renders of a PTY stream (ConPTY rewrites them), or runs sh.
  test.skipIf(WINDOWS)("two probes at the same size compare equal", async () => {
    const p = probe();
    await p.s.waitFor("SCREEN-PROBE ready 80x24");
    await p.s.flush();
    const fresh = await freshRender(["bun", PROBE], 80, 24, { cwd: ROOT, ready: "SCREEN-PROBE ready 80x24" });
    await Bun.sleep(100);
    await p.s.flush();
    expect(fresh.buffer).toBe("alternate");
    expect(diffSnapshots(fresh, p.s.screenSnapshot())).toEqual([]);
    expect(await quit(p)).toBe(0);
  }, 20000);

  // Skipped on Windows: it compares main-screen snapshots or full renders of a PTY stream (ConPTY rewrites them), or runs sh.
  test.skipIf(WINDOWS)("a resized probe equals a fresh one at the final size; a different size does not", async () => {
    const p = probe();
    await p.s.waitFor("ready 80x24");
    p.s.resize(100, 30);
    await p.s.waitFor("ready 100x30");
    await Bun.sleep(200);
    await p.s.flush();
    const fresh = await freshRender(["bun", PROBE], 100, 30, { cwd: ROOT });
    expect(diffSnapshots(fresh, p.s.screenSnapshot())).toEqual([]);
    const other = await freshRender(["bun", PROBE], 90, 30, { cwd: ROOT });
    expect(diffSnapshots(other, p.s.screenSnapshot()).length).toBeGreaterThan(0);
    expect(await quit(p)).toBe(0);
  }, 30000);
});
