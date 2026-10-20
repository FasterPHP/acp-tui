// Ending a harness's whole process tree (windows-support D5; spec tui-agent-session "Harness
// process tree ended on Windows"). On Linux and macOS the harness is the process acp-tui started,
// and `kill()` ends it. On Windows a harness that is a `.cmd` or `.bat` script (npm's shim for
// Auggie, say) runs under `cmd.exe`, with the real program a child of that: `kill()` ends
// `cmd.exe` and may leave the program running while acp-tui itself keeps running (a switch to
// another harness). So after the grace period acp-tui runs `taskkill /PID <pid> /T /F`, which ends
// the process and everything under it. `taskkill` is resolved from the PATH like every program
// acp-tui starts (which.ts), and started with an argument list, never a shell. When it cannot be
// found, cannot start or fails, the plain `kill()` is the fallback.
import { resolveArgv } from "./which.ts";

/** The part of a subprocess this module uses. */
export interface KillableProcess {
  readonly pid: number;
  readonly exitCode?: number | null;
  readonly signalCode?: string | null;
  kill(): void;
}

/** Starts a program and reports how it ended; default `Bun.spawn` with every stream ignored. */
export type TaskkillSpawner = (argv: string[]) => { readonly exited: Promise<number | null> };

export interface KillTreeOptions {
  /** Default `process.platform`. */
  readonly platform?: NodeJS.Platform;
  /** Default `Bun.spawn`, no input and no output. */
  readonly spawn?: TaskkillSpawner;
  /** Turns the argument list's program into an absolute path; default `resolveArgv`, which throws
   *  `ProgramNotFoundError` when the program is on no PATH entry. */
  readonly resolve?: (argv: readonly string[]) => string[];
}

/** The command that ends process `pid` and its children, and does so by force. */
export function taskkillArgv(pid: number): string[] {
  return ["taskkill", "/PID", String(pid), "/T", "/F"];
}

const spawnTaskkill: TaskkillSpawner = (argv) => Bun.spawn(argv, { stdin: "ignore", stdout: "ignore", stderr: "ignore" });

function killQuietly(proc: KillableProcess): void {
  try {
    proc.kill();
  } catch {
    // already gone
  }
}

/**
 * Ends `proc` and, on Windows, everything it started. Resolves once that is done (at once on other
 * platforms, where `kill()` is all there is), and never rejects: on Windows `proc.kill()` is the
 * fallback if `taskkill` cannot be found, cannot be started or reports a failure. A process that
 * has already exited is left alone (its PID may have been reused, and `taskkill /T` would end
 * whatever holds it now). A caller that does not need to wait ignores the promise.
 */
export function killProcessTree(proc: KillableProcess, options: KillTreeOptions = {}): Promise<void> {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    killQuietly(proc);
    return Promise.resolve();
  }
  if ((proc.exitCode !== undefined && proc.exitCode !== null) || (proc.signalCode !== undefined && proc.signalCode !== null)) return Promise.resolve();
  try {
    const argv = (options.resolve ?? ((a) => resolveArgv(a, { platform })))(taskkillArgv(proc.pid));
    const child = (options.spawn ?? spawnTaskkill)(argv);
    return child.exited.then(
      (code) => {
        if (code !== 0) killQuietly(proc);
      },
      () => killQuietly(proc),
    );
  } catch {
    // taskkill is not on the PATH, or could not start
    killQuietly(proc);
    return Promise.resolve();
  }
}
