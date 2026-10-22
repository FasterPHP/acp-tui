// Ctrl+C before the full screen (spec tui-agent-session "Exit while the harness starts"): on the
// normal screen the terminal is in its cooked mode and Ctrl+C is SIGINT. On Linux and macOS a
// SIGINT listener always runs, even when the parent ignored the signal. On Windows a process
// started with Ctrl+C ignored passes that on to its children, and then no listener runs at all,
// so acp-tui turns the processing back on first (platform/windows-ctrl-c.ts).

export interface AllowCtrlCOptions {
  /** Default `process.platform`. */
  readonly platform?: NodeJS.Platform;
  /** Turns the processing on (Windows); default the Win32 call, required only there. */
  readonly enable?: () => boolean;
}

/** Makes sure Ctrl+C reaches this process's SIGINT listeners. Never throws: a failure leaves
 *  the processing as it was inherited. Returns whether anything was changed. */
export function allowCtrlC(options: AllowCtrlCOptions = {}): boolean {
  if ((options.platform ?? process.platform) !== "win32") return false;
  try {
    const enable =
      options.enable ?? (require("./windows-ctrl-c.ts") as typeof import("./windows-ctrl-c.ts")).enableConsoleCtrlC;
    return enable();
  } catch {
    return false;
  }
}
