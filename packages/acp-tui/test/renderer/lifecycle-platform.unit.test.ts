// The signal list and the exit hooks' bound per platform (windows-support design D8, spec tui-screen
// "Signals on Windows"): the platform is injected, so the Windows behaviour runs on any host.
import { describe, expect, test } from "bun:test";
import type { CliRenderer } from "@opentui/core";
import {
  createLifecycle,
  DEFAULT_EXIT_SIGNALS,
  EXIT_HOOK_TIMEOUT_MS,
  exitHookTimeoutFor,
  exitSignalsFor,
  FINAL_RESET,
  WINDOWS_EXIT_HOOK_TIMEOUT_MS,
  WINDOWS_EXIT_SIGNALS,
} from "../../src/renderer/lifecycle.ts";

function setup(platform: NodeJS.Platform, extra: { onExit?: (reason: { kind: string; signal?: string }) => void; exitHookTimeoutMs?: number } = {}) {
  const events: string[] = [];
  let closed!: () => void;
  const renderer = {
    isDestroyed: false,
    closed: new Promise<void>((resolve) => (closed = resolve)),
    destroy() {
      events.push("destroy");
      queueMicrotask(closed);
    },
  } as unknown as CliRenderer;
  const lifecycle = createLifecycle({
    platform,
    handleErrors: false,
    write: (data) => events.push(`write ${JSON.stringify(data)}`),
    writeError: () => {},
    exit: (code) => events.push(`exit ${code}`),
    ...(extra.onExit ? { onExit: (reason) => extra.onExit?.(reason as { kind: string; signal?: string }) } : {}),
    ...(extra.exitHookTimeoutMs ? { exitHookTimeoutMs: extra.exitHookTimeoutMs } : {}),
  });
  lifecycle.attach(renderer);
  return { lifecycle, events };
}

/** The listeners added to `event` by `install`. */
function added(event: string, install: () => void): ((...args: unknown[]) => void)[] {
  const before = new Set(process.listeners(event as "SIGUSR2"));
  install();
  return process.listeners(event as "SIGUSR2").filter((l) => !before.has(l)) as ((...args: unknown[]) => void)[];
}

describe("exit signals per platform", () => {
  test("Windows: SIGINT, SIGTERM, SIGHUP and SIGBREAK, with no SIGQUIT", () => {
    expect([...exitSignalsFor("win32")].sort()).toEqual(["SIGBREAK", "SIGHUP", "SIGINT", "SIGTERM"]);
    expect(WINDOWS_EXIT_SIGNALS).not.toContain("SIGQUIT");
    expect(WINDOWS_EXIT_SIGNALS).not.toContain("SIGUSR2");
  });

  test("elsewhere the list is as it was, with no SIGBREAK", () => {
    for (const platform of ["linux", "darwin"] as const) {
      expect(exitSignalsFor(platform)).toEqual(DEFAULT_EXIT_SIGNALS);
      expect(exitSignalsFor(platform)).toContain("SIGQUIT");
      expect(exitSignalsFor(platform)).not.toContain("SIGBREAK");
    }
    expect([...DEFAULT_EXIT_SIGNALS]).toEqual(["SIGHUP", "SIGTERM", "SIGINT", "SIGQUIT"]);
  });

  test("the hooks' bound is 1.5 s on Windows and 3 s elsewhere", () => {
    expect(exitHookTimeoutFor("win32")).toBe(1500);
    expect(exitHookTimeoutFor("linux")).toBe(3000);
    expect(exitHookTimeoutFor("darwin")).toBe(3000);
    expect(WINDOWS_EXIT_HOOK_TIMEOUT_MS).toBeLessThan(EXIT_HOOK_TIMEOUT_MS);
  });
});

describe("handlers installed per platform", () => {
  test("Windows registers SIGBREAK and not SIGQUIT or SIGUSR2", async () => {
    const { lifecycle } = setup("win32");
    const counts = (): Record<string, number> => Object.fromEntries(["SIGBREAK", "SIGHUP", "SIGINT", "SIGQUIT", "SIGTERM", "SIGUSR2"].map((s) => [s, process.listenerCount(s)]));
    const before = counts();
    lifecycle.installSignalHandlers();
    const after = counts();
    expect(after.SIGBREAK).toBe(before.SIGBREAK! + 1);
    for (const s of ["SIGHUP", "SIGINT", "SIGTERM"]) expect(after[s]).toBe(before[s]! + 1);
    expect(after.SIGQUIT).toBe(before.SIGQUIT!);
    expect(after.SIGUSR2).toBe(before.SIGUSR2!);
    await lifecycle.shutdown();
    expect(counts()).toEqual(before);
  });

  test("Linux and macOS register SIGQUIT and SIGUSR2 and not SIGBREAK", async () => {
    for (const platform of ["linux", "darwin"] as const) {
      const { lifecycle } = setup(platform);
      const before = { quit: process.listenerCount("SIGQUIT"), usr2: process.listenerCount("SIGUSR2"), brk: process.listenerCount("SIGBREAK") };
      lifecycle.installSignalHandlers();
      expect(process.listenerCount("SIGQUIT")).toBe(before.quit + 1);
      expect(process.listenerCount("SIGUSR2")).toBe(before.usr2 + 1);
      expect(process.listenerCount("SIGBREAK")).toBe(before.brk);
      await lifecycle.shutdown();
    }
  });

  test("SIGBREAK detaches, restores the terminal and exits as SIGTERM does", async () => {
    const reasons: string[] = [];
    const run = async (signal: "SIGBREAK" | "SIGTERM"): Promise<string[]> => {
      const { lifecycle, events } = setup("win32", { onExit: (reason) => void reasons.push(`${reason.kind} ${reason.signal}`) });
      const [handler] = added(signal, () => lifecycle.installSignalHandlers());
      handler!();
      await lifecycle.shutdown();
      return events;
    };
    const brk = await run("SIGBREAK");
    const term = await run("SIGTERM");
    expect(reasons).toEqual(["signal SIGBREAK", "signal SIGTERM"]);
    expect(brk.slice(0, 2)).toEqual(["destroy", `write ${JSON.stringify(FINAL_RESET)}`]);
    // The same steps in the same order; only the exit code differs (128 + the signal's number,
    // which this host may not know for SIGBREAK).
    expect(brk.slice(0, -1)).toEqual(term.slice(0, -1));
    expect(brk.at(-1)).toMatch(/^exit \d+$/);
  });

  test("on Windows a hook that never settles is abandoned after 1.5 s, and the terminal is still restored", async () => {
    const { lifecycle, events } = setup("win32");
    lifecycle.addExitHook(() => new Promise<void>(() => {}));
    await lifecycle.shutdown();
    expect(events).toEqual(["destroy", `write ${JSON.stringify(FINAL_RESET)}`, "exit 0"]);
  });
});
