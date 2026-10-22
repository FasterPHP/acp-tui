// Ctrl+C turned back on before the full screen on Windows (platform/ctrl-c.ts): the rule with the
// platform and the Win32 call injected. The effect itself is checked on Windows by
// test/session/startup.pty.test.ts "Ctrl+C while finding a session", run from a process that
// ignores Ctrl+C.
import { describe, expect, test } from "bun:test";
import { allowCtrlC } from "../../src/platform/ctrl-c.ts";

describe("allowCtrlC", () => {
  test("Windows: turns the processing on", () => {
    let calls = 0;
    expect(allowCtrlC({ platform: "win32", enable: () => ++calls > 0 })).toBe(true);
    expect(calls).toBe(1);
  });

  test("Linux and macOS: nothing to do (a SIGINT listener always runs)", () => {
    for (const platform of ["linux", "darwin"] as const) {
      let calls = 0;
      expect(allowCtrlC({ platform, enable: () => ++calls > 0 })).toBe(false);
      expect(calls).toBe(0);
    }
    // And the Win32 module (bun:ffi) is never loaded there.
    if (process.platform !== "win32") {
      allowCtrlC();
      expect(Object.keys(require.cache).filter((k) => k.includes("windows-ctrl-c"))).toEqual([]);
    }
  });

  test("Windows: a failure is not an error; the processing stays as inherited", () => {
    expect(
      allowCtrlC({
        platform: "win32",
        enable: () => {
          throw new Error("kernel32.dll could not be opened");
        },
      }),
    ).toBe(false);
    expect(allowCtrlC({ platform: "win32", enable: () => false })).toBe(false);
  });
});
