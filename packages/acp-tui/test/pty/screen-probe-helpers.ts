// Shared by screen-probe.test.ts and screen-probe.timing.test.ts (split by the change parallel-tests, tasks 3.x). Not a test file.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startPty, type PtySession, type PtyStartOptions } from "./harness.ts";

export const ROOT = resolve(import.meta.dir, "../../../..");
export const PROBE = "packages/acp-tui/test/pty/screen-probe.tsx";

export interface Started {
  s: PtySession;
  log: () => Record<string, any>[];
  waitLog: (pred: (e: Record<string, any>) => boolean, ms?: number) => Promise<Record<string, any>>;
}

export function probe(args: string[] = [], opts: PtyStartOptions = {}): Started {
  const path = join(dir, `probe-${++logCount}.jsonl`);
  const s = startPty(["bun", PROBE, "--log", path, ...args], { cols: 80, rows: 24, cwd: ROOT, ...opts });
  sessions.push(s);
  const log = () =>
    existsSync(path)
      ? readFileSync(path, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l) as Record<string, any>)
      : [];
  const waitLog = async (pred: (e: Record<string, any>) => boolean, ms = 5000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const hit = log().find(pred);
      if (hit) return hit;
      if (Date.now() > deadline) throw new Error(`log entry not seen in ${ms} ms; log: ${JSON.stringify(log())}`);
      await Bun.sleep(15);
    }
  };
  return { s, log, waitLog };
}

export async function quit(p: Started): Promise<number> {
  p.s.sendKeys("Ctrl+Q");
  return p.s.wait();
}

let dir: string;
let logCount = 0;
let sessions: PtySession[] = [];

/** For each test file's `beforeAll`: the directory of the probes' logs; returns its cleanup. */
export function createDir(): () => void {
  dir = mkdtempSync(join(tmpdir(), "screen-probe-"));
  return () => rmSync(dir, { recursive: true, force: true });
}

/** Has `disposeSessions` end a session that a test started itself. */
export function track(s: PtySession): void {
  sessions.push(s);
}

/** For each test file's `afterEach`. */
export async function disposeSessions(): Promise<void> {
  await Promise.all(sessions.map((s) => s.dispose()));
  sessions = [];
}
