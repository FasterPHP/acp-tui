// parallel-tests task 3.4: the SIGUSR2 test whose assertion is a time bound (the new surfaces are on screen within one second of the signal), which runs in the serial pass.
// What the file covers is in the header of surfaces.test.ts; its helpers are in surfaces-helpers.ts.
import { afterEach, describe, expect, test } from "bun:test";
import { DARK, LIGHT, openPermission, showing, noneLeft, disposeSession } from "./surfaces-helpers.ts";

afterEach(disposeSession);

describe("Theme switch signalled (task 5.3)", () => {
  test("SIGUSR2 after the terminal's answer changed: new surfaces on screen within one second, every cell repainted", async () => {
    const s = await openPermission(DARK);
    expect(showing(s, DARK)).toBe(true);
    s.setColours(LIGHT);
    const before = s.rawOutput().length;
    const sent = Date.now();
    s.kill("SIGUSR2");
    await s.waitFor((p) => showing(p, LIGHT), 1000);
    expect(Date.now() - sent).toBeLessThan(1000);
    await s.flush();
    expect(noneLeft(s, DARK)).toBe(true);
    // A full repaint writes far more than the changed rows alone.
    expect(s.rawOutput().length - before).toBeGreaterThan(1500);
    expect(s.exitCode).toBeNull();
  }, 30000);
});
