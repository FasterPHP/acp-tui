// The terminal title's instance counter (day-one-feedback design D8; spec tui-screen "Terminal
// title"): which running acp-tui instance showing a directory name this one is. A slot is a file
// `$XDG_STATE_HOME/acp-tui/titles/<sha1 of the name>.<n>` (`%LOCALAPPDATA%\acp-tui\titles` on
// Windows) holding the instance's PID, created exclusively (`O_EXCL`), so two instances starting
// together never take the same number; the lowest free `n` from 1 is taken. A slot whose PID no
// longer runs is taken over (a crash or `kill -9` leaves one). The number is fixed for the run:
// tabs do not renumber when another instance exits. Released by `release()` on every exit path (the lifecycle's final reset) and
// when the name changes (a session switch to another directory). Keyed by the name shown, so two
// checkouts both called `app` are told apart too. Nothing here fails the run: when the state
// directory cannot be written, the counter is 1.
import { createHash } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathsFor, stateDirectory, type Platform } from "../platform/paths.ts";

/** The slots' directory in acp-tui's state directory. */
export function titleSlotDir(env: Readonly<Record<string, string | undefined>> = process.env, platform: Platform = process.platform): string {
  return pathsFor(platform).join(stateDirectory(env, platform), "titles");
}

/** Slots tried before giving up (and showing 1): far more tabs than anyone has. */
const MAX_SLOTS = 64;

export interface TitleSlotOptions {
  /** The slots' directory; default `titleSlotDir()`. */
  readonly dir?: string;
  /** This instance's PID; default `process.pid`. */
  readonly pid?: number;
  /** Whether a process runs; default a signal 0 (EPERM counts as running). */
  readonly alive?: (pid: number) => boolean;
}

export interface TitleSlots {
  /** The instance number for `name` (1 for the first), taking a slot; releases the slot held for
   *  another name. Asking again for the same name returns the number held. */
  acquire(name: string): number;
  /** Releases the slot held, if any; safe to call twice. */
  release(): void;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function createTitleSlots(options: TitleSlotOptions = {}): TitleSlots {
  const dir = options.dir ?? titleSlotDir();
  const pid = options.pid ?? process.pid;
  const alive = options.alive ?? processAlive;
  let held: { readonly name: string; readonly path: string; readonly n: number } | null = null;

  const pathFor = (name: string, n: number): string => join(dir, `${createHash("sha1").update(name).digest("hex")}.${n}`);

  /** Creates the slot file exclusively and complete: the PID is written to a private file that is
   *  then hard-linked into place (`link` fails with EEXIST when the slot exists), so another
   *  instance never reads a slot that has no PID yet and takes it for a stale one. False when the
   *  slot exists. */
  const create = (path: string): boolean => {
    const tmp = `${path}.${pid}.tmp`;
    writeFileSync(tmp, String(pid), { mode: 0o600 });
    try {
      linkSync(tmp, path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    } finally {
      try {
        unlinkSync(tmp);
      } catch {
        /* gone already */
      }
    }
  };

  /** The PID a slot file holds, or null when it cannot be read or is not a PID. */
  const owner = (path: string): number | null => {
    try {
      const n = Number(readFileSync(path, "utf8").trim());
      return Number.isInteger(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  };

  /** A slot whose owner has gone: removed (only if it still holds the PID read, so a slot another
   *  instance has just taken over is not removed from under it). */
  const reclaim = (path: string): boolean => {
    const was = owner(path);
    if (was !== null && alive(was)) return false;
    if (owner(path) !== was) return false;
    try {
      unlinkSync(path);
    } catch {
      /* gone already */
    }
    return true;
  };

  const release = (): void => {
    const slot = held;
    held = null;
    if (!slot) return;
    // Only a slot still ours: a reclaimed one belongs to another instance now.
    if (owner(slot.path) !== pid) return;
    try {
      unlinkSync(slot.path);
    } catch {
      /* gone already */
    }
  };

  return {
    acquire(name) {
      if (held?.name === name) return held.n;
      release();
      try {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        for (let n = 1; n <= MAX_SLOTS; n++) {
          const path = pathFor(name, n);
          if (create(path) || (reclaim(path) && create(path))) {
            held = { name, path, n };
            return n;
          }
        }
      } catch {
        /* an unwritable state directory: no counter */
      }
      return 1;
    },
    release,
  };
}
