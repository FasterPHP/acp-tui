// Copied text kept after exit (mvp-chrome-and-keys task 12.6; tui-selection "Copied text kept
// after exit"): the copier hands the text to `wl-copy` or `xclip` when they are on `PATH`, falling
// back to the native host backend. Only stubs run (./clipboard-stub.ts): every environment here
// is given explicitly, with `PATH` the stubs' directory, so the real programs are never found and
// the user's clipboard is never written. The native backend is a fake.
//
// The timing tests of this file are in clipboard-helper.timing.test.ts (parallel-tests: they run in the serial pass).
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { copyToast, createCopier, findCopyHelper, runCopyHelper, type ClipboardMode } from "../../src/selection/clipboard.ts";
import { exists, makeStubs } from "./clipboard-stub.ts";
import { fakeRenderer, fakeHost, setup, WAYLAND, X11, disposeStubs } from "./clipboard-helper-helpers.ts";

afterEach(disposeStubs);

describe("finding the clipboard program", () => {
  test("only on the environment's PATH, and only for the display in use", () => {
    const { stubs: s } = setup(["wl-copy", "xclip"], {});
    expect(findCopyHelper("wayland", { PATH: s.bin })).toEqual({ name: "wl-copy", argv: [join(s.bin, "wl-copy"), "--type", "text/plain"] });
    expect(findCopyHelper("x11", { PATH: s.bin })).toEqual({ name: "xclip", argv: [join(s.bin, "xclip"), "-selection", "clipboard"] });
    expect(findCopyHelper(null, { PATH: s.bin })).toBeNull();
    // No PATH: nothing, even where the real programs are installed.
    expect(findCopyHelper("wayland", {})).toBeNull();
    const none = makeStubs([]);
    expect(findCopyHelper("wayland", { PATH: none.bin })).toBeNull();
    expect(findCopyHelper("x11", { PATH: none.bin })).toBeNull();
    // Wayland does not fall back to xclip.
    const onlyX = makeStubs(["xclip"]);
    expect(findCopyHelper("wayland", { PATH: onlyX.bin })).toBeNull();
  });
});

describe("copy through the clipboard program", () => {
  test("X11: xclip -selection clipboard", async () => {
    const { stubs: s, env } = setup(["xclip"], X11);
    const copier = createCopier({ renderer: fakeRenderer(), host: fakeHost(), env });
    const outcome = await copier.copy("abc", "test");
    expect(outcome).toMatchObject({ path: "host", via: "xclip" });
    expect(copyToast(3, outcome, copier.display).text).toBe("copied 3 chars to the X11 clipboard (xclip)");
    expect(s.record("xclip")).toMatchObject({ argv: ["-selection", "clipboard"], stdin: "abc", DISPLAY: ":99", WAYLAND_DISPLAY: null });
  });

  test("--clipboard host uses the program as well", async () => {
    const { stubs: s, env } = setup(["wl-copy"], WAYLAND);
    const outcome = await createCopier({ renderer: fakeRenderer(), host: fakeHost(), env, mode: "host" }).copy("abc", "test");
    expect(outcome).toMatchObject({ path: "host", via: "wl-copy" });
    expect(s.record("wl-copy")?.stdin).toBe("abc");
  });
});

describe("falling back to the native backend", () => {
  test("no program installed: the native backend, and the toast says the text lasts until acp-tui exits", async () => {
    const { env } = setup([], WAYLAND);
    const host = fakeHost();
    const copier = createCopier({ renderer: fakeRenderer(), host, env });
    const outcome = await copier.copy("abc", "test");
    expect(outcome).toMatchObject({ path: "host", via: "native" });
    expect(host.writes).toEqual(["abc"]);
    expect(copyToast(3, outcome, copier.display).text).toBe("copied 3 chars to the Wayland clipboard (until acp-tui exits)");
  });

  test("the program fails: the native backend", async () => {
    const { stubs: s, env } = setup(["wl-copy"], WAYLAND, { STUB_MODE: "fail" });
    const host = fakeHost();
    const outcome = await createCopier({ renderer: fakeRenderer(), host, env }).copy("abc", "test");
    expect(s.record("wl-copy")?.stdin).toBe("abc");
    expect(outcome).toMatchObject({ path: "host", via: "native" });
    expect(host.writes).toEqual(["abc"]);
  });

  test("the program does not finish in time: it is killed and the native backend takes the text", async () => {
    const { stubs: s, env } = setup(["wl-copy"], WAYLAND, { STUB_MODE: "hang" });
    const host = fakeHost();
    const outcome = await createCopier({ renderer: fakeRenderer(), host, env, helperTimeoutMs: 1500 }).copy("abc", "test");
    expect(outcome).toMatchObject({ path: "host", via: "native" });
    expect(host.writes).toEqual(["abc"]);
    const pid = s.record("wl-copy")!.pid;
    for (let i = 0; i < 50 && exists(pid); i++) await Bun.sleep(20);
    expect(exists(pid)).toBe(false);
  });

  test("the program fails and there is no native backend: OSC 52, as before", async () => {
    const { env } = setup(["wl-copy"], WAYLAND, { STUB_MODE: "fail" });
    const renderer = fakeRenderer();
    const outcome = await createCopier({ renderer, host: fakeHost("unsupported"), env }).copy("abc", "test");
    expect(outcome.path).toBe("osc52");
    expect(outcome.via).toBeUndefined();
    expect(renderer.writes).toEqual(["abc"]);
  });

  test("runCopyHelper reports a missing executable as failed", async () => {
    const result = await runCopyHelper({ name: "wl-copy", argv: ["/nonexistent/acp-tui/wl-copy"] }, "abc", {});
    expect(result.status).toBe("failed");
  });
});

describe("where no program runs", () => {
  test("a remote session: OSC 52 only", async () => {
    const { stubs: s, env } = setup(["wl-copy"], WAYLAND);
    const renderer = fakeRenderer(true);
    const outcome = await createCopier({ renderer, host: fakeHost(), env }).copy("abc", "test");
    expect(outcome.path).toBe("osc52");
    expect(renderer.writes).toEqual(["abc"]);
    expect(s.record("wl-copy")).toBeNull();
  });

  for (const mode of ["osc52", "none"] as ClipboardMode[]) {
    test(`--clipboard ${mode}`, async () => {
      const { stubs: s, env } = setup(["wl-copy"], WAYLAND);
      const outcome = await createCopier({ renderer: fakeRenderer(), host: fakeHost(), env, mode }).copy("abc", "test");
      expect(outcome.path).toBe(mode === "none" ? "none" : "osc52");
      expect(s.record("wl-copy")).toBeNull();
    });
  }

  test("no display", async () => {
    const { stubs: s, env } = setup(["wl-copy", "xclip"], {});
    await createCopier({ renderer: fakeRenderer(), host: fakeHost(), env }).copy("abc", "test");
    expect(s.record("wl-copy")).toBeNull();
    expect(s.record("xclip")).toBeNull();
  });
});
