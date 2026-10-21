// Renderer lifecycle (task 6.1, spec tui-agent-session "Exit is detach";
// phase-1a task 4.1, design D3, spec tui-screen "Terminal restored on every
// exit path"). One idempotent shutdown path for every exit: user exit, SIGHUP,
// SIGTERM (and SIGINT, SIGQUIT sent from outside, since raw mode means Ctrl+C
// never raises SIGINT), start-up failure, and an uncaught exception or
// unhandled rejection. Order: exit hooks (the session controller's detach),
// then `renderer.destroy()`, then a final terminal reset, then the exit text,
// then the error message (if any), then exit.
//
// What the teardown writes on the alternate screen (OpenTUI 0.6.1; measured
// under the PTY harness, see test/pty/screen-probe.test.ts and
// test/renderer/exit.pty.test.ts): it leaves the alternate screen
// (`CSI ? 1049 l`, exactly once), resets DEC 2031, shows the cursor, pops kitty
// keyboard flags if they were pushed (or resets modifyOtherKeys), and turns off
// bracketed paste and focus reporting; mouse reporting only when it owns
// `process.stdin` and `process.stdout`. It leaves DEC 2027 (grapheme clusters)
// set; see the note on FINAL_RESET.
//
// `CSI ? 1049 l` is written only once. In xterm and xterm.js it restores the
// saved cursor even when the normal buffer is already active, so a second one
// could move the cursor back over earlier rows and the exit text would
// overwrite them. The final reset after a successful teardown therefore never
// contains it; the fallback reset, for when the teardown failed, starts with it.
//
// OpenTUI 0.6 (opentui-0-6 design D3): `destroy()` marks the renderer
// destroyed at once and emits `destroy` synchronously (or at the end of a
// frame in progress), but the restoration is written later, when the native
// session closes; `renderer.closed` resolves once it has been written. So the
// shutdown awaits `closed` (bounded) before it writes anything, or the reset and
// the exit text would land on the alternate screen and be lost. `closed`
// rejects when the output failed or did not finish within OpenTUI's own second;
// `destroy()` can also throw (from inside a paint hook the layout host is not
// mutable). On any of these, or when the bound expires, the native session that
// create.ts constructed is restored and disposed here, before acp-tui writes:
// `restoreOnExit()` writes the restoration synchronously if it still can, and
// `dispose()` stops OpenTUI's own `process.on("exit")` handler from restoring
// the terminal a second time at exit (which wrote a second `CSI ? 1049 l` after
// the fallback reset). Then the final reset follows if the restoration was
// written, else the fallback reset.
import { constants } from "node:os";
import type { CliRenderer } from "@opentui/core";
import { createScreenRenderer, rendererSession, type ScreenRendererOptions } from "./create.ts";

export type ExitReason =
  | { kind: "user" }
  | { kind: "signal"; signal: NodeJS.Signals }
  /** `uncaught`: an uncaught exception or unhandled rejection rather than a start-up failure. */
  | { kind: "error"; error: unknown; uncaught?: boolean };

export type ExitHook = (reason: ExitReason) => void | Promise<void>;

/** Mouse reporting modes 1000, 1002, 1003 and 1006 off. */
export const MOUSE_MODES_OFF = "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l";
/** Colour-scheme (theme change) reporting off. */
export const THEME_REPORTS_OFF = "\x1b[?2031l";
/** Scroll region reset that leaves the cursor where it is (DECSTBM homes the cursor). */
export const SCROLL_REGION_RESET = "\x1b7\x1b[r\x1b8";
/** The terminal's default cursor shape (DECSCUSR 0): the prompt box sets its own (day-two-feedback
 *  design D7), and the shell's prompt gets the terminal's back on every exit path. */
export const CURSOR_SHAPE_RESET = "\x1b[0 q";
/**
 * Written after every successful teardown, whatever it wrote (design D3):
 * mouse modes off (`destroy()` turns them off only when it owns the process
 * streams), DEC 2031 off, scroll region, attributes, cursor shape, cursor shown. Never
 * `CSI ? 1049 l` (see above), never `CSI 2 J` or `CSI 3 J`.
 *
 * DEC 2027 (grapheme cluster mode), which OpenTUI sets at start-up, is left
 * alone: it has no effect in the harness or the priority terminals (none of
 * them implements it), and in Ghostty it is on by default, so resetting it
 * blindly would change the terminal rather than restore it.
 */
export const FINAL_RESET = `${MOUSE_MODES_OFF}${THEME_REPORTS_OFF}${SCROLL_REGION_RESET}\x1b[0m${CURSOR_SHAPE_RESET}\x1b[?25h`;
/** Leaves the alternate screen; written only by the fallback reset. */
export const LEAVE_ALTERNATE_SCREEN = "\x1b[?1049l";
/**
 * Written instead when the teardown failed (`destroy()` threw, `closed`
 * rejected or did not settle in time, and the native session could not
 * restore the terminal), so the modes it would have reset may still be set: leave the alternate screen, pop kitty
 * keyboard flags, reset modifyOtherKeys, bracketed paste and focus reporting
 * off, then the final reset.
 */
export const FALLBACK_RESET = `${LEAVE_ALTERNATE_SCREEN}\x1b[<u\x1b[>4;0m\x1b[?2004l\x1b[?1004l${FINAL_RESET}`;

export const DEFAULT_EXIT_SIGNALS: readonly NodeJS.Signals[] = ["SIGHUP", "SIGTERM", "SIGINT", "SIGQUIT"];
/**
 * On Windows (design D8): SIGQUIT does not exist there, and SIGBREAK (Ctrl+Break) does. Closing the
 * window delivers SIGHUP.
 */
export const WINDOWS_EXIT_SIGNALS: readonly NodeJS.Signals[] = ["SIGHUP", "SIGTERM", "SIGINT", "SIGBREAK"];
/** Bound on waiting for the exit hooks. It must outlast the session controller's 2 s detach grace
 *  and the `taskkill` that follows it on Windows, or a harness that ignores the end of its stdin is
 *  left running; on Windows, which ends a console process about five seconds after its window
 *  closes, 3 s for the hooks and 1 s for the renderer's destroy still fit. */
export const EXIT_HOOK_TIMEOUT_MS = 3000;
export const WINDOWS_EXIT_HOOK_TIMEOUT_MS = 3000;

/** The signals that end acp-tui on `platform`. */
export function exitSignalsFor(platform: NodeJS.Platform = process.platform): readonly NodeJS.Signals[] {
  return platform === "win32" ? WINDOWS_EXIT_SIGNALS : DEFAULT_EXIT_SIGNALS;
}

/** The default bound on the exit hooks on `platform`. */
export function exitHookTimeoutFor(platform: NodeJS.Platform = process.platform): number {
  return platform === "win32" ? WINDOWS_EXIT_HOOK_TIMEOUT_MS : EXIT_HOOK_TIMEOUT_MS;
}
/** Handled without exiting (design D3): the theme re-derivation signal. */
export const THEME_SIGNAL: NodeJS.Signals = "SIGUSR2";

export interface LifecycleOptions {
  /** Runs before the renderer is destroyed, for example the session controller's `detach()`. */
  onExit?: ExitHook;
  /** Bound on waiting for exit hooks; default 3000 ms on every platform. */
  exitHookTimeoutMs?: number;
  /** Bound on waiting for the renderer's `closed` after `destroy()`; default 1000 ms. */
  destroyTimeoutMs?: number;
  /** Default `process.exit`. */
  exit?: (code: number) => void;
  /** Default: SIGHUP, SIGTERM, SIGINT, SIGQUIT (SIGBREAK instead of SIGQUIT on Windows). */
  signals?: readonly NodeJS.Signals[];
  /** The platform the signal list and the hook bound follow; default `process.platform`. */
  platform?: NodeJS.Platform;
  /** Route `uncaughtException` and `unhandledRejection` into `shutdown`; default true. */
  handleErrors?: boolean;
  /**
   * Extra restoring output, written just before the final (or fallback) reset on every exit path
   * and so before the exit text, which still follows the reset directly: the title stack pop and
   * mode 1007 put back (renderer/terminal-signals.ts). Called once, after `destroy()`; a throw
   * adds nothing.
   */
  finalReset?: () => string;
  /** Terminal output after destroy; default `process.stdout.write`. */
  write?: (data: string) => void;
  /** Error report, after the terminal is restored; default `process.stderr.write`. */
  writeError?: (text: string) => void;
  /**
   * The exit text (exit-text.ts), written after the final reset and before
   * any error message; called once the exit hooks have run. Empty for none.
   */
  exitText?: (reason: ExitReason) => string;
  /** Writes a crash report for an uncaught error and returns its path, or null when it cannot be
   *  written (the stack is then printed instead). */
  crashReport?: (error: unknown) => string | null;
}

export interface Lifecycle {
  /** The renderer to destroy on shutdown. */
  attach(renderer: CliRenderer): void;
  readonly renderer: CliRenderer | null;
  /** Adds an exit hook (run in order, after `onExit`); returns a remover. */
  addExitHook(hook: ExitHook): () => void;
  /**
   * Adds a listener for SIGUSR2, never delivered on Windows (design D3: theme re-derivation, task 5.3).
   * The signal never exits, with or without listeners; returns a remover.
   */
  onThemeSignal(listener: () => void): () => void;
  /** The exit signals, SIGUSR2, and (unless `handleErrors` is false) the uncaught-error events. */
  installSignalHandlers(): void;
  removeSignalHandlers(): void;
  /**
   * Restores the terminal and exits. Idempotent: later calls return the first
   * call's promise. Default codes: 0 for `user`, 128 + signal number for
   * `signal`, 1 for `error`.
   */
  shutdown(reason?: ExitReason, code?: number): Promise<void>;
  readonly shuttingDown: boolean;
}

export function exitCodeFor(reason: ExitReason): number {
  if (reason.kind === "user") return 0;
  if (reason.kind === "error") return 1;
  return 128 + (constants.signals[reason.signal] ?? 0);
}

function errorText(reason: Extract<ExitReason, { kind: "error" }>): string {
  const message = reason.error instanceof Error ? reason.error.message : String(reason.error);
  return reason.uncaught ? `uncaught error: ${message}` : message;
}

/**
 * Destroys the renderer and resolves true once its restoration has been written (`closed`
 * resolved, or the native session restored after a failure), or false if it was not (the caller
 * then writes the fallback reset). Never leaves the native session undisposed after a failure, so
 * OpenTUI's exit handler writes nothing more.
 */
async function destroyRenderer(renderer: CliRenderer, timeoutMs: number): Promise<boolean> {
  let closed = false;
  try {
    if (!renderer.isDestroyed) renderer.destroy();
    let timer: ReturnType<typeof setTimeout> | undefined;
    closed = await Promise.race([
      renderer.closed.then(
        () => true,
        () => false,
      ),
      new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(false), timeoutMs))),
    ]);
    clearTimeout(timer);
  } catch {
    closed = false;
  }
  if (closed) return true;
  const session = rendererSession(renderer);
  if (!session || session.disposed) return false;
  let restored = false;
  try {
    restored = session.restoreOnExit();
  } catch {
    restored = false;
  }
  try {
    session.dispose();
  } catch {
    // Disposal failing leaves OpenTUI's exit handler armed; nothing more can be done here.
  }
  return restored;
}

export function createLifecycle(options: LifecycleOptions = {}): Lifecycle {
  const hooks: ExitHook[] = options.onExit ? [options.onExit] : [];
  const themeListeners = new Set<() => void>();
  const platform = options.platform ?? process.platform;
  const signals = options.signals ?? exitSignalsFor(platform);
  const handleErrors = options.handleErrors ?? true;
  const write = options.write ?? ((data: string) => void process.stdout.write(data));
  const writeError = options.writeError ?? ((text: string) => void process.stderr.write(text));
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const timeoutMs = options.exitHookTimeoutMs ?? exitHookTimeoutFor(platform);
  const destroyTimeoutMs = options.destroyTimeoutMs ?? 1000;

  let renderer: CliRenderer | null = null;
  let pending: Promise<void> | null = null;
  const handlers = new Map<NodeJS.Signals, () => void>();
  let errorHandler: ((error: unknown) => void) | null = null;

  async function runHooks(reason: ExitReason): Promise<void> {
    for (const hook of hooks) {
      try {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          Promise.resolve().then(() => hook(reason)),
          new Promise<void>((resolve) => (timer = setTimeout(resolve, timeoutMs))),
        ]);
        clearTimeout(timer);
      } catch {
        // An exit hook failing must not stop the terminal being restored.
      }
    }
  }

  async function restoreTerminal(): Promise<void> {
    if (!renderer) return;
    const destroyed = await destroyRenderer(renderer, destroyTimeoutMs);
    let extra = "";
    try {
      extra = options.finalReset?.() ?? "";
    } catch {
      // A failing extra must not stop the reset itself.
    }
    try {
      write(extra + (destroyed ? FINAL_RESET : FALLBACK_RESET));
    } catch {
      // The terminal may be gone (SIGHUP).
    }
  }

  function themeSignal(): void {
    for (const listener of themeListeners) {
      try {
        listener();
      } catch {
        // A failing listener must not turn SIGUSR2 into an exit.
      }
    }
  }

  const lifecycle: Lifecycle = {
    attach(r) {
      renderer = r;
    },
    get renderer() {
      return renderer;
    },
    addExitHook(hook) {
      hooks.push(hook);
      return () => {
        const i = hooks.indexOf(hook);
        if (i >= 0) hooks.splice(i, 1);
      };
    },
    onThemeSignal(listener) {
      themeListeners.add(listener);
      return () => void themeListeners.delete(listener);
    },
    installSignalHandlers() {
      for (const signal of signals) {
        if (handlers.has(signal)) continue;
        const handler = () => void lifecycle.shutdown({ kind: "signal", signal });
        handlers.set(signal, handler);
        process.on(signal, handler);
      }
      // SIGUSR2 does not exist on Windows (Ctrl+L re-derives the theme there).
      if (platform !== "win32" && !handlers.has(THEME_SIGNAL) && !signals.includes(THEME_SIGNAL)) {
        handlers.set(THEME_SIGNAL, themeSignal);
        process.on(THEME_SIGNAL, themeSignal);
      }
      if (handleErrors && !errorHandler) {
        errorHandler = (error) => void lifecycle.shutdown({ kind: "error", error, uncaught: true });
        process.on("uncaughtException", errorHandler);
        process.on("unhandledRejection", errorHandler);
      }
    },
    removeSignalHandlers() {
      for (const [signal, handler] of handlers) process.off(signal, handler);
      handlers.clear();
      if (errorHandler) {
        process.off("uncaughtException", errorHandler);
        process.off("unhandledRejection", errorHandler);
        errorHandler = null;
      }
    },
    shutdown(reason = { kind: "user" }, code) {
      if (pending) return pending;
      pending = (async () => {
        await runHooks(reason);
        await restoreTerminal();
        try {
          const text = options.exitText?.(reason) ?? "";
          if (text !== "") write(text);
        } catch {
          // Neither a failing exit text nor a closed terminal may stop the exit.
        }
        if (reason.kind === "error") {
          try {
            writeError(`\racp-tui: ${errorText(reason)}\n`);
            if (reason.uncaught && options.crashReport) {
              const path = options.crashReport(reason.error);
              if (path !== null) writeError(`crash report: ${path} (attach it when you report this)\n`);
              else writeError(`${reason.error instanceof Error && reason.error.stack ? reason.error.stack : String(reason.error)}\n`);
            }
          } catch {
            // stderr may be gone too.
          }
        }
        lifecycle.removeSignalHandlers();
        exit(code ?? exitCodeFor(reason));
      })();
      return pending;
    },
    get shuttingDown() {
      return pending !== null;
    },
  };
  return lifecycle;
}

export interface RunOptions extends LifecycleOptions {
  renderer?: ScreenRendererOptions;
  /** Mounts the app. A throw (or rejection) shuts down with the error, terminal restored. */
  start(renderer: CliRenderer, lifecycle: Lifecycle): void | Promise<void>;
}

/**
 * Installs the signal and error handlers, creates the renderer, attaches it
 * and runs `start`. Start-up failures after the renderer exists still restore
 * the terminal; failures before it (for example no TTY) just run the exit
 * hooks.
 */
export async function runWithRenderer(options: RunOptions): Promise<Lifecycle> {
  const lifecycle = createLifecycle(options);
  lifecycle.installSignalHandlers();
  try {
    const renderer = await createScreenRenderer(options.renderer);
    lifecycle.attach(renderer);
    await options.start(renderer, lifecycle);
  } catch (error) {
    await lifecycle.shutdown({ kind: "error", error });
  }
  return lifecycle;
}
