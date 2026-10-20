// Shared by clipboard-helper.test.ts and clipboard-helper.timing.test.ts (split by the change parallel-tests, tasks 3.x). Not a test file.

import type { HostClipboardService } from "@opentui/core";
import { makeStubs, type Stubs } from "./clipboard-stub.ts";

/** A renderer stand-in: records OSC 52 writes. */
export function fakeRenderer(remote = false) {
  const writes: string[] = [];
  return {
    writes,
    capabilities: { remote, osc52_support: "unknown" as const },
    copyToClipboardOSC52(text: string) {
      writes.push(text);
      return true;
    },
    clearClipboardOSC52: () => true,
  };
}

/** The native host backend stand-in. */
export function fakeHost(status: "written" | "unsupported" = "written"): HostClipboardService & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    maxWriteBytes: 1024 * 1024,
    read: async () => ({ status: "unsupported" }),
    async writeText(text) {
      writes.push(text);
      return { status };
    },
    clear: async () => ({ status: "unsupported" }),
    dispose: async () => {},
  };
}

export function setup(names: readonly ("wl-copy" | "xclip")[], display: Record<string, string>, extra: Record<string, string> = {}) {
  stubs = makeStubs(names);
  const env = { PATH: stubs.bin, STUB_LOG: stubs.log, ...display, ...extra };
  return { stubs, env };
}

export const WAYLAND = { WAYLAND_DISPLAY: "acp-tui-test-wayland" };
export const X11 = { DISPLAY: ":99" };

let stubs: Stubs | undefined;

/** For each test file's `afterEach`. */
export function disposeStubs(): void {
  stubs?.cleanup();
  stubs = undefined;
}
