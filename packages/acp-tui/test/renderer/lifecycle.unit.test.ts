// Lifecycle ordering and idempotence without a terminal (task 6.1), and the
// resets, exit text, uncaught errors and SIGUSR2 of phase-1a task 4.1 and 4.3
// (design D3).
import { describe, expect, test } from "bun:test";
import type { CliRenderer } from "@opentui/core";
import { setRendererSession, type RendererSession } from "../../src/renderer/create.ts";
import {
  createLifecycle,
  exitCodeFor,
  FALLBACK_RESET,
  FINAL_RESET,
  type LifecycleOptions,
} from "../../src/renderer/lifecycle.ts";

type DestroyMode = "ok" | "throws" | "deferred" | "never" | "rejects";

/** A stand-in renderer, as OpenTUI 0.6's: `destroy()` marks it destroyed and its `closed` settles
 *  once the native session has written the restoration (at once, later as at the end of a frame,
 *  never, or rejected as when the output failed), or `destroy()` throws. */
function fakeRenderer(events: string[], mode: DestroyMode) {
  let destroyed = false;
  let settle!: (ok: boolean) => void;
  const closed = new Promise<void>((resolve, reject) => (settle = (ok) => (ok ? resolve() : reject(new Error("closed failed")))));
  closed.catch(() => {});
  const renderer = {
    get isDestroyed() {
      return destroyed;
    },
    closed,
    destroy() {
      events.push("destroy");
      if (mode === "throws") throw new Error("boom");
      destroyed = true;
      if (mode === "ok") queueMicrotask(() => settle(true));
      if (mode === "rejects") queueMicrotask(() => settle(false));
      if (mode === "deferred") {
        setTimeout(() => {
          events.push("destroy finished");
          settle(true);
        }, 20);
      }
    },
  };
  return renderer as unknown as CliRenderer;
}

/** A stand-in for the `NativeSession` create.ts constructs: whether its exit restoration works. */
function fakeSession(events: string[], restores: boolean): RendererSession {
  const session = {
    disposed: false,
    write: () => true,
    restoreOnExit() {
      events.push("restoreOnExit");
      return restores;
    },
    dispose() {
      events.push("dispose");
      session.disposed = true;
    },
  };
  return session;
}

function setup(options: LifecycleOptions = {}, mode: DestroyMode | boolean = "ok") {
  const events: string[] = [];
  const renderer = fakeRenderer(events, mode === true ? "throws" : mode === false ? "ok" : mode);
  const lifecycle = createLifecycle({
    signals: [],
    handleErrors: false,
    destroyTimeoutMs: 100,
    write: (data) => events.push(`write ${JSON.stringify(data)}`),
    writeError: (text) => events.push(`stderr ${text.trim()}`),
    exit: (code) => events.push(`exit ${code}`),
    ...options,
  });
  lifecycle.attach(renderer);
  return { lifecycle, events };
}

/** The listener `install` added to `event`. */
function addedListener(event: string, install: () => void): (...args: unknown[]) => void {
  const before = new Set(process.listeners(event as "SIGUSR2"));
  install();
  const added = process.listeners(event as "SIGUSR2").find((l) => !before.has(l));
  if (!added) throw new Error(`no listener added for ${event}`);
  return added as (...args: unknown[]) => void;
}

describe("lifecycle", () => {
  test("exit hook runs before destroy, then the final reset, then exit", async () => {
    const { lifecycle, events } = setup({ onExit: async () => void events.push("detach") });
    await lifecycle.shutdown();
    expect(events).toEqual(["detach", "destroy", `write ${JSON.stringify(FINAL_RESET)}`, "exit 0"]);
  });

  test("finalReset (title pop, mode 1007) is written just before the reset, so before the exit text, after a successful destroy or not", async () => {
    for (const [mode, reset] of [["ok", FINAL_RESET], ["throws", FALLBACK_RESET]] as const) {
      const { lifecycle, events } = setup({ finalReset: () => "<extra>", exitText: () => "exit text" }, mode);
      await lifecycle.shutdown();
      expect(events).toEqual(["destroy", `write ${JSON.stringify(`<extra>${reset}`)}`, `write ${JSON.stringify("exit text")}`, "exit 0"]);
    }
  });

  test("a finalReset that throws adds nothing and does not stop the reset", async () => {
    const { lifecycle, events } = setup({
      finalReset: () => {
        throw new Error("boom");
      },
    });
    await lifecycle.shutdown();
    expect(events).toEqual(["destroy", `write ${JSON.stringify(FINAL_RESET)}`, "exit 0"]);
  });

  test("shutdown is idempotent", async () => {
    const { lifecycle, events } = setup({ onExit: () => void events.push("detach") });
    const a = lifecycle.shutdown({ kind: "signal", signal: "SIGTERM" });
    const b = lifecycle.shutdown({ kind: "user" });
    expect(b).toBe(a);
    await Promise.all([a, b]);
    expect(events.filter((e) => e === "detach" || e === "destroy" || e.startsWith("exit"))).toEqual(["detach", "destroy", "exit 143"]);
    expect(lifecycle.shuttingDown).toBe(true);
  });

  test("a failing or hanging hook does not stop the terminal being restored", async () => {
    const { lifecycle, events } = setup({ exitHookTimeoutMs: 20 });
    lifecycle.addExitHook(() => {
      throw new Error("detach failed");
    });
    lifecycle.addExitHook(() => new Promise<void>(() => {}));
    lifecycle.addExitHook(() => void events.push("last hook"));
    await lifecycle.shutdown();
    expect(events).toEqual(["last hook", "destroy", `write ${JSON.stringify(FINAL_RESET)}`, "exit 0"]);
  });

  test("a start-up error is reported after the terminal is restored", async () => {
    const { lifecycle, events } = setup();
    await lifecycle.shutdown({ kind: "error", error: new Error("agent not found: nope") });
    expect(events).toEqual(["destroy", `write ${JSON.stringify(FINAL_RESET)}`, "stderr acp-tui: agent not found: nope", "exit 1"]);
  });

  test("if destroy throws, the fallback reset is written", async () => {
    const { lifecycle, events } = setup({}, true);
    await lifecycle.shutdown();
    expect(events).toEqual(["destroy", `write ${JSON.stringify(FALLBACK_RESET)}`, "exit 0"]);
  });

  test("a teardown that finishes later (the end of a frame, the native close) is waited for before the reset", async () => {
    const { lifecycle, events } = setup({}, "deferred");
    await lifecycle.shutdown();
    expect(events).toEqual(["destroy", "destroy finished", `write ${JSON.stringify(FINAL_RESET)}`, "exit 0"]);
  });

  test("a destroy that never finishes gets the fallback reset after the timeout", async () => {
    const { lifecycle, events } = setup({}, "never");
    await lifecycle.shutdown();
    expect(events).toEqual(["destroy", `write ${JSON.stringify(FALLBACK_RESET)}`, "exit 0"]);
  });

  test("a rejected closed (the output failed) gets the fallback reset", async () => {
    const { lifecycle, events } = setup({}, "rejects");
    await lifecycle.shutdown();
    expect(events).toEqual(["destroy", `write ${JSON.stringify(FALLBACK_RESET)}`, "exit 0"]);
  });

  // opentui-0-6 design D3: after a failed teardown the session acp-tui constructed is restored and
  // disposed before acp-tui writes, so OpenTUI's exit handler (which restores an undisposed
  // session at process exit) writes no second `CSI ? 1049 l`.
  for (const mode of ["throws", "rejects", "never"] as const) {
    test(`a failed teardown (${mode}) with acp-tui's session: restored, disposed, then the final reset; not restored: the fallback reset`, async () => {
      for (const [restores, reset] of [[true, FINAL_RESET], [false, FALLBACK_RESET]] as const) {
        const { lifecycle, events } = setup({}, mode);
        setRendererSession(lifecycle.renderer!, fakeSession(events, restores));
        await lifecycle.shutdown();
        expect(events).toEqual(["destroy", "restoreOnExit", "dispose", `write ${JSON.stringify(reset)}`, "exit 0"]);
      }
    });
  }

  test("a successful teardown leaves the session to OpenTUI", async () => {
    const { lifecycle, events } = setup({}, "ok");
    setRendererSession(lifecycle.renderer!, fakeSession(events, true));
    await lifecycle.shutdown();
    expect(events).toEqual(["destroy", `write ${JSON.stringify(FINAL_RESET)}`, "exit 0"]);
  });

  test("a session OpenTUI already disposed (a rejected close) is not touched: the fallback reset", async () => {
    const { lifecycle, events } = setup({}, "rejects");
    const session = fakeSession(events, true);
    (session as { disposed: boolean }).disposed = true;
    setRendererSession(lifecycle.renderer!, session);
    await lifecycle.shutdown();
    expect(events).toEqual(["destroy", `write ${JSON.stringify(FALLBACK_RESET)}`, "exit 0"]);
  });

  test("an already destroyed renderer gets the final reset", async () => {
    const { lifecycle, events } = setup();
    lifecycle.renderer!.destroy();
    await lifecycle.shutdown();
    expect(events).toEqual(["destroy", `write ${JSON.stringify(FINAL_RESET)}`, "exit 0"]);
  });

  test("the exit text follows the reset and precedes an error message (task 4.3)", async () => {
    const { lifecycle, events } = setup({ exitText: (reason) => `\rsummary for ${reason.kind}\n` });
    await lifecycle.shutdown({ kind: "error", error: new Error("bad") });
    expect(events).toEqual([
      "destroy",
      `write ${JSON.stringify(FINAL_RESET)}`,
      `write ${JSON.stringify("\rsummary for error\n")}`,
      "stderr acp-tui: bad",
      "exit 1",
    ]);
  });

  test("an empty exit text writes nothing", async () => {
    const { lifecycle, events } = setup({ exitText: () => "" });
    await lifecycle.shutdown();
    expect(events).toEqual(["destroy", `write ${JSON.stringify(FINAL_RESET)}`, "exit 0"]);
  });

  test("the final reset: mouse modes off, DEC 2031 off, scroll region, attributes, cursor shape and visibility (design D3; day-two-feedback D7)", () => {
    expect(FINAL_RESET).toBe("\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?2031l\x1b7\x1b[r\x1b8\x1b[0m\x1b[0 q\x1b[?25h");
    // Never leaves the alternate screen: destroy() has already done it once.
    expect(FINAL_RESET).not.toContain("\x1b[?1049l");
  });

  test("the fallback reset: leave the alternate screen once, then the Phase 0 fallback and the final reset", () => {
    expect(FALLBACK_RESET).toBe(`\x1b[?1049l\x1b[<u\x1b[>4;0m\x1b[?2004l\x1b[?1004l${FINAL_RESET}`);
    expect(FALLBACK_RESET.split("\x1b[?1049l")).toHaveLength(2);
  });

  test("the reset never clears the screen and keeps the cursor in place", () => {
    for (const reset of [FINAL_RESET, FALLBACK_RESET]) {
      expect(reset).not.toMatch(/\x1b\[[23]?J/);
      expect(reset).toContain("\x1b7\x1b[r\x1b8");
      expect(reset.endsWith("\x1b[?25h")).toBe(true);
    }
  });

  test("exit codes", () => {
    expect(exitCodeFor({ kind: "user" })).toBe(0);
    expect(exitCodeFor({ kind: "error", error: null })).toBe(1);
    expect(exitCodeFor({ kind: "signal", signal: "SIGHUP" })).toBe(129);
    expect(exitCodeFor({ kind: "signal", signal: "SIGTERM" })).toBe(143);
  });

  test("signal handlers are installed once and removed on shutdown", async () => {
    const before = process.listenerCount("SIGUSR1");
    const { lifecycle } = setup({ signals: ["SIGUSR1"] });
    lifecycle.installSignalHandlers();
    lifecycle.installSignalHandlers();
    expect(process.listenerCount("SIGUSR1")).toBe(before + 1);
    await lifecycle.shutdown();
    expect(process.listenerCount("SIGUSR1")).toBe(before);
  });

  test("SIGUSR2 runs the theme listeners and never exits, even when one throws", async () => {
    const { lifecycle, events } = setup();
    lifecycle.onThemeSignal(() => events.push("theme 1"));
    lifecycle.onThemeSignal(() => {
      throw new Error("listener failed");
    });
    const remove = lifecycle.onThemeSignal(() => events.push("theme 3"));
    const handler = addedListener("SIGUSR2", () => lifecycle.installSignalHandlers());
    handler();
    remove();
    handler();
    expect(events).toEqual(["theme 1", "theme 3", "theme 1"]);
    expect(lifecycle.shuttingDown).toBe(false);
    await lifecycle.shutdown();
    expect(process.listeners("SIGUSR2")).not.toContain(handler as never);
  });

  for (const event of ["uncaughtException", "unhandledRejection"] as const) {
    test(`${event} shuts down with kind error: restored, message on stderr, exit 1, handlers removed`, async () => {
      const { lifecycle, events } = setup({ handleErrors: true, onExit: (reason) => void events.push(`hook ${reason.kind}`) });
      const handler = addedListener(event, () => lifecycle.installSignalHandlers());
      handler(new Error("thrown by nobody"));
      await lifecycle.shutdown();
      expect(events).toEqual([
        "hook error",
        "destroy",
        `write ${JSON.stringify(FINAL_RESET)}`,
        "stderr acp-tui: uncaught error: thrown by nobody",
        "exit 1",
      ]);
      expect(process.listeners(event)).not.toContain(handler as never);
    });
  }
});
