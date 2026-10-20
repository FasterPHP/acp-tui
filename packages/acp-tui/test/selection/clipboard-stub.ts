// Stub clipboard programs for the copy and paste tests (mvp-chrome-and-keys task 12.6; macOS in
// mvp-configuration): `wl-copy`, `xclip`, `pbcopy` and `pbpaste` in a temporary directory that the
// tests put on `PATH` instead of the real one, so the real programs never run and the user's
// clipboard is never written or read.
//
// The stub is a Bun script (absolute shebang, so it needs nothing on `PATH`). It records, in
// `$STUB_LOG/<name>.json`, its arguments, standard input, process ID, its parent's command name
// (a shell would show here) and the display variables it was given; then, like the real
// Linux programs, it leaves a child running (the "serving" process, in a session of its own, its
// PID in `<name>.json` as `servingPid`) and exits; `pbcopy` leaves none, as the real one, and
// `pbpaste` prints `$STUB_PASTE` (default empty). The record also has the locale variables.
// `STUB_MODE`: `ok` (default), `fail` (exit 1, no child) or `hang` (never exits).
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const STUB = `#!${process.execPath}
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
const name = basename(process.argv[1]);
const stdin = await Bun.stdin.text();
let parent = "";
try { parent = readFileSync("/proc/" + process.ppid + "/comm", "utf8").trim(); } catch {}
const mode = process.env.STUB_MODE ?? "ok";
const record = { argv: process.argv.slice(2), stdin, pid: process.pid, parent, WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY ?? null, DISPLAY: process.env.DISPLAY ?? null, LANG: process.env.LANG ?? null, LC_ALL: process.env.LC_ALL ?? null, servingPid: null };
if (mode === "ok" && name === "pbpaste") await Bun.write(Bun.stdout, process.env.STUB_PASTE ?? "");
if (mode === "ok" && (name === "wl-copy" || name === "xclip")) {
  const serving = Bun.spawn([process.execPath, "-e", "await Bun.sleep(30000)"], { stdin: "ignore", stdout: "ignore", stderr: "ignore", detached: true });
  serving.unref();
  record.servingPid = serving.pid;
}
writeFileSync(join(process.env.STUB_LOG, name + ".json"), JSON.stringify(record));
if (mode === "fail") process.exit(1);
if (mode === "hang") await Bun.sleep(60000);
process.exit(0);
`;

export interface StubRecord {
  argv: string[];
  stdin: string;
  pid: number;
  parent: string;
  WAYLAND_DISPLAY: string | null;
  DISPLAY: string | null;
  LANG: string | null;
  LC_ALL: string | null;
  servingPid: number | null;
}

export type StubName = "wl-copy" | "xclip" | "pbcopy" | "pbpaste";
const STUB_NAMES: readonly StubName[] = ["wl-copy", "xclip", "pbcopy", "pbpaste"];

export interface Stubs {
  /** The directory to use as `PATH` (it also holds a `bun` link, for the PTY tests' agent). */
  readonly bin: string;
  /** Where the stubs write their records (`STUB_LOG`). */
  readonly log: string;
  record(name: StubName): StubRecord | null;
  /** Kills every serving child the stubs left. */
  cleanup(): void;
}

/** A `PATH` directory with the stubs named in `names` (none: a `PATH` with no clipboard program). */
export function makeStubs(names: readonly StubName[]): Stubs {
  const root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-clipboard-stub-"));
  const bin = join(root, "bin");
  const log = join(root, "log");
  for (const dir of [bin, log]) mkdirSync(dir);
  for (const name of names) {
    const path = join(bin, name);
    writeFileSync(path, STUB);
    chmodSync(path, 0o755);
  }
  symlinkSync(process.execPath, join(bin, "bun"));
  const record = (name: StubName): StubRecord | null => {
    const path = join(log, `${name}.json`);
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as StubRecord) : null;
  };
  return {
    bin,
    log,
    record,
    cleanup() {
      for (const name of STUB_NAMES) {
        const pid = record(name)?.servingPid;
        if (pid) {
          try {
            process.kill(pid, "SIGKILL");
          } catch {}
        }
      }
    },
  };
}

/** Whether `pid` is a live process (not gone, not a zombie). */
export function alive(pid: number): boolean {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) !== "Z";
  } catch {
    return false;
  }
}

/** Whether `/proc/<pid>` still exists (a zombie counts). */
export function exists(pid: number): boolean {
  return existsSync(`/proc/${pid}`);
}
