// The full-screen renderer (design 2.6, 6.1, D2 of phase-1a): OpenTUI on the
// alternate screen with design D2's options. Mouse reporting follows the
// mouse policy (`useMouse` unless `off`, renderer/mouse.ts); all-motion
// reporting (1003) under `full`, for the hover feedback (mvp-rendering review
// C12, src/conversation/hover.tsx), never
// under `wheel` or `off`: OpenTUI turns it on unless told otherwise, so
// `RENDERER_OPTIONS` says off and `rendererConfig` sets it from the policy
// (mvp-chrome-and-keys design D15). `autoFocus: false`: a click
// moves focus through acp-tui's own handlers, which keep `ui.focus` (and so
// the key contexts) in step, never by OpenTUI focusing the nearest focusable
// renderable behind the store's back. `exitSignals: []`: signals are owned by
// the lifecycle (lifecycle.ts), which must detach before the renderer is
// destroyed. With OpenTUI's default list, its own handler would destroy the
// renderer first and then leave the process running (a listener suppresses
// the default action).
//
// Kitty keyboard: OpenTUI's default request (disambiguate plus alternate keys)
// is kept, as design D8 needs `CSI 13;2u` for Shift+Enter. The flags are only
// pushed if the terminal answers `CSI ? u`; otherwise OpenTUI sets xterm
// modifyOtherKeys mode 1. `destroy()` pops or resets whichever it set.
//
// The renderer is constructed here rather than through `createCliRenderer`
// (opentui-0-6 design D4), with two things of acp-tui's own:
//
// - a `NativeSession` on stdout that acp-tui constructs and passes as
//   `nativeSession`, so that acp-tui's own escape output (title stack,
//   attention signals, mode 1007; write-out.ts) is queued through its public
//   `write()` in the same output stream as the frames, and the lifecycle can
//   restore and dispose it after a failed teardown (lifecycle.ts); and
// - `environment`: terminal-env.ts's overrides (no width probe, no graphics
//   query, truecolour in JediTerm) and `FORCE_HYPERLINK` (`1` or `0`, the
//   capability table's `osc8`, hyperlinks.ts), which OpenTUI reads in the
//   constructor ahead of the process environment. Nothing is written to
//   `process.env`, so the agent's process (spawned with it) never sees them.
//
// `createCliRenderer` only adds `setupTerminal()` (done below, with the same
// destroy on failure) and a `--delay-start` flag read from `process.argv`,
// which could otherwise be set by an agent argument.
import { CliRenderer, NativeSession, type CliRendererConfig } from "@opentui/core";
import { hyperlinkEnv } from "./hyperlinks.ts";
import { mouseReporting } from "./mouse.ts";
import { rendererEnv } from "./terminal-env.ts";
import type { MousePolicy } from "./options.ts";

export const RENDERER_OPTIONS: Readonly<CliRendererConfig> = {
  screenMode: "alternate-screen",
  externalOutputMode: "passthrough",
  useMouse: true,
  enableMouseMovement: false,
  autoFocus: false,
  exitOnCtrlC: false,
  consoleMode: "disabled",
  targetFps: 30,
  maxFps: 60,
  exitSignals: [],
};

export interface ScreenRendererOptions {
  /** The chosen mouse policy (`--mouse`); default `full`. */
  mouse?: MousePolicy;
  /** Whether OpenTUI writes OSC 8 (the capability table's `osc8`, hyperlinks.ts); default false. */
  osc8?: boolean;
  /** Test and embedding overrides (streams); never the options above. */
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
}

/** What acp-tui uses of the `NativeSession` it constructs: writing (write-out.ts) and, after a
 *  failed teardown, restoring and disposing it (lifecycle.ts). */
export type RendererSession = Pick<NativeSession, "write" | "restoreOnExit" | "dispose" | "disposed">;

const sessions = new WeakMap<CliRenderer, RendererSession>();

/** The `NativeSession` acp-tui constructed for `renderer` (createScreenRenderer), if any. */
export function rendererSession(renderer: CliRenderer): RendererSession | undefined {
  return sessions.get(renderer);
}

/** Records `session` as `renderer`'s (createScreenRenderer; tests use stand-ins). */
export function setRendererSession(renderer: CliRenderer, session: RendererSession): void {
  sessions.set(renderer, session);
}

/** What OpenTUI's native start-up sees ahead of the process environment (design D4). */
export function rendererEnvironment(env: Readonly<Record<string, string | undefined>>, osc8: boolean): Record<string, string> {
  return { ...rendererEnv(env), ...hyperlinkEnv(osc8) };
}

/** D2's configuration for a mouse policy. */
export function rendererConfig(options: Pick<ScreenRendererOptions, "mouse"> = {}): CliRendererConfig {
  const mouse = options.mouse ?? "full";
  return {
    ...RENDERER_OPTIONS,
    useMouse: mouseReporting(mouse),
    // F2 back from `off` re-enables the same modes (OpenTUI's `enableMouse` reads this).
    enableMouseMovement: mouse === "full",
  };
}

export async function createScreenRenderer(options: ScreenRendererOptions = {}): Promise<CliRenderer> {
  const config = rendererConfig(options);
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const width = stdout.columns || 80;
  const height = stdout.rows || 24;
  const session = new NativeSession(stdout);
  let renderer: CliRenderer;
  try {
    renderer = new CliRenderer(stdin, stdout, width, height, {
      ...config,
      nativeSession: session,
      environment: rendererEnvironment(process.env, options.osc8 ?? false),
    });
  } catch (error) {
    if (!session.disposed) session.dispose();
    throw error;
  }
  setRendererSession(renderer, session);
  try {
    await renderer.setupTerminal();
  } catch (error) {
    try {
      renderer.destroy();
    } catch {
      // The set-up error is the one to report.
    }
    throw error;
  }
  return renderer;
}
