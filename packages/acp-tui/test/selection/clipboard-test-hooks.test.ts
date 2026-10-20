// windows-support D10: no test reaches a real clipboard on any platform. The test hooks
// `no-host-clipboard` (the host does not exist) and `no-native-clipboard` (stub programs still run,
// the native backend is never created) are read from ACP_TUI_TEST_HOOKS; the test preload sets the
// first for this process and everything it starts, and the PTY harness for every child.
import { describe, expect, test } from "bun:test";
import { testHooks } from "../../src/renderer/test-hooks.ts";
import { createClipboardReader, createCopier, hostDisplay, NO_HOST } from "../../src/selection/clipboard.ts";
import { clipboardTestHooks } from "../pty/harness.ts";

const PLATFORMS: NodeJS.Platform[] = ["linux", "darwin", "win32"];

describe("the clipboard test hooks", () => {
  test("the preload turns the host clipboard off for the test process and the processes it starts", () => {
    expect(testHooks().has("no-host-clipboard")).toBe(true);
    expect(hostDisplay()).toBeNull();
    for (const platform of PLATFORMS) expect(hostDisplay(undefined, platform)).toBeNull();
  });

  test("no-host-clipboard: no host on any platform, whatever the display variables say", () => {
    const env = { ACP_TUI_TEST_HOOKS: "no-host-clipboard", WAYLAND_DISPLAY: "wayland-1", DISPLAY: ":0" };
    for (const platform of PLATFORMS) expect(hostDisplay(env, platform)).toBeNull();
    expect(hostDisplay({ ...env, ACP_TUI_TEST_HOOKS: "crash" }, "linux")).toBe("wayland");
    expect(hostDisplay({ ...env, ACP_TUI_TEST_HOOKS: "crash" }, "darwin")).toBe("macos");
    expect(hostDisplay({ ...env, ACP_TUI_TEST_HOOKS: "crash" }, "win32")).toBe("windows");
  });

  test("no-native-clipboard keeps the host but creates no native backend (a stub program on PATH is the only way)", async () => {
    const env = { ACP_TUI_TEST_HOOKS: "no-native-clipboard", WAYLAND_DISPLAY: "wayland-1", PATH: "" };
    expect(hostDisplay(env, "linux")).toBe("wayland");
    const reader = createClipboardReader({ env, platform: "linux" });
    expect((await reader.read("palette")).kind).toBe("none");
    const copier = createCopier({ renderer: { copyToClipboardOSC52: () => false, isOsc52Supported: () => false } as never, env, platform: "linux" });
    const outcome = await copier.copy("abc", "test");
    expect(outcome.path).not.toBe("host");
    expect(NO_HOST.maxWriteBytes).toBeGreaterThan(0);
  });

  test("the PTY harness adds no-host-clipboard to what the test named, unless it names no-native-clipboard", () => {
    expect(clipboardTestHooks(undefined)).toBe("no-host-clipboard");
    expect(clipboardTestHooks("")).toBe("no-host-clipboard");
    expect(clipboardTestHooks("crash")).toBe("crash,no-host-clipboard");
    expect(clipboardTestHooks("no-native-clipboard")).toBe("no-native-clipboard");
    expect(clipboardTestHooks("crash, no-native-clipboard")).toBe("crash,no-native-clipboard");
  });
});
