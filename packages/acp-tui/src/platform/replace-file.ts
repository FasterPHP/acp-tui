// Writing a file another process may hold open (spec tui-sessions "Session index writes survive a
// busy file"): the session index's append and its compaction's rename over the old file.
//
// On Windows another process that holds the file open can refuse what acp-tui does next, by the
// sharing it allowed: without delete sharing a rename over the file fails, and without write sharing
// opening it to append fails, both with EPERM, EBUSY or EACCES (another acp-tui reading the index, a
// search indexer, antivirus, or a .NET reader, whose default allows reading only). The hold is
// usually over within a few tens of milliseconds, so the step is retried up to five times, 50 ms
// apart (250 ms in all), before the error is reported as any other. Linux and macOS have no such
// locks, so there the step runs once and its error is reported at once, as before.
import { renameSync } from "node:fs";
import type { Platform } from "./paths.ts";

/** The errors that mean the file is held, not that the rename is wrong. */
export const BUSY_CODES: ReadonlySet<string> = new Set(["EPERM", "EBUSY", "EACCES"]);

/** Retries after the first attempt, and the wait before each: five over 250 ms. */
export const RENAME_RETRIES = 5;
export const RENAME_RETRY_DELAY_MS = 50;

export interface RenameOptions {
  /** The rename itself; default `fs.renameSync`. */
  readonly rename?: (from: string, to: string) => void;
  /** A blocking wait in milliseconds; default `Bun.sleepSync`. */
  readonly sleep?: (ms: number) => void;
  /** Whether to retry is decided by this platform; default the running one. */
  readonly platform?: Platform;
}

/** Runs `step` (a file operation), retrying it briefly on Windows while another process holds the
 *  file. Throws the last error when it stays busy, and any other error at once. */
export function retryWhileBusy<T>(step: () => T, options: Omit<RenameOptions, "rename"> = {}): T {
  const retries = (options.platform ?? process.platform) === "win32" ? RENAME_RETRIES : 0;
  for (let attempt = 0; ; attempt++) {
    try {
      return step();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (attempt >= retries || code === undefined || !BUSY_CODES.has(code)) throw error;
      (options.sleep ?? Bun.sleepSync)(RENAME_RETRY_DELAY_MS);
    }
  }
}

/** Renames `from` over `to`, retrying briefly on Windows while the target is held open. Throws the
 *  last error when it stays busy or is any other error. */
export function renameOver(from: string, to: string, options: RenameOptions = {}): void {
  const rename = options.rename ?? renameSync;
  retryWhileBusy(() => rename(from, to), options);
}
