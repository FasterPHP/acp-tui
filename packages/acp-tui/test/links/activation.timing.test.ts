// parallel-tests task 3.4: the activation token failure test, which ends with a time bound (a silent compositor times out within 1 s of a 150 ms timeout), so it runs in the serial pass.
// What the file covers is in the header of activation.test.ts; its helpers are in activation-helpers.ts.
import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { activationToken } from "../../src/links/activation.ts";
import { fakeCompositor } from "./fake-compositor.ts";
import { socketDir } from "./activation-helpers.ts";

describe("the activation token (C7)", () => {
  test("every failure is a reason, never an exception: no display, no protocol, no compositor, an error, no answer", async () => {
    expect(await activationToken({})).toEqual({ token: null, reason: "no-wayland" });
    const { dir, path } = socketDir();
    try {
      expect(await activationToken({ WAYLAND_DISPLAY: join(dir, "missing") })).toEqual({ token: null, reason: "failed" });
      const without = fakeCompositor(path, { offerActivation: false });
      expect(await activationToken({ WAYLAND_DISPLAY: path })).toEqual({ token: null, reason: "no-activation" });
      without.server.stop(true);
      rmSync(path, { force: true });
      const failing = fakeCompositor(path, { error: true });
      expect(await activationToken({ WAYLAND_DISPLAY: path })).toEqual({ token: null, reason: "failed" });
      failing.server.stop(true);
      rmSync(path, { force: true });
      const silent = fakeCompositor(path, { silent: true });
      const t0 = performance.now();
      expect(await activationToken({ WAYLAND_DISPLAY: path }, 150)).toEqual({ token: null, reason: "timeout" });
      expect(performance.now() - t0).toBeLessThan(1000);
      silent.server.stop(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
