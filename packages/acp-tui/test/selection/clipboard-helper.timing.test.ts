// parallel-tests task 3.4: the wl-copy test, which ends with a time bound (the copy returns within 5 s although the program's serving child runs for 30 s), so it runs in the serial pass.
// What the file covers is in the header of clipboard-helper.test.ts; its helpers are in clipboard-helper-helpers.ts.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { copyToast, createCopier } from "../../src/selection/clipboard.ts";
import { alive, exists } from "./clipboard-stub.ts";
import { fakeRenderer, fakeHost, setup, WAYLAND, disposeStubs } from "./clipboard-helper-helpers.ts";
import { WINDOWS } from "../windows.ts";

afterEach(disposeStubs);

// Skipped on Windows: the clipboard program stubs are Bun scripts started through their shebang (and read through /proc), which Windows cannot run; the Windows host has no program and its logic is covered by clipboard-windows.test.ts with the platform injected.
describe.skipIf(WINDOWS)("copy through the clipboard program", () => {
  test("Wayland: wl-copy gets the text on stdin with an argument list, no shell, and the copy does not wait for its serving child", async () => {
    const { stubs: s, env } = setup(["wl-copy"], WAYLAND);
    const host = fakeHost();
    const renderer = fakeRenderer();
    const copier = createCopier({ renderer, host, env });
    const text = "$(touch pwned) 'a' \"b\" `c` ; echo x | cat\nline two é 漢 \u{1F600}\n";
    const t0 = performance.now();
    const outcome = await copier.copy(text, "test");
    const ms = performance.now() - t0;
    expect(outcome.path).toBe("host");
    expect(outcome.via).toBe("wl-copy");
    expect(copyToast(Array.from(text).length, outcome, copier.display).text).toBe(`copied ${Array.from(text).length} chars to the Wayland clipboard (wl-copy)`);
    const rec = s.record("wl-copy")!;
    expect(rec.argv).toEqual(["--type", "text/plain"]);
    expect(rec.stdin).toBe(text);
    expect(rec.WAYLAND_DISPLAY).toBe("acp-tui-test-wayland");
    expect(["sh", "bash", "dash", "zsh", "fish"]).not.toContain(rec.parent);
    expect(existsSync(join(process.cwd(), "pwned"))).toBe(false);
    expect(existsSync("/pwned")).toBe(false);
    // Neither the native backend nor OSC 52 was used.
    expect(host.writes).toEqual([]);
    expect(renderer.writes).toEqual([]);
    // The stub's serving child is still running (the copy did not wait for it: it sleeps 30 s),
    // and the stub itself was reaped (no zombie left).
    expect(ms).toBeLessThan(5000);
    expect(alive(rec.servingPid!)).toBe(true);
    expect(exists(rec.pid)).toBe(false);
    await copier.dispose();
  });
});
