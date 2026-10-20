// The clipboard on Windows (spec tui-selection "Clipboard on Windows"): outside SSH the host is the
// Windows clipboard, written and read by OpenTUI's native backend with no helper program, and OSC 52
// stays the fallback. The platform is injected (`platform: "win32"`), so this runs on every system;
// the native backend is a fake and `PATH` holds stubs of every helper, none of which may run, so
// no real clipboard is touched.
import { afterEach, describe, expect, test } from "bun:test";
import type { ClipboardReadResult, HostClipboardService } from "@opentui/core";
import type { DebugLogEntry } from "../../src/log.ts";
import { copyToast, createClipboardReader, createCopier, findCopyHelper, findPasteHelper, hostDisplay, NO_CLIPBOARD_REASON, type ClipboardMode } from "../../src/selection/clipboard.ts";
import { makeStubs, type Stubs } from "./clipboard-stub.ts";

const WIN32 = "win32" as const;
// The stubs of the other platforms' helpers are `sh` scripts: they cannot run on a Windows host.
const describeHere = process.platform === "win32" ? describe.skip : describe;

function fakeRenderer(remote = false) {
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

function fakeHost(status: "written" | "unsupported" = "written", readResult: ClipboardReadResult = { status: "unsupported" }) {
  const writes: string[] = [];
  const reads: string[][] = [];
  const host: HostClipboardService = {
    maxWriteBytes: 1024 * 1024,
    read: async (o) => (reads.push([...o.preferredTypes]), readResult),
    async writeText(text) {
      writes.push(text);
      return { status };
    },
    clear: async () => ({ status: "unsupported" }),
    dispose: async () => {},
  };
  return { host, writes, reads };
}

let stubs: Stubs | undefined;
afterEach(() => {
  stubs?.cleanup();
  stubs = undefined;
});

/** An environment whose `PATH` holds a stub of every helper, so a helper that ran would show. */
function setup(extra: Record<string, string> = {}) {
  stubs = makeStubs(["wl-copy", "xclip", "pbcopy", "pbpaste"]);
  return { stubs, env: { PATH: stubs.bin, STUB_LOG: stubs.log, ...extra } };
}

describeHere("the host on Windows", () => {
  test("the Windows clipboard, whatever the display variables say; none over SSH; the other platforms unchanged", () => {
    expect(hostDisplay({}, WIN32)).toBe("windows");
    expect(hostDisplay({ DISPLAY: ":0", WAYLAND_DISPLAY: "w" }, WIN32)).toBe("windows");
    expect(hostDisplay({ SSH_CONNECTION: "1 2 3 4" }, WIN32)).toBeNull();
    expect(hostDisplay({ SSH_CLIENT: "1 2 3" }, WIN32)).toBeNull();
    expect(hostDisplay({ SSH_TTY: "/dev/pts/1" }, WIN32)).toBeNull();
    expect(hostDisplay({}, "darwin")).toBe("macos");
    expect(hostDisplay({ WAYLAND_DISPLAY: "w", DISPLAY: ":0" }, "linux")).toBe("wayland");
    expect(hostDisplay({ DISPLAY: ":0" }, "linux")).toBe("x11");
    expect(hostDisplay({}, "linux")).toBeNull();
  });

  test("no copy or paste helper, even with every one on PATH", () => {
    const { env } = setup();
    expect(findCopyHelper("windows", env)).toBeNull();
    expect(findPasteHelper("windows", env)).toBeNull();
  });

  test("the toast names the Windows clipboard, with the singular for one character", () => {
    expect(copyToast(12, { path: "host", result: null, via: "native" }, "windows")).toEqual({ text: "copied 12 chars to the Windows clipboard", ok: true });
    expect(copyToast(1, { path: "host", result: null, via: "native" }, "windows").text).toBe("copied 1 char to the Windows clipboard");
    expect(copyToast(3, { path: "osc52", result: null }, null).text).toBe("sent 3 chars to the terminal (OSC 52, not confirmed)");
  });
});

describeHere("copy on Windows", () => {
  test("the native backend takes the text, no helper runs and no OSC 52 is written", async () => {
    const { stubs: s, env } = setup();
    const native = fakeHost();
    const renderer = fakeRenderer();
    const logged: DebugLogEntry[] = [];
    const copier = createCopier({ renderer, host: native.host, env, platform: WIN32, logger: { enabled: true, log: (e) => void logged.push(e) } });
    expect(copier.display).toBe("windows");
    const text = "One link: the docs é 漢 \u{1F600}\r\nline two";
    const outcome = await copier.copy(text, "test");
    expect(outcome).toMatchObject({ path: "host", via: "native" });
    expect(native.writes).toEqual([text]);
    expect(renderer.writes).toEqual([]);
    const chars = Array.from(text).length;
    expect(copyToast(chars, outcome, copier.display).text).toBe(`copied ${chars} chars to the Windows clipboard`);
    for (const name of ["wl-copy", "xclip", "pbcopy"] as const) expect(s.record(name)).toBeNull();
    expect(logged[0]).toMatchObject({ event: "clipboard", path: "host", via: "native", helper: "none" });
    await copier.dispose();
  });

  test("clipboard host uses the native backend as well", async () => {
    const { env } = setup();
    const native = fakeHost();
    const outcome = await createCopier({ renderer: fakeRenderer(), host: native.host, env, platform: WIN32, mode: "host" }).copy("abc", "test");
    expect(outcome).toMatchObject({ path: "host", via: "native" });
    expect(native.writes).toEqual(["abc"]);
  });

  test("the native backend cannot write: OSC 52 is the fallback", async () => {
    const { env } = setup();
    const renderer = fakeRenderer();
    const outcome = await createCopier({ renderer, host: fakeHost("unsupported").host, env, platform: WIN32 }).copy("abc", "test");
    expect(outcome.path).toBe("osc52");
    expect(renderer.writes).toEqual(["abc"]);
  });

  test("over SSH: OSC 52 only, the Windows clipboard not written", async () => {
    const { env } = setup({ SSH_CONNECTION: "1 2 3 4" });
    const native = fakeHost();
    const renderer = fakeRenderer(true);
    const copier = createCopier({ renderer, host: native.host, env, platform: WIN32 });
    expect(copier.display).toBeNull();
    expect((await copier.copy("abc", "test")).path).toBe("osc52");
    expect(renderer.writes).toEqual(["abc"]);
    expect(native.writes).toEqual([]);
  });

  for (const mode of ["osc52", "none"] as ClipboardMode[]) {
    test(`clipboard ${mode}: the Windows clipboard is not written`, async () => {
      const { env } = setup();
      const native = fakeHost();
      const outcome = await createCopier({ renderer: fakeRenderer(), host: native.host, env, platform: WIN32, mode }).copy("abc", "test");
      expect(outcome.path).toBe(mode === "none" ? "none" : "osc52");
      expect(native.writes).toEqual([]);
    });
  }
});

describeHere("paste on Windows", () => {
  const answer = (text: string): ClipboardReadResult => ({ status: "read", representation: { mimeType: "text/plain", bytes: new TextEncoder().encode(text) } });

  test("the native backend reads the text, asking for text first; no paste helper runs; the log has its length, never the text", async () => {
    const { stubs: s, env } = setup({ STUB_PASTE: "from pbpaste" });
    const text = "read by Alt+V é 漢";
    const native = fakeHost("written", answer(text));
    const logged: DebugLogEntry[] = [];
    const reader = createClipboardReader({ env, platform: WIN32, host: native.host, logger: { enabled: true, log: (e) => void logged.push(e) } });
    expect(await reader.read("alt+v")).toEqual({ kind: "text", text });
    expect(native.reads[0]![0]).toBe("text/plain");
    expect(s.record("pbpaste")).toBeNull();
    expect(logged).toEqual([{ event: "clipboard", direction: "read", trigger: "alt+v", mode: "auto", status: "read", result: "text", chars: text.length }]);
    await reader.dispose();
  });

  test("an empty clipboard and an image give the existing reasons", async () => {
    const { env } = setup();
    expect(await createClipboardReader({ env, platform: WIN32, host: fakeHost("written", { status: "empty" }).host }).read("palette")).toEqual({ kind: "none", reason: "the clipboard holds no text" });
    const image: ClipboardReadResult = { status: "read", representation: { mimeType: "image/png", bytes: new Uint8Array([1]) } };
    expect(await createClipboardReader({ env, platform: WIN32, host: fakeHost("written", image).host }).read("palette")).toEqual({ kind: "image", mimeType: "image/png" });
  });

  test("over SSH, with clipboard osc52 or none: the Windows clipboard is never read", async () => {
    const { env } = setup();
    const native = fakeHost("written", answer("x"));
    expect(await createClipboardReader({ env: { ...env, SSH_CONNECTION: "1 2 3 4" }, platform: WIN32 }).read("alt+v")).toEqual({ kind: "none", reason: NO_CLIPBOARD_REASON });
    expect(await createClipboardReader({ env, platform: WIN32, host: native.host, mode: "osc52" }).read("alt+v")).toEqual({ kind: "none", reason: NO_CLIPBOARD_REASON });
    expect((await createClipboardReader({ env, platform: WIN32, host: native.host, mode: "none" }).read("alt+v")).kind).toBe("none");
    expect(native.reads).toEqual([]);
  });
});
