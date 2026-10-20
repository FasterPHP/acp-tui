// Phase-1a task 8.5 (design D2, D4; spec tui-screen "Mouse policy"): which
// reports each policy lets through, the renderer configuration per policy,
// the SGR code logged for a wheel report, and the F2 toggle.
import { describe, expect, test } from "bun:test";
import type { CliRenderer } from "@opentui/core";
import { rendererConfig } from "../../src/renderer/create.ts";
import { acceptsMouseReport, createMouseReload, createMouseToggle, isPrimaryPress, MOUSE_RELOAD_FAILED, MOUSE_RETRY_MS, MOUSE_TOGGLE_FAILED, mouseReporting, setMouseReporting, setMousePolicy, wheelCode, type MouseReport } from "../../src/renderer/mouse.ts";
import type { MousePolicy } from "../../src/renderer/options.ts";

const NONE = { shift: false, alt: false, ctrl: false };
const report = (type: string, button = 0, extra: Partial<MouseReport> = {}): MouseReport => ({ type, button, x: 1, y: 1, modifiers: NONE, ...extra });
const wheel = (direction: "up" | "down", shift = false) => report("scroll", 0, { scroll: { direction, delta: 1 }, modifiers: { ...NONE, shift } });

describe("policies", () => {
  test("reporting is on unless the policy is off", () => {
    expect(mouseReporting("full")).toBe(true);
    expect(mouseReporting("wheel")).toBe(true);
    expect(mouseReporting("off")).toBe(false);
  });

  test("full: everything but the right button", () => {
    for (const type of ["down", "up", "drag", "move", "scroll"]) expect(acceptsMouseReport("full", type === "scroll" ? wheel("up") : report(type))).toBe(true);
    for (const type of ["down", "up", "drag"]) expect(acceptsMouseReport("full", report(type, 2))).toBe(false);
  });

  test("wheel: only the wheel (JediTerm's 68 and 69 included)", () => {
    expect(acceptsMouseReport("wheel", wheel("up"))).toBe(true);
    expect(acceptsMouseReport("wheel", wheel("down", true))).toBe(true);
    for (const type of ["down", "up", "drag", "move"]) expect(acceptsMouseReport("wheel", report(type))).toBe(false);
  });

  test("off: nothing", () => {
    expect(acceptsMouseReport("off", wheel("up"))).toBe(false);
    expect(acceptsMouseReport("off", report("down"))).toBe(false);
  });

  test("a primary press is a left-button down", () => {
    expect(isPrimaryPress(report("down"))).toBe(true);
    expect(isPrimaryPress(report("down", 2))).toBe(false);
    expect(isPrimaryPress(report("up"))).toBe(false);
  });

  test("wheel codes: 64 and 65, 68 and 69 with shift", () => {
    expect(wheelCode(wheel("up"))).toBe(64);
    expect(wheelCode(wheel("down"))).toBe(65);
    expect(wheelCode(wheel("up", true))).toBe(68);
    expect(wheelCode(wheel("down", true))).toBe(69);
    expect(wheelCode(report("down"))).toBeNull();
  });
});

describe("renderer configuration (design D2)", () => {
  test("useMouse unless off; all-motion reporting under full only (the hover feedback, review C12); no auto focus", () => {
    expect(rendererConfig({ mouse: "full" })).toMatchObject({ useMouse: true, enableMouseMovement: true, autoFocus: false });
    expect(rendererConfig({ mouse: "wheel" })).toMatchObject({ useMouse: true, enableMouseMovement: false });
    expect(rendererConfig({ mouse: "off" })).toMatchObject({ useMouse: false, enableMouseMovement: false });
    expect(rendererConfig()).toMatchObject({ enableMouseMovement: true });
    expect(rendererConfig()).toMatchObject({ screenMode: "alternate-screen", useMouse: true, exitSignals: [] });
  });
});

describe("F2 toggle", () => {
  function toggleFor(chosen: MousePolicy) {
    let current = chosen;
    const renderer = { useMouse: mouseReporting(chosen) } as CliRenderer;
    const toggle = createMouseToggle({ renderer, chosen, current: () => current, set: (p) => void (current = p) });
    return { toggle, renderer, current: () => current };
  }

  test("between the chosen policy and off, through useMouse", () => {
    for (const chosen of ["full", "wheel"] as const) {
      const t = toggleFor(chosen);
      expect(t.toggle()).toBe(true);
      expect(t.current()).toBe("off");
      expect(t.renderer.useMouse).toBe(false);
      expect(t.toggle()).toBe(true);
      expect(t.current()).toBe(chosen);
      expect(t.renderer.useMouse).toBe(true);
    }
  });

  // OpenTUI 0.6's setter throws during a terminal transition (opentui-0-6 design D8).
  function transitionRenderer(failures: number) {
    let value = true;
    let left = failures;
    const frames: (() => void)[] = [];
    const renderer = {
      isDestroyed: false,
      get useMouse() {
        return value;
      },
      set useMouse(on: boolean) {
        if (left > 0) {
          left -= 1;
          throw new Error("Cannot change native scene mouse modes during a terminal transition or suspension");
        }
        value = on;
      },
      once: (_event: string, fn: () => void) => void frames.push(fn),
      off: (_event: string, fn: () => void) => void frames.splice(frames.indexOf(fn) >>> 0, 1),
      requestRender: () => {},
    } as unknown as CliRenderer;
    return { renderer, frame: () => frames.splice(0).forEach((fn) => fn()) };
  }

  test("a throwing setter during a terminal transition: retried once on the next frame", () => {
    const { renderer, frame } = transitionRenderer(1);
    let current = "full" as MousePolicy;
    const notices: string[] = [];
    const toggle = createMouseToggle({ renderer, chosen: "full", current: () => current, set: (p) => void (current = p), notify: (t) => void notices.push(t) });
    expect(toggle()).toBe(true);
    // Not yet: the store's policy changes only once the setter has accepted it.
    expect(current).toBe("full");
    expect(renderer.useMouse).toBe(true);
    frame();
    expect(current).toBe("off");
    expect(renderer.useMouse).toBe(false);
    expect(notices).toEqual([]);
  });

  test("a setter that throws again on the retry: the policy is unchanged and a notice says so", () => {
    const { renderer, frame } = transitionRenderer(2);
    let current = "wheel" as MousePolicy;
    const notices: string[] = [];
    const toggle = createMouseToggle({ renderer, chosen: "wheel", current: () => current, set: (p) => void (current = p), notify: (t) => void notices.push(t) });
    expect(toggle()).toBe(true);
    frame();
    expect(current).toBe("wheel");
    expect(renderer.useMouse).toBe(true);
    expect(notices).toEqual([MOUSE_TOGGLE_FAILED]);
  });

  test("the retry runs after MOUSE_RETRY_MS when no frame comes", async () => {
    const { renderer } = transitionRenderer(1);
    let done = null as boolean | null;
    setMouseReporting(renderer, false, (ok) => void (done = ok));
    expect(done).toBeNull();
    await Bun.sleep(MOUSE_RETRY_MS + 50);
    expect(done).toBe(true);
    expect(renderer.useMouse).toBe(false);
  });

  test("any other error from the setter is not swallowed", () => {
    const renderer = {
      set useMouse(_on: boolean) {
        throw new Error("something else");
      },
    } as unknown as CliRenderer;
    expect(() => setMouseReporting(renderer, true, () => {})).toThrow("something else");
  });

  test("with --mouse off there is nothing to flip", () => {
    const t = toggleFor("off");
    expect(t.toggle()).toBe(false);
    expect(t.current()).toBe("off");
    expect(t.renderer.useMouse).toBe(false);
  });
});

// mvp-configuration task 4.1 (design D6; spec tui-config "Screen settings"): a reload that changes
// `mouse` re-applies the policy through the guarded setter F2 uses.
describe("the mouse policy on a reload", () => {
  /** A stand-in renderer with OpenTUI's private all-motion field, recording the modes it writes;
   *  its setter throws the transition error `failures` times. */
  function policyRenderer(policy: MousePolicy, failures = 0) {
    let value = policy !== "off";
    let left = failures;
    const writes: string[] = [];
    const frames: (() => void)[] = [];
    const raw = {
      isDestroyed: false,
      enableMouseMovement: policy === "full",
      get useMouse() {
        return value;
      },
      set useMouse(on: boolean) {
        if (left > 0) {
          left -= 1;
          throw new Error("Cannot change native scene mouse modes during a terminal transition or suspension");
        }
        if (on === value) return;
        value = on;
        writes.push(on ? (raw.enableMouseMovement ? "motion" : "drag") : "disabled");
      },
      once: (_event: string, fn: () => void) => void frames.push(fn),
      off: (_event: string, fn: () => void) => void frames.splice(frames.indexOf(fn) >>> 0, 1),
      requestRender: () => {},
    };
    return { renderer: raw as unknown as CliRenderer, raw, writes, frame: () => frames.splice(0).forEach((fn) => fn()) };
  }

  function reloadFor(policy: MousePolicy, failures = 0) {
    const r = policyRenderer(policy, failures);
    let chosen = policy;
    let current = policy;
    const notices: string[] = [];
    let refused = 0;
    const apply = createMouseReload({
      renderer: r.renderer,
      chosen: () => chosen,
      setChosen: (p) => void (chosen = p),
      current: () => current,
      set: (p) => void (current = p),
      notify: (t) => void notices.push(t),
      onRefused: () => void (refused += 1),
    });
    const toggle = createMouseToggle({ renderer: r.renderer, chosen: () => chosen, current: () => current, set: (p) => void (current = p) });
    return { ...r, apply, toggle, chosen: () => chosen, current: () => current, notices, refused: () => refused };
  }

  test("full to wheel and back: reporting stays on and all-motion reporting is switched", () => {
    const t = reloadFor("full");
    t.apply("wheel");
    expect([t.chosen(), t.current()]).toEqual(["wheel", "wheel"]);
    expect(t.raw.enableMouseMovement).toBe(false);
    expect(t.writes).toEqual(["disabled", "drag"]);
    t.apply("full");
    expect(t.raw.enableMouseMovement).toBe(true);
    expect(t.writes).toEqual(["disabled", "drag", "disabled", "motion"]);
  });

  test("to off and back on; F2 then toggles between the newly chosen policy and off", () => {
    const t = reloadFor("full");
    t.apply("off");
    expect(t.renderer.useMouse).toBe(false);
    expect(t.current()).toBe("off");
    // With the setting off, F2 has nothing to flip.
    expect(t.toggle()).toBe(false);
    t.apply("wheel");
    expect([t.renderer.useMouse, t.raw.enableMouseMovement, t.current()]).toEqual([true, false, "wheel"]);
    expect(t.toggle()).toBe(true);
    expect(t.current()).toBe("off");
    expect(t.toggle()).toBe(true);
    expect(t.current()).toBe("wheel");
    expect(t.writes.at(-1)).toBe("drag");
  });

  test("a new policy resets an F2 toggle", () => {
    const t = reloadFor("full");
    t.toggle();
    expect(t.current()).toBe("off");
    t.apply("wheel");
    expect([t.current(), t.renderer.useMouse]).toEqual(["wheel", true]);
  });

  test("Mouse reload while the terminal is busy: a setter that throws once is applied on the next frame", () => {
    const t = reloadFor("full", 1);
    t.apply("off");
    expect([t.current(), t.renderer.useMouse]).toEqual(["full", true]);
    t.frame();
    expect([t.chosen(), t.current(), t.renderer.useMouse]).toEqual(["off", "off", false]);
    expect(t.notices).toEqual([]);
  });

  test("Mouse reload while the terminal is busy: refused twice, reporting stays on and the policy is kept with a notice; the next reload turns it off", () => {
    const t = reloadFor("full", 2);
    t.apply("off");
    t.frame();
    expect([t.chosen(), t.current(), t.renderer.useMouse, t.raw.enableMouseMovement]).toEqual(["full", "full", true, true]);
    expect(t.notices).toEqual([MOUSE_RELOAD_FAILED]);
    expect(t.refused()).toBe(1);
    // Saving the file again once the transition is over.
    t.apply("off");
    expect([t.chosen(), t.current(), t.renderer.useMouse]).toEqual(["off", "off", false]);
  });

  test("setMousePolicy leaves the all-motion field as it was when the terminal stays busy", () => {
    const r = policyRenderer("off", 2);
    let result = null as boolean | null;
    setMousePolicy(r.renderer, "full", (ok) => void (result = ok));
    r.frame();
    expect(result).toBe(false);
    expect([r.raw.useMouse, r.raw.enableMouseMovement]).toEqual([false, false]);
    expect(r.writes).toEqual([]);
  });
});
