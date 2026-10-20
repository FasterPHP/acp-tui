// Mouse policy (design D2, D4; spec tui-screen "Mouse policy", "Live mouse
// toggle", "JetBrains mouse input is harmless").
//
// - `full`: reporting on (modes 1000, 1002, 1003, 1006: all motion, for the
//   hover feedback, mvp-rendering review C12); the wheel scrolls the region
//   under the pointer and a primary click acts on the element under it (the
//   conversation toggles a tool, thought or plan line; each region takes
//   focus). Motion without a button is hover, never a drag or a click.
// - `wheel`: reporting on, only wheel reports get through.
// - `off`: reporting off.
// A right click does nothing under every policy.
//
// The policy check is one wrapper around every mouse report, before OpenTUI
// dispatches it (`installMouseInput`): under `wheel` anything but the wheel is
// dropped, and right-button reports always are, so no component, OpenTUI's
// own selection or the textarea can act on them. This wraps OpenTUI's private
// `processSingleMouseEvent` (the second OpenTUI internal after
// `forceFullRepaintRequested`, renderer/repaint.ts): mouse reports never
// reach `prependInputHandler` while reporting is on, so there is no public
// hook ahead of dispatch. The PTY test "Clicks ignored under wheel" fails if
// the hook stops working. The same wrapper logs a `wheel` event per wheel
// report (task 10.4 counts them per notch) and tells the JediTerm filter
// (jediterm-filter.ts) when one arrived.
//
// F2 flips between the chosen policy and `off` through OpenTUI's `useMouse`
// setter, which writes the enable or disable sequences at once; the effective
// policy lives in the store (`ui.mouse`), read by the `mouse` bar module and
// by this wrapper. Since OpenTUI 0.6 the setter throws while the renderer is
// in a terminal transition (start-up capability negotiation, suspend), so it
// is set through `setMouseReporting` (opentui-0-6 design D8): one retry on the
// next frame, then the policy is left as it was and the caller shows a notice.
// The live `mouse` reload (mvp-configuration design D6, `createMouseReload`)
// goes through the same guard (`setMousePolicy`), which also switches
// all-motion reporting between `full` and `wheel`; F2 then toggles between
// the newly chosen policy and `off`.
import { CliRenderEvents, type CliRenderer } from "@opentui/core";
import { NULL_LOGGER, type DebugLogger } from "../log.ts";
import type { MousePolicy } from "./options.ts";
import type { WheelStep } from "./wheel.ts";

/** Whether the terminal reports the mouse at all under `policy`. */
export function mouseReporting(policy: MousePolicy): boolean {
  return policy !== "off";
}

/** The fields of a parsed mouse report the policy looks at (OpenTUI's `RawMouseEvent`). */
export interface MouseReport {
  readonly type: string;
  readonly button: number;
  readonly x: number;
  readonly y: number;
  readonly modifiers: { readonly shift: boolean; readonly alt: boolean; readonly ctrl: boolean };
  readonly scroll?: { readonly direction: "up" | "down" | "left" | "right"; readonly delta: number };
}

const RIGHT_BUTTON = 2;

/** Whether a report may act under `policy`: the wheel always (while reporting), anything else
 *  only under `full`, a right click never. */
export function acceptsMouseReport(policy: MousePolicy, report: MouseReport): boolean {
  if (policy === "off") return false;
  if (report.type === "scroll") return true;
  if (policy !== "full") return false;
  // Plain motion arrives as button 0 (OpenTUI maps "no button" to 0), so this drops only
  // right-button presses, releases and drags.
  return report.button !== RIGHT_BUTTON;
}

/** A primary (left) button press: what a click handler acts on. */
export function isPrimaryPress(event: { readonly type: string; readonly button: number }): boolean {
  return event.type === "down" && event.button === 0;
}

const SCROLL_CODES = { up: 64, down: 65, left: 66, right: 67 } as const;

/** The SGR button code of a wheel report (JediTerm's 68 and 69 are 64 and 65 with shift). */
export function wheelCode(report: MouseReport): number | null {
  if (report.type !== "scroll" || !report.scroll) return null;
  const m = report.modifiers;
  return SCROLL_CODES[report.scroll.direction] | (m.shift ? 4 : 0) | (m.alt ? 8 : 0) | (m.ctrl ? 16 : 0);
}

export interface MouseInputOptions {
  /** The effective policy, read for every report. */
  policy: () => MousePolicy;
  /** Logged with each `wheel` event. */
  wheel: WheelStep;
  logger?: DebugLogger;
  /** Called for every wheel report that gets through (the JediTerm filter's clock). */
  onWheel?: () => void;
  /** Sees every report that passed the policy, before OpenTUI does, and decides whether to hand
   *  it on (`dispatch`) or consume it (the selection, src/selection/select.tsx). Without it every report that passed is dispatched. */
  intercept?: MouseIntercept;
}

export type MouseDispatch = (report: MouseReport) => boolean;

/** A hook between the policy check and OpenTUI's dispatch; returns what `dispatch` would (true
 *  when the report was consumed). */
export type MouseIntercept = (report: MouseReport, dispatch: MouseDispatch) => boolean;

/**
 * Puts the policy check in front of OpenTUI's mouse dispatch, and logs each wheel report as
 * `{ event: "wheel", code, direction, x, y, rows, terminal, source }` (`rows` is the step per
 * event in use, not the rows a region scrolled). Returns a function that removes the wrapper.
 */
export function installMouseInput(renderer: CliRenderer, options: MouseInputOptions): () => void {
  const target = renderer as unknown as { processSingleMouseEvent: MouseDispatch };
  const original = target.processSingleMouseEvent;
  if (typeof original !== "function") throw new Error("OpenTUI no longer has processSingleMouseEvent (renderer/mouse.ts)");
  const logger = options.logger ?? NULL_LOGGER;
  const dispatch = original.bind(renderer);
  target.processSingleMouseEvent = (report) => {
    // Consumed either way: a dropped report must not reach the key input handlers as text.
    if (!acceptsMouseReport(options.policy(), report)) return true;
    const code = wheelCode(report);
    if (code !== null) {
      options.onWheel?.();
      const { rows, terminal, source } = options.wheel;
      logger.log({ event: "wheel", code, direction: report.scroll!.direction, x: report.x, y: report.y, rows, terminal, source });
    }
    return options.intercept ? options.intercept(report, dispatch) : dispatch(report);
  };
  return () => {
    target.processSingleMouseEvent = original;
  };
}

/** OpenTUI 0.6's `useMouse` setter refusing a change during a terminal transition or suspension. */
export function isTransitionError(error: unknown): boolean {
  return error instanceof Error && /during a terminal transition/.test(error.message);
}

/** How long the retry waits for the next frame before it tries anyway (a transition may hold
 *  frames back). */
export const MOUSE_RETRY_MS = 100;

/** The notice when F2 could not change the mouse reporting (design D8). */
export const MOUSE_TOGGLE_FAILED = "the terminal was busy, so mouse reporting is unchanged; try again";

/**
 * Sets `renderer.useMouse` to `on`. During a terminal transition OpenTUI's setter throws; then it
 * is tried once more on the next frame (or after `MOUSE_RETRY_MS`, whichever comes first). `done`
 * is called with true once set (synchronously in the usual case) or false when the retry failed
 * too or the renderer was destroyed meanwhile. Any other error is thrown, as before.
 */
export function setMouseReporting(renderer: CliRenderer, on: boolean, done: (ok: boolean) => void): void {
  retryOnTransition(renderer, () => (renderer.useMouse = on), done);
}

/** What the guarded setters use of the renderer (tests give a stand-in). */
export type MouseRenderer = Pick<CliRenderer, "useMouse" | "isDestroyed" | "once" | "off" | "requestRender">;

/** Runs `attempt`; when it throws OpenTUI's transition error, once more on the next frame (or after
 *  `MOUSE_RETRY_MS`). `done(true)` once it ran without throwing, `done(false)` when the retry threw
 *  the transition error too or the renderer was destroyed meanwhile; any other error is thrown. */
function retryOnTransition(renderer: MouseRenderer, attempt: () => void, done: (ok: boolean) => void): void {
  try {
    attempt();
    done(true);
    return;
  } catch (error) {
    if (!isTransitionError(error)) throw error;
  }
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const retry = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    renderer.off(CliRenderEvents.FRAME, retry);
    if (renderer.isDestroyed) return done(false);
    try {
      attempt();
    } catch (error) {
      if (!isTransitionError(error)) throw error;
      return done(false);
    }
    done(true);
  };
  renderer.once(CliRenderEvents.FRAME, retry);
  timer = setTimeout(retry, MOUSE_RETRY_MS);
  renderer.requestRender();
}

/** OpenTUI's private all-motion switch (mode 1003), read by its `enableMouse`; set at construction
 *  from the policy (`create.ts` `rendererConfig`). */
interface MovementField {
  enableMouseMovement: boolean;
}

/**
 * Applies `policy` to the terminal's mouse modes (mvp-configuration design D6, the live `mouse`
 * reload): reporting on or off, and all-motion reporting only under `full`. Between `full` and
 * `wheel`, with reporting on, the modes are written again (off, then on with or without motion),
 * since OpenTUI's setter writes nothing when reporting is already on. Through the same guard as
 * F2: during a terminal transition it is tried once more on the next frame, and `done(false)`
 * means the modes are as they were.
 */
export function setMousePolicy(renderer: MouseRenderer, policy: MousePolicy, done: (ok: boolean) => void): void {
  const fields = renderer as unknown as MovementField;
  const motion = policy === "full";
  const on = mouseReporting(policy);
  retryOnTransition(
    renderer,
    () => {
      if (on && renderer.useMouse && fields.enableMouseMovement !== motion) {
        // Throws before anything changes when the terminal is in a transition.
        renderer.useMouse = false;
        fields.enableMouseMovement = motion;
        renderer.useMouse = true;
        return;
      }
      const before = fields.enableMouseMovement;
      fields.enableMouseMovement = motion;
      try {
        renderer.useMouse = on;
      } catch (error) {
        fields.enableMouseMovement = before;
        throw error;
      }
    },
    done,
  );
}

/** The notice when a reload could not change the mouse policy (spec tui-config "Screen
 *  settings", scenario "Mouse reload while the terminal is busy"). */
export const MOUSE_RELOAD_FAILED = "the terminal was busy, so the mouse policy is unchanged; save the configuration again";

export interface MouseReloadOptions {
  renderer: MouseRenderer;
  /** The policy applied (the one F2 toggles against), changed only once the terminal took it. */
  chosen: () => MousePolicy;
  setChosen: (policy: MousePolicy) => void;
  /** The store's effective policy (`ui.mouse`) and its setter. */
  current: () => MousePolicy;
  set: (policy: MousePolicy) => void;
  /** Shows `MOUSE_RELOAD_FAILED`. */
  notify?: (text: string) => void;
  /** Called after a refusal, so that saving the file again retries even with the same content. */
  onRefused?: () => void;
  logger?: DebugLogger;
}

/**
 * The live `mouse` reload (design D6): `apply(policy)` makes `policy` the chosen policy and the
 * effective one (resetting an F2 toggle, since the user chose a new policy), through
 * `setMousePolicy`. When the terminal stays busy, the policy in use is kept and the notice shown;
 * a later `apply` (the next reload) tries again. Nothing happens when `policy` is already chosen
 * and in effect.
 */
export function createMouseReload(options: MouseReloadOptions): (policy: MousePolicy) => void {
  const logger = options.logger ?? NULL_LOGGER;
  return (policy) => {
    if (policy === options.chosen() && policy === options.current()) return;
    setMousePolicy(options.renderer, policy, (ok) => {
      if (!ok) {
        logger.log({ event: "mouse_policy", policy: options.current(), unchanged: true, cause: "reload" });
        options.notify?.(MOUSE_RELOAD_FAILED);
        options.onRefused?.();
        return;
      }
      options.setChosen(policy);
      options.set(policy);
      logger.log({ event: "mouse_policy", policy, cause: "reload" });
    });
  };
}

/** What F2 needs: the renderer, the chosen policy, and the store's effective policy. */
export interface MouseToggleOptions {
  renderer: CliRenderer;
  /** The chosen policy (the `mouse` setting as last applied, `createMouseReload`). */
  chosen: MousePolicy | (() => MousePolicy);
  current: () => MousePolicy;
  set: (policy: MousePolicy) => void;
  /** Shows `MOUSE_TOGGLE_FAILED` when the terminal stayed in a transition (design D8). */
  notify?: (text: string) => void;
  logger?: DebugLogger;
}

/**
 * F2: flips the effective policy between the chosen one and `off`, writing the enable or disable
 * sequences at once through `useMouse` (`setMouseReporting`: retried once during a terminal
 * transition, the store's policy changed only once it is set). Returns false (and changes
 * nothing) when the chosen policy is `off`.
 */
export function createMouseToggle(options: MouseToggleOptions): () => boolean {
  const logger = options.logger ?? NULL_LOGGER;
  const chosen = typeof options.chosen === "function" ? options.chosen : () => options.chosen as MousePolicy;
  return () => {
    const policy = chosen();
    if (policy === "off") return false;
    const next: MousePolicy = options.current() === "off" ? policy : "off";
    setMouseReporting(options.renderer, mouseReporting(next), (ok) => {
      if (!ok) {
        logger.log({ event: "mouse_policy", policy: options.current(), unchanged: true });
        options.notify?.(MOUSE_TOGGLE_FAILED);
        return;
      }
      options.set(next);
      logger.log({ event: "mouse_policy", policy: next });
    });
    return true;
  };
}
