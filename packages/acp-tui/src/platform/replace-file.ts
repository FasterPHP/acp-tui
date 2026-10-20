// Replacing a file by renaming another over it (the session index's compaction) when the target may
// be open in another process (spec tui-sessions "Session index writes survive a busy file").
//
// On Windows a rename over a file that another process holds open without sharing deletion fails
// with EPERM, EBUSY or EACCES: another acp-tui reading the index, a search indexer or antivirus.
// The hold is usually over within a few tens of milliseconds, so the rename is retried up to five
// times, 50 ms apart (250 ms in all), before the error is reported as any other. Linux and macOS
// replace an open file without complaint, so there the rename runs once and its error is reported
// at once, as before.
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

/** Renames `from` over `to`, retrying briefly on Windows while the target is held open. Throws the
 *  last error when it stays busy or is any other error. */
export function renameOver(from: string, to: string, options: RenameOptions = {}): void {
  const rename = options.rename ?? renameSync;
  const retries = (options.platform ?? process.platform) === "win32" ? RENAME_RETRIES : 0;
  for (let attempt = 0; ; attempt++) {
    try {
      rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (attempt >= retries || code === undefined || !BUSY_CODES.has(code)) throw error;
      (options.sleep ?? Bun.sleepSync)(RENAME_RETRY_DELAY_MS);
    }
  }
}
