// The clipboard on macOS (mvp-configuration, before Marcus's working day on his Mac): copy hands
// the text to `pbcopy`, paste reads `pbpaste`, both found on the environment's `PATH`, and each
// falls back to OpenTUI's native backend. The platform is injected (`platform: "darwin"`), so this
// runs on Linux; only stubs run (./clipboard-stub.ts), every environment is given explicitly with
// `PATH` the stubs' directory, and the native backend is a fake, so no real clipboard is touched.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ClipboardReadResult, HostClipboardService } from "@opentui/core";
import type { DebugLogEntry } from "../../src/log.ts";
import {
  copyToast,
  createClipboardReader,
  createCopier,
  findCopyHelper,
  findPasteHelper,
  hostDisplay,
  NO_CLIPBOARD_REASON,
  NO_HOST,
  pasteNotice,
  runPasteHelper,
  type ClipboardMode,
} from "../../src/selection/clipboard.ts";
import { exists, makeStubs, type StubName, type Stubs } from "./clipboard-stub.ts";
import { WINDOWS } from "../windows.ts";

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

/** The native backend stand-in: records writes and reads, answers `read` with `readResult`. */
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

const DARWIN = "darwin" as const;
const UTF8 = "en_US.UTF-8";

let stubs: Stubs | undefined;
afterEach(() => {
  stubs?.cleanup();
  stubs = undefined;
});

function setup(names: readonly StubName[], extra: Record<string, string> = {}) {
  stubs = makeStubs(names);
  return { stubs, env: { PATH: stubs.bin, STUB_LOG: stubs.log, ...extra } };
}

describe("the host on macOS", () => {
  test("the pasteboard, whatever the display variables say; none over SSH; Linux unchanged", () => {
    expect(hostDisplay({}, DARWIN)).toBe("macos");
    expect(hostDisplay({ DISPLAY: "/private/tmp/com.apple.launchd.x/org.xquartz:0" }, DARWIN)).toBe("macos");
    expect(hostDisplay({ SSH_CONNECTION: "1 2 3 4" }, DARWIN)).toBeNull();
    expect(hostDisplay({ SSH_TTY: "/dev/ttys001" }, DARWIN)).toBeNull();
    expect(hostDisplay({ WAYLAND_DISPLAY: "w", DISPLAY: ":0" }, "linux")).toBe("wayland");
    expect(hostDisplay({ DISPLAY: ":0" }, "linux")).toBe("x11");
    expect(hostDisplay({ SSH_CONNECTION: "1 2 3 4" }, "linux")).toBeNull();
  });

  // Skipped on Windows: the clipboard program stubs are Bun scripts started through their shebang (and read through /proc), which Windows cannot run; the Windows host has no program and its logic is covered by clipboard-windows.test.ts with the platform injected.
  test.skipIf(WINDOWS)("pbcopy and pbpaste only on the environment's PATH, and only on macOS", () => {
    const { stubs: s } = setup(["pbcopy", "pbpaste", "wl-copy"]);
    expect(findCopyHelper("macos", { PATH: s.bin })).toEqual({ name: "pbcopy", argv: [join(s.bin, "pbcopy")], env: { LANG: UTF8, LC_CTYPE: UTF8, LC_ALL: UTF8 } });
    expect(findPasteHelper("macos", { PATH: s.bin })).toEqual({ name: "pbpaste", argv: [join(s.bin, "pbpaste"), "-Prefer", "txt"], env: { LANG: UTF8, LC_CTYPE: UTF8, LC_ALL: UTF8 } });
    expect(findCopyHelper("macos", {})).toBeNull();
    expect(findPasteHelper("macos", {})).toBeNull();
    // Linux reads natively: no paste program, even with pbpaste on PATH.
    expect(findPasteHelper("wayland", { PATH: s.bin })).toBeNull();
    expect(findPasteHelper("x11", { PATH: s.bin })).toBeNull();
    expect(findPasteHelper(null, { PATH: s.bin })).toBeNull();
    // macOS does not fall back to wl-copy.
    const onlyWl = makeStubs(["wl-copy"]);
    expect(findCopyHelper("macos", { PATH: onlyWl.bin })).toBeNull();
  });
});

describe("copy on macOS", () => {
  // Skipped on Windows: the clipboard program stubs are Bun scripts started through their shebang (and read through /proc), which Windows cannot run; the Windows host has no program and its logic is covered by clipboard-windows.test.ts with the platform injected.
  test.skipIf(WINDOWS)("pbcopy gets the text on stdin with an argument list, no shell, a UTF-8 locale, and the toast names it", async () => {
    const { stubs: s, env } = setup(["pbcopy"], { LANG: "C" });
    const native = fakeHost();
    const renderer = fakeRenderer();
    const logged: DebugLogEntry[] = [];
    const copier = createCopier({ renderer, host: native.host, env, platform: DARWIN, logger: { enabled: true, log: (e) => void logged.push(e) } });
    expect(copier.display).toBe("macos");
    const text = "$(touch pwned) 'a' \"b\" `c` ; echo x | cat\nline two é 漢 \u{1F600}\n";
    const outcome = await copier.copy(text, "test");
    expect(outcome).toMatchObject({ path: "host", via: "pbcopy" });
    const chars = Array.from(text).length;
    expect(copyToast(chars, outcome, copier.display)).toEqual({ text: `copied ${chars} chars to the macOS clipboard (pbcopy)`, ok: true });
    const rec = s.record("pbcopy")!;
    expect(rec.argv).toEqual([]);
    expect(rec.stdin).toBe(text);
    expect(rec.LANG).toBe(UTF8);
    expect(rec.LC_ALL).toBe(UTF8);
    expect(rec.servingPid).toBeNull();
    expect(["sh", "bash", "dash", "zsh", "fish"]).not.toContain(rec.parent);
    expect(existsSync(join(process.cwd(), "pwned"))).toBe(false);
    expect(exists(rec.pid)).toBe(false);
    expect(native.writes).toEqual([]);
    expect(renderer.writes).toEqual([]);
    expect(logged[0]).toMatchObject({ event: "clipboard", path: "host", via: "pbcopy", helper: "written" });
    await copier.dispose();
  });

  // Skipped on Windows: the clipboard program stubs are Bun scripts started through their shebang (and read through /proc), which Windows cannot run; the Windows host has no program and its logic is covered by clipboard-windows.test.ts with the platform injected.
  test.skipIf(WINDOWS)("clipboard host uses pbcopy as well", async () => {
    const { stubs: s, env } = setup(["pbcopy"]);
    const outcome = await createCopier({ renderer: fakeRenderer(), host: fakeHost().host, env, platform: DARWIN, mode: "host" }).copy("abc", "test");
    expect(outcome).toMatchObject({ path: "host", via: "pbcopy" });
    expect(s.record("pbcopy")?.stdin).toBe("abc");
  });

  test("no pbcopy: the native backend writes the pasteboard, and the toast makes no 'until acp-tui exits' claim", async () => {
    const { env } = setup([]);
    const native = fakeHost();
    const copier = createCopier({ renderer: fakeRenderer(), host: native.host, env, platform: DARWIN });
    const outcome = await copier.copy("abc", "test");
    expect(outcome).toMatchObject({ path: "host", via: "native" });
    expect(native.writes).toEqual(["abc"]);
    expect(copyToast(3, outcome, copier.display).text).toBe("copied 3 chars to the macOS clipboard");
  });

  // Skipped on Windows: the clipboard program stubs are Bun scripts started through their shebang (and read through /proc), which Windows cannot run; the Windows host has no program and its logic is covered by clipboard-windows.test.ts with the platform injected.
  test.skipIf(WINDOWS)("pbcopy fails: the native backend; it times out: killed, then the native backend", async () => {
    const failing = setup(["pbcopy"], { STUB_MODE: "fail" });
    const native = fakeHost();
    expect(await createCopier({ renderer: fakeRenderer(), host: native.host, env: failing.env, platform: DARWIN }).copy("abc", "test")).toMatchObject({ path: "host", via: "native" });
    expect(failing.stubs.record("pbcopy")?.stdin).toBe("abc");
    expect(native.writes).toEqual(["abc"]);
    failing.stubs.cleanup();

    const hanging = setup(["pbcopy"], { STUB_MODE: "hang" });
    const native2 = fakeHost();
    const outcome = await createCopier({ renderer: fakeRenderer(), host: native2.host, env: hanging.env, platform: DARWIN, helperTimeoutMs: 1500 }).copy("abc", "test");
    expect(outcome).toMatchObject({ path: "host", via: "native" });
    expect(native2.writes).toEqual(["abc"]);
    const pid = hanging.stubs.record("pbcopy")!.pid;
    for (let i = 0; i < 50 && exists(pid); i++) await Bun.sleep(20);
    expect(exists(pid)).toBe(false);
  });

  test("pbcopy fails and the native backend cannot write: OSC 52", async () => {
    const { env } = setup(["pbcopy"], { STUB_MODE: "fail" });
    const renderer = fakeRenderer();
    const outcome = await createCopier({ renderer, host: fakeHost("unsupported").host, env, platform: DARWIN }).copy("abc", "test");
    expect(outcome.path).toBe("osc52");
    expect(renderer.writes).toEqual(["abc"]);
  });

  test("remote: OSC 52 only, pbcopy not started", async () => {
    const { stubs: s, env } = setup(["pbcopy"], { SSH_CONNECTION: "1 2 3 4" });
    const renderer = fakeRenderer(true);
    const copier = createCopier({ renderer, host: fakeHost().host, env, platform: DARWIN });
    expect((await copier.copy("abc", "test")).path).toBe("osc52");
    expect(renderer.writes).toEqual(["abc"]);
    expect(s.record("pbcopy")).toBeNull();
  });

  for (const mode of ["osc52", "none"] as ClipboardMode[]) {
    test(`clipboard ${mode}: pbcopy not started`, async () => {
      const { stubs: s, env } = setup(["pbcopy"]);
      const outcome = await createCopier({ renderer: fakeRenderer(), host: fakeHost().host, env, platform: DARWIN, mode }).copy("abc", "test");
      expect(outcome.path).toBe(mode === "none" ? "none" : "osc52");
      expect(s.record("pbcopy")).toBeNull();
    });
  }
});

describe("paste on macOS", () => {
  // Skipped on Windows: the clipboard program stubs are Bun scripts started through their shebang (and read through /proc), which Windows cannot run; the Windows host has no program and its logic is covered by clipboard-windows.test.ts with the platform injected.
  test.skipIf(WINDOWS)("pbpaste's text is pasted, read with -Prefer txt and a UTF-8 locale; the native backend is not asked; the log names pbpaste, never the text", async () => {
    const text = "two\nlines é 漢 \u{1F600}";
    const { stubs: s, env } = setup(["pbpaste"], { STUB_PASTE: text, LANG: "C" });
    const native = fakeHost("written", { status: "read", representation: { mimeType: "text/plain", bytes: new TextEncoder().encode("native") } });
    const logged: DebugLogEntry[] = [];
    const reader = createClipboardReader({ env, platform: DARWIN, host: native.host, logger: { enabled: true, log: (e) => void logged.push(e) } });
    expect(await reader.read("ctrl+v")).toEqual({ kind: "text", text });
    const rec = s.record("pbpaste")!;
    expect(rec.argv).toEqual(["-Prefer", "txt"]);
    expect(rec.LANG).toBe(UTF8);
    expect(rec.LC_ALL).toBe(UTF8);
    expect(native.reads).toEqual([]);
    expect(logged).toEqual([{ event: "clipboard", direction: "read", trigger: "ctrl+v", mode: "auto", status: "read", result: "text", via: "pbpaste", chars: text.length }]);
    await reader.dispose();
  });

  // Skipped on Windows: the clipboard program stubs are Bun scripts started through their shebang (and read through /proc), which Windows cannot run; the Windows host has no program and its logic is covered by clipboard-windows.test.ts with the platform injected.
  test.skipIf(WINDOWS)("clipboard host reads pbpaste as well", async () => {
    const { env } = setup(["pbpaste"], { STUB_PASTE: "abc" });
    expect(await createClipboardReader({ env, platform: DARWIN, host: NO_HOST, mode: "host" }).read("ctrl+v")).toEqual({ kind: "text", text: "abc" });
  });

  // Skipped on Windows: the clipboard program stubs are Bun scripts started through their shebang (and read through /proc), which Windows cannot run; the Windows host has no program and its logic is covered by clipboard-windows.test.ts with the platform injected.
  test.skipIf(WINDOWS)("an empty pbpaste (no text, or only an image) is nothing to paste, with the existing notice", async () => {
    const { env } = setup(["pbpaste"]);
    const native = fakeHost();
    const read = await createClipboardReader({ env, platform: DARWIN, host: native.host }).read("ctrl+v");
    expect(read).toEqual({ kind: "none", reason: "the clipboard holds no text" });
    expect(pasteNotice(read as Exclude<typeof read, { kind: "text" }>)).toBe("nothing pasted: the clipboard holds no text");
    expect(native.reads).toEqual([]);
  });

  // Skipped on Windows: the clipboard program stubs are Bun scripts started through their shebang (and read through /proc), which Windows cannot run; the Windows host has no program and its logic is covered by clipboard-windows.test.ts with the platform injected.
  test.skipIf(WINDOWS)("pbpaste missing or failing: the native backend reads the pasteboard", async () => {
    const answer: ClipboardReadResult = { status: "read", representation: { mimeType: "text/plain", bytes: new TextEncoder().encode("from native") } };
    const missing = setup([]);
    const native = fakeHost("written", answer);
    expect(await createClipboardReader({ env: missing.env, platform: DARWIN, host: native.host }).read("ctrl+v")).toEqual({ kind: "text", text: "from native" });
    expect(native.reads.length).toBe(1);
    missing.stubs.cleanup();

    const failing = setup(["pbpaste"], { STUB_MODE: "fail", STUB_PASTE: "never" });
    const native2 = fakeHost("written", answer);
    const logged: DebugLogEntry[] = [];
    const reader = createClipboardReader({ env: failing.env, platform: DARWIN, host: native2.host, logger: { enabled: true, log: (e) => void logged.push(e) } });
    expect(await reader.read("ctrl+v")).toEqual({ kind: "text", text: "from native" });
    expect(failing.stubs.record("pbpaste")).not.toBeNull();
    expect(native2.reads.length).toBe(1);
    expect(logged[0]).toMatchObject({ status: "read", via: "native" });
  });

  // Skipped on Windows: the clipboard program stubs are Bun scripts started through their shebang (and read through /proc), which Windows cannot run; the Windows host has no program and its logic is covered by clipboard-windows.test.ts with the platform injected.
  test.skipIf(WINDOWS)("pbpaste does not answer in time: killed, and the notice says so", async () => {
    const { stubs: s, env } = setup(["pbpaste"], { STUB_MODE: "hang" });
    const native = fakeHost();
    expect(await createClipboardReader({ env, platform: DARWIN, host: native.host, helperTimeoutMs: 1500 }).read("ctrl+v")).toEqual({ kind: "none", reason: "the clipboard did not answer in time" });
    const pid = s.record("pbpaste")!.pid;
    for (let i = 0; i < 50 && exists(pid); i++) await Bun.sleep(20);
    expect(exists(pid)).toBe(false);
    expect(native.reads).toEqual([]);
  });

  // Skipped on Windows: the clipboard program stubs are Bun scripts started through their shebang (and read through /proc), which Windows cannot run; the Windows host has no program and its logic is covered by clipboard-windows.test.ts with the platform injected.
  test.skipIf(WINDOWS)("more than the limit: limit-exceeded, the process killed", async () => {
    const { stubs: s, env } = setup(["pbpaste"], { STUB_PASTE: "x".repeat(64) });
    const helper = findPasteHelper("macos", env)!;
    expect(await runPasteHelper(helper, env, 2000, 63)).toEqual({ status: "limit-exceeded" });
    expect(await runPasteHelper(helper, env, 2000, 64)).toMatchObject({ status: "read", representation: { mimeType: "text/plain" } });
    const pid = s.record("pbpaste")!.pid;
    for (let i = 0; i < 50 && exists(pid); i++) await Bun.sleep(20);
    expect(exists(pid)).toBe(false);
  });

  test("clipboard osc52 and none, or a Mac over SSH: pbpaste is never run", async () => {
    const { stubs: s, env } = setup(["pbpaste"], { STUB_PASTE: "abc" });
    const native = fakeHost();
    expect(await createClipboardReader({ env, platform: DARWIN, host: native.host, mode: "osc52" }).read("ctrl+v")).toEqual({ kind: "none", reason: NO_CLIPBOARD_REASON });
    expect(await createClipboardReader({ env, platform: DARWIN, host: native.host, mode: "none" }).read("ctrl+v")).toEqual({ kind: "none", reason: "clipboard off (clipboard: none)" });
    expect(await createClipboardReader({ env: { ...env, SSH_CONNECTION: "1 2 3 4" }, platform: DARWIN }).read("ctrl+v")).toEqual({ kind: "none", reason: NO_CLIPBOARD_REASON });
    expect(s.record("pbpaste")).toBeNull();
    expect(native.reads).toEqual([]);
  });

  test("on Linux pbpaste on PATH is never run: the native backend reads, as before", async () => {
    const { stubs: s, env } = setup(["pbpaste"], { STUB_PASTE: "abc", WAYLAND_DISPLAY: "acp-tui-test-wayland" });
    const native = fakeHost("written", { status: "read", representation: { mimeType: "text/plain", bytes: new TextEncoder().encode("native") } });
    const logged: DebugLogEntry[] = [];
    const read = await createClipboardReader({ env, platform: "linux", host: native.host, logger: { enabled: true, log: (e) => void logged.push(e) } }).read("ctrl+v");
    expect(read).toEqual({ kind: "text", text: "native" });
    expect(s.record("pbpaste")).toBeNull();
    expect(logged[0]).not.toHaveProperty("via");
  });
});
