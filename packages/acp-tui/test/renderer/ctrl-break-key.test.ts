// windows-support D8: Windows Terminal 1.25 sends Ctrl+Break as a kitty key once kitty flags are on
// (measured: `CSI 3;5u` with flags 1, `CSI 3::57359;5u` with flags 5), and raises no SIGBREAK.
import { describe, expect, test } from "bun:test";
import { installCtrlBreakKey, isCtrlBreakKey } from "../../src/renderer/ctrl-break-key.ts";

describe("isCtrlBreakKey", () => {
  test("the encodings Windows Terminal 1.25 sends", () => {
    expect(isCtrlBreakKey("\x1b[3;5u")).toBe(true);
    expect(isCtrlBreakKey("\x1b[3::57359;5u")).toBe(true);
  });

  test("with other modifiers as well as Ctrl, and press or repeat events", () => {
    expect(isCtrlBreakKey("\x1b[3;6u")).toBe(true);
    expect(isCtrlBreakKey("\x1b[3;5:1u")).toBe(true);
    expect(isCtrlBreakKey("\x1b[3;5:2u")).toBe(true);
  });

  test("not a release, not without Ctrl, not other keys", () => {
    expect(isCtrlBreakKey("\x1b[3;5:3u")).toBe(false);
    expect(isCtrlBreakKey("\x1b[3;1u")).toBe(false);
    expect(isCtrlBreakKey("\x1b[3;2u")).toBe(false);
    expect(isCtrlBreakKey("\x1b[99;5u")).toBe(false);
    expect(isCtrlBreakKey("\x1b[33;5u")).toBe(false);
    expect(isCtrlBreakKey("\x1b[3~")).toBe(false);
    expect(isCtrlBreakKey("\x03")).toBe(false);
  });
});

describe("installCtrlBreakKey", () => {
  function fake() {
    const handlers: ((sequence: string) => boolean)[] = [];
    return { handlers, renderer: { prependInputHandler: (h: (sequence: string) => boolean) => void handlers.push(h) } };
  }

  test("on Windows the key ends acp-tui and is not passed on; other input is", () => {
    const f = fake();
    let breaks = 0;
    installCtrlBreakKey(f.renderer as never, () => void breaks++, "win32");
    expect(f.handlers).toHaveLength(1);
    expect(f.handlers[0]!("\x1b[3::57359;5u")).toBe(true);
    expect(breaks).toBe(1);
    expect(f.handlers[0]!("\x1b[99;5u")).toBe(false);
    expect(breaks).toBe(1);
  });

  test("on Linux and macOS nothing is installed", () => {
    for (const platform of ["linux", "darwin"] as const) {
      const f = fake();
      installCtrlBreakKey(f.renderer as never, () => {}, platform);
      expect(f.handlers).toHaveLength(0);
    }
  });
});
