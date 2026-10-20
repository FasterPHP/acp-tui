// parallel-tests task 3.4: the armed two-press tests across a reload (task 3.5), whose assertions are time bounds (an armed state is still armed after a reload, inside a two-second window, and a keys reload disarms it within 1.5 s), which run in the serial pass.
// What the file covers is in the header of reload-state.pty.test.ts; its helpers are in reload-state-helpers.ts.
import { afterEach, describe, expect, test } from "bun:test";
import { configHome } from "../pty/config-home.ts";
import { CARD_HEADER, promptText, READY, REQUIRES_ACTION, statusRow } from "../pty/regions.ts";
import { start, reload, connectionMark, promptFocused, disposeRun } from "./reload-state-helpers.ts";

afterEach(disposeRun);

// -- Armed two-press states -------------------------------------------------------------------

describe("armed two-press states across a reload (task 3.5)", () => {
  const INTERRUPT_ARMED = "esc again to interrupt";

  test("an armed double Esc is left armed by a reload that does not touch keys and disarmed by one that does, and the next Esc arms again instead of cancelling", async () => {
    const cfg = configHome({});
    const r = start(cfg, "basic", 100, 30, 1000);
    const s = r.session;
    await s.waitFor(READY, 10000);
    s.sendKeys({ text: "go" }, "Enter");
    await s.waitFor((p) => /\brunning\b/.test(statusRow(p)), 10000);
    await Bun.sleep(300);
    s.sendKeys("Esc");
    await s.waitFor((p) => statusRow(p).includes(INTERRUPT_ARMED), 5000);

    // Not a keys reload: still armed (the window is two seconds, the reload takes well under).
    await reload(r, cfg, { layout: { modules: { connection: { format: "link {state}" } } } }, false);
    await s.waitFor((p) => connectionMark(p, "link connected"), 3000);
    expect(statusRow(s)).toContain(INTERRUPT_ARMED);

    // A keys reload disarms. Re-arm first, since the window may have passed.
    await Bun.sleep(2200);
    await s.waitFor((p) => !statusRow(p).includes(INTERRUPT_ARMED), 5000);
    s.sendKeys("Esc");
    await s.waitFor((p) => statusRow(p).includes(INTERRUPT_ARMED), 5000);
    const armedAt = Date.now();
    const event = await reload(r, cfg, { layout: { modules: { connection: { format: "link {state}" } } }, keys: { global: { "ctrl+q": "detach" } } }, false);
    expect(event["changed"]).toEqual(["keys"]);
    await s.waitFor((p) => !statusRow(p).includes(INTERRUPT_ARMED), 3000);
    // Disarmed by the swap, not by the two-second window running out.
    expect(Date.now() - armedAt).toBeLessThan(1500);
    // The press that would have completed it arms again; nothing was cancelled.
    expect(r.agentMethods()).not.toContain("session/cancel");
    s.sendKeys("Esc");
    await s.waitFor((p) => statusRow(p).includes(INTERRUPT_ARMED), 5000);
    expect(r.agentMethods()).not.toContain("session/cancel");
    expect(s.exitCode).toBeNull();
  }, 60000);

  test("an armed Ctrl+D is disarmed by a reload that changes keys: the next Ctrl+D arms again instead of detaching", async () => {
    const cfg = configHome({});
    const r = start(cfg, "basic", 100, 30);
    const s = r.session;
    await s.waitFor(READY, 10000);
    s.sendKeys({ text: "go" }, "Enter");
    await s.waitFor(CARD_HEADER, 5000);
    await s.waitFor((p) => REQUIRES_ACTION.test(statusRow(p)), 5000);
    // The card has focus; Esc returns to the prompt box (arming interrupt), and an ordinary key
    // disarms that, so Ctrl+D is the first press.
    s.sendKeys("Esc");
    await s.waitFor((p) => promptFocused(p), 5000);
    await Bun.sleep(150);
    expect(promptText(s)).toEqual([""]);
    s.sendKeys("Ctrl+D");
    await s.waitFor((p) => statusRow(p).includes("ctrl+d again to detach and stop the turn"), 5000);
    const armedAt = Date.now();
    const event = await reload(r, cfg, { keys: { global: { "ctrl+q": "detach" } } }, false);
    expect(event["changed"]).toEqual(["keys"]);
    await s.waitFor((p) => !statusRow(p).includes("again to detach"), 3000);
    // Disarmed by the swap, not by the two-second window running out.
    expect(Date.now() - armedAt).toBeLessThan(1500);
    expect(s.exitCode).toBeNull();
    s.sendKeys("Ctrl+D");
    await s.waitFor((p) => statusRow(p).includes("ctrl+d again to detach and stop the turn"), 5000);
    expect(s.exitCode).toBeNull();
    // Completing it still detaches.
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
  }, 60000);
});
